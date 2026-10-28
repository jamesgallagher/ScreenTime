package au.screentime.parent.today

import au.screentime.core.model.api.LockReason
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TodayDevice
import au.screentime.core.model.api.TodayKid
import au.screentime.core.model.api.TodayPool
import au.screentime.core.time.formatDuration
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** How often Today asks the server again (docs/SPEC.md §16.4). */
const val REFRESH_MS = 30_000L

/** A device silent this long reads as offline, as in the server's sweep (docs/SPEC.md §8.5). */
const val OFFLINE_AFTER_MS = 6 * 60 * 60_000L

/** The pool's name for people: `Screens` or `Phone`. */
fun poolName(pool: Pool): String = when (pool) {
    Pool.SCREENS -> "Screens"
    Pool.PHONE -> "Phone"
}

/** The colour of a pool's bar and "left" text (docs/SPEC.md §16.1). */
enum class Tone { OK, WARNING, CRITICAL, LOCKED }

/** How one pool reads on a kid card. */
data class PoolView(
    val name: String,
    val status: String,
    val detail: String,
    val fraction: Float,
    val tone: Tone,
)

/**
 * How one pool reads (docs/SPEC.md §16.4): the time left and used, the bar's fraction, and the tone.
 */
fun poolView(pool: TodayPool): PoolView {
    val totalSec = (pool.allowanceMin + pool.grantedMin) * 60
    val total = totalSec.coerceAtLeast(0)
    val usedText = if (pool.usedSec < 60) null else "${formatDuration(pool.usedSec.toLong())} used"
    val totalText = if (total < 60) null else formatDuration(total.toLong())
    val detail = when {
        totalText == null -> usedText ?: "No time today"
        usedText == null -> "Nothing used of $totalText"
        else -> "$usedText of $totalText"
    }
    if (pool.locked) {
        val status = when (pool.lockReason) {
            LockReason.BEDTIME -> "Locked · bedtime"
            LockReason.BEFORE_WAKE -> "Locked · before wake-up"
            LockReason.OUT_OF_TIME -> "Locked · out of time"
            null -> "Locked · out of time"
        }
        return PoolView(poolName(pool.pool), status, detail, 0f, Tone.LOCKED)
    }
    val fraction = if (total > 0) (pool.remainingSec.toFloat() / total).coerceIn(0f, 1f) else 0f
    val tone = when {
        pool.remainingSec <= 300 -> Tone.CRITICAL
        pool.remainingSec <= 900 -> Tone.WARNING
        else -> Tone.OK
    }
    return PoolView(poolName(pool.pool), "${formatDuration(pool.remainingSec.toLong())} left", detail, fraction, tone)
}

/** The colour of a chip. */
enum class ChipTone { NEUTRAL, PRIMARY, WARNING }

/** A chip under a kid card. */
data class Chip(val text: String, val tone: ChipTone)

/**
 * The chips under a kid card (docs/SPEC.md §16.4): what is in use, parent mode, devices silent for
 * 6 hours, and time used beyond the limit while a device was offline. A device in both pools is listed once.
 */
fun kidChips(kid: TodayKid, now: Instant): List<Chip> {
    val seen = mutableSetOf<String>()
    val chips = mutableListOf<Chip>()
    for (pool in kid.pools) {
        for (device in pool.devices) {
            if (device.id in seen) continue
            seen.add(device.id)
            if (device.inUse) {
                chips.add(Chip("Using ${device.name} now", ChipTone.PRIMARY))
            }
            val parentMode = device.parentMode
            if (parentMode != null) {
                val endsAt = parentMode.endsAt
                val minutes = if (endsAt != null) {
                    val ms = Instant.parse(endsAt).epochSecond * 1000 - now.epochSecond * 1000
                    ((ms + 59_999) / 60_000).toInt().coerceAtLeast(1)
                } else null
                chips.add(
                    Chip(
                        if (minutes == null) "Parent mode on ${device.name}" else "Parent mode on ${device.name} · $minutes min",
                        ChipTone.NEUTRAL,
                    ),
                )
            }
            if (!device.inUse && device.lastSeenAt != null) {
                val silentMs = now.epochSecond * 1000 - Instant.parse(device.lastSeenAt).epochSecond * 1000
                if (silentMs >= OFFLINE_AFTER_MS) {
                    chips.add(Chip("${device.name} offline ${offlineText(silentMs)}", ChipTone.NEUTRAL))
                }
            }
        }
    }
    for (pool in kid.pools) {
        if (pool.overspendSec >= 60) {
            chips.add(
                Chip(
                    "${poolName(pool.pool)}: ${formatDuration(pool.overspendSec.toLong())} over (a device was offline)",
                    ChipTone.WARNING,
                ),
            )
        }
    }
    return chips
}

/** `<H>h` for whole hours, or `<D>d` (whole days) from 48 hours. */
private fun offlineText(ms: Long): String {
    val hours = ms / 3_600_000
    return if (hours >= 48) "${hours / 24}d" else "${hours}h"
}

/** The first character of the trimmed name in upper case, or `?` for an empty name. */
fun initial(name: String): String {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return "?"
    return trimmed.first().uppercase()
}

/** `2026-10-28` becomes `Wednesday 28 October`. */
fun dayTitle(date: String): String {
    val formatter = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.forLanguageTag("en-AU"))
    return LocalDate.parse(date).format(formatter)
}
