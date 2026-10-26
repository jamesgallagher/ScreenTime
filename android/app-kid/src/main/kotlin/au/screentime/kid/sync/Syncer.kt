package au.screentime.kid.sync

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.UsageSegmentIn
import au.screentime.core.model.api.UsageUpload
import au.screentime.kid.usage.LocalSegment
import au.screentime.kid.usage.SegmentStore
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlin.coroutines.cancellation.CancellationException

/** The last snapshot from `GET /v1/device/state` and its `ETag`. */
data class CachedState(val etag: String?, val state: DeviceState)

/** Where the last snapshot is kept, so the device enforces from it while offline (docs/SPEC.md §8.2). */
interface StateStore {
    fun load(): CachedState?

    fun save(cached: CachedState)
}

/**
 * One sync (docs/SPEC.md §8.2, §8.3): upload every changed segment, then fetch the snapshot with `If-None-Match`.
 * Every answer from the server sets the trusted clock.
 */
class Syncer(
    private val api: ApiClient,
    private val segments: SegmentStore,
    private val states: StateStore,
    private val clock: TrustedClock,
    private val log: (String) -> Unit = {},
) {
    /** True when both steps worked. On false nothing is lost: the segments stay in the outbox. */
    suspend fun sync(): Boolean = try {
        upload()
        fetchState()
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        log("sync failed: $e")
        false
    }

    private suspend fun upload() {
        while (true) {
            val batch = segments.pending(BATCH)
            if (batch.isEmpty()) return
            api.postDeviceUsage(UsageUpload(batch.map { it.segment.toUpload() }))
            for (pending in batch) segments.markSent(pending.segment.id, pending.version)
            if (batch.size < BATCH) return
        }
    }

    private suspend fun fetchState() {
        val cached = states.load()
        val answer = api.getDeviceState(ifNoneMatch = cached?.etag)
        val state = answer.value
        if (state != null) {
            states.save(CachedState(answer.etag, state))
            clock.onServerTime(OffsetDateTime.parse(state.serverTime).toInstant().toEpochMilli())
        } else {
            // 304 Not Modified: no body, so the server time is the Date header.
            val date = answer.date ?: return
            clock.onServerTime(ZonedDateTime.parse(date, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli())
        }
    }

    private companion object {
        /** The most `POST /v1/device/usage` takes in one call. */
        const val BATCH = 500
    }
}

/** The upload form of a segment: ISO 8601 times in UTC. */
fun LocalSegment.toUpload() = UsageSegmentIn(
    id = id,
    startedAt = Instant.ofEpochMilli(startedAtMs).toString(),
    endedAt = endedAtMs?.let { Instant.ofEpochMilli(it).toString() },
    recordedOffline = recordedOffline,
)
