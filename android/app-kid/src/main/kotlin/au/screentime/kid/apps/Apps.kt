package au.screentime.kid.apps

import au.screentime.core.model.api.AppRuleMode
import au.screentime.core.model.api.AppSource
import au.screentime.core.model.api.DeviceAppIn
import au.screentime.core.model.api.DeviceAppsPut
import java.time.Instant

/** What Android says about one app with a launcher icon. */
data class InstalledApp(
    val packageName: String,
    val label: String,
    val isSystem: Boolean,
    val installer: String?,
    val installedAtMs: Long,
)

/** A resumed activity from Android's usage events. */
data class Resume(val packageName: String, val atMs: Long)

const val PLAY_STORE = "com.android.vending"

/** Never blocked whatever the snapshot says (docs/SPEC.md §12.4). Android does not protect Play services itself. */
val NEVER_BLOCKED = setOf("com.google.android.gms", "com.google.android.gsf", "com.android.settings")

/** A system app stays pre-installed even after an update from the Play Store. */
fun appSource(isSystem: Boolean, installer: String?): AppSource = when {
    isSystem -> AppSource.PREINSTALLED
    installer == PLAY_STORE -> AppSource.PLAY
    else -> AppSource.OTHER
}

/** The server's limit is 80 characters, and an app with no name still needs one. */
fun appLabel(label: String, packageName: String): String = label.trim().ifEmpty { packageName }.take(80)

/**
 * [known] with the first use of every package in [resumes] that it does not have yet. The earliest resume wins. Apps
 * in [ignored] (the launcher) are never reported.
 */
fun withFirstUses(known: Map<String, Long>, resumes: List<Resume>, ignored: Set<String>): Map<String, Long> {
    val out = known.toMutableMap()
    for (r in resumes) {
        if (r.packageName in ignored || r.packageName in known) continue
        val seen = out[r.packageName]
        if (seen == null || r.atMs < seen) out[r.packageName] = r.atMs
    }
    return out
}

/** What the device must do to match [wanted]: which packages to block, and which to release. */
data class BlockPlan(val block: Set<String>, val release: Set<String>)

/**
 * Which packages should be blocked now (docs/SPEC.md §12.4): those with a `blocked` or `held` rule and those the
 * device is holding itself, never anything in [protected] or [NEVER_BLOCKED]. Parent mode releases everything.
 */
fun wantedBlocks(
    rules: Map<String, AppRuleMode>,
    held: Set<String>,
    protected: Set<String>,
    parentMode: Boolean,
    limitsOver: Set<String> = emptySet(),
): Set<String> {
    if (parentMode) return emptySet()
    val ruled = rules.filterValues { it == AppRuleMode.BLOCKED || it == AppRuleMode.HELD }.keys
    return (ruled + held + limitsOver) - protected - NEVER_BLOCKED
}

/** What changes which app is in use: an activity coming to the front or leaving it, and the screen going off. */
enum class UsageKind { RESUMED, PAUSED, SCREEN_OFF }

data class UsageEvent(val kind: UsageKind, val packageName: String, val atMs: Long)

/** A stretch of time that does not count: parent mode. */
data class Span(val fromMs: Long, val toMs: Long)

/** Seconds per app in a stretch of time, and what was still in front at the end of it. */
data class AppUsageNow(val seconds: Map<String, Long>, val inFront: Set<String>)

private fun msOutside(fromMs: Long, toMs: Long, spans: List<Span>): Long {
    if (toMs <= fromMs) return 0
    val inside = spans.sumOf { s -> (minOf(toMs, s.toMs) - maxOf(fromMs, s.fromMs)).coerceAtLeast(0) }
    return (toMs - fromMs - inside).coerceAtLeast(0)
}

/**
 * Adds up each app's time between [fromMs] and [toMs] from Android's usage events, oldest first: resumed to paused,
 * ending at screen off, leaving out [notCounted]. An app already in front at [fromMs] has no resume in the events,
 * so a pause with no resume before it counts from [fromMs]. One still open counts up to [toMs].
 */
fun appUsage(events: List<UsageEvent>, fromMs: Long, toMs: Long, notCounted: List<Span> = emptyList()): AppUsageNow {
    val open = mutableMapOf<String, Long>()
    val seen = mutableSetOf<String>()
    val ms = mutableMapOf<String, Long>()
    fun close(name: String, atMs: Long, startMs: Long) {
        ms[name] = (ms[name] ?: 0) + msOutside(startMs, atMs, notCounted)
    }
    for (e in events.filter { it.atMs in fromMs..toMs }) {
        when (e.kind) {
            UsageKind.RESUMED -> {
                seen += e.packageName
                open.putIfAbsent(e.packageName, e.atMs)
            }
            UsageKind.PAUSED -> {
                val start = open.remove(e.packageName)
                if (start != null) {
                    close(e.packageName, e.atMs, start)
                } else if (seen.add(e.packageName)) {
                    close(e.packageName, e.atMs, fromMs)
                }
            }
            UsageKind.SCREEN_OFF -> {
                open.forEach { (name, start) -> close(name, e.atMs, start) }
                open.clear()
            }
        }
    }
    open.forEach { (name, start) -> close(name, toMs, start) }
    return AppUsageNow(ms.mapValues { it.value / 1000 }, open.keys.toSet())
}

/** One app with a daily limit now. */
data class AppLimitNow(val packageName: String, val label: String, val leftSec: Long)

/**
 * The limits of the apps on this device, by name: [minutes] per package, less this device's [own] seconds and the
 * [others] of the kid's other devices. Two devices using one app at the same time count twice (docs/SPEC.md §12.4).
 */
fun appLimits(minutes: Map<String, Int>, own: Map<String, Long>, others: Map<String, Long>, labels: Map<String, String>): List<AppLimitNow> =
    minutes.mapNotNull { (name, limit) ->
        labels[name]?.let { label -> AppLimitNow(name, label, limit * 60L - (own[name] ?: 0) - (others[name] ?: 0)) }
    }.sortedBy { it.label.lowercase() }

/** What to tell the kid, and what is now remembered as told. */
data class LimitNews(val messages: List<String>, val warned: Set<String>, val done: Set<String>)

private const val WARN_LEFT_SEC = 300L

/**
 * A warning at 5 minutes left and a last word at the limit, once each, and only for an app in front: an app the kid is
 * not using is not news. More time from a parent lets them come again.
 */
fun limitNews(limits: List<AppLimitNow>, inFront: Set<String>, warned: Set<String>, done: Set<String>): LimitNews {
    val messages = mutableListOf<String>()
    val nowWarned = warned.toMutableSet()
    val nowDone = done.toMutableSet()
    for (l in limits) {
        if (l.leftSec > WARN_LEFT_SEC) nowWarned -= l.packageName
        if (l.leftSec > 0) nowDone -= l.packageName
        if (l.packageName !in inFront) continue
        if (l.leftSec <= 0) {
            if (nowDone.add(l.packageName)) messages += "That's all your ${l.label} for today"
        } else if (l.leftSec <= WARN_LEFT_SEC && nowWarned.add(l.packageName)) {
            messages += "5 minutes of ${l.label} left"
        }
    }
    return LimitNews(messages, nowWarned, nowDone)
}

/** How long until an app in front uses up its limit, or null when none is coming. */
fun nextLimitMs(limits: List<AppLimitNow>, inFront: Set<String>): Long? =
    limits.filter { it.packageName in inFront && it.leftSec > 0 }.minOfOrNull { it.leftSec * 1000 }

fun blockPlan(wanted: Set<String>, applied: Set<String>): BlockPlan = BlockPlan(wanted - applied, applied - wanted)

/**
 * The packages the device holds itself until the server's rule arrives: new since the last look, with approval on and
 * no rule. One already held stays until it has a rule or is gone. With approval off nothing new is held, and one with
 * no rule is let go. The first look ([known] null) is the baseline, so nothing is held.
 */
fun heldPackages(
    approval: Boolean,
    known: Set<String>?,
    installed: Set<String>,
    rules: Set<String>,
    held: Set<String>,
): Set<String> {
    if (!approval) return emptySet()
    val new = if (known == null) emptySet() else installed - known
    return (held + new).intersect(installed) - rules
}

private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

/**
 * The body of `PUT /v1/device/apps`, in package order so the same list always looks the same: the service only sends
 * it when it changed. Null when there is nothing to send (the server wants at least one app).
 */
fun appListBody(apps: List<InstalledApp>, firstUses: Map<String, Long>, protected: Set<String>): DeviceAppsPut? {
    if (apps.isEmpty()) return null
    return DeviceAppsPut(
        apps.distinctBy { it.packageName }.sortedBy { it.packageName }.map { a ->
            DeviceAppIn(
                `package` = a.packageName,
                label = appLabel(a.label, a.packageName),
                source = appSource(a.isSystem, a.installer),
                installer = a.installer?.take(255),
                blockable = a.packageName !in protected && a.packageName !in NEVER_BLOCKED,
                installedAt = iso(a.installedAtMs),
                firstUsedAt = firstUses[a.packageName]?.let(::iso),
            )
        },
    )
}

/** Spans as saved in SharedPreferences: "from-to,from-to". Anything unreadable is dropped. */
fun formatSpans(spans: List<Span>): String = spans.joinToString(",") { "${it.fromMs}-${it.toMs}" }

fun parseSpans(text: String): List<Span> = text.split(",").mapNotNull { part ->
    val numbers = part.split("-")
    val from = numbers.getOrNull(0)?.toLongOrNull()
    val to = numbers.getOrNull(1)?.toLongOrNull()
    if (from != null && to != null) Span(from, to) else null
}
