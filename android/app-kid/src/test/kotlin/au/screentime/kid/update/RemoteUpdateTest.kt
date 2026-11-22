package au.screentime.kid.update

import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Remote "Update now" from the parent app (docs/SPEC.md §12.11, criteria 9 and 10). */
class RemoteUpdateTest {
    private val t1 = "2026-11-21T10:00:00Z"
    private val t2 = "2026-11-21T10:30:00Z"
    private val t1Ms = Instant.parse(t1).toEpochMilli()
    private val t2Ms = Instant.parse(t2).toEpochMilli()

    @Test
    fun actsWhenTheRequestedVersionIsNewerAndHasNotBeenHandled() {
        assertEquals(
            RemoteUpdateAction.ACT,
            remoteUpdateAction(versionCode = 901, requestedAt = t1, currentCode = 900, handledAtMs = null, sosActive = false),
        )
    }

    @Test
    fun doesNothingWhenTheSameRequestedAtHasAlreadyBeenHandled() {
        assertEquals(
            RemoteUpdateAction.NOTHING,
            remoteUpdateAction(versionCode = 901, requestedAt = t1, currentCode = 900, handledAtMs = t1Ms, sosActive = false),
        )
    }

    @Test
    fun doesNothingWhenTheDeviceAlreadyHasTheRequestedVersion() {
        assertEquals(
            RemoteUpdateAction.NOTHING,
            remoteUpdateAction(versionCode = 901, requestedAt = t1, currentCode = 901, handledAtMs = null, sosActive = false),
        )
    }

    @Test
    fun doesNothingWhenThereIsNoRemoteRequest() {
        assertEquals(
            RemoteUpdateAction.NOTHING,
            remoteUpdateAction(versionCode = null, requestedAt = null, currentCode = 900, handledAtMs = null, sosActive = false),
        )
    }

    @Test
    fun actsAgainWhenTheRequestedAtIsDifferentFromTheHandledOne() {
        assertEquals(
            RemoteUpdateAction.ACT,
            remoteUpdateAction(versionCode = 901, requestedAt = t2, currentCode = 900, handledAtMs = t1Ms, sosActive = false),
        )
    }

    @Test
    fun waitsWhileAnSosIsOn() {
        assertEquals(
            RemoteUpdateAction.WAIT,
            remoteUpdateAction(versionCode = 901, requestedAt = t1, currentCode = 900, handledAtMs = null, sosActive = true),
        )
    }

    @Test
    fun theSameRequestActsAfterTheSosEnds() {
        assertEquals(
            RemoteUpdateAction.ACT,
            remoteUpdateAction(versionCode = 901, requestedAt = t1, currentCode = 900, handledAtMs = null, sosActive = false),
        )
    }
}
