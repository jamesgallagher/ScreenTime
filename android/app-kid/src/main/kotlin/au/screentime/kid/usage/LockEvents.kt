package au.screentime.kid.usage

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context

/**
 * Android's own screen and lock screen events (docs/SPEC.md §12.1, "Counting"), read from usage stats, for
 * [unlockedSince]. Times are on the device clock. Empty without usage access or when Android keeps none.
 */
class LockEvents(context: Context) {
    private val usage = context.applicationContext.getSystemService(UsageStatsManager::class.java)

    fun read(fromMs: Long, toMs: Long): List<LockEvent> {
        val events = try {
            usage.queryEvents(fromMs, toMs)
        } catch (e: SecurityException) {
            return emptyList()
        } ?: return emptyList()
        val event = UsageEvents.Event()
        val out = mutableListOf<LockEvent>()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val kind = when (event.eventType) {
                UsageEvents.Event.SCREEN_INTERACTIVE -> LockKind.SCREEN_ON
                UsageEvents.Event.SCREEN_NON_INTERACTIVE -> LockKind.SCREEN_OFF
                UsageEvents.Event.KEYGUARD_SHOWN -> LockKind.LOCK_SHOWN
                UsageEvents.Event.KEYGUARD_HIDDEN -> LockKind.LOCK_HIDDEN
                else -> null
            }
            if (kind != null) out += LockEvent(kind, event.timeStamp)
        }
        return out
    }
}
