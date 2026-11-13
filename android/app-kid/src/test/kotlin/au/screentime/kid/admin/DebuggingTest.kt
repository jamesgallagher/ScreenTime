package au.screentime.kid.admin

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DebuggingTest {
    @Test
    fun applyingAgainLeavesDebuggingAsParentModeSetIt() {
        // A new process, or parent mode off: blocked.
        assertTrue(blocksDebuggingOnApply(null))
        assertTrue(blocksDebuggingOnApply(false))
        // Parent mode lifted it, then the main screen opened (Redmi, 13 Nov 2026): left alone, so adb stays up.
        assertFalse(blocksDebuggingOnApply(true))
    }
}
