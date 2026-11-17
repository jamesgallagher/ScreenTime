package au.screentime.parent.today

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class BedtimeTest {
    private fun bed(
        scheduled: String = "20:30",
        tonight: String = scheduled,
        extendedBy: String? = null,
        earliest: String? = "20:45",
    ) = TonightBedtime(scheduled, tonight, extendedBy, earliest)

    @Test
    fun theRowReadsTheUsualBedtimeAnExtensionOrNone() {
        assertEquals("Bedtime 8:30 pm" to null, bedtimeLine(bed()))
        assertEquals(
            "Bedtime 9:30 pm tonight" to "Extended by Dad · usually 8:30 pm",
            bedtimeLine(bed(tonight = "21:30", extendedBy = "Dad")),
        )
        assertEquals("Bedtime midnight tonight", bedtimeLine(bed(tonight = "24:00", extendedBy = "Mum")).first)
        assertEquals("No bedtime today" to null, bedtimeLine(bed(scheduled = "24:00", earliest = null)))
    }

    @Test
    fun theRowOffersExtendChangeOrNothing() {
        assertEquals("Extend", bedtimeAction(bed()))
        assertEquals("Change", bedtimeAction(bed(tonight = "21:30", extendedBy = "Dad")))
        assertEquals("Change", bedtimeAction(bed(tonight = "21:30", extendedBy = "Dad", earliest = null)))
        assertNull(bedtimeAction(bed(earliest = null)))
        assertNull(bedtimeAction(bed(scheduled = "24:00", earliest = null)))
    }

    @Test
    fun choicesRunFromTheEarliestToMidnight() {
        assertEquals(listOf("23:00", "23:15", "23:30", "23:45", "24:00"), bedtimeChoices(bed(earliest = "23:00")))
        assertEquals(14, bedtimeChoices(bed()).size)
        assertEquals(emptyList<String>(), bedtimeChoices(bed(earliest = null)))
        assertEquals("21:00", bedtimeChoices(bed(tonight = "21:00", extendedBy = "Dad", earliest = "21:15")).first())
        assertEquals(listOf("21:00"), bedtimeChoices(bed(tonight = "21:00", extendedBy = "Dad", earliest = null)))
    }

    @Test
    fun theSheetStartsAnHourLaterOrOnTheExtension() {
        assertEquals("21:30", startChoice(bed()))
        assertEquals("22:00", startChoice(bed(earliest = "22:00")))
        assertEquals("24:00", startChoice(bed(scheduled = "23:30", earliest = "23:45")))
        assertEquals("22:15", startChoice(bed(tonight = "22:15", extendedBy = "Mum")))
        assertNull(startChoice(bed(earliest = null)))
    }

    @Test
    fun theStepperStopsAtItsEnds() {
        val choices = listOf("21:00", "21:15", "21:30")
        assertEquals("21:30", stepChoice(choices, "21:15", 1))
        assertEquals("21:30", stepChoice(choices, "21:30", 1))
        assertEquals("21:00", stepChoice(choices, "21:00", -1))
        assertEquals("21:00", stepChoice(choices, "20:00", 1))
    }

    @Test
    fun quickChoicesOnlyWhenTheyCanBePicked() {
        assertEquals(listOf("+30m" to "21:00", "+1h" to "21:30", "+2h" to "22:30"), quickChoices(bed()))
        assertEquals(listOf(null, "21:30", "22:30"), quickChoices(bed(earliest = "21:15")).map { it.second })
        assertEquals(listOf("23:30", "24:00", null), quickChoices(bed(scheduled = "23:00", earliest = "23:15")).map { it.second })
    }

    @Test
    fun wordsInTheSheet() {
        assertEquals("1h later than usual", laterText(bed(), "21:30"))
        assertEquals("1h 15m later than usual", laterText(bed(), "21:45"))
        assertEquals("9:30 pm", bedtimeClock("21:30"))
        assertEquals("Midnight", bedtimeClock("24:00"))
        assertEquals("Extend bedtime for Alex", bedtimeTitle("Alex", bed()))
        assertEquals("Change Alex's bedtime tonight", bedtimeTitle("Alex", bed(tonight = "21:30", extendedBy = "Dad")))
    }
}
