package au.screentime.parent.today

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.GrantCreate
import au.screentime.core.model.api.LockNow
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.Today
import au.screentime.core.model.api.TodayKid
import au.screentime.parent.ParentApp
import au.screentime.parent.auth.SignedOutException
import java.time.LocalTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

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

    /**
     * Add or take away time from a pool (docs/SPEC.md §16.4). [id] is a UUID the adjust sheet made, so a
     * retry after a lost answer sends the same grant once. Returns null when it worked, else the words to show.
     */
    suspend fun adjust(kidId: String, pool: Pool, minutes: Int, id: String): String? {
        return try {
            session.call { postKidsGrants(kidId, GrantCreate(id = id, pool = pool, minutes = minutes)) }
            load()
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: SignedOutException) {
            null
        } catch (e: ApiException) {
            "Something went wrong on the server. Try again soon."
        } catch (e: Exception) {
            "Can't reach Screen Time. Check the internet connection and try again."
        }
    }

    /**
     * Take away all the time left in a pool today (docs/SPEC.md §16.4). [id] is a UUID the adjust sheet made,
     * so a retry after a lost answer sends the same lock once. Returns null when it worked, else the words to show.
     */
    suspend fun lockNow(kidId: String, pool: Pool, id: String): String? {
        return try {
            session.call { postKidsLockNow(kidId, LockNow(id = id, pool = pool)) }
            load()
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: SignedOutException) {
            null
        } catch (e: ApiException) {
            "Something went wrong on the server. Try again soon."
        } catch (e: Exception) {
            "Can't reach Screen Time. Check the internet connection and try again."
        }
    }

    // ---- Extend bedtime tonight (docs/SPEC.md §7.5). The seam: CARD-062 replaces these three. ----

    /** The made-up extensions, by kid id, until CARD-062 reads `kid.bedtime` from Today instead. */
    private val fakeBedtimes = mutableStateMapOf<String, Pair<String, String>>()

    /** Tonight's bedtime for a kid on the Today screen. CARD-062: `kid.bedtime`. */
    fun bedtimeOf(kid: TodayKid): TonightBedtime {
        val ext = fakeBedtimes[kid.id]
        return TonightBedtime(FAKE_SCHEDULED, ext?.first ?: FAKE_SCHEDULED, ext?.second, fakeEarliest())
    }

    /**
     * Move tonight's bedtime to [bedtime] ("HH:MM"). Returns null when it worked, else the words to show.
     * CARD-062: `PUT /v1/kids/{kidId}/bedtime-tonight`, then [load].
     */
    suspend fun extendBedtime(kidId: String, bedtime: String): String? {
        delay(400)
        fakeBedtimes[kidId] = bedtime to "You"
        return null
    }

    /** Back to the scheduled bedtime. Returns null when it worked, else the words to show. CARD-062: `DELETE` the same path. */
    suspend fun endBedtimeExtension(kidId: String): String? {
        delay(400)
        fakeBedtimes.remove(kidId)
        return null
    }

    /** The fake's earliest: the next quarter hour after the phone's clock, and after the scheduled bedtime. */
    private fun fakeEarliest(): String? {
        val now = LocalTime.now()
        val nowMin = now.hour * 60 + now.minute
        val scheduled = 20 * 60 + 30
        val first = maxOf(scheduled, nowMin - nowMin % BEDTIME_STEP) + BEDTIME_STEP
        return if (first > 1440) null else "%02d:%02d".format(first / 60, first % 60)
    }

    /** Back to a blank state, after a sign-out. */
    fun clear() {
        state = TodayState()
    }

    private companion object {
        const val FAKE_SCHEDULED = "20:30"
    }
}
