package au.screentime.kid.data

import android.content.Context
import android.util.AtomicFile
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceState
import au.screentime.kid.searches.SearchSighting
import au.screentime.kid.sync.CachedState
import au.screentime.kid.sync.ClockAnchor
import au.screentime.kid.sync.ClockStore
import au.screentime.kid.sync.StateStore
import java.io.File

/** [ClockStore] in SharedPreferences. */
class PrefsClockStore(context: Context) : ClockStore {
    private val prefs = context.applicationContext.getSharedPreferences("clock", Context.MODE_PRIVATE)

    override var anchor: ClockAnchor?
        get() = if (!prefs.contains(SERVER)) {
            null
        } else {
            ClockAnchor(prefs.getLong(SERVER, 0), prefs.getLong(ELAPSED, 0), prefs.getInt(BOOT, 0))
        }
        set(value) {
            val edit = prefs.edit()
            if (value == null) {
                edit.remove(SERVER).remove(ELAPSED).remove(BOOT)
            } else {
                edit.putLong(SERVER, value.serverMs).putLong(ELAPSED, value.elapsedMs).putInt(BOOT, value.bootCount)
            }
            edit.apply()
        }

    override var lastTrustedMs: Long
        get() = prefs.getLong(LAST, 0)
        set(value) {
            prefs.edit().putLong(LAST, value).apply()
        }

    private companion object {
        const val SERVER = "anchorServerMs"
        const val ELAPSED = "anchorElapsedMs"
        const val BOOT = "anchorBootCount"
        const val LAST = "lastTrustedMs"
    }
}

/**
 * [StateStore] in two files: the snapshot as the server sent it, and its ETag. Each is written whole to a new file
 * first ([AtomicFile]), so a power cut never leaves half a snapshot.
 */
class FileStateStore(context: Context) : StateStore {
    private val stateFile = AtomicFile(File(context.applicationContext.filesDir, "state.json"))
    private val etagFile = AtomicFile(File(context.applicationContext.filesDir, "state.etag"))

    override fun load(): CachedState? = try {
        val state = ApiJson.decodeFromString<DeviceState>(stateFile.readFully().decodeToString())
        val etag = try {
            etagFile.readFully().decodeToString().ifEmpty { null }
        } catch (e: Exception) {
            null
        }
        CachedState(etag, state)
    } catch (e: Exception) {
        null
    }

    override fun save(cached: CachedState) {
        write(stateFile, ApiJson.encodeToString(cached.state))
        write(etagFile, cached.etag ?: "")
    }

    private fun write(file: AtomicFile, text: String) {
        val out = file.startWrite()
        try {
            out.write(text.encodeToByteArray())
            file.finishWrite(out)
        } catch (e: Exception) {
            file.failWrite(out)
            throw e
        }
    }
}

/** Search outbox in kid.db: changed rows first, at most 5,000 waiting, sent rows pruned after ten minutes. */
class RoomSearchStore(private val dao: SearchDao) {
    suspend fun record(sighting: SearchSighting) {
        dao.record(sighting)
        val waiting = dao.count()
        if (waiting > MAX_WAITING) dao.deleteOldest(waiting - MAX_WAITING)
    }

    suspend fun pending(limit: Int) = dao.pending(limit)

    suspend fun markSent(row: SearchEntity) {
        dao.markSent(row.atMs, row.engine, row.query, row.packageName, row.version)
    }

    suspend fun prune(beforeMs: Long) = dao.prune(beforeMs)

    private companion object {
        const val MAX_WAITING = 5_000
    }
}
