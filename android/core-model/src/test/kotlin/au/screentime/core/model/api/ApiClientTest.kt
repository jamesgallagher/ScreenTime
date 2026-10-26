package au.screentime.core.model.api

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class ApiClientTest {
    private val requests = mutableListOf<HttpRequestData>()

    /** A client whose server always answers with [handler]. */
    private fun client(
        token: String? = "tok",
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ) = ApiClient(
        "https://api.example/",
        MockEngine { request ->
            requests += request
            handler(request)
        },
        token = { token },
    )

    private fun MockRequestHandleScope.json(text: String, status: HttpStatusCode = HttpStatusCode.OK) =
        respond(text, status, headersOf(HttpHeaders.ContentType, "application/json"))

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    @Test
    fun getSendsTheTokenAndReadsAList() = runBlocking {
        val api = client { json("""[{"id":"k1","name":"Mia","avatarColor":"#0F766E"}]""") }

        val kids = api.getKids()

        assertEquals(listOf(Kid("k1", "Mia", AvatarColor._0F766E)), kids)
        assertEquals(HttpMethod.Get, requests.single().method)
        assertEquals("https://api.example/v1/kids", requests.single().url.toString())
        assertEquals("Bearer tok", requests.single().headers[HttpHeaders.Authorization])
    }

    @Test
    fun aPublicRouteSendsNoTokenAnd204ReturnsUnit() = runBlocking {
        val api = client { respond("", HttpStatusCode.NoContent) }

        api.postAuthOtpRequest(OtpRequest("dad@example.com"))

        val request = requests.single()
        assertNull(request.headers[HttpHeaders.Authorization])
        assertEquals("application/json", request.body.contentType.toString())
        assertEquals("""{"email":"dad@example.com"}""", request.bodyText())
    }

    @Test
    fun anOptionalFieldIsLeftOutAndOptCanSendNull() = runBlocking {
        val parent = """{"id":"p1","email":"mum@example.com","displayName":"Mum","phoneE164":null}"""
        val api = client { json(parent) }

        api.patchFamilyParentsById("p1", ParentPatch(displayName = "Mum"))
        api.patchFamilyParentsById("p1", ParentPatch(phoneE164 = Opt.Value(null)))
        api.patchFamilyParentsById("p1", ParentPatch(phoneE164 = Opt.Value("+61400000000")))

        assertEquals("""{"displayName":"Mum"}""", requests[0].bodyText())
        assertEquals("""{"phoneE164":null}""", requests[1].bodyText())
        assertEquals("""{"phoneE164":"+61400000000"}""", requests[2].bodyText())
    }

    @Test
    fun aRequiredNullableFieldIsAlwaysSent() = runBlocking {
        val api = client { respond("", HttpStatusCode.NoContent) }

        api.putMePushToken(PushTokenPut(fcmToken = null))

        assertEquals("""{"fcmToken":null}""", requests.single().bodyText())
    }

    @Test
    fun anOptFieldIsReadBack() {
        val present = ApiJson.decodeFromString<ParentPatch>("""{"phoneE164":null}""")
        val missing = ApiJson.decodeFromString<ParentPatch>("""{}""")

        assertEquals(Opt.Value(null), present.phoneE164)
        assertEquals(Opt.Absent, missing.phoneE164)
        assertNull(missing.phoneE164.valueOrNull)
    }

    @Test
    fun queryParametersUseTheWireTextAndSkipNulls() = runBlocking {
        val api = client { json("[]") }

        api.getRequests(status = TimeRequestStatus.PENDING, limit = 10)
        api.getSos(active = true)

        assertEquals("https://api.example/v1/requests?status=pending&limit=10", requests[0].url.toString())
        assertEquals("https://api.example/v1/sos?active=true", requests[1].url.toString())
    }

    @Test
    fun aPathParameterIsEncoded() = runBlocking {
        val api = client { json("""{"id":"a/b","name":"Mia","avatarColor":"#0F766E"}""") }

        api.getKidsById("a/b")

        assertEquals("/v1/kids/a%2Fb", requests.single().url.encodedPath)
    }

    @Test
    fun anErrorBecomesApiException() = runBlocking {
        val api = client {
            json("""{"error":{"code":"not_found","message":"Not found."}}""", HttpStatusCode.NotFound)
        }

        val e = assertThrows<ApiException> { runBlocking { api.getKidsById("k9") } }

        assertEquals(404, e.status)
        assertEquals(ErrorCode.NOT_FOUND, e.error?.code)
        assertEquals("HTTP 404 not_found: Not found.", e.message)
    }

    @Test
    fun anErrorThatIsNotJsonStillBecomesApiException() = runBlocking {
        val api = client { respond("Bad gateway", HttpStatusCode.BadGateway) }

        val e = assertThrows<ApiException> { runBlocking { api.getHealth() } }

        assertEquals(502, e.status)
        assertNull(e.error)
    }

    @Test
    fun unknownFieldsAreIgnored() = runBlocking {
        val api = client { json("""{"status":"ok","service":"screentime","time":"2026-10-26T10:00:00Z","new":1}""") }

        val health = api.getHealth()

        assertEquals(HealthResponseStatus.OK, health.status)
    }

    @Test
    fun deviceStateSendsIfNoneMatchAndReads304() = runBlocking {
        val api = client {
            respond("", HttpStatusCode.NotModified, headersOf(HttpHeaders.Date, "Mon, 26 Oct 2026 10:00:00 GMT"))
        }

        val state = api.getDeviceState(ifNoneMatch = "\"v7\"")

        assertEquals("\"v7\"", requests.single().headers[HttpHeaders.IfNoneMatch])
        assertNull(state.value)
        assertEquals("Mon, 26 Oct 2026 10:00:00 GMT", state.date)
    }

    @Test
    fun a304WithoutIfNoneMatchIsAnError() = runBlocking {
        val api = client { respond("", HttpStatusCode.NotModified) }

        val e = assertThrows<ApiException> { runBlocking { api.getMe() } }

        assertEquals(304, e.status)
    }

    @Test
    fun numberChoicesAndNullableReferencesAreRead() {
        val text = """{"id":"r1","durationMin":null,"startedAt":"2026-10-26T10:00:00Z"}"""

        assertNull(ApiJson.decodeFromString<ParentModeByCode>(text).durationMin)
        assertEquals("""{"durationMin":15}""", ApiJson.encodeToString(ParentModeStart(15)))
        assertEquals("""{"durationMin":null}""", ApiJson.encodeToString(ParentModeStart(null)))
    }
}
