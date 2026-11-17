package au.screentime.parent.inbox

import au.screentime.core.model.api.TimeRequest
import au.screentime.core.model.api.WaitingItem

/**
 * Maps a server [WaitingItem] to a [Waiting] for the strip. Returns null for an unknown kind, or when a
 * kind-specific field is missing (for example a `time_request` with `request` null).
 */
fun waitingFrom(item: WaitingItem): Waiting? = when (item.kind) {
    "time_request" -> {
        val request = item.request ?: return null
        Waiting.Time(request, eventId = item.eventId)
    }
    "parent_mode_request" -> {
        val expiresAt = item.expiresAt ?: return null
        Waiting.ParentMode(
            requestId = item.id,
            kidName = item.kidName,
            deviceName = item.deviceName,
            at = item.at,
            expiresAt = expiresAt,
            eventId = item.eventId,
        )
    }
    "app_approval" -> {
        val packageName = item.`package` ?: return null
        Waiting.NewApp(
            kidId = item.kidId,
            kidName = item.kidName,
            packageName = packageName,
            label = item.label ?: "an app",
            source = item.source,
            deviceName = item.deviceName,
            at = item.at,
            eventId = item.eventId,
        )
    }
    "kid_message" -> {
        val body = item.body ?: return null
        Waiting.Message(
            messageId = item.id,
            kidName = item.kidName,
            deviceName = item.deviceName,
            body = body,
            at = item.at,
            eventId = item.eventId,
        )
    }
    else -> null
}

/**
 * The notification tags that are stale: every `waiting:` tag in [active] whose event id is not an
 * `eventId` of [waiting]. Null tags and tags without the `waiting:` prefix are ignored.
 */
fun staleTags(active: List<String?>, waiting: List<Waiting>): List<String> {
    val waitingIds = waiting.map { it.eventId }.filterNotNull().toSet()
    return active.filterNotNull().filter { tag ->
        tag.startsWith("waiting:") && tag.removePrefix("waiting:") !in waitingIds
    }
}
