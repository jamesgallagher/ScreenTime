package au.screentime.parent.reports

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.screentime.core.model.api.AppReport
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.SearchReport
import au.screentime.core.model.api.SiteClassOverride
import au.screentime.core.model.api.SiteReport
import java.time.LocalDate
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
     * tab, pulling down) or [pulled].
     */
    fun show(query: ReportQuery, force: Boolean = false, pulled: Boolean = false) {
        if (!force && !pulled && query == asked && (state.loading || state.shown?.query == query)) return
        asked = query
        job?.cancel()
        state = state.copy(loading = true, refreshing = pulled)
        job = viewModelScope.launch {
            // SEAM (CARD-075): the real source, its errors, and what a stale answer does.
            val data = when (query.kind) {
                ReportKind.APPS -> ReportData.Apps(query, Reports.source.apps(query))
                ReportKind.WEBSITES -> ReportData.Websites(query, Reports.source.sites(query))
                ReportKind.SEARCHES -> ReportData.Searches(query, Reports.source.searches(query))
            }
            state = state.copy(shown = data, loading = false, refreshing = false, error = null)
        }
    }

    /** Set what a site is for the family, then load the report again. Null when it worked, else the words to show. */
    suspend fun setSiteClass(site: String, override: SiteClassOverride): String? {
        // SEAM (CARD-075): the real call and its errors.
        Reports.source.setSiteClass(site, override)
        asked?.let { show(it, force = true) }
        return null
    }

    /** Back to the automatic sorting for a site, then load the report again. Null when it worked, else the words. */
    suspend fun clearSiteClass(site: String): String? {
        // SEAM (CARD-075): the real call and its errors.
        Reports.source.clearSiteClass(site)
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
