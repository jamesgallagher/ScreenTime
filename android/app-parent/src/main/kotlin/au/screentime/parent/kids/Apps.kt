package au.screentime.parent.kids

import au.screentime.core.model.api.AppRuleMode
import au.screentime.core.model.api.AppRulePut
import au.screentime.core.model.api.AppRulePutMode
import au.screentime.core.time.formatDuration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** How an app got onto the device (docs/SPEC.md §12.4). */
enum class AppSource { PREINSTALLED, PLAY, OTHER }

/** A parent's rule for an app (docs/SPEC.md §12.4). HELD is written by the server while a new app waits. */
enum class AppRule { ALLOWED, HELD, BLOCKED, LIMIT }

/** One of the kid's devices an app is or was on. Times are the API's ISO 8601 strings. */
data class KidAppDevice(
    val deviceName: String,
    val installedAt: String,
    val firstUsedAt: String?,
    val removedAt: String?,
)

/** One row of the Apps page, across the kid's Android devices. */
data class KidApp(
    val packageName: String,
    val label: String,
    val source: AppSource,
    val todaySeconds: Int,
    val devices: List<KidAppDevice>,
    val blockable: Boolean = true,
    val rule: AppRule? = null,
    val dailyMinutes: Int? = null,
)

/** What the Apps page shows. */
data class KidAppsView(val newAppApproval: Boolean, val apps: List<KidApp>)

/** What the row's control shows: nothing to choose, waiting for an answer, or the choice. */
enum class AppChoice { FIXED, WAITING, ALLOWED, BLOCKED, LIMIT }

fun appChoice(app: KidApp): AppChoice = when {
    !app.blockable -> AppChoice.FIXED
    app.rule == AppRule.HELD -> AppChoice.WAITING
    app.rule == AppRule.BLOCKED -> AppChoice.BLOCKED
    app.rule == AppRule.LIMIT -> AppChoice.LIMIT
    else -> AppChoice.ALLOWED
}

/** A new limit starts here, and the buttons move it in these steps (docs/SPEC.md §16.4). */
const val DEFAULT_LIMIT_MINUTES = 30
private const val LIMIT_STEP_MINUTES = 5
private const val MAX_LIMIT_MINUTES = 480

/** One step up or down, never below one step or above the server's limit. */
fun stepLimit(minutes: Int, up: Boolean): Int =
    (minutes + if (up) LIMIT_STEP_MINUTES else -LIMIT_STEP_MINUTES).coerceIn(LIMIT_STEP_MINUTES, MAX_LIMIT_MINUTES)

/** The seam: CARD-058 replaces this with the server, in `KidsViewModel`. */
internal object FakeLimits {
    val minutes = mutableMapOf<String, Int>()
}

/** Gone from every device. */
fun isRemoved(app: KidApp): Boolean = app.devices.all { it.removedAt != null }

/** Where it is now, or everywhere it was when it is gone from every device. */
private fun liveDevices(app: KidApp): List<KidAppDevice> =
    if (isRemoved(app)) app.devices else app.devices.filter { it.removedAt == null }

/** "3 Nov" in the family's time zone. */
fun shortDate(instant: Instant, zone: ZoneId): String =
    DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH).format(instant.atZone(zone))

private fun deviceNames(app: KidApp): String {
    val names = liveDevices(app).map { it.deviceName }
    return when {
        names.isEmpty() -> "a device"
        names.size == 1 -> names[0]
        else -> names.dropLast(1).joinToString(", ") + " and " + names.last()
    }
}

/**
 * "From Play Store · 3 Nov on Pixel 7", "Installed another way · 3 Nov on Pixel 7", "Came with Pixel 7 and XPPen
 * tablet". A pre-installed app's date is the phone's, so it is left out.
 */
fun installedLine(app: KidApp, zone: ZoneId): String {
    if (app.source == AppSource.PREINSTALLED) return "Came with ${deviceNames(app)}"
    val from = if (app.source == AppSource.PLAY) "From Play Store" else "Installed another way"
    val installed = liveDevices(app).minOfOrNull { Instant.parse(it.installedAt) }
    val date = if (installed != null) "${shortDate(installed, zone)} on " else "on "
    return "$from · $date${deviceNames(app)}"
}

/** "First used 4 Nov" or "Never opened": the earliest on any of the kid's devices. */
fun firstUsedLine(app: KidApp, zone: ZoneId): String {
    val first = app.devices.mapNotNull { it.firstUsedAt }.minOfOrNull { Instant.parse(it) }
    return if (first != null) "First used ${shortDate(first, zone)}" else "Never opened"
}

/** "Today 12m", or with a limit "Today 12m of 30m"; without a limit, null before it has been used today. */
fun todayLine(app: KidApp): String? {
    val used = if (app.todaySeconds >= 60) formatDuration(app.todaySeconds.toLong()) else null
    val limit = app.dailyMinutes.takeIf { app.rule == AppRule.LIMIT }
    if (limit != null) return "Today ${used ?: "0m"} of ${formatDuration(limit * 60L)}"
    return used?.let { "Today $it" }
}

/**
 * The page's order (docs/SPEC.md §16.4): apps waiting for an answer, then installed apps newest first, then pre-installed ones by name, then removed
 * apps by name, so what the kid just added is at the top.
 */
fun sortApps(apps: List<KidApp>): List<KidApp> {
    fun group(a: KidApp) = when {
        isRemoved(a) -> 3
        appChoice(a) == AppChoice.WAITING -> 0
        a.source == AppSource.PREINSTALLED -> 2
        else -> 1
    }
    fun latest(a: KidApp) = a.devices.maxOf { Instant.parse(it.installedAt) }
    return apps.sortedWith(
        compareBy<KidApp> { group(it) }
            .thenComparing { a, b -> if (group(a) <= 1) latest(b).compareTo(latest(a)) else 0 }
            .thenBy { it.label.lowercase(Locale.ENGLISH) },
    )
}

/** The page's row for what the server sends. */
fun appRow(app: au.screentime.core.model.api.KidApp): KidApp = KidApp(
    packageName = app.`package`,
    label = app.label,
    source = when (app.source) {
        au.screentime.core.model.api.AppSource.PREINSTALLED -> AppSource.PREINSTALLED
        au.screentime.core.model.api.AppSource.PLAY -> AppSource.PLAY
        au.screentime.core.model.api.AppSource.OTHER -> AppSource.OTHER
    },
    todaySeconds = app.todaySeconds,
    devices = app.devices.map { KidAppDevice(it.deviceName, it.installedAt, it.firstUsedAt, it.removedAt) },
    blockable = app.blockable,
    rule = when (app.rule?.mode) {
        AppRuleMode.ALLOWED -> AppRule.ALLOWED
        AppRuleMode.HELD -> AppRule.HELD
        AppRuleMode.BLOCKED -> AppRule.BLOCKED
        null -> null
    },
)

/** The server's mode for a rule. A parent cannot hold an app, so HELD is never sent. */
fun rulePut(rule: AppRule): AppRulePut =
    AppRulePut(if (rule == AppRule.BLOCKED) AppRulePutMode.BLOCKED else AppRulePutMode.ALLOWED)
