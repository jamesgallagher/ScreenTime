package au.screentime.parent.lock

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppLockTest {
    private val left = 10_000_000L

    @Test
    fun aFreshStartIsLocked() {
        assertTrue(shouldLock(null, left))
    }

    @Test
    fun fiveMinutesAwayLocks() {
        assertFalse(shouldLock(left, left))
        assertFalse(shouldLock(left, left + 299_999))
        assertTrue(shouldLock(left, left + 300_000))
        assertTrue(shouldLock(left, left + 3_600_000))
    }

    @Test
    fun theLockFollowsLeavingAndComingBack() {
        AppLock.unlock()
        AppLock.left(left)
        AppLock.opened(left + 60_000, secure = true)
        assertFalse(AppLock.locked.value)

        AppLock.left(left + 70_000)
        AppLock.opened(left + 370_000, secure = true)
        assertTrue(AppLock.locked.value)

        // Coming back again soon does not unlock it: only unlock() does.
        AppLock.left(left + 371_000)
        AppLock.opened(left + 372_000, secure = true)
        assertTrue(AppLock.locked.value)

        // A phone with no screen lock is never locked.
        AppLock.opened(left + 373_000, secure = false)
        assertFalse(AppLock.locked.value)
    }
}
