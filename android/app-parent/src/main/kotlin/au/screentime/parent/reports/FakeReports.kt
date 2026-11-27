package au.screentime.parent.reports

import au.screentime.core.model.api.AppReport
import au.screentime.core.model.api.AppReportApp
import au.screentime.core.model.api.AppReportAppDevice
import au.screentime.core.model.api.AppReportDevice
import au.screentime.core.model.api.AppReportPool
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Platform
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.SearchCapture
import au.screentime.core.model.api.SearchEngine
import au.screentime.core.model.api.SearchReport
import au.screentime.core.model.api.SearchReportDevice
import au.screentime.core.model.api.SearchReportItem
import au.screentime.core.model.api.SiteCategory
import au.screentime.core.model.api.SiteClassOverride
import au.screentime.core.model.api.SiteClassSource
import au.screentime.core.model.api.SiteKind
import au.screentime.core.model.api.SiteReport
import au.screentime.core.model.api.SiteReportApp
import au.screentime.core.model.api.SiteReportCategory
import au.screentime.core.model.api.SiteReportDevice
import au.screentime.core.model.api.SiteReportPage
import au.screentime.core.model.api.SiteReportSite
import au.screentime.core.model.api.SiteReportSiteDevicesItem
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.delay

/**
 * SEAM (CARD-075 deletes this file): made-up reports so the Reports tab can be seen before it talks to the server.
 * Every kid gets a Pixel, a Desk PC and an Old tablet (removed); a period more than 60 days back is empty.
 */
object FakeReports : ReportsSource {
    private const val PIXEL = "fake-pixel"
    private const val PC = "fake-pc"
    private const val TABLET = "fake-tablet"
    private val overrides = mutableMapOf<String, SiteClassOverride>()

    private data class Dev(val id: String, val name: String, val form: DeviceForm, val platform: Platform, val removedAt: String?)

    private val devices = listOf(
        Dev(PIXEL, "Pixel", DeviceForm.PHONE, Platform.ANDROID, null),
        Dev(PC, "Desk PC", DeviceForm.PC, Platform.WINDOWS, null),
        Dev(TABLET, "Old tablet", DeviceForm.TABLET, Platform.ANDROID, "2026-11-04T09:00:00Z"),
    )

    private fun scale(period: ReportPeriod) = when (period) {
        ReportPeriod.DAY -> 1
        ReportPeriod.WEEK -> 5
        ReportPeriod.MONTH -> 18
    }

    private fun empty(query: ReportQuery) = query.date.isBefore(LocalDate.now().minusDays(60))

    private fun instant(date: LocalDate, hour: Int, minute: Int): String =
        date.atTime(hour, minute).atZone(ZoneId.systemDefault()).toInstant().toString()

    override suspend fun apps(query: ReportQuery): AppReport {
        delay(400)
        val (from, to) = periodRange(query.period, query.date)
        val k = scale(query.period)
        val raw = if (empty(query)) {
            emptyList()
        } else {
            listOf(
                Triple("com.roblox.client", "Roblox", listOf(PIXEL to 3_000, PC to 1_200)),
                Triple("com.google.android.youtube", "YouTube", listOf(PIXEL to 2_400)),
                Triple("minecraft.exe", "Minecraft", listOf(PC to 2_100)),
                Triple("com.android.chrome", "Chrome", listOf(PIXEL to 900, TABLET to 300)),
                Triple("com.whatsapp", "WhatsApp", listOf(PIXEL to 420)),
                Triple("com.duolingo", "Duolingo", listOf(TABLET to 360)),
                Triple("com.android.settings", "Settings", listOf(PIXEL to 40)),
                Triple("com.google.android.apps.photos", "Photos", listOf(PIXEL to 25)),
            )
        }
        val apps = raw.mapNotNull { (pkg, label, split) ->
            val parts = split.filter { query.deviceId == null || it.first == query.deviceId }.map { AppReportAppDevice(it.first, it.second * k) }
            if (parts.isEmpty()) {
                null
            } else {
                AppReportApp(
                    `package` = pkg,
                    label = label,
                    totalSec = parts.sumOf { it.sec },
                    devices = parts.sortedByDescending { it.sec },
                    installedAt = if (pkg == "com.duolingo") "2026-11-03T08:00:00Z" else null,
                    removedAt = if (pkg == "com.duolingo") "2026-11-04T09:00:00Z" else null,
                )
            }
        }.sortedByDescending { it.totalSec }
        val pools = if (query.deviceId != null) {
            listOf(AppReportPool(if (query.deviceId == PIXEL) Pool.PHONE else Pool.SCREENS, apps.sumOf { it.totalSec }))
        } else {
            listOf(AppReportPool(Pool.SCREENS, if (empty(query)) 0 else 3_300 * k), AppReportPool(Pool.PHONE, if (empty(query)) 0 else 6_200 * k))
        }
        return AppReport(
            kidId = query.kidId,
            period = query.period,
            from = from.toString(),
            to = to.toString(),
            today = LocalDate.now().toString(),
            deviceId = query.deviceId,
            devices = devices.map { AppReportDevice(it.id, it.name, it.form, it.platform, it.removedAt, appsRecorded = true) },
            screenTime = pools,
            apps = apps,
        )
    }

    private fun site(
        site: String,
        label: String?,
        kind: SiteKind?,
        category: SiteCategory?,
        minutes: Int,
        apps: List<String>,
        split: List<Pair<String, Int>>,
        query: ReportQuery,
        owner: String? = null,
        source: SiteClassSource? = SiteClassSource.CLASSIFIER,
    ): SiteReportSite? {
        val k = scale(query.period)
        val parts = split.filter { query.deviceId == null || it.first == query.deviceId }
        if (parts.isEmpty()) return null
        val own = overrides[site]
        val ownKind = own?.kind?.let { o -> SiteKind.entries.first { it.wire == o.wire } }
        return SiteReportSite(
            site = site,
            label = label,
            kind = ownKind ?: kind,
            category = if (own != null) own.category else category,
            source = if (own != null) SiteClassSource.PARENT else source,
            owner = owner,
            minutes = parts.sumOf { it.second } * k,
            lookups = minutes * 6 * k,
            days = minOf(k, 7),
            firstAt = instant(query.date, 15, 10),
            lastAt = instant(query.date, 20, 45),
            apps = apps.mapIndexed { i, a -> SiteReportApp(a.lowercase(), a, browser = a in setOf("Chrome", "Edge"), minutes = (minutes - i * 3).coerceAtLeast(1)) },
            devices = parts.map { SiteReportSiteDevicesItem(it.first, it.second * k) },
        )
    }

    override suspend fun sites(query: ReportQuery): SiteReport {
        delay(400)
        val (from, to) = periodRange(query.period, query.date)
        val all = if (empty(query)) {
            emptyList()
        } else {
            listOfNotNull(
                site("youtube.com", "YouTube", SiteKind.WEBSITE, SiteCategory.VIDEO, 52, listOf("Chrome", "YouTube"), listOf(PIXEL to 40, PC to 12), query),
                site("roblox.com", "Roblox", SiteKind.WEBSITE, SiteCategory.GAMES, 38, listOf("Roblox"), listOf(PIXEL to 30, PC to 8), query),
                site("khanacademy.org", "Khan Academy", SiteKind.WEBSITE, SiteCategory.EDUCATION, 21, listOf("Chrome"), listOf(PC to 21), query),
                site("google.com", "Google", SiteKind.WEBSITE, SiteCategory.SEARCH, 14, listOf("Chrome", "Edge", "Google"), listOf(PIXEL to 9, PC to 5), query),
                site("coolmathgames.com", "Coolmath Games", SiteKind.WEBSITE, SiteCategory.GAMES, 11, listOf("Edge"), listOf(PC to 11), query),
                site("stake.com", "Stake", SiteKind.WEBSITE, SiteCategory.GAMBLING, 3, listOf("Chrome"), listOf(PIXEL to 3), query),
                site("zlkj7q.xyz", null, SiteKind.UNKNOWN, null, 2, listOf("Chrome"), listOf(PIXEL to 2), query, source = null),
                site("newsite.example", null, null, null, 1, listOf("Chrome"), listOf(PIXEL to 1), query, source = null),
                site("ytimg.com", null, SiteKind.CDN, SiteCategory.VIDEO, 30, listOf("YouTube"), listOf(PIXEL to 30), query, owner = "youtube.com"),
                site("doubleclick.net", "Google Ads", SiteKind.ADS_TRACKING, SiteCategory.OTHER, 18, listOf("Chrome", "Roblox"), listOf(PIXEL to 15, PC to 3), query),
                site("rbxcdn.com", null, SiteKind.CDN, SiteCategory.GAMES, 25, listOf("Roblox"), listOf(PIXEL to 25), query, owner = "roblox.com"),
            )
        }
        val behind = setOf(SiteKind.CDN, SiteKind.ADS_TRACKING, SiteKind.APP_SERVICE)
        val sites = all.filter { it.kind !in behind }.sortedByDescending { it.minutes }
        val categories = sites.groupBy { it.category }
            .map { (c, list) -> SiteReportCategory(c, list.sumOf { it.minutes }, list.size) }
            .sortedByDescending { it.minutes }
        val pc = query.deviceId == null || query.deviceId == PC
        val k = scale(query.period)
        return SiteReport(
            kidId = query.kidId,
            period = query.period,
            from = from.toString(),
            to = to.toString(),
            today = LocalDate.now().toString(),
            deviceId = query.deviceId,
            devices = devices.map { SiteReportDevice(it.id, it.name, it.form, it.platform, it.removedAt, sitesRecorded = it.id != TABLET) },
            categories = categories,
            sites = sites,
            behindTheScenes = all.filter { it.kind in behind }.sortedByDescending { it.minutes },
            browserSec = if (pc && !empty(query)) 2_400 * k else 0,
            privateSec = if (pc && !empty(query)) 420 * k else 0,
            pages = if (pc && !empty(query)) {
                listOf(
                    SiteReportPage("Khan Academy | Free Online Courses", "msedge.exe", 1_260 * k, private = false),
                    SiteReportPage("Coolmath Games - Free Online Math Games", "msedge.exe", 600 * k, private = true),
                    SiteReportPage("minecraft cheats - Search", "chrome.exe", 95 * k, private = false),
                )
            } else {
                emptyList()
            },
            titlesKeptFrom = LocalDate.now().minusDays(89).toString(),
        )
    }

    override suspend fun searches(query: ReportQuery): SearchReport {
        delay(400)
        val (from, to) = periodRange(query.period, query.date)
        val days = if (query.period == ReportPeriod.DAY) listOf(query.date) else listOf(to.coerceAtMost(LocalDate.now()), to.coerceAtMost(LocalDate.now()).minusDays(1))
        val items = if (empty(query)) {
            emptyList()
        } else {
            days.flatMapIndexed { i, d ->
                listOf(
                    SearchReportItem("how to beat the ender dragon", SearchEngine.YOUTUBE, "com.google.android.youtube", "YouTube", PIXEL, instant(d, 19, 40 - i), instant(d, 19, 44 - i), 2, null),
                    SearchReportItem("minecraft cheats", SearchEngine.BING, "msedge.exe", "Edge", PC, instant(d, 17, 5), instant(d, 17, 5), 1, private = true),
                    SearchReportItem("volcano facts for school", SearchEngine.GOOGLE, "com.android.chrome", "Chrome", PIXEL, instant(d, 16, 20), instant(d, 16, 20), 1, private = false),
                    SearchReportItem("roblox promo codes", SearchEngine.GOOGLE, "com.google.android.googlequicksearchbox", "Google", PIXEL, instant(d, 15, 12), instant(d, 15, 12), 1, null),
                )
            }.filter { query.deviceId == null || it.deviceId == query.deviceId }
        }
        return SearchReport(
            kidId = query.kidId,
            period = query.period,
            from = from.toString(),
            to = to.toString(),
            today = LocalDate.now().toString(),
            deviceId = query.deviceId,
            devices = devices.map {
                val capture = when (it.id) {
                    PIXEL -> SearchCapture.ON
                    PC -> SearchCapture.ON
                    else -> SearchCapture.NEVER
                }
                SearchReportDevice(it.id, it.name, it.form, it.platform, it.removedAt, capture)
            },
            searches = items,
        )
    }

    override suspend fun setSiteClass(site: String, override: SiteClassOverride) {
        delay(300)
        overrides[site] = override
    }

    override suspend fun clearSiteClass(site: String) {
        delay(300)
        overrides.remove(site)
    }
}
