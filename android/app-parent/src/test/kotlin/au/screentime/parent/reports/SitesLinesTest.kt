package au.screentime.parent.reports

import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Platform
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.SiteCategory
import au.screentime.core.model.api.SiteClassOverrideKind
import au.screentime.core.model.api.SiteClassSource
import au.screentime.core.model.api.SiteKind
import au.screentime.core.model.api.SiteReport
import au.screentime.core.model.api.SiteReportApp
import au.screentime.core.model.api.SiteReportCategory
import au.screentime.core.model.api.SiteReportDevice
import au.screentime.core.model.api.SiteReportPage
import au.screentime.core.model.api.SiteReportSite
import au.screentime.core.model.api.SiteReportSiteDevicesItem
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.ZoneId

/*
 * CARD-075 acceptance criteria 14 to 22 (docs/cards/CARD-075-parent-reports.md section 6, "Websites"): Claude's
 * websites helpers in ReportLines.kt on the card's fixed fixtures. Dates and the zone are fixed; nothing reads the
 * clock. Expected values are the card's, character for character.
 */
class SitesLinesTest {
    private val sydney = ZoneId.of("Australia/Sydney")
    private val pixel = "p"
    private val pc = "pc"

    private fun siteDevice(
        deviceId: String,
        name: String,
        form: DeviceForm,
        platform: Platform,
        removedAt: String? = null,
        sitesRecorded: Boolean = true,
    ) = SiteReportDevice(
        deviceId = deviceId,
        name = name,
        form = form,
        platform = platform,
        removedAt = removedAt,
        sitesRecorded = sitesRecorded,
    )

    private fun onDevice(deviceId: String, minutes: Int) = SiteReportSiteDevicesItem(deviceId = deviceId, minutes = minutes)

    private fun app(
        label: String,
        packageName: String = label.lowercase(),
        browser: Boolean = false,
        minutes: Int = 1,
    ) = SiteReportApp(
        `package` = packageName,
        label = label,
        browser = browser,
        minutes = minutes,
    )

    private fun site(
        host: String,
        label: String? = null,
        kind: SiteKind? = null,
        category: SiteCategory? = null,
        source: SiteClassSource? = null,
        owner: String? = null,
        minutes: Int = 1,
        days: Int = 1,
        firstAt: String = "2026-11-20T04:10:00Z",
        lastAt: String = "2026-11-20T04:10:00Z",
        apps: List<SiteReportApp> = emptyList(),
        devices: List<SiteReportSiteDevicesItem> = emptyList(),
    ) = SiteReportSite(
        site = host,
        label = label,
        kind = kind,
        category = category,
        source = source,
        owner = owner,
        minutes = minutes,
        lookups = 0,
        days = days,
        firstAt = firstAt,
        lastAt = lastAt,
        apps = apps,
        devices = devices,
    )

    private fun report(
        deviceId: String? = null,
        devices: List<SiteReportDevice> = emptyList(),
        categories: List<SiteReportCategory> = emptyList(),
        sites: List<SiteReportSite> = emptyList(),
        behindTheScenes: List<SiteReportSite> = emptyList(),
        browserSec: Int = 0,
        privateSec: Int = 0,
        pages: List<SiteReportPage> = emptyList(),
        from: String = "2026-11-20",
        to: String = "2026-11-20",
        titlesKeptFrom: String = "2026-08-23",
    ) = SiteReport(
        kidId = "k1",
        period = ReportPeriod.DAY,
        from = from,
        to = to,
        today = "2026-11-20",
        deviceId = deviceId,
        devices = devices,
        categories = categories,
        sites = sites,
        behindTheScenes = behindTheScenes,
        browserSec = browserSec,
        privateSec = privateSec,
        pages = pages,
        titlesKeptFrom = titlesKeptFrom,
    )

    @Test
    fun `14 categoryLabel names every category and says Not sorted yet for an unsorted site`() {
        assertEquals("Not sorted yet", categoryLabel(null), "a site with no category is Not sorted yet")
        assertEquals(
            "Violence and weapons",
            categoryLabel(SiteCategory.VIOLENCE_WEAPONS),
            "VIOLENCE_WEAPONS is Violence and weapons",
        )
        assertEquals("Self-harm", categoryLabel(SiteCategory.SELF_HARM), "SELF_HARM is Self-harm")
        SiteCategory.entries.forEach { category ->
            val label = categoryLabel(category)
            assertTrue(label.isNotBlank(), "$category has a non-empty label but was \"$label\"")
        }
    }

    @Test
    fun `15 isWorthALook is true for exactly the five categories to look at first`() {
        val worthALook = SiteCategory.entries.filter { isWorthALook(it) }.toSet()
        assertEquals(
            setOf(
                SiteCategory.ADULT,
                SiteCategory.GAMBLING,
                SiteCategory.VIOLENCE_WEAPONS,
                SiteCategory.DRUGS,
                SiteCategory.SELF_HARM,
            ),
            worthALook,
            "the categories worth a look are Adult, Gambling, Violence and weapons, Drugs and Self-harm",
        )
        SiteCategory.entries.forEach { category ->
            val expected = category == SiteCategory.ADULT ||
                category == SiteCategory.GAMBLING ||
                category == SiteCategory.VIOLENCE_WEAPONS ||
                category == SiteCategory.DRUGS ||
                category == SiteCategory.SELF_HARM
            assertEquals(expected, isWorthALook(category), "$category worth a look is $expected")
        }
        assertFalse(isWorthALook(null), "an unsorted site is not worth a look")
    }

    @Test
    fun `16 activeTime and appsLine give the card's durations and app names`() {
        assertEquals("0m", activeTime(0), "no active minutes is 0m")
        assertEquals("1h 5m", activeTime(65), "65 active minutes is 1h 5m")

        val youtube = site("youtube.com", apps = listOf(app("Chrome", browser = true), app("Roblox")))
        assertEquals("Chrome, Roblox", appsLine(youtube), "two apps are listed in order")

        val five = site(
            "example.com",
            apps = listOf(app("A"), app("B"), app("C"), app("D"), app("E")),
        )
        assertEquals("A, B, C +2", appsLine(five), "five apps show the first three and +2")
    }

    @Test
    fun `17 whenLine shows the day's times in the family zone and the week's days`() {
        val day = site(
            "youtube.com",
            firstAt = "2026-11-20T04:10:00Z",
            lastAt = "2026-11-20T09:45:00Z",
        )
        assertEquals(
            "3:10 pm \u2013 8:45 pm",
            whenLine(day, ReportPeriod.DAY, sydney),
            "4:10Z to 9:45Z is 3:10 pm to 8:45 pm in Sydney",
        )

        val once = site(
            "youtube.com",
            firstAt = "2026-11-20T04:10:00Z",
            lastAt = "2026-11-20T04:10:00Z",
        )
        assertEquals("at 3:10 pm", whenLine(once, ReportPeriod.DAY, sydney), "one time is at 3:10 pm")

        assertEquals(
            "on 1 day",
            whenLine(site("youtube.com", days = 1), ReportPeriod.WEEK, sydney),
            "one day is on 1 day",
        )
        assertEquals(
            "on 4 days",
            whenLine(site("youtube.com", days = 4), ReportPeriod.WEEK, sydney),
            "four days is on 4 days",
        )
    }

    @Test
    fun `18 siteDeviceSplit names each device in All devices and only when more than one looked it up`() {
        val allDevices = report(
            devices = listOf(
                siteDevice(pixel, "Pixel", DeviceForm.PHONE, Platform.ANDROID),
                siteDevice(pc, "Desk PC", DeviceForm.PC, Platform.WINDOWS),
            ),
        )
        val both = site(
            "youtube.com",
            minutes = 52,
            devices = listOf(onDevice(pixel, 40), onDevice(pc, 12)),
        )
        assertEquals(
            "Pixel 40m \u00b7 Desk PC 12m",
            siteDeviceSplit(both, allDevices),
            "Pixel 40m and Desk PC 12m in All devices",
        )

        val one = site("youtube.com", minutes = 40, devices = listOf(onDevice(pixel, 40)))
        assertNull(siteDeviceSplit(one, allDevices), "one site device is not split: null")

        val chosen = report(deviceId = pixel, devices = allDevices.devices)
        assertNull(siteDeviceSplit(both, chosen), "a chosen device is not split by device: null")
    }

    @Test
    fun `19 sourceLine says who sorted it and ownerLine names the site a CDN is for`() {
        val byParent = site("stake.com", kind = SiteKind.WEBSITE, source = SiteClassSource.PARENT)
        assertEquals("Set by a parent", sourceLine(byParent), "a parent's class is Set by a parent")

        val byFilter = site("stake.com", kind = SiteKind.WEBSITE, source = SiteClassSource.FAMILY_DNS)
        assertEquals(
            "Blocked by a family filter: adult or unsafe",
            sourceLine(byFilter),
            "a family filter's class says so",
        )

        val byClassifier = site("stake.com", kind = SiteKind.WEBSITE, source = SiteClassSource.CLASSIFIER)
        assertNull(sourceLine(byClassifier), "the classifier gets no line")

        val unsorted = site("stake.com", kind = SiteKind.WEBSITE, source = null)
        assertNull(sourceLine(unsorted), "no source gets no line")

        val cdn = site("ytimg.com", kind = SiteKind.CDN, owner = "youtube.com")
        assertEquals("for youtube.com", ownerLine(cdn), "a CDN names the site it belongs to")

        val ownSite = site("youtube.com", kind = SiteKind.WEBSITE, owner = "youtube.com")
        assertNull(ownerLine(ownSite), "an owner equal to the site gets no line")

        val noOwner = site("ytimg.com", kind = SiteKind.CDN, owner = null)
        assertNull(ownerLine(noOwner), "no owner gets no line")
    }

    @Test
    fun `20 filterSites keeps one category, unsorted sites for null, or all in order`() {
        val unsorted = site("zlkj7q.xyz", kind = SiteKind.UNKNOWN, category = null, minutes = 4)
        val roblox = site("roblox.com", kind = SiteKind.WEBSITE, category = SiteCategory.GAMES, minutes = 3)
        val youtube = site("youtube.com", kind = SiteKind.WEBSITE, category = SiteCategory.VIDEO, minutes = 2)
        val coolmath = site("coolmathgames.com", kind = SiteKind.WEBSITE, category = SiteCategory.GAMES, minutes = 1)
        val sites = listOf(unsorted, roblox, youtube, coolmath)

        assertEquals(
            listOf("zlkj7q.xyz"),
            filterSites(sites, SiteFilter.Category(null)).map { it.site },
            "Category(null) keeps only the sites with no category",
        )
        assertEquals(
            listOf("roblox.com", "coolmathgames.com"),
            filterSites(sites, SiteFilter.Category(SiteCategory.GAMES)).map { it.site },
            "Category(GAMES) keeps only games, in order",
        )
        assertEquals(
            listOf("zlkj7q.xyz", "roblox.com", "youtube.com", "coolmathgames.com"),
            filterSites(sites, SiteFilter.All).map { it.site },
            "All keeps every site in order",
        )
    }

    @Test
    fun `21 notRecorded lists an unrecording PC, hasPc needs Windows in the report, titlesCut compares from`() {
        val pcHere = siteDevice(pc, "Desk PC", DeviceForm.PC, Platform.WINDOWS, sitesRecorded = false)
        val pcGone = siteDevice(
            "pc-old",
            "Old PC",
            DeviceForm.PC,
            Platform.WINDOWS,
            removedAt = "2026-11-04T09:00:00Z",
            sitesRecorded = false,
        )
        val unrecorded = report(devices = listOf(pcHere, pcGone))
        assertEquals(
            listOf(pc),
            notRecorded(unrecorded).map { it.deviceId },
            "only the not-removed PC that sends no websites is listed",
        )

        val phone = siteDevice(pixel, "Pixel", DeviceForm.PHONE, Platform.ANDROID)
        val pcRecording = siteDevice(pc, "Desk PC", DeviceForm.PC, Platform.WINDOWS)
        assertTrue(
            hasPc(report(devices = listOf(phone, pcRecording))),
            "All devices with a Windows PC that sends websites has a PC",
        )
        assertFalse(
            hasPc(report(deviceId = pixel, devices = listOf(phone, pcRecording))),
            "the report's device is the Android phone, so the PC is not in it",
        )

        assertTrue(
            titlesCut(report(from = "2026-08-01", titlesKeptFrom = "2026-08-23")),
            "a period starting before the kept titles is cut",
        )
        assertFalse(
            titlesCut(report(from = "2026-08-23", titlesKeptFrom = "2026-08-23")),
            "a period starting on the first kept day is not cut",
        )
    }

    @Test
    fun `22 startKind is the site's own kind, and A website for unknown or unsorted ones`() {
        assertEquals(
            SiteClassOverrideKind.WEBSITE,
            startKind(SiteKind.UNKNOWN),
            "UNKNOWN starts on A website",
        )
        assertEquals(
            SiteClassOverrideKind.WEBSITE,
            startKind(null),
            "an unsorted site starts on A website",
        )
        assertEquals(SiteClassOverrideKind.CDN, startKind(SiteKind.CDN), "CDN starts on CDN")
        assertEquals(
            SiteClassOverrideKind.ADS_TRACKING,
            startKind(SiteKind.ADS_TRACKING),
            "ADS_TRACKING starts on Ads or tracking",
        )
    }
}
