package au.screentime.core.time

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Why a pool is locked (docs/SPEC.md §7.3). [wire] is the value in the API and the test vectors. */
enum class LockReason(val wire: String) {
    OUT_OF_TIME("out_of_time"),
    BEDTIME("bedtime"),
    BEFORE_WAKE("before_wake"),
}

/** Today's schedule for one pool. [wake] and [bedtime] are "HH:MM"; [bedtime] may be "24:00" (the end of the day). */
data class DaySchedule(val allowanceMin: Int, val wake: String, val bedtime: String)

/** Extra minutes from a parent, negative to take time away. */
data class Grant(val minutes: Int, val createdAt: Instant)

/** Time a device of the pool was in use. [end] null means still open: it is read as `now`. */
data class Segment(val start: Instant, val end: Instant?)

/** Everything the engine needs for one kid, one pool and one local [date] (docs/SPEC.md §7.1). */
data class EngineInput(
    /** The family time zone. */
    val tz: ZoneId,
    val date: LocalDate,
    /** The trusted current instant (docs/SPEC.md §8.5). */
    val now: Instant,
    val day: DaySchedule,
    /** Grants for this kid, pool and date. */
    val grants: List<Grant>,
    /** Segments of ALL devices in the pool. */
    val segments: List<Segment>,
)

data class EngineResult(
    val locked: Boolean,
    val lockReason: LockReason?,
    val remainingSec: Long,
    /** Null when the pool does not lock again before the end of the day. */
    val nextLockAt: Instant?,
    val reevaluateAt: Instant,
    val usedSec: Long,
    val overspendSec: Long,
)

private enum class Period { MORNING, ALLOWED, EVENING }

/**
 * The time engine of docs/SPEC.md §7: the same steps as `packages/engine/src/engine.ts`, and it must pass every case in
 * `test-vectors/engine/`. Instants are epoch milliseconds inside; used time is rounded down to whole seconds.
 */
fun evaluate(input: EngineInput): EngineResult {
    val tz = input.tz

    // Step 1: key instants. Days are found through the time zone, never by adding 24 hours.
    val nowMs = input.now.toEpochMilli()
    val dayStart = input.date.atStartOfDay(tz).toInstant().toEpochMilli()
    val dayEnd = input.date.plusDays(1).atStartOfDay(tz).toInstant().toEpochMilli()
    val wakeAt = localMs(input.date, input.day.wake, tz)
    val bedAt = if (input.day.bedtime == "24:00") dayEnd else localMs(input.date, input.day.bedtime, tz)

    // Step 2: periods. morning = [dayStart, wakeAt), allowed = [wakeAt, bedAt), evening = [bedAt, dayEnd).
    fun periodOf(t: Long): Period = when {
        t < wakeAt -> Period.MORNING
        t < bedAt -> Period.ALLOWED
        else -> Period.EVENING
    }

    // Step 3: used time. Length in seconds of the union of the segments, clipped to [from, to), the day and now.
    fun used(from: Long, to: Long): Long {
        val pieces = input.segments
            .mapNotNull { seg ->
                val start = seg.start.toEpochMilli()
                val end = seg.end?.toEpochMilli() ?: nowMs
                val cs = maxOf(start, from, dayStart)
                val ce = minOf(end, minOf(to, nowMs, dayEnd))
                if (ce > cs) cs to ce else null
            }
            .sortedBy { it.first }
        var totalMs = 0L
        var curStart = 0L
        var curEnd = 0L
        var hasCur = false
        for ((s, e) in pieces) {
            if (!hasCur || s > curEnd) {
                if (hasCur) totalMs += curEnd - curStart
                curStart = s
                curEnd = e
                hasCur = true
            } else {
                curEnd = maxOf(curEnd, e)
            }
        }
        if (hasCur) totalMs += curEnd - curStart
        return Math.floorDiv(totalMs, 1000L)
    }

    val usedMorning = used(dayStart, wakeAt)
    val usedAllowed = used(wakeAt, bedAt)
    val usedEvening = used(bedAt, dayEnd)

    // Step 4: grants belong to the period that contains their createdAt.
    fun grantSec(p: Period): Long =
        input.grants.filter { periodOf(it.createdAt.toEpochMilli()) == p }.sumOf { it.minutes * 60L }

    // Step 5: allowance.
    val allowanceLeft = input.day.allowanceMin * 60L + grantSec(Period.ALLOWED) - usedAllowed

    // Step 6: state, by the period that contains now.
    val locked: Boolean
    val lockReason: LockReason?
    val remainingSec: Long
    var nextLockAtMs: Long?

    val nowPeriod = periodOf(nowMs)
    if (nowPeriod == Period.ALLOWED) {
        remainingSec = maxOf(0L, allowanceLeft)
        locked = allowanceLeft <= 0
        lockReason = if (locked) LockReason.OUT_OF_TIME else null
        nextLockAtMs = if (locked) null else minOf(nowMs + remainingSec * 1000, bedAt)
    } else {
        val morning = nowPeriod == Period.MORNING
        val curfewLeft = grantSec(nowPeriod) - (if (morning) usedMorning else usedEvening)
        remainingSec = maxOf(0L, curfewLeft)
        locked = curfewLeft <= 0
        lockReason = if (!locked) null else if (morning) LockReason.BEFORE_WAKE else LockReason.BEDTIME
        nextLockAtMs = if (locked) {
            null
        } else {
            val t = nowMs + remainingSec * 1000
            if (morning && t >= wakeAt) {
                // The allowed period takes over at wake-up.
                if (allowanceLeft > 0) minOf(wakeAt + allowanceLeft * 1000, bedAt) else wakeAt
            } else {
                t
            }
        }
    }

    // A lock at or after the end of the day is tomorrow's business.
    if (nextLockAtMs != null && nextLockAtMs >= dayEnd) nextLockAtMs = null

    // Step 7: reevaluateAt = the earliest of nextLockAt, the next period boundary and dayEnd.
    var reevaluateAt = dayEnd
    if (nextLockAtMs != null) reevaluateAt = minOf(reevaluateAt, nextLockAtMs)
    if (nowMs < wakeAt && wakeAt < dayEnd) reevaluateAt = minOf(reevaluateAt, wakeAt)
    if (nowMs < bedAt && bedAt < dayEnd) reevaluateAt = minOf(reevaluateAt, bedAt)

    // Step 8: result.
    return EngineResult(
        locked = locked,
        lockReason = lockReason,
        remainingSec = remainingSec,
        nextLockAt = nextLockAtMs?.let(Instant::ofEpochMilli),
        reevaluateAt = Instant.ofEpochMilli(reevaluateAt),
        usedSec = usedMorning + usedAllowed + usedEvening,
        overspendSec = maxOf(0L, -allowanceLeft),
    )
}

/** "date at HH:MM" in the family time zone, as epoch milliseconds. A time skipped by daylight saving moves forward. */
private fun localMs(date: LocalDate, time: String, tz: ZoneId): Long =
    ZonedDateTime.of(date, LocalTime.parse(time), tz).toInstant().toEpochMilli()
