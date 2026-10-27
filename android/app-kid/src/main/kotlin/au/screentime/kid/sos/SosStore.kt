package au.screentime.kid.sos

import android.content.Context

/**
 * [LocalSos] in SharedPreferences, so an SOS goes on after the app restarts and what the server has not got yet is
 * still sent. Only the service writes it, one change at a time.
 */
class SosStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("sos", Context.MODE_PRIVATE)

    fun load(): LocalSos? {
        val id = prefs.getString(ID, null) ?: return null
        return LocalSos(
            id = id,
            startedAtMs = prefs.getLong(STARTED, 0),
            autoStopAtMs = prefs.getLong(AUTO_STOP, 0),
            startFix = prefs.getString(START_FIX, null)?.let(::fixOf),
            startReportedAtMs = long(START_REPORTED),
            queue = prefs.getString(QUEUE, "").orEmpty().split(';').filter { it.isNotEmpty() }.mapNotNull(::fixOf),
            lastFix = prefs.getString(LAST_FIX, null)?.let(::fixOf),
            lastDataAtMs = long(LAST_DATA),
            lastTextAtMs = long(LAST_TEXT),
            seenBy = prefs.getString(SEEN_BY, "").orEmpty().split('\n').filter { it.isNotEmpty() },
            endedAtMs = long(ENDED),
            endedBy = prefs.getString(ENDED_BY, null)?.let(SosEnd::valueOf),
            endedByName = prefs.getString(ENDED_BY_NAME, null),
            endReported = prefs.getBoolean(END_REPORTED, false),
            endTextSent = prefs.getBoolean(END_TEXT_SENT, false),
        )
    }

    /** Saves [sos], or forgets the SOS when it is null. Written at once: the next thing may be a reboot. */
    fun save(sos: LocalSos?) {
        val edit = prefs.edit().clear()
        if (sos != null) {
            edit.putString(ID, sos.id)
                .putLong(STARTED, sos.startedAtMs)
                .putLong(AUTO_STOP, sos.autoStopAtMs)
                .putString(QUEUE, sos.queue.joinToString(";", transform = ::textOf))
                .putString(SEEN_BY, sos.seenBy.joinToString("\n"))
                .putBoolean(END_REPORTED, sos.endReported)
                .putBoolean(END_TEXT_SENT, sos.endTextSent)
            sos.startFix?.let { edit.putString(START_FIX, textOf(it)) }
            sos.startReportedAtMs?.let { edit.putLong(START_REPORTED, it) }
            sos.lastFix?.let { edit.putString(LAST_FIX, textOf(it)) }
            sos.lastDataAtMs?.let { edit.putLong(LAST_DATA, it) }
            sos.lastTextAtMs?.let { edit.putLong(LAST_TEXT, it) }
            sos.endedAtMs?.let { edit.putLong(ENDED, it) }
            sos.endedBy?.let { edit.putString(ENDED_BY, it.name) }
            sos.endedByName?.let { edit.putString(ENDED_BY_NAME, it) }
        }
        edit.commit()
    }

    private fun long(key: String): Long? = if (prefs.contains(key)) prefs.getLong(key, 0) else null

    /** "atMs|lat|lng|accuracy|battery|sms", with nothing between the bars for a missing value. */
    private fun textOf(fix: SosFix): String =
        listOf(fix.atMs, fix.lat, fix.lng, fix.accuracyM ?: "", fix.batteryPct ?: "", if (fix.bySms) 1 else 0)
            .joinToString("|")

    private fun fixOf(text: String): SosFix? {
        val parts = text.split('|')
        if (parts.size != 6) return null
        return SosFix(
            atMs = parts[0].toLongOrNull() ?: return null,
            lat = parts[1].toDoubleOrNull() ?: return null,
            lng = parts[2].toDoubleOrNull() ?: return null,
            accuracyM = parts[3].toDoubleOrNull(),
            batteryPct = parts[4].toIntOrNull(),
            bySms = parts[5] == "1",
        )
    }

    private companion object {
        const val ID = "id"
        const val STARTED = "startedAtMs"
        const val AUTO_STOP = "autoStopAtMs"
        const val START_FIX = "startFix"
        const val START_REPORTED = "startReportedAtMs"
        const val QUEUE = "queue"
        const val LAST_FIX = "lastFix"
        const val LAST_DATA = "lastDataAtMs"
        const val LAST_TEXT = "lastTextAtMs"
        const val SEEN_BY = "seenBy"
        const val ENDED = "endedAtMs"
        const val ENDED_BY = "endedBy"
        const val ENDED_BY_NAME = "endedByName"
        const val END_REPORTED = "endReported"
        const val END_TEXT_SENT = "endTextSent"
    }
}
