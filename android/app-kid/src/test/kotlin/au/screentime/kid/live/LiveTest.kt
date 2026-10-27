package au.screentime.kid.live

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class LiveTest {
    @Test
    fun theAddressSwapsTheSchemeAndAddsThePath() {
        assertEquals("ws://10.0.2.2:8080/v1/device/ws", liveUrl("http://10.0.2.2:8080"))
        assertEquals("wss://screentime.gallagherhome.au/v1/device/ws", liveUrl("https://screentime.gallagherhome.au/"))
        assertThrows<IllegalArgumentException> { liveUrl("ftp://example.com") }
    }

    @Test
    fun theBackoffDoublesUpToAMinute() {
        val waits = (0..8).map { backoffMs(it, 1.0) }

        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L, 60_000L), waits)
    }

    @Test
    fun theJitterIsTwentyPercentEitherWay() {
        assertEquals(800L, backoffMs(0, 0.8))
        assertEquals(1_200L, backoffMs(0, 1.2))
        assertEquals(48_000L, backoffMs(10, 0.8))
        assertEquals(72_000L, backoffMs(10, 1.2))
        assertEquals(60_000L, backoffMs(Int.MAX_VALUE, 1.0))
    }

    @Test
    fun everyEnvelopeButAPongAsksForASync() {
        assertTrue(asksForSync("""{"v":1,"type":"grant_added","at":"2026-10-27T09:00:00Z","data":{}}"""))
        assertTrue(asksForSync("""{"v":1,"type":"state_changed","at":"2026-10-27T09:00:00Z","data":{}}"""))
        assertTrue(asksForSync("""{"v":1,"type":"something_new","at":"2026-10-27T09:00:00Z","data":{}}"""))
        assertFalse(asksForSync("""{"v":1,"type":"pong","at":"2026-10-27T09:00:00Z","data":{}}"""))
    }

    @Test
    fun aFrameThatIsNotAnEnvelopeMeansNothing() {
        assertFalse(asksForSync("hello"))
        assertFalse(asksForSync(""))
        assertFalse(asksForSync("[1, 2]"))
        assertFalse(asksForSync("""{"v":1}"""))
        assertFalse(asksForSync("""{"type":{"a":1}}"""))
        assertFalse(asksForSync("""{"type":null}"""))
    }
}
