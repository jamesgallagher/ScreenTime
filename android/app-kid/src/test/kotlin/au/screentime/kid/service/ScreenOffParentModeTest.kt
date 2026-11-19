package au.screentime.kid.service

import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.KidKind
import au.screentime.kid.usage.state
import au.screentime.kid.usage.stateJson
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Tests the decision function for ending parent mode at screen off on a shared device (docs/SPEC.md §12.8).
 * The actual logic in KidService checks `paused && state.kid.kind == KidKind.SHARED`.
 */
class ScreenOffParentModeTest {

    /**
     * Whether parent mode should end at screen off: the device is in parent mode AND it is a shared device.
     */
    fun shouldEndParentModeAtScreenOff(state: DeviceState, parentModeOn: Boolean): Boolean =
        parentModeOn && state.kid.kind == KidKind.SHARED

    @Test
    fun screenOffEndsParentModeOnSharedDevice() {
        val json = stateJson().replace(
            "\"kid\": {\"id\": \"k1\", \"name\": \"Alex\"}",
            "\"kid\": {\"id\": \"k1\", \"name\": \"Mum's tablet\", \"kind\": \"shared\"}",
        )
        val shared = au.screentime.core.model.api.ApiJson.decodeFromString<DeviceState>(json)
        assertTrue(shouldEndParentModeAtScreenOff(shared, parentModeOn = true))
    }

    @Test
    fun screenOffDoesNotEndParentModeOnKidDevice() {
        val kid = state()
        assertFalse(shouldEndParentModeAtScreenOff(kid, parentModeOn = true))
    }

    @Test
    fun screenOffDoesNotEndParentModeWhenNotOn() {
        val json = stateJson().replace(
            "\"kid\": {\"id\": \"k1\", \"name\": \"Alex\"}",
            "\"kid\": {\"id\": \"k1\", \"name\": \"Mum's tablet\", \"kind\": \"shared\"}",
        )
        val shared = au.screentime.core.model.api.ApiJson.decodeFromString<DeviceState>(json)
        assertFalse(shouldEndParentModeAtScreenOff(shared, parentModeOn = false))
    }

    @Test
    fun snapshotWithoutKindIsNotShared() {
        val kid = state()
        // No kind in the snapshot: treated as a kid
        assertFalse(shouldEndParentModeAtScreenOff(kid, parentModeOn = true))
    }
}
