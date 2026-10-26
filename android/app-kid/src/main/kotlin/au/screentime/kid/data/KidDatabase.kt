package au.screentime.kid.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Upsert
import au.screentime.kid.usage.LocalSegment
import au.screentime.kid.usage.PendingSegment
import au.screentime.kid.usage.SegmentStore

/** One row per segment. [version] goes up with every change; [sentVersion] is the version the server has. */
@Entity(tableName = "segments")
data class SegmentRow(
    @PrimaryKey val id: String,
    val startedAtMs: Long,
    val endedAtMs: Long?,
    val lastSeenAtMs: Long,
    val recordedOffline: Boolean,
    val version: Int,
    val sentVersion: Int,
)

@Dao
abstract class SegmentDao {
    @Query("SELECT * FROM segments WHERE endedAtMs IS NULL ORDER BY startedAtMs DESC LIMIT 1")
    abstract suspend fun open(): SegmentRow?

    @Query("SELECT * FROM segments WHERE id = :id")
    abstract suspend fun byId(id: String): SegmentRow?

    @Upsert
    abstract suspend fun upsert(row: SegmentRow)

    /** Saves the segment with the next version, so it is uploaded again. */
    @Transaction
    open suspend fun put(segment: LocalSegment) {
        val old = byId(segment.id)
        upsert(
            SegmentRow(
                id = segment.id,
                startedAtMs = segment.startedAtMs,
                endedAtMs = segment.endedAtMs,
                lastSeenAtMs = segment.lastSeenAtMs,
                recordedOffline = segment.recordedOffline,
                version = (old?.version ?: 0) + 1,
                sentVersion = old?.sentVersion ?: 0,
            ),
        )
    }

    @Query("UPDATE segments SET lastSeenAtMs = :atMs WHERE id = :id")
    abstract suspend fun touch(id: String, atMs: Long)

    @Query("SELECT * FROM segments WHERE endedAtMs IS NULL OR endedAtMs >= :fromMs ORDER BY startedAtMs")
    abstract suspend fun since(fromMs: Long): List<SegmentRow>

    @Query("SELECT * FROM segments WHERE version > sentVersion ORDER BY startedAtMs LIMIT :limit")
    abstract suspend fun pending(limit: Int): List<SegmentRow>

    @Query("UPDATE segments SET sentVersion = :version WHERE id = :id AND sentVersion < :version")
    abstract suspend fun markSent(id: String, version: Int)

    @Query("DELETE FROM segments WHERE endedAtMs < :beforeMs AND version = sentVersion")
    abstract suspend fun prune(beforeMs: Long)
}

/** The kid app's database, in app-private storage (never backed up). Later cards add their outboxes here. */
@Database(entities = [SegmentRow::class], version = 1, exportSchema = false)
abstract class KidDatabase : RoomDatabase() {
    abstract fun segments(): SegmentDao

    companion object {
        fun open(context: Context): KidDatabase =
            Room.databaseBuilder(context.applicationContext, KidDatabase::class.java, "kid.db").build()
    }
}

/** [SegmentStore] on the database. */
class RoomSegmentStore(private val dao: SegmentDao) : SegmentStore {
    override suspend fun open() = dao.open()?.toSegment()

    override suspend fun put(segment: LocalSegment) = dao.put(segment)

    override suspend fun touch(id: String, atMs: Long) = dao.touch(id, atMs)

    override suspend fun since(fromMs: Long) = dao.since(fromMs).map { it.toSegment() }

    override suspend fun pending(limit: Int) = dao.pending(limit).map { PendingSegment(it.toSegment(), it.version) }

    override suspend fun markSent(id: String, version: Int) = dao.markSent(id, version)

    override suspend fun prune(beforeMs: Long) = dao.prune(beforeMs)

    private fun SegmentRow.toSegment() = LocalSegment(id, startedAtMs, endedAtMs, lastSeenAtMs, recordedOffline)
}
