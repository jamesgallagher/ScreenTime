package au.screentime.kid.sites

import au.screentime.kid.apps.Span
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The pure part of the sites (docs/SPEC.md §12.10). */
class SitesTest {
    /** The parent mode span of the card: 1,000 to 2,000, its ends counting as inside. */
    private val span = Span(1000, 2000)

    @Test
    fun normalizeHostIsLowercaseTrimmedWithoutTheTrailingDot() {
        assertEquals("www.example.com", normalizeHost("WWW.Example.COM."))
        assertEquals("khanacademy.org", normalizeHost(" khanacademy.org "))
    }

    @Test
    fun normalizeHostIsNullForEmptyAndIpLiterals() {
        assertNull(normalizeHost(""))
        assertNull(normalizeHost("192.168.0.148"))
        assertNull(normalizeHost("2404:6800:400a:1001::66"))
    }

    @Test
    fun keepLookupDropsNullHostsEmptyPackagesTheOwnAppAndParentMode() {
        assertFalse(keepLookup(null, "com.android.chrome", 2500, "au.screentime.kid", listOf(span)))
        assertFalse(keepLookup("www.example.com", null, 2500, "au.screentime.kid", listOf(span)))
        assertFalse(keepLookup("www.example.com", "", 2500, "au.screentime.kid", listOf(span)))
        assertFalse(keepLookup("www.example.com", "au.screentime.kid", 2500, "au.screentime.kid", listOf(span)))
        // Inside the span 1,000 to 2,000: 1,500, and the span's ends count as inside.
        assertFalse(keepLookup("www.example.com", "com.android.chrome", 1500, "au.screentime.kid", listOf(span)))
        assertFalse(keepLookup("www.example.com", "com.android.chrome", 1000, "au.screentime.kid", listOf(span)))
        assertFalse(keepLookup("www.example.com", "com.android.chrome", 2000, "au.screentime.kid", listOf(span)))
    }

    @Test
    fun keepLookupKeepsTheRest() {
        assertTrue(keepLookup("www.example.com", "com.android.chrome", 2500, "au.screentime.kid", listOf(span)))
        assertTrue(keepLookup("www.example.com", "com.android.chrome", 999, "au.screentime.kid", listOf(span)))
        assertTrue(keepLookup("www.example.com", "com.android.chrome", 2500, "au.screentime.kid", emptyList()))
    }
}
