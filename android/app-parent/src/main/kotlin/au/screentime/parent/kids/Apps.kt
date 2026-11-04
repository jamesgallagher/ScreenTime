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

/** Fake data behind [KidsViewModel.apps] until CARD-056 connects the server. */
internal fun fakeKidApps(): List<KidApp> {
    fun device(installedAt: String, firstUsedAt: String?, removedAt: String? = null, name: String = "Pixel 7") =
        KidAppDevice(name, installedAt, firstUsedAt, removedAt)
    return listOf(
        KidApp("com.example.blockblast", "Block Blast", AppSource.PLAY, 2700, listOf(device("2026-11-03T06:12:00Z", "2026-11-03T06:14:00Z"))),
        KidApp("com.example.subwayrun", "Subway Run", AppSource.PLAY, 0, listOf(device("2026-11-03T06:02:00Z", null))),
        KidApp("com.example.oldgame", "Word Stack", AppSource.OTHER, 0, listOf(device("2026-10-20T03:00:00Z", "2026-10-20T03:10:00Z", "2026-11-01T03:00:00Z"))),
        KidApp(
            "com.google.android.youtube", "YouTube", AppSource.PREINSTALLED, 720,
            listOf(device("2026-01-10T00:00:00Z", "2026-10-28T07:30:00Z"), device("2026-01-11T00:00:00Z", "2026-10-30T07:30:00Z", name = "XPPen tablet")),
        ),
        KidApp("com.google.android.apps.bard", "Gemini", AppSource.PREINSTALLED, 0, listOf(device("2026-01-10T00:00:00Z", null))),
    )
}
