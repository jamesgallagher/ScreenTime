package au.screentime.parent.reports

import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.AppReport
import au.screentime.core.model.api.ReportPeriod
import au.screentime.parent.auth.SignedOutException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.LocalDate

/*
 * CARD-075 acceptance criteria 32 to 36 (docs/cards/CARD-075-parent-reports.md section 6, "The source and the view
 * model"). Only the pure functions of ReportsViewModel.kt are tested — reportsAfter, resultOf and saveError — because
 * a unit test here has no Android main dispatcher for the view model's viewModelScope. Dates are fixed; nothing reads
 * the clock. Expected values are the card's, character for character.
 */
class ReportsViewModelTest {
    private val serverWords = "Something went wrong on the server. Pull down to try again."
    private val goneWords = "That kid or device isn't in the family any more. Pull down to load it again."
    private val noConnectionWords = "Can't reach Screen Time. Check the internet connection."
    private val saveWords = "Couldn't save that. Try again."

    private fun query(date: LocalDate = LocalDate.of(2026, 11, 20)) = ReportQuery(
        kind = ReportKind.APPS,
        kidId = "k1",
        deviceId = null,
        period = ReportPeriod.DAY,
        date = date,
    )

    private fun report(day: String) = AppReport(
        kidId = "k1",
        period = ReportPeriod.DAY,
        from = day,
        to = day,
        today = day,
        deviceId = null,
        devices = emptyList(),
        screenTime = emptyList(),
        apps = emptyList(),
    )

    private fun data(query: ReportQuery) = ReportData.Apps(query, report(query.date.toString()))

    private fun state(
        shown: ReportData? = data(query(LocalDate.of(2026, 11, 18))),
        loading: Boolean = true,
        refreshing: Boolean = true,
        error: String? = null,
    ) = ReportsState(
        choice = ReportChoice(),
        shown = shown,
        loading = loading,
        refreshing = refreshing,
        error = error,
    )

    @Test
    fun `32 reportsAfter puts the Ok for the asked query in shown and clears loading refreshing and error`() {
        val asked = query(LocalDate.of(2026, 11, 20))
        val before = state(loading = true, refreshing = true, error = "old")
        val fresh = data(asked)

        val after = reportsAfter(before, asked, asked, ReportResult.Ok(fresh))

        assertEquals(fresh, after.shown, "shown is the report that came back")
        assertFalse(after.loading, "loading is false once the answer is in")
        assertFalse(after.refreshing, "refreshing is false once the answer is in")
        assertNull(after.error, "error is cleared by a good answer")
    }

    @Test
    fun `33 reportsAfter drops an answer for a query that was not asked`() {
        val asked = query(LocalDate.of(2026, 11, 20))
        val older = query(LocalDate.of(2026, 11, 19))
        val before = state(loading = true, refreshing = true, error = "old")
        val late = data(older)

        val afterOk = reportsAfter(before, asked, older, ReportResult.Ok(late))
        assertSame(before, afterOk, "an Ok for an older query returns the very same state object")
        assertEquals(before, afterOk, "an Ok for an older query leaves every field as it was")
        assertEquals(before.shown, afterOk.shown, "shown stays the older report")
        assertEquals("old", afterOk.error, "error stays as it was")
        assertTrue(afterOk.loading, "loading stays as it was")
        assertTrue(afterOk.refreshing, "refreshing stays as it was")

        val afterFailed = reportsAfter(before, asked, older, ReportResult.Failed("x"))
        assertSame(before, afterFailed, "a Failed for an older query returns the very same state object")
        assertEquals(before, afterFailed, "a Failed for an older query leaves every field as it was")
        assertEquals(before.shown, afterFailed.shown, "shown stays the older report")
        assertEquals("old", afterFailed.error, "error is not replaced by the late failure")
        assertTrue(afterFailed.loading, "loading stays as it was")
        assertTrue(afterFailed.refreshing, "refreshing stays as it was")
    }

    @Test
    fun `34 reportsAfter keeps the shown report on Failed and SignedOut`() {
        val asked = query(LocalDate.of(2026, 11, 20))
        val shownReport = data(query(LocalDate.of(2026, 11, 18)))
        val before = state(shown = shownReport, loading = true, refreshing = true, error = null)

        val afterFailed = reportsAfter(before, asked, asked, ReportResult.Failed("x"))
        assertEquals(shownReport, afterFailed.shown, "a failure keeps the report on screen")
        assertEquals("x", afterFailed.error, "a failure puts its words in error")
        assertFalse(afterFailed.loading, "a failure ends the loading")
        assertFalse(afterFailed.refreshing, "a failure ends the refresh")

        val afterSignedOut = reportsAfter(before, asked, asked, ReportResult.SignedOut)
        assertEquals(shownReport, afterSignedOut.shown, "a sign-out keeps the report on screen")
        assertNull(afterSignedOut.error, "a sign-out shows no error")
        assertFalse(afterSignedOut.loading, "a sign-out ends the loading")
        assertFalse(afterSignedOut.refreshing, "a sign-out ends the refresh")
    }

    @Test
    fun `35 resultOf maps a server error a missing kid or device no connection and a sign-out`() {
        assertEquals(
            ReportResult.Failed(serverWords),
            resultOf(ApiException(500, null)),
            "a 500 is the server words",
        )
        assertEquals(
            ReportResult.Failed(goneWords),
            resultOf(ApiException(404, null)),
            "a 404 is the kid-or-device words",
        )
        assertEquals(
            ReportResult.Failed(goneWords),
            resultOf(ApiException(422, null)),
            "a 422 is the kid-or-device words",
        )
        assertEquals(
            ReportResult.Failed(noConnectionWords),
            resultOf(java.io.IOException()),
            "a network failure is the can't-reach words",
        )
        assertEquals(
            ReportResult.SignedOut,
            resultOf(SignedOutException()),
            "a signed-out session is the SignedOut result",
        )
    }

    @Test
    fun `36 saveError maps a server error no connection and a sign-out`() {
        assertEquals(saveWords, saveError(ApiException(500, null)), "a failed save is the couldn't-save words")
        assertEquals(
            noConnectionWords,
            saveError(java.io.IOException()),
            "a failed save with no connection is the can't-reach words",
        )
        assertNull(saveError(SignedOutException()), "a sign-out during a save has nothing to say")
    }
}
