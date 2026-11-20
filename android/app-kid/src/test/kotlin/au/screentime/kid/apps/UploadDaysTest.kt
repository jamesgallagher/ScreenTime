package au.screentime.kid.apps

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.jupiter.api.Test

/** The pure functions of the 8-day upload (CARD-066, criterion 12). */
class UploadDaysTest {
    // A midday instant on 2026-11-20 in Australia/Sydney (UTC+10).
    private val sydney = ZoneId.of("Australia/Sydney")
    private val nowMs = Instant.parse("2026-11-20T04:00:00Z").toEpochMilli() // 14:00 Sydney

    @Test
    fun theDayListGivesEightDaysOldestFirst() {
        val days = uploadDays(sydney, nowMs)
        assertEquals(8, days.size)
        // Today is 2026-11-20, so the oldest is 2026-11-13.
        assertEquals("2026-11-13", days.first().date)
        assertEquals("2026-11-20", days.last().date)
        // Each day's date is the previous day's date plus one.
        for (i in 1 until days.size) {
            val prev = LocalDate.parse(days[i - 1].date)
            val cur = LocalDate.parse(days[i].date)
            assertEquals(prev.plusDays(1), cur)
        }
    }

    @Test
    fun eachDayStartsAtLocalMidnight() {
        val days = uploadDays(sydney, nowMs)
        for (d in days) {
            val start = Instant.ofEpochMilli(d.startMs).atZone(sydney).toLocalTime()
            assertEquals(0, start.hour)
            assertEquals(0, start.minute)
        }
    }

    @Test
    fun theLastDayEndsAtNow() {
        val days = uploadDays(sydney, nowMs)
        assertEquals(nowMs, days.last().endMs)
    }

    @Test
    fun aDayEndsAtTheNextLocalMidnight() {
        val days = uploadDays(sydney, nowMs)
        // The second-to-last day (2026-11-19) ends at local midnight of 2026-11-20.
        val end = Instant.ofEpochMilli(days[6].endMs).atZone(sydney)
        assertEquals(LocalDate.parse("2026-11-20"), end.toLocalDate())
        assertEquals(0, end.hour)
        assertEquals(0, end.minute)
    }

    @Test
    fun acrossDaylightSavingOneDayIsNotTwentyFourHours() {
        // Australia/Sydney: clocks go back on 2026-04-05 (the day is 25 hours).
        // Use a now on 2026-04-06 so that 2026-04-05 is a full day in the list.
        val now = Instant.parse("2026-04-06T04:00:00Z").toEpochMilli() // 14:00 Sydney on April 6
        val days = uploadDays(sydney, now)
        // The day 2026-04-05 is the 25-hour day. Find it.
        val d05 = days.first { it.date == "2026-04-05" }
        val lengthMs = d05.endMs - d05.startMs
        // 25 hours = 90,000,000 ms.
        assertEquals(25L * 3600 * 1000, lengthMs)
    }

    @Test
    fun aShorterDayIsTwentyThreeHours() {
        // The spring-forward on 2026-10-04 makes a 23-hour day.
        // Use a now on 2026-10-05 so that 2026-10-04 is a full day in the list.
        val now = Instant.parse("2026-10-05T04:00:00Z").toEpochMilli() // 14:00 Sydney on October 5
        val days = uploadDays(sydney, now)
        val d04 = days.first { it.date == "2026-10-04" }
        val lengthMs = d04.endMs - d04.startMs
        // 23 hours = 82,800,000 ms.
        assertEquals(23L * 3600 * 1000, lengthMs)
    }

    @Test
    fun spanPruningKeepsASpanFromSixDaysAgo() {
        val days = uploadDays(sydney, nowMs)
        val oldestStart = days.first().startMs
        // A span that ends 6 days ago (within the 8-day window).
        val recent = Span(oldestStart + 6 * 86_400_000, oldestStart + 6 * 86_400_000 + 3600_000)
        val kept = pruneSpans(listOf(recent), oldestStart)
        assertEquals(1, kept.size)
        assertEquals(recent, kept[0])
    }

    @Test
    fun spanPruningDropsASpanFromNineDaysAgo() {
        val days = uploadDays(sydney, nowMs)
        val oldestStart = days.first().startMs
        // A span that ended 9 days ago (outside the 8-day window).
        val old = Span(oldestStart - 9 * 86_400_000, oldestStart - 8 * 86_400_000)
        val kept = pruneSpans(listOf(old), oldestStart)
        assertTrue(kept.isEmpty())
    }

    @Test
    fun spanPruningKeepsAnOpenSpan() {
        val days = uploadDays(sydney, nowMs)
        val oldestStart = days.first().startMs
        // An open span: started 7 days ago, ends in the future.
        val open = Span(oldestStart + 7 * 86_400_000, nowMs + 3600_000)
        val kept = pruneSpans(listOf(open), oldestStart)
        assertEquals(1, kept.size)
        assertEquals(open, kept[0])
    }

    @Test
    fun spanPruningDropsASpanThatEndedBeforeTheWindow() {
        val days = uploadDays(sydney, nowMs)
        val oldestStart = days.first().startMs
        // A span that ended just before the oldest start.
        val justBefore = Span(oldestStart - 3600_000, oldestStart - 1000)
        val kept = pruneSpans(listOf(justBefore), oldestStart)
        assertTrue(kept.isEmpty())
    }
}
