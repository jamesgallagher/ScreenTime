package au.screentime.kid.update

import au.screentime.core.model.api.AppUpdateOffer
import au.screentime.core.ui.update.UpdateState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** Remote "Update now" reuses the CARD-071 manual path but writes the remote note, not update_asked_at (docs/SPEC.md §12.11). */
class RemoteInstallTest {
    private val offer901 = AppUpdateOffer(versionCode = 901, versionName = "0.9.1", sha256 = "x", sizeBytes = 34_000_000)

    private fun source(
        currentCode: Int = 900,
        downloaded: (AppUpdateOffer) -> Boolean = { true },
        download: suspend (AppUpdateOffer) -> Boolean = { true },
        install: suspend (AppUpdateOffer) -> Unit = {},
        noteAsked: () -> Unit = {},
        sosActive: () -> Boolean = { false },
    ) = KidUpdateSource(
        currentCode = { currentCode },
        check = { offer901 },
        downloaded = downloaded,
        download = download,
        install = install,
        noteAsked = noteAsked,
        sosActive = sosActive,
        scope = CoroutineScope(Dispatchers.Unconfined),
    )

    @Test
    fun aRemoteInstallWritesTheRemoteNoteAndNotTheAskedNote() {
        var installs = 0
        var asked = 0
        var acted: Long? = null
        val source = source(
            downloaded = { true },
            install = { installs++ },
            noteAsked = { asked++ },
        )
        source.updateForRequest(offer901) { acted = 1_000L }
        assertEquals(UpdateState.Installing("0.9.1"), source.state.value)
        assertEquals(1, installs)
        assertEquals(0, asked)
        assertNotNull(acted)
    }

    @Test
    fun aRemoteInstallDownloadsFirstWithoutTheAskedNote() {
        var downloads = 0
        var installs = 0
        var asked = 0
        var acted: Long? = null
        val source = source(
            downloaded = { false },
            download = { downloads++; true },
            install = { installs++ },
            noteAsked = { asked++ },
        )
        source.updateForRequest(offer901) { acted = 1_000L }
        assertEquals(1, downloads)
        assertEquals(1, installs)
        assertEquals(0, asked)
        assertNotNull(acted)
    }

    @Test
    fun aRemoteInstallDuringAnSosDoesNotActOrNote() {
        var installs = 0
        var asked = 0
        var acted: Long? = null
        val source = source(
            downloaded = { true },
            install = { installs++ },
            noteAsked = { asked++ },
            sosActive = { true },
        )
        source.updateForRequest(offer901) { acted = 1_000L }
        assertEquals(0, installs)
        assertEquals(0, asked)
        assertNull(acted)
    }

    @Test
    fun aRemoteInstallWhoseSosStartsDuringTheDownloadWaitsReady() {
        var sos = false
        var installs = 0
        var asked = 0
        var acted: Long? = null
        val source = source(
            downloaded = { false },
            download = { sos = true; true },
            install = { installs++ },
            noteAsked = { asked++ },
            sosActive = { sos },
        )
        source.updateForRequest(offer901) { acted = 1_000L }
        assertEquals(0, installs)
        assertEquals(0, asked)
        assertNull(acted)
        assertEquals(UpdateState.Ready("0.9.1"), source.state.value)
    }

    @Test
    fun aSecondRequestWhileTheFirstIsDownloadingDoesNotStartAnotherDownload() {
        // The service asks again on every sync until the note is written, which only happens just before the install.
        var downloads = 0
        var installs = 0
        val gate = kotlinx.coroutines.CompletableDeferred<Boolean>()
        val source = source(
            downloaded = { false },
            download = { downloads++; gate.await() },
            install = { installs++ },
        )
        source.updateForRequest(offer901) {}
        source.updateForRequest(offer901) {}
        assertEquals(1, downloads)
        gate.complete(true)
        assertEquals(1, installs)
        // Finished: a later request (a new requestedAt) can run again.
        source.updateForRequest(offer901) {}
        assertEquals(2, downloads)
    }
}
