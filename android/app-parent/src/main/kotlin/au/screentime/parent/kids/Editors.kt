package au.screentime.parent.kids

import au.screentime.core.model.api.KidContactsPut
import au.screentime.core.model.api.KidContactsPutContactsItem
import au.screentime.core.model.api.Schedule
import au.screentime.core.model.api.ScheduleDay
import au.screentime.core.model.api.ScheduleInput
import au.screentime.core.time.formatDuration

/** The weekday names, index 0 is weekday 1 (Monday). */
val WEEKDAYS = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

/** The first warning's options, minutes before time runs out. */
val WARN1_OPTIONS = listOf(10, 15, 20, 30, 45, 60)

/** The second warning's options, minutes before time runs out. */
val WARN2_OPTIONS = listOf(1, 2, 3, 5, 10)

/** The most always-callable numbers a kid's phone can have. */
const val MAX_CONTACTS = 10

/** One stepper choice: its value and the words shown for it. */
data class Option<T>(val value: T, val label: String)

/** One always-callable row as typed: the name and the number. */
data class ContactRow(val label: String, val phone: String)

/** The minutes of an "HH:MM" time, "24:00" being 1440. */
private fun minutesOf(time: String): Int {
    val parts = time.split(":")
    val h = parts.getOrNull(0)?.toIntOrNull() ?: 0
    val m = parts.getOrNull(1)?.toIntOrNull() ?: 0
    return h * 60 + m
}

/** An "HH:MM" time from its minutes, "24:00" for 1440. */
private fun timeOf(minutes: Int): String {
    val h = minutes / 60
    val m = minutes % 60
    return "${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}"
}

/** "7:00 am", "12:30 pm", "midnight" for the end of the day (docs/SPEC.md §16.1, 12-hour). */
fun formatClock(time: String): String {
    val minutes = minutesOf(time)
    if (minutes == 1440) return "midnight"
    val h = minutes / 60
    val m = minutes % 60
    val hour = h % 12
    val displayHour = if (hour == 0) 12 else hour
    val amPm = if (h < 12) "am" else "pm"
    return "$displayHour:${m.toString().padStart(2, '0')} $amPm"
}

/** Adds the saved value when it is off the grid, so the stepper still shows it, in order. */
private fun <T> withCurrent(options: List<Option<T>>, current: T, label: (T) -> String, key: (T) -> Int): List<Option<T>> {
    if (options.any { it.value == current }) return options
    return (options + Option(current, label(current))).sortedBy { key(it.value) }
}

/** The hour and minute a clock picker starts on for [time]; "24:00" (midnight, the end of the day) starts on 12 am. */
fun pickerStart(time: String): Pair<Int, Int> {
    val minutes = minutesOf(time) % 1440
    return minutes / 60 to minutes % 60
}

/**
 * The "HH:MM" a clock picker's [hour] and [minute] mean, on the 15-minute grid (rounded to the nearest step). For a
 * [bedtime], 12 am is midnight at the end of the day ("24:00"); a wake-up never rounds past 11:45 pm.
 */
fun pickedClock(hour: Int, minute: Int, bedtime: Boolean): String {
    val rounded = ((hour * 60 + minute + 7) / 15) * 15
    val minutes = when {
        bedtime && rounded % 1440 == 0 -> 1440
        bedtime -> rounded.coerceAtMost(1440)
        else -> rounded.coerceAtMost(1425)
    }
    return timeOf(minutes)
}

/** A day's row in the week overview: "Screens 2h · Phone 1h 30m". */
fun allowanceLine(day: ScheduleDay): String =
    "Screens ${formatAllowance(day.screensMin)} · Phone ${formatAllowance(day.phoneMin)}"

/** A day's second line in the week overview: "7:00 am – 8:30 pm". */
fun hoursLine(day: ScheduleDay): String = "${formatClock(day.wake)} – ${formatClock(day.bedtime)}"

/** Wake-up: midnight to 11:45 pm, in 15-minute steps. */
fun wakeOptions(current: String): List<Option<String>> {
    val options = (0 until 1440 step 15).map { Option(timeOf(it), formatClock(timeOf(it))) }
    return withCurrent(options, current, ::formatClock, ::minutesOf)
}

/** Bedtime: 12:15 am to midnight (end of day), in 15-minute steps. */
fun bedtimeOptions(current: String): List<Option<String>> {
    val options = (15 until 1441 step 15).map { Option(timeOf(it), formatClock(timeOf(it))) }
    return withCurrent(options, current, ::formatClock, ::minutesOf)
}

/** "No time", "15m", "2h", "1h 30m" for an allowance in whole minutes. */
fun formatAllowance(minutes: Int): String {
    return if (minutes == 0) "No time" else formatDuration(minutes * 60L)
}

/** No time, 15m, 30m … 12h; a saved value longer than 12h is kept at the end. */
fun allowanceOptions(current: Int): List<Option<Int>> {
    val options = (0..720 step 15).map { Option(it, formatAllowance(it)) }
    return withCurrent(options, current, ::formatAllowance) { it }
}

/** The warning options: the base list plus the saved value, no duplicates, sorted. */
fun warnOptions(base: List<Int>, current: Int): List<Option<Int>> {
    return (base + current).distinct().sorted().map { Option(it, "$it min before") }
}

/** The value [by] places along [options] (−1 or +1), stopping at the first and last; an unknown [current] stays. */
fun <T> step(options: List<Option<T>>, current: T, by: Int): T {
    val index = options.indexOfFirst { it.value == current }
    if (index < 0) return current
    val target = index + by
    if (target < 0 || target >= options.size) return current
    return options[target].value
}

/** Tuesday to Friday become copies of Monday, keeping their own weekday. */
fun copyMondayToWeekdays(days: List<ScheduleDay>): List<ScheduleDay> {
    val monday = days.firstOrNull { it.weekday == 1 } ?: return days
    return days.map { day -> if (day.weekday in 2..5) monday.copy(weekday = day.weekday) else day }
}

/** Sunday becomes a copy of Saturday. */
fun copySaturdayToWeekend(days: List<ScheduleDay>): List<ScheduleDay> {
    val saturday = days.firstOrNull { it.weekday == 6 } ?: return days
    return days.map { day -> if (day.weekday == 7) saturday.copy(weekday = 7) else day }
}

/** "Bedtime must be after wake-up." when wake-up is at or after bedtime (string compare, as the server does). */
fun dayError(day: ScheduleDay): String? {
    return if (day.wake >= day.bedtime) "Bedtime must be after wake-up." else null
}

/** "The first warning must come before the second." unless the first comes before the second. */
fun warningsError(warn1Min: Int, warn2Min: Int): String? {
    return if (warn1Min > warn2Min) null else "The first warning must come before the second."
}

/** True when the schedule has no warnings error and no day error. */
fun scheduleValid(input: ScheduleInput): Boolean {
    return warningsError(input.warn1Min, input.warn2Min) == null && input.days.all { dayError(it) == null }
}

/** The saved schedule's input form (its warnings and days). */
fun inputOf(schedule: Schedule): ScheduleInput {
    return ScheduleInput(schedule.warn1Min, schedule.warn2Min, schedule.days)
}

/** A typed phone number in international format, or null when it is not one. Spaces, dashes, dots and brackets are dropped, and an Australian number starting with 0 gets +61 (the family locale is en-AU). */
fun normalisePhone(text: String): String? {
    val compact = text.replace(Regex("[\\s\\-.()]"), "")
    val phone = if (Regex("^0[1-9][0-9]{8}$").matches(compact)) "+61${compact.substring(1)}" else compact
    return if (Regex("^\\+[1-9][0-9]{6,14}$").matches(phone)) phone else null
}

/** "Type a name." when blank, "40 letters at most." when too long, else null. */
fun labelError(row: ContactRow): String? {
    val trimmed = row.label.trim()
    if (trimmed.isEmpty()) return "Type a name."
    if (trimmed.length > 40) return "40 letters at most."
    return null
}

/** The number's error when it is not a phone number, else null. */
fun phoneError(row: ContactRow): String? {
    return if (normalisePhone(row.phone) == null) "Type a number like 0412 345 678 or +61412345678." else null
}

/** True when there are at most 10 rows and no row errors. */
fun contactsValid(rows: List<ContactRow>): Boolean {
    if (rows.size > MAX_CONTACTS) return false
    return rows.all { labelError(it) == null && phoneError(it) == null }
}

/** The body to save: trimmed labels and normalised numbers. */
fun contactsBody(rows: List<ContactRow>): KidContactsPut {
    return KidContactsPut(rows.map { KidContactsPutContactsItem(it.label.trim(), normalisePhone(it.phone)!!) })
}

/** "Add a number", or "10 numbers at most" at 10. */
fun addNumberText(count: Int): String {
    return if (count >= MAX_CONTACTS) "10 numbers at most" else "Add a number"
}

/** "Remove Mum", or "Remove this number" when the name is blank. */
fun removeLabel(row: ContactRow): String {
    val trimmed = row.label.trim()
    return if (trimmed.isEmpty()) "Remove this number" else "Remove $trimmed"
}
