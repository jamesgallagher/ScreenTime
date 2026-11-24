package au.screentime.kid.usage

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class MissedUnlockTest {
    private fun on(at: Long) = LockEvent(LockKind.SCREEN_ON, at)
    private fun off(at: Long) = LockEvent(LockKind.SCREEN_OFF, at)
    private fun shown(at: Long) = LockEvent(LockKind.LOCK_SHOWN, at)
    private fun hidden(at: Long) = LockEvent(LockKind.LOCK_HIDDEN, at)
    private fun segment(start: Long, end: Long?, lastSeen: Long = end ?: start) = LocalSegment("s$start", start, end, lastSeen, false)

    // The Drawing Tablet on 25 Nov 2026, in seconds after 09:27:00: screen off 21, lock shown 22, screen on 37,
    // unlocked 40, then screen off 182, lock shown 187, screen on 218, unlocked 225.
    private val tablet = listOf(off(21_000), shown(22_000), on(37_000), hidden(40_000), off(182_000), shown(187_000), on(218_000), hidden(225_000))

    @Test
    fun theTabletsLastUnlockIsWhereTheStretchBegan() {
        assertEquals(225_000, unlockedSince(tablet))
    }

    @Test
    fun anEarlierStretchEndsAtItsScreenOff() {
        assertEquals(40_000, unlockedSince(tablet.take(4)))
        assertNull(unlockedSince(tablet.take(5)))
    }

    @Test
    fun theLockScreenUpMeansNotUnlocked() {
        assertNull(unlockedSince(tablet.take(7)))
        assertNull(unlockedSince(listOf(on(10), hidden(20), shown(30))))
    }

    @Test
    fun aScreenOnAloneDoesNotCountWhenTheLockScreenWasNeverSeenGoing() {
        assertNull(unlockedSince(listOf(on(10))))
        assertNull(unlockedSince(emptyList()))
    }

    @Test
    fun wokenWithinTheLockDelayTheScreenOnStartsIt() {
        // Unlocked, screen off, back on 3 s later before Android showed the lock screen: no lock events, still unlocked.
        assertEquals(53_000, unlockedSince(listOf(on(10_000), hidden(12_000), off(50_000), on(53_000))))
    }

    @Test
    fun aStretchStartsOnceEvenWithRepeatedEvents() {
        assertEquals(12_000, unlockedSince(listOf(on(10_000), hidden(12_000), on(15_000), hidden(16_000))))
    }

    @Test
    fun atScreenOffAndroidsOwnScreenOffIsLeftOut() {
        // Unlocked at 225 s; Android logged the screen off at 234.8 s and the lock screen at 236 s; the app hears at 235 s.
        val events = tablet + listOf(off(234_800), shown(236_000))
        assertEquals(225_000, unlockedBefore(events, offMs = 235_000))
    }

    @Test
    fun atScreenOffAnEarlierScreenOffStillEndsItsStretch() {
        // The stretch from 40 s ended at the screen off at 182 s, long before this screen off at 300 s.
        assertNull(unlockedBefore(tablet.take(6), offMs = 300_000))
    }

    @Test
    fun notBeforeIsTheLaterOfCountingAndTheLastSegment() {
        val recent = listOf(segment(1_000, 5_000), segment(6_000, 9_000))
        assertEquals(9_000, notBeforeMs(countingSinceMs = 2_000, recent = recent))
        assertEquals(20_000, notBeforeMs(countingSinceMs = 20_000, recent = recent))
        assertEquals(7_000, notBeforeMs(countingSinceMs = 7_000, recent = emptyList()))
    }

    @Test
    fun aSegmentLeftOpenCountsToWhereItWasLastSeen() {
        assertEquals(8_000, notBeforeMs(countingSinceMs = 0, recent = listOf(segment(1_000, null, lastSeen = 8_000))))
    }

    @Test
    fun aMissedStartGoesBackToTheUnlock() {
        // The tablet test: unlocked at 225 s, the service looks 30 s later.
        assertEquals(225_000, missedStartMs(sinceMs = 225_000, notBeforeMs = 182_000, nowMs = 255_000))
    }

    @Test
    fun aMissedStartNeverGoesBeforeCountingOrTheLastSegment() {
        // Parent mode ended at 240 s, after the unlock at 225 s: the time in parent mode never counts.
        assertEquals(240_000, missedStartMs(sinceMs = 225_000, notBeforeMs = 240_000, nowMs = 255_000))
    }

    @Test
    fun withoutAnUnlockFromAndroidItStartsNow() {
        assertEquals(255_000, missedStartMs(sinceMs = null, notBeforeMs = 182_000, nowMs = 255_000))
    }

    @Test
    fun aMissedStartIsNeverInTheFuture() {
        assertEquals(255_000, missedStartMs(sinceMs = 300_000, notBeforeMs = 182_000, nowMs = 255_000))
        assertEquals(255_000, missedStartMs(sinceMs = 225_000, notBeforeMs = 400_000, nowMs = 255_000))
    }

    @Test
    fun aQuickLookIsRecoveredAtScreenOff() {
        // Unlocked at 225 s, screen off 10 s later, before the service looked.
        assertEquals(225_000L to 235_000L, missedStretch(sinceMs = 225_000, notBeforeMs = 182_000, offMs = 235_000))
    }

    @Test
    fun aQuickLookStartsNoEarlierThanCounting() {
        assertEquals(230_000L to 235_000L, missedStretch(sinceMs = 225_000, notBeforeMs = 230_000, offMs = 235_000))
    }

    @Test
    fun noStretchWithoutAnUnlockOrWhenTooShort() {
        assertNull(missedStretch(sinceMs = null, notBeforeMs = 0, offMs = 235_000))
        assertNull(missedStretch(sinceMs = 234_500, notBeforeMs = 0, offMs = 235_000))
        assertNull(missedStretch(sinceMs = 225_000, notBeforeMs = 240_000, offMs = 235_000))
    }
}
