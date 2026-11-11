package au.screentime.parent.kids

import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** The Apps page's words and order (docs/SPEC.md §16.4). */
class AppsTest {
    private val sydney = ZoneId.of("Australia/Sydney")

    private fun device(
        installedAt: String = "2026-11-03T06:00:00Z",
        firstUsedAt: String? = null,
        removedAt: String? = null,
        name: String = "Pixel 7",
    ) = KidAppDevice(name, installedAt, firstUsedAt, removedAt)

    private fun app(
        label: String = "Game",
        source: AppSource = AppSource.PLAY,
        todaySeconds: Int = 0,
        devices: List<KidAppDevice> = listOf(device()),
        blockable: Boolean = true,
        rule: AppRule? = null,
        dailyMinutes: Int? = null,
    ) = KidApp("a.$label", label, source, todaySeconds, devices, blockable, rule, dailyMinutes)

    @Test
    fun saysWhereItCameFromWhenAndOnWhat() {
        assertEquals("From Play Store · 3 Nov on Pixel 7", installedLine(app(), sydney))
        assertEquals("Installed another way · 3 Nov on Pixel 7", installedLine(app(source = AppSource.OTHER), sydney))
    }

    @Test
    fun usesTheFamilyTimeZoneForTheDate() {
        // 2 Nov 20:00 UTC is already 3 Nov in Sydney.
        val line = installedLine(app(devices = listOf(device(installedAt = "2026-11-02T20:00:00Z"))), sydney)
        assertEquals("From Play Store · 3 Nov on Pixel 7", line)
    }

    @Test
    fun leavesTheDateOutForAPreinstalledAppAndNamesEveryDevice() {
        val two = listOf(device(), device(name = "XPPen tablet"))
        assertEquals("Came with Pixel 7 and XPPen tablet", installedLine(app(source = AppSource.PREINSTALLED, devices = two), sydney))
    }

    @Test
    fun leavesOutADeviceTheAppWasRemovedFrom() {
        val two = listOf(device(removedAt = "2026-11-04T00:00:00Z"), device(name = "XPPen tablet"))
        assertEquals("From Play Store · 3 Nov on XPPen tablet", installedLine(app(devices = two), sydney))
        assertFalse(isRemoved(app(devices = two)))
    }

    @Test
    fun givesFirstUseAsTheEarliestOnAnyDevice() {
        assertEquals("Never opened", firstUsedLine(app(), sydney))
        val two = listOf(device(firstUsedAt = "2026-11-05T00:00:00Z"), device(firstUsedAt = "2026-11-04T00:00:00Z", name = "Tablet"))
        assertEquals("First used 4 Nov", firstUsedLine(app(devices = two), sydney))
    }

    @Test
    fun showsTodaysTimeFromAWholeMinute() {
        assertNull(todayLine(app(todaySeconds = 59)))
        assertEquals("Today 12m", todayLine(app(todaySeconds = 720)))
    }

    @Test
    fun theChoiceIsAllowedWithoutARuleAndFollowsTheRule() {
        assertEquals(AppChoice.ALLOWED, appChoice(app()))
        assertEquals(AppChoice.ALLOWED, appChoice(app(rule = AppRule.ALLOWED)))
        assertEquals(AppChoice.BLOCKED, appChoice(app(rule = AppRule.BLOCKED)))
        assertEquals(AppChoice.WAITING, appChoice(app(rule = AppRule.HELD)))
    }

    @Test
    fun aLimitIsAChoiceOfItsOwn() {
        assertEquals(AppChoice.LIMIT, appChoice(app(rule = AppRule.LIMIT, dailyMinutes = 30)))
        assertEquals(AppChoice.FIXED, appChoice(app(blockable = false, rule = AppRule.LIMIT, dailyMinutes = 30)))
    }

    @Test
    fun showsTodaysTimeAgainstTheLimitFromNothing() {
        assertEquals("Today 0m of 30m", todayLine(app(rule = AppRule.LIMIT, dailyMinutes = 30)))
        assertEquals("Today 12m of 30m", todayLine(app(todaySeconds = 720, rule = AppRule.LIMIT, dailyMinutes = 30)))
    }

    @Test
    fun aLimitMovesInFiveMinuteStepsFromFiveMinutesToEightHours() {
        assertEquals(35, stepLimit(30, up = true))
        assertEquals(25, stepLimit(30, up = false))
        assertEquals(5, stepLimit(5, up = false))
        assertEquals(480, stepLimit(480, up = true))
    }

    @Test
    fun anAppThatCannotBeBlockedOffersNoChoice() {
        assertEquals(AppChoice.FIXED, appChoice(app(blockable = false)))
        assertEquals(AppChoice.FIXED, appChoice(app(blockable = false, rule = AppRule.BLOCKED)))
    }

    @Test
    fun putsAppsWaitingForAnAnswerFirst() {
        val newest = app("Newest", devices = listOf(device(installedAt = "2026-11-05T00:00:00Z")))
        val waiting = app("Waiting", devices = listOf(device(installedAt = "2026-11-01T00:00:00Z")), rule = AppRule.HELD)
        assertEquals(listOf("Waiting", "Newest"), sortApps(listOf(newest, waiting)).map { it.label })
    }

    @Test
    fun putsNewestInstallsFirstThenPreinstalledByNameThenRemoved() {
        val removed = app("Old", devices = listOf(device(removedAt = "2026-11-04T00:00:00Z")))
        val older = app("Older", devices = listOf(device(installedAt = "2026-11-01T00:00:00Z")))
        val newer = app("Newer", devices = listOf(device(installedAt = "2026-11-04T00:00:00Z")))
        val youtube = app("YouTube", source = AppSource.PREINSTALLED)
        val chrome = app("chrome", source = AppSource.PREINSTALLED)
        assertEquals(
            listOf("Newer", "Older", "chrome", "YouTube", "Old"),
            sortApps(listOf(removed, youtube, older, chrome, newer)).map { it.label },
        )
    }

    @Test
    fun isAlwaysAllowedOnlyWhereItIsAndWhenAllowedOrLimited() {
        val two = listOf(device(), device(name = "XPPen", removedAt = "2026-11-04T00:00:00Z"))
        assertEquals(listOf("Pixel 7"), alwaysAllowedDevices(app(devices = two)).map { it.deviceName })
        assertEquals(1, alwaysAllowedDevices(app(rule = AppRule.LIMIT, dailyMinutes = 30)).size)
        assertEquals(emptyList<KidAppDevice>(), alwaysAllowedDevices(app(rule = AppRule.BLOCKED)))
        assertEquals(emptyList<KidAppDevice>(), alwaysAllowedDevices(app(rule = AppRule.HELD)))
        assertEquals(emptyList<KidAppDevice>(), alwaysAllowedDevices(app(blockable = false)))
    }
}
