# CARD-028: core-time Kotlin engine

| Field | Value |
|---|---|
| Card | CARD-028 |
| Title | core-time Kotlin engine |
| Size | M |
| Depends on | CARD-003 (TypeScript engine and test vectors), CARD-004 (Android project), both merged to `main` |
| Spec sections | docs/SPEC.md §7 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-028-kotlin-engine` |
| PR title | `CARD-028: core-time Kotlin engine` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

The **time engine** (SPEC §7) is one pure function. For one kid, one pool and one day, it takes the schedule, the parents' grants and the usage segments of every device in the pool, and works out whether the pool is locked, why, how much time is left, and when to lock and look again. The kid devices run it **offline** (SPEC §8): the Android kid app must give exactly the same answer as the server, or a kid would see one number on the phone and the parents another.

So the engine exists three times, and all three must pass the same cases:

- TypeScript: `packages/engine/src/engine.ts` (CARD-003, used by the server and the web app).
- **Kotlin: `android/core-time` (this card)**, used later by the Android kid and parent apps.
- C#: `windows/src/ScreenTime.Core` (a later card).

The cases are the 26 JSON files in `test-vectors/engine/` (format: SPEC §7.4). They are the source of truth: the code changes to match them, never the other way round.

`android/` is one Gradle project (CARD-004). `core-time` is a plain Kotlin JVM library (no Android), so its tests run on the JVM with JUnit 6. It already has `formatDuration` and its 9 tests.

This card adds:

- `Engine.kt`: `evaluate(input: EngineInput): EngineResult`, with small data classes for the input and result. It uses only `java.time` (Android 14 has all of it) and follows `engine.ts` step for step, in epoch milliseconds, so rounding and daylight saving behave exactly the same.
- `EngineVectorsTest.kt`: reads every file in `test-vectors/engine/` and checks every expected field, one JUnit test per file, plus one test that there are at least 26 files.
- The test reads JSON with `kotlinx-serialization-json` 1.11.0, as a **test-only** dependency (only its `JsonElement` API, so no compiler plugin is needed). The engine itself has no dependency.
- `build.gradle.kts` tells the test where the vectors are (`testVectors` system property), and declares the folder as a test input, so a changed vector re-runs the tests.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with 27 engine tests in `core-time` (26 vectors and the file count), and the GitHub Actions **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No change to `test-vectors/`, `packages/` or anything outside `android/`. If a vector fails, the Kotlin code is wrong: report it, do not edit the vector.
- No change to `DurationFormat.kt`, `DurationFormatTest.kt`, `core-model`, `core-ui` or the apps.
- No other new dependency. `kotlinx-serialization-json` is `testImplementation` only; never `implementation`. No kotlinx serialization **plugin**.
- No change to the Gradle wrapper files (`gradlew`, `gradlew.bat`, `gradle/wrapper/`).
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, or any key or token.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, JUnit 6.1.3, Java 17 bytecode. New: `org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0` (test only).

Tools on James's PC (as in CARD-004): Android Studio with the Android SDK (API 37). Every Gradle command runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` in PowerShell with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

Always use `.\gradlew.bat`, never a Gradle you installed yourself.

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Comments use `§` (U+00A7); copy it exactly.

| File | Action |
|---|---|
| `android/gradle/libs.versions.toml` | replace (5.1) |
| `android/core-time/build.gradle.kts` | replace (5.2) |
| `android/core-time/src/main/kotlin/au/screentime/core/time/Engine.kt` | create (5.3) |
| `android/core-time/src/test/kotlin/au/screentime/core/time/EngineVectorsTest.kt` | create (5.4) |

That is 4 files.

### 5.1 `android/gradle/libs.versions.toml`

The only changes: the `kotlinxSerialization` version and the `kotlinx-serialization-json` library.

```toml
[versions]
agp = "9.4.0"
kotlin = "2.4.21"
composeBom = "2026.09.00"
activityCompose = "1.13.0"
junit = "6.1.3"
kotlinxSerialization = "1.11.0"

[libraries]
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
junit-bom = { group = "org.junit", name = "junit-bom", version.ref = "junit" }
junit-jupiter = { group = "org.junit.jupiter", name = "junit-jupiter" }
junit-platform-launcher = { group = "org.junit.platform", name = "junit-platform-launcher" }
kotlinx-serialization-json = { group = "org.jetbrains.kotlinx", name = "kotlinx-serialization-json", version.ref = "kotlinxSerialization" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
```

### 5.2 `android/core-time/build.gradle.kts`

The only changes: the `testImplementation(libs.kotlinx.serialization.json)` line, and the comment and three lines at the end of `tasks.test`. `rootProject` is the `android` folder, so `../test-vectors/engine` is the repo's `test-vectors/engine`.

```kotlin
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.serialization.json)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // The shared engine cases (docs/SPEC.md §7.4), one folder above the Gradle project.
    val vectors = rootProject.file("../test-vectors/engine")
    inputs.dir(vectors)
    systemProperty("testVectors", vectors.absolutePath)
}
```

### 5.3 `android/core-time/src/main/kotlin/au/screentime/core/time/Engine.kt`

The engine. Its steps and their comments match `packages/engine/src/engine.ts` (read it side by side if anything is unclear). Inside, every instant is a `Long` of epoch milliseconds, and used time is rounded **down** to whole seconds with `Math.floorDiv`, exactly as the TypeScript engine does with `Math.floor`.

```kotlin
package au.screentime.core.time

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Why a pool is locked (docs/SPEC.md §7.3). [wire] is the value in the API and the test vectors. */
enum class LockReason(val wire: String) {
    OUT_OF_TIME("out_of_time"),
    BEDTIME("bedtime"),
    BEFORE_WAKE("before_wake"),
}

/** Today's schedule for one pool. [wake] and [bedtime] are "HH:MM"; [bedtime] may be "24:00" (the end of the day). */
data class DaySchedule(val allowanceMin: Int, val wake: String, val bedtime: String)

/** Extra minutes from a parent, negative to take time away. */
data class Grant(val minutes: Int, val createdAt: Instant)

/** Time a device of the pool was in use. [end] null means still open: it is read as `now`. */
data class Segment(val start: Instant, val end: Instant?)

/** Everything the engine needs for one kid, one pool and one local [date] (docs/SPEC.md §7.1). */
data class EngineInput(
    /** The family time zone. */
    val tz: ZoneId,
    val date: LocalDate,
    /** The trusted current instant (docs/SPEC.md §8.5). */
    val now: Instant,
    val day: DaySchedule,
    /** Grants for this kid, pool and date. */
    val grants: List<Grant>,
    /** Segments of ALL devices in the pool. */
    val segments: List<Segment>,
)

data class EngineResult(
    val locked: Boolean,
    val lockReason: LockReason?,
    val remainingSec: Long,
    /** Null when the pool does not lock again before the end of the day. */
    val nextLockAt: Instant?,
    val reevaluateAt: Instant,
    val usedSec: Long,
    val overspendSec: Long,
)

private enum class Period { MORNING, ALLOWED, EVENING }

/**
 * The time engine of docs/SPEC.md §7: the same steps as `packages/engine/src/engine.ts`, and it must pass every case in
 * `test-vectors/engine/`. Instants are epoch milliseconds inside; used time is rounded down to whole seconds.
 */
fun evaluate(input: EngineInput): EngineResult {
    val tz = input.tz

    // Step 1: key instants. Days are found through the time zone, never by adding 24 hours.
    val nowMs = input.now.toEpochMilli()
    val dayStart = input.date.atStartOfDay(tz).toInstant().toEpochMilli()
    val dayEnd = input.date.plusDays(1).atStartOfDay(tz).toInstant().toEpochMilli()
    val wakeAt = localMs(input.date, input.day.wake, tz)
    val bedAt = if (input.day.bedtime == "24:00") dayEnd else localMs(input.date, input.day.bedtime, tz)

    // Step 2: periods. morning = [dayStart, wakeAt), allowed = [wakeAt, bedAt), evening = [bedAt, dayEnd).
    fun periodOf(t: Long): Period = when {
        t < wakeAt -> Period.MORNING
        t < bedAt -> Period.ALLOWED
        else -> Period.EVENING
    }

    // Step 3: used time. Length in seconds of the union of the segments, clipped to [from, to), the day and now.
    fun used(from: Long, to: Long): Long {
        val pieces = input.segments
            .mapNotNull { seg ->
                val start = seg.start.toEpochMilli()
                val end = seg.end?.toEpochMilli() ?: nowMs
                val cs = maxOf(start, from, dayStart)
                val ce = minOf(end, minOf(to, nowMs, dayEnd))
                if (ce > cs) cs to ce else null
            }
            .sortedBy { it.first }
        var totalMs = 0L
        var curStart = 0L
        var curEnd = 0L
        var hasCur = false
        for ((s, e) in pieces) {
            if (!hasCur || s > curEnd) {
                if (hasCur) totalMs += curEnd - curStart
                curStart = s
                curEnd = e
                hasCur = true
            } else {
                curEnd = maxOf(curEnd, e)
            }
        }
        if (hasCur) totalMs += curEnd - curStart
        return Math.floorDiv(totalMs, 1000L)
    }

    val usedMorning = used(dayStart, wakeAt)
    val usedAllowed = used(wakeAt, bedAt)
    val usedEvening = used(bedAt, dayEnd)

    // Step 4: grants belong to the period that contains their createdAt.
    fun grantSec(p: Period): Long =
        input.grants.filter { periodOf(it.createdAt.toEpochMilli()) == p }.sumOf { it.minutes * 60L }

    // Step 5: allowance.
    val allowanceLeft = input.day.allowanceMin * 60L + grantSec(Period.ALLOWED) - usedAllowed

    // Step 6: state, by the period that contains now.
    val locked: Boolean
    val lockReason: LockReason?
    val remainingSec: Long
    var nextLockAtMs: Long?

    val nowPeriod = periodOf(nowMs)
    if (nowPeriod == Period.ALLOWED) {
        remainingSec = maxOf(0L, allowanceLeft)
        locked = allowanceLeft <= 0
        lockReason = if (locked) LockReason.OUT_OF_TIME else null
        nextLockAtMs = if (locked) null else minOf(nowMs + remainingSec * 1000, bedAt)
    } else {
        val morning = nowPeriod == Period.MORNING
        val curfewLeft = grantSec(nowPeriod) - (if (morning) usedMorning else usedEvening)
        remainingSec = maxOf(0L, curfewLeft)
        locked = curfewLeft <= 0
        lockReason = if (!locked) null else if (morning) LockReason.BEFORE_WAKE else LockReason.BEDTIME
        nextLockAtMs = if (locked) {
            null
        } else {
            val t = nowMs + remainingSec * 1000
            if (morning && t >= wakeAt) {
                // The allowed period takes over at wake-up.
                if (allowanceLeft > 0) minOf(wakeAt + allowanceLeft * 1000, bedAt) else wakeAt
            } else {
                t
            }
        }
    }

    // A lock at or after the end of the day is tomorrow's business.
    if (nextLockAtMs != null && nextLockAtMs >= dayEnd) nextLockAtMs = null

    // Step 7: reevaluateAt = the earliest of nextLockAt, the next period boundary and dayEnd.
    var reevaluateAt = dayEnd
    if (nextLockAtMs != null) reevaluateAt = minOf(reevaluateAt, nextLockAtMs)
    if (nowMs < wakeAt && wakeAt < dayEnd) reevaluateAt = minOf(reevaluateAt, wakeAt)
    if (nowMs < bedAt && bedAt < dayEnd) reevaluateAt = minOf(reevaluateAt, bedAt)

    // Step 8: result.
    return EngineResult(
        locked = locked,
        lockReason = lockReason,
        remainingSec = remainingSec,
        nextLockAt = nextLockAtMs?.let(Instant::ofEpochMilli),
        reevaluateAt = Instant.ofEpochMilli(reevaluateAt),
        usedSec = usedMorning + usedAllowed + usedEvening,
        overspendSec = maxOf(0L, -allowanceLeft),
    )
}

/** "date at HH:MM" in the family time zone, as epoch milliseconds. A time skipped by daylight saving moves forward. */
private fun localMs(date: LocalDate, time: String, tz: ZoneId): Long =
    ZonedDateTime.of(date, LocalTime.parse(time), tz).toInstant().toEpochMilli()
```

### 5.4 `android/core-time/src/test/kotlin/au/screentime/core/time/EngineVectorsTest.kt`

One dynamic test per vector file (`@TestFactory`), named `<file>: <case name>`, so a failure says which case broke. Instants are compared as `Instant`, not as text, because the vectors write `+11:00` and the engine works in UTC.

```kotlin
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
```

## 6. Detailed spec

### 6.1 The public API of `core-time` after this card

| Name | What it is |
|---|---|
| `evaluate(input: EngineInput): EngineResult` | the engine (SPEC §7.3) |
| `EngineInput(tz: ZoneId, date: LocalDate, now: Instant, day: DaySchedule, grants: List<Grant>, segments: List<Segment>)` | the inputs (SPEC §7.1) |
| `DaySchedule(allowanceMin: Int, wake: String, bedtime: String)` | `"HH:MM"`; `bedtime` may be `"24:00"` |
| `Grant(minutes: Int, createdAt: Instant)` | minutes may be negative |
| `Segment(start: Instant, end: Instant?)` | `end = null` is still open, read as `now` |
| `EngineResult(locked, lockReason, remainingSec, nextLockAt, reevaluateAt, usedSec, overspendSec)` | the outputs; seconds are `Long`, `nextLockAt` is `null` when there is no lock before the end of the day |
| `LockReason.OUT_OF_TIME` / `BEDTIME` / `BEFORE_WAKE` | `wire` is `"out_of_time"` / `"bedtime"` / `"before_wake"` |
| `formatDuration(seconds: Long): String` | unchanged (CARD-004) |

### 6.2 Things that must match the TypeScript engine exactly

- The day starts and ends at local midnight in `tz`, found with `atStartOfDay(tz)`: on 4 Oct 2026 (clocks forward) the Sydney day is 23 hours, on 5 Apr 2026 (clocks back) it is 25 hours. Never add 24 hours.
- A wake-up or bedtime that daylight saving skips moves forward by the gap (`ZonedDateTime.of` does that, as luxon does in TypeScript).
- Overlapping segments from two devices count once (the union).
- A grant belongs to the period (morning curfew, allowed, evening curfew) that contains its `createdAt`.
- `nextLockAt` at or after the end of the day becomes `null`.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-028-kotlin-engine
   ```
   After the pull, `docs/cards/CARD-028-kotlin-engine.md` and `test-vectors/engine/026-dst-end-day.json` must exist. If one is missing, run `git pull origin main` again, and if it is still missing, stop and ask James.
2. Replace 5.1 and 5.2, and create 5.3. Build:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime\android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :core-time:build
   ```
   Commit: `CARD-028: add the Kotlin time engine`.
3. Create 5.4. Run `.\gradlew.bat :core-time:test`. Commit: `CARD-028: run the engine test vectors in Kotlin`.
4. Run the acceptance checks in section 8.
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Run from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with `JAVA_HOME` set as in section 4.

- [ ] `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran, with no failures. This prints four lines:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.core.time.DurationFormatTest tests="9" failures="0" errors="0"
  au.screentime.core.time.EngineVectorsTest tests="27" failures="0" errors="0"
  au.screentime.core.model.PoolTest tests="3" failures="0" errors="0"
  ```
  (If `PoolTest` has a different count, report what you see: this card does not change it.)
- [ ] Every vector ran by name. This prints `26`:
  ```powershell
  (Select-String -Path core-time\build\test-results\test\TEST-au.screentime.core.time.EngineVectorsTest.xml -Pattern '<testcase name="\d{3}-').Count
  ```
- [ ] The kotlinx library is a test dependency only. This prints `True`:
  ```powershell
  (.\gradlew.bat :core-time:dependencies --configuration runtimeClasspath | Out-String) -notmatch 'kotlinx-serialization'
  ```
- [ ] `git status` (from the repo root) does **not** list `android/local.properties` or anything under `build/`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 4 files (in any order):
  ```
  android/core-time/build.gradle.kts
  android/core-time/src/main/kotlin/au/screentime/core/time/Engine.kt
  android/core-time/src/test/kotlin/au/screentime/core/time/EngineVectorsTest.kt
  android/gradle/libs.versions.toml
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/core-time/src/test/kotlin/au/screentime/core/time/EngineVectorsTest.kt` | There are at least 26 vector files. For each file in `test-vectors/engine/`: `evaluate` gives the expected `locked`, `lockReason`, `remainingSec`, `nextLockAt`, `reevaluateAt`, `usedSec` and `overspendSec`. The cases cover plain allowance, zero allowance, plus and minus grants, a negative grant that locks, two overlapping devices, back-to-back devices, segments crossing wake-up, bedtime and midnight, bedtime and morning grants, an open segment, overspend, wake `00:00`, bedtime `24:00`, and both daylight-saving days in `Australia/Sydney`. |

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-028: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-028-kotlin-engine`
5. Open a PR into `main` titled `CARD-028: core-time Kotlin engine`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-028-kotlin-engine --title "CARD-028: core-time Kotlin engine" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-028-kotlin-engine.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: `DurationFormatTest tests="9"`, `EngineVectorsTest tests="27"`, `PoolTest tests="3"`, all `failures="0"`
   - [x] every vector ran — output: `26`
   - [x] kotlinx is test only — output: `True`
   - [x] local.properties and build/ not tracked
   - [x] Android CI check green
   - [x] only expected files changed — output: 4 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
   Only tick a box if you ran the command and saw that output. If you could not run something, leave the box empty and say why.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first error lines, not the whole log.

Known traps, and what to do:

- **A vector fails** (for example `026-dst-end-day.json: ... expected <...> but was <...>`): the vectors are right. Check that 5.3 is copied exactly, above all `atStartOfDay(tz)`, `Math.floorDiv` and the `>=` in `nextLockAtMs >= dayEnd`. If it still fails, report the exact failure text. Never change a vector or the expected values.
- **`NullPointerException` in `EngineVectorsTest` at `listFiles`**: the test did not get the vectors folder. Check the three `tasks.test` lines of 5.2, and that `test-vectors\engine` exists at the repo root.
- **`Unresolved reference: kotlinx`** in the test: you skipped 5.1, or the `testImplementation(libs.kotlinx.serialization.json)` line in 5.2. Gradle turns the `-` in `kotlinx-serialization-json` into `.` in `libs.kotlinx.serialization.json`.
- **Gradle says the SDK location is not found**: create `android\local.properties` (git-ignored, never commit it) with the one line `sdk.dir=C:/Users/james/AppData/Local/Android/Sdk`, as in CARD-004.
- **`Select-String` prints nothing**: the tests did not run yet; run `.\gradlew.bat assembleDebug test` first. Gradle skips tests that are up to date, but the XML files stay.
- **Temporary files** (the PR body, any helper script) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **Every difference from the card is a deviation**, in any file, including tests, comments and how you ran a check. List each one under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-028. Please review and merge if it is good.

CARD: CARD-028 core-time Kotlin engine
PR: <full PR URL>
Branch: bob/card-028-kotlin-engine
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
