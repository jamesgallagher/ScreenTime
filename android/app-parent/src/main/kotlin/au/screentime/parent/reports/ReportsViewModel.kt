package au.screentime.parent.reports

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.AppReport
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.SearchReport
import au.screentime.core.model.api.SiteClassOverride
import au.screentime.core.model.api.SiteReport
import au.screentime.parent.auth.SignedOutException
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** A report as it came back, with the query it answers. */
sealed interface ReportData {
    val query: ReportQuery

    data class Apps(override val query: ReportQuery, val report: AppReport) : ReportData

    data class Websites(override val query: ReportQuery, val report: SiteReport) : ReportData

    data class Searches(override val query: ReportQuery, val report: SearchReport) : ReportData
}

/**
 * What the parent picked. Null [kidId] means the first kid; null [date] means today. [deviceId] null is All devices.
 * The screen turns it into a [ReportQuery] once it knows the kids and today's date.
 */
data class ReportChoice(
    val kind: ReportKind = ReportKind.APPS,
    val kidId: String? = null,
    val deviceId: String? = null,
    val period: ReportPeriod = ReportPeriod.DAY,
    val date: LocalDate? = null,
)

/**
 * The Reports tab's state. [shown] is the last report that came back; it stays on screen (dimmed) while the next
 * one loads, as on the web app. [error] is set when the last load failed.
 */
data class ReportsState(
    val choice: ReportChoice = ReportChoice(),
    val shown: ReportData? = null,
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
)

/** What came back for a query: the report, words for the parent, or a sign-out. */
sealed interface ReportResult {
    data class Ok(val data: ReportData) : ReportResult

    data class Failed(val words: String) : ReportResult

    data object SignedOut : ReportResult
}

/**
 * The result for an exception from [Reports.source]: a sign-out, the error the parent should read, or the
 * "can't reach" words for anything else (no connection, for example). A 404 or 422 means the kid or device the
 * query named is no longer in the family.
 */
fun resultOf(e: Exception): ReportResult = when (e) {
    is SignedOutException -> ReportResult.SignedOut
    is ApiException -> if (e.status == 404 || e.status == 422) {
        ReportResult.Failed("That kid or device isn't in the family any more. Pull down to load it again.")
    } else {
        ReportResult.Failed("Something went wrong on the server. Pull down to try again.")
    }
    else -> ReportResult.Failed("Can't reach Screen Time. Check the internet connection.")
}

/**
 * The state after an answer arrives for [answered], when [asked] is the query the view model is waiting on. An
 * answer for an older query is dropped: [state] comes back unchanged. A failure keeps the report on screen and
 * puts its words in [ReportsState.error]; a sign-out keeps the report and shows no error.
 */
fun reportsAfter(
    state: ReportsState,
    asked: ReportQuery?,
    answered: ReportQuery,
    result: ReportResult,
): ReportsState {
    if (answered != asked) return state
    return when (result) {
        is ReportResult.Ok -> state.copy(shown = result.data, loading = false, refreshing = false, error = null)
        is ReportResult.Failed -> state.copy(loading = false, refreshing = false, error = result.words)
        ReportResult.SignedOut -> state.copy(loading = false, refreshing = false, error = null)
    }
}

/**
 * The words to show when saving a site's class failed. `null` when there is nothing to show: a sign-out (the app
 * is on its way to the sign-in screen).
 */
fun saveError(e: Exception): String? = when (e) {
    is ApiException -> "Couldn't save that. Try again."
    is SignedOutException -> null
    else -> "Can't reach Screen Time. Check the internet connection."
}

/** The Reports tab (docs/SPEC.md §16.4): loads the report the parent picked from [Reports.source]. */
class ReportsViewModel : ViewModel() {
    var state by mutableStateOf(ReportsState())
        private set

    private var job: Job? = null
    private var asked: ReportQuery? = null

    /** The parent changed a choice. */
    fun choose(choice: ReportChoice) {
        state = state.copy(choice = choice)
    }

    /**
     * Show the report for [query]: nothing happens when it is already shown or loading, unless [force] (opening the
     * tab, pulling down) or [pulled]. A failure leaves the last report on screen with its words in
     * [ReportsState.error]; an answer for a query the parent has since replaced is dropped.
     */
    fun show(query: ReportQuery, force: Boolean = false, pulled: Boolean = false) {
        if (!force && !pulled && query == asked && (state.loading || state.shown?.query == query)) return
        asked = query
        job?.cancel()
        state = state.copy(loading = true, refreshing = pulled)
        job = viewModelScope.launch {
            val result: ReportResult = try {
                val data = when (query.kind) {
                    ReportKind.APPS -> ReportData.Apps(query, Reports.source.apps(query))
                    ReportKind.WEBSITES -> ReportData.Websites(query, Reports.source.sites(query))
                    ReportKind.SEARCHES -> ReportData.Searches(query, Reports.source.searches(query))
                }
                ReportResult.Ok(data)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                resultOf(e)
            }
            state = reportsAfter(state, asked, query, result)
        }
    }

    /**
     * Set what a site is for the family, then load the report again. Null when it worked or the sign-in is gone (no
     * reload then), else the words to show; a failed save does not reload either.
     */
    suspend fun setSiteClass(site: String, override: SiteClassOverride): String? {
        try {
            Reports.source.setSiteClass(site, override)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return saveError(e)
        }
        asked?.let { show(it, force = true) }
        return null
    }

    /**
     * Back to the automatic sorting for a site, then load the report again. Null when it worked or the sign-in is
     * gone (no reload then), else the words to show; a failed save does not reload either.
     */
    suspend fun clearSiteClass(site: String): String? {
        try {
            Reports.source.clearSiteClass(site)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return saveError(e)
        }
        asked?.let { show(it, force = true) }
        return null
    }

    /** Forget everything (sign-out). */
    fun clear() {
        job?.cancel()
        asked = null
        state = ReportsState()
    }
}
