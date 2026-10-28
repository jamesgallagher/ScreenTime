package au.screentime.parent.inbox

import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TimeRequest
import au.screentime.core.model.api.TimeRequestStatus
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class InboxTest {
    private val sydney = ZoneId.of("Australia/Sydney")

    // 4:00 pm on Wednesday 28 October 2026 in Sydney (UTC+11).
    private val now = Instant.parse("2026-10-28T05:00:00Z")

    private fun request(minutes: Int = 30, reason: String? = "finishing homework video", pool: Pool = Pool.PHONE) =
        TimeRequest(
            "r1", "k1", "Alex", "d1", "Pixel 7", pool, minutes, reason, TimeRequestStatus.PENDING,
            "2026-10-28T04:50:00Z", null, null, null, null,
        )

    private fun event(kind: String, vararg payload: Pair<String, Any?>, device: String? = "Pixel 7") = EventItem(
        id = "e1",
        kind = kind,
        at = "2026-10-28T04:30:00Z",
        kidId = "k1",
        kidName = "Alex",
        deviceId = "d1",
        deviceName = device,
        payload = JsonObject(
            payload.associate { (key, value) ->
                key to when (value) {
                    is String -> JsonPrimitive(value)
                    is Number -> JsonPrimitive(value)
                    is Boolean -> JsonPrimitive(value)
                    else -> kotlinx.serialization.json.JsonNull
                }
            },
        ),
    )

    private fun view(kind: String, vararg payload: Pair<String, Any?>) = eventView(event(kind, *payload), sydney)

    @Test
    fun aRequestReadsAsOneLine() {
        assertEquals("Alex wants 30m more Phone", requestTitle(request()))
        assertEquals("Alex wants 1h 30m more Screens", requestTitle(request(minutes = 90, pool = Pool.SCREENS)))
        assertEquals("“finishing homework video”", requestDetail(request()))
        assertNull(requestDetail(request(reason = null)))
        assertNull(requestDetail(request(reason = " ")))
    }

    @Test
    fun timeAndMessageEvents() {
        assertEquals(
            EventView("Alex asked for 30m more Phone", "“please”", EventTone.REQUEST),
            view("time_request", "minutes" to 30, "pool" to "phone", "reason" to "please"),
        )
        assertEquals(
            EventView("Dad said yes to Alex: 45m more", null, EventTone.TIME),
            view("time_request.resolved", "approved" to true, "minutes" to 45, "byName" to "Dad"),
        )
        assertEquals(
            EventView("Mum said no to Alex's request", null, EventTone.INFO),
            view("time_request.resolved", "approved" to false, "byName" to "Mum"),
        )
        assertEquals(
            EventView("Dad added 1h of Screens for Alex", null, EventTone.TIME),
            view("grant.added", "minutes" to 60, "pool" to "screens", "byName" to "Dad", "lockNow" to false),
        )
        assertEquals(
            EventView("Dad took away 15m of Phone from Alex", null, EventTone.TIME),
            view("grant.added", "minutes" to -15, "pool" to "phone", "byName" to "Dad", "lockNow" to false),
        )
        assertEquals(
            EventView("Mum locked Alex's Phone", null, EventTone.TIME),
            view("grant.added", "minutes" to -42, "pool" to "phone", "byName" to "Mum", "lockNow" to true),
        )
        assertEquals(
            EventView("Message from Alex", "“Can I stay up?”", EventTone.MESSAGE),
            view("kid_message", "body" to "Can I stay up?"),
        )
    }

    @Test
    fun parentModeSosAndDeviceEvents() {
        assertEquals(
            EventView("Alex asked for parent mode on Pixel 7", null, EventTone.REQUEST),
            view("parent_mode.request"),
        )
        assertEquals(
            EventView("Parent mode on Pixel 7 for 15 min", "Started by Dad", EventTone.INFO),
            view("parent_mode.used", "durationMin" to 15, "byName" to "Dad"),
        )
        assertEquals(
            EventView("Parent mode on Pixel 7 for 1 hour", "Started with the parent code", EventTone.INFO),
            view("parent_mode.used", "durationMin" to 60),
        )
        assertEquals(EventView("Parent mode on Pixel 7 until ended", "Started by Mum", EventTone.INFO), view("parent_mode.used", "byName" to "Mum"))
        assertEquals(EventView("Parent mode ended on Pixel 7", null, EventTone.INFO), view("parent_mode.ended"))
        assertEquals(EventView("SOS from Alex", "On Pixel 7", EventTone.SOS), view("sos.started"))
        assertEquals(EventView("Alex ended the SOS: safe", null, EventTone.SOS), view("sos.ended", "endedBy" to "kid"))
        assertEquals(EventView("Dad ended Alex's SOS", null, EventTone.SOS), view("sos.ended", "endedBy" to "parent", "byName" to "Dad"))
        assertEquals(
            EventView("Pixel 7 is offline", "Last seen at 3:05 pm", EventTone.INFO),
            view("device.offline", "lastSeenAt" to "2026-10-28T04:05:00Z"),
        )
        assertEquals(EventView("Pixel 7 was added for Alex", null, EventTone.INFO), view("device.enrolled", "name" to "Pixel 7"))
    }

    @Test
    fun tamperAndOverspendAreAlerts() {
        assertEquals(EventView("Pixel 7: the clock was changed", null, EventTone.ALERT), view("tamper.clock", "offsetMin" to "10"))
        assertEquals(EventView("Pixel 7: a call was blocked", null, EventTone.ALERT), view("tamper.call_blocked"))
        assertEquals(EventView("Pixel 7: something was tampered with", null, EventTone.ALERT), view("tamper.new_thing"))
        assertEquals(
            EventView(
                "Alex went 12m over on Screens",
                "Pixel 7 was offline, so it could not know the time had run out",
                EventTone.ALERT,
            ),
            view("overspend", "overspendSec" to 720, "pool" to "screens"),
        )
    }

    @Test
    fun anEventWithMissingOrOddFieldsStillReads() {
        assertEquals(EventView("Alex asked for less than a minute more time", null, EventTone.REQUEST), view("time_request"))
        assertEquals(EventView("A parent added 15m of time for Alex", null, EventTone.TIME), view("grant.added", "minutes" to 15))
        // A string where a number belongs is not read as the number.
        assertEquals(EventView("Alex asked for less than a minute more Phone", null, EventTone.REQUEST), view("time_request", "minutes" to "30", "pool" to "phone"))
        assertEquals(EventView("something.new", null, EventTone.INFO), view("something.new"))
        assertEquals(
            EventView("a device is offline", null, EventTone.INFO),
            eventView(event("device.offline", device = null), sydney),
        )
    }

    @Test
    fun whenIsTheTimeTodayThenYesterdayThenTheDate() {
        assertEquals("3:30 pm", whenText("2026-10-28T04:30:00Z", now, sydney))
        assertEquals("12:05 am", whenText("2026-10-27T13:05:00Z", now, sydney))
        assertEquals("Yesterday, 11:55 pm", whenText("2026-10-27T12:55:00Z", now, sydney))
        assertEquals("Sat 24 Oct, 9:00 am", whenText("2026-10-23T22:00:00Z", now, sydney))
    }

    @Test
    fun answeringTooLateSaysSo() {
        assertEquals("Someone already answered this request.", answerError(ApiException(409, null)))
        assertEquals("This request is gone.", answerError(ApiException(404, null)))
        assertEquals("Something went wrong on the server. Try again soon.", answerError(ApiException(500, null)))
        assertEquals("Can't reach Screen Time. Check the internet connection and try again.", answerError(IOException("x")))
    }
}
