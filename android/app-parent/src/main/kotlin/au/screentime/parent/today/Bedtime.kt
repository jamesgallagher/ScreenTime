package au.screentime.parent.today

import au.screentime.core.time.formatDuration
import au.screentime.parent.kids.formatClock

/**
 * Tonight's bedtime of one kid (docs/SPEC.md §7.5), as `GET /v1/today` will send it in `TodayKid.bedtime`. Times are
 * "HH:MM", local; "24:00" is midnight at the end of the day.
 *
 * Until CARD-062 wires it, [TodayViewModel.bedtimeOf] makes it up: every kid's bedtime is 8:30 pm and an extension
 * lasts until the app is closed. CARD-062 swaps this class for the generated `TodayBedtime`, with the same fields.
 */
data class TonightBedtime(
    /** Today's bedtime from the schedule; "24:00" means none. */
    val scheduled: String,
    /** The bedtime that counts tonight: the extension, or [scheduled] when there is none. */
    val tonight: String,
    /** The parent who extended it, or null when tonight is the scheduled bedtime. */
    val extendedBy: String?,
    /** The earliest bedtime a parent can pick now (a quarter hour after both [scheduled] and now), or null for none. */
    val earliest: String?,
)

const val BEDTIME_STEP = 15

/** The bedtime the sheet starts at when there is no extension yet: an hour later than usual. */
const val DEFAULT_EXTRA_MIN = 60
val QUICK_EXTRA_MIN = listOf(30, 60, 120)

private fun minutesOf(time: String): Int {
    val (h, m) = time.split(":").map { it.toInt() }
    return h * 60 + m
}

private fun timeOf(minutes: Int): String =
    "${(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}"

/** The row under the pools: "Bedtime 8:30 pm", or "Bedtime 9:30 pm tonight" with who and the usual time. */
fun bedtimeLine(b: TonightBedtime): Pair<String, String?> = when {
    b.extendedBy != null ->
        "Bedtime ${formatClock(b.tonight)} tonight" to "Extended by ${b.extendedBy} · usually ${formatClock(b.scheduled)}"
    minutesOf(b.scheduled) >= 1440 -> "No bedtime today" to null
    else -> "Bedtime ${formatClock(b.scheduled)}" to null
}

/** The row's button: "Extend" or "Change", or null when there is nothing a parent can do now. */
fun bedtimeAction(b: TonightBedtime): String? = when {
    b.extendedBy != null -> "Change"
    b.earliest == null -> null
    else -> "Extend"
}

/** Every bedtime the sheet offers: [TonightBedtime.earliest] to midnight in 15-minute steps, plus tonight's when earlier. */
fun bedtimeChoices(b: TonightBedtime): List<String> {
    val out = mutableListOf<String>()
    if (b.earliest != null) {
        var m = minutesOf(b.earliest)
        while (m <= 1440) {
            out += timeOf(m)
            m += BEDTIME_STEP
        }
    }
    // An extension that is already under way stays pickable, so the sheet can open on it.
    if (b.extendedBy != null && b.tonight !in out) out.add(0, b.tonight)
    return out
}

/** Where the sheet starts: tonight's extension, else an hour later than usual (kept inside the choices). */
fun startChoice(b: TonightBedtime): String? {
    val choices = bedtimeChoices(b)
    if (choices.isEmpty()) return null
    if (b.extendedBy != null) return b.tonight
    val want = minutesOf(b.scheduled) + DEFAULT_EXTRA_MIN
    return choices.firstOrNull { minutesOf(it) >= want } ?: choices.last()
}

/** One step later (1) or earlier (-1) through the choices; stays put at either end. */
fun stepChoice(choices: List<String>, value: String, direction: Int): String {
    val i = choices.indexOf(value)
    if (i < 0) return choices.firstOrNull() ?: value
    return choices[(i + direction).coerceIn(0, choices.size - 1)]
}

/** "+30m", "+1h", "+2h" from the scheduled bedtime, each with its time or null when it cannot be picked. */
fun quickChoices(b: TonightBedtime): List<Pair<String, String?>> {
    val choices = bedtimeChoices(b)
    return QUICK_EXTRA_MIN.map { extra ->
        val value = timeOf(minutesOf(b.scheduled) + extra)
        val label = if (extra < 60) "+${extra}m" else "+${extra / 60}h"
        label to value.takeIf { it in choices }
    }
}

/** "1h 00m later than usual", under the time in the sheet. */
fun laterText(b: TonightBedtime, value: String): String =
    "${formatDuration((minutesOf(value) - minutesOf(b.scheduled)) * 60L)} later than usual"

/** The time as the sheet's big number and button show it: "9:30 pm", "Midnight". */
fun bedtimeClock(value: String): String = formatClock(value).let { if (it == "midnight") "Midnight" else it }

/** The sheet's title. */
fun bedtimeTitle(kidName: String, b: TonightBedtime): String =
    if (b.extendedBy != null) "Change $kidName's bedtime tonight" else "Extend bedtime for $kidName"

/** The words under the title. */
fun bedtimeHelp(kidName: String): String =
    "Tonight only. $kidName can keep using any time left until the new bedtime. With no time left, the always-allowed " +
        "apps keep working until then."
