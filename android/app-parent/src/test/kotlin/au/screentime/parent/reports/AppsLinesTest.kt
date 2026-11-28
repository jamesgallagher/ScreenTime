package au.screentime.parent.reports

import au.screentime.core.model.api.AppReport
import au.screentime.core.model.api.AppReportApp
import au.screentime.core.model.api.AppReportAppDevice
import au.screentime.core.model.api.AppReportDevice
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Platform
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.ReportPeriod
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.ZoneId

/*
 * CARD-075 acceptance criteria 7 to 13 (docs/cards/CARD-075-parent-reports.md section 6, "Apps"): Claude's apps
 * helpers in ReportLines.kt on the card's fixed fixtures. Dates and the zone are fixed; nothing reads the clock.
 * Expected values are the card's, character for character.
 */
class AppsLinesTest {
    private val sydney = ZoneId.of("Australia/Sydney")
    private val pixel = "p"
    private val pc = "pc"

    private fun appDevice(deviceId: String, sec: Int) = AppReportAppDevice(deviceId = deviceId, sec = sec)

    private fun app(
        pkg: String,
        label: String,
        totalSec: Int,
        devices: List<AppReportAppDevice>,
        installedAt: String? = null,
        removedAt: String? = null,
    ) = AppReportApp(
        `package` = pkg,
        label = label,
        totalSec = totalSec,
        devices = devices,
        installedAt = installedAt,
        removedAt = removedAt,
    )

    private fun device(
        deviceId: String,
        name: String,
        form: DeviceForm,
        platform: Platform,
        removedAt: String? = null,
        appsRecorded: Boolean = true,
    ) = AppReportDevice(
        deviceId = deviceId,
        name = name,
        form = form,
        platform = platform,
        removedAt = removedAt,
        appsRecorded = appsRecorded,
    )

    private fun report(
        deviceId: String? = null,
        devices: List<AppReportDevice>,
        apps: List<AppReportApp> = emptyList(),
    ) = AppReport(
        kidId = "k1",
        period = ReportPeriod.DAY,
        from = "2026-11-20",
        to = "2026-11-20",
        today = "2026-11-20",
        deviceId = deviceId,
        devices = devices,
        screenTime = emptyList(),
        apps = apps,
    )

    @Test
    fun `7 splitOther shows apps of a minute or more and folds the rest into Other with their seconds`() {
        val split = splitOther(
            listOf(
                app("a", "A", 3000, listOf(appDevice(pixel, 3000))),
                app("b", "B", 60, listOf(appDevice(pixel, 60))),
                app("c", "C", 59, listOf(appDevice(pixel, 59))),
                app("d", "D", 0, emptyList()),
            ),
        )
        assertEquals(listOf("A", "B"), split.shown.map { it.label }, "shown is A (3000 s) and B (60 s)")
        assertEquals(listOf("C", "D"), split.other.map { it.label }, "other is C (59 s) and D (0 s)")
        assertEquals(59, split.otherSec, "otherSec is 59 s")
    }

    @Test
    fun `8 shortDuration stays short in a line and totalDuration is 0m for nothing`() {
        assertEquals("<1m", shortDuration(59), "59 s is under a minute")
        assertEquals("1m", shortDuration(60), "60 s is 1m")
        assertEquals("1h 5m", shortDuration(3900), "3900 s is 1h 5m")
        assertEquals("2h", shortDuration(7200), "7200 s is 2h")
        assertEquals("0m", totalDuration(0), "a total of 0 s is 0m")
    }

    @Test
    fun `9 deviceSplit names each device in All devices and only when two send apps`() {
        val both = report(
            devices = listOf(
                device(pixel, "Pixel", DeviceForm.PHONE, Platform.ANDROID),
                device(pc, "Desk PC", DeviceForm.PC, Platform.WINDOWS),
            ),
        )
        val appBoth = app("x", "X", 6000, listOf(appDevice(pixel, 4200), appDevice(pc, 1800)))
        assertEquals(
            "Pixel 1h 10m \u00b7 Desk PC 30m",
            deviceSplit(appBoth, both),
            "Pixel 1h 10m and Desk PC 30m in All devices",
        )

        val secondUnrecorded = report(
            devices = listOf(
                device(pixel, "Pixel", DeviceForm.PHONE, Platform.ANDROID),
                device(pc, "Desk PC", DeviceForm.PC, Platform.WINDOWS, appsRecorded = false),
            ),
        )
        assertNull(
            deviceSplit(appBoth, secondUnrecorded),
            "Desk PC does not send apps, so only one device does: null",
        )

        val chosen = report(deviceId = pixel, devices = both.devices)
        assertNull(deviceSplit(appBoth, chosen), "a chosen device is not split by device: null")

        val unknown = app("x", "X", 4500, listOf(appDevice(pixel, 4200), appDevice("d-x", 300)))
        assertEquals(
            "Pixel 1h 10m \u00b7 A device 5m",
            deviceSplit(unknown, both),
            "a device id not in the report is A device 5m",
        )
    }

    @Test
    fun `10 removedLine says Installed and removed in the family zone`() {
        val gone = app(
            "x",
            "X",
            60,
            listOf(appDevice(pixel, 60)),
            installedAt = "2026-11-02T14:00:00Z",
            removedAt = "2026-11-03T14:00:00Z",
        )
        assertEquals(
            "Installed 3 Nov \u00b7 removed 4 Nov",
            removedLine(gone, sydney),
            "in Sydney 14:00Z is the next day: installed 3 Nov, removed 4 Nov",
        )

        val noInstalled = app(
            "x",
            "X",
            60,
            listOf(appDevice(pixel, 60)),
            installedAt = null,
            removedAt = "2026-11-03T14:00:00Z",
        )
        assertEquals("Removed 4 Nov", removedLine(noInstalled, sydney), "with no installedAt only Removed 4 Nov")

        val stillThere = app(
            "x",
            "X",
            60,
            listOf(appDevice(pixel, 60)),
            installedAt = "2026-11-02T14:00:00Z",
            removedAt = null,
        )
        assertNull(removedLine(stillThere, sydney), "an app that is still there has no removed line")
    }

    @Test
    fun `11 barFraction is the share of the longest, with a sliver and zero for nothing`() {
        assertEquals(0f, barFraction(0, 100), 0.0001f, "0 of 100 is 0")
        assertEquals(0.02f, barFraction(1, 1000), 0.0001f, "1 of 1000 shows a 0.02 sliver")
        assertEquals(0.5f, barFraction(50, 100), 0.0001f, "50 of 100 is 0.5")
        assertEquals(0f, barFraction(5, 0), 0.0001f, "no longest value is 0")
    }

    @Test
    fun `12 screenTimeLabel names one device, or Time for a shared one`() {
        val pixelDevice = device(pixel, "Pixel", DeviceForm.PHONE, Platform.ANDROID)
        assertEquals("Pixel", screenTimeLabel(Pool.PHONE, shared = false, device = pixelDevice), "one device shows its name")
        assertEquals("Time", screenTimeLabel(Pool.PHONE, shared = true, device = null), "a shared device shows Time")
        assertEquals("Screens", screenTimeLabel(Pool.SCREENS, shared = false, device = null), "the screens pool is Screens")
        assertEquals("Phone", screenTimeLabel(Pool.PHONE, shared = false, device = null), "the phone pool is Phone")
    }

    @Test
    fun `13 hasUnrecorded is true only for a PC in the report that sends no apps and is not removed`() {
        val phone = device(pixel, "Pixel", DeviceForm.PHONE, Platform.ANDROID)
        val pcHere = device(pc, "Desk PC", DeviceForm.PC, Platform.WINDOWS, appsRecorded = false)
        assertTrue(
            hasUnrecorded(report(devices = listOf(phone, pcHere))),
            "a PC in All devices that sends no apps and is not removed is unrecorded",
        )

        val pcRemoved = device(pc, "Desk PC", DeviceForm.PC, Platform.WINDOWS, removedAt = "2026-11-04T09:00:00Z", appsRecorded = false)
        assertFalse(
            hasUnrecorded(report(devices = listOf(phone, pcRemoved))),
            "a removed PC is not unrecorded",
        )

        assertFalse(
            hasUnrecorded(report(deviceId = pixel, devices = listOf(phone, pcHere))),
            "the report's device is the phone, so the PC is not in it",
        )
    }
}
