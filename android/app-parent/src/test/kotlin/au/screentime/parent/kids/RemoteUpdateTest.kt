package au.screentime.parent.kids

import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The device row's update words and button (docs/SPEC.md §12.11, "Remote Update now"). */
class RemoteUpdateTest {
    private val now = Instant.parse("2026-11-21T10:00:00Z")
    private val available = DeviceUpdate("0.1.9", requested = false)

    private fun requestedAgo(minutes: Long) = DeviceUpdate("0.1.9", requested = true, requestedAt = now.minusSeconds(minutes * 60))

    @Test
    fun upToDateShowsTheVersion() {
        assertEquals("Version 0.1.8 · Up to date", updateLine("0.1.8", null, now))
    }

    @Test
    fun aDeviceThatHasNotReportedItsVersionSaysSo() {
        assertEquals("Version not known yet", updateLine(null, null, now))
    }

    @Test
    fun aNewerVersionIsOutShowsBothVersions() {
        assertEquals("Version 0.1.8 · 0.1.9 is out", updateLine("0.1.8", available, now))
        assertEquals("0.1.9 is out", updateLine(null, available, now))
    }

    @Test
    fun askedForShowsHowLongAgo() {
        assertEquals("Updating to 0.1.9 · asked just now", updateLine("0.1.8", requestedAgo(0), now))
        assertEquals("Updating to 0.1.9 · asked 5 min ago", updateLine("0.1.8", requestedAgo(5), now))
        assertEquals("Updating to 0.1.9 · asked 3h ago", updateLine("0.1.8", requestedAgo(3 * 60), now))
        assertEquals("Updating to 0.1.9 · asked 1 day ago", updateLine("0.1.8", requestedAgo(24 * 60), now))
        assertEquals("Updating to 0.1.9 · asked 2 days ago", updateLine("0.1.8", requestedAgo(48 * 60), now))
    }

    @Test
    fun updateNowShowsWhenOfferedAndAgainAfterThirtyMinutes() {
        assertFalse(showsUpdateNow(null, now))
        assertTrue(showsUpdateNow(available, now))
        assertFalse(showsUpdateNow(requestedAgo(5), now))
        assertFalse(showsUpdateNow(requestedAgo(29), now))
        assertTrue(showsUpdateNow(requestedAgo(30), now))
        assertTrue(showsUpdateNow(requestedAgo(120), now))
    }
}
