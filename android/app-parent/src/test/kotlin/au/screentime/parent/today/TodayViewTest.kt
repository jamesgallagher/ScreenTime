package au.screentime.parent.today

import au.screentime.core.model.api.AvatarColor
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.LockReason
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TodayDevice
import au.screentime.core.model.api.TodayDeviceParentMode
import au.screentime.core.model.api.TodayKid
import au.screentime.core.model.api.TodayPool
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class TodayViewTest {
    private val now = Instant.parse("2026-10-28T05:00:00Z")

    private fun pool(
        allowanceMin: Int = 120,
        grantedMin: Int = 0,
        usedSec: Int = 0,
        remainingSec: Int = 7200,
        locked: Boolean = false,
        lockReason: LockReason? = null,
        overspendSec: Int = 0,
        devices: List<TodayDevice> = emptyList(),
        which: Pool = Pool.SCREENS,
    ) = TodayPool(which, allowanceMin, grantedMin, usedSec, remainingSec, locked, lockReason, null, overspendSec, devices)

    private fun device(
        id: String = "d1",
        name: String = "PC",
        inUse: Boolean = false,
        lastSeenAt: String? = "2026-10-28T04:59:00Z",
        parentMode: TodayDeviceParentMode? = null,
    ) = TodayDevice(id, name, DeviceForm.PC, inUse, lastSeenAt, parentMode)

    @Test
    fun aPoolWithTimeLeft() {
        assertEquals(
            PoolView("Screens", "45m left", "1h 15m used of 2h", 0.375f, Tone.OK),
            poolView(pool(usedSec = 4500, remainingSec = 2700)),
        )
        assertEquals("Nothing used of 2h 30m", poolView(pool(grantedMin = 30, remainingSec = 9000)).detail)
        assertEquals("Phone", poolView(pool(which = Pool.PHONE)).name)
    }

    @Test
    fun fifteenMinutesIsAmberAndFiveIsOrange() {
        assertEquals(Tone.OK, poolView(pool(remainingSec = 901)).tone)
        assertEquals(Tone.WARNING, poolView(pool(remainingSec = 900)).tone)
        assertEquals(Tone.WARNING, poolView(pool(remainingSec = 301)).tone)
        assertEquals(Tone.CRITICAL, poolView(pool(remainingSec = 300)).tone)
        assertEquals("less than a minute left", poolView(pool(remainingSec = 59)).status)
    }

    @Test
    fun aLockedPoolSaysWhy() {
        assertEquals(
            PoolView("Screens", "Locked · bedtime", "2h used of 2h", 0f, Tone.LOCKED),
            poolView(pool(usedSec = 7200, remainingSec = 0, locked = true, lockReason = LockReason.BEDTIME)),
        )
        assertEquals("Locked · out of time", poolView(pool(locked = true, lockReason = LockReason.OUT_OF_TIME)).status)
        assertEquals("Locked · before wake-up", poolView(pool(locked = true, lockReason = LockReason.BEFORE_WAKE)).status)
        assertEquals("Locked · out of time", poolView(pool(locked = true)).status)
    }

    @Test
    fun noTimeToday() {
        assertEquals("No time today", poolView(pool(allowanceMin = 0, remainingSec = 0, locked = true)).detail)
        assertEquals("20m used", poolView(pool(allowanceMin = 0, usedSec = 1200, remainingSec = 0, locked = true)).detail)
        // Time taken away below zero is no time.
        assertEquals(0f, poolView(pool(allowanceMin = 30, grantedMin = -60, remainingSec = 0)).fraction)
    }

    @Test
    fun theBarNeverGoesPastFull() {
        assertEquals(1f, poolView(pool(remainingSec = 9000)).fraction)
    }

    @Test
    fun chipsForUseParentModeAndOfflineDevices() {
        val kid = TodayKid(
            "k1",
            "Alex",
            AvatarColor._0F766E,
            listOf(
                pool(
                    devices = listOf(
                        device(id = "pc", name = "alex on Dev PC", inUse = true),
                        device(id = "tab", name = "Tablet", lastSeenAt = "2026-10-27T22:00:00Z"),
                    ),
                ),
                pool(
                    which = Pool.PHONE,
                    devices = listOf(
                        device(
                            id = "ph",
                            name = "Pixel 7",
                            parentMode = TodayDeviceParentMode("2026-10-28T05:09:30Z", "Dad"),
                        ),
                    ),
                ),
            ),
        )

        assertEquals(
            listOf(
                Chip("Using alex on Dev PC now", ChipTone.PRIMARY),
                Chip("Tablet offline 7h", ChipTone.NEUTRAL),
                Chip("Parent mode on Pixel 7 · 10 min", ChipTone.NEUTRAL),
            ),
            kidChips(kid, now),
        )
    }

    @Test
    fun moreChipRules() {
        val endless = device(parentMode = TodayDeviceParentMode(null, "Mum"))
        val ending = device(parentMode = TodayDeviceParentMode("2026-10-28T04:59:00Z", "Mum"))
        val days = device(lastSeenAt = "2026-10-25T05:00:00Z")
        val never = device(lastSeenAt = null)
        val inUseLongAgo = device(inUse = true, lastSeenAt = "2026-10-27T05:00:00Z")
        fun chips(d: TodayDevice) = kidChips(TodayKid("k", "Sam", AvatarColor._7C3AED, listOf(pool(devices = listOf(d)))), now)

        assertEquals(listOf(Chip("Parent mode on PC", ChipTone.NEUTRAL)), chips(endless))
        assertEquals(listOf(Chip("Parent mode on PC · 1 min", ChipTone.NEUTRAL)), chips(ending))
        assertEquals(listOf(Chip("PC offline 3d", ChipTone.NEUTRAL)), chips(days))
        assertEquals(emptyList<Chip>(), chips(never))
        assertEquals(listOf(Chip("Using PC now", ChipTone.PRIMARY)), chips(inUseLongAgo))
    }

    @Test
    fun aDeviceInBothPoolsIsListedOnceAndOverspendIsAmber() {
        val pc = device(inUse = true)
        val kid = TodayKid(
            "k1",
            "Alex",
            AvatarColor._0F766E,
            listOf(pool(devices = listOf(pc), overspendSec = 720), pool(which = Pool.PHONE, devices = listOf(pc), overspendSec = 59)),
        )

        assertEquals(
            listOf(
                Chip("Using PC now", ChipTone.PRIMARY),
                Chip("Screens: 12m over (a device was offline)", ChipTone.WARNING),
            ),
            kidChips(kid, now),
        )
    }

    @Test
    fun theDayAndTheInitial() {
        assertEquals("Wednesday 28 October", dayTitle("2026-10-28"))
        assertEquals("A", initial(" alex"))
        assertEquals("?", initial(""))
    }
}
