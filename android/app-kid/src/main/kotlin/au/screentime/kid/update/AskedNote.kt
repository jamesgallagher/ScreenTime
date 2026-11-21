package au.screentime.kid.update

import android.content.Context

/**
 * The time a parent last tapped **Update now**, written just before the install commit so that
 * [BootReceiver] can reopen the main screen after a self-update (docs/SPEC.md §12.11).
 */
class AskedNote(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    /** Epoch milliseconds, or null when no parent-asked install is pending. */
    fun read(): Long? = prefs.getLong(KEY, Long.MIN_VALUE).takeIf { it != Long.MIN_VALUE }

    /** Writes the current time synchronously so the value is on disk before the installer commit. */
    fun write(nowMs: Long) {
        prefs.edit().putLong(KEY, nowMs).commit()
    }

    /** Clears the note synchronously after the app has restarted. */
    fun clear() {
        prefs.edit().remove(KEY).commit()
    }

    private companion object {
        const val PREFS_FILE = "update"
        const val KEY = "update_asked_at"
    }
}
