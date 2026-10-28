package au.screentime.parent.inbox

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.TimeRequest
import au.screentime.core.model.api.TimeRequestApprove
import au.screentime.core.model.api.TimeRequestStatus
import au.screentime.parent.ParentApp
import au.screentime.parent.auth.SignedOutException
import kotlinx.coroutines.CancellationException

/** The Inbox's state. `requests` is null until the first answer. */
data class InboxState(
    val requests: List<TimeRequest>? = null,
    val events: List<EventItem> = emptyList(),
    val refreshing: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val busy: Boolean = false,
)

/** The Inbox screen (docs/SPEC.md §16.4): the kids' waiting time requests and the family history. */
class InboxViewModel(app: Application) : AndroidViewModel(app) {
    private val session = getApplication<ParentApp>().session

    var state by mutableStateOf(InboxState())
        private set

    /** The number of waiting time requests: the badge on the Inbox tab. */
    val pending: Int
        get() = state.requests?.size ?: 0

    /** Load the waiting requests and the history, or refresh them when [pulled]. */
    suspend fun load(pulled: Boolean = false) {
        if (pulled) state = state.copy(refreshing = true)
        try {
            val requests = session.call { getRequests(status = TimeRequestStatus.PENDING) }
            val events = session.call { getEvents(limit = 50) }.events
            state = state.copy(requests = requests, events = events, refreshing = false, error = null)
        } catch (e: CancellationException) {
            state = state.copy(refreshing = false)
            throw e
        } catch (e: SignedOutException) {
            state = state.copy(refreshing = false)
        } catch (e: ApiException) {
            state = state.copy(refreshing = false, error = "Something went wrong on the server. Pull down to try again.")
        } catch (e: Exception) {
            state = state.copy(refreshing = false, error = "Can't reach Screen Time. Check the internet connection.")
        }
    }

    /** Say yes to a time request; [minutes] null gives the kid what they asked for. */
    suspend fun approve(request: TimeRequest, minutes: Int? = null) {
        answer { session.call { postRequestsApprove(request.id, TimeRequestApprove(minutes = minutes)) } }
    }

    /** Say no to a time request. */
    suspend fun deny(request: TimeRequest) {
        answer { session.call { postRequestsDeny(request.id) } }
    }

    /**
     * The shared shape of an answer: one at a time, a notice when it did not work, and a reload either way
     * (a 409 means the card is stale: reloading drops it).
     */
    private suspend fun answer(call: suspend () -> Any?) {
        if (state.busy) return
        state = state.copy(busy = true, notice = null)
        try {
            call()
        } catch (e: CancellationException) {
            throw e
        } catch (e: SignedOutException) {
            // The app is going back to sign-in anyway.
        } catch (e: Exception) {
            state = state.copy(notice = answerError(e))
        }
        load()
        state = state.copy(busy = false)
    }

    /** Back to a blank state, after a sign-out. */
    fun clear() {
        state = InboxState()
    }
}
