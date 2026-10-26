package au.screentime.kid.status

import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.Pool
import au.screentime.core.time.EngineResult
import au.screentime.core.time.LockReason
import au.screentime.core.time.formatDuration
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

/** How much time is left, for the ring and notification colours (docs/SPEC.md §16.1). */
enum class Level { PLENTY, LOW, CRITICAL, LOCKED }

/**
 * What the notification and the main screen show (docs/SPEC.md §16.2), worked out from one engine result.
 * Times are epoch milliseconds of the trusted clock, except [elapsedMs].
 */
data class KidStatus(
    val kidName: String,
    /** "Phone" or "Screens". */
    val poolName: String,
    /** "phone" or "tablet", for "This phone locks at 8:30 pm". */
    val deviceWord: String,
    /** Null while the device may be used. */
    val lockReason: LockReason?,
    /** Seconds until the device locks, 0 when locked. */
    val leftSec: Long,
    /** Seconds the pool was used today, on all its devices. */
    val usedSec: Long,
    /** When the device locks; null when locked, or when it does not lock before the end of the day. */
    val lockAtMs: Long?,
    /** [lockAtMs] as a time of day, "8:30 pm". */
    val lockAtText: String?,
    /** When the engine must run again (docs/SPEC.md §7.3). */
    val reevaluateAtMs: Long,
    /** Today's bedtime while it is still to come, "8:30 pm". */
    val bedtime: String?,
    /** Bedtime or early morning: when the device can be used again, "7:00 am". */
    val backAt: String?,
    val warn1Min: Int,
    val warn2Min: Int,
    /** False when the last sync failed: the device still counts (docs/SPEC.md §8.4). */
    val online: Boolean,
    /** `SystemClock.elapsedRealtime()` when this was worked out, so a screen can count down without the service. */
    val elapsedMs: Long,
) {
    val locked: Boolean get() = lockReason != null

    /** [leftSec] at a later `elapsedRealtime`, never below 0. */
    fun leftSecAt(elapsedNowMs: Long): Long =
        if (lockAtMs == null) leftSec else maxOf(0L, leftSec - (elapsedNowMs - elapsedMs) / 1000)

    /** The ring colour: warning at [warn1Min] or less, critical at [warn2Min] or less. */
    fun level(left: Long = leftSec): Level = when {
        locked -> Level.LOCKED
        lockAtMs == null -> Level.PLENTY
        left <= warn2Min * 60L -> Level.CRITICAL
        left <= warn1Min * 60L -> Level.LOW
        else -> Level.PLENTY
    }

    /** The notification title: "Phone · 1h 12m left", or "It's bedtime" when locked. */
    fun title(left: Long = leftSec): String =
        lockReason?.let { headline(it) } ?: "$poolName · ${formatDuration(left)} left"

    /** "Out of Phone time", "It's bedtime" or "Not yet, it's early". */
    fun headline(reason: LockReason): String = when (reason) {
        LockReason.OUT_OF_TIME -> "Out of $poolName time"
        LockReason.BEDTIME -> "It's bedtime"
        LockReason.BEFORE_WAKE -> "Not yet, it's early"
    }

    /** The line under it: "Bedtime 8:30 pm"; when locked "Phone is back at 7:00 am" or "New time tomorrow". */
    fun subline(): String? = when (lockReason) {
        null -> bedtime?.let { "Bedtime $it" }
        LockReason.OUT_OF_TIME -> "New time tomorrow"
        else -> backAt?.let { "${deviceWord.replaceFirstChar(Char::uppercase)} is back at $it" }
    }

    /** The big number in the ring: "1h 12m", or "<1m" in the last minute. */
    fun ringText(left: Long = leftSec): String = if (left < 60) "<1m" else formatDuration(left)

    /** How full the ring is: the part of today's time that is still left. */
    fun ringFraction(left: Long = leftSec): Float = when {
        locked -> 0f
        left + usedSec <= 0L -> 1f
        else -> left.toFloat() / (left + usedSec)
    }
}

/** The status for [result], the engine's answer for [state] at [nowMs]. */
fun kidStatus(state: DeviceState, result: EngineResult, nowMs: Long, online: Boolean, elapsedMs: Long): KidStatus {
    val tz = ZoneId.of(state.family.timezone)
    val local = Instant.ofEpochMilli(nowMs).atZone(tz)
    val date = local.toLocalDate()
    fun dayOf(weekday: Int) = state.schedule.days.first { it.weekday == weekday }
    val today = dayOf(date.dayOfWeek.value)

    val lockAtMs = result.nextLockAt?.toEpochMilli()
    val leftSec = when {
        result.locked -> 0L
        lockAtMs != null -> maxOf(0L, (lockAtMs - nowMs) / 1000)
        else -> result.remainingSec
    }
    val bedtime = if (today.bedtime == "24:00") {
        null
    } else {
        LocalTime.parse(today.bedtime).takeIf { local.toLocalTime() < it }?.let(::clockText)
    }
    val backAt = when (result.lockReason) {
        LockReason.BEFORE_WAKE -> clockText(LocalTime.parse(today.wake))
        LockReason.BEDTIME -> clockText(LocalTime.parse(dayOf(date.plusDays(1).dayOfWeek.value).wake))
        else -> null
    }

    return KidStatus(
        kidName = state.kid.name,
        poolName = if (state.device.pool == Pool.PHONE) "Phone" else "Screens",
        deviceWord = if (state.device.form == DeviceForm.TABLET) "tablet" else "phone",
        lockReason = if (result.locked) result.lockReason else null,
        leftSec = leftSec,
        usedSec = result.usedSec,
        lockAtMs = lockAtMs,
        lockAtText = lockAtMs?.let { clockText(Instant.ofEpochMilli(it).atZone(tz).toLocalTime()) },
        reevaluateAtMs = result.reevaluateAt.toEpochMilli(),
        bedtime = bedtime,
        backAt = backAt,
        warn1Min = state.schedule.warn1Min,
        warn2Min = state.schedule.warn2Min,
        online = online,
        elapsedMs = elapsedMs,
    )
}

/** A time of day the en-AU way (docs/SPEC.md §16.1): "8:30 pm", "12:05 am". */
fun clockText(time: LocalTime): String {
    val hour = if (time.hour % 12 == 0) 12 else time.hour % 12
    val half = if (time.hour < 12) "am" else "pm"
    return "$hour:${time.minute.toString().padStart(2, '0')} $half"
}

/**
 * When the service must look again (docs/SPEC.md §12.1): the first of warn 1, warn 2, the lock and [KidStatus.reevaluateAtMs]
 * that is still to come, and at least once a minute.
 */
fun nextCheckAtMs(status: KidStatus, nowMs: Long): Long {
    val lockAt = status.lockAtMs
    val events = buildList {
        add(status.reevaluateAtMs)
        if (lockAt != null) {
            add(lockAt)
            add(lockAt - status.warn1Min * 60_000L)
            add(lockAt - status.warn2Min * 60_000L)
        }
    }
    val next = events.filter { it > nowMs }.minOrNull() ?: Long.MAX_VALUE
    return minOf(next, nowMs + 60_000L)
}
