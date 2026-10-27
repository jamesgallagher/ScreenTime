package au.screentime.kid.live

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** What the device sends every 30 seconds to keep the socket alive (docs/SPEC.md §10). */
const val PING = """{"type":"ping"}"""

/**
 * The live channel's address for [serverUrl] (`GET /v1/device/ws`, docs/SPEC.md §9): `https` becomes `wss` and
 * `http` becomes `ws`.
 */
fun liveUrl(serverUrl: String): String {
    val base = serverUrl.trimEnd('/')
    val socket = when {
        base.startsWith("https://") -> "wss://" + base.removePrefix("https://")
        base.startsWith("http://") -> "ws://" + base.removePrefix("http://")
        else -> throw IllegalArgumentException("not an http or https address: $serverUrl")
    }
    return "$socket/v1/device/ws"
}

/**
 * How long to wait before reconnect number [attempt] (0 for the first): 1, 2, 4 … 60 seconds, times [jitter],
 * which is between 0.8 and 1.2 (docs/SPEC.md §8.3, ±20%).
 */
fun backoffMs(attempt: Int, jitter: Double): Long {
    val base = minOf(1_000L shl attempt.coerceIn(0, 6), 60_000L)
    return (base * jitter).toLong()
}

/**
 * True when a frame from the server means "sync now": any envelope (docs/SPEC.md §10) except `pong`. A frame that
 * is not a JSON object with a `type` means nothing.
 */
fun asksForSync(frame: String): Boolean {
    val type = try {
        (Json.parseToJsonElement(frame) as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull
    } catch (e: IllegalArgumentException) {
        // Not JSON (SerializationException is an IllegalArgumentException), or a `type` that is not a string.
        null
    }
    return type != null && type != "pong"
}
