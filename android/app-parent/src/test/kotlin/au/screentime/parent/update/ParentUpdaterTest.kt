package au.screentime.parent.update

import au.screentime.core.model.api.AppUpdateOffer
import au.screentime.core.ui.update.UpdateState
import java.io.ByteArrayInputStream
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ParentUpdaterTest {
    private val offer = AppUpdateOffer(5, "1.4.0", "a".repeat(64), 5)
    private val old = AppUpdateOffer(3, "1.2.0", "b".repeat(64), 5)

    @Test
    fun aCheckIsDueTheFirstTime() {
        assertTrue(checkDue(null, 1000, 60_000))
    }

    @Test
    fun aCheckIsNotDueAfterFiftyNineMinutes() {
        assertFalse(checkDue(0, 59 * 60_000L, 6 * 60 * 60_000L))
    }

    @Test
    fun aCheckIsDueAtSixHours() {
        assertTrue(checkDue(0, 6 * 60 * 60_000L, 6 * 60 * 60_000L))
    }

    @Test
    fun nothingNewerIsUpToDate() {
        assertEquals(UpdateState.UpToDate, parentState(offer, 5, downloaded = false, metered = false))
        assertEquals(UpdateState.UpToDate, parentState(offer, 6, downloaded = false, metered = false))
        assertEquals(UpdateState.UpToDate, parentState(null, 1, downloaded = false, metered = false))
    }

    @Test
    fun aCheckedFileAlreadyHereIsReady() {
        assertEquals(UpdateState.Ready("1.4.0"), parentState(offer, 4, downloaded = true, metered = true))
        assertEquals(UpdateState.Ready("1.4.0"), parentState(offer, 4, downloaded = true, metered = false))
    }

    @Test
    fun offeredNotDownloadedOnMeteredIsAvailable() {
        assertEquals(UpdateState.Available("1.4.0", 5), parentState(offer, 4, downloaded = false, metered = true))
    }

    @Test
    fun offeredNotDownloadedNotMeteredIsDownloading() {
        assertEquals(UpdateState.Downloading("1.4.0"), parentState(offer, 4, downloaded = false, metered = false))
    }

    @Test
    fun updateDownloadsFirstWhenTheCheckedFileIsNotHere() {
        assertEquals(UpdateAction.DOWNLOAD, nextAction(UpdateState.Available("1.4.0", 5), downloaded = false))
        // A download that did not match left Failed with no file: Update tries the download again.
        assertEquals(UpdateAction.DOWNLOAD, nextAction(UpdateState.Failed("1.4.0"), downloaded = false))
        assertEquals(UpdateAction.DOWNLOAD, nextAction(UpdateState.Ready("1.4.0"), downloaded = false))
    }

    @Test
    fun updateInstallsWhenTheCheckedFileIsHere() {
        assertEquals(UpdateAction.INSTALL, nextAction(UpdateState.Ready("1.4.0"), downloaded = true))
        assertEquals(UpdateAction.INSTALL, nextAction(UpdateState.Failed("1.4.0"), downloaded = true))
        assertEquals(UpdateAction.INSTALL, nextAction(UpdateState.Available("1.4.0", 5), downloaded = true))
    }

    @Test
    fun updateDoesNothingWhileSomethingIsHappeningOrNothingIsNewer() {
        for (s in listOf(UpdateState.Unknown, UpdateState.Checking, UpdateState.UpToDate, UpdateState.Downloading("1.4.0"), UpdateState.Installing("1.4.0"))) {
            assertEquals(UpdateAction.NONE, nextAction(s, downloaded = true), "$s")
        }
    }

    @Test
    fun aFailedCheckKeepsWhatWasShown() {
        assertEquals(UpdateState.Ready("1.4.0"), stateAfterFailedCheck(UpdateState.Ready("1.4.0")))
        assertEquals(UpdateState.UpToDate, stateAfterFailedCheck(UpdateState.UpToDate))
        assertEquals(UpdateState.Unknown, stateAfterFailedCheck(UpdateState.Unknown))
        // Only the Checking that the parent's tap showed goes away; it never turns into "Up to date".
        assertEquals(UpdateState.Unknown, stateAfterFailedCheck(UpdateState.Checking))
    }

    @Test
    fun aDeclinedQuestionIsFailed() {
        // Cancel on "Update this app?", or Don't install in Play Protect.
        assertEquals(UpdateState.Failed("1.4.0"), stateAfterInstall(android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED, "1.4.0"))
        assertEquals(UpdateState.Failed("1.4.0"), stateAfterInstall(android.content.pm.PackageInstaller.STATUS_FAILURE_INVALID, "1.4.0"))
        assertEquals(UpdateState.Failed("1.4.0"), stateAfterInstall(android.content.pm.PackageInstaller.STATUS_FAILURE_INCOMPATIBLE, "1.4.0"))
    }

    @Test
    fun filesOfVersionsNotNewerThanTheRunningOneAreDeleted() {
        val names = listOf("parent-900.apk", "parent-901.apk", "parent-902.apk", "part")
        assertEquals(listOf("parent-900.apk", "parent-901.apk", "part"), staleUpdateFiles(names, 901))
        assertEquals(emptyList<String>(), staleUpdateFiles(listOf("parent-902.apk"), 901))
    }

    @Test
    fun pendingUserActionStaysInstalling() {
        assertEquals(UpdateState.Installing("1.4.0"), stateAfterInstall(android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION, "1.4.0"))
    }

    @Test
    fun everyOtherFailureStatusIsFailed() {
        assertEquals(UpdateState.Failed("1.4.0"), stateAfterInstall(android.content.pm.PackageInstaller.STATUS_FAILURE, "1.4.0"))
        assertEquals(UpdateState.Failed("1.4.0"), stateAfterInstall(android.content.pm.PackageInstaller.STATUS_FAILURE_CONFLICT, "1.4.0"))
        assertEquals(UpdateState.Failed("1.4.0"), stateAfterInstall(android.content.pm.PackageInstaller.STATUS_FAILURE_BLOCKED, "1.4.0"))
    }

    @Test
    fun aFileWithTheRightSizeButTheWrongHashIsRefused() {
        val bytes = "hello".encodeToByteArray()
        val wrongHash = "f".repeat(64)
        assertFalse(matchesOffer(ByteArrayInputStream(bytes), 5, wrongHash))
    }

    @Test
    fun aFileWithTheRightSizeAndHashIsAccepted() {
        val bytes = "hello".encodeToByteArray()
        val hash = sha256(bytes)
        assertTrue(matchesOffer(ByteArrayInputStream(bytes), 5, hash))
    }

    @Test
    fun aFileWithTheWrongSizeIsRefused() {
        val bytes = "hello".encodeToByteArray()
        val hash = sha256(bytes)
        assertFalse(matchesOffer(ByteArrayInputStream(bytes), 6, hash))
    }

    private fun sha256(bytes: ByteArray): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        return digest.digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
