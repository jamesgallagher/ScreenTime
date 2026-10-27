package au.screentime.kid.live

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlin.coroutines.cancellation.CancellationException
import kotlin.random.Random
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The WebSocket to the server (docs/SPEC.md §8.3, §10). [run] connects with the device token, sends [PING] every
 * 30 seconds, and calls [onNews] when it connects (with null: a message may have been missed while it was down) and
 * with every message that is not a pong. A socket that has said nothing for 75 seconds is dead. After a failure or a
 * close it waits 1, 2, 4 … 60 seconds (±20%) and connects again, until the coroutine is cancelled. [onNews] must
 * return at once: the service only takes note and syncs in its own loop.
 */
class LiveChannel(
    engine: HttpClientEngine,
    private val url: String,
    private val token: () -> String,
    private val onNews: (frame: String?) -> Unit,
    private val log: (String) -> Unit = {},
    private val random: () -> Double = Random::nextDouble,
) : AutoCloseable {
    private val http = HttpClient(engine) { install(WebSockets) }

    /** True while a socket is open. */
    @Volatile
    var connected = false
        private set

    suspend fun run() {
        var attempt = 0
        while (true) {
            try {
                http.webSocket(url, request = { header(HttpHeaders.Authorization, "Bearer ${token()}") }) {
                    connected = true
                    attempt = 0
                    log("connected")
                    onNews(null)
                    val pinger = launch {
                        while (true) {
                            send(Frame.Text(PING))
                            delay(PING_MS)
                        }
                    }
                    try {
                        while (true) {
                            val next = withTimeoutOrNull(DEAD_MS) { incoming.receiveCatching() }
                            if (next == null) {
                                log("nothing for 75 s, reconnecting")
                                break
                            }
                            val frame = next.getOrNull()
                            if (frame == null) {
                                log("closed: ${withTimeoutOrNull(1_000) { closeReason.await() }}")
                                break
                            }
                            if (frame is Frame.Text) {
                                val text = frame.readText()
                                if (asksForSync(text)) onNews(text)
                            }
                        }
                    } finally {
                        pinger.cancel()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log("failed: $e")
            } finally {
                connected = false
            }
            val wait = backoffMs(attempt, 0.8 + 0.4 * random())
            attempt++
            delay(wait)
        }
    }

    override fun close() = http.close()

    private companion object {
        const val PING_MS = 30_000L
        const val DEAD_MS = 75_000L
    }
}
