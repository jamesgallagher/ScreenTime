package au.screentime.parent.kids

import au.screentime.core.model.api.ScheduleDay
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** The schedule's week overview and clock picker helpers (Claude's UI overhaul). */
class ScheduleOverviewTest {
    @Test
    fun theWeekOverviewSaysEachDayInOneGlance() {
        val day = ScheduleDay(1, 120, 90, "07:00", "20:30")
        assertEquals("Screens 2h · Phone 1h 30m", allowanceLine(day))
        assertEquals("7:00 am – 8:30 pm", hoursLine(day))
        assertEquals("Screens No time · Phone 15m", allowanceLine(day.copy(screensMin = 0, phoneMin = 15)))
        assertEquals("8:00 am – midnight", hoursLine(day.copy(wake = "08:00", bedtime = "24:00")))
    }

    @Test
    fun thePickerStartsOnTheSavedTime() {
        assertEquals(7 to 0, pickerStart("07:00"))
        assertEquals(20 to 30, pickerStart("20:30"))
        assertEquals(0 to 0, pickerStart("24:00"))
    }

    @Test
    fun aPickedTimeSnapsToTheQuarterHour() {
        assertEquals("20:30", pickedClock(20, 30, bedtime = true))
        assertEquals("20:30", pickedClock(20, 37, bedtime = true))
        assertEquals("20:45", pickedClock(20, 38, bedtime = true))
        assertEquals("07:00", pickedClock(6, 53, bedtime = false))
        assertEquals("24:00", pickedClock(0, 0, bedtime = true))
        assertEquals("24:00", pickedClock(23, 55, bedtime = true))
        assertEquals("23:45", pickedClock(23, 55, bedtime = false))
        assertEquals("00:00", pickedClock(0, 3, bedtime = false))
        assertEquals("00:15", pickedClock(0, 10, bedtime = true))
    }
}
