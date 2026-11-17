package au.screentime.parent.inbox

import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TimeRequest
import au.screentime.core.model.api.TimeRequestStatus
import au.screentime.core.model.api.WaitingItem
import au.screentime.core.model.api.WaitingKind
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** CARD-062: the waiting mapping and stale-tag logic. */
class WaitingApiTest {
    private val timeRequest = TimeRequest(
        id = "r1",
        kidId = "k1",
        kidName = "Alex",
        deviceId = "d1",
        deviceName = "Pixel 7",
        pool = Pool.PHONE,
        minutes = 30,
        reason = "Homework",
        status = TimeRequestStatus.PENDING,
        createdAt = "2026-11-18T03:00:00Z",
        resolvedAt = null,
        resolvedByName = null,
        grantId = null,
        grantedMinutes = null,
    )

    @Test
    fun timeRequestMaps() {
        val item = WaitingItem(
            kind = WaitingKind.TIME_REQUEST,
            id = "r1",
            eventId = "e1",
            at = "2026-11-18T03:00:00Z",
            kidId = "k1",
            kidName = "Alex",
            deviceId = "d1",
            deviceName = "Pixel 7",
            request = timeRequest,
            expiresAt = null,
            `package` = null,
            label = null,
            source = null,
            body = null,
        )
        val w = waitingFrom(item) as Waiting.Time
        assertEquals("r1", w.request.id)
        assertEquals("e1", w.eventId)
    }

    @Test
    fun timeRequestWithNullRequestReturnsNull() {
        val item = WaitingItem(
            kind = WaitingKind.TIME_REQUEST,
            id = "r1",
            eventId = "e1",
            at = "2026-11-18T03:00:00Z",
            kidId = "k1",
            kidName = "Alex",
            deviceId = "d1",
            deviceName = "Pixel 7",
            request = null,
            expiresAt = null,
            `package` = null,
            label = null,
            source = null,
            body = null,
        )
        assertNull(waitingFrom(item))
    }

    @Test
    fun parentModeRequestMaps() {
        val item = WaitingItem(
            kind = WaitingKind.PARENT_MODE_REQUEST,
            id = "pm1",
            eventId = "e2",
            at = "2026-11-18T03:00:00Z",
            kidId = "k1",
            kidName = "Alex",
            deviceId = "d1",
            deviceName = "Pixel 7",
            request = null,
            expiresAt = "2026-11-18T03:10:00Z",
            `package` = null,
            label = null,
            source = null,
            body = null,
        )
        val w = waitingFrom(item) as Waiting.ParentMode
        assertEquals("pm1", w.requestId)
        assertEquals("e2", w.eventId)
        assertEquals("2026-11-18T03:10:00Z", w.expiresAt)
    }

    @Test
    fun appApprovalMaps() {
        val item = WaitingItem(
            kind = WaitingKind.APP_APPROVAL,
            id = "k1:com.example.game",
            eventId = "e3",
            at = "2026-11-18T03:00:00Z",
            kidId = "k1",
            kidName = "Alex",
            deviceId = null,
            deviceName = null,
            request = null,
            expiresAt = null,
            `package` = "com.example.game",
            label = "Example Game",
            source = "play",
            body = null,
        )
        val w = waitingFrom(item) as Waiting.NewApp
        assertEquals("k1", w.kidId)
        assertEquals("com.example.game", w.packageName)
        assertEquals("Example Game", w.label)
        assertEquals("play", w.source)
        assertEquals("e3", w.eventId)
    }

    @Test
    fun kidMessageMaps() {
        val item = WaitingItem(
            kind = WaitingKind.KID_MESSAGE,
            id = "m1",
            eventId = "e4",
            at = "2026-11-18T03:00:00Z",
            kidId = "k1",
            kidName = "Alex",
            deviceId = "d1",
            deviceName = "Pixel 7",
            request = null,
            expiresAt = null,
            `package` = null,
            label = null,
            source = null,
            body = "Can you pick me up at 5?",
        )
        val w = waitingFrom(item) as Waiting.Message
        assertEquals("m1", w.messageId)
        assertEquals("Can you pick me up at 5?", w.body)
        assertEquals("e4", w.eventId)
    }

    @Test
    fun staleTags() {
        val waiting = listOf(
            Waiting.Message("m1", "Alex", "Pixel 7", "Hi", "2026-11-18T03:00:00Z", "e1"),
            Waiting.Message("m2", "Alex", "Pixel 7", "Hello", "2026-11-18T03:01:00Z", "e2"),
        )
        // e1 is still waiting, e3 is stale, null is ignored, non-waiting tag is ignored.
        val active = listOf("waiting:e1", "waiting:e3", null, "other:e4")
        assertEquals(listOf("waiting:e3"), staleTags(active, waiting))
    }

    @Test
    fun staleTagsNothingWhenEverythingIsWaiting() {
        val waiting = listOf(
            Waiting.Message("m1", "Alex", "Pixel 7", "Hi", "2026-11-18T03:00:00Z", "e1"),
        )
        val active = listOf("waiting:e1", "waiting:e2")
        assertEquals(listOf("waiting:e2"), staleTags(active, waiting))
    }

    @Test
    fun staleTagsEmptyWhenNoWaiting() {
        val active = listOf("waiting:e1", "waiting:e2")
        assertEquals(listOf("waiting:e1", "waiting:e2"), staleTags(active, emptyList()))
    }
}
