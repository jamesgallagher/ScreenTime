package au.screentime.kid.sync

import au.screentime.core.model.api.ApiClient
import au.screentime.kid.usage.FakeSegmentStore
import au.screentime.kid.usage.LocalSegment
import au.screentime.kid.usage.stateJson
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncerTest {
    private class MemoryStateStore : StateStore {
        var cached: CachedState? = null

        override fun load() = cached

        override fun save(cached: CachedState) {
            this.cached = cached
        }
    }

    private class MemoryClockStore : ClockStore {
        override var anchor: ClockAnchor? = null
        override var lastTrustedMs: Long = 0
    }

    private val segments = FakeSegmentStore()
    private val states = MemoryStateStore()
    private val clock = TrustedClock(MemoryClockStore(), { 0L }, { 0L }, { 1 })
    private val requests = mutableListOf<HttpRequestData>()

    private fun syncer(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = Syncer(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
        segments,
        states,
        clock,
    )

    private fun MockRequestHandleScope.json(text: String, vararg headers: Pair<String, String>) = respond(
        text,
        HttpStatusCode.OK,
        headersOf(*(headers.map { it.first to listOf(it.second) } + (HttpHeaders.ContentType to listOf("application/json"))).toTypedArray()),
    )

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    private fun ms(text: String) = Instant.parse(text).toEpochMilli()

    @Test
    fun uploadsTheOutboxThenKeepsTheSnapshotAndTheServerTime() = runBlocking {
        segments.put(LocalSegment("11111111-1111-4111-8111-111111111111", ms("2026-10-25T22:00:00Z"), null, ms("2026-10-25T22:00:00Z"), false))
        val sync = syncer { request ->
            when (request.url.encodedPath) {
                "/v1/device/usage" -> json("""{"received":1}""")
                else -> json(stateJson(serverTime = "2026-10-25T23:00:00Z"), HttpHeaders.ETag to "\"v1\"")
            }
        }

        assertTrue(sync.sync())

        assertEquals(
            """{"segments":[{"id":"11111111-1111-4111-8111-111111111111","startedAt":"2026-10-25T22:00:00Z","endedAt":null,"recordedOffline":false}]}""",
            requests[0].bodyText(),
        )
        assertEquals("Bearer device-token", requests[0].headers[HttpHeaders.Authorization])
        assertNull(requests[1].headers[HttpHeaders.IfNoneMatch])
        assertTrue(segments.pending(10).isEmpty())
        assertEquals("\"v1\"", states.cached?.etag)
        assertEquals("Alex", states.cached?.state?.kid?.name)
        assertEquals(ms("2026-10-25T23:00:00Z"), clock.nowMs())
    }

    @Test
    fun aKnownSnapshotIsAskedWithIfNoneMatchAnd304UsesTheDateHeader() = runBlocking {
        val first = syncer { json(stateJson(), HttpHeaders.ETag to "\"v1\"") }
        first.sync()
        requests.clear()
        val second = syncer {
            respond("", HttpStatusCode.NotModified, headersOf(HttpHeaders.Date, "Mon, 26 Oct 2026 01:02:03 GMT"))
        }

        assertTrue(second.sync())

        assertEquals(1, requests.size)
        assertEquals("\"v1\"", requests.single().headers[HttpHeaders.IfNoneMatch])
        assertEquals("\"v1\"", states.cached?.etag)
        assertEquals(ms("2026-10-26T01:02:03Z"), clock.nowMs())
    }

    @Test
    fun aFailedUploadKeepsTheSegmentsForNextTime() = runBlocking {
        segments.put(LocalSegment("11111111-1111-4111-8111-111111111111", 1_000, 61_000, 61_000, false))
        val sync = syncer { respond("", HttpStatusCode.BadGateway) }

        assertFalse(sync.sync())

        assertEquals(1, segments.pending(10).size)
        assertNull(states.cached)
        assertFalse(clock.isAnchored)
    }

    @Test
    fun aChangeDuringTheUploadIsSentAgain() = runBlocking {
        val id = "11111111-1111-4111-8111-111111111111"
        segments.put(LocalSegment(id, 1_000, null, 1_000, false))
        val sync = syncer { request ->
            if (request.url.encodedPath == "/v1/device/usage") {
                // The screen goes off while the open segment is on its way.
                segments.put(LocalSegment(id, 1_000, 61_000, 61_000, false))
                json("""{"received":1}""")
            } else {
                json(stateJson(), HttpHeaders.ETag to "\"v1\"")
            }
        }

        sync.sync()

        assertEquals(61_000L, segments.pending(10).single().segment.endedAtMs)
    }
}
