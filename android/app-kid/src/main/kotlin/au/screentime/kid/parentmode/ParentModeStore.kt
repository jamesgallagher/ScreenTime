package au.screentime.kid.parentmode

import android.content.Context

/**
 * [LocalParentMode] in SharedPreferences, so a code session and an **End now** survive a restart until the server
 * has them. Only the service writes it, one change at a time.
 */
class ParentModeStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("parent_mode", Context.MODE_PRIVATE)

    fun load(): LocalParentMode {
        val id = prefs.getString(CODE_ID, null)
        val code = if (id == null) {
            null
        } else {
            CodeSession(
                id = id,
                durationMin = prefs.getInt(CODE_MINUTES, 0).takeIf { it > 0 },
                startedAtMs = prefs.getLong(CODE_STARTED, 0),
                reportedAtMs = prefs.getLong(CODE_REPORTED, 0).takeIf { it > 0 },
            )
        }
        return LocalParentMode(
            code = code,
            endedAtMs = prefs.getLong(ENDED, 0).takeIf { it > 0 },
            endReported = prefs.getBoolean(END_REPORTED, true),
        )
    }

    fun save(local: LocalParentMode) {
        val edit = prefs.edit().clear()
        local.code?.let {
            edit.putString(CODE_ID, it.id)
                .putInt(CODE_MINUTES, it.durationMin ?: 0)
                .putLong(CODE_STARTED, it.startedAtMs)
                .putLong(CODE_REPORTED, it.reportedAtMs ?: 0)
        }
        local.endedAtMs?.let { edit.putLong(ENDED, it) }
        // Written at once: the next thing may be a reboot.
        edit.putBoolean(END_REPORTED, local.endReported).commit()
    }

    private companion object {
        const val CODE_ID = "codeId"
        const val CODE_MINUTES = "codeMinutes"
        const val CODE_STARTED = "codeStartedAtMs"
        const val CODE_REPORTED = "codeReportedAtMs"
        const val ENDED = "endedAtMs"
        const val END_REPORTED = "endReported"
    }
}
