package au.screentime.kid.admin

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.app.admin.DnsEvent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import au.screentime.kid.apps.APPS_PREFS
import au.screentime.kid.apps.PARENT_FROM
import au.screentime.kid.apps.SPANS
import au.screentime.kid.apps.Span
import au.screentime.kid.apps.parseSpans
import au.screentime.kid.data.KidDatabase
import au.screentime.kid.data.SiteLookupRow
import au.screentime.kid.sites.keepLookup
import au.screentime.kid.sites.normalizeHost
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The Device Owner component. A parent makes the app Device Owner once, from a computer:
 * `adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver` (docs/guides/android-provisioning.md).
 * It also receives the batches of network logs (docs/SPEC.md §12.10): the kept DNS lookups go to `kid.db`.
 */
class KidDeviceAdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun component(context: Context) = ComponentName(context, KidDeviceAdminReceiver::class.java)
        private const val TAG = "KidService"

        /** More lookups waiting than this: the oldest go (docs/SPEC.md §12.10). */
        const val MAX_WAITING = 50_000
    }

    /**
     * A batch of network logs is ready (docs/SPEC.md §12.10). This runs on the main thread with about 10
     * seconds, so the work finishes in a coroutine: retrieve the batch once (a second call, or a stale id,
     * returns null), keep only the DNS lookups [keepLookup] says to keep, and store them in `kid.db`.
     */
    override fun onNetworkLogsAvailable(context: Context, intent: Intent, networkLogId: Long, count: Int) {
        val result = goAsync()
        CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
            try {
                receive(context, networkLogId)
            } catch (e: Exception) {
                Log.w(TAG, "sites: batch $networkLogId failed: ${e.javaClass.simpleName}")
            } finally {
                result.finish()
            }
        }
    }

    private suspend fun receive(context: Context, networkLogId: Long) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val logs = dpm.retrieveNetworkLogs(component(context), networkLogId) ?: return
        val spans = parentModeSpans(context)
        val kept = logs
            .filterIsInstance<DnsEvent>()
            .mapNotNull { event ->
                val host = normalizeHost(event.hostname) ?: return@mapNotNull null
                if (keepLookup(host, event.packageName, event.timestamp, context.packageName, spans)) {
                    SiteLookupRow(0L, event.timestamp, host, event.packageName)
                } else {
                    null
                }
            }
        val dao = KidDatabase.open(context).siteLookups()
        if (kept.isNotEmpty()) dao.insert(kept)
        if (dao.count() > MAX_WAITING) dao.deleteOldest(dao.count() - MAX_WAITING)
        Log.i(TAG, "sites: batch $networkLogId ${logs.size} events, ${kept.size} kept")
    }

    /** The parent mode spans: the 8 days kept for app usage, plus the open span while one is on (docs/SPEC.md §12.9). */
    private fun parentModeSpans(context: Context): List<Span> {
        val prefs = context.getSharedPreferences(APPS_PREFS, Context.MODE_PRIVATE)
        val spans = parseSpans(prefs.getString(SPANS, null).orEmpty()).toMutableList()
        val started = prefs.getLong(PARENT_FROM, -1).takeIf { it >= 0 }
        if (started != null) spans += Span(started, System.currentTimeMillis())
        return spans
    }
}
