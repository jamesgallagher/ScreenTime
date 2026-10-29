package au.screentime.parent.push

import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.EventItem
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject

/** CARD-042: the parent app's push helpers (docs/SPEC.md §13, §16.4). */

/**
 * The push's envelope as an event (docs/SPEC.md §13): null unless it is a JSON object with `"v": 1` and a
 * `data` object that decodes as an [EventItem] (unknown keys ignored). Any exception is null.
 */
fun parseEnvelope(msg: String): EventItem? = try {
    val root = ApiJson.parseToJsonElement(msg) as? JsonObject ?: return null
    val v = root["v"] as? JsonPrimitive
    if (v == null || v.content != "1") return null
    val data = root["data"] as? JsonObject ?: return null
    ApiJson.decodeFromString<EventItem>(data.toString())
} catch (e: Exception) {
    null
}

/** The four notification channel ids (docs/SPEC.md §13). */
const val CHANNEL_CRITICAL = "critical"
const val CHANNEL_ALERTS = "alerts"
const val CHANNEL_REQUESTS = "requests"
const val CHANNEL_INFO = "info"

/** Which channel an event kind goes on (docs/SPEC.md §13). */
fun channelFor(kind: String): String = when {
    kind.startsWith("sos.") -> CHANNEL_CRITICAL
    kind.startsWith("tamper.") || kind.startsWith("parent_mode.") -> CHANNEL_ALERTS
    kind == "time_request" || kind == "kid_message" -> CHANNEL_REQUESTS
    else -> CHANNEL_INFO
}

/** The payload's `requestId` for a `parent_mode.request`, else null. */
fun requestIdOf(e: EventItem): String? {
    if (e.kind != "parent_mode.request") return null
    val value = e.payload["requestId"] as? JsonPrimitive
    return if (value != null && value.isString) value.content else null
}

/** How long parent mode can be turned on for, in minutes; null is "Until I end it" (docs/SPEC.md §12.3). */
val PARENT_MODE_MINUTES: List<Int?> = listOf(2, 5, 15, 60, null)

/** "2 min", "1 hour", "Until I end it". */
fun durationText(minutes: Int?): String = when (minutes) {
    null -> "Until I end it"
    60 -> "1 hour"
    else -> "$minutes min"
}

/** The approval page's title. */
fun approveTitle(kidName: String): String = "Parent mode for $kidName?"

/** The approval page's second line. */
fun approveText(deviceName: String?): String {
    val name = deviceName ?: "A device"
    return "$name is asking. Time doesn't count and the device is unlocked while it is on."
}

/**
 * The 6-digit parent code for the base32 [secret] at [nowMs] (RFC 6238, HMAC-SHA1, 30-second steps), or null
 * when the secret is empty or not base32.
 */
fun codeAt(secret: String, nowMs: Long): String? {
    val key = base32Decode(secret) ?: return null
    if (key.isEmpty()) return null
    return parentCode(key, nowMs)
}

/** Seconds until the next code: 30 down to 1. */
fun secondsLeft(nowMs: Long): Int = 30 - ((nowMs % 30_000L) / 1000).toInt()

/** The 6-digit code for [key] in the 30-second step that holds [timeMs]. */
private fun parentCode(key: ByteArray, timeMs: Long): String {
    val mac = Mac.getInstance("HmacSHA1")
    mac.init(SecretKeySpec(key, "HmacSHA1"))
    val hash = mac.doFinal(ByteBuffer.allocate(8).putLong(Math.floorDiv(timeMs, STEP_MS)).array())
    val at = hash[hash.size - 1].toInt() and 0x0F
    val number = ((hash[at].toInt() and 0x7F) shl 24) or
        ((hash[at + 1].toInt() and 0xFF) shl 16) or
        ((hash[at + 2].toInt() and 0xFF) shl 8) or
        (hash[at + 3].toInt() and 0xFF)
    return (number % 1_000_000).toString().padStart(6, '0')
}

/** RFC 4648 base32 (`A`–`Z`, `2`–`7`), any case, `=` padding ignored; null for any other character. */
private fun base32Decode(text: String): ByteArray? {
    val out = ByteArrayOutputStream()
    var buffer = 0
    var bits = 0
    for (c in text.uppercase()) {
        if (c == '=') continue
        val value = BASE32.indexOf(c)
        if (value < 0) return null
        buffer = ((buffer shl 5) or value) and 0xFFFF
        bits += 5
        if (bits >= 8) {
            bits -= 8
            out.write((buffer shr bits) and 0xFF)
        }
    }
    return out.toByteArray()
}

private const val BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
private const val STEP_MS = 30_000L
