package au.screentime.kid.apps

import au.screentime.core.model.api.AppSource
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The pure part of the app list and first use (docs/SPEC.md §12.4). */
class AppsTest {
    private fun app(name: String, label: String = name, isSystem: Boolean = false, installer: String? = null, at: Long = 0) =
        InstalledApp(name, label, isSystem, installer, at)

    @Test
    fun aSystemAppIsPreinstalledEvenWhenPlayUpdatedIt() {
        assertEquals(AppSource.PREINSTALLED, appSource(isSystem = true, installer = null))
        assertEquals(AppSource.PREINSTALLED, appSource(isSystem = true, installer = "com.android.vending"))
    }

    @Test
    fun anotherAppComesFromPlayOrSomewhereElse() {
        assertEquals(AppSource.PLAY, appSource(isSystem = false, installer = "com.android.vending"))
        assertEquals(AppSource.OTHER, appSource(isSystem = false, installer = null))
        assertEquals(AppSource.OTHER, appSource(isSystem = false, installer = "com.android.shell"))
    }

    @Test
    fun aLabelIsNeverEmptyOrTooLong() {
        assertEquals("Game", appLabel("  Game ", "a.b"))
        assertEquals("a.b", appLabel("   ", "a.b"))
        assertEquals(80, appLabel("x".repeat(200), "a.b").length)
    }

    @Test
    fun firstUseIsTheEarliestResumeAndNeverMoves() {
        val out = withFirstUses(
            known = mapOf("old" to 5L),
            resumes = listOf(Resume("new", 30), Resume("new", 20), Resume("old", 1), Resume("other", 40)),
            ignored = emptySet(),
        )
        assertEquals(mapOf("old" to 5L, "new" to 20L, "other" to 40L), out)
    }

    @Test
    fun theLauncherIsNeverReported() {
        assertEquals(emptyMap<String, Long>(), withFirstUses(emptyMap(), listOf(Resume("launcher", 1)), setOf("launcher")))
    }

    @Test
    fun theBodyIsInPackageOrderSoTheSameListLooksTheSame() {
        val a = appListBody(listOf(app("b"), app("a")), emptyMap(), emptySet())
        val b = appListBody(listOf(app("a"), app("b")), emptyMap(), emptySet())
        assertEquals(a, b)
        assertEquals(listOf("a", "b"), a?.apps?.map { it.`package` })
    }

    @Test
    fun theBodyCarriesTimesAsUtc() {
        val body = appListBody(listOf(app("a", at = 1_793_000_000_000)), mapOf("a" to 1_793_000_060_000), emptySet())
        assertEquals("2026-10-26T07:33:20Z", body?.apps?.single()?.installedAt)
        assertEquals("2026-10-26T07:34:20Z", body?.apps?.single()?.firstUsedAt)
        assertNull(appListBody(listOf(app("b")), mapOf("a" to 1L), emptySet())?.apps?.single()?.firstUsedAt)
    }

    @Test
    fun whatTheDeviceNeedsCannotBeBlocked() {
        val names = listOf("a.game", "com.google.android.gms", "com.android.settings", "the.launcher")
        val body = appListBody(names.map { app(it) }, emptyMap(), setOf("the.launcher"))!!
        val blockable = body.apps.associate { it.`package` to it.blockable }
        assertTrue(blockable.getValue("a.game"))
        assertFalse(blockable.getValue("com.google.android.gms"))
        assertFalse(blockable.getValue("com.android.settings"))
        assertFalse(blockable.getValue("the.launcher"))
    }

    @Test
    fun nothingToSendWhenThereAreNoApps() {
        assertNull(appListBody(emptyList(), emptyMap(), emptySet()))
    }
}
