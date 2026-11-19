package au.screentime.kid.status

import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.KidKind
import au.screentime.core.time.LockReason
import au.screentime.core.time.evaluate
import au.screentime.kid.usage.state
import au.screentime.kid.usage.stateJson
import au.screentime.kid.usage.todayInput
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SharedStatusTest {
    private fun at(time: String): Long =
        LocalDateTime.parse("2026-10-26T$time").atZone(ZoneId.of("Australia/Sydney")).toInstant().toEpochMilli()

    private fun sharedState(): DeviceState {
        val json = stateJson().replace(
            "\"kid\": {\"id\": \"k1\", \"name\": \"Alex\"}",
            "\"kid\": {\"id\": \"k1\", \"name\": \"Mum's tablet\", \"kind\": \"shared\"}",
        )
        return au.screentime.core.model.api.ApiJson.decodeFromString(json)
    }

    private fun statusAt(
        time: String,
        state: DeviceState,
        elapsedMs: Long = 0,
    ): KidStatus {
        val now = at(time)
        val result = evaluate(todayInput(state, emptyList(), now))
        return kidStatus(state, result, now, online = true, elapsedMs = elapsedMs)
    }

    @Test
    fun snapshotWithoutKindParsesAndReadsAsKid() {
        val state = state()
        assertEquals(KidKind.KID, state.kid.kind ?: KidKind.KID)
        val s = statusAt("10:00", state)
        assertEquals("Alex", s.kidName)
        assertEquals("Phone", s.poolName)
        assertFalse(s.shared)
    }

    @Test
    fun sharedSnapshotHasSharedKind() {
        val state = sharedState()
        assertEquals(KidKind.SHARED, state.kid.kind)
        val s = statusAt("10:00", state)
        assertTrue(s.shared)
    }

    @Test
    fun sharedGreetingIsNameAlone() {
        val s = statusAt("10:00", sharedState())
        assertEquals("Mum's tablet", s.kidName)
        assertTrue(s.shared)
    }

    @Test
    fun sharedPoolWordIsTime() {
        val s = statusAt("10:00", sharedState())
        assertEquals("Time", s.poolName)
    }

    @Test
    fun sharedTitleSaysTimeLeft() {
        val s = statusAt("10:00", sharedState())
        assertEquals("Time · 1h left", s.title())
    }

    @Test
    fun sharedOutOfTimeHeadline() {
        // 120 min of screens, all used by 09:00 → out of time
        val json = stateJson(
            pool = "screens",
            segments = """{"id": "s1", "deviceId": "d1", "startedAt": "2026-10-26T07:00:00+11:00", "endedAt": "2026-10-26T09:00:00+11:00"}""",
        ).replace(
            "\"kid\": {\"id\": \"k1\", \"name\": \"Alex\"}",
            "\"kid\": {\"id\": \"k1\", \"name\": \"Mum's tablet\", \"kind\": \"shared\"}",
        )
        val state: DeviceState = au.screentime.core.model.api.ApiJson.decodeFromString(json)
        val s = statusAt("09:00", state)
        assertTrue(s.lockReason == LockReason.OUT_OF_TIME)
        assertEquals("Out of time", s.headline(LockReason.OUT_OF_TIME))
        assertEquals("Out of time", s.title())
    }

    @Test
    fun sharedCanCallIsFalseOnPhoneWithSim() {
        val s = statusAt("10:00", sharedState())
        assertFalse(s.canCall)
    }

    @Test
    fun kidWordsAreUnchanged() {
        val s = statusAt("10:00", state())
        assertEquals("Alex", s.kidName)
        assertEquals("Phone", s.poolName)
        assertFalse(s.shared)
        assertEquals("Out of Phone time", s.headline(LockReason.OUT_OF_TIME))
    }
}
