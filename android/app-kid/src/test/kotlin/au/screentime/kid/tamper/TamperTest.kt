package au.screentime.kid.tamper

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceEventIn
import au.screentime.core.model.api.DeviceEventKind
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TamperTest {
    private val now = Instant.parse("2026-10-28T05:00:00Z").toEpochMilli()
    private val minute = 60_000L

    private fun event(n: Int) = tamperEvent("e$n", DeviceEventKind.TAMPER_CALL_BLOCKED, now + n)

    @Test
    fun aClockSetMoreThanTwoMinutesAwayIsAnAttempt() {
        assertNull(clockJumpMin(now, now))
        assertNull(clockJumpMin(now + 2 * minute, now))
        assertNull(clockJumpMin(now - 2 * minute, now))
        assertEquals(10L, clockJumpMin(now + 10 * minute + 5_000, now))
        // A server clock a little ahead of the phone's still makes 10.
        assertEquals(10L, clockJumpMin(now + 10 * minute - 800, now))
        assertEquals(-3L, clockJumpMin(now - 3 * minute, now))
    }

    @Test
    fun onlyAPolicyThatWasOnBeforeCanBeMissing() {
        assertEquals(listOf("auto_time", "no_safe_boot"), missingPolicies(setOf("no_safe_boot", "auto_time", "a"), setOf("a")))
        // New in this version of the app: never on, so not missing.
        assertEquals(emptyList<String>(), missingPolicies(setOf("a"), setOf("a", "no_add_user")))
        assertEquals(emptyList<String>(), missingPolicies(setOf("a", "b"), setOf("a", "b")))
    }

    @Test
    fun theSameKindWithinAMinuteIsTheSameAttempt() {
        assertFalse(isRepeat(null, now))
        assertTrue(isRepeat(now - 59_000, now))
        assertFalse(isRepeat(now - minute, now))
        // The last one is in the future: trusted time went back after a reboot without the server.
        assertFalse(isRepeat(now + 5_000, now))
    }

    @Test
    fun anEventIsSentAsTheServerReadsIt() {
        val clock = tamperEvent("e1", DeviceEventKind.TAMPER_CLOCK, now, mapOf("offsetMin" to "10"))
        assertEquals(
            """{"id":"e1","kind":"tamper.clock","at":"2026-10-28T05:00:00Z","payload":{"offsetMin":"10"}}""",
            ApiJson.encodeToString(DeviceEventIn.serializer(), clock),
        )
        assertEquals(
            """{"id":"e2","kind":"tamper.call_blocked","at":"2026-10-28T05:00:00Z"}""",
            ApiJson.encodeToString(DeviceEventIn.serializer(), tamperEvent("e2", DeviceEventKind.TAMPER_CALL_BLOCKED, now)),
        )
    }

    @Test
    fun theQueueKeepsTheNewestHundred() {
        val full = (1..MAX_QUEUE).map(::event)
        val more = full.plusEvent(event(101))

        assertEquals(MAX_QUEUE, more.size)
        assertEquals("e2", more.first().id)
        assertEquals("e101", more.last().id)
        assertEquals(listOf("e1"), emptyList<DeviceEventIn>().plusEvent(event(1)).map { it.id })
    }

    @Test
    fun theCaughtScreenTakesTurnsAndNamesTheParents() {
        val dad = listOf("Dad")
        val both = listOf("Mum", "Dad")

        assertEquals(CaughtLine("🕵️", "Nice try, Agent Alex!", "Dad has been told."), caughtLine(0, "Alex", dad))
        assertEquals("Mum and Dad have been told.", caughtLine(0, "Alex", both).body)
        assertEquals("Your parents have been told.", caughtLine(0, "Alex", emptyList()).body)
        assertEquals(CaughtLine("🚨", "Busted!", "The Time Police have filed a report."), caughtLine(1, "Alex", dad))
        assertEquals(
            CaughtLine("💻", "Whoa there, hacker!", "This attempt has been sent to HQ (Mum and Dad)."),
            caughtLine(2, "Alex", both),
        )
        assertEquals(caughtLine(0, "Alex", dad), caughtLine(3, "Alex", dad))
    }

    private val requests = mutableListOf<HttpRequestData>()

    private fun api(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = TamperApi(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
    )

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    @Test
    fun flushSendsFiftyAtATimeOldestFirst() = runBlocking {
        val queue = (1..120).map(::event)

        val sent = api { respond("", HttpStatusCode.NoContent) }.flush(queue)

        assertEquals(queue, sent)
        assertEquals(3, requests.size)
        assertTrue(requests.all { it.url.encodedPath == "/v1/device/events" })
        assertTrue(requests[0].bodyText().startsWith("""{"events":[{"id":"e1","kind":"tamper.call_blocked","""))
        assertTrue(requests[2].bodyText().contains(""""id":"e101""""))
        assertFalse(requests[1].bodyText().contains(""""id":"e101""""))
    }

    @Test
    fun flushStopsAtTheFirstUploadThatDoesNotGetThrough() = runBlocking {
        val queue = (1..70).map(::event)

        val sent = api { if (requests.size == 1) respond("", HttpStatusCode.NoContent) else throw IOException("offline") }
            .flush(queue)

        assertEquals(queue.take(50), sent)
        assertEquals(2, requests.size)
    }

    @Test
    fun anAnswerThatIsAnErrorCountsAsSent() = runBlocking {
        val sent = api { respond("""{"error":{"code":"validation","message":"bad"}}""", HttpStatusCode.UnprocessableEntity) }
            .flush(listOf(event(1)))

        assertEquals(listOf(event(1)), sent)
    }
}
