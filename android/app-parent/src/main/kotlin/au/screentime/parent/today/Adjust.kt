package au.screentime.parent.today

import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TodayPool
import au.screentime.core.time.formatDuration
import kotlin.math.abs

/** The adjust sheet's step (docs/SPEC.md §16.4, Q8): 15 minutes. */
const val ADJUST_STEP = 15

/** The adjust sheet's smallest amount: −4 hours. */
const val ADJUST_MIN = -240

/** The adjust sheet's biggest amount: +8 hours. */
const val ADJUST_MAX = 480

/** The amount when the adjust sheet opens. */
const val ADJUST_DEFAULT = 15

/** The adjust sheet's quick amounts. */
val QUICK_AMOUNTS = listOf(15, 30, 60, 120)

/**
 * The nearest multiple of 15 minutes to [minutes], within −4 hours and +8 hours (round half up).
 */
fun clampAdjust(minutes: Int): Int {
    val rounded = (Math.round(minutes / 15.0) * 15).toInt()
    return rounded.coerceIn(ADJUST_MIN, ADJUST_MAX)
}

/** One step up the adjust sheet's amount, stopping at +8 hours. */
fun stepUp(minutes: Int): Int = clampAdjust(minutes + ADJUST_STEP)

/** One step down the adjust sheet's amount, stopping at −4 hours. */
fun stepDown(minutes: Int): Int = clampAdjust(minutes - ADJUST_STEP)

/**
 * How the adjust sheet's amount reads in big type: "+15m", "+1h", "−45m", "0m".
 */
fun formatAdjust(minutes: Int): String {
    if (minutes == 0) return "0m"
    val size = abs(minutes)
    val sign = if (minutes > 0) "+" else "−"
    return sign + (if (size % 60 == 0) "${size / 60}h" else formatDuration(size * 60L))
}

/**
 * The line under the adjust sheet's amount: "Now 45m left → 1h left".
 * After bedtime or out of time there is nothing left, so a grant gives exactly its own minutes (docs/SPEC.md §7).
 */
fun adjustPreview(pool: TodayPool, minutes: Int): String {
    val now = if (pool.locked) "Now locked" else "Now ${formatDuration(pool.remainingSec.toLong())} left"
    val after = ((if (pool.locked) 0 else pool.remainingSec) + minutes * 60).coerceAtLeast(0)
    val afterText = if (after < 60) "locked" else "${formatDuration(after.toLong())} left"
    return "$now → $afterText"
}

/** The adjust sheet's title: "Change Alex's time". */
fun adjustTitle(kidName: String): String = "Change $kidName's time"

/** The lock dialog's title: "Lock Alex's Phone now?". */
fun lockTitle(kidName: String, pool: Pool): String = "Lock $kidName's ${poolName(pool)} now?"

/** The lock dialog's text (the web app's words). */
fun lockText(kidName: String, pool: TodayPool): String =
    "This takes away the ${formatDuration(pool.remainingSec.toLong())} left today. $kidName can still ask for more time."
