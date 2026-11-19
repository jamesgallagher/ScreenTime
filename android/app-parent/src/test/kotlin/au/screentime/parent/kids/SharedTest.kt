package au.screentime.parent.kids

import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Platform
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.ScheduleDay
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** How the screens show a shared device (docs/SPEC.md §12.8). */
class SharedTest {
    private fun device(kidId: String = "s1", form: DeviceForm = DeviceForm.TABLET, name: String = "Lenovo Tab P11") = Device(
        id = "d1",
        kidId = kidId,
        platform = Platform.ANDROID,
        form = form,
        pool = Pool.SCREENS,
        name = name,
        hasCellular = false,
        model = null,
        osVersion = null,
        appVersion = null,
        windowsUserName = null,
        enrolledAt = "2026-11-19T00:00:00Z",
        lastSeenAt = null,
    )

    @Test
    fun callsTheOnePoolTime() {
        assertEquals("Time", poolLabel(Pool.SCREENS, shared = true))
        assertEquals("Screens", poolLabel(Pool.SCREENS, shared = false))
        assertEquals("Phone", poolLabel(Pool.PHONE, shared = false))
    }

    @Test
    fun showsItsDeviceOrThatNoneIsConnected() {
        assertEquals("Lenovo Tab P11", sharedSummary(listOf(device()), "s1"))
        assertEquals("No device connected yet", sharedSummary(listOf(device(kidId = "k1")), "s1"))
        assertEquals(DeviceForm.PC, sharedForm(listOf(device(form = DeviceForm.PC)), "s1"))
        assertEquals(DeviceForm.TABLET, sharedForm(emptyList(), "s1"))
    }

    @Test
    fun addsOneDeviceAtMost() {
        assertTrue(canAddDevice(shared = true, deviceCount = 0))
        assertFalse(canAddDevice(shared = true, deviceCount = 1))
        assertTrue(canAddDevice(shared = false, deviceCount = 3))
    }

    @Test
    fun theWeekOverviewSaysTimeOnly() {
        val day = ScheduleDay(weekday = 1, screensMin = 30, phoneMin = 0, wake = "07:00", bedtime = "20:00")
        assertEquals("Time 30m", allowanceLine(day, shared = true))
        assertEquals("Screens 30m · Phone No time", allowanceLine(day))
    }
}
