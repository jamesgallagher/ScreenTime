package au.screentime.parent.push

import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** CARD-042: the parent app's push helpers. Copied verbatim from the card. */
class PushTest {
    private val request = """{"v":1,"type":"parent_mode.request","at":"2026-10-29T03:00:00Z","data":{"id":"e1",""" +
        """"kind":"parent_mode.request","at":"2026-10-29T03:00:00Z","kidId":"k1","kidName":"Alex","deviceId":"d1",""" +
        """"deviceName":"Alex's Pixel 7","payload":{"requestId":"r1"},"extra":true}}"""

    @Test
    fun envelopesBecomeEvents() {
        val e = parseEnvelope(request)!!
        assertEquals("e1", e.id)
        assertEquals("parent_mode.request", e.kind)
        assertEquals("Alex", e.kidName)
        assertEquals("Alex's Pixel 7", e.deviceName)
        assertEquals(JsonPrimitive("r1"), e.payload["requestId"])
        assertEquals("r1", requestIdOf(e))
        assertNull(parseEnvelope(request.replace("\"v\":1", "\"v\":2")))
        assertNull(parseEnvelope("not json"))
        assertNull(parseEnvelope("""{"v":1,"type":"x","at":"2026-10-29T03:00:00Z","data":{}}"""))
    }

    @Test
    fun onlyParentModeRequestsHaveARequestId() {
        val time = parseEnvelope(request.replace("\"kind\":\"parent_mode.request\"", "\"kind\":\"time_request\""))!!
        assertNull(requestIdOf(time))
    }

    @Test
    fun channels() {
        assertEquals("critical", channelFor("sos.started"))
        assertEquals("critical", channelFor("sos.ended"))
        assertEquals("alerts", channelFor("tamper.clock"))
        assertEquals("alerts", channelFor("parent_mode.request"))
        assertEquals("alerts", channelFor("parent_mode.used"))
        assertEquals("requests", channelFor("time_request"))
        assertEquals("requests", channelFor("kid_message"))
        assertEquals("info", channelFor("grant.by_other_parent"))
        assertEquals("info", channelFor("device.enrolled"))
        assertEquals("info", channelFor("overspend"))
    }

    @Test
    fun approvalWords() {
        assertEquals(listOf("2 min", "5 min", "15 min", "1 hour", "Until I end it"), PARENT_MODE_MINUTES.map { durationText(it) })
        assertEquals("Parent mode for Alex?", approveTitle("Alex"))
        assertEquals("Alex's Pixel 7 is asking. Time doesn't count and the device is unlocked while it is on.", approveText("Alex's Pixel 7"))
        assertEquals("A device is asking. Time doesn't count and the device is unlocked while it is on.", approveText(null))
    }

    @Test
    fun parentCodeIsTheRfc6238Code() {
        // RFC 6238 appendix B, SHA-1, the last 6 of the 8 digits. The secret is "12345678901234567890" in base32.
        val secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        assertEquals("287082", codeAt(secret, 59_000L))
        assertEquals("081804", codeAt(secret, 1_111_111_109_000L))
        assertEquals("005924", codeAt(secret, 1_234_567_890_000L))
        assertEquals("279037", codeAt(secret.lowercase(), 2_000_000_000_000L))
        assertNull(codeAt("not base32!", 59_000L))
        assertNull(codeAt("", 59_000L))
    }

    @Test
    fun countdown() {
        assertEquals(30, secondsLeft(0L))
        assertEquals(30, secondsLeft(30_999L))
        assertEquals(1, secondsLeft(29_000L))
        assertEquals(1, secondsLeft(59_999L))
        assertEquals(29, secondsLeft(1_234_567_891_000L))
    }
}
