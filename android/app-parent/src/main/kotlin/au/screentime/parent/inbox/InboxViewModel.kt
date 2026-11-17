package au.screentime.parent.inbox

import android.app.Application
import android.app.NotificationManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.TimeRequest
import au.screentime.core.model.api.TimeRequestApprove
import au.screentime.parent.kids.AppRule
import au.screentime.parent.kids.rulePut
import au.screentime.parent.ParentApp
import au.screentime.parent.auth.SignedOutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The Inbox's state. `waiting` is null until the first answer. */
data class InboxState(
    val events: List<EventItem> = emptyList(),
    /** Everything that waits for a parent, for the strip at the top of every tab; null until the first answer. */
    val waiting: List<Waiting>? = null,
    val refreshing: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val busy: Boolean = false,
)

/** The Inbox screen (docs/SPEC.md §16.4): the family history. What waits for a parent is in the "Waiting for you" strip at the top of every tab. */
class InboxViewModel(app: Application) : AndroidViewModel(app) {
    private val session = getApplication<ParentApp>().session
    private val notificationManager = app.getSystemService(NotificationManager::class.java)

    var state by mutableStateOf(InboxState())
        private set

    /** Load the waiting list and the history, or refresh them when [pulled]. */
    suspend fun load(pulled: Boolean = false) {
        if (pulled) state = state.copy(refreshing = true)
        try {
            val waitingList = session.call { getWaiting() }
            val waiting = waitingList.items.mapNotNull { waitingFrom(it) }
            val events = session.call { getEvents(limit = 50) }.events
            state = state.copy(events = events, waiting = waiting, refreshing = false, error = null)
            clearStaleNotifications(waiting)
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

    /** "Got it" on a kid's message: it leaves the strip for every parent. */
    suspend fun seen(message: Waiting.Message) {
        answer { session.call { postMessagesSeen(message.messageId) } }
    }

    /** Answer a new app from the strip. */
    suspend fun answerApp(app: Waiting.NewApp, rule: AppRule) {
        answer { session.call { putKidsAppsRule(app.kidId, app.packageName, rulePut(rule)) } }
    }

    /**
     * Cancel every notification whose tag starts with `waiting:` and whose event id is no longer in
     * the loaded list.
     */
    private fun clearStaleNotifications(waiting: List<Waiting>) {
        try {
            val active = notificationManager.activeNotifications.map { it.tag }
            for (tag in staleTags(active, waiting)) {
                val id = tag.removePrefix("waiting:").hashCode()
                notificationManager.cancel(tag, id)
            }
        } catch (e: Exception) {
            // A notification that cannot be cancelled is not worth a crash.
        }
    }

    /**
     * The shared shape of an answer: one at a time, a notice when it did not work, and a reload either way
     * (a 409 means the card is stale: reloading drops it).
     */
    private suspend fun answer(call: suspend () -> Any?) {
        if (state.busy) return
        state = state.copy(busy = true, notice = null)
        // In the view model's scope, so closing the dialog or a card leaving the list cannot cancel the answer
        // halfway and leave the buttons disabled.
        viewModelScope.launch {
            try {
                call()
            } catch (e: CancellationException) {
                throw e
            } catch (e: SignedOutException) {
                // The app is going back to sign-in anyway.
            } catch (e: Exception) {
                state = state.copy(notice = answerError(e))
            }
            try {
                load()
            } finally {
                state = state.copy(busy = false)
            }
        }.join()
    }

    /** Back to a blank state, after a sign-out. */
    fun clear() {
        state = InboxState()
    }
}
