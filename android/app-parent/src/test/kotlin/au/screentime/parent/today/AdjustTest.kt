package au.screentime.parent.today

import au.screentime.core.model.api.LockReason
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TodayPool
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AdjustTest {
    private fun pool(remainingSec: Int, locked: Boolean = false) =
        TodayPool(Pool.PHONE, 120, 0, 0, remainingSec, locked, if (locked) LockReason.BEDTIME else null, null, 0, emptyList())

    @Test
    fun amountsAreFifteenMinuteStepsFromMinusFourToPlusEightHours() {
        assertEquals(15, ADJUST_DEFAULT)
        assertEquals(listOf(15, 30, 60, 120), QUICK_AMOUNTS)
        assertEquals(30, clampAdjust(30))
        assertEquals(30, clampAdjust(37))
        assertEquals(45, clampAdjust(38))
        assertEquals(-45, clampAdjust(-44))
        assertEquals(480, clampAdjust(600))
        assertEquals(-240, clampAdjust(-300))
        assertEquals(0, clampAdjust(0))
    }

    @Test
    fun theStepperStopsAtItsEnds() {
        assertEquals(30, stepUp(15))
        assertEquals(480, stepUp(480))
        assertEquals(0, stepDown(15))
        assertEquals(-240, stepDown(-240))
    }

    @Test
    fun amountsReadShortWithARealMinusSign() {
        assertEquals("+15m", formatAdjust(15))
        assertEquals("+1h", formatAdjust(60))
        assertEquals("+1h 30m", formatAdjust(90))
        assertEquals("+8h", formatAdjust(480))
        assertEquals("−45m", formatAdjust(-45))
        assertEquals("−2h", formatAdjust(-120))
        assertEquals("0m", formatAdjust(0))
    }

    @Test
    fun thePreviewShowsBeforeAndAfter() {
        assertEquals("Now 45m left → 1h left", adjustPreview(pool(2700), 15))
        assertEquals("Now 45m left → 15m left", adjustPreview(pool(2700), -30))
        assertEquals("Now 45m left → locked", adjustPreview(pool(2700), -60))
        assertEquals("Now 45m left → 45m left", adjustPreview(pool(2700), 0))
    }

    @Test
    fun aLockedPoolGetsExactlyTheGrant() {
        // After bedtime or out of time there is nothing left, so a grant gives exactly its own minutes (docs/SPEC.md §7).
        assertEquals("Now locked → 30m left", adjustPreview(pool(0, locked = true), 30))
        assertEquals("Now locked → locked", adjustPreview(pool(0, locked = true), -15))
    }

    @Test
    fun theSheetAndTheLockDialogNameTheKid() {
        assertEquals("Change Alex's time", adjustTitle("Alex"))
        assertEquals("Lock Alex's Phone now?", lockTitle("Alex", Pool.PHONE))
        assertEquals("Lock Sam's Screens now?", lockTitle("Sam", Pool.SCREENS))
    }
}
