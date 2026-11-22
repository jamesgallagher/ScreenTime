package au.screentime.kid.update

import android.content.Context

/**
 * The `requestedAt` this device last acted on for a remote "Update now" (docs/SPEC.md §12.11). This is kept in
 * SharedPreferences so the action runs once per request, and it is separate from [AskedNote] so a remote install does
 * not reopen the app after it restarts.
 */
class RemoteUpdateNote(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    /** Epoch milliseconds, or null when the device has not acted on a remote request yet. */
    fun read(): Long? = prefs.getLong(KEY, Long.MIN_VALUE).takeIf { it != Long.MIN_VALUE }

    /** Writes synchronously so the value is on disk before the installer commit. */
    fun write(nowMs: Long) {
        prefs.edit().putLong(KEY, nowMs).commit()
    }

    private companion object {
        const val PREFS_FILE = "update"
        const val KEY = "remote_update_handled_at"
    }
}
