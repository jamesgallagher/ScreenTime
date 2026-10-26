package au.screentime.kid.usage

/**
 * One stretch of time this device was in use (docs/SPEC.md §12.1, "Counting"). [endedAtMs] is null while it is
 * still open. [lastSeenAtMs] is when the app last saw it in use; a segment left open by a crash or a power cut
 * ends there. [recordedOffline] is true when the server could not be reached while it was open (§8.4).
 */
data class LocalSegment(
    val id: String,
    val startedAtMs: Long,
    val endedAtMs: Long?,
    val lastSeenAtMs: Long,
    val recordedOffline: Boolean,
)

/** A segment waiting to be uploaded. [version] goes up with every change, so a change during an upload is sent again. */
data class PendingSegment(val segment: LocalSegment, val version: Int)

/** The device's own segments on disk: the outbox of `POST /v1/device/usage`. */
interface SegmentStore {
    /** The open segment, if there is one. */
    suspend fun open(): LocalSegment?

    /** Saves [segment] (new or changed) and marks it for upload. */
    suspend fun put(segment: LocalSegment)

    /** Moves [LocalSegment.lastSeenAtMs] without marking the segment for upload. */
    suspend fun touch(id: String, atMs: Long)

    /** Segments still open or ended at or after [fromMs]. */
    suspend fun since(fromMs: Long): List<LocalSegment>

    /** Up to [limit] segments with changes the server has not got yet, oldest first. */
    suspend fun pending(limit: Int): List<PendingSegment>

    /** The server has [version] of segment [id]. */
    suspend fun markSent(id: String, version: Int)

    /** Forgets segments that ended before [beforeMs] and were sent. */
    suspend fun prune(beforeMs: Long)
}

/**
 * Turns "unlocked" and "screen off" into segments. Timestamps only, no ticking timers: [tick] once a minute only
 * moves the last-seen time. Every call takes the trusted time from the caller.
 */
class Recorder(private val store: SegmentStore, private val newId: () -> String) {
    /** The kid unlocked the device: a new segment starts. One left open is closed where it was last seen. */
    suspend fun start(atMs: Long) {
        closeOpen()
        store.put(LocalSegment(newId(), atMs, null, atMs, recordedOffline = false))
    }

    /** Still in use at [atMs]. */
    suspend fun tick(atMs: Long) {
        val open = store.open() ?: return
        if (atMs > open.lastSeenAtMs) store.touch(open.id, atMs)
    }

    /** The screen went off (or the device locked): the open segment ends at [atMs]. */
    suspend fun stop(atMs: Long) {
        val open = store.open() ?: return
        val end = maxOf(atMs, open.startedAtMs)
        store.put(open.copy(endedAtMs = end, lastSeenAtMs = maxOf(end, open.lastSeenAtMs)))
    }

    /** After a crash, a reboot or an app update: the open segment ends where it was last seen. */
    suspend fun closeOpen() {
        val open = store.open() ?: return
        store.put(open.copy(endedAtMs = open.lastSeenAtMs))
    }

    /**
     * The server could not be reached: the open segment counts as recorded offline, or when none is open, the newest
     * one the server has not got yet (the sync at screen off failed). A segment the server already has is left as it
     * is. Once offline, always offline.
     */
    suspend fun markOffline() {
        val target = store.open() ?: store.pending(Int.MAX_VALUE).lastOrNull()?.segment ?: return
        if (!target.recordedOffline) store.put(target.copy(recordedOffline = true))
    }
}
