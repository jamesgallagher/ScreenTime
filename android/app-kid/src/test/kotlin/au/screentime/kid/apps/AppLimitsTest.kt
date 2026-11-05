package au.screentime.kid.apps

import au.screentime.core.model.api.AppRuleMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** Adding up app time and daily limits (docs/SPEC.md §12.4). */
class AppLimitsTest {
    private fun resumed(name: String, at: Long) = UsageEvent(UsageKind.RESUMED, name, at * 1000)
    private fun paused(name: String, at: Long) = UsageEvent(UsageKind.PAUSED, name, at * 1000)
    private fun off(at: Long) = UsageEvent(UsageKind.SCREEN_OFF, "android", at * 1000)

    private fun usage(vararg events: UsageEvent, from: Long = 0, to: Long = 1000, notCounted: List<Span> = emptyList()) =
        appUsage(events.toList(), from * 1000, to * 1000, notCounted)

    @Test
    fun resumedToPausedCounts() {
        val u = usage(resumed("a", 10), paused("a", 70), resumed("b", 70), paused("b", 100))
        assertEquals(mapOf("a" to 60L, "b" to 30L), u.seconds)
        assertEquals(emptySet<String>(), u.inFront)
    }

    @Test
    fun severalVisitsAddUp() {
        assertEquals(mapOf("a" to 30L), usage(resumed("a", 0), paused("a", 10), resumed("a", 50), paused("a", 70)).seconds)
    }

    @Test
    fun screenOffEndsWhateverIsOpen() {
        val u = usage(resumed("a", 10), off(40), paused("a", 41))
        assertEquals(mapOf("a" to 30L), u.seconds)
        assertEquals(emptySet<String>(), u.inFront)
    }

    @Test
    fun anAppStillOpenCountsUpToNowAndIsInFront() {
        val u = usage(resumed("a", 900), to = 1000)
        assertEquals(mapOf("a" to 100L), u.seconds)
        assertEquals(setOf("a"), u.inFront)
    }

    @Test
    fun anAppInFrontAtMidnightCountsFromMidnight() {
        assertEquals(mapOf("a" to 40L), usage(paused("a", 140), from = 100, to = 200).seconds)
    }

    @Test
    fun yesterdaysEventsAreLeftOut() {
        assertEquals(emptyMap<String, Long>(), usage(resumed("a", 10), paused("a", 20), from = 100, to = 200).seconds)
    }

    @Test
    fun parentModeDoesNotCount() {
        val spans = listOf(Span(20_000, 50_000))
        assertEquals(mapOf("a" to 70L), usage(resumed("a", 0), paused("a", 100), notCounted = spans).seconds)
        assertEquals(mapOf("a" to 0L), usage(resumed("a", 30), paused("a", 40), notCounted = spans).seconds)
    }

    @Test
    fun aLimitLessBothDevices() {
        val limits = appLimits(mapOf("a" to 30), mapOf("a" to 600L), mapOf("a" to 300L), mapOf("a" to "App"))
        assertEquals(listOf(AppLimitNow("a", "App", 900)), limits)
    }

    @Test
    fun aLimitForAnAppNotOnThisDeviceIsLeftOut() {
        assertEquals(emptyList<AppLimitNow>(), appLimits(mapOf("a" to 30), emptyMap(), emptyMap(), emptyMap()))
    }

    @Test
    fun limitsAreInNameOrder() {
        val labels = mapOf("a" to "Zebra", "b" to "apple")
        assertEquals(listOf("apple", "Zebra"), appLimits(mapOf("a" to 5, "b" to 5), emptyMap(), emptyMap(), labels).map { it.label })
    }

    @Test
    fun aLimitUsedUpIsBlocked() {
        val wanted = wantedBlocks(mapOf("a" to AppRuleMode.LIMIT), emptySet(), emptySet(), parentMode = false, limitsOver = setOf("a"))
        assertEquals(setOf("a"), wanted)
    }

    @Test
    fun aLimitNotUsedUpIsNotBlocked() {
        assertEquals(emptySet<String>(), wantedBlocks(mapOf("a" to AppRuleMode.LIMIT), emptySet(), emptySet(), parentMode = false))
    }

    @Test
    fun parentModeAndNeverBlockedBeatALimit() {
        assertEquals(emptySet<String>(), wantedBlocks(emptyMap(), emptySet(), emptySet(), parentMode = true, limitsOver = setOf("a")))
        assertEquals(emptySet<String>(), wantedBlocks(emptyMap(), emptySet(), setOf("a"), parentMode = false, limitsOver = setOf("a", "com.google.android.gms")))
    }

    private fun limit(left: Long) = AppLimitNow("a", "YouTube", left)

    @Test
    fun theWarningComesOnceAtFiveMinutes() {
        assertEquals(emptyList<String>(), limitNews(listOf(limit(301)), setOf("a"), emptySet(), emptySet()).messages)
        val first = limitNews(listOf(limit(300)), setOf("a"), emptySet(), emptySet())
        assertEquals(listOf("5 minutes of YouTube left"), first.messages)
        assertEquals(emptyList<String>(), limitNews(listOf(limit(200)), setOf("a"), first.warned, first.done).messages)
    }

    @Test
    fun theLastWordComesOnce() {
        val first = limitNews(listOf(limit(0)), setOf("a"), setOf("a"), emptySet())
        assertEquals(listOf("That's all your YouTube for today"), first.messages)
        assertEquals(emptyList<String>(), limitNews(listOf(limit(-5)), setOf("a"), first.warned, first.done).messages)
    }

    @Test
    fun anAppNotInFrontIsNotNews() {
        assertEquals(emptyList<String>(), limitNews(listOf(limit(100)), emptySet(), emptySet(), emptySet()).messages)
        assertEquals(emptyList<String>(), limitNews(listOf(limit(0)), emptySet(), emptySet(), emptySet()).messages)
    }

    @Test
    fun moreTimeLetsTheNewsComeAgain() {
        val after = limitNews(listOf(limit(900)), setOf("a"), setOf("a"), setOf("a"))
        assertEquals(emptySet<String>(), after.warned)
        assertEquals(emptySet<String>(), after.done)
    }

    @Test
    fun theNextLookIsWhenAnAppInFrontRunsOut() {
        assertEquals(30_000L, nextLimitMs(listOf(limit(30)), setOf("a")))
        assertNull(nextLimitMs(listOf(limit(30)), emptySet()))
        assertNull(nextLimitMs(listOf(limit(0)), setOf("a")))
    }

    @Test
    fun spansSurviveBeingSaved() {
        val spans = listOf(Span(1, 2), Span(3, 4))
        assertEquals(spans, parseSpans(formatSpans(spans)))
        assertEquals(emptyList<Span>(), parseSpans(""))
        assertEquals(listOf(Span(5, 6)), parseSpans("rubbish,5-6"))
    }
}
