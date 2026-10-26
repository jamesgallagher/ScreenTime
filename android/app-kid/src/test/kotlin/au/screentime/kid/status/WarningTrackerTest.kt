package au.screentime.kid.status

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class WarningTrackerTest {
    /** A phone that locks at 8:30 pm with [leftSec] left; null means locked. Warnings at 15 and 5 minutes. */
    private fun left(leftSec: Long?) = KidStatus(
        kidName = "Alex",
        poolName = "Phone",
        deviceWord = "phone",
        lockReason = null,
        leftSec = leftSec ?: 0,
        usedSec = 0,
        lockAtMs = leftSec?.let { 1_000_000L },
        lockAtText = leftSec?.let { "8:30 pm" },
        reevaluateAtMs = 1_000_000L,
        bedtime = "8:30 pm",
        backAt = null,
        warn1Min = 15,
        warn2Min = 5,
        online = true,
        elapsedMs = 0,
    )

    private fun WarningTracker.run(vararg minutes: Double?): List<Warning?> =
        minutes.map { check(left(it?.let { m -> (m * 60).toLong() })) }

    @Test
    fun eachWarningShowsOnceOnTheWayDown() {
        val shown = WarningTracker().run(20.0, 15.0, 14.0, 10.0, 5.0, 4.0, 1.0, 0.0)

        assertEquals(listOf(null, Warning.FIRST, null, null, Warning.SECOND, null, null, null), shown)
    }

    @Test
    fun startingWithLittleTimeLeftShowsOnlyTheSecond() {
        val shown = WarningTracker().run(3.0, 2.0)

        assertEquals(listOf(Warning.SECOND, null), shown)
    }

    @Test
    fun moreTimeFromAParentLetsTheWarningsShowAgain() {
        val shown = WarningTracker().run(4.0, 25.0, 15.0, 5.0)

        assertEquals(listOf(Warning.SECOND, null, Warning.FIRST, Warning.SECOND), shown)
    }

    @Test
    fun lockedThenUnlockedWarnsAgain() {
        val shown = WarningTracker().run(4.0, null, 10.0)

        assertEquals(listOf(Warning.SECOND, null, Warning.FIRST), shown)
    }

    @Test
    fun theWordsSayHowLongAndWhen() {
        val s = left(600)

        assertEquals("15 minutes left", warningTitle(s, Warning.FIRST))
        assertEquals("This phone locks at 8:30 pm.", warningText(s, Warning.FIRST))
        assertEquals("5 minutes left", warningTitle(s, Warning.SECOND))
        assertEquals("This phone locks at 8:30 pm. Time to finish up.", warningText(s, Warning.SECOND))
        assertNull(WarningTracker().check(left(null)))
    }
}
