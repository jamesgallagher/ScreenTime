package au.screentime.kid.parentmode

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.DeviceStateParentMode
import au.screentime.kid.ask.SendResult
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ParentModeTest {
    /** The RFC 6238 test key, "12345678901234567890", in base32. */
    private val rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    private fun ms(iso: String) = Instant.parse(iso).toEpochMilli()

    private val off = DeviceStateParentMode(active = false, endsAt = null, byName = null)

    @Test
    fun theDurationsReadAsOnTheChips() {
        assertEquals(
            listOf("2 min", "5 min", "15 min", "1 hour", "Until I end it"),
            PARENT_MODE_MINUTES.map(::durationText),
        )
    }

    @Test
    fun base32IsDecodedInAnyCaseWithPadding() {
        assertArrayEquals("12345678901234567890".toByteArray(), base32Decode(rfcSecret))
        assertArrayEquals("12345678901234567890".toByteArray(), base32Decode(rfcSecret.lowercase()))
        assertArrayEquals("f".toByteArray(), base32Decode("MY======"))
        assertArrayEquals("foobar".toByteArray(), base32Decode("MZXW6YTBOI======"))
        assertNull(base32Decode("MZXW1"))
    }

    @Test
    fun theCodesAreTheRfc6238OnesCutToSixDigits() {
        val key = base32Decode(rfcSecret)!!
        assertEquals("287082", parentCode(key, 59_000L))
        assertEquals("081804", parentCode(key, 1_111_111_109_000L))
        assertEquals("050471", parentCode(key, 1_111_111_111_000L))
        assertEquals("005924", parentCode(key, 1_234_567_890_000L))
        assertEquals("279037", parentCode(key, 2_000_000_000_000L))
        assertEquals("353130", parentCode(key, 20_000_000_000_000L))
    }

    @Test
    fun aCodeIsGoodForOneStepEitherSide() {
        val now = 1_111_111_109_000L
        assertTrue(codeOk(rfcSecret, "081804", now))
        // 30 seconds later the code shown before still works; 60 seconds later it does not.
        assertTrue(codeOk(rfcSecret, "081804", now + 30_000L))
        assertTrue(codeOk(rfcSecret, "081804", now - 30_000L))
        assertFalse(codeOk(rfcSecret, "081804", now + 60_000L))
        assertFalse(codeOk(rfcSecret, "081805", now))
        assertFalse(codeOk(rfcSecret, "81804", now))
        assertFalse(codeOk(rfcSecret, "08180a", now))
        assertFalse(codeOk("not base32!", "081804", now))
        assertFalse(codeOk("", "081804", now))
    }

    @Test
    fun theSnapshotSaysWhenAParentTurnedItOn() {
        val now = ms("2026-10-27T05:00:00Z")
        val on = DeviceStateParentMode(active = true, endsAt = "2026-10-27T05:15:00.000Z", byName = "Dad")

        assertEquals(ParentModeOn(ms("2026-10-27T05:15:00Z"), "Dad"), parentModeNow(on, now - 1_000, LocalParentMode(), now))
        // Its time ran out before the next snapshot.
        assertNull(parentModeNow(on, now - 1_000, LocalParentMode(), ms("2026-10-27T05:15:00Z")))
        val forever = DeviceStateParentMode(active = true, endsAt = null, byName = "Mum")
        assertEquals(ParentModeOn(null, "Mum"), parentModeNow(forever, now, LocalParentMode(), now + 86_400_000L))
        assertNull(parentModeNow(off, now, LocalParentMode(), now))
    }

    @Test
    fun aCodeSessionCountsUntilTheSnapshotHasIt() {
        val start = ms("2026-10-27T05:00:00Z")
        val code = CodeSession("c1", 15, start)
        val local = LocalParentMode(code = code)

        // Not sent yet: on for 15 minutes, whatever the snapshot says.
        assertEquals(ParentModeOn(start + 15 * 60_000L, null), parentModeNow(off, start - 60_000L, local, start + 60_000L))
        assertNull(parentModeNow(off, start - 60_000L, local, start + 15 * 60_000L))
        // Sent at 05:01: an older snapshot still counts the code, a newer one is the truth.
        val sent = LocalParentMode(code = code.copy(reportedAtMs = start + 60_000L))
        assertEquals(ParentModeOn(start + 15 * 60_000L, null), parentModeNow(off, start, sent, start + 120_000L))
        assertNull(parentModeNow(off, start + 90_000L, sent, start + 120_000L))
        // "Until I end it".
        val forever = LocalParentMode(code = CodeSession("c2", null, start))
        assertEquals(ParentModeOn(null, null), parentModeNow(off, start, forever, start + 86_400_000L))
    }

    @Test
    fun endNowBeatsOlderSnapshotsAndCodeSessions() {
        val now = ms("2026-10-27T05:00:00Z")
        val on = DeviceStateParentMode(active = true, endsAt = null, byName = "Dad")
        val ended = LocalParentMode(endedAtMs = now, endReported = false)

        assertNull(parentModeNow(on, now - 1_000, ended, now + 1_000))
        // A snapshot made after the end is the truth again: a parent turned it on later.
        assertEquals(ParentModeOn(null, "Dad"), parentModeNow(on, now + 5_000, ended, now + 6_000))
        // A code session that started before the end is over; one that started after it counts.
        val before = ended.copy(code = CodeSession("c1", null, now - 60_000L))
        assertNull(parentModeNow(off, now - 120_000L, before, now + 1_000))
        val after = ended.copy(code = CodeSession("c2", 5, now + 1_000))
        assertEquals(ParentModeOn(now + 1_000 + 5 * 60_000L, null), parentModeNow(off, now - 120_000L, after, now + 2_000))
    }

    private val requests = mutableListOf<HttpRequestData>()

    private fun api(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = ParentModeApi(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
    )

    private val session = """{"id":"c1","kidId":"k1","kidName":"Alex","deviceId":"d1","deviceName":"Pixel 7",""" +
        """"method":"code","status":"active","requestedAt":"2026-10-27T05:00:00Z","startedAt":"2026-10-27T05:00:00Z",""" +
        """"endsAt":null,"endedAt":null,"durationMin":null,"approvedByName":null,"endedByName":null}"""

    private fun MockRequestHandleScope.json(text: String, status: HttpStatusCode = HttpStatusCode.Created) =
        respond(text, status, headersOf(HttpHeaders.ContentType, "application/json"))

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    @Test
    fun askingTheParentsSendsTheIdAndAlreadyOnIsFine() = runBlocking {
        assertEquals(SendResult.SENT, api { json(session) }.request("r1"))
        assertEquals("/v1/device/parent-mode-requests", requests[0].url.encodedPath)
        assertEquals("""{"id":"r1"}""", requests[0].bodyText())

        val conflict = """{"error":{"code":"conflict","message":"Parent mode is already on."}}"""
        assertEquals(SendResult.SENT, api { json(conflict, HttpStatusCode.Conflict) }.request("r2"))
        assertEquals(SendResult.FAILED, api { json("{}", HttpStatusCode.BadGateway) }.request("r3"))
        assertEquals(SendResult.OFFLINE, api { throw IOException("no network") }.request("r4"))
    }

    @Test
    fun flushSendsTheCodeSessionThenTheEndAndKeepsWhatDidNotGo() = runBlocking {
        val start = ms("2026-10-27T05:00:00Z")
        val local = LocalParentMode(code = CodeSession("c1", null, start), endedAtMs = start + 60_000L, endReported = false)

        val done = api { request ->
            if (request.url.encodedPath.endsWith("/end")) respond("", HttpStatusCode.NoContent) else json(session)
        }.flush(local, start + 120_000L)

        assertEquals(LocalParentMode(CodeSession("c1", null, start, start + 120_000L), start + 60_000L, true), done)
        assertFalse(done.pending)
        assertEquals("/v1/device/parent-mode", requests[0].url.encodedPath)
        assertEquals("""{"id":"c1","durationMin":null,"startedAt":"2026-10-27T05:00:00Z"}""", requests[0].bodyText())
        assertEquals("/v1/device/parent-mode/end", requests[1].url.encodedPath)

        // Offline: nothing changes, and the end waits for the code session.
        requests.clear()
        assertEquals(local, api { throw IOException("no network") }.flush(local, start + 120_000L))
        assertEquals(1, requests.size)
        assertTrue(local.pending)
    }
}
