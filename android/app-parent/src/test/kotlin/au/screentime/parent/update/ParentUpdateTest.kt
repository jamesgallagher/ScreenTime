package au.screentime.parent.update

import au.screentime.core.ui.update.UpdateState
import au.screentime.core.ui.update.megabytes
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ParentUpdateTest {
    private val available = UpdateState.Available("0.1.3", 33_785_552)
    private val ready = UpdateState.Ready("0.1.3")
    private val failed = UpdateState.Failed("0.1.3")

    @Test
    fun theRowShowsOnlyWhenThereIsSomethingNewerAndNoSos() {
        for (s in listOf(available, UpdateState.Downloading("0.1.3"), ready, UpdateState.Installing("0.1.3"), failed)) {
            assertTrue(showsUpdateRow(s, sosActive = false), "$s")
            assertFalse(showsUpdateRow(s, sosActive = true), "$s during an SOS")
        }
        for (s in listOf(UpdateState.Unknown, UpdateState.Checking, UpdateState.UpToDate)) {
            assertFalse(showsUpdateRow(s, sosActive = false), "$s")
        }
    }

    @Test
    fun rowWording() {
        assertEquals("ST Parent 0.1.3 is out", updateTitle(available))
        assertEquals("Update downloads 34 MB.", updateDetail(available))
        assertEquals("Getting ST Parent 0.1.3…", updateTitle(UpdateState.Downloading("0.1.3")))
        assertNull(updateDetail(UpdateState.Downloading("0.1.3")))
        assertEquals("ST Parent 0.1.3 is ready", updateTitle(ready))
        assertEquals("Takes a few seconds. The app opens again by itself.", updateDetail(ready))
        assertEquals("Updating ST Parent…", updateTitle(UpdateState.Installing("0.1.3")))
        assertEquals("ST Parent 0.1.3 didn't install", updateTitle(failed))
        assertEquals("Tap Update to try again.", updateDetail(failed))
    }

    @Test
    fun theUpdateButtonOnlyWhenNothingIsHappening() {
        assertTrue(updateButton(available))
        assertTrue(updateButton(ready))
        assertTrue(updateButton(failed))
        assertFalse(updateButton(UpdateState.Downloading("0.1.3")))
        assertFalse(updateButton(UpdateState.Installing("0.1.3")))
    }

    @Test
    fun megabytesRoundAndNeverSayZero() {
        assertEquals("34 MB", megabytes(33_785_552))
        assertEquals("1 MB", megabytes(120_000))
    }
}
