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
import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceAppsPut
import kotlinx.coroutines.CancellationException

/**
 * The app list and first use (docs/SPEC.md §12.4). Only the service uses it, one call at a time. What the device knows
 * is kept in SharedPreferences, so a restart neither forgets a first use nor sends an unchanged list again.
 */
class AppWatcher(context: Context, private val api: ApiClient, private val now: () -> Long = System::currentTimeMillis) {
    private val context = context.applicationContext
    private val pm = this.context.packageManager
    private val prefs = this.context.getSharedPreferences("apps", Context.MODE_PRIVATE)
    private val firstUsePrefs = this.context.getSharedPreferences("apps_first_use", Context.MODE_PRIVATE)
    private var warned = false

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

    /** Every app with a launcher icon, except this one. */
    private fun installed(): List<InstalledApp> {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val packages = pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
            .map { it.activityInfo.packageName }
            .toSet() - context.packageName
        return packages.mapNotNull { name ->
            try {
                val info = pm.getPackageInfo(name, PackageManager.PackageInfoFlags.of(0))
                val app = info.applicationInfo ?: return@mapNotNull null
                InstalledApp(
                    packageName = name,
                    label = app.loadLabel(pm).toString(),
                    isSystem = app.flags and ApplicationInfo.FLAG_SYSTEM != 0,
                    installer = pm.getInstallSourceInfo(name).installingPackageName,
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

        /** The first read looks this far back, so apps already in use raise no alert. */
        const val HISTORY_MS = 7 * 24 * 60 * 60 * 1000L
    }
}
