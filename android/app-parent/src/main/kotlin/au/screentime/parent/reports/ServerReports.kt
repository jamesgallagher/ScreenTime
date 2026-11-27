package au.screentime.parent.reports

import au.screentime.core.model.api.AppReport
import au.screentime.core.model.api.SearchReport
import au.screentime.core.model.api.SiteClassOverride
import au.screentime.core.model.api.SiteReport
import au.screentime.parent.auth.Session

/**
 * The Reports tab's real source (docs/SPEC.md §12.9): the same three reports as the web app's Reports page, from
 * `GET /v1/reports/apps`, `/sites` and `/searches`, and `PUT` / `DELETE /v1/sites/{site}/class` for what a site is.
 * Errors are not caught here: the view model tells the parent what went wrong.
 */
class ServerReports(private val session: Session) : ReportsSource {
    override suspend fun apps(query: ReportQuery): AppReport =
        session.call { getReportsApps(query.kidId, query.period, query.date.toString(), query.deviceId) }

    override suspend fun sites(query: ReportQuery): SiteReport =
        session.call { getReportsSites(query.kidId, query.period, query.date.toString(), query.deviceId) }

    override suspend fun searches(query: ReportQuery): SearchReport =
        session.call { getReportsSearches(query.kidId, query.period, query.date.toString(), query.deviceId) }

    override suspend fun setSiteClass(site: String, override: SiteClassOverride) {
        session.call { putSitesClass(site, override) }
    }

    override suspend fun clearSiteClass(site: String) {
        session.call { deleteSitesClass(site) }
    }
}
