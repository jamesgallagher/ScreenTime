package au.screentime.kid.apps

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AlwaysAllowedTest {
    private fun resumed(p: String, at: Long) = UsageEvent(UsageKind.RESUMED, p, at)
    private fun paused(p: String, at: Long) = UsageEvent(UsageKind.PAUSED, p, at)
    private fun off(at: Long) = UsageEvent(UsageKind.SCREEN_OFF, "android", at)

    @Test
    fun onlyInstalledAppsThatAreNotBlockedOrPartOfTheDeviceRun() {
        val free = freeApps(
            alwaysAllowed = listOf("com.duolingo", "clock", "a.game", "gone", "com.android.settings", "launcher"),
            installed = setOf("com.duolingo", "clock", "a.game", "com.android.settings", "launcher"),
            blocked = setOf("a.game"),
            protected = setOf("launcher"),
        )
        assertEquals(setOf("com.duolingo", "clock"), free)
    }

    @Test
    fun nothingInFrontWhenNoAlwaysAllowedAppWasUsed() {
        assertEquals(FreeFront(null, null), freeFront(listOf(resumed("a.game", 10), paused("a.game", 20)), setOf("clock")))
    }

    @Test
    fun anAppStillInFrontGivesWhenItCameToTheFront() {
        val events = listOf(resumed("a.game", 10), paused("a.game", 20), resumed("clock", 21))
        assertEquals(FreeFront(21, null), freeFront(events, setOf("clock")))
    }

    @Test
    fun leavingItGivesWhenItEnded() {
        val events = listOf(resumed("clock", 21), paused("clock", 50), resumed("a.game", 51))
        assertEquals(FreeFront(null, 50), freeFront(events, setOf("clock")))
    }

    @Test
    fun goingFromOneAlwaysAllowedAppToAnotherIsOneStretchOnlyIfTheyOverlap() {
        val overlap = listOf(resumed("clock", 10), resumed("com.duolingo", 30), paused("clock", 31))
        assertEquals(FreeFront(30, null), freeFront(overlap, setOf("clock", "com.duolingo")))
        val apart = listOf(resumed("clock", 10), paused("clock", 30), resumed("com.duolingo", 31))
        assertEquals(FreeFront(31, 30), freeFront(apart, setOf("clock", "com.duolingo")))
    }

    @Test
    fun theScreenGoingOffEndsIt() {
        assertEquals(FreeFront(null, 40), freeFront(listOf(resumed("clock", 10), off(40)), setOf("clock")))
    }

    @Test
    fun aPauseWithNoResumeIsIgnored() {
        assertEquals(FreeFront(null, null), freeFront(listOf(paused("clock", 5)), setOf("clock")))
    }

    @Test
    fun theCutIsNeverInTheFutureNorBeforeTheSegment() {
        assertEquals(500L, cutAt(500, nowMs = 900, notBeforeMs = 100))
        assertEquals(900L, cutAt(null, nowMs = 900, notBeforeMs = 100))
        assertEquals(900L, cutAt(1_000, nowMs = 900, notBeforeMs = 100))
        assertEquals(100L, cutAt(50, nowMs = 900, notBeforeMs = 100))
    }
}
