package au.screentime.core.time

import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory

/** Runs every case in test-vectors/engine/ (docs/SPEC.md §7.4). build.gradle.kts passes the folder. */
class EngineVectorsTest {
    private val files = File(System.getProperty("testVectors")).listFiles { f -> f.name.endsWith(".json") }!!.sortedBy { it.name }

    @Test
    fun findsTheVectorFiles() {
        assertTrue(files.size >= 26, "only ${files.size} vector files")
    }

    @TestFactory
    fun vectors(): List<DynamicTest> = files.map { file ->
        val case = Json.parseToJsonElement(file.readText()).jsonObject
        DynamicTest.dynamicTest("${file.name}: ${case.string("name")}") {
            val result = evaluate(inputOf(case))
            val expect = case.obj("expect")
            assertEquals(expect.getValue("locked").jsonPrimitive.boolean, result.locked, "locked")
            assertEquals(expect.stringOrNull("lockReason"), result.lockReason?.wire, "lockReason")
            assertEquals(expect.getValue("remainingSec").jsonPrimitive.long, result.remainingSec, "remainingSec")
            // Compare instants, not strings: the vectors use +11:00 offsets.
            assertEquals(expect.stringOrNull("nextLockAt")?.let(::instant), result.nextLockAt, "nextLockAt")
            assertEquals(instant(expect.string("reevaluateAt")), result.reevaluateAt, "reevaluateAt")
            assertEquals(expect.getValue("usedSec").jsonPrimitive.long, result.usedSec, "usedSec")
            assertEquals(expect.getValue("overspendSec").jsonPrimitive.long, result.overspendSec, "overspendSec")
        }
    }

    private fun inputOf(case: JsonObject): EngineInput {
        val day = case.obj("day")
        return EngineInput(
            tz = ZoneId.of(case.string("tz")),
            date = LocalDate.parse(case.string("date")),
            now = instant(case.string("now")),
            day = DaySchedule(day.getValue("allowanceMin").jsonPrimitive.int, day.string("wake"), day.string("bedtime")),
            grants = case.getValue("grants").jsonArray.map {
                Grant(it.jsonObject.getValue("minutes").jsonPrimitive.int, instant(it.jsonObject.string("createdAt")))
            },
            segments = case.getValue("segments").jsonArray.map {
                Segment(instant(it.jsonObject.string("start")), it.jsonObject.stringOrNull("end")?.let(::instant))
            },
        )
    }

    private fun instant(text: String): Instant = OffsetDateTime.parse(text).toInstant()

    private fun JsonObject.obj(key: String): JsonObject = getValue(key).jsonObject

    private fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

    private fun JsonObject.stringOrNull(key: String): String? {
        val value: JsonElement = getValue(key)
        return if (value is JsonNull) null else value.jsonPrimitive.content
    }
}
