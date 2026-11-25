package au.screentime.kid.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.migration.Migration
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Upsert
import androidx.sqlite.db.SupportSQLiteDatabase
import au.screentime.kid.usage.LocalSegment
import au.screentime.kid.usage.PendingSegment
import au.screentime.kid.usage.SegmentStore
import au.screentime.kid.searches.SearchRow
import au.screentime.kid.searches.SearchSighting
import au.screentime.kid.searches.addSighting

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

/** One DNS lookup the kid app kept, waiting to be sent to the server (docs/SPEC.md §12.10). */
@Entity(tableName = "site_lookups")
data class SiteLookupRow(
    @PrimaryKey(autoGenerate = true) val id: Long,
    val atMs: Long,
    val host: String,
    val pkg: String,
)

@Dao
abstract class SiteLookupDao {
    @Insert
    abstract suspend fun insert(rows: List<SiteLookupRow>)

    /** Oldest first: what the next sync sends. */
    @Query("SELECT * FROM site_lookups ORDER BY atMs, id LIMIT :limit")
    abstract suspend fun oldest(limit: Int): List<SiteLookupRow>

    /** Deletes exactly the rows a sync sent. */
    @Query("DELETE FROM site_lookups WHERE id IN (:ids)")
    abstract suspend fun delete(ids: List<Long>)

    /** Beyond the wait limit, the oldest go (docs/SPEC.md §12.10). */
    @Query("DELETE FROM site_lookups WHERE id IN (SELECT id FROM site_lookups ORDER BY atMs, id LIMIT :toDelete)")
    abstract suspend fun deleteOldest(toDelete: Int)

    @Query("SELECT COUNT(*) FROM site_lookups")
    abstract suspend fun count(): Int
}

/** One complete search waiting to be sent to the server. */
@Entity(tableName = "searches", primaryKeys = ["atMs", "engine", "query", "packageName"])
data class SearchEntity(
    val atMs: Long,
    val lastAtMs: Long,
    val count: Int,
    val engine: String,
    val query: String,
    val packageName: String,
    val version: Long,
    val sentVersion: Long,
)

@Dao
abstract class SearchDao {
    @Query("SELECT * FROM searches ORDER BY atMs, lastAtMs, engine, query, packageName")
    protected abstract suspend fun all(): List<SearchEntity>

    @Upsert
    protected abstract suspend fun upsert(row: SearchEntity)

    @Transaction
    open suspend fun record(sighting: SearchSighting) {
        val previous = all()
        val rows = addSighting(previous.map { it.toSearchRow() }, sighting)
        val oldVersions = previous.associate { it.key() to it.version }
        rows.filter { oldVersions[it.key()] != it.version }.forEach { upsert(it.toEntity()) }
    }

    @Query("SELECT * FROM searches WHERE version > sentVersion ORDER BY atMs, engine, query, packageName LIMIT :limit")
    abstract suspend fun pending(limit: Int): List<SearchEntity>

    @Query(
        "SELECT * FROM searches WHERE engine = :engine AND packageName = :packageName " +
            "AND query = :query COLLATE NOCASE ORDER BY lastAtMs DESC LIMIT 1",
    )
    abstract suspend fun recent(engine: String, query: String, packageName: String): SearchEntity?

    @Query(
        "UPDATE searches SET sentVersion = :version WHERE atMs = :atMs AND engine = :engine " +
            "AND query = :query AND packageName = :packageName AND sentVersion < :version",
    )
    abstract suspend fun markSent(atMs: Long, engine: String, query: String, packageName: String, version: Long)

    @Query("DELETE FROM searches WHERE lastAtMs < :beforeMs AND version = sentVersion")
    abstract suspend fun prune(beforeMs: Long)

    @Query("SELECT COUNT(*) FROM searches")
    abstract suspend fun count(): Int

    @Query(
        "DELETE FROM searches WHERE rowid IN " +
            "(SELECT rowid FROM searches ORDER BY atMs, engine, query, packageName LIMIT :toDelete)",
    )
    abstract suspend fun deleteOldest(toDelete: Int)

    private fun SearchEntity.key() = SearchKey(atMs, engine, query, packageName)

    private fun SearchRow.key() = SearchKey(atMs, engine, query, packageName)

    private fun SearchEntity.toSearchRow() = SearchRow(atMs, lastAtMs, count, engine, query, packageName, version, sentVersion)

    private fun SearchRow.toEntity() = SearchEntity(atMs, lastAtMs, count, engine, query, packageName, version, sentVersion)

    private data class SearchKey(val atMs: Long, val engine: String, val query: String, val packageName: String)
}

/** The kid app's database, in app-private storage (never backed up). Later cards add their outboxes here. */
@Database(entities = [SegmentRow::class, SiteLookupRow::class, SearchEntity::class], version = 3, exportSchema = false)
abstract class KidDatabase : RoomDatabase() {
    abstract fun segments(): SegmentDao
    abstract fun siteLookups(): SiteLookupDao
    abstract fun searches(): SearchDao

    companion object {
        /**
         * Version 1 to 2: the site_lookups table (docs/SPEC.md §12.10). Everything else, including the unsent
         * segments, stays: never destructive.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `site_lookups` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                        "`atMs` INTEGER NOT NULL, `host` TEXT NOT NULL, `pkg` TEXT NOT NULL)",
                )
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `searches` (`atMs` INTEGER NOT NULL, `lastAtMs` INTEGER NOT NULL, " +
                        "`count` INTEGER NOT NULL, `engine` TEXT NOT NULL, `query` TEXT NOT NULL, " +
                        "`packageName` TEXT NOT NULL, `version` INTEGER NOT NULL, `sentVersion` INTEGER NOT NULL, " +
                        "PRIMARY KEY(`atMs`, `engine`, `query`, `packageName`))",
                )
            }
        }

        @Volatile private var instance: KidDatabase? = null

        /**
         * The one database of the process: the service and the admin receiver share it. A new Room instance per call
         * would open another connection pool each sync and never close it.
         */
        fun open(context: Context): KidDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(context.applicationContext, KidDatabase::class.java, "kid.db")
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                    .build()
                    .also { instance = it }
            }
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
