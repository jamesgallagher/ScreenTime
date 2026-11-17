package au.screentime.parent.inbox

import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.TimeRequest
import au.screentime.parent.BuildConfig
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.serialization.json.JsonPrimitive

/**
 * THE SEAM for the "Waiting for you" strip (front end by Claude; CARD-062 replaces this whole file).
 *
 * Until CARD-062 adds `GET /v1/waiting` and `POST /v1/messages/{id}/seen`, the strip is built from what the
 * Inbox already loads (the waiting time requests and the new apps from the last 50 events), plus, in debug
 * builds only, one fake parent-mode request and one fake message so every kind of row can be seen. "Got it"
 * on a fake message only hides it until the app is closed.
 */
object WaitingSeam {
    private val seen = mutableSetOf<String>()
    private val fakeAt = Instant.now()

    /** Every item that waits, from the Inbox's [requests] and [events]. */
    fun build(requests: List<TimeRequest>, events: List<EventItem>): List<Waiting> {
        val real = requests.map { Waiting.Time(it, eventId = null) } + pendingAppApprovals(events).map(::newApp)
        return if (BuildConfig.DEBUG) real + fakes().filter { it.key !in seen } else real
    }

    /** "Got it" on a message. */
    fun seen(message: Waiting.Message) {
        seen += message.key
    }

    private fun newApp(e: EventItem): Waiting.NewApp {
        fun text(key: String) = (e.payload[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return Waiting.NewApp(
            kidId = e.kidId ?: "",
            kidName = e.kidName ?: "A kid",
            packageName = approvalPackage(e) ?: "",
            label = text("label") ?: "an app",
            source = text("source"),
            deviceName = e.deviceName,
            at = e.at,
            eventId = e.id,
        )
    }

    private fun fakes(): List<Waiting> = listOf(
        Waiting.ParentMode(
            requestId = "fake-parent-mode",
            kidName = "Sam",
            deviceName = "Lenovo Tab",
            at = fakeAt.minus(2, ChronoUnit.MINUTES).toString(),
            // Long enough to look at while trying the strip.
            expiresAt = fakeAt.plus(1, ChronoUnit.HOURS).toString(),
            eventId = null,
        ),
        Waiting.Message(
            messageId = "fake-message",
            kidName = "Alex",
            deviceName = "Pixel 7",
            body = "Can you pick me up at 5?",
            at = fakeAt.minus(5, ChronoUnit.MINUTES).toString(),
            eventId = null,
        ),
    )
}
