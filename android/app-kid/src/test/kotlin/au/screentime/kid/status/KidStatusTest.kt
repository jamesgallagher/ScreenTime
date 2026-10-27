package au.screentime.kid.status

import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.DeviceStateMessagePresetsItem
import au.screentime.core.model.api.DeviceStateParentsItem
import au.screentime.core.model.api.DeviceStatePendingRequest
import au.screentime.core.time.LockReason
import au.screentime.core.time.evaluate
import au.screentime.kid.usage.state
import au.screentime.kid.usage.todayInput
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class KidStatusTest {
    /** Monday 26 October 2026 in Sydney at [time]: 60 min of Phone, 120 of Screens, 07:00 to 20:30. */
    private fun at(time: String): Long =
        LocalDateTime.parse("2026-10-26T$time").atZone(ZoneId.of("Australia/Sydney")).toInstant().toEpochMilli()

    private fun statusAt(time: String, state: DeviceState = state(), elapsedMs: Long = 0): KidStatus {
        val now = at(time)
        return kidStatus(state, evaluate(todayInput(state, emptyList(), now)), now, online = true, elapsedMs = elapsedMs)
    }

    private fun used(from: String, to: String) =
        """{"id": "s1", "deviceId": "d2", "startedAt": "2026-10-26T$from:00+11:00", "endedAt": "2026-10-26T$to:00+11:00"}"""

    @Test
    fun plentyOfTimeShowsTheTimeLeftAndBedtime() {
        val s = statusAt("10:00")

        assertEquals("Phone · 1h left", s.title())
        assertEquals("Bedtime 8:30 pm", s.subline())
        assertEquals("11:00 am", s.lockAtText)
        assertEquals(3600L, s.leftSec)
        assertEquals(Level.PLENTY, s.level())
        assertEquals(1f, s.ringFraction())
        assertEquals("Alex", s.kidName)
        assertEquals("phone", s.deviceWord)
    }

    @Test
    fun tenMinutesLeftIsLowAndTheRingShowsWhatIsLeft() {
        val s = statusAt("10:50", state(segments = used("10:00", "10:50")))

        assertEquals(600L, s.leftSec)
        assertEquals("Phone · 10m left", s.title())
        assertEquals(Level.LOW, s.level())
        assertEquals(Level.CRITICAL, s.level(300))
        assertEquals(1f / 6, s.ringFraction(), 0.0001f)
        assertEquals("10m", s.ringText())
        assertEquals("<1m", s.ringText(59))
    }

    @Test
    fun bedtimeCutsTheTimeLeftShort() {
        val s = statusAt("20:20", state(pool = "screens"))

        assertEquals(600L, s.leftSec)
        assertEquals("Screens · 10m left", s.title())
        assertEquals("8:30 pm", s.lockAtText)
        assertEquals(Level.LOW, s.level())
    }

    @Test
    fun lockedStatesSayWhyAndWhenItIsBack() {
        val bedtime = statusAt("21:00")
        assertEquals(LockReason.BEDTIME, bedtime.lockReason)
        assertEquals("It's bedtime", bedtime.title())
        assertEquals("Phone is back at 7:00 am", bedtime.subline())
        assertEquals(0L, bedtime.leftSec)
        assertNull(bedtime.lockAtMs)
        assertEquals(Level.LOCKED, bedtime.level())
        assertEquals(0f, bedtime.ringFraction())

        val early = statusAt("06:00")
        assertEquals("Not yet, it's early", early.title())
        assertEquals("Phone is back at 7:00 am", early.subline())

        val out = statusAt("09:30", state(segments = used("08:00", "09:00")))
        assertEquals("Out of Phone time", out.title())
        assertEquals("New time tomorrow", out.subline())
    }

    @Test
    fun theScreenCountsDownFromTheElapsedClock() {
        val s = statusAt("10:00", elapsedMs = 5_000)

        assertEquals(3600L - 90, s.leftSecAt(95_000))
        assertEquals(0L, s.leftSecAt(5_000 + 4_000_000))
    }

    @Test
    fun clockTextIsTwelveHour() {
        assertEquals("12:05 am", clockText(LocalTime.parse("00:05")))
        assertEquals("12:00 pm", clockText(LocalTime.parse("12:00")))
        assertEquals("8:30 pm", clockText(LocalTime.parse("20:30")))
        assertEquals("7:00 am", clockText(LocalTime.parse("07:00")))
    }

    @Test
    fun theNextCheckIsTheNextWarningOrTheLockAndAtLeastEveryMinute() {
        // Locks at 11:00: the next event (warn 1 at 10:45) is far away, so one minute.
        assertEquals(at("10:01"), nextCheckAtMs(statusAt("10:00"), at("10:00")))
        // 10:44:30: warn 1 at 10:45.
        val now = at("10:44:30")
        assertEquals(at("10:45"), nextCheckAtMs(statusAt("10:00"), now))
        // 10:59:30: the lock at 11:00.
        assertEquals(at("11:00"), nextCheckAtMs(statusAt("10:00"), at("10:59:30")))
    }

    @Test
    fun theParentsPresetsAndAWaitingRequestComeFromTheSnapshot() {
        val family = state().copy(
            parents = listOf(DeviceStateParentsItem("p1", "Mum", null), DeviceStateParentsItem("p2", "Dad", "+61400000000")),
            messagePresets = listOf(DeviceStateMessagePresetsItem("m1", "Can you call me?")),
            pendingRequest = DeviceStatePendingRequest("r1", 30, "2026-10-26T00:00:00Z"),
        )

        val s = statusAt("10:00", family)

        assertEquals(listOf("Mum", "Dad"), s.parentNames)
        assertEquals(listOf(Preset("m1", "Can you call me?")), s.presets)
        assertEquals(30, s.pendingMinutes)
        assertEquals("Mum or Dad", s.parentsOr)
        assertEquals("Mum and Dad", s.parentsAnd)
        assertNull(statusAt("10:00").pendingMinutes)
    }

    @Test
    fun namesAndMinutesReadTheKidsWay() {
        assertEquals("your parents", parentsText(emptyList(), "or"))
        assertEquals("Dad", parentsText(listOf("Dad"), "or"))
        assertEquals("Mum, Dad or Nan", parentsText(listOf("Mum", "Dad", "Nan"), "or"))
        assertEquals("15 min", minutesText(15))
        assertEquals("45 min", minutesText(45))
        assertEquals("1h", minutesText(60))
        assertEquals("1h 30m", minutesText(90))
    }
}
