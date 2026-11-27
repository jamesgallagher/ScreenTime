package au.screentime.parent.reports

import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.ReportPeriod
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.LocalDate

/*
 * CARD-075 acceptance criteria 1 to 6 (docs/cards/CARD-075-parent-reports.md section 6, "Periods"): Claude's period
 * helpers in Reports.kt on the card's fixed fixtures. "Today" is 2026-11-20 (a Friday) unless a case says otherwise,
 * and no helper here takes a zone. Expected values are the card's, character for character (the dash is U+2013).
 */
class ReportsPeriodsTest {
    private val today = date("2026-11-20")

    private fun date(text: String): LocalDate = LocalDate.parse(text)

    @Test
    fun `1 periodRange is the day, Monday to Sunday, or the calendar month`() {
        assertEquals(
            date("2026-11-16") to date("2026-11-22"),
            periodRange(ReportPeriod.WEEK, date("2026-11-16")),
            "WEEK from its Monday 2026-11-16 is 2026-11-16 … 2026-11-22",
        )
        assertEquals(
            date("2026-11-16") to date("2026-11-22"),
            periodRange(ReportPeriod.WEEK, date("2026-11-22")),
            "WEEK from its Sunday 2026-11-22 is 2026-11-16 … 2026-11-22",
        )
        assertEquals(
            date("2026-02-01") to date("2026-02-28"),
            periodRange(ReportPeriod.MONTH, date("2026-02-10")),
            "MONTH holding 2026-02-10 is 2026-02-01 … 2026-02-28",
        )
        assertEquals(
            date("2026-11-20") to date("2026-11-20"),
            periodRange(ReportPeriod.DAY, date("2026-11-20")),
            "DAY 2026-11-20 is 2026-11-20 … 2026-11-20",
        )
    }

    @Test
    fun `2 shiftPeriod steps to the first day of the period before or after`() {
        assertEquals(
            date("2026-11-09"),
            shiftPeriod(ReportPeriod.WEEK, date("2026-11-20"), -1),
            "WEEK 2026-11-20 back one is 2026-11-09",
        )
        assertEquals(
            date("2026-11-23"),
            shiftPeriod(ReportPeriod.WEEK, date("2026-11-20"), 1),
            "WEEK 2026-11-20 forward one is 2026-11-23",
        )
        assertEquals(
            date("2026-02-01"),
            shiftPeriod(ReportPeriod.MONTH, date("2026-03-31"), -1),
            "MONTH 2026-03-31 back one is 2026-02-01",
        )
        assertEquals(
            date("2025-12-31"),
            shiftPeriod(ReportPeriod.DAY, date("2026-01-01"), -1),
            "DAY 2026-01-01 back one is 2025-12-31",
        )
    }

    @Test
    fun `3 isCurrentPeriod is true only while today is inside the period`() {
        assertTrue(
            isCurrentPeriod(ReportPeriod.WEEK, date("2026-11-16"), date("2026-11-22")),
            "WEEK 2026-11-16 holds today 2026-11-22, its Sunday",
        )
        assertFalse(
            isCurrentPeriod(ReportPeriod.WEEK, date("2026-11-15"), date("2026-11-22")),
            "WEEK 2026-11-15 ends 2026-11-15, before today 2026-11-22",
        )
        assertTrue(
            isCurrentPeriod(ReportPeriod.MONTH, date("2026-11-01"), date("2026-11-30")),
            "MONTH 2026-11-01 holds today 2026-11-30, its last day",
        )
    }

    @Test
    fun `4 periodLabel says Today, Yesterday, This week, This month, or the dates`() {
        assertEquals("Today", periodLabel(ReportPeriod.DAY, date("2026-11-20"), today), "DAY 2026-11-20 is today")
        assertEquals("Yesterday", periodLabel(ReportPeriod.DAY, date("2026-11-19"), today), "DAY 2026-11-19 is yesterday")
        assertEquals("Wed 18 Nov", periodLabel(ReportPeriod.DAY, date("2026-11-18"), today), "DAY 2026-11-18, this year")
        assertEquals(
            "Wed 31 Dec 2025",
            periodLabel(ReportPeriod.DAY, date("2025-12-31"), today),
            "DAY 2025-12-31, another year",
        )
        assertEquals("This week", periodLabel(ReportPeriod.WEEK, date("2026-11-18"), today), "WEEK 2026-11-18 is this week")
        assertEquals("9 – 15 Nov", periodLabel(ReportPeriod.WEEK, date("2026-11-10"), today), "WEEK 2026-11-10, one month")
        assertEquals(
            "26 Oct – 1 Nov",
            periodLabel(ReportPeriod.WEEK, date("2026-11-01"), today),
            "WEEK 2026-11-01, two months",
        )
        assertEquals(
            "29 Dec – 4 Jan 2026",
            periodLabel(ReportPeriod.WEEK, date("2025-12-31"), today),
            "WEEK 2025-12-31, another year",
        )
        assertEquals(
            "This month",
            periodLabel(ReportPeriod.MONTH, date("2026-11-03"), today),
            "MONTH 2026-11-03 is this month",
        )
        assertEquals(
            "October 2026",
            periodLabel(ReportPeriod.MONTH, date("2026-10-15"), today),
            "MONTH 2026-10-15, another month",
        )
    }

    @Test
    fun `5 periodDates gives the full dates under the label`() {
        assertEquals(
            "Friday 20 November 2026",
            periodDates(ReportPeriod.DAY, date("2026-11-20")),
            "DAY 2026-11-20",
        )
        assertEquals(
            "Mon 16 Nov – Sun 22 Nov 2026",
            periodDates(ReportPeriod.WEEK, date("2026-11-20")),
            "WEEK 2026-11-20",
        )
        assertEquals("1 – 28 Feb 2026", periodDates(ReportPeriod.MONTH, date("2026-02-10")), "MONTH 2026-02-10")
    }

    @Test
    fun `6 namesList joins names the way a sentence does`() {
        assertEquals("", namesList(emptyList()), "no names")
        assertEquals("Redmi", namesList(listOf("Redmi")), "one name")
        assertEquals("Redmi and Desk PC", namesList(listOf("Redmi", "Desk PC")), "two names")
        assertEquals("Redmi, Tablet and Desk PC", namesList(listOf("Redmi", "Tablet", "Desk PC")), "three names")
    }

    @Test
    fun `6 chipDevices has no chips for one device and every chip for two`() {
        val pixel = ChipDevice("d-pixel", "Pixel", DeviceForm.PHONE, false)
        val desk = ChipDevice("d-desk", "Desk PC", DeviceForm.PC, false)
        assertEquals(
            emptyList<ChipDevice>(),
            chipDevices(listOf(pixel)),
            "one device: All devices is the only choice, so no chips",
        )
        assertEquals(listOf(pixel, desk), chipDevices(listOf(pixel, desk)), "two devices: both chips, in order")
    }
}
