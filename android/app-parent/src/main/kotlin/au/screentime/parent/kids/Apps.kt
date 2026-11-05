package au.screentime.parent.kids

import au.screentime.core.time.formatDuration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** How an app got onto the device (docs/SPEC.md §12.4). */
enum class AppSource { PREINSTALLED, PLAY, OTHER }

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
)

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

/** "Today 12m", or null before it has been used today. */
fun todayLine(app: KidApp): String? =
    if (app.todaySeconds >= 60) "Today ${formatDuration(app.todaySeconds.toLong())}" else null

/**
 * The page's order (docs/SPEC.md §16.4): installed apps newest first, then pre-installed ones by name, then removed
 * apps by name, so what the kid just added is at the top.
 */
fun sortApps(apps: List<KidApp>): List<KidApp> {
    fun group(a: KidApp) = if (isRemoved(a)) 2 else if (a.source == AppSource.PREINSTALLED) 1 else 0
    fun latest(a: KidApp) = a.devices.maxOf { Instant.parse(it.installedAt) }
    return apps.sortedWith(
        compareBy<KidApp> { group(it) }
            .thenComparing { a, b -> if (group(a) == 0) latest(b).compareTo(latest(a)) else 0 }
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
)
