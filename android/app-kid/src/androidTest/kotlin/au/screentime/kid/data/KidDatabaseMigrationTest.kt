package au.screentime.kid.data

import androidx.room.Room
import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Version 1 to 2 of `kid.db` (docs/SPEC.md §12.10, acceptance criterion 13): the site_lookups table is added, and
 * the segments still on the device survive the migration. The version 1 schema is in
 * `src/androidTest/res/raw/v1/kid.sql`.
 */
@RunWith(AndroidJUnit4::class)
class KidDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), KidDatabase::class.java)

    @Test
    fun version1To2AddsSiteLookupsAndKeepsExistingSegments() = runBlocking {
        val db = helper.createDatabase("kid.db", 1)
        db.execSQL("INSERT INTO `segments` VALUES ('seg-1', 1000, 2000, 1500, 0, 1, 1)")
        db.execSQL("INSERT INTO `segments` VALUES ('seg-2', 1500, NULL, 1600, 0, 1, 0)")
        db.close()
        helper.runMigrationsAndValidate("kid.db", 1, true, KidDatabase.MIGRATION_1_2)
        val db2 = Room.databaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, KidDatabase::class.java, "kid.db").build()
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
    }
}
