package au.screentime.kid.parentmode

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.DeviceStateParentMode
import au.screentime.core.model.api.ParentModeByCode
import au.screentime.core.model.api.ParentModeRequestCreate
import au.screentime.kid.ask.SendResult
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.time.Instant
import java.time.OffsetDateTime
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.coroutines.cancellation.CancellationException

/** How long parent mode can be turned on for, in minutes; null is "Until I end it" (docs/SPEC.md §12.3). */
val PARENT_MODE_MINUTES: List<Int?> = listOf(2, 5, 15, 60, null)

/** "2 min", "1 hour", "Until I end it". */
fun durationText(minutes: Int?): String = when (minutes) {
    null -> "Until I end it"
    60 -> "1 hour"
    else -> "$minutes min"
}

/**
 * Parent mode started on this device with the parent code (docs/SPEC.md §12.3). Times are trusted-clock epoch
 * milliseconds. [reportedAtMs] is set once the server has it.
 */
data class CodeSession(
    val id: String,
    val durationMin: Int?,
    val startedAtMs: Long,
    val reportedAtMs: Long? = null,
) {
    /** Null for "Until I end it". */
    val endsAtMs: Long? get() = durationMin?.let { startedAtMs + it * 60_000L }
}

/** What this device did about parent mode that the server may not know yet. */
data class LocalParentMode(
    val code: CodeSession? = null,
    /** When **End now** was last tapped on this device. */
    val endedAtMs: Long? = null,
    /** False until the server has that **End now**. */
    val endReported: Boolean = true,
) {
    /** Something still to send to the server. */
    val pending: Boolean get() = (code != null && code.reportedAtMs == null) || !endReported
}

/** Parent mode is on until [endsAtMs] (null: until a parent ends it), started by [byName] (null: the parent code). */
data class ParentModeOn(val endsAtMs: Long?, val byName: String?)

/**
 * Whether parent mode is on at [nowMs]: from the snapshot ([server], fetched at the server's [serverTimeMs]), or
 * from what this device did itself. A code session the server does not have yet counts, and so does one the server
 * got after this snapshot was made. An **End now** on this device beats a snapshot made before it.
 */
fun parentModeNow(server: DeviceStateParentMode, serverTimeMs: Long, local: LocalParentMode, nowMs: Long): ParentModeOn? {
    val ended = local.endedAtMs
    val code = local.code
    if (code != null && (ended == null || ended < code.startedAtMs)) {
        val endsAt = code.endsAtMs
        val reported = code.reportedAtMs
        val notInSnapshot = reported == null || serverTimeMs < reported
        if (notInSnapshot && (endsAt == null || nowMs < endsAt)) return ParentModeOn(endsAt, null)
    }
    if (!server.active || (ended != null && serverTimeMs <= ended)) return null
    val endsAt = server.endsAt?.let { OffsetDateTime.parse(it).toInstant().toEpochMilli() }
    return if (endsAt == null || nowMs < endsAt) ParentModeOn(endsAt, server.byName) else null
}

/**
 * Whether [code] is the parent code at [nowMs] for the family's base32 [secret]: a 6-digit TOTP (RFC 6238, SHA-1,
 * 30-second steps), one step either side also accepted (docs/SPEC.md §12.3).
 */
fun codeOk(secret: String, code: String, nowMs: Long): Boolean {
    val key = base32Decode(secret) ?: return false
    if (key.isEmpty() || code.length != 6 || !code.all { it in '0'..'9' }) return false
    return (-1..1).any { parentCode(key, nowMs + it * STEP_MS) == code }
}

/** The 6-digit code for [key] in the 30-second step that holds [timeMs]. */
fun parentCode(key: ByteArray, timeMs: Long): String {
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
fun base32Decode(text: String): ByteArray? {
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

/** Parent mode's calls to the server (docs/SPEC.md §9.3). */
class ParentModeApi(private val api: ApiClient) {
    /**
     * "I'm the parent": every parent gets a push to approve. [id] is made once when the screen opens, so a retry
     * does not ask twice. A 409 means parent mode is already on, which is what the kid wanted.
     */
    suspend fun request(id: String): SendResult = try {
        api.postDeviceParentModeRequests(ParentModeRequestCreate(id))
        SendResult.SENT
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiException) {
        if (e.status == 409) SendResult.SENT else SendResult.FAILED
    } catch (e: IOException) {
        SendResult.OFFLINE
    } catch (e: Exception) {
        SendResult.FAILED
    }

    /**
     * Sends what the server does not have yet: a code session, then an **End now**, in that order. Returns [local]
     * with what was sent marked; what failed for want of a connection stays to be sent next time. Any answer from
     * the server counts as sent: sending it again would get the same answer.
     */
    suspend fun flush(local: LocalParentMode, nowMs: Long): LocalParentMode {
        var out = local
        val code = local.code
        if (code != null && code.reportedAtMs == null) {
            val sent = deliver {
                api.postDeviceParentMode(
                    ParentModeByCode(code.id, code.durationMin, Instant.ofEpochMilli(code.startedAtMs).toString()),
                )
            }
            if (!sent) return out
            out = out.copy(code = code.copy(reportedAtMs = nowMs))
        }
        if (!local.endReported && deliver { api.postDeviceParentModeEnd() }) out = out.copy(endReported = true)
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
