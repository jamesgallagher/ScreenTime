package au.screentime.parent.kids

import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceAppUpdate
import au.screentime.core.model.api.DeviceAppUpdateState
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Me
import au.screentime.core.model.api.MeFamily
import au.screentime.core.model.api.MeParent
import au.screentime.core.model.api.Platform
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.Role
import au.screentime.parent.auth.Saved
import au.screentime.parent.auth.Session
import au.screentime.parent.auth.TokenStore
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ServerDeviceUpdatesTest {
    private val me = Me(
        parent = MeParent("p1", "dad@example.com", "Dad", null),
        family = MeFamily("f1", "Dev family", "Australia/Sydney", "000"),
        roles = listOf(Role.PARENT),
    )
    private val meJson =
        """{"parent":{"id":"p1","email":"dad@example.com","displayName":"Dad","phoneE164":null},""" +
            """"family":{"id":"f1","name":"Dev family","timezone":"Australia/Sydney","emergencyNumber":"000"},""" +
            """"roles":["parent"]}"""

    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private var now = 1_000_000L

    private class MemoryStore(var saved: Saved? = null) : TokenStore {
        override fun load() = saved
        override fun save(saved: Saved) { this.saved = saved }
        override fun clear() { saved = null }
    }

    private fun MockRequestHandleScope.tokens(access: String, refresh: String) =
        respond("""{"accessToken":"$access","refreshToken":"$refresh","expiresIn":900,"me":$meJson}""", HttpStatusCode.OK, json)

    private fun session(handler: suspend MockRequestHandleScope.(io.ktor.client.request.HttpRequestData) -> io.ktor.client.request.HttpResponseData) =
        Session("https://api.example", MockEngine(handler), MemoryStore(Saved("r0", me)), clock = { now })

    private fun io.ktor.client.request.HttpRequestData.bearer() = headers[HttpHeaders.Authorization]

    private fun device(appUpdate: DeviceAppUpdate?) = Device(
        id = "device-1",
        kidId = "kid-1",
        platform = Platform.ANDROID,
        form = DeviceForm.PHONE,
        pool = Pool.PHONE,
        name = "Pixel 7",
        hasCellular = true,
        model = "Pixel 7",
        osVersion = "14",
        appVersion = "0.1.8",
        windowsUserName = null,
        enrolledAt = "2026-01-01T00:00:00Z",
        lastSeenAt = "2026-11-21T09:00:00Z",
        appUpdate = appUpdate,
    )

    @Test
    fun `of is null when the server offers nothing and the line says up to date`() {
        val update = ServerDeviceUpdates(session { error("no call") }).of(device(null))
        assertNull(update)
        assertEquals("Version 0.1.8 · Up to date", updateLine("0.1.8", null, Instant.parse("2026-11-21T10:00:00Z")))
    }

    @Test
    fun `of maps an available update and the line shows it is out`() {
        val update = ServerDeviceUpdates(session { error("no call") })
            .of(device(DeviceAppUpdate("0.1.9", DeviceAppUpdateState.AVAILABLE, null)))

        assertNotNull(update)
        assertEquals("0.1.9", update!!.versionName)
        assertFalse(update.requested)
        assertNull(update.requestedAt)
        assertEquals("Version 0.1.8 · 0.1.9 is out", updateLine("0.1.8", update, Instant.parse("2026-11-21T10:00:00Z")))
    }

    @Test
    fun `of maps a requested update and the line shows asked ago`() {
        val update = ServerDeviceUpdates(session { error("no call") })
            .of(device(DeviceAppUpdate("0.1.9", DeviceAppUpdateState.REQUESTED, "2026-11-21T09:55:00Z")))

        assertNotNull(update)
        assertEquals("0.1.9", update!!.versionName)
        assertTrue(update.requested)
        assertEquals(Instant.parse("2026-11-21T09:55:00Z"), update.requestedAt)
        assertEquals(
            "Updating to 0.1.9 · asked 5 min ago",
            updateLine("0.1.8", update, Instant.parse("2026-11-21T10:00:00Z")),
        )
    }

    @Test
    fun `request posts to the server with the bearer token and returns true on 202`() = runBlocking {
        val requests = mutableListOf<io.ktor.client.request.HttpRequestData>()
        val session = session { request ->
            requests += request
            when (request.url.encodedPath) {
                "/v1/auth/refresh" -> tokens("a1", "r1")
                "/v1/devices/device-1/app-update" -> respond(
                    """{"versionName":"0.1.9","requestedAt":"2026-11-21T10:00:00.000Z"}""",
                    HttpStatusCode.Accepted,
                    json,
                )
                else -> respond("", HttpStatusCode.NoContent)
            }
        }

        val result = ServerDeviceUpdates(session).request("device-1")

        assertTrue(result)
        assertEquals("/v1/devices/device-1/app-update", requests.last().url.encodedPath)
        assertEquals("Bearer a1", requests.last().bearer())
    }

    @Test
    fun `request returns false on 409 without throwing`() = runBlocking {
        val session = session { request ->
            if (request.url.encodedPath == "/v1/auth/refresh") {
                tokens("a1", "r1")
            } else {
                respond(
                    """{"error":{"code":"conflict","message":"No newer version is offered to this device.","details":{"code":"no_update"}}}""",
                    HttpStatusCode.Conflict,
                    json,
                )
            }
        }

        val result = ServerDeviceUpdates(session).request("device-1")

        assertFalse(result)
    }
}
