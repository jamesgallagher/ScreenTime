package au.screentime.kid.ask

import au.screentime.core.model.api.ApiClient
import au.screentime.kid.live.Answer
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
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class SenderTest {
    private val requests = mutableListOf<HttpRequestData>()

    private fun sender(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = Sender(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
    )

    private fun MockRequestHandleScope.json(text: String, status: HttpStatusCode = HttpStatusCode.Created) =
        respond(text, status, headersOf(HttpHeaders.ContentType, "application/json"))

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    private val request = """{"id":"r1","kidId":"k1","kidName":"Alex","deviceId":"d1","deviceName":"Pixel 7",""" +
        """"pool":"phone","minutes":30,"reason":null,"status":"pending","createdAt":"2026-10-27T09:00:00Z",""" +
        """"resolvedAt":null,"resolvedByName":null,"grantId":null,"grantedMinutes":null}"""

    private val message = """{"id":"m1","kidId":"k1","kidName":"Alex","deviceId":"d1","deviceName":"Pixel 7",""" +
        """"body":"Can you call me?","presetId":"p1","createdAt":"2026-10-27T09:00:00Z"}"""

    @Test
    fun anAskSendsTheMinutesAndATrimmedReason() = runBlocking {
        val send = sender { json(request) }

        assertEquals(SendResult.SENT, send.ask("r1", 30, "  homework  "))
        assertEquals(SendResult.SENT, send.ask("r2", 15, "   "))

        assertEquals("/v1/device/time-requests", requests[0].url.encodedPath)
        assertEquals("Bearer device-token", requests[0].headers[HttpHeaders.Authorization])
        assertEquals("""{"id":"r1","minutes":30,"reason":"homework"}""", requests[0].bodyText())
        // No reason: the field is left out.
        assertEquals("""{"id":"r2","minutes":15}""", requests[1].bodyText())
    }

    @Test
    fun aMessageSendsThePresetIdOnlyWhenThereIsOne() = runBlocking {
        val send = sender { json(message) }

        assertEquals(SendResult.SENT, send.message("m1", "Can you call me?", "p1"))
        assertEquals(SendResult.SENT, send.message("m2", " I'm at Sam's ", null))

        assertEquals("/v1/device/messages", requests[0].url.encodedPath)
        assertEquals("""{"id":"m1","body":"Can you call me?","presetId":"p1"}""", requests[0].bodyText())
        assertEquals("""{"id":"m2","body":"I'm at Sam's"}""", requests[1].bodyText())
    }

    @Test
    fun theServerAndTheNetworkSayWhatWentWrong() = runBlocking {
        val conflict = """{"error":{"code":"conflict","message":"Already waiting."}}"""

        assertEquals(SendResult.ALREADY_ASKED, sender { json(conflict, HttpStatusCode.Conflict) }.ask("r1", 15, ""))
        assertEquals(SendResult.FAILED, sender { respond("", HttpStatusCode.BadGateway) }.ask("r1", 15, ""))
        assertEquals(SendResult.OFFLINE, sender { throw IOException("no network") }.message("m1", "Hi", null))
    }

    @Test
    fun theKidSeesWordsNotCodes() {
        assertNull(sendErrorText(SendResult.SENT, "Mum or Dad"))
        assertNull(sendErrorText(SendResult.ALREADY_ASKED, "Mum or Dad"))
        assertEquals(
            "Can't reach Mum or Dad right now. Check the internet and try again.",
            sendErrorText(SendResult.OFFLINE, "Mum or Dad"),
        )
        assertEquals("That didn't work. Try again in a minute.", sendErrorText(SendResult.FAILED, "Dad"))
    }

    @Test
    fun theAnswerSaysWhoAndHowMuch() {
        assertEquals("Dad said yes! +15 min 🎉", answerText(Answer(approved = true, minutes = 15, byName = "Dad")))
        assertEquals("Mum said yes! +1h 30m 🎉", answerText(Answer(approved = true, minutes = 90, byName = "Mum")))
        assertEquals("Dad said not this time", answerText(Answer(approved = false, minutes = 0, byName = "Dad")))
    }
}
