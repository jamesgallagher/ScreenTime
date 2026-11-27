package au.screentime.parent.reports

import au.screentime.core.model.api.AppReport
import au.screentime.core.model.api.AppReportApp
import au.screentime.core.model.api.AppReportDevice
import au.screentime.core.model.api.Platform
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.SearchCapture
import au.screentime.core.model.api.SearchEngine
import au.screentime.core.model.api.SearchReport
import au.screentime.core.model.api.SearchReportDevice
import au.screentime.core.model.api.SearchReportItem
import au.screentime.core.model.api.SiteCategory
import au.screentime.core.model.api.SiteClassOverrideKind
import au.screentime.core.model.api.SiteClassSource
import au.screentime.core.model.api.SiteKind
import au.screentime.core.model.api.SiteReport
import au.screentime.core.model.api.SiteReportDevice
import au.screentime.core.model.api.SiteReportSite
import au.screentime.core.time.formatDuration
import au.screentime.parent.inbox.timeOfDay
import au.screentime.parent.today.poolName
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * The words and numbers of the three reports, the same as the web app's (web/src/lib/reports.ts, sites.ts,
 * searches.ts), so a parent reads the same thing on either.
 */

// ---- Apps (docs/SPEC.md §12.9). ----

/** Apps under a minute in the period go into one Other row. */
const val OTHER_UNDER_SEC = 60

/** The apps shown one by one, and the ones under a minute folded into Other with their total. */
data class AppsSplit(val shown: List<AppReportApp>, val other: List<AppReportApp>, val otherSec: Int)

fun splitOther(apps: List<AppReportApp>): AppsSplit {
    val shown = apps.filter { it.totalSec >= OTHER_UNDER_SEC }
    val other = apps.filter { it.totalSec < OTHER_UNDER_SEC }
    return AppsSplit(shown, other, other.sumOf { it.totalSec })
}

/** A duration that stays short in a line: "<1m" under a minute, else "1h 12m". */
fun shortDuration(sec: Int): String = if (sec < 60) "<1m" else formatDuration(sec.toLong())

/** A total on top of a card: "0m" for nothing, else "1h 12m" ("<1m" under a minute). */
fun totalDuration(sec: Int): String = if (sec <= 0) "0m" else shortDuration(sec)

/** "Pixel 1h 10m · XPPen 30m": only in All devices, and only when the report has more than one device with apps. */
fun deviceSplit(app: AppReportApp, report: AppReport): String? {
    if (report.deviceId != null) return null
    if (report.devices.count { it.appsRecorded } < 2) return null
    val names = report.devices.associate { it.deviceId to it.name }
    return app.devices.joinToString(" · ") { "${names[it.deviceId] ?: "A device"} ${shortDuration(it.sec)}" }
}

private val SHORT_DAY = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)

private fun shortDay(instant: String, zone: ZoneId): String = SHORT_DAY.format(Instant.parse(instant).atZone(zone))

/** "Installed 3 Nov · removed 4 Nov" for an app gone from the report's devices; null while it is still there. */
fun removedLine(app: AppReportApp, zone: ZoneId): String? {
    val removedAt = app.removedAt ?: return null
    val installedAt = app.installedAt
    return if (installedAt != null) {
        "Installed ${shortDay(installedAt, zone)} · removed ${shortDay(removedAt, zone)}"
    } else {
        "Removed ${shortDay(removedAt, zone)}"
    }
}

/** A bar's length against the longest, from 0 to 1, at least a sliver (0.02) so a short one still shows. */
fun barFraction(value: Int, max: Int): Float {
    if (max <= 0 || value <= 0) return 0f
    return (value.toFloat() / max).coerceIn(0.02f, 1f)
}

/** The name of a pool on the Screen time card: Time for a shared device, the device's own name for one device. */
fun screenTimeLabel(pool: Pool, shared: Boolean, device: AppReportDevice?): String = when {
    device != null -> device.name
    shared -> "Time"
    else -> poolName(pool)
}

/** The report has a PC, not removed, whose programs are not recorded yet. */
fun hasUnrecorded(report: AppReport): Boolean = report.devices
    .filter { report.deviceId == null || it.deviceId == report.deviceId }
    .any { !it.appsRecorded && it.removedAt == null }

// ---- Websites (docs/SPEC.md §12.10). ----

private val CATEGORY_LABELS = mapOf(
    SiteCategory.SOCIAL to "Social",
    SiteCategory.VIDEO to "Video",
    SiteCategory.GAMES to "Games",
    SiteCategory.CHAT to "Chat",
    SiteCategory.SEARCH to "Search",
    SiteCategory.EDUCATION to "Education",
    SiteCategory.SHOPPING to "Shopping",
    SiteCategory.NEWS to "News",
    SiteCategory.ADULT to "Adult",
    SiteCategory.GAMBLING to "Gambling",
    SiteCategory.VIOLENCE_WEAPONS to "Violence and weapons",
    SiteCategory.DRUGS to "Drugs",
    SiteCategory.SELF_HARM to "Self-harm",
    SiteCategory.OTHER to "Other",
)

/** "Video", "Violence and weapons"; "Not sorted yet" for a site the classifier has not reached. */
fun categoryLabel(category: SiteCategory?): String = if (category == null) "Not sorted yet" else CATEGORY_LABELS.getValue(category)

/** Categories a parent may want to look at first. Nothing is sent: no alerts yet (docs/SPEC.md §12.10). */
val WORTH_A_LOOK = setOf(SiteCategory.ADULT, SiteCategory.GAMBLING, SiteCategory.VIOLENCE_WEAPONS, SiteCategory.DRUGS, SiteCategory.SELF_HARM)

fun isWorthALook(category: SiteCategory?): Boolean = category != null && category in WORTH_A_LOOK

/** The kinds a parent can pick for a site, in this order (unknown is the classifier's answer only). */
val PICKABLE_KINDS = listOf(
    SiteClassOverrideKind.WEBSITE to "A website",
    SiteClassOverrideKind.CDN to "Files for another site (CDN)",
    SiteClassOverrideKind.ADS_TRACKING to "Ads or tracking",
    SiteClassOverrideKind.APP_SERVICE to "An app or system service",
)

/** The kind the site sheet starts on: the site's own, or A website for an unknown or unsorted one. */
fun startKind(kind: SiteKind?): SiteClassOverrideKind = when (kind) {
    SiteKind.CDN -> SiteClassOverrideKind.CDN
    SiteKind.ADS_TRACKING -> SiteClassOverrideKind.ADS_TRACKING
    SiteKind.APP_SERVICE -> SiteClassOverrideKind.APP_SERVICE
    SiteKind.WEBSITE, SiteKind.UNKNOWN, null -> SiteClassOverrideKind.WEBSITE
}

fun kindLabel(kind: SiteKind?): String = when (kind) {
    null -> "Not sorted yet"
    SiteKind.WEBSITE -> "Website"
    SiteKind.CDN -> "CDN"
    SiteKind.ADS_TRACKING -> "Ads and tracking"
    SiteKind.APP_SERVICE -> "App service"
    SiteKind.UNKNOWN -> "Unknown"
}

/** The name on a row: the classifier's label, else the site. */
fun siteName(site: SiteReportSite): String = site.label ?: site.site

/** The letter in a site's circle: "y" for www.youtube.com. */
fun siteInitial(site: SiteReportSite): String = siteName(site).removePrefix("www.").take(1).uppercase()

/** Active minutes as a duration: "1h 5m", "45m", "0m". */
fun activeTime(minutes: Int): String = if (minutes <= 0) "0m" else formatDuration(minutes * 60L)

/** "Chrome, Roblox": the apps that looked it up, most active first, at most three and "+2". */
fun appsLine(site: SiteReportSite): String {
    val names = site.apps.map { it.label }
    return if (names.size <= 3) names.joinToString(", ") else names.take(3).joinToString(", ") + " +${names.size - 3}"
}

/** Day: "3:10 pm – 8:45 pm" (or "at 3:10 pm"); week or month: "on 4 days" (or "on 1 day"). */
fun whenLine(site: SiteReportSite, period: ReportPeriod, zone: ZoneId): String {
    if (period == ReportPeriod.DAY) {
        val first = timeOfDay(Instant.parse(site.firstAt), zone)
        val last = timeOfDay(Instant.parse(site.lastAt), zone)
        return if (first == last) "at $first" else "$first – $last"
    }
    return if (site.days == 1) "on 1 day" else "on ${site.days} days"
}

/** "Pixel 40m · Desk PC 12m": only in All devices, and only when more than one device looked it up. */
fun siteDeviceSplit(site: SiteReportSite, report: SiteReport): String? {
    if (report.deviceId != null || site.devices.size < 2) return null
    val names = report.devices.associate { it.deviceId to it.name }
    return site.devices.joinToString(" · ") { "${names[it.deviceId] ?: "A device"} ${activeTime(it.minutes)}" }
}

/** Who sorted it, when it is not the classifier. */
fun sourceLine(site: SiteReportSite): String? = when (site.source) {
    SiteClassSource.PARENT -> "Set by a parent"
    SiteClassSource.FAMILY_DNS -> "Blocked by a family filter: adult or unsafe"
    SiteClassSource.CLASSIFIER, null -> null
}

/** "for youtube.com" under a CDN or app service. */
fun ownerLine(site: SiteReportSite): String? = site.owner?.takeIf { it != site.site }?.let { "for $it" }

/** What the website list shows: every site, or the sites of one category ([SiteFilter.Category] with null for Not sorted yet). */
sealed interface SiteFilter {
    data object All : SiteFilter

    data class Category(val category: SiteCategory?) : SiteFilter
}

fun filterSites(sites: List<SiteReportSite>, filter: SiteFilter): List<SiteReportSite> = when (filter) {
    SiteFilter.All -> sites
    is SiteFilter.Category -> sites.filter { it.category == filter.category }
}

/** The report's devices (all, or the chosen one), not removed, that have not sent any websites: a PC on an older version. */
fun notRecorded(report: SiteReport): List<SiteReportDevice> = report.devices.filter {
    (report.deviceId == null || it.deviceId == report.deviceId) && !it.sitesRecorded && it.removedAt == null
}

/** The report has a PC that sends websites (private-window time and pages come only from PCs). */
fun hasPc(report: SiteReport): Boolean = report.devices.any {
    it.platform == Platform.WINDOWS && it.sitesRecorded && (report.deviceId == null || it.deviceId == report.deviceId)
}

/** Pages are kept 90 days: the period starts before the first kept day. */
fun titlesCut(report: SiteReport): Boolean = report.from < report.titlesKeptFrom

private val BROWSER_LABELS = mapOf(
    "msedge.exe" to "Edge",
    "chrome.exe" to "Chrome",
    "brave.exe" to "Brave",
    "firefox.exe" to "Firefox",
)

fun browserLabel(pkg: String): String = BROWSER_LABELS[pkg] ?: pkg

/** How many website rows show before "Show all". */
const val SITES_SHOWN = 25

// ---- Searches (docs/SPEC.md §12.12). ----

/** A day's searches, newest day first: [label] is "Today", "Yesterday" or "Thu 20 Nov". */
data class SearchDay(val date: LocalDate, val label: String, val searches: List<SearchReportItem>)

/** The local date of an instant in the family zone. */
fun localDate(instant: String, zone: ZoneId): LocalDate = Instant.parse(instant).atZone(zone).toLocalDate()

private val SEARCH_DAY = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)

/** "Today", "Yesterday", else "Thu 20 Nov". */
fun searchDayHeading(date: LocalDate, today: LocalDate): String = when (date) {
    today -> "Today"
    today.minusDays(1) -> "Yesterday"
    else -> SEARCH_DAY.format(date)
}

/** Splits newest-first searches into local days, newest day first, keeping the order inside each day. */
fun groupByDay(searches: List<SearchReportItem>, zone: ZoneId, today: LocalDate): List<SearchDay> = searches
    .groupBy { localDate(it.at, zone) }
    .map { (date, items) -> SearchDay(date, searchDayHeading(date, today), items) }
    .sortedByDescending { it.date }

/** The searches whose words hold [text] (any case, spaces at the ends ignored); all of them for an empty text. */
fun filterSearches(searches: List<SearchReportItem>, text: String): List<SearchReportItem> {
    val needle = text.trim().lowercase()
    return if (needle.isEmpty()) searches else searches.filter { it.query.lowercase().contains(needle) }
}

fun engineName(engine: SearchEngine): String = when (engine) {
    SearchEngine.GOOGLE -> "Google"
    SearchEngine.BING -> "Bing"
    SearchEngine.DUCKDUCKGO -> "DuckDuckGo"
    SearchEngine.YOUTUBE -> "YouTube"
}

/** Where it was searched: "Google app", "YouTube app", else "Google in Chrome", "Bing in Edge". */
fun whereLine(item: SearchReportItem): String = when (item.`package`) {
    "com.google.android.googlequicksearchbox" -> "Google app"
    "com.google.android.youtube" -> "YouTube app"
    else -> "${engineName(item.engine)} in ${item.appLabel}"
}

/** "4:05 pm", or "4:05 pm – 4:09 pm" when it was seen again. */
fun timeLine(item: SearchReportItem, zone: ZoneId): String {
    val first = timeOfDay(Instant.parse(item.at), zone)
    val last = timeOfDay(Instant.parse(item.lastAt), zone)
    return if (first == last) first else "$first – $last"
}

/** The device's name, only in All devices when the report has more than one device; null otherwise. */
fun searchDeviceName(item: SearchReportItem, report: SearchReport): String? {
    if (report.deviceId != null || report.devices.size < 2) return null
    return report.devices.firstOrNull { it.deviceId == item.deviceId }?.name ?: "A device"
}

/** The totals on top: searches, different words (any case), and searches in a private window. */
data class SearchTotals(val searches: Int, val different: Int, val private: Int)

fun searchTotals(searches: List<SearchReportItem>): SearchTotals = SearchTotals(
    searches = searches.size,
    different = searches.map { it.query.trim().lowercase() }.toSet().size,
    private = searches.count { it.private == true },
)

/** The report's devices (all, or the chosen one), not removed, that do not record searches, split by why. */
data class NotRecording(val off: List<SearchReportDevice>, val never: List<SearchReportDevice>)

fun notRecording(report: SearchReport): NotRecording {
    val inReport = report.devices.filter { (report.deviceId == null || it.deviceId == report.deviceId) && it.removedAt == null }
    return NotRecording(off = inReport.filter { it.capture == SearchCapture.OFF }, never = inReport.filter { it.capture == SearchCapture.NEVER })
}
