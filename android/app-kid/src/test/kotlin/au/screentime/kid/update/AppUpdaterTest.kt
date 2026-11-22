package au.screentime.kid.update

import au.screentime.core.model.api.AppUpdateOffer
import java.io.ByteArrayInputStream
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** When the kid app updates itself (docs/SPEC.md §12.1). */
class AppUpdaterTest {
    private val offer = AppUpdateOffer(versionCode = 5, versionName = "1.4.0", sha256 = "x", sizeBytes = 5)

    private fun step(
        offer: AppUpdateOffer? = this.offer,
        currentCode: Int = 4,
        downloaded: Boolean = false,
        metered: Boolean = false,
        screenOn: Boolean = false,
        sosActive: Boolean = false,
        asked: Boolean = false,
    ) = nextUpdateStep(offer, currentCode, downloaded, metered, screenOn, sosActive, asked)

    @Test
    fun updateNowInstallsWithTheScreenOn() {
        assertEquals(UpdateStep.INSTALL, step(downloaded = true, screenOn = true, asked = true))
    }

    @Test
    fun updateNowStillWaitsForAnSosAndForTheFile() {
        assertEquals(UpdateStep.NOTHING, step(downloaded = true, screenOn = true, sosActive = true, asked = true))
        assertEquals(UpdateStep.DOWNLOAD, step(screenOn = true, asked = true))
    }

    @Test
    fun noOfferMeansNothing() {
        assertEquals(UpdateStep.NOTHING, step(offer = null))
    }

    @Test
    fun theSameOrAnOlderVersionMeansNothing() {
        assertEquals(UpdateStep.NOTHING, step(currentCode = 5, downloaded = true))
        assertEquals(UpdateStep.NOTHING, step(currentCode = 6, downloaded = true))
    }

    @Test
    fun aNewVersionDownloadsOnANetworkThatIsNotMetered() {
        assertEquals(UpdateStep.DOWNLOAD, step())
    }

    @Test
    fun aDownloadWaitsForANetworkThatIsNotMetered() {
        assertEquals(UpdateStep.NOTHING, step(metered = true))
    }

    @Test
    fun aDownloadDoesNotWaitForTheScreen() {
        assertEquals(UpdateStep.DOWNLOAD, step(screenOn = true))
    }

    @Test
    fun aDownloadedVersionInstallsWithTheScreenOff() {
        assertEquals(UpdateStep.INSTALL, step(downloaded = true))
    }

    @Test
    fun aDownloadedVersionInstallsEvenOnAMeteredNetwork() {
        assertEquals(UpdateStep.INSTALL, step(downloaded = true, metered = true))
    }

    @Test
    fun anInstallWaitsForTheScreenToGoOff() {
        assertEquals(UpdateStep.NOTHING, step(downloaded = true, screenOn = true))
    }

    @Test
    fun anInstallWaitsForAnSosToEnd() {
        assertEquals(UpdateStep.NOTHING, step(downloaded = true, sosActive = true))
    }

    @Test
    fun theFirstCheckIsDueAtOnceThenEveryInterval() {
        assertTrue(checkDue(null, 1_000, 60_000))
        assertFalse(checkDue(1_000, 60_999, 60_000))
        assertTrue(checkDue(1_000, 61_000, 60_000))
    }

    @Test
    fun theAutomaticTimerOnlyMovesOnAutomaticChecks() {
        // Automatic check at 08:00, manual check at 10:00, next automatic check due at 14:00.
        val sixHours = 6 * 60 * 60_000L
        val at08 = 8 * 60 * 60_000L
        val at10 = 10 * 60 * 60_000L
        val at14 = 14 * 60 * 60_000L
        val timer = AutomaticCheckTimer(sixHours)

        timer.afterCheck(at08, manual = false, answered = true)
        assertEquals(at08, timer.lastCheckElapsed)

        timer.afterCheck(at10, manual = true, answered = true)
        assertEquals(at08, timer.lastCheckElapsed)

        timer.afterCheck(at10, manual = false, answered = false)
        assertEquals(at08, timer.lastCheckElapsed)

        assertFalse(timer.due(at10))
        assertTrue(timer.due(at14))

        timer.afterCheck(at14, manual = false, answered = true)
        assertEquals(at14, timer.lastCheckElapsed)
    }

    // SHA-256 of "hello".
    private val hello = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

    @Test
    fun aFileMatchesItsSizeAndHash() {
        assertTrue(matchesOffer(ByteArrayInputStream("hello".toByteArray()), 5, hello))
    }

    @Test
    fun aWrongSizeOrHashDoesNotMatch() {
        assertFalse(matchesOffer(ByteArrayInputStream("hello".toByteArray()), 6, hello))
        assertFalse(matchesOffer(ByteArrayInputStream("jello".toByteArray()), 5, hello))
    }
}
