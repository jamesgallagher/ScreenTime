package au.screentime.parent.sos

import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.SosAck
import au.screentime.core.model.api.SosLocation
import au.screentime.core.model.api.SosLocationVia
import java.time.Duration
import java.time.Instant
import java.util.Locale
import kotlinx.serialization.json.JsonPrimitive

/** CARD-044: the parent app's SOS words and rules (docs/SPEC.md §15). */

/**
 * The SOS id a push names, when the event is an SOS event: the payload's string `sosId`, or null.
 */
fun sosIdOf(e: EventItem): String? {
    if (!e.kind.startsWith("sos.")) return null
    val value = e.payload["sosId"] as? JsonPrimitive
    return if (value != null && value.isString) value.content else null
}

/** Whether this push rings the alarm: a `sos.started` that names an SOS. */
fun ringsAlarm(e: EventItem): Boolean = e.kind == "sos.started" && sosIdOf(e) != null

/** Whether this push stops the alarm: a `sos.ended`. */
fun stopsAlarm(e: EventItem): Boolean = e.kind == "sos.ended"

/** The SOS page's title. */
fun sosTitle(kidName: String): String = "SOS from $kidName"

/** "just now", "N min ago", or "Hh Mm ago": the whole minutes between [at] and [now], never below 0. */
fun agoText(at: Instant, now: Instant): String {
    val minutes = (Duration.between(at, now).toSeconds() / 60L).toInt().coerceAtLeast(0)
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min ago"
        else -> "${minutes / 60}h ${minutes % 60}m ago"
    }
}

/**
 * How fresh and how exact the kid's last position is, in plain words: "Updated 1 min ago · within 20 m", plus
 * "· by text" when it came by SMS. "Waiting for a location" before the first one.
 */
fun seenText(loc: SosLocation?, now: Instant): String {
    if (loc == null) return "Waiting for a location"
    val parts = mutableListOf("Updated ${agoText(Instant.parse(loc.at), now)}")
    val accuracy = loc.accuracyM
    // A no-break space keeps "20 m" on one line.
    if (accuracy != null) parts.add("within ${Math.round(accuracy).toInt()}\u00A0m")
    if (loc.via == SosLocationVia.SMS) parts.add("by text")
    return parts.joinToString(" · ")
}

/** "Battery 54%", or null when the position has no battery. */
fun batteryText(loc: SosLocation?): String? {
    val pct = loc?.batteryPct ?: return null
    return "Battery $pct%"
}

/** A geo: link that opens the phone's maps app at the position, named after the kid. */
fun mapsUri(loc: SosLocation, kidName: String): String {
    val lat = String.format(Locale.ROOT, "%.5f", loc.lat)
    val lng = String.format(Locale.ROOT, "%.5f", loc.lng)
    val name = kidName.replace("(", "").replace(")", "")
    return "geo:0,0?q=$lat,$lng($name)"
}

/** Who is on it: the distinct parent names, oldest first. */
fun acksText(acks: List<SosAck>): String {
    val names = acks.map { it.byName }.distinct()
    return when {
        names.isEmpty() -> "No one has said they're on it yet"
        names.size == 1 -> "${names[0]} is on it"
        else -> {
            val last = names.last()
            "${names.dropLast(1).joinToString(", ")} and $last are on it"
        }
    }
}

/** The words for an ended SOS: [endedBy] is the wire value. */
fun endedText(endedBy: String?, byName: String?, kidName: String): String = when (endedBy) {
    "kid" -> "$kidName said they're safe"
    "parent" -> if (byName != null) "Ended by $byName" else "Ended by a parent"
    else -> "Stopped by itself"
}
