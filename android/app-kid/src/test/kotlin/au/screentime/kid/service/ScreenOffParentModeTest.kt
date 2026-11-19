package au.screentime.kid.service

import au.screentime.core.model.api.DeviceState
import au.screentime.kid.usage.state
import au.screentime.kid.usage.stateJson
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Screen off ends parent mode on a shared device only (docs/SPEC.md §12.8), as `KidService` decides it. */
class ScreenOffParentModeTest {

    @Test
    fun screenOffEndsParentModeOnSharedDevice() {
        val json = stateJson().replace(
            "\"kid\": {\"id\": \"k1\", \"name\": \"Alex\"}",
            "\"kid\": {\"id\": \"k1\", \"name\": \"Mum's tablet\", \"kind\": \"shared\"}",
        )
        val shared = au.screentime.core.model.api.ApiJson.decodeFromString<DeviceState>(json)
        assertTrue(endsParentModeAtScreenOff(shared, parentModeOn = true))
    }

    @Test
    fun screenOffDoesNotEndParentModeOnKidDevice() {
        val kid = state()
        assertFalse(endsParentModeAtScreenOff(kid, parentModeOn = true))
    }

    @Test
    fun screenOffDoesNotEndParentModeWhenNotOn() {
        val json = stateJson().replace(
            "\"kid\": {\"id\": \"k1\", \"name\": \"Alex\"}",
            "\"kid\": {\"id\": \"k1\", \"name\": \"Mum's tablet\", \"kind\": \"shared\"}",
        )
        val shared = au.screentime.core.model.api.ApiJson.decodeFromString<DeviceState>(json)
        assertFalse(endsParentModeAtScreenOff(shared, parentModeOn = false))
    }

    @Test
    fun snapshotWithoutKindIsNotShared() {
        val kid = state()
        // No kind in the snapshot: treated as a kid
        assertFalse(endsParentModeAtScreenOff(kid, parentModeOn = true))
    }
}
