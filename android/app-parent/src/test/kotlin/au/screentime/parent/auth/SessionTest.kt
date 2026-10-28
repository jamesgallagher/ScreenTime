package au.screentime.parent.auth

import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.Me
import au.screentime.core.model.api.MeFamily
import au.screentime.core.model.api.MeParent
import au.screentime.core.model.api.Role
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
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class SessionTest {
    private val me = Me(
        parent = MeParent("p1", "dad@example.com", "Dad", null),
        family = MeFamily("f1", "Dev family", "Australia/Sydney", "000"),
        roles = listOf(Role.PARENT),
    )
    private val meJson =
        """{"parent":{"id":"p1","email":"dad@example.com","displayName":"Dad","phoneE164":null},""" +
            """"family":{"id":"f1","name":"Dev family","timezone":"Australia/Sydney","emergencyNumber":"000"},""" +
            """"roles":["parent"]}"""

    private class MemoryStore(var saved: Saved? = null) : TokenStore {
        override fun load() = saved

        override fun save(saved: Saved) {
            this.saved = saved
        }

        override fun clear() {
            saved = null
        }
    }

    private var now = 1_000_000L
    private val requests = mutableListOf<HttpRequestData>()
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun session(
        store: TokenStore,
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ) = Session(
        "https://api.example",
        MockEngine { request ->
            requests += request
            handler(request)
        },
        store,
        clock = { now },
    )

    private fun MockRequestHandleScope.tokens(access: String, refresh: String) =
        respond("""{"accessToken":"$access","refreshToken":"$refresh","expiresIn":900,"me":$meJson}""", HttpStatusCode.OK, json)

    private fun MockRequestHandleScope.unauthorized() =
        respond("""{"error":{"code":"unauthorized","message":"Sign in again."}}""", HttpStatusCode.Unauthorized, json)

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    private fun HttpRequestData.bearer() = headers[HttpHeaders.Authorization]

    private val paths get() = requests.map { it.url.encodedPath }

    @Test
    fun startsSignedInOnlyWithASavedSignIn() {
        assertEquals(SessionState.SignedOut, session(MemoryStore()) { error("no call") }.state.value)
        assertEquals(SessionState.SignedIn(me), session(MemoryStore(Saved("r0", me))) { error("no call") }.state.value)
    }

    @Test
    fun theCodeSignsInAsAnAndroidPhoneAndKeepsTheRefreshToken() = runBlocking {
        val store = MemoryStore()
        val session = session(store) { tokens("a1", "r1") }

        session.verify("dad@example.com", "123456", "Pixel 10")

        assertEquals("/v1/auth/otp/verify", requests.single().url.encodedPath)
        assertEquals(
            """{"email":"dad@example.com","code":"123456","client":"android","clientLabel":"Pixel 10"}""",
            requests.single().bodyText(),
        )
        assertEquals(Saved("r1", me), store.saved)
        assertEquals(SessionState.SignedIn(me), session.state.value)
    }

    @Test
    fun aSavedSignInSwapsTheRefreshTokenBeforeTheFirstCall() = runBlocking {
        val store = MemoryStore(Saved("r0", me))
        val session = session(store) { request ->
            if (request.url.encodedPath == "/v1/auth/refresh") tokens("a1", "r1") else respond("", HttpStatusCode.NoContent)
        }

        session.call { postAuthLogout() }

        assertEquals(listOf("/v1/auth/refresh", "/v1/auth/logout"), paths)
        assertEquals("""{"refreshToken":"r0"}""", requests[0].bodyText())
        assertNull(requests[0].bearer())
        assertEquals("Bearer a1", requests[1].bearer())
        assertEquals("r1", store.saved?.refreshToken)
    }

    @Test
    fun theAccessTokenIsUsedUntilAMinuteBeforeItRunsOut() = runBlocking {
        var n = 0
        val session = session(MemoryStore()) { request ->
            when (request.url.encodedPath) {
                "/v1/auth/otp/verify" -> tokens("a1", "r1")
                "/v1/auth/refresh" -> tokens("a${++n + 1}", "r${n + 1}")
                else -> respond("", HttpStatusCode.NoContent)
            }
        }
        session.verify("dad@example.com", "123456", "Pixel 10")

        now += 839_000
        session.call { postAuthLogout() }
        now += 1_000
        session.call { postAuthLogout() }

        assertEquals(listOf("/v1/auth/otp/verify", "/v1/auth/logout", "/v1/auth/refresh", "/v1/auth/logout"), paths)
        assertEquals("Bearer a1", requests[1].bearer())
        assertEquals("Bearer a2", requests[3].bearer())
    }

    @Test
    fun a401SwapsTheTokensAndTriesOnceMore() = runBlocking {
        val store = MemoryStore()
        var logouts = 0
        val session = session(store) { request ->
            when (request.url.encodedPath) {
                "/v1/auth/otp/verify" -> tokens("a1", "r1")
                "/v1/auth/refresh" -> tokens("a2", "r2")
                else -> if (++logouts == 1) unauthorized() else respond("", HttpStatusCode.NoContent)
            }
        }
        session.verify("dad@example.com", "123456", "Pixel 10")

        session.call { postAuthLogout() }

        assertEquals(listOf("/v1/auth/otp/verify", "/v1/auth/logout", "/v1/auth/refresh", "/v1/auth/logout"), paths)
        assertEquals("""{"refreshToken":"r1"}""", requests[2].bodyText())
        assertEquals("Bearer a2", requests[3].bearer())
        assertEquals("r2", store.saved?.refreshToken)
    }

    @Test
    fun callsAtTheSameTimeSwapTheTokensOnce() = runBlocking {
        val session = session(MemoryStore(Saved("r0", me))) { request ->
            if (request.url.encodedPath == "/v1/auth/refresh") {
                delay(50)
                tokens("a1", "r1")
            } else {
                respond("", HttpStatusCode.NoContent)
            }
        }

        (1..3).map { async { session.call { postAuthLogout() } } }.awaitAll()

        assertEquals(1, paths.count { it == "/v1/auth/refresh" })
        assertEquals(3, paths.count { it == "/v1/auth/logout" })
    }

    @Test
    fun aRefreshTokenTheServerRefusesSignsOut() = runBlocking {
        val store = MemoryStore(Saved("r0", me))
        val session = session(store) { unauthorized() }

        assertThrows<SignedOutException> { runBlocking { session.call { getToday() } } }

        assertNull(store.saved)
        assertEquals(SessionState.SignedOut, session.state.value)
    }

    @Test
    fun noConnectionOrAnotherErrorKeepsTheSignIn() = runBlocking {
        val store = MemoryStore(Saved("r0", me))
        var first = true
        val session = session(store) { request ->
            when {
                first -> {
                    first = false
                    throw IOException("offline")
                }
                request.url.encodedPath == "/v1/auth/refresh" -> tokens("a1", "r1")
                else -> respond("""{"error":{"code":"internal","message":"x"}}""", HttpStatusCode.InternalServerError, json)
            }
        }

        assertThrows<IOException> { runBlocking { session.call { getToday() } } }
        val e = assertThrows<ApiException> { runBlocking { session.call { getToday() } } }

        assertEquals(500, e.status)
        assertEquals("r1", store.saved?.refreshToken)
        assertEquals(SessionState.SignedIn(me), session.state.value)
    }

    @Test
    fun signOutTellsTheServerAndForgetsEvenOffline() = runBlocking {
        val online = MemoryStore(Saved("r0", me))
        val session = session(online) { request ->
            if (request.url.encodedPath == "/v1/auth/refresh") tokens("a1", "r1") else respond("", HttpStatusCode.NoContent)
        }
        session.signOut()
        assertEquals(listOf("/v1/auth/refresh", "/v1/auth/logout"), paths)
        assertNull(online.saved)
        assertEquals(SessionState.SignedOut, session.state.value)

        val offline = MemoryStore(Saved("r0", me))
        val cut = session(offline) { throw IOException("offline") }
        cut.signOut()
        assertNull(offline.saved)
        assertTrue(cut.state.value == SessionState.SignedOut)
    }
}
