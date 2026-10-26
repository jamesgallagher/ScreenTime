package au.screentime.kid.usage

import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceState

/**
 * A snapshot as `GET /v1/device/state` sends it, for tests. The family is in Sydney; every day allows 120 min of
 * Screens and 90 min of Phone from 07:00 to 20:30, except Monday (weekday 1) with 60 min of Phone.
 */
fun stateJson(
    date: String = "2026-10-26",
    pool: String = "phone",
    grants: String = "",
    segments: String = "",
    serverTime: String = "2026-10-26T00:00:00Z",
): String {
    val days = (1..7).joinToString(",") { weekday ->
        val phone = if (weekday == 1) 60 else 90
        """{"weekday":$weekday,"screensMin":120,"phoneMin":$phone,"wake":"07:00","bedtime":"20:30"}"""
    }
    return """
        {
          "serverTime": "$serverTime",
          "stateVersion": "v1",
          "device": {"id": "d1", "name": "Pixel 7", "form": "phone", "pool": "$pool", "hasCellular": true},
          "kid": {"id": "k1", "name": "Alex"},
          "family": {"timezone": "Australia/Sydney", "emergencyNumber": "000", "parentCodeSecret": "ABC"},
          "parents": [],
          "contacts": [],
          "messagePresets": [],
          "schedule": {"version": 1, "warn1Min": 15, "warn2Min": 5, "days": [$days]},
          "today": {"date": "$date", "grants": [$grants], "poolSegments": [$segments]},
          "parentMode": {"active": false, "endsAt": null, "byName": null},
          "pendingRequest": null,
          "activeSos": null
        }
    """.trimIndent()
}

fun state(
    date: String = "2026-10-26",
    pool: String = "phone",
    grants: String = "",
    segments: String = "",
): DeviceState = ApiJson.decodeFromString(stateJson(date, pool, grants, segments))
