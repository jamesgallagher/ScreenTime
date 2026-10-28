package au.screentime.kid.sos

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.DeviceStateActiveSos
import au.screentime.kid.calls.Callable
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
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SosTest {
    private fun ms(iso: String) = Instant.parse(iso).toEpochMilli()

    private val start = ms("2026-10-27T05:00:00Z")
    private val minute = 60_000L

    private fun fix(at: Long, lat: Double = -33.8688, lng: Double = 151.2093) =
        SosFix(atMs = at, lat = lat, lng = lng, accuracyM = 20.4, batteryPct = 54)

    @Test
    fun anSosRunsForTwoHoursAndTakesOnlyNewerPositions() {
        val sos = startSos("s1", start)

        assertTrue(sos.active)
        assertFalse(sos.done)
        assertEquals(start + 2 * 60 * minute, sos.autoStopAtMs)
        val one = sos.withFix(fix(start + 1_000))
        assertEquals(listOf(fix(start + 1_000)), one.queue)
        assertEquals(one, one.withFix(fix(start + 1_000)))
        assertEquals(one, one.withFix(fix(start)))
        val two = one.withFix(fix(start + 31_000))
        assertEquals(2, two.queue.size)
        assertEquals(fix(start + 31_000), two.lastFix)
        val ended = two.endedByKid(start + 40_000)
        assertEquals(ended, ended.withFix(fix(start + 61_000)))
    }

    @Test
    fun withoutTheServerItTextsAgainEveryFiveMinutes() {
        val sos = startSos("s1", start).withFix(fix(start + 1_000)).textSent(start + 2_000)

        assertTrue(sos.queue.single().bySms)
        assertFalse(sos.textDue(start + 2_000 + 5 * minute - 1))
        assertTrue(sos.textDue(start + 2_000 + 5 * minute))
        // The server answered a minute ago: no text.
        val online = sos.copy(lastDataAtMs = start + 4 * minute)
        assertFalse(online.textDue(start + 2_000 + 5 * minute))
        assertTrue(online.textDue(start + 9 * minute))
        assertFalse(sos.endedByKid(start + minute).textDue(start + 10 * minute))
    }

    @Test
    fun itEndsByTheKidByItselfOrWhenTheSnapshotNoLongerHasIt() {
        val sos = startSos("s1", start)

        val safe = sos.endedByKid(start + minute)
        assertEquals(SosEnd.KID, safe.endedBy)
        assertFalse(safe.endReported)
        assertEquals(safe, safe.endedByKid(start + 2 * minute))

        assertEquals(sos, sos.autoStopped(sos.autoStopAtMs - 1))
        val auto = sos.autoStopped(sos.autoStopAtMs + minute)
        assertEquals(SosEnd.AUTO, auto.endedBy)
        assertEquals(sos.autoStopAtMs, auto.endedAtMs)
        assertTrue(auto.endReported)

        // Not on the server yet, or the snapshot is older than the start: nothing to learn from it.
        assertEquals(sos, sos.checkedAgainst(null, start + minute, start + minute))
        val reported = sos.copy(startReportedAtMs = start + 1_000)
        assertEquals(reported, reported.checkedAgainst(null, start + 500, start + minute))
        assertEquals(reported, reported.checkedAgainst(DeviceStateActiveSos("s1", "2026-10-27T05:00:00Z"), start + minute, start + minute))
        val gone = reported.checkedAgainst(null, start + 2_000, start + minute)
        assertEquals(SosEnd.PARENT, gone.endedBy)
        assertNull(gone.endedByName)
        assertTrue(gone.endReported)
    }

    @Test
    fun theParentsNewsIsReadFromTheThreeSosMessages() {
        val ack = """{"v":1,"type":"sos_ack","at":"2026-10-27T05:01:00Z","data":{"sosId":"s1","byName":"Dad"}}"""
        val extended = """{"v":1,"type":"sos_extended","at":"2026-10-27T06:59:00Z","data":""" +
            """{"sosId":"s1","byName":"Mum","autoStopAt":"2026-10-27T09:00:00.000Z"}}"""
        val ended = """{"v":1,"type":"sos_ended","at":"2026-10-27T05:20:00Z","data":{"sosId":"s1","byName":"Dad"}}"""

        assertEquals(SosNews("sos_ack", "s1", "Dad", null), sosNewsOf(ack))
        assertEquals(SosNews("sos_extended", "s1", "Mum", ms("2026-10-27T09:00:00Z")), sosNewsOf(extended))
        assertEquals(SosNews("sos_ended", "s1", "Dad", null), sosNewsOf(ended))
        assertNull(sosNewsOf("""{"v":1,"type":"grant_added","data":{"sosId":"s1","byName":"Dad"}}"""))
        assertNull(sosNewsOf("""{"v":1,"type":"sos_ack","data":{"sosId":"s1"}}"""))
        assertNull(sosNewsOf("""{"v":1,"type":"sos_extended","data":{"sosId":"s1","byName":"Mum","autoStopAt":"soon"}}"""))
        assertNull(sosNewsOf("not json"))
    }

    @Test
    fun newsChangesOnlyThisSos() {
        val sos = startSos("s1", start)

        val seen = sos.withNews(SosNews("sos_ack", "s1", "Dad", null), start + minute)
        assertEquals(listOf("Dad"), seen.seenBy)
        assertEquals(seen, seen.withNews(SosNews("sos_ack", "s1", "Dad", null), start + 2 * minute))
        assertEquals(listOf("Dad", "Mum"), seen.withNews(SosNews("sos_ack", "s1", "Mum", null), start + 2 * minute).seenBy)
        assertEquals(sos, sos.withNews(SosNews("sos_ack", "other", "Dad", null), start + minute))
        assertEquals(start + 4 * 60 * minute, sos.withNews(SosNews("sos_extended", "s1", "Mum", start + 4 * 60 * minute), start).autoStopAtMs)
        val ended = sos.withNews(SosNews("sos_ended", "s1", "Dad", null), start + 3 * minute)
        assertEquals(SosEnd.PARENT, ended.endedBy)
        assertEquals("Dad", ended.endedByName)
        assertEquals(start + 3 * minute, ended.endedAtMs)
        assertTrue(ended.endReported)
    }

    @Test
    fun theTextsSayWhereAndHowLongAgo() {
        val now = start + 10 * minute

        assertEquals("https://maps.google.com/?q=-33.86880,151.20930 (±20 m)", mapsText(fix(now)))
        assertEquals("https://maps.google.com/?q=1.50000,-0.12346", mapsText(fix(now, 1.5, -0.123456).copy(accuracyM = null)))
        assertEquals(
            "SOS from Alex. Location: https://maps.google.com/?q=-33.86880,151.20930 (±20 m). Battery 54%.",
            sosText("Alex", fix(now - 5_000), 54, now),
        )
        assertEquals("SOS from Alex. No location yet. Battery 54%.", sosText("Alex", null, 54, now))
        assertEquals("SOS from Alex. No location yet.", sosText("Alex", null, null, now))
        assertEquals(
            "SOS from Alex, still on. Location 3 min ago: https://maps.google.com/?q=-33.86880,151.20930 (±20 m). Battery 51%.",
            sosText("Alex", fix(now - 3 * minute - 5_000), 51, now, again = true),
        )
        assertEquals(
            "SOS from Alex, still on. Location: https://maps.google.com/?q=-33.86880,151.20930 (±20 m).",
            sosText("Alex", fix(now - 30_000), null, now, again = true),
        )

        val sos = startSos("s1", start).withFix(fix(start + 1_000))
        assertEquals(
            "Alex is safe: SOS ended. Last location: https://maps.google.com/?q=-33.86880,151.20930 (±20 m).",
            sosEndText("Alex", sos.endedByKid(now)),
        )
        assertEquals(
            "Alex's SOS was ended by Dad.",
            sosEndText("Alex", startSos("s1", start).withNews(SosNews("sos_ended", "s1", "Dad", null), now)),
        )
        assertEquals("Alex's SOS has ended.", sosEndText("Alex", startSos("s1", start).copy(endedAtMs = now, endedBy = SosEnd.PARENT)))
        assertEquals("Alex's SOS has stopped by itself.", sosEndText("Alex", startSos("s1", start).autoStopped(start + 3 * 60 * minute)))
    }

    @Test
    fun theScreenSaysHowFarItGotAndWhoHasSeenIt() {
        val parents = listOf(Callable("Dad", "+61412345678"))
        val sos = startSos("s1", start)

        val sending = sos.view(parents, listOf("Mum", "Dad"), "000")!!
        assertEquals(SosStage.SENDING, sending.stage)
        assertEquals("Telling Mum and Dad…", sending.line())
        assertNull(sending.seenLine())
        assertEquals(parents, sending.parents)
        assertEquals("000", sending.emergencyNumber)
        assertEquals("No internet. We texted Mum and Dad where you are.", sos.textSent(start).view(parents, listOf("Mum", "Dad"), "000")!!.line())
        val sent = sos.copy(startReportedAtMs = start, lastTextAtMs = start, seenBy = listOf("Dad"))
            .view(parents, listOf("Mum", "Dad"), "000")!!
        assertEquals(SosStage.SENT, sent.stage)
        assertEquals("Sent to Mum and Dad. They can see where you are.", sent.line())
        assertEquals("Dad has seen your SOS", sent.seenLine())
        assertEquals("Mum and Dad have seen your SOS", sent.copy(seenBy = listOf("Mum", "Dad")).seenLine())
        assertNull(sos.endedByKid(start).view(parents, listOf("Mum", "Dad"), "000"))
        assertNull((null as LocalSos?).view(parents, listOf("Mum", "Dad"), "000"))
    }

    private val requests = mutableListOf<HttpRequestData>()

    private fun api(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = SosApi(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
    )

    private val stored = """{"id":"s1","kidId":"k1","kidName":"Alex","deviceId":"d1","deviceName":"Pixel 7",""" +
        """"status":"active","startedAt":"2026-10-27T05:00:00.000Z","autoStopAt":"2026-10-27T07:00:00.000Z",""" +
        """"endedAt":null,"endedBy":null,"endedByName":null,"lastLocation":null,"acks":[]}"""

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    private fun MockRequestHandleScope.ok(request: HttpRequestData) = when {
        request.url.encodedPath == "/v1/device/sos" ->
            respond(stored, HttpStatusCode.Created, headersOf(HttpHeaders.ContentType, "application/json"))
        else -> respond("", HttpStatusCode.NoContent)
    }

    @Test
    fun flushSendsTheStartThePositionsAndTheEndInThatOrder() = runBlocking {
        val first = fix(start)
        val sos = startSos("s1", start).withFix(first).copy(startFix = first).withFix(fix(start + 30_000)).textSent(start)
            .endedByKid(start + minute)

        val done = api { ok(it) }.flush(sos, start + 2 * minute)

        assertEquals(listOf("/v1/device/sos", "/v1/device/sos/s1/locations", "/v1/device/sos/s1/end"), requests.map { it.url.encodedPath })
        assertEquals(
            """{"id":"s1","startedAt":"2026-10-27T05:00:00Z","location":{"at":"2026-10-27T05:00:00Z","lat":-33.8688,""" +
                """"lng":151.2093,"accuracyM":20.4,"batteryPct":54,"via":"data"}}""",
            requests[0].bodyText(),
        )
        assertEquals(
            """{"locations":[{"at":"2026-10-27T05:00:00Z","lat":-33.8688,"lng":151.2093,"accuracyM":20.4,"batteryPct":54,""" +
                """"via":"data"},{"at":"2026-10-27T05:00:30Z","lat":-33.8688,"lng":151.2093,"accuracyM":20.4,""" +
                """"batteryPct":54,"via":"sms"}]}""",
            requests[1].bodyText(),
        )
        assertEquals(start + 2 * minute, done.startReportedAtMs)
        assertEquals(start + 2 * minute, done.lastDataAtMs)
        assertTrue(done.queue.isEmpty())
        assertTrue(done.endReported)
        assertFalse(done.done)
        assertTrue(done.copy(endTextSent = true).done)
    }

    @Test
    fun offlineNothingIsMarkedSentAndAnAnswerFromTheServerCountsAsSent() = runBlocking {
        val sos = startSos("s1", start).withFix(fix(start + 1_000))

        assertEquals(sos, api { throw IOException("no network") }.flush(sos, start + minute))
        assertEquals(1, requests.size)

        // The start went; the positions did not.
        requests.clear()
        val half = api { if (it.url.encodedPath == "/v1/device/sos") ok(it) else throw IOException("gone") }.flush(sos, start + minute)
        assertEquals(start + minute, half.startReportedAtMs)
        assertEquals(1, half.queue.size)

        // A 409 (another SOS is on) is an answer: sending again would not help.
        val conflict = """{"error":{"code":"conflict","message":"An SOS is already on."}}"""
        val answered = api { respond(conflict, HttpStatusCode.Conflict, headersOf(HttpHeaders.ContentType, "application/json")) }
            .flush(sos, start + minute)
        assertEquals(start + minute, answered.startReportedAtMs)
        assertTrue(answered.queue.isEmpty())
    }
}
