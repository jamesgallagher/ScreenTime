package au.screentime.kid.apps

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Process
import android.provider.Telephony
import android.telecom.TelecomManager
import android.util.Log
import android.app.admin.DevicePolicyManager
import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.AppRuleMode
import au.screentime.core.model.api.DeviceAppUsageUpload
import au.screentime.core.model.api.DeviceAppUsageUploadDaysItem
import au.screentime.core.model.api.DeviceAppUsageUploadDaysItemAppsItem
import au.screentime.kid.status.AppLimitView
import au.screentime.kid.usage.dayStartMs
import java.time.Instant
import java.time.ZoneId
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceAppsPut
import au.screentime.core.model.api.DeviceState
import au.screentime.kid.admin.KidDeviceAdminReceiver
import au.screentime.kid.admin.Policies
import kotlinx.coroutines.CancellationException

/**
 * The app list and first use (docs/SPEC.md §12.4). Only the service uses it, one call at a time. What the device knows
 * is kept in SharedPreferences, so a restart neither forgets a first use nor sends an unchanged list again.
 */
/** What the service needs after a look at the blocks: the main screen's list, what to tell the kid, and when to look again. */
data class BlocksNow(val limits: List<AppLimitView>, val news: List<String>, val nextLimitMs: Long?)

class AppWatcher(context: Context, private val api: ApiClient, private val now: () -> Long = System::currentTimeMillis) {
    private val context = context.applicationContext
    private val pm = this.context.packageManager
    private val prefs = this.context.getSharedPreferences("apps", Context.MODE_PRIVATE)
    private val firstUsePrefs = this.context.getSharedPreferences("apps_first_use", Context.MODE_PRIVATE)
    private var warned = false

    /**
     * Makes the device match the snapshot's rules: suspended, or hidden when Android refuses (Play Store); released
     * when no longer wanted. Cheap when nothing changed, so the service can call it after every run of the engine.
     * Does nothing unless the app is Device Owner.
     */
    fun applyBlocks(state: DeviceState, parentMode: Boolean): BlocksNow {
        val rules = state.apps.rules.associate { it.`package` to it.mode }
        val apps = installed()
        val installed = apps.map { it.packageName }.toSet()
        val limits = limitsNow(state, parentMode, apps.associate { it.packageName to appLabel(it.label, it.packageName) })
        val access = hasUsageAccess()
        // Without usage access the time cannot be counted, so limited apps stay blocked until it is back (§12.4).
        val over = limits.limits.filter { it.leftSec <= 0 || !access }.map { it.packageName }.toSet()
        val result = BlocksNow(
            limits = limits.limits.map { AppLimitView(it.label, if (access) it.leftSec else 0) },
            news = if (parentMode) emptyList() else takeNews(limits),
            nextLimitMs = if (parentMode || !access) null else nextLimitMs(limits.limits, limits.usage.inFront),
        )
        if (!Policies.isDeviceOwner(context)) return result
        val knownBefore = prefs.getStringSet(KNOWN, null)
        val held = heldPackages(state.apps.newAppApproval, knownBefore, installed, rules.keys, prefs.getStringSet(HELD, null).orEmpty())
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        // Android's word, not what was saved: a reinstalled app comes back free. An app not on this device is skipped:
        // rules are per kid, so it may only be on another one.
        val suspended = prefs.getStringSet(SUSPENDED, null).orEmpty().filter { isSuspended(dpm, it) }.toSet()
        val hidden = prefs.getStringSet(HIDDEN, null).orEmpty().filter { dpm.isApplicationHidden(admin, it) }.toSet()
        val wanted = wantedBlocks(rules, held, protectedPackages(), parentMode, over).intersect(installed)
        val plan = blockPlan(wanted, suspended + hidden)
        prefs.edit().putStringSet(KNOWN, installed).putStringSet(HELD, held).commit()
        if (plan.block.isEmpty() && plan.release.isEmpty()) return result

        val nowSuspended = suspended.toMutableSet()
        val nowHidden = hidden.toMutableSet()
        val unsuspend = plan.release.intersect(suspended)
        if (unsuspend.isNotEmpty()) {
            dpm.setPackagesSuspended(admin, unsuspend.toTypedArray(), false)
            nowSuspended -= unsuspend
        }
        for (name in plan.release.intersect(hidden)) {
            dpm.setApplicationHidden(admin, name, false)
            nowHidden -= name
        }
        if (plan.block.isNotEmpty()) {
            val refused = dpm.setPackagesSuspended(admin, plan.block.toTypedArray(), true).toSet()
            nowSuspended += plan.block - refused
            for (name in refused) {
                if (dpm.setApplicationHidden(admin, name, true)) nowHidden += name
            }
        }
        prefs.edit().putStringSet(SUSPENDED, nowSuspended).putStringSet(HIDDEN, nowHidden).commit()
        Log.i(TAG, "apps: blocked ${(nowSuspended + nowHidden).sorted()} (hidden ${nowHidden.sorted()})")
        return result
    }

    private class LimitsNow(val limits: List<AppLimitNow>, val usage: AppUsageNow)

    /** The limits now. It also keeps track of parent mode, whose time does not count. */
    private fun limitsNow(state: DeviceState, parentMode: Boolean, labels: Map<String, String>): LimitsNow {
        val now = this.now()
        val dayStart = dayStartMs(state, now)
        val usage = usageBetween(dayStart, now, notCounted(parentMode, dayStart, now))
        val minutes = state.apps.rules
            .filter { it.mode == AppRuleMode.LIMIT && it.dailyMinutes != null }
            .associate { it.`package` to it.dailyMinutes!! }
        val others = state.today.appUsage.groupBy { it.`package` }.mapValues { (_, rows) -> rows.sumOf { it.seconds.toLong() } }
        return LimitsNow(appLimits(minutes, usage.seconds, others, labels), usage)
    }

    /** What to tell the kid now, once per app per day. */
    private fun takeNews(limits: LimitsNow): List<String> {
        val news = limitNews(limits.limits, limits.usage.inFront, prefs.getStringSet(WARNED, null).orEmpty(), prefs.getStringSet(DONE, null).orEmpty())
        if (news.messages.isNotEmpty() || news.warned != prefs.getStringSet(WARNED, null).orEmpty() || news.done != prefs.getStringSet(DONE, null).orEmpty()) {
            prefs.edit().putStringSet(WARNED, news.warned).putStringSet(DONE, news.done).commit()
        }
        return news.messages
    }

    /** Parent mode's spans today, with this one up to now. Older ones are forgotten; a new day starts clean. */
    private fun notCounted(parentMode: Boolean, dayStart: Long, now: Long): List<Span> {
        val spans = parseSpans(prefs.getString(SPANS, null).orEmpty()).filter { it.toMs > dayStart }.toMutableList()
        val started = prefs.getLong(PARENT_FROM, -1).takeIf { it >= 0 }
        val edit = prefs.edit()
        if (parentMode && started == null) edit.putLong(PARENT_FROM, now)
        if (!parentMode && started != null) {
            spans += Span(started, now)
            edit.remove(PARENT_FROM)
        }
        edit.putString(SPANS, formatSpans(spans)).commit()
        return if (parentMode) spans + Span(started ?: now, now) else spans
    }

    private fun usageBetween(from: Long, to: Long, notCounted: List<Span>): AppUsageNow {
        if (!hasUsageAccess()) return AppUsageNow(emptyMap(), emptySet())
        val events = context.getSystemService(UsageStatsManager::class.java).queryEvents(from, to)
        val event = UsageEvents.Event()
        val out = mutableListOf<UsageEvent>()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            when (event.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> out += UsageEvent(UsageKind.RESUMED, event.packageName, event.timeStamp)
                UsageEvents.Event.ACTIVITY_PAUSED -> out += UsageEvent(UsageKind.PAUSED, event.packageName, event.timeStamp)
                UsageEvents.Event.SCREEN_NON_INTERACTIVE -> out += UsageEvent(UsageKind.SCREEN_OFF, event.packageName, event.timeStamp)
            }
        }
        return appUsage(out, from, to, notCounted)
    }

    /** Sends today's and yesterday's seconds per app when they changed, so a parent sees them and other devices count them. */
    suspend fun sendUsage(state: DeviceState) {
        if (!hasUsageAccess()) return
        val now = this.now()
        val zone = ZoneId.of(state.family.timezone)
        val today = dayStartMs(state, now)
        val yesterday = Instant.ofEpochMilli(today).atZone(zone).minusDays(1).toInstant().toEpochMilli()
        // Parent mode may just have ended without the service having looked yet: an upload can never be taken back.
        val open = prefs.getLong(PARENT_FROM, -1).takeIf { it >= 0 }?.let { Span(it, now) }
        val spans = parseSpans(prefs.getString(SPANS, null).orEmpty()) + listOfNotNull(open)
        fun day(from: Long, to: Long): DeviceAppUsageUploadDaysItem {
            val seconds = usageBetween(from, to, spans).seconds
                .filter { it.value > 0 && it.key != context.packageName }
                .toSortedMap()
            return DeviceAppUsageUploadDaysItem(
                Instant.ofEpochMilli(from).atZone(zone).toLocalDate().toString(),
                seconds.entries.take(500).map { DeviceAppUsageUploadDaysItemAppsItem(it.key, it.value.toInt().coerceAtMost(86400)) },
            )
        }
        val body = DeviceAppUsageUpload(listOf(day(yesterday, today), day(today, now)).filter { it.apps.isNotEmpty() })
        if (body.days.isEmpty()) return
        val text = ApiJson.encodeToString(DeviceAppUsageUpload.serializer(), body)
        if (text == prefs.getString(USAGE_SENT, null)) return
        try {
            api.postDeviceAppUsage(body)
            prefs.edit().putString(USAGE_SENT, text).commit()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            Log.w(TAG, "apps: usage refused (${e.status})")
        } catch (e: Exception) {
            Log.i(TAG, "apps: usage not sent")
        }
    }

    /** True once when usage access was on and is now off: a tamper attempt (docs/SPEC.md §12.4, §14). */
    fun usageAccessLost(): Boolean {
        val has = hasUsageAccess()
        val had = prefs.getBoolean(HAD_ACCESS, false)
        if (has != had) prefs.edit().putBoolean(HAD_ACCESS, has).commit()
        return had && !has
    }

    private fun isSuspended(dpm: DevicePolicyManager, name: String): Boolean = try {
        dpm.isPackageSuspended(KidDeviceAdminReceiver.component(context), name)
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }

    /** Reads new usage events. Sends the list if an app was used for the first time. */
    suspend fun tick() {
        if (readUsage()) send()
    }

    /** Looks at the installed apps and sends the list if anything changed, or if the last send failed. False when it could not reach the server. */
    suspend fun send(): Boolean {
        readUsage()
        val body = appListBody(installed(), firstUses(), protectedPackages()) ?: return true
        val text = ApiJson.encodeToString(DeviceAppsPut.serializer(), body)
        if (text == prefs.getString(SENT, null)) return true
        try {
            api.putDeviceApps(body)
            Log.i(TAG, "apps: sent ${body.apps.size}")
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            // Refused now, refused next time: the list goes again when it changes.
            Log.w(TAG, "apps: refused (${e.status})")
        } catch (e: Exception) {
            // No connection: the next sync tries again.
            Log.i(TAG, "apps: not sent")
            return false
        }
        prefs.edit().putString(SENT, text).commit()
        return true
    }

    /** True when an app was used for the first time. */
    private fun readUsage(): Boolean {
        if (!hasUsageAccess()) {
            if (!warned) Log.w(TAG, "apps: no usage access, so first use is not seen")
            warned = true
            return false
        }
        warned = false
        val to = now()
        val from = prefs.getLong(READ_TO, to - HISTORY_MS)
        val known = firstUses()
        val updated = withFirstUses(known, resumes(from, to), ignored())
        prefs.edit().putLong(READ_TO, to).commit()
        val added = updated - known.keys
        if (added.isEmpty()) return false
        firstUsePrefs.edit().apply { added.forEach { (pkg, at) -> putLong(pkg, at) } }.commit()
        return true
    }

    private fun firstUses(): Map<String, Long> =
        firstUsePrefs.all.mapNotNull { (pkg, at) -> (at as? Long)?.let { pkg to it } }.toMap()

    private fun hasUsageAccess(): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        return ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }

    private fun resumes(from: Long, to: Long): List<Resume> {
        val events = context.getSystemService(UsageStatsManager::class.java).queryEvents(from, to)
        val event = UsageEvents.Event()
        val out = mutableListOf<Resume>()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) out += Resume(event.packageName, event.timeStamp)
        }
        return out
    }

    /** Every app with a launcher icon, except this one, and the apps this app hid: they stay on the list. */
    private fun installed(): List<InstalledApp> {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val packages = pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
            .map { it.activityInfo.packageName }
            .toSet() - context.packageName + prefs.getStringSet(HIDDEN, null).orEmpty()
        return packages.mapNotNull { name ->
            try {
                val flags = PackageManager.MATCH_UNINSTALLED_PACKAGES.toLong()
                val info = pm.getPackageInfo(name, PackageManager.PackageInfoFlags.of(flags))
                val app = info.applicationInfo ?: return@mapNotNull null
                InstalledApp(
                    packageName = name,
                    label = app.loadLabel(pm).toString(),
                    isSystem = app.flags and ApplicationInfo.FLAG_SYSTEM != 0,
                    installer = runCatching { pm.getInstallSourceInfo(name).installingPackageName }.getOrNull(),
                    installedAtMs = info.firstInstallTime,
                )
            } catch (e: PackageManager.NameNotFoundException) {
                // Removed just now.
                null
            }
        }
    }

    private fun homePackage(): String? {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return pm.resolveActivity(home, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()))?.activityInfo?.packageName
    }

    private fun ignored(): Set<String> = setOfNotNull(homePackage(), context.packageName)

    /** The apps of this device the kid must keep: the launcher, and the phone and messaging apps SOS and calls need. */
    private fun protectedPackages(): Set<String> {
        val telecom = context.getSystemService(TelecomManager::class.java)
        return setOfNotNull(
            homePackage(),
            telecom?.defaultDialerPackage,
            telecom?.systemDialerPackage,
            Telephony.Sms.getDefaultSmsPackage(context),
            context.packageName,
        )
    }

    private companion object {
        const val TAG = "KidService"
        const val SENT = "sent"
        const val READ_TO = "readTo"
        const val KNOWN = "known"
        const val HELD = "held"
        const val SUSPENDED = "suspended"
        const val HIDDEN = "hidden"
        const val WARNED = "warned"
        const val DONE = "done"
        const val SPANS = "spans"
        const val PARENT_FROM = "parentFrom"
        const val USAGE_SENT = "usageSent"
        const val HAD_ACCESS = "hadAccess"

        /** The first read looks this far back, so apps already in use raise no alert. */
        const val HISTORY_MS = 7 * 24 * 60 * 60 * 1000L
    }
}
