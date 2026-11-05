package au.screentime.kid.apps

import au.screentime.core.model.api.AppRuleMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Which apps should be blocked (docs/SPEC.md §12.4). */
class AppBlocksTest {
    private val rules = mapOf(
        "blocked.app" to AppRuleMode.BLOCKED,
        "held.app" to AppRuleMode.HELD,
        "allowed.app" to AppRuleMode.ALLOWED,
    )

    @Test
    fun blockedAndHeldRulesAreBlockedAndAllowedIsNot() {
        assertEquals(setOf("blocked.app", "held.app"), wantedBlocks(rules, emptySet(), emptySet(), parentMode = false))
    }

    @Test
    fun whatTheDeviceHoldsItselfIsBlockedToo() {
        assertEquals(setOf("new.app"), wantedBlocks(emptyMap(), setOf("new.app"), emptySet(), parentMode = false))
    }

    @Test
    fun whatTheDeviceNeedsIsNeverBlockedWhateverTheSnapshotSays() {
        val bad = mapOf(
            "com.google.android.gms" to AppRuleMode.BLOCKED,
            "com.google.android.gsf" to AppRuleMode.BLOCKED,
            "com.android.settings" to AppRuleMode.BLOCKED,
            "the.launcher" to AppRuleMode.BLOCKED,
        )
        assertEquals(emptySet<String>(), wantedBlocks(bad, setOf("the.launcher"), setOf("the.launcher"), parentMode = false))
    }

    @Test
    fun parentModeReleasesEverything() {
        assertEquals(emptySet<String>(), wantedBlocks(rules, setOf("new.app"), emptySet(), parentMode = true))
    }

    @Test
    fun thePlanOnlyHoldsTheDifference() {
        assertEquals(BlockPlan(setOf("a"), setOf("c")), blockPlan(setOf("a", "b"), setOf("b", "c")))
        assertEquals(BlockPlan(emptySet(), emptySet()), blockPlan(setOf("a"), setOf("a")))
    }

    @Test
    fun theFirstLookHoldsNothing() {
        assertEquals(emptySet<String>(), heldPackages(true, null, setOf("a", "b"), emptySet(), emptySet()))
    }

    @Test
    fun aNewAppIsHeldWithApprovalOnAndNoRule() {
        assertEquals(setOf("new"), heldPackages(true, setOf("old"), setOf("old", "new"), emptySet(), emptySet()))
    }

    @Test
    fun aNewAppWithARuleIsNotHeldHere() {
        assertEquals(emptySet<String>(), heldPackages(true, setOf("old"), setOf("old", "new"), setOf("new"), emptySet()))
    }

    @Test
    fun aNewAppIsNotHeldWithApprovalOff() {
        assertEquals(emptySet<String>(), heldPackages(false, setOf("old"), setOf("old", "new"), emptySet(), emptySet()))
    }

    @Test
    fun aHeldAppStaysUntilItHasARuleOrIsGone() {
        assertEquals(setOf("new"), heldPackages(true, setOf("new"), setOf("new"), emptySet(), setOf("new")))
        assertEquals(emptySet<String>(), heldPackages(true, setOf("new"), setOf("new"), setOf("new"), setOf("new")))
        assertEquals(emptySet<String>(), heldPackages(true, setOf("new"), emptySet(), emptySet(), setOf("new")))
    }

    @Test
    fun turningApprovalOffLetsGoOfAHeldAppWithNoRule() {
        assertEquals(emptySet<String>(), heldPackages(false, setOf("new"), setOf("new"), emptySet(), setOf("new")))
    }
}
