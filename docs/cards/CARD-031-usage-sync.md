# CARD-031: Usage tracking and sync on the kid app

| Field | Value |
|---|---|
| Card | CARD-031 |
| Title | Usage tracking and sync on the kid app |
| Size | M |
| Depends on | CARD-014 (usage and state API), CARD-028 (Kotlin engine), CARD-030 and CARD-030b (setup), all merged to `main` |
| Spec sections | docs/SPEC.md §7, §8.2, §8.3, §8.4, §8.5, §12.1 ("Counting", "Foreground service" and "As built (CARD-031)") |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-031-usage-sync` |
| PR title | `CARD-031: Usage tracking and sync on the kid app` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

After CARD-030 and CARD-030b the kid app can become Device Owner and pair with the family, but then it does nothing. This card makes it **count screen time and sync**:

- A **foreground service** (`service/KidService.kt`) runs all the time once the kid tapped **Yes**. It shows a quiet notification "Screen Time is on" (CARD-032 puts the time left there).
- **Counting** (SPEC §12.1, Q19): time counts while the screen is on and unlocked. A **segment** starts at unlock and ends at screen off. Only timestamps are stored, never a ticking counter. Once a minute the service saves "still in use at …", so a segment left open by a crash or a reboot ends at the last minute it was seen.
- The segments are kept in a small **Room** database (`data/KidDatabase.kt`), the **outbox**: each change is uploaded to `POST /v1/device/usage`, and a row is only marked sent when the server answered.
- **Sync** (SPEC §8.2, §8.3): upload the outbox, then fetch the snapshot `GET /v1/device/state` with the last `ETag` (the server answers 304 when nothing changed). The snapshot is kept in a file, so the device keeps working offline.
- **Trusted time** (SPEC §8.5): the kid cannot cheat by changing the phone's clock. The app takes the server's time from every answer and adds the time since then from `SystemClock.elapsedRealtime()`, which counts from boot and cannot be set.
- After each sync the service runs the **time engine** of CARD-028 on the snapshot plus the device's own segments, and writes the answer to the log. Nothing locks yet: the warnings, the main screen and the block screen come in CARD-032 and CARD-033.

The pure logic (`usage/` and `sync/`) has no Android code, so 4 new JVM test classes check it. Claude ran the exact code of this card against a real local server before writing it: the upload, the snapshot, the 304 and the clock all worked. You test the Android part on the emulator with screen off/on commands and a look at the server's database.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with the new `RecorderTest` (9), `TodayInputTest` (4), `TrustedClockTest` (4) and `SyncerTest` (4); on the emulator the service runs after **Yes**, its notification shows, a screen-on stretch becomes a closed segment on the server, a stretch with the server stopped arrives later marked `recorded_offline`, and the service is running again after a reboot; the two screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No alarms, warnings, main screen, notification text with the time left, block screen or Lock Task (CARD-032, CARD-033).
- No FCM, WebSocket or WorkManager (CARD-034). No tamper events (CARD-039). Do not act on a 401 beyond the log line.
- No change to `core-model`, `core-time`, `core-ui`, `app-parent`, `packages/`, `web/`, `server/` or `docs/`.
- No other new dependency than Room and KSP (5.1) and `ktor-client-mock` for tests (5.3). No new npm package.
- Never run the app on a real phone or tablet in this card, and never install a **release** build anywhere.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, JUnit 6.1.3, CameraX 1.6.0, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36.

New:

| Library or plugin | Version | Why |
|---|---|---|
| `androidx.room:room-runtime` | 2.8.5 | the database (Google's Maven) |
| `androidx.room:room-compiler` | 2.8.5 | generates the database code at build time, through KSP |
| plugin `com.google.devtools.ksp` | 2.3.12 | Kotlin Symbol Processing, which runs `room-compiler` (Maven Central / Gradle plugin portal) |
| `io.ktor:ktor-client-mock` | 3.6.0 | test only: a fake server for `SyncerTest` (already in the version catalog) |

Claude built this exact code in GitHub Actions before writing the card, so these versions resolve and compile.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c31"
New-Item -ItemType Directory -Force $t | Out-Null
```

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7); copy it exactly.

| File | Action |
|---|---|
| `android/gradle/libs.versions.toml` | replace (5.1) |
| `android/build.gradle.kts` | replace (5.2) |
| `android/app-kid/build.gradle.kts` | replace (5.3) |
| `android/app-kid/src/main/AndroidManifest.xml` | replace (5.4) |
| `android/app-kid/src/main/res/drawable/ic_status.xml` | create (5.5) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/sync/TrustedClock.kt` | create (5.6) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/sync/Syncer.kt` | create (5.7) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/usage/Recorder.kt` | create (5.8) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/usage/TodayInput.kt` | create (5.9) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/data/KidDatabase.kt` | create (5.10) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/data/Stores.kt` | create (5.11) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt` | create (5.12) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/BootReceiver.kt` | create (5.13) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt` | replace (5.14) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/usage/FakeSegmentStore.kt` | create (5.15) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/usage/StateFixture.kt` | create (5.16) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/usage/RecorderTest.kt` | create (5.17) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/usage/TodayInputTest.kt` | create (5.18) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/sync/TrustedClockTest.kt` | create (5.19) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/sync/SyncerTest.kt` | create (5.20) |

That is 20 files.

### 5.1 `android/gradle/libs.versions.toml`

The changes: the `room` and `ksp` versions, the two Room library lines and the `ksp` plugin line.

```toml
[versions]
agp = "9.4.0"
kotlin = "2.4.21"
composeBom = "2026.09.00"
activityCompose = "1.13.0"
junit = "6.1.3"
kotlinxSerialization = "1.11.0"
ktor = "3.6.0"
camerax = "1.6.0"
mlkitBarcode = "17.3.0"
room = "2.8.5"
ksp = "2.3.12"

[libraries]
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
junit-bom = { group = "org.junit", name = "junit-bom", version.ref = "junit" }
junit-jupiter = { group = "org.junit.jupiter", name = "junit-jupiter" }
junit-platform-launcher = { group = "org.junit.platform", name = "junit-platform-launcher" }
kotlinx-serialization-json = { group = "org.jetbrains.kotlinx", name = "kotlinx-serialization-json", version.ref = "kotlinxSerialization" }
ktor-client-core = { group = "io.ktor", name = "ktor-client-core", version.ref = "ktor" }
ktor-client-content-negotiation = { group = "io.ktor", name = "ktor-client-content-negotiation", version.ref = "ktor" }
ktor-serialization-kotlinx-json = { group = "io.ktor", name = "ktor-serialization-kotlinx-json", version.ref = "ktor" }
ktor-client-mock = { group = "io.ktor", name = "ktor-client-mock", version.ref = "ktor" }
ktor-client-okhttp = { group = "io.ktor", name = "ktor-client-okhttp", version.ref = "ktor" }
androidx-camera-camera2 = { group = "androidx.camera", name = "camera-camera2", version.ref = "camerax" }
androidx-camera-view = { group = "androidx.camera", name = "camera-view", version.ref = "camerax" }
androidx-camera-mlkit-vision = { group = "androidx.camera", name = "camera-mlkit-vision", version.ref = "camerax" }
mlkit-barcode-scanning = { group = "com.google.mlkit", name = "barcode-scanning", version.ref = "mlkitBarcode" }
androidx-room-runtime = { group = "androidx.room", name = "room-runtime", version.ref = "room" }
androidx-room-compiler = { group = "androidx.room", name = "room-compiler", version.ref = "room" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
```

### 5.2 `android/build.gradle.kts`

The change: the `ksp` plugin line.

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
}
```

### 5.3 `android/app-kid/build.gradle.kts`

The changes: the `ksp` plugin, the comment and two Room lines (`ksp(...)` is not a typo), and `ktor.client.mock` for tests.

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

android {
    namespace = "au.screentime.kid"
    compileSdk = 37

    defaultConfig {
        applicationId = "au.screentime.kid"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            // The Android emulator reaches the developer's PC at 10.0.2.2 (`pnpm dev:server` or docker compose).
            buildConfigField("String", "DEFAULT_SERVER", "\"http://10.0.2.2:8080\"")
        }
        release {
            buildConfigField("String", "DEFAULT_SERVER", "\"https://screentime.gallagherhome.au\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.all {
            it.useJUnitPlatform()
        }
    }
}

dependencies {
    implementation(project(":core-ui"))
    implementation(project(":core-time"))
    implementation(project(":core-model"))
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.ktor.client.okhttp)
    // QR scanning: CameraX with ML Kit's bundled barcode model (no Play services download, docs/SPEC.md §11.3).
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.view)
    implementation(libs.androidx.camera.mlkit.vision)
    implementation(libs.mlkit.barcode.scanning)
    // The usage outbox (docs/SPEC.md §8.3). KSP generates the database code from KidDatabase.kt.
    implementation(libs.androidx.room.runtime)
    ksp(libs.androidx.room.compiler)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.ktor.client.mock)
    testRuntimeOnly(libs.junit.platform.launcher)
}
```

### 5.4 `android/app-kid/src/main/AndroidManifest.xml`

The changes: the comment and five permissions after the camera, the `<service>` and the `BootReceiver` `<receiver>`.

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <!-- Scanning the enrolment QR code. Device Owner grants it, so the kid is never asked (docs/SPEC.md §12.1). -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <!-- The always-on service (docs/SPEC.md §12.1). systemExempted is allowed because the app is Device Owner. -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <!--
        No backup and no device-to-device transfer: the device token must never leave this device
        (docs/SPEC.md §11.2).
    -->
    <application
        android:allowBackup="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:label="Screen Time"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Material.Light.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <!-- The enrolment QR code, screentime://enrol?host=...&code=... (docs/SPEC.md §11.3). -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="screentime" android:host="enrol" />
            </intent-filter>
        </activity>

        <service
            android:name=".service.KidService"
            android:exported="false"
            android:foregroundServiceType="systemExempted" />

        <receiver
            android:name=".service.BootReceiver"
            android:exported="false">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>

        <receiver
            android:name=".admin.KidDeviceAdminReceiver"
            android:exported="true"
            android:permission="android.permission.BIND_DEVICE_ADMIN">
            <meta-data
                android:name="android.app.device_admin"
                android:resource="@xml/device_admin" />
            <intent-filter>
                <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
            </intent-filter>
        </receiver>

    </application>

</manifest>
```

### 5.5 `android/app-kid/src/main/res/drawable/ic_status.xml`

The notification icon.

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The notification icon: a white hourglass on transparent, 24 dp (Android tints it). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M6,2h12v2h-1.2l-4.8,8l4.8,8h1.2v2h-12v-2h1.2l4.8,-8l-4.8,-8h-1.2z" />
</vector>
```

### 5.6 `android/app-kid/src/main/kotlin/au/screentime/kid/sync/TrustedClock.kt`

```kotlin
package au.screentime.kid.sync

/** The server's time at one moment of one boot (docs/SPEC.md §8.5). */
data class ClockAnchor(val serverMs: Long, val elapsedMs: Long, val bootCount: Int)

/** Where [TrustedClock] keeps what it learnt, so it survives a restart of the app. */
interface ClockStore {
    var anchor: ClockAnchor?

    /** The latest trusted time handed out. After a reboot without the server, time never goes back before it. */
    var lastTrustedMs: Long
}

/**
 * Time the kid cannot change by changing the phone's clock (docs/SPEC.md §8.5). After the server has answered once in
 * this boot, it is the server's time plus the time since then on [elapsed], the clock that counts from boot. After a
 * reboot without the server it is the phone's [wall] clock, but never earlier than the last trusted time.
 */
class TrustedClock(
    private val store: ClockStore,
    private val elapsed: () -> Long,
    private val wall: () -> Long,
    private val bootCount: () -> Int,
) {
    /** True when the server has answered since this boot. */
    val isAnchored: Boolean
        @Synchronized get() = store.anchor?.bootCount == bootCount()

    @Synchronized
    fun nowMs(): Long {
        val anchor = store.anchor
        val now = if (anchor != null && anchor.bootCount == bootCount()) {
            anchor.serverMs + (elapsed() - anchor.elapsedMs)
        } else {
            maxOf(wall(), store.lastTrustedMs)
        }
        if (now > store.lastTrustedMs) store.lastTrustedMs = now
        return now
    }

    /** The server said it is [serverMs] now. Its time wins over everything before, even if that was later. */
    @Synchronized
    fun onServerTime(serverMs: Long) {
        store.anchor = ClockAnchor(serverMs, elapsed(), bootCount())
        store.lastTrustedMs = serverMs
    }
}
```

### 5.7 `android/app-kid/src/main/kotlin/au/screentime/kid/sync/Syncer.kt`

```kotlin
package au.screentime.kid.sync

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.UsageSegmentIn
import au.screentime.core.model.api.UsageUpload
import au.screentime.kid.usage.LocalSegment
import au.screentime.kid.usage.SegmentStore
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlin.coroutines.cancellation.CancellationException

/** The last snapshot from `GET /v1/device/state` and its `ETag`. */
data class CachedState(val etag: String?, val state: DeviceState)

/** Where the last snapshot is kept, so the device enforces from it while offline (docs/SPEC.md §8.2). */
interface StateStore {
    fun load(): CachedState?

    fun save(cached: CachedState)
}

/**
 * One sync (docs/SPEC.md §8.2, §8.3): upload every changed segment, then fetch the snapshot with `If-None-Match`.
 * Every answer from the server sets the trusted clock.
 */
class Syncer(
    private val api: ApiClient,
    private val segments: SegmentStore,
    private val states: StateStore,
    private val clock: TrustedClock,
    private val log: (String) -> Unit = {},
) {
    /** True when both steps worked. On false nothing is lost: the segments stay in the outbox. */
    suspend fun sync(): Boolean = try {
        upload()
        fetchState()
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        log("sync failed: $e")
        false
    }

    private suspend fun upload() {
        while (true) {
            val batch = segments.pending(BATCH)
            if (batch.isEmpty()) return
            api.postDeviceUsage(UsageUpload(batch.map { it.segment.toUpload() }))
            for (pending in batch) segments.markSent(pending.segment.id, pending.version)
            if (batch.size < BATCH) return
        }
    }

    private suspend fun fetchState() {
        val cached = states.load()
        val answer = api.getDeviceState(ifNoneMatch = cached?.etag)
        val state = answer.value
        if (state != null) {
            states.save(CachedState(answer.etag, state))
            clock.onServerTime(OffsetDateTime.parse(state.serverTime).toInstant().toEpochMilli())
        } else {
            // 304 Not Modified: no body, so the server time is the Date header.
            val date = answer.date ?: return
            clock.onServerTime(ZonedDateTime.parse(date, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli())
        }
    }

    private companion object {
        /** The most `POST /v1/device/usage` takes in one call. */
        const val BATCH = 500
    }
}

/** The upload form of a segment: ISO 8601 times in UTC. */
fun LocalSegment.toUpload() = UsageSegmentIn(
    id = id,
    startedAt = Instant.ofEpochMilli(startedAtMs).toString(),
    endedAt = endedAtMs?.let { Instant.ofEpochMilli(it).toString() },
    recordedOffline = recordedOffline,
)
```

### 5.8 `android/app-kid/src/main/kotlin/au/screentime/kid/usage/Recorder.kt`

```kotlin
package au.screentime.kid.usage

/**
 * One stretch of time this device was in use (docs/SPEC.md §12.1, "Counting"). [endedAtMs] is null while it is
 * still open. [lastSeenAtMs] is when the app last saw it in use; a segment left open by a crash or a power cut
 * ends there. [recordedOffline] is true when the server could not be reached while it was open (§8.4).
 */
data class LocalSegment(
    val id: String,
    val startedAtMs: Long,
    val endedAtMs: Long?,
    val lastSeenAtMs: Long,
    val recordedOffline: Boolean,
)

/** A segment waiting to be uploaded. [version] goes up with every change, so a change during an upload is sent again. */
data class PendingSegment(val segment: LocalSegment, val version: Int)

/** The device's own segments on disk: the outbox of `POST /v1/device/usage`. */
interface SegmentStore {
    /** The open segment, if there is one. */
    suspend fun open(): LocalSegment?

    /** Saves [segment] (new or changed) and marks it for upload. */
    suspend fun put(segment: LocalSegment)

    /** Moves [LocalSegment.lastSeenAtMs] without marking the segment for upload. */
    suspend fun touch(id: String, atMs: Long)

    /** Segments still open or ended at or after [fromMs]. */
    suspend fun since(fromMs: Long): List<LocalSegment>

    /** Up to [limit] segments with changes the server has not got yet, oldest first. */
    suspend fun pending(limit: Int): List<PendingSegment>

    /** The server has [version] of segment [id]. */
    suspend fun markSent(id: String, version: Int)

    /** Forgets segments that ended before [beforeMs] and were sent. */
    suspend fun prune(beforeMs: Long)
}

/**
 * Turns "unlocked" and "screen off" into segments. Timestamps only, no ticking timers: [tick] once a minute only
 * moves the last-seen time. Every call takes the trusted time from the caller.
 */
class Recorder(private val store: SegmentStore, private val newId: () -> String) {
    /** The kid unlocked the device: a new segment starts. One left open is closed where it was last seen. */
    suspend fun start(atMs: Long) {
        closeOpen()
        store.put(LocalSegment(newId(), atMs, null, atMs, recordedOffline = false))
    }

    /** Still in use at [atMs]. */
    suspend fun tick(atMs: Long) {
        val open = store.open() ?: return
        if (atMs > open.lastSeenAtMs) store.touch(open.id, atMs)
    }

    /** The screen went off (or the device locked): the open segment ends at [atMs]. */
    suspend fun stop(atMs: Long) {
        val open = store.open() ?: return
        val end = maxOf(atMs, open.startedAtMs)
        store.put(open.copy(endedAtMs = end, lastSeenAtMs = maxOf(end, open.lastSeenAtMs)))
    }

    /** After a crash, a reboot or an app update: the open segment ends where it was last seen. */
    suspend fun closeOpen() {
        val open = store.open() ?: return
        store.put(open.copy(endedAtMs = open.lastSeenAtMs))
    }

    /**
     * The server could not be reached: the open segment counts as recorded offline, or when none is open, the newest
     * one the server has not got yet (the sync at screen off failed). A segment the server already has is left as it
     * is. Once offline, always offline.
     */
    suspend fun markOffline() {
        val target = store.open() ?: store.pending(Int.MAX_VALUE).lastOrNull()?.segment ?: return
        if (!target.recordedOffline) store.put(target.copy(recordedOffline = true))
    }
}
```

### 5.9 `android/app-kid/src/main/kotlin/au/screentime/kid/usage/TodayInput.kt`

```kotlin
package au.screentime.kid.usage

import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.Pool
import au.screentime.core.time.DaySchedule
import au.screentime.core.time.EngineInput
import au.screentime.core.time.Grant
import au.screentime.core.time.Segment
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId

/** Start of the family's day that contains [nowMs]. The device's own time zone is never used (docs/SPEC.md §8.5). */
fun dayStartMs(state: DeviceState, nowMs: Long): Long {
    val tz = ZoneId.of(state.family.timezone)
    return Instant.ofEpochMilli(nowMs).atZone(tz).toLocalDate().atStartOfDay(tz).toInstant().toEpochMilli()
}

/**
 * The engine input for this device's pool today (docs/SPEC.md §7.1, §8.2): the schedule, grants and pool segments of
 * the cached snapshot, with this device's own segments from [own] in place of the server's copies of them. When the
 * snapshot is from an earlier day, its grants and segments are left out: a new day starts empty.
 */
fun todayInput(state: DeviceState, own: List<LocalSegment>, nowMs: Long): EngineInput {
    val tz = ZoneId.of(state.family.timezone)
    val now = Instant.ofEpochMilli(nowMs)
    val date = now.atZone(tz).toLocalDate()
    val day = state.schedule.days.first { it.weekday == date.dayOfWeek.value }
    val allowance = if (state.device.pool == Pool.PHONE) day.phoneMin else day.screensMin
    val sameDay = state.today.date == date.toString()

    val grants = if (sameDay) state.today.grants.map { Grant(it.minutes, instant(it.createdAt)) } else emptyList()
    val ownIds = own.map { it.id }.toSet()
    val others = if (sameDay) {
        state.today.poolSegments
            .filter { it.id !in ownIds }
            .map { Segment(instant(it.startedAt), it.endedAt?.let(::instant)) }
    } else {
        emptyList()
    }
    val mine = own.map { Segment(Instant.ofEpochMilli(it.startedAtMs), it.endedAtMs?.let(Instant::ofEpochMilli)) }

    return EngineInput(
        tz = tz,
        date = date,
        now = now,
        day = DaySchedule(allowance, day.wake, day.bedtime),
        grants = grants,
        segments = others + mine,
    )
}

private fun instant(text: String): Instant = OffsetDateTime.parse(text).toInstant()
```

### 5.10 `android/app-kid/src/main/kotlin/au/screentime/kid/data/KidDatabase.kt`

```kotlin
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
```

### 5.11 `android/app-kid/src/main/kotlin/au/screentime/kid/data/Stores.kt`

```kotlin
package au.screentime.kid.data

import android.content.Context
import android.util.AtomicFile
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceState
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
```

### 5.12 `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

```kotlin
package au.screentime.kid.service

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import au.screentime.core.model.api.ApiClient
import au.screentime.core.time.evaluate
import au.screentime.kid.R
import au.screentime.kid.data.FileStateStore
import au.screentime.kid.data.KidDatabase
import au.screentime.kid.data.PrefsClockStore
import au.screentime.kid.data.RoomSegmentStore
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.sync.Syncer
import au.screentime.kid.sync.TrustedClock
import au.screentime.kid.usage.Recorder
import au.screentime.kid.usage.dayStartMs
import au.screentime.kid.usage.todayInput
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The always-on part of the kid app (docs/SPEC.md §12.1, "Foreground service"): records usage segments from the
 * screen and unlock broadcasts, and syncs with the server (§8.3). Everything runs one at a time on [scope], so the
 * database sees one change after another. Alarms, warnings, the real notification text and locking come in later
 * cards; for now every sync writes what the engine says to the log.
 */
class KidService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))

    private lateinit var clock: TrustedClock
    private lateinit var recorder: Recorder
    private lateinit var segments: RoomSegmentStore
    private lateinit var states: FileStateStore
    private lateinit var syncer: Syncer
    private var engine: HttpClientEngine? = null
    private var api: ApiClient? = null
    private var started = false

    /** [SystemClock.elapsedRealtime] of the last sync, for "every 5 minutes" and "if the last sync is older than 2 minutes". */
    private var lastSyncElapsed = 0L
    private var lastSyncOk = true

    private val screen = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val at = clock.nowMs()
            when (intent.action) {
                Intent.ACTION_USER_PRESENT, Intent.ACTION_SCREEN_ON -> scope.launch { onInUse(at) }
                Intent.ACTION_SCREEN_OFF -> scope.launch {
                    recorder.stop(at)
                    sync()
                }
            }
        }
    }

    private val network = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            scope.launch { if (!lastSyncOk) sync() }
        }
    }

    override fun onCreate() {
        super.onCreate()
        // A service started with startForegroundService must call startForeground first, even if it stops at once.
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
        val enrolment = EnrolmentStore(this).load()
        if (enrolment?.confirmed != true) {
            stopSelf()
            return
        }

        clock = TrustedClock(
            store = PrefsClockStore(this),
            elapsed = SystemClock::elapsedRealtime,
            wall = System::currentTimeMillis,
            bootCount = { Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT, 0) },
        )
        segments = RoomSegmentStore(KidDatabase.open(this).segments())
        states = FileStateStore(this)
        recorder = Recorder(segments) { UUID.randomUUID().toString() }
        val http = OkHttp.create()
        val client = ApiClient(enrolment.serverUrl, http, token = { enrolment.deviceToken })
        engine = http
        api = client
        syncer = Syncer(client, segments, states, clock, log = { Log.w(TAG, it) })

        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED)
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(network)
        started = true

        scope.launch {
            // A segment left open by a crash, a reboot or an update ends where it was last seen.
            recorder.closeOpen()
            if (inUse()) recorder.start(clock.nowMs())
            sync()
            while (isActive) {
                delay(MINUTE)
                if (!inUse()) continue
                recorder.tick(clock.nowMs())
                if (SystemClock.elapsedRealtime() - lastSyncElapsed >= 5 * MINUTE) sync()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (started) {
            unregisterReceiver(screen)
            getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(network)
        }
        scope.cancel()
        api?.close()
        engine?.close()
        super.onDestroy()
    }

    /** The screen is on and unlocked: counting (docs/SPEC.md §3, Q19). */
    private fun inUse(): Boolean =
        getSystemService(PowerManager::class.java).isInteractive &&
            !getSystemService(KeyguardManager::class.java).isKeyguardLocked

    private suspend fun onInUse(at: Long) {
        // Screen on without a lock screen, or the unlock after it: only one segment either way.
        if (!inUse() || segments.open() != null) return
        recorder.start(at)
        if (!lastSyncOk || SystemClock.elapsedRealtime() - lastSyncElapsed >= 2 * MINUTE) sync() else report()
    }

    private suspend fun sync() {
        val ok = syncer.sync()
        lastSyncElapsed = SystemClock.elapsedRealtime()
        lastSyncOk = ok
        if (ok) {
            segments.prune(clock.nowMs() - KEEP_DAYS * 24 * 60 * MINUTE)
        } else {
            recorder.markOffline()
        }
        report()
    }

    /** What the engine says now, in the log (`adb logcat -s KidService`). The main screen shows it in CARD-032. */
    private suspend fun report() {
        val cached = states.load() ?: return
        val now = clock.nowMs()
        val own = segments.since(dayStartMs(cached.state, now))
        val result = evaluate(todayInput(cached.state, own, now))
        Log.i(
            TAG,
            "pool=${cached.state.device.pool.wire} used=${result.usedSec}s remaining=${result.remainingSec}s " +
                "locked=${result.locked} online=$lastSyncOk segments=${own.size}",
        )
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Screen Time", NotificationManager.IMPORTANCE_LOW),
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle("Screen Time")
            .setContentText("Screen Time is on")
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "KidService"
        private const val CHANNEL = "status"
        private const val NOTIFICATION_ID = 1
        private const val MINUTE = 60_000L

        /** Sent segments are kept this long, then forgotten (docs/SPEC.md §8.3, offline buffer). */
        private const val KEEP_DAYS = 30L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, KidService::class.java))
        }
    }
}
```

### 5.13 `android/app-kid/src/main/kotlin/au/screentime/kid/service/BootReceiver.kt`

```kotlin
package au.screentime.kid.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import au.screentime.kid.enrol.EnrolmentStore

/** Starts [KidService] after a reboot and after an app update, once the device is enrolled and confirmed. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (EnrolmentStore(context).load()?.confirmed == true) KidService.start(context)
    }
}
```

### 5.14 `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt`

The changes: the `KidService` import, and `KidService.start` in `refresh` (inside the new braces) and in `onConfirm`.

```kotlin
package au.screentime.kid.setup

import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.EnrolRequest
import au.screentime.core.model.api.Platform
import au.screentime.kid.BuildConfig
import au.screentime.kid.admin.Policies
import au.screentime.kid.enrol.Enrolment
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.enrol.cleanCode
import au.screentime.kid.enrol.deviceModel
import au.screentime.kid.enrol.enrolErrorMessage
import au.screentime.kid.enrol.parseEnrolLink
import au.screentime.kid.enrol.serverUrl
import au.screentime.kid.service.KidService
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** One screen of the first-run setup (docs/SPEC.md §16.2, "Setup screen"). */
sealed interface SetupState {
    /** The app is not Device Owner yet: a parent has to finish setup on a computer. */
    data object NotOwner : SetupState

    /** Typing the 6-digit code. [server] is the base URL; [editingServer] shows the address field. */
    data class EnterCode(
        val code: String = "",
        val server: String,
        val serverText: String = "",
        val editingServer: Boolean = false,
        val busy: Boolean = false,
        val error: String? = null,
        val note: String? = null,
    ) : SetupState

    /** The camera is looking for the enrolment QR code. Cancel goes back to [previous]. */
    data class Scanning(val previous: EnterCode) : SetupState

    /** Enrolled; the kid checks the name before the phone is locked down. */
    data class Confirm(val kidName: String) : SetupState

    /** Enrolled and confirmed. The main screen comes in a later card. */
    data class Done(val kidName: String) : SetupState
}

class SetupViewModel(app: Application) : AndroidViewModel(app) {
    private val store = EnrolmentStore(app)

    var state by mutableStateOf(initialState())
        private set

    /** Phone or tablet, for the copy ("This phone belongs to..."). */
    val deviceWord: String =
        if (app.resources.configuration.smallestScreenWidthDp >= 600) "tablet" else "phone"

    private fun initialState(): SetupState {
        val enrolment = store.load()
        return when {
            enrolment?.confirmed == true -> SetupState.Done(enrolment.kidName)
            enrolment != null -> SetupState.Confirm(enrolment.kidName)
            !Policies.isDeviceOwner(getApplication()) -> SetupState.NotOwner
            else -> enterCode()
        }
    }

    private fun enterCode(note: String? = null) =
        SetupState.EnterCode(server = store.lastServer ?: BuildConfig.DEFAULT_SERVER, note = note)

    /** Looks again, for example after a parent ran the adb command while this screen was open. */
    fun refresh() {
        if (state is SetupState.NotOwner) state = initialState()
        if (state is SetupState.Done) {
            Policies.apply(getApplication())
            KidService.start(getApplication())
        }
    }

    fun onCodeChange(text: String) {
        val s = state as? SetupState.EnterCode ?: return
        if (s.busy) return
        state = s.copy(code = cleanCode(text), error = null)
    }

    fun onEditServer() {
        val s = state as? SetupState.EnterCode ?: return
        state = s.copy(editingServer = true, serverText = s.server.removePrefix("https://"), error = null)
    }

    fun onServerTextChange(text: String) {
        val s = state as? SetupState.EnterCode ?: return
        state = s.copy(serverText = text, error = null)
    }

    fun onServerDone() {
        val s = state as? SetupState.EnterCode ?: return
        val url = serverUrl(s.serverText, allowHttp = BuildConfig.DEBUG)
        state = if (url == null) {
            s.copy(error = "That doesn't look like a server address.")
        } else {
            s.copy(server = url, editingServer = false)
        }
    }

    fun onConnect() {
        val s = state as? SetupState.EnterCode ?: return
        if (s.busy || s.code.length != 6 || s.editingServer) return
        connect(s)
    }

    /** "Scan QR code": the camera permission is granted first (the app is Device Owner on this screen). */
    fun onScan() {
        val s = state as? SetupState.EnterCode ?: return
        if (s.busy) return
        Policies.grantRuntimePermissions(getApplication())
        state = SetupState.Scanning(s.copy(editingServer = false, error = null, note = null))
    }

    fun onScanCancel() {
        val s = state as? SetupState.Scanning ?: return
        state = s.previous
    }

    /** The camera could not be used: back to typing the code. */
    fun onScanFailed() {
        val s = state as? SetupState.Scanning ?: return
        state = s.previous.copy(error = "The camera isn't working. Type the code instead.")
    }

    /**
     * A QR code was scanned, or the app was opened with a `screentime://enrol` link (for example from the
     * phone's own camera app, or `adb shell am start` on the emulator). A good link connects at once.
     */
    fun onLink(text: String) {
        val s = when (val current = state) {
            is SetupState.Scanning -> current.previous
            is SetupState.EnterCode -> if (current.busy) return else current
            else -> return
        }
        val link = parseEnrolLink(text, allowHttp = BuildConfig.DEBUG)
        if (link == null) {
            state = s.copy(editingServer = false, error = "That QR code isn't from Screen Time.")
            return
        }
        connect(s.copy(code = link.code, server = link.server, editingServer = false))
    }

    /** Sends the code to [SetupState.EnterCode.server], then asks the kid to confirm the name. */
    private fun connect(s: SetupState.EnterCode) {
        state = s.copy(busy = true, error = null, note = null)
        viewModelScope.launch {
            state = try {
                val enrolment = enrol(s.server, s.code)
                store.lastServer = s.server
                store.save(enrolment)
                SetupState.Confirm(enrolment.kidName)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                s.copy(busy = false, code = "", error = enrolErrorMessage(e.status))
            } catch (e: Exception) {
                s.copy(busy = false, error = enrolErrorMessage(null))
            }
        }
    }

    /** "Yes, that's me": lock the device down and finish. */
    fun onConfirm() {
        val enrolment = store.load() ?: return
        store.save(enrolment.copy(confirmed = true))
        Policies.apply(getApplication())
        KidService.start(getApplication())
        state = SetupState.Done(enrolment.kidName)
    }

    /** "No": forget this enrolment. A parent removes the device in the parent app (it stays listed until then). */
    fun onReject() {
        store.clear()
        state = enterCode(note = "OK. Ask Mum or Dad to remove this $deviceWord in Screen Time, then use a new code.")
    }

    private suspend fun enrol(server: String, code: String): Enrolment {
        val app = getApplication<Application>()
        // The client does not close an engine it was given, so both are closed here.
        OkHttp.create().use { engine ->
            ApiClient(server, engine, token = { null }).use { api ->
                val response = api.postEnrol(
                    EnrolRequest(
                        code = code,
                        platform = Platform.ANDROID,
                        hasCellular = app.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_SUBSCRIPTION),
                        model = deviceModel(Build.MANUFACTURER, Build.MODEL),
                        osVersion = "Android ${Build.VERSION.RELEASE}",
                        appVersion = BuildConfig.VERSION_NAME,
                    ),
                )
                return Enrolment(
                    serverUrl = server,
                    deviceId = response.deviceId,
                    deviceToken = response.deviceToken,
                    kidName = response.kid.name,
                    familyTimezone = response.family.timezone,
                    confirmed = false,
                )
            }
        }
    }
}
```

### 5.15 `android/app-kid/src/test/kotlin/au/screentime/kid/usage/FakeSegmentStore.kt`

Not a test class: an in-memory outbox that the tests use instead of the database.

```kotlin
package au.screentime.kid.usage

/** [SegmentStore] in memory, for tests. */
class FakeSegmentStore : SegmentStore {
    private class Row(var segment: LocalSegment, var version: Int, var sent: Int)

    private val rows = linkedMapOf<String, Row>()

    fun all(): List<LocalSegment> = rows.values.map { it.segment }

    override suspend fun open() = rows.values.map { it.segment }.filter { it.endedAtMs == null }.maxByOrNull { it.startedAtMs }

    override suspend fun put(segment: LocalSegment) {
        val row = rows[segment.id]
        if (row == null) {
            rows[segment.id] = Row(segment, 1, 0)
        } else {
            row.segment = segment
            row.version++
        }
    }

    override suspend fun touch(id: String, atMs: Long) {
        rows[id]?.let { it.segment = it.segment.copy(lastSeenAtMs = atMs) }
    }

    override suspend fun since(fromMs: Long) = all().filter { it.endedAtMs == null || it.endedAtMs >= fromMs }

    override suspend fun pending(limit: Int) = rows.values
        .filter { it.version > it.sent }
        .sortedBy { it.segment.startedAtMs }
        .take(limit)
        .map { PendingSegment(it.segment, it.version) }

    override suspend fun markSent(id: String, version: Int) {
        rows[id]?.let { if (version > it.sent) it.sent = version }
    }

    override suspend fun prune(beforeMs: Long) {
        rows.values.removeAll { row -> row.version == row.sent && (row.segment.endedAtMs ?: Long.MAX_VALUE) < beforeMs }
    }
}
```

### 5.16 `android/app-kid/src/test/kotlin/au/screentime/kid/usage/StateFixture.kt`

Not a test class: a snapshot as the server sends it, for the tests.

```kotlin
package au.screentime.kid.usage

import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceState

/**
 * A snapshot as `GET /v1/device/state` sends it, for tests. The family is in Sydney; every day allows 120 min of
 * Screens and 90 min of Phone from 07:00 to 20:30, except Monday (weekday 1) with 60 min of Phone.
 */
fun stateJson(
    date: String = "2026-10-26",
    pool: String = "phone",
    grants: String = "",
    segments: String = "",
    serverTime: String = "2026-10-26T00:00:00Z",
): String {
    val days = (1..7).joinToString(",") { weekday ->
        val phone = if (weekday == 1) 60 else 90
        """{"weekday":$weekday,"screensMin":120,"phoneMin":$phone,"wake":"07:00","bedtime":"20:30"}"""
    }
    return """
        {
          "serverTime": "$serverTime",
          "stateVersion": "v1",
          "device": {"id": "d1", "name": "Pixel 7", "form": "phone", "pool": "$pool", "hasCellular": true},
          "kid": {"id": "k1", "name": "Alex"},
          "family": {"timezone": "Australia/Sydney", "emergencyNumber": "000", "parentCodeSecret": "ABC"},
          "parents": [],
          "contacts": [],
          "messagePresets": [],
          "schedule": {"version": 1, "warn1Min": 15, "warn2Min": 5, "days": [$days]},
          "today": {"date": "$date", "grants": [$grants], "poolSegments": [$segments]},
          "parentMode": {"active": false, "endsAt": null, "byName": null},
          "pendingRequest": null,
          "activeSos": null
        }
    """.trimIndent()
}

fun state(
    date: String = "2026-10-26",
    pool: String = "phone",
    grants: String = "",
    segments: String = "",
): DeviceState = ApiJson.decodeFromString(stateJson(date, pool, grants, segments))
```

### 5.17 `android/app-kid/src/test/kotlin/au/screentime/kid/usage/RecorderTest.kt`

```kotlin
package au.screentime.kid.usage

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RecorderTest {
    private val store = FakeSegmentStore()
    private var next = 0
    private val recorder = Recorder(store) { "s${++next}" }

    @Test
    fun unlockThenScreenOffMakesOneClosedSegmentToUpload() = runBlocking {
        recorder.start(1_000)
        recorder.stop(61_000)

        assertEquals(listOf(LocalSegment("s1", 1_000, 61_000, 61_000, false)), store.all())
        assertEquals(listOf("s1"), store.pending(10).map { it.segment.id })
        assertNull(store.open())
    }

    @Test
    fun aTickMovesLastSeenButSendsNothing() = runBlocking {
        recorder.start(1_000)
        val sent = store.pending(10).single()
        store.markSent(sent.segment.id, sent.version)

        recorder.tick(61_000)

        assertEquals(61_000, store.open()?.lastSeenAtMs)
        assertTrue(store.pending(10).isEmpty())
    }

    @Test
    fun aSegmentLeftOpenEndsWhereItWasLastSeen() = runBlocking {
        recorder.start(1_000)
        recorder.tick(61_000)

        // The app died without a screen-off; the next unlock is much later.
        recorder.start(500_000)

        assertEquals(LocalSegment("s1", 1_000, 61_000, 61_000, false), store.all()[0])
        assertEquals(LocalSegment("s2", 500_000, null, 500_000, false), store.all()[1])
    }

    @Test
    fun closeOpenAfterARestartUsesLastSeen() = runBlocking {
        recorder.start(1_000)
        recorder.tick(121_000)

        recorder.closeOpen()

        assertEquals(121_000, store.all().single().endedAtMs)
    }

    @Test
    fun offlineStaysOnOnceSet() = runBlocking {
        recorder.start(1_000)
        recorder.markOffline()
        recorder.markOffline()
        recorder.stop(61_000)

        assertEquals(LocalSegment("s1", 1_000, 61_000, 61_000, true), store.all().single())
    }

    @Test
    fun aFailedSyncAtScreenOffMarksTheSegmentThatJustEnded() = runBlocking {
        recorder.start(1_000)
        recorder.stop(61_000)
        val sent = store.pending(10).single()
        store.markSent(sent.segment.id, sent.version)
        recorder.start(100_000)
        recorder.stop(160_000)

        recorder.markOffline()

        assertEquals(listOf(false, true), store.all().map { it.recordedOffline })
    }

    @Test
    fun aFailedSyncLeavesSegmentsTheServerHasAlone() = runBlocking {
        recorder.start(1_000)
        recorder.stop(61_000)
        val sent = store.pending(10).single()
        store.markSent(sent.segment.id, sent.version)

        recorder.markOffline()

        assertEquals(false, store.all().single().recordedOffline)
        assertTrue(store.pending(10).isEmpty())
    }

    @Test
    fun anEndBeforeTheStartIsTheStart() = runBlocking {
        // The trusted clock can step back when the server answers for the first time after a reboot.
        recorder.start(100_000)
        recorder.stop(40_000)

        assertEquals(100_000, store.all().single().endedAtMs)
    }

    @Test
    fun nothingOpenMeansNothingToDo() = runBlocking {
        recorder.tick(1_000)
        recorder.stop(2_000)
        recorder.closeOpen()
        recorder.markOffline()

        assertTrue(store.all().isEmpty())
    }
}
```

### 5.18 `android/app-kid/src/test/kotlin/au/screentime/kid/usage/TodayInputTest.kt`

```kotlin
package au.screentime.kid.usage

import au.screentime.core.time.evaluate
import java.time.Instant
import java.time.LocalDate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

class TodayInputTest {
    /** Monday 26 October 2026, 10:00 in Sydney (UTC+11). */
    private val now = ms("2026-10-25T23:00:00Z")

    private fun ms(text: String) = Instant.parse(text).toEpochMilli()

    @Test
    fun theFamilyDayAndThePoolPickTheAllowance() {
        val phone = todayInput(state(pool = "phone"), emptyList(), now)
        val screens = todayInput(state(pool = "screens"), emptyList(), now)

        assertEquals(LocalDate.parse("2026-10-26"), phone.date)
        assertEquals(60, phone.day.allowanceMin)
        assertEquals(120, screens.day.allowanceMin)
        assertEquals("07:00", phone.day.wake)
        assertEquals("20:30", phone.day.bedtime)
    }

    @Test
    fun ownSegmentsReplaceTheServerCopiesAndOthersStay() {
        val segments = """
            {"id": "mine", "deviceId": "d1", "startedAt": "2026-10-26T09:00:00+11:00", "endedAt": "2026-10-26T09:10:00+11:00"},
            {"id": "tablet", "deviceId": "d2", "startedAt": "2026-10-26T09:30:00+11:00", "endedAt": "2026-10-26T09:40:00+11:00"}
        """
        val grants = """{"id": "g1", "minutes": 15, "createdAt": "2026-10-26T08:00:00+11:00", "byName": "Dad"}"""
        // The server has 10 minutes of "mine"; the device knows it went on to 09:20 and is in use again since 09:50.
        val own = listOf(
            LocalSegment("mine", ms("2026-10-25T22:00:00Z"), ms("2026-10-25T22:20:00Z"), ms("2026-10-25T22:20:00Z"), false),
            LocalSegment("open", ms("2026-10-25T22:50:00Z"), null, ms("2026-10-25T22:59:00Z"), false),
        )

        val input = todayInput(state(grants = grants, segments = segments), own, now)
        val result = evaluate(input)

        assertEquals(3, input.segments.size)
        assertEquals(1, input.grants.size)
        // Used: 20 (mine) + 10 (tablet) + 10 (open, until now) = 40 min of 60 + 15.
        assertEquals(40 * 60L, result.usedSec)
        assertEquals(35 * 60L, result.remainingSec)
        assertFalse(result.locked)
    }

    @Test
    fun aSnapshotFromYesterdayStartsTheDayEmpty() {
        val segments = """{"id": "tablet", "deviceId": "d2", "startedAt": "2026-10-25T09:30:00+11:00", "endedAt": null}"""
        val grants = """{"id": "g1", "minutes": 30, "createdAt": "2026-10-25T08:00:00+11:00", "byName": "Dad"}"""
        val own = listOf(LocalSegment("open", ms("2026-10-25T22:50:00Z"), null, ms("2026-10-25T22:59:00Z"), false))

        val input = todayInput(state(date = "2026-10-25", grants = grants, segments = segments), own, now)

        assertEquals(0, input.grants.size)
        assertEquals(1, input.segments.size)
        assertEquals(50 * 60L, evaluate(input).remainingSec)
    }

    @Test
    fun theDayStartsAtMidnightInTheFamilyZone() {
        assertEquals(ms("2026-10-25T13:00:00Z"), dayStartMs(state(), now))
    }
}
```

### 5.19 `android/app-kid/src/test/kotlin/au/screentime/kid/sync/TrustedClockTest.kt`

```kotlin
package au.screentime.kid.sync

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TrustedClockTest {
    private class MemoryClockStore : ClockStore {
        override var anchor: ClockAnchor? = null
        override var lastTrustedMs: Long = 0
    }

    private val store = MemoryClockStore()
    private var elapsed = 0L
    private var wall = 0L
    private var boot = 1
    private val clock = TrustedClock(store, { elapsed }, { wall }, { boot })

    @Test
    fun beforeTheServerAnswersItIsTheWallClockButNeverGoesBack() {
        wall = 50_000
        assertEquals(50_000, clock.nowMs())

        wall = 20_000
        assertEquals(50_000, clock.nowMs())
        assertFalse(clock.isAnchored)
    }

    @Test
    fun afterTheServerAnswersChangingTheWallClockDoesNothing() {
        elapsed = 1_000
        clock.onServerTime(10_000_000)

        elapsed = 61_000
        wall = 999_999_999

        assertEquals(10_060_000, clock.nowMs())
        assertTrue(clock.isAnchored)
    }

    @Test
    fun afterARebootItIsTheWallClockButNotBeforeTheLastTrustedTime() {
        elapsed = 1_000
        clock.onServerTime(10_000_000)
        elapsed = 61_000
        clock.nowMs()

        boot = 2
        elapsed = 5_000
        wall = 9_000_000

        assertFalse(clock.isAnchored)
        assertEquals(10_060_000, clock.nowMs())
    }

    @Test
    fun theServerWinsEvenWhenThePhoneClockWasAhead() {
        wall = 90_000_000
        assertEquals(90_000_000, clock.nowMs())

        clock.onServerTime(10_000_000)

        assertEquals(10_000_000, clock.nowMs())
    }
}
```

### 5.20 `android/app-kid/src/test/kotlin/au/screentime/kid/sync/SyncerTest.kt`

```kotlin
package au.screentime.kid.sync

import au.screentime.core.model.api.ApiClient
import au.screentime.kid.usage.FakeSegmentStore
import au.screentime.kid.usage.LocalSegment
import au.screentime.kid.usage.stateJson
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncerTest {
    private class MemoryStateStore : StateStore {
        var cached: CachedState? = null

        override fun load() = cached

        override fun save(cached: CachedState) {
            this.cached = cached
        }
    }

    private class MemoryClockStore : ClockStore {
        override var anchor: ClockAnchor? = null
        override var lastTrustedMs: Long = 0
    }

    private val segments = FakeSegmentStore()
    private val states = MemoryStateStore()
    private val clock = TrustedClock(MemoryClockStore(), { 0L }, { 0L }, { 1 })
    private val requests = mutableListOf<HttpRequestData>()

    private fun syncer(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = Syncer(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
        segments,
        states,
        clock,
    )

    private fun MockRequestHandleScope.json(text: String, vararg headers: Pair<String, String>) = respond(
        text,
        HttpStatusCode.OK,
        headersOf(*(headers.map { it.first to listOf(it.second) } + (HttpHeaders.ContentType to listOf("application/json"))).toTypedArray()),
    )

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    private fun ms(text: String) = Instant.parse(text).toEpochMilli()

    @Test
    fun uploadsTheOutboxThenKeepsTheSnapshotAndTheServerTime() = runBlocking {
        segments.put(LocalSegment("11111111-1111-4111-8111-111111111111", ms("2026-10-25T22:00:00Z"), null, ms("2026-10-25T22:00:00Z"), false))
        val sync = syncer { request ->
            when (request.url.encodedPath) {
                "/v1/device/usage" -> json("""{"received":1}""")
                else -> json(stateJson(serverTime = "2026-10-25T23:00:00Z"), HttpHeaders.ETag to "\"v1\"")
            }
        }

        assertTrue(sync.sync())

        assertEquals(
            """{"segments":[{"id":"11111111-1111-4111-8111-111111111111","startedAt":"2026-10-25T22:00:00Z","endedAt":null,"recordedOffline":false}]}""",
            requests[0].bodyText(),
        )
        assertEquals("Bearer device-token", requests[0].headers[HttpHeaders.Authorization])
        assertNull(requests[1].headers[HttpHeaders.IfNoneMatch])
        assertTrue(segments.pending(10).isEmpty())
        assertEquals("\"v1\"", states.cached?.etag)
        assertEquals("Alex", states.cached?.state?.kid?.name)
        assertEquals(ms("2026-10-25T23:00:00Z"), clock.nowMs())
    }

    @Test
    fun aKnownSnapshotIsAskedWithIfNoneMatchAnd304UsesTheDateHeader() = runBlocking {
        val first = syncer { json(stateJson(), HttpHeaders.ETag to "\"v1\"") }
        first.sync()
        requests.clear()
        val second = syncer {
            respond("", HttpStatusCode.NotModified, headersOf(HttpHeaders.Date, "Mon, 26 Oct 2026 01:02:03 GMT"))
        }

        assertTrue(second.sync())

        assertEquals(1, requests.size)
        assertEquals("\"v1\"", requests.single().headers[HttpHeaders.IfNoneMatch])
        assertEquals("\"v1\"", states.cached?.etag)
        assertEquals(ms("2026-10-26T01:02:03Z"), clock.nowMs())
    }

    @Test
    fun aFailedUploadKeepsTheSegmentsForNextTime() = runBlocking {
        segments.put(LocalSegment("11111111-1111-4111-8111-111111111111", 1_000, 61_000, 61_000, false))
        val sync = syncer { respond("", HttpStatusCode.BadGateway) }

        assertFalse(sync.sync())

        assertEquals(1, segments.pending(10).size)
        assertNull(states.cached)
        assertFalse(clock.isAnchored)
    }

    @Test
    fun aChangeDuringTheUploadIsSentAgain() = runBlocking {
        val id = "11111111-1111-4111-8111-111111111111"
        segments.put(LocalSegment(id, 1_000, null, 1_000, false))
        val sync = syncer { request ->
            if (request.url.encodedPath == "/v1/device/usage") {
                // The screen goes off while the open segment is on its way.
                segments.put(LocalSegment(id, 1_000, 61_000, 61_000, false))
                json("""{"received":1}""")
            } else {
                json(stateJson(), HttpHeaders.ETag to "\"v1\"")
            }
        }

        sync.sync()

        assertEquals(61_000L, segments.pending(10).single().segment.endedAtMs)
    }
}
```

## 6. Detailed spec

### 6.1 When things happen

| Event | What the service does |
|---|---|
| Service starts (after **Yes**, app start, boot, app update) | ends a segment left open at its last-seen time; starts a segment if the screen is on and unlocked; syncs |
| Unlock (`USER_PRESENT`), or screen on without a lock screen (`SCREEN_ON`) | starts a segment unless one is open; syncs if the last sync failed or is older than 2 minutes |
| Every minute while in use | saves the last-seen time of the open segment (not uploaded); syncs if the last sync is 5 minutes old |
| Screen off (`SCREEN_OFF`) | ends the open segment; syncs |
| Network back (default network available) | syncs if the last sync failed |
| A sync fails | marks the open segment `recordedOffline` (when none is open, the newest segment the server has not got) |
| A sync works | deletes sent segments that ended more than 30 days ago |
| After every sync, and at an unlock without a sync | runs the engine and logs `pool=... used=...s remaining=...s locked=... online=... segments=...` |

Everything runs one at a time (`Dispatchers.IO.limitedParallelism(1)`), so the database sees one change after another. Times come from the trusted clock.

### 6.2 The outbox

Each row has a `version` that goes up with every change and a `sentVersion`. A sync sends every row with `version > sentVersion` (500 per call), and after the server answered sets `sentVersion` to the version it sent. If the segment changed during the upload (the screen went off), its version is already higher, so it goes out again next time. The open segment is sent with `endedAt: null`; the server keeps the latest `endedAt` and never reopens a closed one (SPEC §9.3).

### 6.3 Trusted time

| Situation | `nowMs()` |
|---|---|
| The server answered since this boot | server time of the last answer + (`elapsedRealtime` now − `elapsedRealtime` then) |
| No answer since this boot (`Settings.Global.BOOT_COUNT` changed) | the phone's clock, but never earlier than the last time handed out |

The server time is the body's `serverTime` on a 200 and the `Date` header on a 304. It always wins, even when the phone's clock was ahead.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-031-usage-sync
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-031-usage-sync.md` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create or replace 5.1 to 5.14. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-031: usage outbox, trusted clock, sync and the kid service`.
3. Create 5.15 to 5.20. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-031: recorder, engine input, clock and sync tests`.
4. Run the acceptance checks in section 8, including the emulator run (8.2).
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints nine lines:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml, app-kid\build\test-results\testDebugUnitTest\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.core.time.DurationFormatTest tests="9" failures="0" errors="0"
  au.screentime.core.time.EngineVectorsTest tests="27" failures="0" errors="0"
  au.screentime.core.model.api.ApiClientTest tests="13" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolLinkTest tests="4" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolRulesTest tests="7" failures="0" errors="0"
  au.screentime.kid.sync.SyncerTest tests="4" failures="0" errors="0"
  au.screentime.kid.sync.TrustedClockTest tests="4" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="9" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```
- [ ] The merged debug manifest has the service and the boot receiver. From `android`, this prints `True` three times:
  ```powershell
  $m = Get-Content app-kid\build\intermediates\merged_manifest\debug\processDebugMainManifest\AndroidManifest.xml -Raw
  $m -match 'android:foregroundServiceType="systemExempted"'
  $m -match 'au.screentime.kid.service.BootReceiver'
  $m -match 'android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED'
  ```

### 8.2 On the emulator

**The emulator.** Use the same emulator as in CARD-030b, with nobody signed in. Remove the app from CARD-030b first (each command prints `Success...`, or an error if there was nothing to remove; both are fine):

```powershell
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
```

`& $adb devices` must list exactly one `emulator-5554   device`. If it says `offline` for more than a minute, use the cold boot steps James gave you for CARD-030b; do not wait longer than 5 minutes.

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored):

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
```

The last line prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Segments` lists the device's segments on the server, with their length in seconds.

```powershell
function Tap-Text([string]$text) {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
  $node = $ui.SelectNodes('//node') | Where-Object { $_.text -eq $text } | Select-Object -First 1
  if (-not $node) { throw "No '$text' on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
  Start-Sleep -Seconds 2
}
function Shot([string]$name) {
  & $adb shell screencap -p /sdcard/shot.png
  & $adb pull /sdcard/shot.png "$t\$name.png" | Out-Null
}
function Open-Link([string]$link) {
  & $adb shell "am start -W -a android.intent.action.VIEW -d '$link' au.screentime.kid"
  Start-Sleep -Seconds 3
}
function Screen-On {
  & $adb shell input keyevent KEYCODE_WAKEUP
  Start-Sleep -Seconds 1
  & $adb shell wm dismiss-keyguard
  Start-Sleep -Seconds 2
}
function Screen-Off {
  & $adb shell input keyevent KEYCODE_SLEEP
  Start-Sleep -Seconds 5
}
function Segments {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select extract(epoch from ended_at - started_at)::int as seconds, ended_at is null as open, recorded_offline from usage_segments order by started_at"
}
```

**The run.** From `android`, one step at a time; check each expected result before the next step. The `Segments` numbers depend on how fast you go; what matters is what the card says about them.

1. Install, make it Device Owner and pair. In a second PowerShell window, from the repo root, with the same `$env:DATABASE_URL`, run `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` and copy the `Emulator link`. Back in the first window:
   ```powershell
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb shell am start -n au.screentime.kid/.MainActivity
   Start-Sleep -Seconds 3
   Open-Link "<the emulator link>"
   Tap-Text "Yes"
   Shot "1-done"
   ```
   The screen says "All set, Alex".
2. The service runs and shows its notification:
   ```powershell
   & $adb shell dumpsys activity services au.screentime.kid | Select-String 'KidService'
   & $adb shell cmd statusbar expand-notifications
   Start-Sleep -Seconds 2
   Shot "2-notification"
   & $adb shell cmd statusbar collapse
   & $adb logcat -d -s KidService:I
   ```
   `Select-String` prints at least one line with `au.screentime.kid/.service.KidService`. `2-notification` shows a notification "Screen Time" / "Screen Time is on" with the hourglass icon. The log has at least one line like `pool=phone used=0s remaining=...s locked=... online=true segments=1` (`locked` and `remaining` depend on the time of day: after bedtime it is `locked=true`, which is fine).
3. One segment. Leave the screen on for 70 seconds, then turn it off:
   ```powershell
   Start-Sleep -Seconds 70
   Screen-Off
   Segments
   ```
   One row: `seconds` 70 or more, `open` f, `recorded_offline` f.
4. A segment while the server is down. Stop the API, use the screen for 70 seconds, turn it off, start the API again, then unlock:
   ```powershell
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env stop api
   Screen-On
   Start-Sleep -Seconds 70
   Screen-Off
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env start api
   Start-Sleep -Seconds 15
   Screen-On
   Start-Sleep -Seconds 10
   Segments
   ```
   Three rows, oldest first: (70 or more, f, f), (70 or more, f, **t**), (empty `seconds`, **t** `open`, f). The second one is the offline segment. If `curl.exe -s http://localhost:8080/health` does not show `"status":"ok"` after the 15 seconds, wait until it does, then do the last three lines again.
5. After a reboot the service runs again:
   ```powershell
   & $adb reboot
   & $adb wait-for-device
   $deadline = (Get-Date).AddMinutes(5)
   do { Start-Sleep -Seconds 10; $b = (& $adb shell getprop sys.boot_completed 2>$null) } until ($b -match '1' -or (Get-Date) -gt $deadline)
   Start-Sleep -Seconds 20
   & $adb shell dumpsys activity services au.screentime.kid | Select-String 'KidService'
   Screen-On
   Start-Sleep -Seconds 10
   Segments
   ```
   `Select-String` again prints a line with `au.screentime.kid/.service.KidService`. `Segments` shows the segment that was open before the reboot as closed now (`open` f), and one new open segment at the end.
6. Undo, so the emulator can be used again:
   ```powershell
   & $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb uninstall au.screentime.kid
   cd ..
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item Env:DATABASE_URL
   ```
   `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success`.

- [ ] Steps 1 to 6 gave the expected results. Paste the `Segments` output of steps 3, 4 and 5 and the `KidService` log lines of step 2 into the handback.
- [ ] The two screenshots exist: `C:\Users\james\OpenCode\Testing\temp\c31\1-done.png` and `2-notification.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 20 files (in any order):
  ```
  android/app-kid/build.gradle.kts
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/data/KidDatabase.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/data/Stores.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/BootReceiver.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/sync/Syncer.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/sync/TrustedClock.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/usage/Recorder.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/usage/TodayInput.kt
  android/app-kid/src/main/res/drawable/ic_status.xml
  android/app-kid/src/test/kotlin/au/screentime/kid/sync/SyncerTest.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/sync/TrustedClockTest.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/usage/FakeSegmentStore.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/usage/RecorderTest.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/usage/StateFixture.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/usage/TodayInputTest.kt
  android/build.gradle.kts
  android/gradle/libs.versions.toml
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/usage/RecorderTest.kt` | Unlock then screen off makes one closed segment to upload. A tick moves last-seen and uploads nothing. A segment left open ends at its last-seen time when the next one starts, or at `closeOpen`. Offline stays on once set. A failed sync at screen off marks the segment that just ended, and never one the server already has. An end before the start is the start. With nothing open, nothing happens. |
| `android/app-kid/src/test/kotlin/au/screentime/kid/usage/TodayInputTest.kt` | The family's weekday and the device's pool pick the allowance. The device's own segments replace the server's copies of them, other devices' segments and the grants stay, and the engine gives the right used and remaining time. A snapshot from yesterday starts the day with no grants and no server segments. The day starts at midnight in the family time zone. |
| `android/app-kid/src/test/kotlin/au/screentime/kid/sync/TrustedClockTest.kt` | Before the server answers it is the wall clock and never goes back. After, changing the wall clock does nothing. After a reboot it is the wall clock, not before the last trusted time. The server wins when the phone was ahead. |
| `android/app-kid/src/test/kotlin/au/screentime/kid/sync/SyncerTest.kt` | The outbox is uploaded with the device token, then the snapshot and its ETag are kept and the clock set from `serverTime`. A known snapshot is asked with `If-None-Match`, and a 304 sets the clock from `Date`. A failed upload keeps the segments and changes nothing else. A change during the upload is sent again. |

The database, the service and the receivers are checked by the emulator run in 8.2, not by unit tests.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-031: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-031-usage-sync`
5. Open a PR into `main` titled `CARD-031: Usage tracking and sync on the kid app`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-031-usage-sync --title "CARD-031: Usage tracking and sync on the kid app" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-031-usage-sync.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: nine suites, SyncerTest 4, TrustedClockTest 4, RecorderTest 9, TodayInputTest 4, all `failures="0"`
   - [x] merged debug manifest — output: `True` three times
   - [x] emulator run steps 1 to 6 — results as expected
   - [x] two screenshots in C:\Users\james\OpenCode\Testing\temp\c31\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 20 files

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

- **Gradle cannot find `com.google.devtools.ksp` or `androidx.room`**: check the internet connection and run the same command again (Maven Central sometimes answers 429: wait a minute). Do not change a version; report the exact error.
- **`ksp(...)` is red in the IDE before the first sync**: that is normal until Gradle has loaded the KSP plugin. Build from PowerShell.
- **No `KidService` line in step 2**: look at `& $adb logcat -d | Select-String 'KidService|ForegroundService|AndroidRuntime'` and paste the first error lines. Do not change the service type.
- **No notification in `2-notification`**: the notification permission is granted when you tap **Yes**. Check `& $adb shell dumpsys package au.screentime.kid | Select-String 'POST_NOTIFICATIONS'` shows `granted=true` and say so in the handback.
- **`Segments` shows no rows in step 3**: the segment is sent at screen off. Check the log (`& $adb logcat -d -s KidService`) for `sync failed`. On the emulator the server is `http://10.0.2.2:8080`: check that `curl.exe -s http://localhost:8080/health` answers on the PC.
- **Step 4 shows `recorded_offline` f for the second row**: paste the full `KidService` log lines of step 4 into the handback. Do not change the code.
- **`wm dismiss-keyguard` does nothing** (the lock screen stays): swipe up with `& $adb shell input swipe 540 1800 540 600` instead and say so under "Deviations".
- **`dpm set-device-owner` says there are accounts, several users, or already provisioned**: use a fresh emulator (Device Manager › **Wipe Data**), do not sign in, and repeat from step 1.
- **`INSTALL_FAILED_TEST_ONLY`**: you left out `-t` in `adb install`.
- **Temporary files** (the PR body, `ui.xml`, the screenshots) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
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
Claude, here is Bob's handback for CARD-031. Please review and merge if it is good.

CARD: CARD-031 Usage tracking and sync on the kid app
PR: <full PR URL>
Branch: bob/card-031-usage-sync
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
