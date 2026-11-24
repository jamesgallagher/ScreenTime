package au.screentime.kid.usage

/**
 * A missed unlock (docs/SPEC.md §12.1, "Counting"). A segment normally starts at the unlock broadcast, but on some
 * devices the app sees the unlock while Android still says the lock screen is up, or not at all (Ciara's tablet and
 * Pixel, 25 Nov 2026), and nothing counted until the screen went off. So the service also looks while the device is in
 * use with no open segment, and at screen off, and starts the segment where Android's own events say the device was
 * unlocked. Android's events are on the device clock; the caller moves them to the trusted clock first.
 */

/** Android's screen and lock screen events (UsageEvents SCREEN_INTERACTIVE, SCREEN_NON_INTERACTIVE, KEYGUARD_*). */
enum class LockKind { SCREEN_ON, SCREEN_OFF, LOCK_SHOWN, LOCK_HIDDEN }

data class LockEvent(val kind: LockKind, val atMs: Long)

/**
 * Since when the device has been on and unlocked without a break, from [events] oldest first, or null when it is not,
 * or the events do not say. Before the first lock screen event the lock screen counts as up, so a screen on alone
 * never counts unless the events show the device unlocked before it. A screen on with the lock screen down (woken
 * within the lock delay, before Android showed the lock screen again) starts a stretch; so does the lock screen going
 * away with the screen on. The screen going off or the lock screen coming back ends it.
 */
fun unlockedSince(events: List<LockEvent>): Long? {
    var screenOn = false
    var locked = true
    var since: Long? = null
    for (e in events) {
        when (e.kind) {
            LockKind.SCREEN_ON -> {
                screenOn = true
                if (!locked && since == null) since = e.atMs
            }
            LockKind.SCREEN_OFF -> {
                screenOn = false
                since = null
            }
            LockKind.LOCK_SHOWN -> {
                locked = true
                since = null
            }
            LockKind.LOCK_HIDDEN -> {
                locked = false
                if (screenOn && since == null) since = e.atMs
            }
        }
    }
    return since
}

/**
 * At a screen off at [offMs]: since when the device had been unlocked just before it. Android logs its own screen off
 * (and the lock screen coming back) around the same moment, so those events from [OFF_SLACK_MS] before [offMs] on are
 * left out; they are this screen off.
 */
fun unlockedBefore(events: List<LockEvent>, offMs: Long): Long? =
    unlockedSince(events.filterNot { (it.kind == LockKind.SCREEN_OFF || it.kind == LockKind.LOCK_SHOWN) && it.atMs >= offMs - OFF_SLACK_MS })

/** How long before the app hears of a screen off Android may already have logged it. */
const val OFF_SLACK_MS = 5_000L

/**
 * The earliest a recovered segment may start: not before counting last started ([countingSinceMs], when the device
 * stopped being blocked, in parent mode, in an SOS or in an always-allowed app), and not before the end of the
 * device's last segment, so time is never counted twice.
 */
fun notBeforeMs(countingSinceMs: Long, recent: List<LocalSegment>): Long =
    maxOf(countingSinceMs, recent.maxOfOrNull { it.endedAtMs ?: it.lastSeenAtMs } ?: Long.MIN_VALUE)

/**
 * The device is in use and counting at [nowMs] with no open segment: where the segment starts. At the unlock Android
 * reported ([sinceMs]), never before [notBeforeMs] and never in the future; without one, now.
 */
fun missedStartMs(sinceMs: Long?, notBeforeMs: Long, nowMs: Long): Long =
    (sinceMs ?: nowMs).coerceIn(minOf(notBeforeMs, nowMs), nowMs)

/**
 * The screen went off at [offMs] with no open segment while counting: the stretch that was missed, from the unlock
 * Android reported ([sinceMs], not before [notBeforeMs]) to the screen off, or null when there was none or it is
 * shorter than [MIN_MISSED_MS].
 */
fun missedStretch(sinceMs: Long?, notBeforeMs: Long, offMs: Long): Pair<Long, Long>? {
    val start = maxOf(sinceMs ?: return null, notBeforeMs)
    return if (offMs - start >= MIN_MISSED_MS) start to offMs else null
}

/** A missed stretch shorter than this is not worth a segment. */
const val MIN_MISSED_MS = 1_000L
