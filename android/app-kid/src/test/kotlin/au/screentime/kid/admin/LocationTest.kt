package au.screentime.kid.admin

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class LocationTest {
    private val all = listOf("fine", "coarse", "background")

    @Test
    fun takesBackOnlyWhatIsStillHeldBackgroundFirst() {
        assertEquals(listOf("background", "coarse", "fine"), locationToTakeBack(all, all.toSet()))
        // The Redmi on 13 Nov 2026: background and coarse already gone, fine still held.
        assertEquals(listOf("fine"), locationToTakeBack(all, setOf("fine")))
        assertEquals(emptyList<String>(), locationToTakeBack(all, emptySet()))
    }
}
