package au.screentime.parent.reports

import au.screentime.core.model.api.AppReport
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.SearchReport
import au.screentime.core.model.api.SiteClassOverride
import au.screentime.core.model.api.SiteReport
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/*
 * Reports in the parent app (docs/SPEC.md §12.9, §12.10, §12.12, §16.4): the same three reports as the web app's
 * Reports page (Apps, Websites, Searches) for a kid or shared device, by day, week (Monday to Sunday) or calendar
 * month, on all devices or one. Dates here are the family's local dates.
 */

// ---- The seam: where the reports come from. ----

/** The three reports, as on the web app's Reports page. */
enum class ReportKind(val label: String) {
    APPS("Apps"),
    WEBSITES("Websites"),
    SEARCHES("Searches"),
}

/** One report to show: which report, whose, which device (null for all devices), and the period holding [date]. */
data class ReportQuery(
    val kind: ReportKind,
    val kidId: String,
    val deviceId: String?,
    val period: ReportPeriod,
    val date: LocalDate,
)

/**
 * Where the Reports tab gets its reports. The real one (CARD-075) calls `GET /v1/reports/apps`, `/sites` and
 * `/searches`, and `PUT` / `DELETE /v1/sites/{site}/class`. Each call throws when the server or the network fails.
 */
interface ReportsSource {
    suspend fun apps(query: ReportQuery): AppReport

    suspend fun sites(query: ReportQuery): SiteReport

    suspend fun searches(query: ReportQuery): SearchReport

    /** A parent sets what [site] is for the whole family. */
    suspend fun setSiteClass(site: String, override: SiteClassOverride)

    /** Back to the classifier's answer for [site]. */
    suspend fun clearSiteClass(site: String)
}

/** The app's one [ReportsSource]; set once when the app starts (`ParentApp`). */
object Reports {
    lateinit var source: ReportsSource
}

// ---- Pure helpers: periods. ----

private val DAY = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)
private val DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
private val MONTH_YEAR = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH)
private val SHORT_MONTH_YEAR = DateTimeFormatter.ofPattern("MMM yyyy", Locale.ENGLISH)
private val LONG_DAY = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy", Locale.ENGLISH)

/** The first and last day of the period holding [date]: the day itself, Monday to Sunday, or the calendar month. */
fun periodRange(period: ReportPeriod, date: LocalDate): Pair<LocalDate, LocalDate> = when (period) {
    ReportPeriod.DAY -> date to date
    ReportPeriod.WEEK -> {
        val from = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        from to from.plusDays(6)
    }
    ReportPeriod.MONTH -> date.withDayOfMonth(1) to date.with(TemporalAdjusters.lastDayOfMonth())
}

/** The first day of the period before ([direction] -1) or after (+1) the one holding [date]. */
fun shiftPeriod(period: ReportPeriod, date: LocalDate, direction: Int): LocalDate {
    val (from, to) = periodRange(period, date)
    return if (direction < 0) periodRange(period, from.minusDays(1)).first else to.plusDays(1)
}

/** The period holds [today], so there is nothing after it to step to. */
fun isCurrentPeriod(period: ReportPeriod, date: LocalDate, today: LocalDate): Boolean {
    val (from, to) = periodRange(period, date)
    return !today.isBefore(from) && !today.isAfter(to)
}

/**
 * "Today", "Yesterday" or "Thu 20 Nov"; "This week" or "17 – 23 Nov" ("27 Oct – 2 Nov" across months, with the year
 * when it is not this year's); "This month" or "October 2026".
 */
fun periodLabel(period: ReportPeriod, date: LocalDate, today: LocalDate): String {
    val (from, to) = periodRange(period, date)
    val year = from.year != today.year || to.year != today.year
    return when (period) {
        ReportPeriod.DAY -> when (date) {
            today -> "Today"
            today.minusDays(1) -> "Yesterday"
            else -> DAY.format(date) + if (year) " ${date.year}" else ""
        }
        ReportPeriod.WEEK -> if (isCurrentPeriod(period, date, today)) {
            "This week"
        } else {
            val sameMonth = from.month == to.month && from.year == to.year
            val start = if (sameMonth) "${from.dayOfMonth}" else DAY_MONTH.format(from)
            "$start – ${DAY_MONTH.format(to)}" + if (year) " ${to.year}" else ""
        }
        ReportPeriod.MONTH -> if (isCurrentPeriod(period, date, today)) "This month" else MONTH_YEAR.format(from)
    }
}

/** What the jump-back button says for the period holding today. */
fun currentLabel(period: ReportPeriod): String = when (period) {
    ReportPeriod.DAY -> "Today"
    ReportPeriod.WEEK -> "This week"
    ReportPeriod.MONTH -> "This month"
}

/** The full dates under the label: "Thursday 20 November 2026", "Mon 17 Nov – Sun 23 Nov 2026", "1 – 30 Nov 2026". */
fun periodDates(period: ReportPeriod, date: LocalDate): String {
    val (from, to) = periodRange(period, date)
    return when (period) {
        ReportPeriod.DAY -> LONG_DAY.format(date)
        ReportPeriod.WEEK -> "${DAY.format(from)} – ${DAY.format(to)} ${to.year}"
        ReportPeriod.MONTH -> "1 – ${to.dayOfMonth} ${SHORT_MONTH_YEAR.format(to)}"
    }
}

/** Day / Week / Month, as on the web app. */
fun periodName(period: ReportPeriod): String = when (period) {
    ReportPeriod.DAY -> "Day"
    ReportPeriod.WEEK -> "Week"
    ReportPeriod.MONTH -> "Month"
}

/** "day", "week" or "month" inside a sentence: "No apps used in this week." */
fun periodWord(period: ReportPeriod): String = periodName(period).lowercase()

/** A day of the period as "23 Aug". */
fun dayLabel(date: LocalDate): String = DAY_MONTH.format(date)

// ---- Pure helpers: devices. ----

/** A device on the device chips; every report has the same four fields. */
data class ChipDevice(val deviceId: String, val name: String, val form: DeviceForm, val removed: Boolean)

/** The chips: none when the report has fewer than two devices (All devices is then the only choice). */
fun chipDevices(devices: List<ChipDevice>): List<ChipDevice> = if (devices.size < 2) emptyList() else devices

/** "Redmi", "Redmi and Desk PC", "Redmi, Tablet and Desk PC". */
fun namesList(names: List<String>): String = when (names.size) {
    0 -> ""
    1 -> names[0]
    else -> names.dropLast(1).joinToString(", ") + " and " + names.last()
}
