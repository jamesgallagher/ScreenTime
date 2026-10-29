package au.screentime.parent.inbox

import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.TimeRequest
import au.screentime.core.time.formatDuration
import au.screentime.parent.today.poolName
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.abs
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The colour of an event's dot in the history. */
enum class EventTone { SOS, ALERT, REQUEST, MESSAGE, TIME, INFO }

/** One history row: the line, an optional second line, and the dot's colour. */
data class EventView(val text: String, val detail: String?, val tone: EventTone)

/** The request card's title: "Alex wants 30m more Phone". */
fun requestTitle(r: TimeRequest): String =
    "${r.kidName} wants ${formatDuration(r.minutes * 60L)} more ${poolName(r.pool)}"

/** The request card's second line: the reason in curly quotes, or nothing when it is missing or blank. */
fun requestDetail(r: TimeRequest): String? {
    val reason = r.reason
    return if (reason != null && reason.isNotBlank()) "“$reason”" else null
}

/** A text field: only a string primitive counts. */
private fun text(payload: JsonObject, key: String): String? {
    val value = payload[key] as? JsonPrimitive
    return if (value != null && value.isString) value.content else null
}

/** A number field: only a non-string primitive counts; a string where a number belongs is not read as the number. */
private fun number(payload: JsonObject, key: String): Int? {
    val value = payload[key] as? JsonPrimitive
    // JsonPrimitive in this build has no intOrNull: read the number from the content of a non-string primitive.
    return if (value != null && !value.isString) value.content.toIntOrNull() else null
}

/** A boolean field: only a non-string primitive counts. */
private fun boolean(payload: JsonObject, key: String): Boolean? {
    val value = payload[key] as? JsonPrimitive
    // JsonPrimitive in this build has no booleanOrNull: read the boolean from the content of a non-string primitive.
    return if (value != null && !value.isString) value.content.toBoolean() else null
}

/**
 * One line of the event history (docs/SPEC.md §13) in plain words. Payload fields are read defensively:
 * an event from a newer server, or with a missing field, still reads as something sensible.
 */
fun eventView(e: EventItem, zone: ZoneId): EventView {
    val p = e.payload
    val kid = e.kidName ?: "A kid"
    val device = e.deviceName ?: text(p, "deviceName") ?: "a device"
    val by = text(p, "byName")
    val byOrParent = by ?: "A parent"
    val pool = when (text(p, "pool")) {
        "screens" -> "Screens"
        "phone" -> "Phone"
        else -> "time"
    }
    fun mins(m: Int): String = formatDuration(abs(m) * 60L)
    return when (e.kind) {
        "time_request" -> {
            val minutes = number(p, "minutes") ?: 0
            val reason = text(p, "reason")
            EventView("$kid asked for ${mins(minutes)} more $pool", reason?.let { "“$it”" }, EventTone.REQUEST)
        }
        "time_request.resolved" -> if (boolean(p, "approved") == true) {
            val minutes = number(p, "minutes") ?: 0
            EventView("$byOrParent said yes to $kid: ${mins(minutes)} more", null, EventTone.TIME)
        } else {
            EventView("$byOrParent said no to $kid's request", null, EventTone.INFO)
        }
        "grant.added" -> {
            val minutes = number(p, "minutes") ?: 0
            when {
                boolean(p, "lockNow") == true -> EventView("$byOrParent locked $kid's $pool", null, EventTone.TIME)
                minutes >= 0 -> EventView("$byOrParent added ${mins(minutes)} of $pool for $kid", null, EventTone.TIME)
                else -> EventView("$byOrParent took away ${mins(minutes)} of $pool from $kid", null, EventTone.TIME)
            }
        }
        "kid_message" -> EventView("Message from $kid", "“${text(p, "body") ?: ""}”", EventTone.MESSAGE)
        "parent_mode.request" -> EventView("$kid asked for parent mode on $device", null, EventTone.REQUEST)
        "parent_mode.used" -> {
            val duration = number(p, "durationMin")
            val length = when (duration) {
                null -> "until ended"
                60 -> "for 1 hour"
                else -> "for $duration min"
            }
            EventView("Parent mode on $device $length", by?.let { "Started by $it" } ?: "Started with the parent code", EventTone.INFO)
        }
        "parent_mode.denied" -> EventView("$byOrParent said no to parent mode on $device", null, EventTone.INFO)
        "parent_mode.ended" -> EventView("Parent mode ended on $device", by?.let { "Ended by $it" }, EventTone.INFO)
        "sos.started" -> EventView("SOS from $kid", "On $device", EventTone.SOS)
        "sos.acked" -> EventView("$byOrParent is on $kid's SOS", null, EventTone.SOS)
        "sos.extended" -> {
            val until = text(p, "autoStopAt")
            EventView("$byOrParent kept $kid's SOS on", until?.let { "Until ${timeOfDay(Instant.parse(it), zone)}" }, EventTone.SOS)
        }
        "sos.ended" -> {
            val endedBy = text(p, "endedBy")
            val line = when (endedBy) {
                "kid" -> "$kid ended the SOS: safe"
                "auto" -> "$kid's SOS stopped by itself"
                else -> "$byOrParent ended $kid's SOS"
            }
            EventView(line, null, EventTone.SOS)
        }
        "overspend" -> {
            val overspendSec = number(p, "overspendSec") ?: 0
            EventView(
                "$kid went ${formatDuration(overspendSec.toLong())} over on $pool",
                "$device was offline, so it could not know the time had run out",
                EventTone.ALERT,
            )
        }
        "device.offline" -> {
            val lastSeenAt = text(p, "lastSeenAt")
            EventView("$device is offline", lastSeenAt?.let { "Last seen at ${timeOfDay(Instant.parse(it), zone)}" }, EventTone.INFO)
        }
        "device.enrolled" -> EventView("${text(p, "name") ?: device} was added for $kid", null, EventTone.INFO)
        else -> if (e.kind.startsWith("tamper.")) {
            val what = when (e.kind) {
                "tamper.clock" -> "the clock was changed"
                "tamper.timezone" -> "the time zone was changed"
                "tamper.tray_killed" -> "the ScreenTime tray app was closed"
                "tamper.policy" -> "a protected setting was changed"
                "tamper.call_blocked" -> "a call was blocked"
                else -> "something was tampered with"
            }
            val num = text(p, "number")
            EventView("$device: $what", num?.let { "Number: $it" }, EventTone.ALERT)
        } else {
            EventView(e.kind, null, EventTone.INFO)
        }
    }
}

/** "3:30 pm" in the family's time zone. */
fun timeOfDay(instant: Instant, zone: ZoneId): String {
    val formatter = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)
    return instant.atZone(zone).format(formatter).lowercase()
}

/** "3:30 pm" today, "Yesterday, 3:42 pm", then "Sat 24 Oct, 9:00 am", in the family time zone. */
fun whenText(at: String, now: Instant, zone: ZoneId): String {
    val instant = Instant.parse(at)
    val time = timeOfDay(instant, zone)
    val day = { i: Instant -> i.atZone(zone).toLocalDate().toString() }
    if (day(instant) == day(now)) return time
    if (day(instant) == day(now.minus(1, ChronoUnit.DAYS))) return "Yesterday, $time"
    val date = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH).format(instant.atZone(zone).toLocalDate())
    return "$date, $time"
}

/** The history's day heading: "Today", "Yesterday", then "Saturday 24 October", in the family time zone. */
fun dayHeading(at: String, now: Instant, zone: ZoneId): String {
    val day = Instant.parse(at).atZone(zone).toLocalDate()
    val today = now.atZone(zone).toLocalDate()
    return when (day) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.ENGLISH).format(day)
    }
}

/** The history split into days, newest first, each with its heading (the events arrive newest first). */
fun byDay(events: List<EventItem>, now: Instant, zone: ZoneId): List<Pair<String, List<EventItem>>> =
    events.groupBy { dayHeading(it.at, now, zone) }.toList()

/** The words for a Yes or No that did not work. */
fun answerError(e: Exception): String = when {
    e is ApiException && e.status == 409 -> "Someone already answered this request."
    e is ApiException && e.status == 404 -> "This request is gone."
    e is ApiException -> "Something went wrong on the server. Try again soon."
    else -> "Can't reach Screen Time. Check the internet connection and try again."
}
