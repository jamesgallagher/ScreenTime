package au.screentime.kid.usage

import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.Pool
import au.screentime.core.time.DaySchedule
import au.screentime.core.time.EngineInput
import au.screentime.core.time.Grant
import au.screentime.core.time.Segment
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId

/** Start of the family's day that contains [nowMs]. The device's own time zone is never used (docs/SPEC.md §8.5). */
fun dayStartMs(state: DeviceState, nowMs: Long): Long {
    val tz = ZoneId.of(state.family.timezone)
    return Instant.ofEpochMilli(nowMs).atZone(tz).toLocalDate().atStartOfDay(tz).toInstant().toEpochMilli()
}

/**
 * The engine input for this device's pool today (docs/SPEC.md §7.1, §8.2): the schedule, grants and pool segments of
 * the cached snapshot, with this device's own segments from [own] in place of the server's copies of them. When the
 * snapshot is from an earlier day, its grants and segments are left out: a new day starts empty.
 */
fun todayInput(state: DeviceState, own: List<LocalSegment>, nowMs: Long): EngineInput {
    val tz = ZoneId.of(state.family.timezone)
    val now = Instant.ofEpochMilli(nowMs)
    val date = now.atZone(tz).toLocalDate()
    val day = state.schedule.days.first { it.weekday == date.dayOfWeek.value }
    val allowance = if (state.device.pool == Pool.PHONE) day.phoneMin else day.screensMin
    val sameDay = state.today.date == date.toString()

    val grants = if (sameDay) state.today.grants.map { Grant(it.minutes, instant(it.createdAt)) } else emptyList()
    val ownIds = own.map { it.id }.toSet()
    val others = if (sameDay) {
        state.today.poolSegments
            .filter { it.id !in ownIds }
            .map { Segment(instant(it.startedAt), it.endedAt?.let(::instant)) }
    } else {
        emptyList()
    }
    val mine = own.map { Segment(Instant.ofEpochMilli(it.startedAtMs), it.endedAtMs?.let(Instant::ofEpochMilli)) }

    return EngineInput(
        tz = tz,
        date = date,
        now = now,
        day = DaySchedule(allowance, day.wake, day.bedtime),
        grants = grants,
        segments = others + mine,
    )
}

private fun instant(text: String): Instant = OffsetDateTime.parse(text).toInstant()
