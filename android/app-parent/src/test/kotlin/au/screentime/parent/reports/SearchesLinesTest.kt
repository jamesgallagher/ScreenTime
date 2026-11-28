package au.screentime.parent.reports

import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Platform
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.SearchCapture
import au.screentime.core.model.api.SearchEngine
import au.screentime.core.model.api.SearchReport
import au.screentime.core.model.api.SearchReportDevice
import au.screentime.core.model.api.SearchReportItem
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.time.LocalDate
import java.time.ZoneId

/*
 * CARD-075 acceptance criteria 23 to 28 (docs/cards/CARD-075-parent-reports.md section 6, "Searches"): Claude's
 * searches helpers in ReportLines.kt on the card's fixed fixtures. Dates and the zone are fixed; nothing reads the
 * clock. Expected values are the card's, character for character.
 */
class SearchesLinesTest {
    private val sydney = ZoneId.of("Australia/Sydney")
    private val today = LocalDate.of(2026, 11, 20)
    private val phone = "p"
    private val pc = "pc"

    private fun device(
        deviceId: String,
        name: String,
        form: DeviceForm = DeviceForm.PHONE,
        platform: Platform = Platform.ANDROID,
        removedAt: String? = null,
        capture: SearchCapture = SearchCapture.ON,
    ) = SearchReportDevice(
        deviceId = deviceId,
        name = name,
        form = form,
        platform = platform,
        removedAt = removedAt,
        capture = capture,
    )

    private fun item(
        query: String,
        engine: SearchEngine = SearchEngine.GOOGLE,
        packageName: String = "com.android.chrome",
        appLabel: String = "Chrome",
        deviceId: String = phone,
        at: String = "2026-11-20T05:05:00Z",
        lastAt: String = at,
        count: Int = 1,
        private: Boolean? = null,
    ) = SearchReportItem(
        query = query,
        engine = engine,
        `package` = packageName,
        appLabel = appLabel,
        deviceId = deviceId,
        at = at,
        lastAt = lastAt,
        count = count,
        private = private,
    )

    private fun report(
        deviceId: String? = null,
        devices: List<SearchReportDevice> = emptyList(),
        searches: List<SearchReportItem> = emptyList(),
    ) = SearchReport(
        kidId = "k1",
        period = ReportPeriod.DAY,
        from = "2026-11-20",
        to = "2026-11-20",
        today = "2026-11-20",
        deviceId = deviceId,
        devices = devices,
        searches = searches,
    )

    @Test
    fun `23 groupByDay splits newest first searches into Sydney days with Today and Yesterday`() {
        // 14:30Z on 19 Nov is 01:30 on 20 Nov in Sydney (+11), so it heads the 20 Nov day.
        val first = item("roblox promo codes", at = "2026-11-19T14:30:00Z")
        val second = item("volcano facts", at = "2026-11-19T12:00:00Z")
        val third = item("minecraft cheats", at = "2026-11-17T01:00:00Z")

        val days = groupByDay(listOf(first, second, third), sydney, today)

        assertEquals(3, days.size, "three local days")
        assertEquals(
            listOf(LocalDate.of(2026, 11, 20), LocalDate.of(2026, 11, 19), LocalDate.of(2026, 11, 17)),
            days.map { it.date },
            "the days are 20, 19 and 17 November",
        )
        assertEquals(
            listOf("Today", "Yesterday", "Tue 17 Nov"),
            days.map { it.label },
            "the headings are Today, Yesterday and Tue 17 Nov",
        )
        assertEquals(SearchDay(LocalDate.of(2026, 11, 20), "Today", listOf(first)), days[0], "20 Nov holds only the first search")
        assertEquals(
            SearchDay(LocalDate.of(2026, 11, 19), "Yesterday", listOf(second)),
            days[1],
            "19 Nov holds only the second search",
        )
        assertEquals(
            SearchDay(LocalDate.of(2026, 11, 17), "Tue 17 Nov", listOf(third)),
            days[2],
            "17 Nov holds only the third search",
        )
    }

    @Test
    fun `24 filterSearches matches any case and spaces at the ends, and keeps all for an empty text`() {
        val roblox = item("roblox promo codes")
        val volcano = item("volcano facts")
        val all = listOf(roblox, volcano)

        assertEquals(listOf(roblox), filterSearches(all, "  ROBLOX "), "\"  ROBLOX \" finds roblox promo codes only")
        assertEquals(all, filterSearches(all, ""), "an empty text returns all searches")
    }

    @Test
    fun `25 whereLine names the Google app, the YouTube app, and the engine in the browser`() {
        assertEquals(
            "Google app",
            whereLine(item("roblox promo codes", packageName = "com.google.android.googlequicksearchbox", appLabel = "Google")),
            "the Google app package is Google app",
        )
        assertEquals(
            "YouTube app",
            whereLine(item("minecraft cheats", engine = SearchEngine.YOUTUBE, packageName = "com.google.android.youtube", appLabel = "YouTube")),
            "the YouTube package is YouTube app",
        )
        assertEquals(
            "Google in Chrome",
            whereLine(item("volcano facts", engine = SearchEngine.GOOGLE, packageName = "com.android.chrome", appLabel = "Chrome")),
            "Google in the Chrome browser is Google in Chrome",
        )
        assertEquals(
            "Bing in Edge",
            whereLine(item("minecraft cheats", engine = SearchEngine.BING, packageName = "msedge.exe", appLabel = "Edge")),
            "Bing in the Edge browser is Bing in Edge",
        )
    }

    @Test
    fun `26 timeLine shows one time, or a span with an en dash when it was seen again`() {
        assertEquals(
            "4:05 pm",
            timeLine(item("volcano facts", at = "2026-11-20T05:05:00Z", lastAt = "2026-11-20T05:05:00Z"), sydney),
            "one time is 4:05 pm",
        )
        assertEquals(
            "4:05 pm \u2013 4:09 pm",
            timeLine(item("volcano facts", at = "2026-11-20T05:05:00Z", lastAt = "2026-11-20T05:09:00Z"), sydney),
            "seen again is 4:05 pm \u2013 4:09 pm",
        )
    }

    @Test
    fun `27 searchTotals counts the searches, the different words any case, and the private ones`() {
        val searches = listOf(
            item("Roblox", private = true),
            item("roblox ", private = null),
            item("volcano", private = false),
        )

        assertEquals(
            SearchTotals(searches = 3, different = 2, private = 1),
            searchTotals(searches),
            "3 searches, 2 different words, 1 in a private window",
        )
    }

    @Test
    fun `28 notRecording splits off from never and leaves removed devices out, and one device has no name`() {
        val a = device("a", "Phone A", capture = SearchCapture.OFF)
        val b = device("b", "Phone B", capture = SearchCapture.NEVER)
        val c = device("c", "Phone C", capture = SearchCapture.ON)
        val d = device("d", "Old phone", capture = SearchCapture.OFF, removedAt = "2026-11-04T09:00:00Z")

        val split = notRecording(report(devices = listOf(a, b, c, d)))

        assertEquals(listOf(a), split.off, "off holds only A (D is removed)")
        assertEquals(listOf(b), split.never, "never holds only B")
        assertNull(
            searchDeviceName(item("volcano facts", deviceId = "a"), report(devices = listOf(a))),
            "a report of one device shows no device name",
        )
    }
}
