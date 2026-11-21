package au.screentime.core.ui.update

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** The words in `test-vectors/update-words.json`, which the C# tests read too (docs/SPEC.md §12.11). */
class UpdateWordsTest {
    private val root: JsonObject = Json.parseToJsonElement(File(System.getProperty("updateWords")).readText()).jsonObject

    private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull

    private fun stateOf(name: String, version: String?, size: Long?): UpdateState = when (name) {
        "unknown" -> UpdateState.Unknown
        "checking" -> UpdateState.Checking
        "up-to-date" -> UpdateState.UpToDate
        "check-failed" -> UpdateState.CheckFailed
        "available" -> UpdateState.Available(version!!, size!!)
        "downloading" -> UpdateState.Downloading(version!!)
        "ready" -> UpdateState.Ready(version!!)
        "installing" -> UpdateState.Installing(version!!)
        "failed" -> UpdateState.Failed(version!!)
        else -> error("unknown state $name")
    }

    @Test
    fun everyStateHasTheSharedStatusAndButton() {
        val rows: JsonArray = root["states"]!!.jsonArray
        for (row in rows) {
            val o = row.jsonObject
            val state = stateOf(o["state"].text()!!, o["version"].text(), o["sizeBytes"]?.jsonPrimitive?.longOrNull)
            assertEquals(o["status"].text(), statusLine(state), "status of $state")
            assertEquals(o["button"].text(), mainButton(state), "button of $state")
        }
    }

    @Test
    fun whatWillHappenMatchesTheKidAndParentLines() {
        val words = root["whatWillHappen"]!!.jsonObject
        assertEquals(words["kid"].text(), WhatWillHappen.KID)
        assertEquals(words["parent"].text(), WhatWillHappen.PARENT)
    }

    @Test
    fun openingTheSheetChecksOnlyWhenNothingIsUnderWayAndNoRecentCheck() {
        for (row in root["checkOnOpen"]!!.jsonArray) {
            val o = row.jsonObject
            val state = stateOf(o["state"].text()!!, "0.1.9", 34_000_000)
            val seconds = o["secondsSinceLastCheck"]?.jsonPrimitive?.longOrNull
            assertEquals(o["checks"]!!.jsonPrimitive.content.toBoolean(), checkOnOpen(state, seconds), "$state after $seconds s")
        }
    }
}
