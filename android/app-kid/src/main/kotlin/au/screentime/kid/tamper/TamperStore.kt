package au.screentime.kid.tamper

import android.content.Context
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceEventIn
import au.screentime.core.model.api.DeviceEventKind
import kotlinx.serialization.builtins.ListSerializer

/**
 * Tamper events the server has not got yet, and what the service needs to know about past attempts, in
 * SharedPreferences, so a queue made offline is still sent after a restart. Only the service uses it.
 */
class TamperStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("tamper", Context.MODE_PRIVATE)
    private val list = ListSerializer(DeviceEventIn.serializer())

    /** The events still to send, oldest first. */
    fun queue(): List<DeviceEventIn> = try {
        prefs.getString(QUEUE, null)?.let { ApiJson.decodeFromString(list, it) }.orEmpty()
    } catch (e: IllegalArgumentException) {
        // Not readable (SerializationException is an IllegalArgumentException): nothing to send.
        emptyList()
    }

    fun saveQueue(events: List<DeviceEventIn>) {
        prefs.edit().putString(QUEUE, ApiJson.encodeToString(list, events)).commit()
    }

    /** Trusted time of the last attempt of [kind] that was recorded. */
    fun lastAt(kind: DeviceEventKind): Long? = prefs.getLong(LAST + kind.wire, -1).takeIf { it >= 0 }

    fun setLastAt(kind: DeviceEventKind, atMs: Long) {
        prefs.edit().putLong(LAST + kind.wire, atMs).commit()
    }

    /** Which caught screen comes next: 0, 1, 2, 3, … */
    fun nextCaught(): Int {
        val n = prefs.getInt(CAUGHT, 0)
        prefs.edit().putInt(CAUGHT, n + 1).commit()
        return n
    }

    private companion object {
        const val QUEUE = "queue"
        const val LAST = "lastAt."
        const val CAUGHT = "caught"
    }
}
