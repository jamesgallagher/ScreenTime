package au.screentime.parent.inbox

import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TimeRequest
import au.screentime.core.model.api.TimeRequestStatus
import java.time.Instant
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class WaitingTest {
    private val sydney = ZoneId.of("Australia/Sydney")

    // 4:00 pm on Wednesday 28 October 2026 in Sydney (UTC+11).
    private val now = Instant.parse("2026-10-28T05:00:00Z")

    private val time = Waiting.Time(
        TimeRequest(
            "r1", "k1", "Alex", "d1", "Pixel 7", Pool.PHONE, 30, "finishing homework video", TimeRequestStatus.PENDING,
            "2026-10-28T04:50:00Z", null, null, null, null,
        ),
        eventId = "e1",
    )
    private val parentMode = Waiting.ParentMode("pm1", "Sam", "Lenovo Tab", "2026-10-28T04:55:00Z", "2026-10-28T05:05:00Z", "e2")
    private val app = Waiting.NewApp("k1", "Alex", "com.roblox.client", "Roblox", "play", "Pixel 7", "2026-10-28T04:40:00Z", "e3")
    private val message = Waiting.Message("m1", "Alex", "Pixel 7", "Can you pick me up at 5?", "2026-10-27T22:00:00Z", "e4")

    @Test
    fun eachKindReadsInPlainWords() {
        assertEquals("Alex wants 30m more Phone", waitingTitle(time))
        assertEquals("“finishing homework video”", waitingDetail(time))
        assertEquals("Sam wants parent mode", waitingTitle(parentMode))
        assertEquals("Alex installed Roblox", waitingTitle(app))
        assertEquals("From Play Store. It stays blocked until you answer.", waitingDetail(app))
        assertEquals("Message from Alex", waitingTitle(message))
        assertEquals("“Can you pick me up at 5?”", waitingDetail(message))
    }

    @Test
    fun theGreyLineHasTheDeviceAndTheTime() {
        assertEquals("Pixel 7 · 3:50 pm", waitingMeta(time, now, sydney))
        assertEquals("Lenovo Tab · 3:55 pm · answer by 4:05 pm", waitingMeta(parentMode, now, sydney))
        assertEquals("Pixel 7 · 9:00 am", waitingMeta(message, now, sydney))
        assertEquals("3:55 pm · answer by 4:05 pm", waitingMeta(parentMode.copy(deviceName = null), now, sydney))
    }

    @Test
    fun theHeaderCountsOnlyWhenThereIsMoreThanOne() {
        assertEquals("Waiting for you", waitingHeader(1))
        assertEquals("Waiting for you · 3", waitingHeader(3))
        assertEquals("Show 2 more", waitingToggle(3, expanded = false))
        assertEquals("Show less", waitingToggle(3, expanded = true))
    }

    @Test
    fun newestFirstAndAnExpiredParentModeRequestIsHidden() {
        assertEquals(listOf(parentMode, time, app, message), visibleWaiting(listOf(message, app, time, parentMode), now))
        val later = Instant.parse("2026-10-28T05:05:00Z")
        assertEquals(listOf(time, app, message), visibleWaiting(listOf(message, app, time, parentMode), later))
        assertEquals(emptyList<Waiting>(), visibleWaiting(emptyList(), now))
    }

    @Test
    fun keysNeverClashAcrossKinds() {
        val keys = listOf(time, parentMode, app, message).map { it.key }
        assertEquals(keys.size, keys.toSet().size)
        assertEquals("app:k1:com.roblox.client", app.key)
    }

    @Test
    fun anAppFromSomewhereElse() {
        assertEquals("Came with the device", appSource("preinstalled"))
        assertEquals("Installed another way", appSource(null))
        assertNull(waitingDetail(time.copy(request = time.request.copy(reason = null))))
    }
}
