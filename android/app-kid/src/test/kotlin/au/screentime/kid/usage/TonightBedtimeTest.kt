package au.screentime.kid.usage

import au.screentime.core.model.api.DeviceState
import au.screentime.core.time.evaluate
import au.screentime.kid.status.kidStatus
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * CARD-063: the kid device honours an extended bedtime from the snapshot's schedule entry.
 * The snapshot's today's weekday entry carries tonight's bedtime (21:30) while the usual is 20:30.
 */
class TonightBedtimeTest {
    /** Monday 26 October 2026, 20:45 in Sydney (UTC+11) = 2026-10-26 09:45 UTC. */
    private val now = ms("2026-10-26T09:45:00Z")

    private fun ms(text: String) = java.time.Instant.parse(text).toEpochMilli()

    /**
     * A DeviceState whose today's entry has `bedtime` 21:30 while the usual is 20:30.
     * The schedule's days all have bedtime 20:30, but today's weekday (Monday = 1) has 21:30.
     */
    private fun stateWithExtendedBedtime(): DeviceState {
        val days = (1..7).joinToString(",") { weekday ->
            val bedtime = if (weekday == 1) "21:30" else "20:30"
            """{"weekday":$weekday,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"$bedtime"}"""
        }
        val json = """
            {
              "serverTime": "2026-10-26T00:00:00Z",
              "stateVersion": "v1",
              "device": {"id": "d1", "name": "Pixel 7", "form": "phone", "pool": "phone", "hasCellular": true},
              "kid": {"id": "k1", "name": "Alex"},
              "family": {"timezone": "Australia/Sydney", "emergencyNumber": "000", "parentCodeSecret": "ABC"},
              "parents": [],
              "contacts": [],
              "messagePresets": [],
              "schedule": {"version": 1, "warn1Min": 15, "warn2Min": 5, "days": [$days]},
              "today": {"date": "2026-10-26", "grants": [], "poolSegments": [], "appUsage": []},
              "parentMode": {"active": false, "endsAt": null, "byName": null},
              "pendingRequest": null,
              "activeSos": null,
              "apps": { "newAppApproval": false, "rules": [] }
            }
        """.trimIndent()
        return au.screentime.core.model.api.ApiJson.decodeFromString(json)
    }

    /** A DeviceState with the usual bedtime 20:30 (no extension). */
    private fun stateWithUsualBedtime(): DeviceState {
        val days = (1..7).joinToString(",") { weekday ->
            """{"weekday":$weekday,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"}"""
        }
        val json = """
            {
              "serverTime": "2026-10-26T00:00:00Z",
              "stateVersion": "v1",
              "device": {"id": "d1", "name": "Pixel 7", "form": "phone", "pool": "phone", "hasCellular": true},
              "kid": {"id": "k1", "name": "Alex"},
              "family": {"timezone": "Australia/Sydney", "emergencyNumber": "000", "parentCodeSecret": "ABC"},
              "parents": [],
              "contacts": [],
              "messagePresets": [],
              "schedule": {"version": 1, "warn1Min": 15, "warn2Min": 5, "days": [$days]},
              "today": {"date": "2026-10-26", "grants": [], "poolSegments": [], "appUsage": []},
              "parentMode": {"active": false, "endsAt": null, "byName": null},
              "pendingRequest": null,
              "activeSos": null,
              "apps": { "newAppApproval": false, "rules": [] }
            }
        """.trimIndent()
        return au.screentime.core.model.api.ApiJson.decodeFromString(json)
    }

    @Test
    fun withTimeUsedUpTheDeviceIsLockedOutOfTimeNotBedtime() {
        // Use up the phone's 90 min allowance: one 90-min segment.
        val json = """
            {
              "serverTime": "2026-10-26T00:00:00Z",
              "stateVersion": "v1",
              "device": {"id": "d1", "name": "Pixel 7", "form": "phone", "pool": "phone", "hasCellular": true},
              "kid": {"id": "k1", "name": "Alex"},
              "family": {"timezone": "Australia/Sydney", "emergencyNumber": "000", "parentCodeSecret": "ABC"},
              "parents": [],
              "contacts": [],
              "messagePresets": [],
              "schedule": {"version": 1, "warn1Min": 15, "warn2Min": 5, "days": [
                {"weekday":1,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"21:30"},
                {"weekday":2,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":3,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":4,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":5,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":6,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":7,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"}
              ]},
              "today": {"date": "2026-10-26", "grants": [], "poolSegments": [
                {"id": "s1", "deviceId": "d1", "startedAt": "2026-10-26T09:00:00+11:00", "endedAt": "2026-10-26T10:30:00+11:00"}
              ], "appUsage": []},
              "parentMode": {"active": false, "endsAt": null, "byName": null},
              "pendingRequest": null,
              "activeSos": null,
              "apps": { "newAppApproval": false, "rules": [] }
            }
        """.trimIndent()
        val stateWithSegments = au.screentime.core.model.api.ApiJson.decodeFromString<DeviceState>(json)
        val input = todayInput(stateWithSegments, emptyList(), now)
        val result = evaluate(input)

        // 90 min used out of 90 min allowance → out of time.
        assertTrue(result.locked)
        assertEquals(au.screentime.core.time.LockReason.OUT_OF_TIME, result.lockReason)
        // Next re-evaluation at 21:30 Sydney (the extended bedtime) = 10:30 UTC.
        assertEquals(ms("2026-10-26T10:30:00Z"), result.reevaluateAt.toEpochMilli())
    }

    @Test
    fun withTimeLeftTheDeviceIsNotLockedAndLocksAtTheExtendedBedtime() {
        // Use 30 min of the 90 min allowance → 60 min left.
        val json = """
            {
              "serverTime": "2026-10-26T00:00:00Z",
              "stateVersion": "v1",
              "device": {"id": "d1", "name": "Pixel 7", "form": "phone", "pool": "phone", "hasCellular": true},
              "kid": {"id": "k1", "name": "Alex"},
              "family": {"timezone": "Australia/Sydney", "emergencyNumber": "000", "parentCodeSecret": "ABC"},
              "parents": [],
              "contacts": [],
              "messagePresets": [],
              "schedule": {"version": 1, "warn1Min": 15, "warn2Min": 5, "days": [
                {"weekday":1,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"21:30"},
                {"weekday":2,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":3,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":4,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":5,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":6,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":7,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"}
              ]},
              "today": {"date": "2026-10-26", "grants": [], "poolSegments": [
                {"id": "s1", "deviceId": "d1", "startedAt": "2026-10-26T09:00:00+11:00", "endedAt": "2026-10-26T09:30:00+11:00"}
              ], "appUsage": []},
              "parentMode": {"active": false, "endsAt": null, "byName": null},
              "pendingRequest": null,
              "activeSos": null,
              "apps": { "newAppApproval": false, "rules": [] }
            }
        """.trimIndent()
        val stateWithSegments = au.screentime.core.model.api.ApiJson.decodeFromString<DeviceState>(json)
        val input = todayInput(stateWithSegments, emptyList(), now)
        val result = evaluate(input)

        // 60 min left → not locked.
        assertFalse(result.locked)
        // Locks at the earlier of (now + 60 min) and the extended bedtime (21:30 Sydney).
        // now + 60 min = 20:45 + 60 = 21:45 Sydney. Extended bedtime = 21:30 Sydney.
        // So it locks at 21:30 Sydney = 10:30 UTC.
        assertEquals(ms("2026-10-26T10:30:00Z"), result.nextLockAt?.toEpochMilli())
    }

    @Test
    fun kidStatusShowsTheExtendedBedtime() {
        val state = stateWithExtendedBedtime()
        val input = todayInput(state, emptyList(), now)
        val result = evaluate(input)
        val status = kidStatus(state, result, now, online = true, elapsedMs = 0)

        // Bedtime shows 9:30 pm (the extended bedtime).
        assertEquals("9:30 pm", status.bedtime)
    }

    @Test
    fun withTheUsualBedtimeTheSameMomentIsBedtime() {
        // With the usual bedtime (20:30) and time used up, the device locks for bedtime.
        // At 20:45, it is past 20:30, so it is locked for bedtime.
        val json = """
            {
              "serverTime": "2026-10-26T00:00:00Z",
              "stateVersion": "v1",
              "device": {"id": "d1", "name": "Pixel 7", "form": "phone", "pool": "phone", "hasCellular": true},
              "kid": {"id": "k1", "name": "Alex"},
              "family": {"timezone": "Australia/Sydney", "emergencyNumber": "000", "parentCodeSecret": "ABC"},
              "parents": [],
              "contacts": [],
              "messagePresets": [],
              "schedule": {"version": 1, "warn1Min": 15, "warn2Min": 5, "days": [
                {"weekday":1,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":2,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":3,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":4,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":5,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":6,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"},
                {"weekday":7,"screensMin":120,"phoneMin":90,"wake":"07:00","bedtime":"20:30"}
              ]},
              "today": {"date": "2026-10-26", "grants": [], "poolSegments": [
                {"id": "s1", "deviceId": "d1", "startedAt": "2026-10-26T09:00:00+11:00", "endedAt": "2026-10-26T10:30:00+11:00"}
              ], "appUsage": []},
              "parentMode": {"active": false, "endsAt": null, "byName": null},
              "pendingRequest": null,
              "activeSos": null,
              "apps": { "newAppApproval": false, "rules": [] }
            }
        """.trimIndent()
        val stateWithSegments = au.screentime.core.model.api.ApiJson.decodeFromString<DeviceState>(json)
        val input = todayInput(stateWithSegments, emptyList(), now)
        val result = evaluate(input)

        // Past the usual bedtime of 20:30 → locked for bedtime.
        assertTrue(result.locked)
        assertEquals(au.screentime.core.time.LockReason.BEDTIME, result.lockReason)
    }
}
