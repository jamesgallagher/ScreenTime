package au.screentime.kid.apps

/**
 * Always-allowed apps (docs/SPEC.md §12.4): a parent lets some apps run on this device when its time is up, but not
 * from bedtime to wake-up, and their time never counts. A block, a waiting app or a used-up daily limit still wins.
 */

/**
 * The always-allowed apps that may run now: the parent's list for this device, if installed, less what is blocked
 * ([blocked]: rules, apps waiting for a parent, used-up limits) and what is part of the device.
 */
fun freeApps(alwaysAllowed: Collection<String>, installed: Set<String>, blocked: Set<String>, protected: Set<String>): Set<String> =
    alwaysAllowed.toSet().intersect(installed) - blocked - protected - NEVER_BLOCKED

/**
 * Whether an always-allowed app is in front, from the usage events, oldest first. [sinceMs] is when the current stretch
 * began (null when none is in front); [endedMs] is when the last one ended. The screen going off ends a stretch.
 */
data class FreeFront(val sinceMs: Long?, val endedMs: Long?)

fun freeFront(events: List<UsageEvent>, free: Set<String>): FreeFront {
    val open = mutableMapOf<String, Long>()
    var ended: Long? = null
    for (e in events) {
        when (e.kind) {
            UsageKind.RESUMED -> if (e.packageName in free) open.putIfAbsent(e.packageName, e.atMs)
            UsageKind.PAUSED -> if (open.remove(e.packageName) != null && open.isEmpty()) ended = e.atMs
            UsageKind.SCREEN_OFF -> if (open.isNotEmpty()) {
                open.clear()
                ended = e.atMs
            }
        }
    }
    return FreeFront(open.values.minOrNull(), ended)
}

/**
 * Where to cut the device's own time when an always-allowed app comes to the front or leaves it, so its time does not
 * count. The cut is never in the future, and never before [notBeforeMs] (the start of the segment it ends).
 */
fun cutAt(atMs: Long?, nowMs: Long, notBeforeMs: Long): Long = (atMs ?: nowMs).coerceIn(minOf(notBeforeMs, nowMs), nowMs)
