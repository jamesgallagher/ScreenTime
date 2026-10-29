package au.screentime.parent.kids

import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Platform
import au.screentime.core.model.api.Pool
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class KidsTest {
    private val now = Instant.parse("2026-10-28T05:00:00Z")

    private fun device(id: String, kidId: String = "k1", form: DeviceForm = DeviceForm.PHONE) = Device(
        id, kidId, Platform.ANDROID, form, if (form == DeviceForm.PHONE) Pool.PHONE else Pool.SCREENS, "Pixel 7",
        true, "Pixel 7", "Android 14", "0.1.0", null, "2026-10-20T00:00:00Z", null,
    )

    @Test
    fun formsHaveNamesAndSayWhichTimeTheyUse() {
        assertEquals("Phone", formName(DeviceForm.PHONE))
        assertEquals("Tablet", formName(DeviceForm.TABLET))
        assertEquals("PC", formName(DeviceForm.PC))
        assertEquals("Android phone. Counts as Phone time.", formDetail(DeviceForm.PHONE))
        assertEquals("Android tablet. Counts as Screens time.", formDetail(DeviceForm.TABLET))
        assertEquals("Windows PC account. Counts as Screens time.", formDetail(DeviceForm.PC))
    }

    @Test
    fun lastSeenReadsInMinutesHoursAndDays() {
        assertEquals("Never connected", lastSeenText(null, now))
        assertEquals("Seen just now", lastSeenText("2026-10-28T04:59:30Z", now))
        assertEquals("Seen 12 min ago", lastSeenText("2026-10-28T04:48:00Z", now))
        assertEquals("Seen 3h ago", lastSeenText("2026-10-28T01:30:00Z", now))
        assertEquals("Seen 1 day ago", lastSeenText("2026-10-27T04:00:00Z", now))
        assertEquals("Seen 2 days ago", lastSeenText("2026-10-26T04:00:00Z", now))
    }

    @Test
    fun theCodeCountsDownAndReadsInTwoHalves() {
        assertEquals("10:00", countdownText("2026-10-28T05:10:00Z", now))
        assertEquals("9:41", countdownText("2026-10-28T05:09:40.200Z", now))
        assertEquals("0:05", countdownText("2026-10-28T05:00:05Z", now))
        assertEquals("0:00", countdownText("2026-10-28T04:59:00Z", now))
        assertEquals("123 456", spacedCode("123456"))
    }

    @Test
    fun aNameIsTrimmedAndAtMostFortyCharacters() {
        assertEquals("Alex's tablet", cleanDeviceName("  Alex's tablet "))
        assertNull(cleanDeviceName("   "))
        assertEquals(40, cleanDeviceName("x".repeat(40))?.length)
        assertNull(cleanDeviceName("x".repeat(41)))
    }

    @Test
    fun theNewDeviceIsTheOneThatWasNotThereBefore() {
        val before = setOf("d1")
        assertNull(newDevice(before, listOf(device("d1")), "k1"))
        assertEquals("d2", newDevice(before, listOf(device("d1"), device("d2")), "k1")?.id)
        // Another kid's new device is not this kid's.
        assertNull(newDevice(before, listOf(device("d1"), device("d3", kidId = "k2")), "k1"))
    }

    @Test
    fun theAddDeviceStepSaysWhatToDoOnTheDevice() {
        assertEquals("Add Alex's phone", addTitle("Alex", DeviceForm.PHONE))
        assertEquals("Add Alex's PC", addTitle("Alex", DeviceForm.PC))
        assertEquals(
            "On Alex's tablet, open Screen Time and tap Scan QR code, or type the code.",
            addHint("Alex", DeviceForm.TABLET),
        )
        assertEquals(
            "On the PC, a parent runs the ScreenTime installer and types this code for Alex's Windows account.",
            addHint("Alex", DeviceForm.PC),
        )
    }

    @Test
    fun theQrCodeIsASquareOfModules() {
        val qr = qrModules("screentime://enrol?code=123456&server=https%3A%2F%2Fscreentime.gallagherhome.au")
        assertTrue(qr.size >= 21)
        assertTrue(qr.all { it.size == qr.size })
        assertTrue(qr.any { row -> row.any { it } })
        // The finder pattern: the top-left corner module is dark.
        assertTrue(qr[0][0])
    }
}
