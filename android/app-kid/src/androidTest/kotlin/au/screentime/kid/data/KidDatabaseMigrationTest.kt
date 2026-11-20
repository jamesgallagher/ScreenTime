package au.screentime.kid.data

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Version 1 to 2 of `kid.db` (docs/SPEC.md §12.10, acceptance criterion 13): the site_lookups table is added, and
 * the segments still on the device survive the migration. A version 1 file (the segments table only, the schema
 * before this card) is created with a plain `SQLiteOpenHelper`; the version 2 database plus the 1 to 2 migration
 * is then built on that same file, and Room applies the migration and checks the schema.
 */
@RunWith(AndroidJUnit4::class)
class KidDatabaseMigrationTest {

    /** The version 1 schema of kid.db: the segments table only, as the KSP-generated database created it. */
    private val v1Schema =
        "CREATE TABLE IF NOT EXISTS `segments` (`id` TEXT NOT NULL, `startedAtMs` INTEGER NOT NULL, " +
            "`endedAtMs` INTEGER, `lastSeenAtMs` INTEGER NOT NULL, `recordedOffline` INTEGER NOT NULL, " +
            "`version` INTEGER NOT NULL, `sentVersion` INTEGER NOT NULL, PRIMARY KEY(`id`))"

    @Test
    fun version1To2AddsSiteLookupsAndKeepsExistingSegments() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dbName = "kid.db"
        context.deleteDatabase(dbName)

        // The version 1 file, as the database looked before this card.
        val v1 = object : SQLiteOpenHelper(context, dbName, null, 1) {
            override fun onCreate(db: SQLiteDatabase) = db.execSQL(v1Schema)

            override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}
        }
        val db1 = v1.writableDatabase
        db1.execSQL("INSERT INTO `segments` VALUES ('seg-1', 1000, 2000, 1500, 0, 1, 1)")
        db1.execSQL("INSERT INTO `segments` VALUES ('seg-2', 1500, NULL, 1600, 0, 1, 0)")
        db1.close()

        // Version 2, with the 1 to 2 migration, on the same file.
        val db2 = Room.databaseBuilder(context, KidDatabase::class.java, dbName)
            .addMigrations(KidDatabase.MIGRATION_1_2)
            .build()
        val seg1 = db2.segments().byId("seg-1")
        val seg2 = db2.segments().byId("seg-2")
        Assert.assertEquals(1000L, seg1?.startedAtMs)
        Assert.assertEquals(2000L, seg1?.endedAtMs)
        Assert.assertEquals(1, seg1?.sentVersion)
        Assert.assertEquals(1500L, seg2?.startedAtMs)
        Assert.assertNull(seg2?.endedAtMs)
        Assert.assertEquals(0, seg2?.sentVersion)
        Assert.assertEquals(0, db2.siteLookups().count())
        db2.close()
        v1.close()
    }
}
