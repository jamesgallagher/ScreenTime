package au.screentime.parent.reports

import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.Me
import au.screentime.core.model.api.MeFamily
import au.screentime.core.model.api.MeParent
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.Role
import au.screentime.core.model.api.SiteCategory
import au.screentime.core.model.api.SiteClassOverride
import au.screentime.core.model.api.SiteClassOverrideKind
import au.screentime.parent.auth.Saved
import au.screentime.parent.auth.Session
import au.screentime.parent.auth.TokenStore
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * The real source behind the Reports tab (CARD-075 acceptance criteria 29 to 31): the requests it sends for the three
 * reports and for a site's class, and that an error goes up to the view model instead of being caught here.
 */
class ServerReportsTest {
    private val me = Me(
        parent = MeParent("p1", "dad@example.com", "Dad", null),
        family = MeFamily("f1", "Dev family", "Australia/Sydney", "000"),
        roles = listOf(Role.PARENT),
    )
    private val meJson =
        """{"parent":{"id":"p1","email":"dad@example.com","displayName":"Dad","phoneE164":null},""" +
            """"family":{"id":"f1","name":"Dev family","timezone":"Australia/Sydney","emergencyNumber":"000"},""" +
            """"roles":["parent"]}"""

    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private var now = 1_000_000L

    private val weekQuery = ReportQuery(ReportKind.APPS, "k1", "d1", ReportPeriod.WEEK, LocalDate.of(2026, 11, 20))

    private val appReportJson =
        """{"kidId":"k1","period":"week","from":"2026-11-16","to":"2026-11-22","today":"2026-11-20",""" +
            """"deviceId":null,"devices":[],"screenTime":[],"apps":[]}"""
    private val siteReportJson =
        """{"kidId":"k1","period":"week","from":"2026-11-16","to":"2026-11-22","today":"2026-11-20",""" +
            """"deviceId":null,"devices":[],"categories":[],"sites":[],"behindTheScenes":[],"browserSec":0,""" +
            """"privateSec":0,"pages":[],"titlesKeptFrom":"2026-08-23"}"""
    private val searchReportJson =
        """{"kidId":"k1","period":"week","from":"2026-11-16","to":"2026-11-22","today":"2026-11-20",""" +
            """"deviceId":null,"devices":[],"searches":[]}"""

    private class MemoryStore(var saved: Saved? = null) : TokenStore {
        override fun load() = saved
        override fun save(saved: Saved) { this.saved = saved }
        override fun clear() { saved = null }
    }

    private fun MockRequestHandleScope.tokens(access: String, refresh: String) =
        respond("""{"accessToken":"$access","refreshToken":"$refresh","expiresIn":900,"me":$meJson}""", HttpStatusCode.OK, json)

    private fun session(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) =
        Session("https://api.example", MockEngine(handler), MemoryStore(Saved("r0", me)), clock = { now })

    private fun io.ktor.client.request.HttpRequestData.bearer() = headers[HttpHeaders.Authorization]

    /** Criterion 29: a report is a GET of its path with exactly kid, period, date and (when set) device. */
    private fun assertReportRequest(request: HttpRequestData, path: String, deviceId: String?) {
        assertEquals(HttpMethod.Get, request.method, "a report is a GET")
        assertEquals(path, request.url.encodedPath, "the report's path")
        assertEquals("Bearer a1", request.bearer(), "the bearer token is sent")
        assertEquals("k1", request.url.parameters["kidId"], "kidId")
        assertEquals("week", request.url.parameters["period"], "period")
        assertEquals("2026-11-20", request.url.parameters["date"], "date")
        if (deviceId == null) {
            assertFalse(
                request.url.parameters.contains("deviceId"),
                "a null device must not appear as a deviceId parameter at all",
            )
            assertEquals(
                setOf("kidId", "period", "date"),
                request.url.parameters.names(),
                "only kidId, period and date are sent",
            )
        } else {
            assertEquals(deviceId, request.url.parameters["deviceId"], "deviceId")
            assertEquals(
                setOf("kidId", "period", "date", "deviceId"),
                request.url.parameters.names(),
                "kidId, period, date and deviceId are sent",
            )
        }
    }

    @Test
    fun `apps sends GET reports apps with the query parameters`() = runBlocking {
        val requests = mutableListOf<HttpRequestData>()
        val session = session { request ->
            requests += request
            when (request.url.encodedPath) {
                "/v1/auth/refresh" -> tokens("a1", "r1")
                "/v1/reports/apps" -> respond(appReportJson, HttpStatusCode.OK, json)
                else -> error("unexpected request ${request.url}")
            }
        }

        val report = ServerReports(session).apps(weekQuery)

        assertEquals("k1", report.kidId, "the apps report came back from the server")
        assertEquals("/v1/reports/apps", requests.last().url.encodedPath, "apps hits /v1/reports/apps")
        assertReportRequest(requests.last(), "/v1/reports/apps", "d1")
    }

    @Test
    fun `apps with no chosen device sends no deviceId parameter`() = runBlocking {
        val requests = mutableListOf<HttpRequestData>()
        val session = session { request ->
            requests += request
            when (request.url.encodedPath) {
                "/v1/auth/refresh" -> tokens("a1", "r1")
                "/v1/reports/apps" -> respond(appReportJson, HttpStatusCode.OK, json)
                else -> error("unexpected request ${request.url}")
            }
        }
        val allDevices = ReportQuery(ReportKind.APPS, "k1", null, ReportPeriod.WEEK, LocalDate.of(2026, 11, 20))

        ServerReports(session).apps(allDevices)

        assertReportRequest(requests.last(), "/v1/reports/apps", null)
    }

    @Test
    fun `sites sends GET reports sites with the query parameters`() = runBlocking {
        val requests = mutableListOf<HttpRequestData>()
        val session = session { request ->
            requests += request
            when (request.url.encodedPath) {
                "/v1/auth/refresh" -> tokens("a1", "r1")
                "/v1/reports/sites" -> respond(siteReportJson, HttpStatusCode.OK, json)
                else -> error("unexpected request ${request.url}")
            }
        }
        val query = weekQuery.copy(kind = ReportKind.WEBSITES)

        val report = ServerReports(session).sites(query)

        assertEquals("k1", report.kidId, "the websites report came back from the server")
        assertReportRequest(requests.last(), "/v1/reports/sites", "d1")
    }

    @Test
    fun `searches sends GET reports searches with the query parameters`() = runBlocking {
        val requests = mutableListOf<HttpRequestData>()
        val session = session { request ->
            requests += request
            when (request.url.encodedPath) {
                "/v1/auth/refresh" -> tokens("a1", "r1")
                "/v1/reports/searches" -> respond(searchReportJson, HttpStatusCode.OK, json)
                else -> error("unexpected request ${request.url}")
            }
        }
        val query = weekQuery.copy(kind = ReportKind.SEARCHES)

        val report = ServerReports(session).searches(query)

        assertEquals("k1", report.kidId, "the searches report came back from the server")
        assertReportRequest(requests.last(), "/v1/reports/searches", "d1")
    }

    @Test
    fun `setSiteClass sends PUT sites class with kind website and category games`() = runBlocking {
        val requests = mutableListOf<HttpRequestData>()
        val bodies = mutableListOf<String>()
        val session = session { request ->
            requests += request
            when (request.url.encodedPath) {
                "/v1/auth/refresh" -> tokens("a1", "r1")
                "/v1/sites/stake.com/class" -> {
                    bodies += request.body.toByteArray().decodeToString()
                    respond(
                        """{"site":"stake.com","kind":"website","category":"games"}""",
                        HttpStatusCode.OK,
                        json,
                    )
                }
                else -> error("unexpected request ${request.url}")
            }
        }

        ServerReports(session).setSiteClass(
            "stake.com",
            SiteClassOverride(SiteClassOverrideKind.WEBSITE, SiteCategory.GAMES),
        )

        val request = requests.last()
        assertEquals(HttpMethod.Put, request.method, "setting a site's class is a PUT")
        assertEquals("/v1/sites/stake.com/class", request.url.encodedPath, "the site goes in the path")
        assertEquals("Bearer a1", request.bearer(), "the bearer token is sent")
        val body = bodies.last()
        assertTrue(body.contains("\"kind\":\"website\""), "the body sends kind website: $body")
        assertTrue(body.contains("\"category\":\"games\""), "the body sends category games: $body")
    }

    @Test
    fun `clearSiteClass sends DELETE sites class`() = runBlocking {
        val requests = mutableListOf<HttpRequestData>()
        val session = session { request ->
            requests += request
            when (request.url.encodedPath) {
                "/v1/auth/refresh" -> tokens("a1", "r1")
                "/v1/sites/stake.com/class" -> respond("", HttpStatusCode.NoContent)
                else -> error("unexpected request ${request.url}")
            }
        }

        ServerReports(session).clearSiteClass("stake.com")

        val request = requests.last()
        assertEquals(HttpMethod.Delete, request.method, "clearing a site's class is a DELETE")
        assertEquals("/v1/sites/stake.com/class", request.url.encodedPath, "the site goes in the path")
        assertEquals("Bearer a1", request.bearer(), "the bearer token is sent")
    }

    @Test
    fun `apps throws ApiException with status 500`() {
        val session = session { request ->
            when (request.url.encodedPath) {
                "/v1/auth/refresh" -> tokens("a1", "r1")
                else -> respond("", HttpStatusCode.InternalServerError)
            }
        }

        val e = assertThrows<ApiException> {
            runBlocking { ServerReports(session).apps(weekQuery) }
        }

        assertEquals(500, e.status, "a 500 answer goes up to the view model as an ApiException with status 500")
    }
}
