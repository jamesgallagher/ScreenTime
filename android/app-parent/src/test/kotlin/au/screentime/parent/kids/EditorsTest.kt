package au.screentime.parent.kids

import au.screentime.core.model.api.KidContactsPut
import au.screentime.core.model.api.KidContactsPutContactsItem
import au.screentime.core.model.api.Schedule
import au.screentime.core.model.api.ScheduleDay
import au.screentime.core.model.api.ScheduleInput
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** CARD-043b: the schedule and always-callable editors' pure helpers. Copied verbatim from the card. */
class EditorsTest {
    private fun day(weekday: Int, screens: Int = 120, phone: Int = 60, wake: String = "07:00", bedtime: String = "20:30") =
        ScheduleDay(weekday, screens, phone, wake, bedtime)

    private val week = (1..7).map { day(it, screens = it * 15) }

    @Test
    fun clockWords() {
        assertEquals("12:00 am", formatClock("00:00"))
        assertEquals("7:00 am", formatClock("07:00"))
        assertEquals("12:30 pm", formatClock("12:30"))
        assertEquals("8:45 pm", formatClock("20:45"))
        assertEquals("midnight", formatClock("24:00"))
    }

    @Test
    fun timeOptionsRunInQuarterHours() {
        val wake = wakeOptions("07:00")
        assertEquals(96, wake.size)
        assertEquals(Option("00:00", "12:00 am"), wake.first())
        assertEquals(Option("23:45", "11:45 pm"), wake.last())
        val bed = bedtimeOptions("20:30")
        assertEquals(96, bed.size)
        assertEquals(Option("00:15", "12:15 am"), bed.first())
        assertEquals(Option("24:00", "midnight"), bed.last())
        // A saved value off the grid is kept, in order.
        val odd = bedtimeOptions("20:40")
        assertEquals(97, odd.size)
        assertEquals(listOf("20:30", "20:40", "20:45"), odd.map { it.value }.filter { it.startsWith("20:") && it > "20:15" })
    }

    @Test
    fun allowances() {
        assertEquals("No time", formatAllowance(0))
        assertEquals("15m", formatAllowance(15))
        assertEquals("2h", formatAllowance(120))
        assertEquals("1h 30m", formatAllowance(90))
        val options = allowanceOptions(60)
        assertEquals(49, options.size)
        assertEquals(Option(0, "No time"), options.first())
        assertEquals(Option(720, "12h"), options.last())
        // Longer than 12 hours (the API allows 24) is kept at the end.
        assertEquals(Option(900, "15h"), allowanceOptions(900).last())
        assertEquals(50, allowanceOptions(900).size)
    }

    @Test
    fun warningOptions() {
        assertEquals(listOf("10 min before", "15 min before", "20 min before", "30 min before", "45 min before", "60 min before"),
            warnOptions(WARN1_OPTIONS, 15).map { it.label })
        assertEquals(listOf(1, 2, 3, 4, 5, 10), warnOptions(WARN2_OPTIONS, 4).map { it.value })
    }

    @Test
    fun steppersMoveOneOptionAndStopAtTheEnds() {
        val options = allowanceOptions(120)
        assertEquals(135, step(options, 120, 1))
        assertEquals(105, step(options, 120, -1))
        assertEquals(0, step(options, 0, -1))
        assertEquals(720, step(options, 720, 1))
        assertEquals("20:45", step(bedtimeOptions("20:30"), "20:30", 1))
        assertEquals("20:30", step(bedtimeOptions("20:40"), "20:40", -1))
        assertEquals(10, step(warnOptions(WARN1_OPTIONS, 15), 15, -1))
    }

    @Test
    fun copyButtons() {
        val weekdays = copyMondayToWeekdays(week)
        assertEquals(listOf(15, 15, 15, 15, 15, 90, 105), weekdays.map { it.screensMin })
        assertEquals((1..7).toList(), weekdays.map { it.weekday })
        val weekend = copySaturdayToWeekend(week)
        assertEquals(listOf(15, 30, 45, 60, 75, 90, 90), weekend.map { it.screensMin })
        assertEquals(7, weekend.last().weekday)
    }

    @Test
    fun scheduleRules() {
        assertNull(dayError(day(1)))
        assertEquals("Bedtime must be after wake-up.", dayError(day(1, wake = "21:00", bedtime = "20:30")))
        assertEquals("Bedtime must be after wake-up.", dayError(day(1, wake = "20:30", bedtime = "20:30")))
        assertNull(dayError(day(1, wake = "07:00", bedtime = "24:00")))
        assertNull(warningsError(15, 5))
        assertEquals("The first warning must come before the second.", warningsError(10, 10))
        assertTrue(scheduleValid(ScheduleInput(15, 5, week)))
        assertFalse(scheduleValid(ScheduleInput(5, 10, week)))
        assertFalse(scheduleValid(ScheduleInput(15, 5, week.map { if (it.weekday == 3) it.copy(wake = "23:00") else it })))
        assertEquals(ScheduleInput(15, 5, week), inputOf(Schedule(4, 15, 5, week)))
    }

    @Test
    fun phoneNumbers() {
        assertEquals("+61412345678", normalisePhone("0412 345 678"))
        assertEquals("+61412345678", normalisePhone("(04) 1234-5678"))
        assertEquals("+61298765432", normalisePhone("02 9876 5432"))
        assertEquals("+447700900123", normalisePhone("+44 7700 900123"))
        assertNull(normalisePhone(""))
        assertNull(normalisePhone("12345"))
        assertNull(normalisePhone("0412 345 67"))
        assertNull(normalisePhone("+0412345678"))
    }

    @Test
    fun contactRows() {
        val mum = ContactRow("  Mum ", "0412 345 678")
        assertNull(labelError(mum))
        assertNull(phoneError(mum))
        assertEquals("Type a name.", labelError(ContactRow("  ", "0412345678")))
        assertEquals("40 letters at most.", labelError(ContactRow("x".repeat(41), "0412345678")))
        assertEquals("Type a number like 0412 345 678 or +61412345678.", phoneError(ContactRow("Dad", "123")))
        assertTrue(contactsValid(listOf(mum)))
        assertTrue(contactsValid(emptyList()))
        assertFalse(contactsValid(listOf(mum, ContactRow("Dad", ""))))
        assertFalse(contactsValid(List(11) { mum }))
        assertEquals(KidContactsPut(listOf(KidContactsPutContactsItem("Mum", "+61412345678"))), contactsBody(listOf(mum)))
        assertEquals("Add a number", addNumberText(9))
        assertEquals("10 numbers at most", addNumberText(10))
        assertEquals("Remove Mum", removeLabel(mum))
        assertEquals("Remove this number", removeLabel(ContactRow("", "")))
    }
}
