package au.screentime.kid.ask

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.KidMessageCreate
import au.screentime.core.model.api.Opt
import au.screentime.core.model.api.TimeRequestCreate
import au.screentime.kid.live.Answer
import au.screentime.kid.status.minutesText
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/** The longest reason or message a kid can write (docs/SPEC.md §9.3). */
const val MAX_TEXT = 160

/** What the kid can ask for (docs/SPEC.md §16.2, "Ask for more time sheet"). */
val ASK_MINUTES = listOf(15, 30, 60)

/** How a send went. The kid sees words, never a code (docs/SPEC.md §16.1). */
enum class SendResult { SENT, ALREADY_ASKED, OFFLINE, FAILED }

/**
 * Sends the kid's "Ask for more time" and messages to the server (docs/SPEC.md §9.3). The caller makes [id] once
 * for what the kid is sending and uses it again for a retry, so something that reached the server just before the
 * connection broke is not stored twice.
 */
class Sender(private val api: ApiClient) {
    suspend fun ask(id: String, minutes: Int, reason: String): SendResult = send {
        val text = reason.trim().take(MAX_TEXT)
        api.postDeviceTimeRequests(TimeRequestCreate(id, minutes, if (text.isEmpty()) Opt.Absent else Opt.Value(text)))
    }

    suspend fun message(id: String, body: String, presetId: String?): SendResult = send {
        api.postDeviceMessages(
            KidMessageCreate(id, body.trim().take(MAX_TEXT), if (presetId == null) Opt.Absent else Opt.Value(presetId)),
        )
    }

    private suspend fun send(call: suspend () -> Unit): SendResult = try {
        call()
        SendResult.SENT
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiException) {
        // 409: this pool already has a request waiting for an answer.
        if (e.status == 409) SendResult.ALREADY_ASKED else SendResult.FAILED
    } catch (e: IOException) {
        SendResult.OFFLINE
    } catch (e: Exception) {
        SendResult.FAILED
    }
}

/** The line under the Send button after a send that did not work; null when there is nothing to say. */
fun sendErrorText(result: SendResult, parents: String): String? = when (result) {
    SendResult.SENT, SendResult.ALREADY_ASKED -> null
    SendResult.OFFLINE -> "Can't reach $parents right now. Check the internet and try again."
    SendResult.FAILED -> "That didn't work. Try again in a minute."
}

/** "Dad said yes! +15 min 🎉" or "Dad said not this time" (docs/SPEC.md §16.2). */
fun answerText(answer: Answer): String = if (answer.approved) {
    "${answer.byName} said yes! +${minutesText(answer.minutes)} 🎉"
} else {
    "${answer.byName} said not this time"
}
