package au.screentime.kid.sites

import au.screentime.kid.data.SiteLookupRow
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** One sync's upload of the stored lookups (docs/SPEC.md §12.10): 1,000 at a time, at most 10 calls, stop on failure. */
class SitesUploadTest {
    /** A kid.db stand-in: [count] rows, oldest first, and the calls the upload made. */
    private class Store(count: Int, private val fail: (call: Int) -> Boolean = { false }) {
        val rows = (1..count).map { SiteLookupRow(it.toLong(), 1_000L * it, "host$it.example.com", "com.android.chrome") }.toMutableList()
        var calls = 0

        suspend fun upload() = uploadLookups(
            oldest = { n -> rows.take(n) },
            send = { batch ->
                calls++
                if (fail(calls)) throw IllegalStateException("server said 500")
                batch.size - 1
            },
            delete = { ids -> rows.removeAll { it.id in ids } },
        )
    }

    @Test
    fun aFailureStopsTheSyncAndKeepsTheRows() = runBlocking {
        val store = Store(2500) { true }
        assertEquals(SitesSent(0, 0), store.upload())
        assertEquals(1, store.calls)
        assertEquals(2500, store.rows.size)
    }

    @Test
    fun aFailureAfterTheFirstCallKeepsOnlyWhatWasNotTaken() = runBlocking {
        val store = Store(2500) { it == 2 }
        assertEquals(SitesSent(1000, 999), store.upload())
        assertEquals(2, store.calls)
        assertEquals(1500, store.rows.size)
    }

    @Test
    fun sendsAThousandAtATimeUntilNothingIsLeft() = runBlocking {
        val store = Store(2500)
        assertEquals(SitesSent(2500, 999 + 999 + 499), store.upload())
        assertEquals(3, store.calls)
        assertEquals(0, store.rows.size)
    }

    @Test
    fun atMostTenCallsPerSync() = runBlocking {
        val store = Store(12_000)
        assertEquals(10_000, store.upload().sent)
        assertEquals(10, store.calls)
        assertEquals(2000, store.rows.size)
    }

    @Test
    fun nothingStoredMeansNoCall() = runBlocking {
        val store = Store(0)
        assertEquals(SitesSent(0, 0), store.upload())
        assertEquals(0, store.calls)
    }
}
