package au.screentime.kid.calls

import au.screentime.core.model.api.DeviceStateContactsItem
import au.screentime.core.model.api.DeviceStateParentsItem
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CallsTest {
    private val list = listOf(Callable("Dad", "+61412345678"), Callable("Grandma", "+61298765432"))

    @Test
    fun parentsWithAMobileComeFirstThenTheContacts() {
        val parents = listOf(
            DeviceStateParentsItem("p1", "Mum", "+61400000001"),
            DeviceStateParentsItem("p2", "Dad", null),
        )
        val contacts = listOf(DeviceStateContactsItem("Grandma", "+61298765432"), DeviceStateContactsItem("Sam", "+61400000002"))

        assertEquals(
            listOf(Callable("Mum", "+61400000001"), Callable("Grandma", "+61298765432"), Callable("Sam", "+61400000002")),
            callablesOf(parents, contacts),
        )
        assertEquals(emptyList<Callable>(), callablesOf(emptyList(), emptyList()))
    }

    @Test
    fun initialsAreTheFirstLettersOfTheFirstTwoWords() {
        assertEquals("D", initials("Dad"))
        assertEquals("GJ", initials("Grandma Jo"))
        assertEquals("AB", initials(" anna  bell smith "))
        assertEquals("?", initials("  "))
    }

    @Test
    fun theSameNumberInAnyUsualFormMatches() {
        assertTrue(sameNumber("+61412345678", "+61412345678"))
        assertTrue(sameNumber("+61 412 345 678", "+61412345678"))
        assertTrue(sameNumber("0412 345 678", "+61412345678"))
        assertTrue(sameNumber("(02) 9876-5432", "+61298765432"))
        assertTrue(sameNumber("+61412345678", "0412345678"))
        assertTrue(sameNumber("000", "000"))
    }

    @Test
    fun otherNumbersAndOddFormsNeverMatch() {
        assertFalse(sameNumber("0412345679", "+61412345678"))
        assertFalse(sameNumber("412345678", "+61412345678"))
        assertFalse(sameNumber("00", "000"))
        assertFalse(sameNumber("*31#0412345678", "+61412345678"))
        assertFalse(sameNumber("0412345678,1", "+61412345678"))
        assertFalse(sameNumber("+", "+"))
        assertFalse(sameNumber("", ""))
        // A short number is not the end of a long one.
        assertFalse(sameNumber("045678", "+61412345678"))
    }

    @Test
    fun whileBlockedOnlyTheListAndTheEmergencyNumberMayBeCalled() {
        assertTrue(mayCall("0412 345 678", list, "000"))
        assertTrue(mayCall("+61298765432", list, "000"))
        assertTrue(mayCall("000", list, "000"))
        assertFalse(mayCall("0400 111 222", list, "000"))
        assertFalse(mayCall("0400111222", emptyList(), "000"))
    }
}
