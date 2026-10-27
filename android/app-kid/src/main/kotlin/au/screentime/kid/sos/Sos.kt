package au.screentime.kid.sos

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.DeviceStateActiveSos
import au.screentime.core.model.api.Opt
import au.screentime.core.model.api.SosLocationIn
import au.screentime.core.model.api.SosLocationInVia
import au.screentime.core.model.api.SosLocationsUpload
import au.screentime.core.model.api.SosStart
import au.screentime.kid.calls.Callable
import au.screentime.kid.status.parentsText
import java.time.DateTimeException
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.roundToInt
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** An SOS stops by itself this long after it starts, unless a parent keeps it on (docs/SPEC.md §15). */
const val SOS_RUN_MS = 2 * 60 * 60_000L

/** How often the phone takes a position and sends what it has during an SOS. */
const val SOS_TICK_MS = 30_000L

/** Without a connection to the server, a text with the position this often. */
const val SOS_TEXT_EVERY_MS = 5 * 60_000L

/** One position. [atMs] is trusted-clock time; [bySms] is true once a text carried it to the parents. */
data class SosFix(
    val atMs: Long,
    val lat: Double,
    val lng: Double,
    /** Radius in metres. */
    val accuracyM: Double?,
    val batteryPct: Int?,
    val bySms: Boolean = false,
)

/** Who ended an SOS. */
enum class SosEnd { KID, PARENT, AUTO }

/**
 * The SOS on this phone, from the countdown until the server has everything (docs/SPEC.md §15). Times are trusted-clock
 * epoch milliseconds. An ended SOS stays until its start, its positions, its end and the "ended" text have all gone.
 */
data class LocalSos(
    val id: String,
    val startedAtMs: Long,
    val autoStopAtMs: Long,
    /** The position in the first text, sent with the start. */
    val startFix: SosFix? = null,
    /** When the server got the start; null until then. */
    val startReportedAtMs: Long? = null,
    /** Positions the server does not have yet, oldest first. */
    val queue: List<SosFix> = emptyList(),
    /** The newest position taken in. */
    val lastFix: SosFix? = null,
    /** The last time the server answered. */
    val lastDataAtMs: Long? = null,
    /** The last text to the parents. */
    val lastTextAtMs: Long? = null,
    /** "Dad", in the order they said "I'm on it". */
    val seenBy: List<String> = emptyList(),
    val endedAtMs: Long? = null,
    val endedBy: SosEnd? = null,
    /** The parent who ended it, when the server said. */
    val endedByName: String? = null,
    /** False until the server has the kid's "I'm safe". */
    val endReported: Boolean = false,
    val endTextSent: Boolean = false,
) {
    val active: Boolean get() = endedAtMs == null

    /** Ended, and nothing more to send: the phone can forget it. */
    val done: Boolean
        get() = !active && endReported && endTextSent && startReportedAtMs != null && queue.isEmpty()
}

/** A new SOS at [nowMs], when the countdown has finished. */
fun startSos(id: String, nowMs: Long): LocalSos = LocalSos(id, nowMs, nowMs + SOS_RUN_MS)

/** Takes [fix] in, if it is newer than the last one: it goes to the server with the next send. */
fun LocalSos.withFix(fix: SosFix): LocalSos {
    if (!active || fix.atMs <= (lastFix?.atMs ?: Long.MIN_VALUE)) return this
    return copy(queue = queue + fix, lastFix = fix)
}

/** No answer from the server for 5 minutes since the last text: time to text the position again. */
fun LocalSos.textDue(nowMs: Long): Boolean =
    active && nowMs - maxOf(lastTextAtMs ?: startedAtMs, lastDataAtMs ?: Long.MIN_VALUE) >= SOS_TEXT_EVERY_MS

/** A text went at [nowMs] with [lastFix], which the server then gets as `via: sms`. */
fun LocalSos.textSent(nowMs: Long): LocalSos {
    val sent = lastFix?.atMs
    return copy(lastTextAtMs = nowMs, queue = queue.map { if (it.atMs == sent) it.copy(bySms = true) else it })
}

/** The kid held **I'm safe**. */
fun LocalSos.endedByKid(nowMs: Long): LocalSos =
    if (active) copy(endedAtMs = nowMs, endedBy = SosEnd.KID) else this

/** Past [LocalSos.autoStopAtMs]: it stops by itself, and the server does the same on its own (docs/SPEC.md §15 step 9). */
fun LocalSos.autoStopped(nowMs: Long): LocalSos =
    if (active && nowMs >= autoStopAtMs) copy(endedAtMs = autoStopAtMs, endedBy = SosEnd.AUTO, endReported = true) else this

/**
 * The snapshot says no SOS, or another one, although the server had this one before the snapshot was made: a parent
 * ended it and the message did not reach the phone.
 */
fun LocalSos.checkedAgainst(activeSos: DeviceStateActiveSos?, serverTimeMs: Long, nowMs: Long): LocalSos {
    val reported = startReportedAtMs ?: return this
    if (!active || serverTimeMs <= reported || activeSos?.id == id) return this
    return copy(endedAtMs = nowMs, endedBy = SosEnd.PARENT, endReported = true)
}

/** What a parent did, from a `sos_ack`, `sos_extended` or `sos_ended` message (docs/SPEC.md §10). */
data class SosNews(val type: String, val sosId: String, val byName: String, val autoStopAtMs: Long?)

/** The [SosNews] in an envelope, or null for any other frame. */
fun sosNewsOf(frame: String): SosNews? = try {
    val envelope = Json.parseToJsonElement(frame) as? JsonObject
    val type = envelope?.get("type")?.jsonPrimitive?.contentOrNull
    val data = envelope?.get("data") as? JsonObject
    val sosId = data?.get("sosId")?.jsonPrimitive?.contentOrNull
    val byName = data?.get("byName")?.jsonPrimitive?.contentOrNull
    if (type == null || type !in SOS_NEWS || sosId == null || byName == null) {
        null
    } else {
        val autoStopAt = data["autoStopAt"]?.jsonPrimitive?.contentOrNull
        SosNews(type, sosId, byName, autoStopAt?.let { OffsetDateTime.parse(it).toInstant().toEpochMilli() })
    }
} catch (e: IllegalArgumentException) {
    // Not JSON (SerializationException is an IllegalArgumentException).
    null
} catch (e: DateTimeException) {
    // An `autoStopAt` that is not a time.
    null
}

private val SOS_NEWS = setOf("sos_ack", "sos_extended", "sos_ended")

/** [news] for this SOS: who has seen it, a later auto stop, or a parent's end. News for another SOS changes nothing. */
fun LocalSos.withNews(news: SosNews, nowMs: Long): LocalSos {
    if (news.sosId != id || !active) return this
    return when (news.type) {
        "sos_ack" -> if (news.byName in seenBy) this else copy(seenBy = seenBy + news.byName)
        "sos_extended" -> news.autoStopAtMs?.let { copy(autoStopAtMs = it) } ?: this
        "sos_ended" -> copy(endedAtMs = nowMs, endedBy = SosEnd.PARENT, endedByName = news.byName, endReported = true)
        else -> this
    }
}

/** "https://maps.google.com/?q=-33.86880,151.20930 (±20 m)". */
fun mapsText(fix: SosFix): String {
    val link = String.format(Locale.ROOT, "https://maps.google.com/?q=%.5f,%.5f", fix.lat, fix.lng)
    return fix.accuracyM?.let { "$link (±${it.roundToInt()} m)" } ?: link
}

/**
 * The text to every parent with a mobile (docs/SPEC.md §15 step 2): "SOS from Alex. Location: https://maps…
 * (±20 m). Battery 54%." [again] for the texts every 5 minutes without data, which also say how old the position is.
 */
fun sosText(kidName: String, fix: SosFix?, batteryPct: Int?, nowMs: Long, again: Boolean = false): String {
    val head = if (again) "SOS from $kidName, still on." else "SOS from $kidName."
    val place = when {
        fix == null -> " No location yet."
        again && nowMs - fix.atMs >= 60_000L -> " Location ${(nowMs - fix.atMs) / 60_000L} min ago: ${mapsText(fix)}."
        else -> " Location: ${mapsText(fix)}."
    }
    val battery = batteryPct?.let { " Battery $it%." } ?: ""
    return head + place + battery
}

/** "Alex is safe: SOS ended. Last location: https://maps…", and the same for a parent's end or the auto stop. */
fun sosEndText(kidName: String, sos: LocalSos): String {
    val head = when (sos.endedBy) {
        SosEnd.KID -> "$kidName is safe: SOS ended."
        SosEnd.PARENT -> sos.endedByName?.let { "$kidName's SOS was ended by $it." } ?: "$kidName's SOS has ended."
        SosEnd.AUTO, null -> "$kidName's SOS has stopped by itself."
    }
    return head + (sos.lastFix?.let { " Last location: ${mapsText(it)}." } ?: "")
}

/** How far the SOS has got, for the screen. */
enum class SosStage {
    /** Waiting for a position and the server. */
    SENDING,

    /** The server has it: every parent got a push and an email. */
    SENT,

    /** No server yet, but the parents got a text. */
    TEXTED,
}

/** What the SOS screen shows (docs/SPEC.md §15 step 6). */
data class SosView(
    val stage: SosStage,
    /** "Dad", "Mum": the parents who said "I'm on it". */
    val seenBy: List<String>,
    /** The call buttons: the parents with a mobile. */
    val parents: List<Callable>,
    /** "Mum and Dad". */
    val parentsAnd: String,
    val emergencyNumber: String,
) {
    /** "Telling Mum and Dad…", "Sent to Mum and Dad. They can see where you are.", or the no-internet line. */
    fun line(): String = when (stage) {
        SosStage.SENDING -> "Telling $parentsAnd…"
        SosStage.SENT -> "Sent to $parentsAnd. They can see where you are."
        SosStage.TEXTED -> "No internet. We texted $parentsAnd where you are."
    }

    /** "Dad has seen your SOS", "Mum and Dad have seen your SOS", or null before anyone has. */
    fun seenLine(): String? = when (seenBy.size) {
        0 -> null
        1 -> "${seenBy[0]} has seen your SOS"
        else -> "${parentsText(seenBy, "and")} have seen your SOS"
    }
}

/** The screen's view of an active SOS; null when there is none. */
fun LocalSos?.view(parents: List<Callable>, parentNames: List<String>, emergencyNumber: String): SosView? {
    if (this == null || !active) return null
    val stage = when {
        startReportedAtMs != null -> SosStage.SENT
        lastTextAtMs != null -> SosStage.TEXTED
        else -> SosStage.SENDING
    }
    return SosView(stage, seenBy, parents, parentsText(parentNames, "and"), emergencyNumber)
}

/** The SOS calls to the server (docs/SPEC.md §9.3). */
class SosApi(private val api: ApiClient) {
    /**
     * Sends what the server does not have yet, in order: the start, the positions (100 at a time), the kid's end.
     * Stops at the first call that does not get through, and returns [sos] with what went marked. Any answer from the
     * server counts as sent: sending it again would get the same answer.
     */
    suspend fun flush(sos: LocalSos, nowMs: Long): LocalSos {
        var out = sos
        if (out.startReportedAtMs == null) {
            val start = SosStart(
                id = sos.id,
                startedAt = iso(sos.startedAtMs),
                location = sos.startFix?.let { Opt.Value(it.toApi()) } ?: Opt.Absent,
            )
            if (!deliver { api.postDeviceSos(start) }) return out
            out = out.copy(startReportedAtMs = nowMs, lastDataAtMs = nowMs)
        }
        while (out.queue.isNotEmpty()) {
            val batch = out.queue.take(100)
            if (!deliver { api.postDeviceSosLocations(sos.id, SosLocationsUpload(batch.map { it.toApi() })) }) return out
            out = out.copy(queue = out.queue.drop(batch.size), lastDataAtMs = nowMs)
        }
        if (!out.active && !out.endReported) {
            if (!deliver { api.postDeviceSosEnd(sos.id) }) return out
            out = out.copy(endReported = true, lastDataAtMs = nowMs)
        }
        return out
    }

    private suspend fun deliver(call: suspend () -> Unit): Boolean = try {
        call()
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiException) {
        true
    } catch (e: Exception) {
        false
    }
}

private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

private fun SosFix.toApi() = SosLocationIn(
    at = iso(atMs),
    lat = lat,
    lng = lng,
    accuracyM = accuracyM?.let { Opt.Value(it) } ?: Opt.Absent,
    batteryPct = batteryPct?.let { Opt.Value(it) } ?: Opt.Absent,
    via = if (bySms) SosLocationInVia.SMS else SosLocationInVia.DATA,
)
