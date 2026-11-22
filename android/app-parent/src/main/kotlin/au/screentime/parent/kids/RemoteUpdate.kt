package au.screentime.parent.kids

import au.screentime.core.model.api.Device
import java.time.Instant

/**
 * What the kid page's device row says about a device's app update (docs/SPEC.md §12.11, "Remote Update now"):
 * [versionName] is the version the server offers that device; the update is [requested] once a parent has asked,
 * at [requestedAt]. No [DeviceUpdate] means nothing newer is offered.
 */
data class DeviceUpdate(val versionName: String, val requested: Boolean, val requestedAt: Instant? = null)

/** What the device row listens to. The real one (CARD-072) reads `Device.appUpdate` and calls the server. */
interface DeviceUpdates {
    /** What [device] has to say about an update, or null when nothing newer is offered to it. */
    fun of(device: Device): DeviceUpdate?

    /** **Update now** on [deviceId]: asks the server. True when it took the request (202); false for 409 or a failure. */
    suspend fun request(deviceId: String): Boolean
}

/** The app's one [DeviceUpdates]; set once when the app starts (`ParentApp`). */
object RemoteUpdates {
    lateinit var source: DeviceUpdates
}

/** After this many minutes an open request shows **Update now** again, to ask once more (docs/SPEC.md §12.11). */
const val ASK_AGAIN_MINUTES = 30L

/**
 * The device row's update line: "Version 0.1.8 · Up to date", "Version 0.1.8 · 0.1.9 is out" or
 * "Updating to 0.1.9 · asked 5 min ago". [appVersion] is what the device last reported (null before it has).
 */
fun updateLine(appVersion: String?, update: DeviceUpdate?, now: Instant): String = when {
    update == null -> if (appVersion == null) "Version not known yet" else "Version $appVersion · Up to date"
    update.requested -> "Updating to ${update.versionName} · ${askedAgo(update.requestedAt, now)}"
    appVersion == null -> "${update.versionName} is out"
    else -> "Version $appVersion · ${update.versionName} is out"
}

/** "asked just now", "asked 5 min ago", "asked 3h ago", "asked 2 days ago". */
fun askedAgo(requestedAt: Instant?, now: Instant): String {
    if (requestedAt == null) return "asked just now"
    val minutes = (now.epochSecond - requestedAt.epochSecond) / 60
    if (minutes < 1) return "asked just now"
    if (minutes < 60) return "asked $minutes min ago"
    val hours = minutes / 60
    if (hours < 24) return "asked ${hours}h ago"
    val days = hours / 24
    return if (days == 1L) "asked $days day ago" else "asked $days days ago"
}

/** Whether the row has **Update now**: when something newer is offered and not asked for, or asked for [ASK_AGAIN_MINUTES] ago. */
fun showsUpdateNow(update: DeviceUpdate?, now: Instant): Boolean = when {
    update == null -> false
    !update.requested -> true
    update.requestedAt == null -> false
    else -> (now.epochSecond - update.requestedAt.epochSecond) / 60 >= ASK_AGAIN_MINUTES
}
