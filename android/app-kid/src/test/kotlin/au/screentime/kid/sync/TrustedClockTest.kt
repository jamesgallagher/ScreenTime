package au.screentime.kid.sync

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TrustedClockTest {
    private class MemoryClockStore : ClockStore {
        override var anchor: ClockAnchor? = null
        override var lastTrustedMs: Long = 0
    }

    private val store = MemoryClockStore()
    private var elapsed = 0L
    private var wall = 0L
    private var boot = 1
    private val clock = TrustedClock(store, { elapsed }, { wall }, { boot })

    @Test
    fun beforeTheServerAnswersItIsTheWallClockButNeverGoesBack() {
        wall = 50_000
        assertEquals(50_000, clock.nowMs())

        wall = 20_000
        assertEquals(50_000, clock.nowMs())
        assertFalse(clock.isAnchored)
    }

    @Test
    fun afterTheServerAnswersChangingTheWallClockDoesNothing() {
        elapsed = 1_000
        clock.onServerTime(10_000_000)

        elapsed = 61_000
        wall = 999_999_999

        assertEquals(10_060_000, clock.nowMs())
        assertTrue(clock.isAnchored)
    }

    @Test
    fun afterARebootItIsTheWallClockButNotBeforeTheLastTrustedTime() {
        elapsed = 1_000
        clock.onServerTime(10_000_000)
        elapsed = 61_000
        clock.nowMs()

        boot = 2
        elapsed = 5_000
        wall = 9_000_000

        assertFalse(clock.isAnchored)
        assertEquals(10_060_000, clock.nowMs())
    }

    @Test
    fun theServerWinsEvenWhenThePhoneClockWasAhead() {
        wall = 90_000_000
        assertEquals(90_000_000, clock.nowMs())

        clock.onServerTime(10_000_000)

        assertEquals(10_000_000, clock.nowMs())
    }
}
