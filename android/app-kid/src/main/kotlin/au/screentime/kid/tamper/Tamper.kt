package au.screentime.kid.tamper

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.DeviceEventIn
import au.screentime.core.model.api.DeviceEventKind
import au.screentime.core.model.api.DeviceEventUpload
import au.screentime.kid.status.parentsText
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.abs
import kotlin.math.roundToLong
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The phone's clock may be this far from trusted time before it counts as changed (docs/SPEC.md §14). */
const val CLOCK_SLACK_MS = 2 * 60_000L

/** The same kind of attempt again within this time is the same attempt: no second event, no second caught screen. */
const val REPEAT_MS = 60_000L

/** How long the caught screen stays up, in seconds. */
const val CAUGHT_SEC = 8

/** At most this many events wait to be sent; the oldest go first. */
const val MAX_QUEUE = 100

/** Events in one upload (docs/SPEC.md §9.2). */
const val MAX_UPLOAD = 50

/**
 * The phone's clock was set to [wallMs] while trusted time says [trustedMs]: the minutes it is ahead, rounded (negative
 * when behind), or null when it is within 2 minutes, which is only the clock putting itself right.
 */
fun clockJumpMin(wallMs: Long, trustedMs: Long): Long? {
    val diff = wallMs - trustedMs
    return if (abs(diff) > CLOCK_SLACK_MS) (diff / 60_000.0).roundToLong() else null
}

/**
 * The policies that were on after the last start and are off now, so someone turned them off (docs/SPEC.md §14).
 * A policy that is new in this version of the app was never on, so it is not missing.
 */
fun missingPolicies(before: Set<String>, now: Set<String>): List<String> = (before - now).sorted()

/** True when an attempt of the same kind was recorded less than a minute before [nowMs]. */
fun isRepeat(lastAtMs: Long?, nowMs: Long): Boolean = lastAtMs != null && nowMs - lastAtMs in 0 until REPEAT_MS

/** One event for `POST /v1/device/events`, at trusted time [atMs]. */
fun tamperEvent(id: String, kind: DeviceEventKind, atMs: Long, payload: Map<String, String> = emptyMap()): DeviceEventIn =
    DeviceEventIn(
        id = id,
        kind = kind,
        at = Instant.ofEpochMilli(atMs).toString(),
        payload = if (payload.isEmpty()) null else JsonObject(payload.mapValues { JsonPrimitive(it.value) }),
    )

/** The queue with [event] at the end, keeping only the newest [MAX_QUEUE]. */
fun List<DeviceEventIn>.plusEvent(event: DeviceEventIn): List<DeviceEventIn> = (this + event).takeLast(MAX_QUEUE)

/** What the caught screen says (docs/SPEC.md §14): a big emoji, a headline and one line under it. */
data class CaughtLine(val emoji: String, val title: String, val body: String)

/**
 * The [n]th caught screen: the three lines of docs/SPEC.md §14 take turns, with the kid's name and the parents'
 * names ("Mum and Dad have been told.", "Dad has been told.").
 */
fun caughtLine(n: Int, kidName: String, parentNames: List<String>): CaughtLine {
    val parents = parentsText(parentNames, "and")
    val told = if (parentNames.size == 1) "has" else "have"
    return when (Math.floorMod(n, 3)) {
        0 -> {
            val who = parents.replaceFirstChar { it.uppercase() }
            CaughtLine("🕵️", "Nice try, Agent $kidName!", "$who $told been told.")
        }
        1 -> CaughtLine("🚨", "Busted!", "The Time Police have filed a report.")
        else -> CaughtLine("💻", "Whoa there, hacker!", "This attempt has been sent to HQ ($parents).")
    }
}

/** Sends tamper events to the server (docs/SPEC.md §9.2). */
class TamperApi(private val api: ApiClient) {
    /**
     * Sends [queue], oldest first, [MAX_UPLOAD] at a time, and returns the events that went. Stops at the first upload
     * that does not get through. Any answer from the server counts as sent: sending it again would get the same answer.
     */
    suspend fun flush(queue: List<DeviceEventIn>): List<DeviceEventIn> {
        val sent = mutableListOf<DeviceEventIn>()
        for (batch in queue.chunked(MAX_UPLOAD)) {
            try {
                api.postDeviceEvents(DeviceEventUpload(batch))
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                // Stored or refused, it would be the same next time.
            } catch (e: Exception) {
                return sent
            }
            sent += batch
        }
        return sent
    }
}
