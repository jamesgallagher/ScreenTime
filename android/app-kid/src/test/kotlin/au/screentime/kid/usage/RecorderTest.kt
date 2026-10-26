package au.screentime.kid.usage

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RecorderTest {
    private val store = FakeSegmentStore()
    private var next = 0
    private val recorder = Recorder(store) { "s${++next}" }

    @Test
    fun unlockThenScreenOffMakesOneClosedSegmentToUpload() = runBlocking {
        recorder.start(1_000)
        recorder.stop(61_000)

        assertEquals(listOf(LocalSegment("s1", 1_000, 61_000, 61_000, false)), store.all())
        assertEquals(listOf("s1"), store.pending(10).map { it.segment.id })
        assertNull(store.open())
    }

    @Test
    fun aTickMovesLastSeenButSendsNothing() = runBlocking {
        recorder.start(1_000)
        val sent = store.pending(10).single()
        store.markSent(sent.segment.id, sent.version)

        recorder.tick(61_000)

        assertEquals(61_000, store.open()?.lastSeenAtMs)
        assertTrue(store.pending(10).isEmpty())
    }

    @Test
    fun aSegmentLeftOpenEndsWhereItWasLastSeen() = runBlocking {
        recorder.start(1_000)
        recorder.tick(61_000)

        // The app died without a screen-off; the next unlock is much later.
        recorder.start(500_000)

        assertEquals(LocalSegment("s1", 1_000, 61_000, 61_000, false), store.all()[0])
        assertEquals(LocalSegment("s2", 500_000, null, 500_000, false), store.all()[1])
    }

    @Test
    fun closeOpenAfterARestartUsesLastSeen() = runBlocking {
        recorder.start(1_000)
        recorder.tick(121_000)

        recorder.closeOpen()

        assertEquals(121_000, store.all().single().endedAtMs)
    }

    @Test
    fun offlineStaysOnOnceSet() = runBlocking {
        recorder.start(1_000)
        recorder.markOffline()
        recorder.markOffline()
        recorder.stop(61_000)

        assertEquals(LocalSegment("s1", 1_000, 61_000, 61_000, true), store.all().single())
    }

    @Test
    fun aFailedSyncAtScreenOffMarksTheSegmentThatJustEnded() = runBlocking {
        recorder.start(1_000)
        recorder.stop(61_000)
        val sent = store.pending(10).single()
        store.markSent(sent.segment.id, sent.version)
        recorder.start(100_000)
        recorder.stop(160_000)

        recorder.markOffline()

        assertEquals(listOf(false, true), store.all().map { it.recordedOffline })
    }

    @Test
    fun anUnlockDuringASlowFailedSyncStillMarksTheSegmentThatEnded() = runBlocking {
        // Screen off: the segment ends and its sync starts, but the server does not answer for a while.
        recorder.start(1_000)
        recorder.stop(61_000)
        // The kid unlocks again before the sync has failed.
        recorder.start(70_000)

        recorder.markOffline()

        assertEquals(listOf(true, true), store.all().map { it.recordedOffline })
    }

    @Test
    fun aFailedSyncLeavesSegmentsTheServerHasAlone() = runBlocking {
        recorder.start(1_000)
        recorder.stop(61_000)
        val sent = store.pending(10).single()
        store.markSent(sent.segment.id, sent.version)

        recorder.markOffline()

        assertEquals(false, store.all().single().recordedOffline)
        assertTrue(store.pending(10).isEmpty())
    }

    @Test
    fun anEndBeforeTheStartIsTheStart() = runBlocking {
        // The trusted clock can step back when the server answers for the first time after a reboot.
        recorder.start(100_000)
        recorder.stop(40_000)

        assertEquals(100_000, store.all().single().endedAtMs)
    }

    @Test
    fun nothingOpenMeansNothingToDo() = runBlocking {
        recorder.tick(1_000)
        recorder.stop(2_000)
        recorder.closeOpen()
        recorder.markOffline()

        assertTrue(store.all().isEmpty())
    }
}
