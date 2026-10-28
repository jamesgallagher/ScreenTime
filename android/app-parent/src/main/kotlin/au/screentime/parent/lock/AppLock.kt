package au.screentime.parent.lock

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** How long away from the app before it locks (docs/SPEC.md §11.1). */
const val LOCK_AFTER_MS = 5 * 60_000L

/** Whether the app should lock: a fresh start, or away for five minutes. */
fun shouldLock(leftAtMs: Long?, nowMs: Long): Boolean =
    leftAtMs == null || nowMs - leftAtMs >= LOCK_AFTER_MS

/**
 * The app lock (docs/SPEC.md §11.1): the app is locked on a fresh start and after five minutes away,
 * and unlocked by a fingerprint or the phone's PIN.
 */
object AppLock {
    private val _locked = MutableStateFlow(true)
    val locked: StateFlow<Boolean> = _locked

    @Volatile
    private var lastLeftMs: Long? = null

    /** The app opened: lock it if it was away long enough, or unlock it on a phone with no screen lock. */
    fun opened(nowMs: Long, secure: Boolean) {
        if (!secure) {
            _locked.value = false
        } else if (shouldLock(lastLeftMs, nowMs)) {
            _locked.value = true
        }
    }

    /** The app left: remember the time. */
    fun left(nowMs: Long) {
        lastLeftMs = nowMs
    }

    /** Unlock the app (a fingerprint or the phone's PIN). */
    fun unlock() {
        _locked.value = false
    }
}
