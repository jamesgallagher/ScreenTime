package au.screentime.kid.update

import au.screentime.core.model.api.AppUpdateOffer
import au.screentime.core.ui.update.UpdateState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Manual check and update from the kid app's Updates sheet (docs/SPEC.md §12.11). */
class KidUpdateSourceTest {
    private val offer901 = AppUpdateOffer(versionCode = 901, versionName = "0.9.1", sha256 = "x", sizeBytes = 34_000_000)

    private fun source(
        currentCode: Int = 900,
        check: suspend () -> AppUpdateOffer? = { offer901 },
        downloaded: (AppUpdateOffer) -> Boolean = { false },
        download: suspend (AppUpdateOffer) -> Boolean = { true },
        install: suspend (AppUpdateOffer) -> Unit = {},
        noteAsked: () -> Unit = {},
        sosActive: () -> Boolean = { false },
    ) = KidUpdateSource(
        currentCode = { currentCode },
        check = check,
        downloaded = downloaded,
        download = download,
        install = install,
        noteAsked = noteAsked,
        sosActive = sosActive,
        scope = CoroutineScope(Dispatchers.Unconfined),
    )

    @Test
    fun checkNowOffersAvailableWhenThereIsANewerVersion() {
        val source = source(downloaded = { false })
        source.checkNow()
        assertEquals(UpdateState.Available("0.9.1", 34_000_000L), source.state.value)
    }

    @Test
    fun checkNowReachesReadyWhenTheFileIsAlreadyDownloaded() {
        val source = source(downloaded = { true })
        source.checkNow()
        assertEquals(UpdateState.Ready("0.9.1"), source.state.value)
        assertEquals(UpdateState.Ready("0.9.1"), kidCheckState(offer901, 900, downloaded = true, checkFailed = false))
    }

    @Test
    fun checkNowSaysUpToDateWhenThereIsNoOffer() {
        val source = source(check = { null })
        source.checkNow()
        assertEquals(UpdateState.UpToDate, source.state.value)
    }

    @Test
    fun checkNowSaysCheckFailedWhenTheCallThrows() {
        val source = source(check = { throw RuntimeException("no network") })
        source.checkNow()
        assertEquals(UpdateState.CheckFailed, source.state.value)
    }

    @Test
    fun updateDownloadsAndInstallsWhenTheFileIsNotHereYet() {
        var downloads = 0
        var installs = 0
        var noted = 0
        val source = source(
            downloaded = { false },
            download = { downloads++; true },
            install = { installs++ },
            noteAsked = { noted++ },
        )
        source.checkNow()
        source.update()
        assertEquals(UpdateState.Installing("0.9.1"), source.state.value)
        assertEquals(1, downloads)
        assertEquals(1, installs)
        assertEquals(1, noted)
    }

    @Test
    fun updateInstallsAnAlreadyDownloadedOfferAtOnce() {
        var downloads = 0
        var installs = 0
        val source = source(
            downloaded = { true },
            download = { downloads++; true },
            install = { installs++ },
        )
        source.checkNow()
        source.update()
        assertEquals(UpdateState.Installing("0.9.1"), source.state.value)
        assertEquals(0, downloads)
        assertEquals(1, installs)
    }

    @Test
    fun updateDoesNotInstallWhileAnSosIsOn() {
        var installs = 0
        val source = source(
            downloaded = { true },
            install = { installs++ },
            sosActive = { true },
        )
        source.checkNow()
        source.update()
        assertTrue(source.state.value !is UpdateState.Installing)
        assertEquals(0, installs)
    }

    @Test
    fun updateFailsWhenTheDownloadDoesNotMatch() {
        var downloads = 0
        val source = source(
            downloaded = { false },
            download = { downloads++; false },
        )
        source.checkNow()
        source.update()
        assertEquals(UpdateState.Failed("0.9.1"), source.state.value)
        assertEquals(1, downloads)
    }

    @Test
    fun installedMapsSuccessToUpToDateAndFailureToFailed() {
        val source = source()
        source.checkNow()
        source.installed(0)
        assertEquals(UpdateState.UpToDate, source.state.value)
        source.installed(1)
        assertEquals(UpdateState.Failed("0.9.1"), source.state.value)
    }

    @Test
    fun automaticPathStillWaitsForAMeteredNetworkWhenNotAsked() {
        assertEquals(
            UpdateStep.NOTHING,
            nextUpdateStep(offer901, 900, downloaded = false, metered = true, screenOn = true, sosActive = false, asked = false),
        )
    }
}
