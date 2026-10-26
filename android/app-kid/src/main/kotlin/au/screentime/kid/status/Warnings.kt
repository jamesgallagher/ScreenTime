package au.screentime.kid.status

/** The two heads-up warnings before a lock (docs/SPEC.md §16.2, Q7). */
enum class Warning { FIRST, SECOND }

/**
 * Decides when to show a warning: each one once, when the time left falls to its threshold while the device is in
 * use. When a parent adds time the time left goes back above a threshold, and that warning can show again. A device
 * that is locked, or does not lock today, has no time left to warn about.
 */
class WarningTracker {
    private var lastLeftSec = Long.MAX_VALUE

    /** The warning to show for [status], or null. Call it only while the device is in use. */
    fun check(status: KidStatus): Warning? {
        val before = lastLeftSec
        val left = if (status.lockAtMs == null) Long.MAX_VALUE else status.leftSec
        lastLeftSec = left
        if (left <= 0) return null
        val warn1 = status.warn1Min * 60L
        val warn2 = status.warn2Min * 60L
        return when {
            left <= warn2 && before > warn2 -> Warning.SECOND
            left <= warn1 && before > warn1 -> Warning.FIRST
            else -> null
        }
    }
}

/** "15 minutes left". */
fun warningTitle(status: KidStatus, warning: Warning): String {
    val minutes = if (warning == Warning.FIRST) status.warn1Min else status.warn2Min
    return if (minutes == 1) "1 minute left" else "$minutes minutes left"
}

/** "This phone locks at 8:30 pm.", and at the second warning "Time to finish up." too. */
fun warningText(status: KidStatus, warning: Warning): String {
    val locks = status.lockAtText?.let { "This ${status.deviceWord} locks at $it." }
    val finish = if (warning == Warning.SECOND) "Time to finish up." else null
    return listOfNotNull(locks, finish).joinToString(" ")
}
