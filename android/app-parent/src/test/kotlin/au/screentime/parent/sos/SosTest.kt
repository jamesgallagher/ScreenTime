package au.screentime.parent.sos

import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.SosAck
import au.screentime.core.model.api.SosLocation
import au.screentime.core.model.api.SosLocationVia
import au.screentime.parent.push.parseEnvelope
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** CARD-044: the parent app's SOS words and rules. Copied verbatim from the card. */
class SosTest {
    private fun event(kind: String, payload: String): EventItem = parseEnvelope(
        """{"v":1,"type":"$kind","at":"2026-10-29T03:00:00Z","data":{"id":"e1","kind":"$kind",""" +
            """"at":"2026-10-29T03:00:00Z","kidId":"k1","kidName":"Alex","deviceId":"d1",""" +
            """"deviceName":"Alex's Pixel 7","payload":$payload}}""",
    )!!

    private val now = Instant.parse("2026-10-29T03:10:00Z")

    private fun loc(at: String, accuracy: Double?, battery: Int?, via: SosLocationVia) =
        SosLocation(at = at, lat = -33.8688, lng = 151.2093, accuracyM = accuracy, batteryPct = battery, via = via)

    @Test
    fun whichEventsRing() {
        val started = event("sos.started", """{"sosId":"s1","startedAt":"2026-10-29T03:00:00Z","location":null}""")
        assertEquals("s1", sosIdOf(started))
        assertTrue(ringsAlarm(started))
        assertFalse(stopsAlarm(started))
        val acked = event("sos.acked", """{"sosId":"s1","byName":"Mum"}""")
        assertEquals("s1", sosIdOf(acked))
        assertFalse(ringsAlarm(acked))
        assertFalse(stopsAlarm(acked))
        val ended = event("sos.ended", """{"sosId":"s1","endedBy":"kid","byName":null}""")
        assertFalse(ringsAlarm(ended))
        assertTrue(stopsAlarm(ended))
        assertNull(sosIdOf(event("time_request", """{"sosId":"s1"}""")))
        assertFalse(ringsAlarm(event("sos.started", """{}""")))
    }

    @Test
    fun timeWords() {
        assertEquals("SOS from Alex", sosTitle("Alex"))
        assertEquals("just now", agoText(Instant.parse("2026-10-29T03:09:30Z"), now))
        assertEquals("just now", agoText(Instant.parse("2026-10-29T03:11:00Z"), now))
        assertEquals("1 min ago", agoText(Instant.parse("2026-10-29T03:09:00Z"), now))
        assertEquals("10 min ago", agoText(Instant.parse("2026-10-29T03:00:00Z"), now))
        assertEquals("1h 5m ago", agoText(Instant.parse("2026-10-29T02:05:00Z"), now))
    }

    @Test
    fun locationWords() {
        assertEquals("Waiting for a location", seenText(null, now))
        val good = loc("2026-10-29T03:09:00Z", 19.6, 54, SosLocationVia.DATA)
        assertEquals("Updated 1 min ago · within 20\u00A0m", seenText(good, now))
        assertEquals("Battery 54%", batteryText(good))
        val text = loc("2026-10-29T03:00:00Z", null, null, SosLocationVia.SMS)
        assertEquals("Updated 10 min ago · by text", seenText(text, now))
        assertNull(batteryText(text))
        assertNull(batteryText(null))
        assertEquals("geo:0,0?q=-33.86880,151.20930(Alex)", mapsUri(good, "Alex"))
        assertEquals("geo:0,0?q=-33.86880,151.20930(Al ex)", mapsUri(good, "Al (ex)"))
    }

    @Test
    fun whoIsOnIt() {
        fun ack(name: String) = SosAck(parentId = name, byName = name, at = "2026-10-29T03:01:00Z")
        assertEquals("No one has said they're on it yet", acksText(emptyList()))
        assertEquals("Mum is on it", acksText(listOf(ack("Mum"))))
        assertEquals("Mum and Dad are on it", acksText(listOf(ack("Mum"), ack("Dad"))))
        assertEquals("Mum, Dad and Nan are on it", acksText(listOf(ack("Mum"), ack("Dad"), ack("Nan"))))
        assertEquals("Mum is on it", acksText(listOf(ack("Mum"), ack("Mum"))))
    }

    @Test
    fun endedWords() {
        assertEquals("Alex said they're safe", endedText("kid", null, "Alex"))
        assertEquals("Ended by Dad", endedText("parent", "Dad", "Alex"))
        assertEquals("Ended by a parent", endedText("parent", null, "Alex"))
        assertEquals("Stopped by itself", endedText("auto", null, "Alex"))
    }
}
