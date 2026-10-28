package au.screentime.parent.today

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.Today
import au.screentime.parent.ParentApp
import au.screentime.parent.auth.SignedOutException
import kotlinx.coroutines.CancellationException

/** The Today screen's state: the answer, the refreshing state, and the error. */
data class TodayState(
    val today: Today? = null,
    val refreshing: Boolean = false,
    val error: String? = null,
)

/** The Today screen (docs/SPEC.md §16.4). */
class TodayViewModel(app: Application) : AndroidViewModel(app) {
    private val session = getApplication<ParentApp>().session

    var state by mutableStateOf(TodayState())
        private set

    /** Load Today, or refresh it when [pulled]. */
    suspend fun load(pulled: Boolean = false) {
        if (pulled) state = state.copy(refreshing = true)
        try {
            val today = session.call { getToday() }
            state = state.copy(today = today, refreshing = false, error = null)
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

    /** Back to a blank state, after a sign-out. */
    fun clear() {
        state = TodayState()
    }
}
