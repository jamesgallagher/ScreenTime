package au.screentime.kid.usage

import au.screentime.core.time.evaluate
import java.time.Instant
import java.time.LocalDate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

class TodayInputTest {
    /** Monday 26 October 2026, 10:00 in Sydney (UTC+11). */
    private val now = ms("2026-10-25T23:00:00Z")

    private fun ms(text: String) = Instant.parse(text).toEpochMilli()

    @Test
    fun theFamilyDayAndThePoolPickTheAllowance() {
        val phone = todayInput(state(pool = "phone"), emptyList(), now)
        val screens = todayInput(state(pool = "screens"), emptyList(), now)

        assertEquals(LocalDate.parse("2026-10-26"), phone.date)
        assertEquals(60, phone.day.allowanceMin)
        assertEquals(120, screens.day.allowanceMin)
        assertEquals("07:00", phone.day.wake)
        assertEquals("20:30", phone.day.bedtime)
    }

    @Test
    fun ownSegmentsReplaceTheServerCopiesAndOthersStay() {
        val segments = """
            {"id": "mine", "deviceId": "d1", "startedAt": "2026-10-26T09:00:00+11:00", "endedAt": "2026-10-26T09:10:00+11:00"},
            {"id": "tablet", "deviceId": "d2", "startedAt": "2026-10-26T09:30:00+11:00", "endedAt": "2026-10-26T09:40:00+11:00"}
        """
        val grants = """{"id": "g1", "minutes": 15, "createdAt": "2026-10-26T08:00:00+11:00", "byName": "Dad"}"""
        // The server has 10 minutes of "mine"; the device knows it went on to 09:20 and is in use again since 09:50.
        val own = listOf(
            LocalSegment("mine", ms("2026-10-25T22:00:00Z"), ms("2026-10-25T22:20:00Z"), ms("2026-10-25T22:20:00Z"), false),
            LocalSegment("open", ms("2026-10-25T22:50:00Z"), null, ms("2026-10-25T22:59:00Z"), false),
        )

        val input = todayInput(state(grants = grants, segments = segments), own, now)
        val result = evaluate(input)

        assertEquals(3, input.segments.size)
        assertEquals(1, input.grants.size)
        // Used: 20 (mine) + 10 (tablet) + 10 (open, until now) = 40 min of 60 + 15.
        assertEquals(40 * 60L, result.usedSec)
        assertEquals(35 * 60L, result.remainingSec)
        assertFalse(result.locked)
    }

    @Test
    fun aSnapshotFromYesterdayStartsTheDayEmpty() {
        val segments = """{"id": "tablet", "deviceId": "d2", "startedAt": "2026-10-25T09:30:00+11:00", "endedAt": null}"""
        val grants = """{"id": "g1", "minutes": 30, "createdAt": "2026-10-25T08:00:00+11:00", "byName": "Dad"}"""
        val own = listOf(LocalSegment("open", ms("2026-10-25T22:50:00Z"), null, ms("2026-10-25T22:59:00Z"), false))

        val input = todayInput(state(date = "2026-10-25", grants = grants, segments = segments), own, now)

        assertEquals(0, input.grants.size)
        assertEquals(1, input.segments.size)
        assertEquals(50 * 60L, evaluate(input).remainingSec)
    }

    @Test
    fun theDayStartsAtMidnightInTheFamilyZone() {
        assertEquals(ms("2026-10-25T13:00:00Z"), dayStartMs(state(), now))
    }
}
