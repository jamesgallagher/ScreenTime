package au.screentime.kid.sync

/** The server's time at one moment of one boot (docs/SPEC.md §8.5). */
data class ClockAnchor(val serverMs: Long, val elapsedMs: Long, val bootCount: Int)

/** Where [TrustedClock] keeps what it learnt, so it survives a restart of the app. */
interface ClockStore {
    var anchor: ClockAnchor?

    /** The latest trusted time handed out. After a reboot without the server, time never goes back before it. */
    var lastTrustedMs: Long
}

/**
 * Time the kid cannot change by changing the phone's clock (docs/SPEC.md §8.5). After the server has answered once in
 * this boot, it is the server's time plus the time since then on [elapsed], the clock that counts from boot. After a
 * reboot without the server it is the phone's [wall] clock, but never earlier than the last trusted time.
 */
class TrustedClock(
    private val store: ClockStore,
    private val elapsed: () -> Long,
    private val wall: () -> Long,
    private val bootCount: () -> Int,
) {
    /** True when the server has answered since this boot. */
    val isAnchored: Boolean
        @Synchronized get() = store.anchor?.bootCount == bootCount()

    @Synchronized
    fun nowMs(): Long {
        val anchor = store.anchor
        val now = if (anchor != null && anchor.bootCount == bootCount()) {
            anchor.serverMs + (elapsed() - anchor.elapsedMs)
        } else {
            maxOf(wall(), store.lastTrustedMs)
        }
        if (now > store.lastTrustedMs) store.lastTrustedMs = now
        return now
    }

    /** The server said it is [serverMs] now. Its time wins over everything before, even if that was later. */
    @Synchronized
    fun onServerTime(serverMs: Long) {
        store.anchor = ClockAnchor(serverMs, elapsed(), bootCount())
        store.lastTrustedMs = serverMs
    }
}
