# CARD-038b: SOS fixes on the kid phone

| Field | Value |
|---|---|
| Card | CARD-038b |
| Title | SOS fixes on the kid phone |
| Size | M |
| Depends on | CARD-038 (SOS on the kid phone), merged to `main` |
| Spec sections | docs/SPEC.md §15 ("SOS", "As built (CARD-038)"), §8.3 (sync) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-038b-sos-fixes` |
| PR title | `CARD-038b: SOS fixes on the kid phone` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

CARD-038 built **SOS** on the Android kid app: the red **SOS** button, the countdown, the SOS screen, texts to the parents, a position every 30 seconds, and the end by the kid, a parent or the 2-hour stop. It is merged. Its emulator run found real problems, and Claude has since found their causes:

- **No text ever went.** `SmsManager.divideMessage` (splitting a text into parts) reads the SIM's group id, and Android refuses that without the `READ_PHONE_STATE` permission: `SecurityException: getGroupIdLevel1`. The app did not ask for it. This is not an emulator limitation; a real phone fails the same way. The fix: the manifest asks for `READ_PHONE_STATE`, and Device Owner grants it like the others (the existing `Policies.grantRuntimePermissions`, which also runs at every start of the service, so a phone that already has the app gets it too). The log line now has the whole error, so a failure can be read.
- **During an SOS the phone never synced**, unless the block screen was up. So a new schedule (bedtime) did not arrive, and a parent's end that missed the live channel would only show at the 2-hour stop. The fix: during an SOS the service syncs every 5 minutes while the live channel is open, and at every 30-second tick while it is down.
- **Back online, an SOS waited for the next tick.** The fix: when the network comes back and the SOS still has something to send, the service syncs at once, and that sends it.
- **The card's `SosLog` helper hid most `sos:` lines** (`-s Sos:I Sos:W` shows only warnings), and `Texts` used a sort the emulator refuses. Both are fixed in 8.2.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes; the CARD-038 emulator run, with the fixed helpers, passes in full: the texts go (`sos: texted 1 parent(s)` and the rows in `Texts`), the block screen comes up under the SOS at bedtime, and an SOS started offline reaches the server within a minute of going back online; the eleven screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No other change to the SOS, the screens, or the tests. No parent app, no FCM (CARD-034b), no "caught" screen (CARD-039).
- No change to `core-model`, `core-time`, `core-ui`, `app-parent`, `packages/`, `web/`, `server/` or `docs/`, and no change to any `build.gradle.kts` or `libs.versions.toml`. No new dependency of any kind.
- Never run the app on a real phone or tablet in this card: an SOS on a real phone sends real texts to real people. Never install a **release** build anywhere.
- **Never tap Emergency 000**, on the emulator or anywhere, in this card, and never place a call to an emergency number.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, Room 2.8.5, KSP 2.3.12, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36. No new library.

Claude built this exact code in GitHub Actions before writing the card, so it compiles and the tests pass, and found the text failure's cause on the emulator with a full stack trace.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c38b"
New-Item -ItemType Directory -Force $t | Out-Null
```

**If you are ever stuck inside the block screen on the emulator**, this always gets you out: `& $adb shell am task lock stop`.

## 5. Files

Replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7), `·` (U+00B7), `…` (U+2026), `±` (U+00B1) and `✓` (U+2713); copy them exactly.

| File | Action |
|---|---|
| `android/app-kid/src/main/AndroidManifest.xml` | replace (5.1) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosController.kt` | replace (5.2) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt` | replace (5.3) |

That is 3 files.

### 5.1 `android/app-kid/src/main/AndroidManifest.xml`

Replace the whole file. Compared with `main`: the SOS comment, and `READ_PHONE_STATE` after `SEND_SMS`.

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
    <!-- The short buzz at the second warning on a phone (docs/SPEC.md §16.2). -->
    <uses-permission android:name="android.permission.VIBRATE" />
    <!--
        The call buttons on the block screen (docs/SPEC.md §12.1). Device Owner grants it. Tablets have no phone,
        so it is not required.
    -->
    <uses-permission android:name="android.permission.CALL_PHONE" />
    <uses-feature android:name="android.hardware.telephony" android:required="false" />
    <!--
        SOS (docs/SPEC.md §15): a text to every parent, and the phone's position every 30 seconds, also with the
        screen off. Device Owner grants all five, fine location before background location. Splitting a text into
        parts reads the SIM's group id, which needs READ_PHONE_STATE: without it every text fails.
    -->
    <uses-permission android:name="android.permission.SEND_SMS" />
    <uses-permission android:name="android.permission.READ_PHONE_STATE" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />

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

        <!--
            The block screen (docs/SPEC.md §12.1): its own task, kept out of Recents, pinned with Lock Task while
            the device is locked. Only the app itself opens it.
        -->
        <activity
            android:name=".block.BlockActivity"
            android:exported="false"
            android:excludeFromRecents="true"
            android:launchMode="singleTask"
            android:taskAffinity="au.screentime.kid.block" />

        <service
            android:name=".service.KidService"
            android:exported="false"
            android:foregroundServiceType="systemExempted" />

        <!--
            Stops calls to numbers off the kid's list while blocked (docs/SPEC.md §12.1). Android only uses it once
            the app holds the call redirection role, given with adb when the phone is set up.
        -->
        <service
            android:name=".calls.CallGuard"
            android:exported="true"
            android:permission="android.permission.BIND_CALL_REDIRECTION_SERVICE">
            <intent-filter>
                <action android:name="android.telecom.CallRedirectionService" />
            </intent-filter>
        </service>

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

### 5.2 `android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosController.kt`

Replace the whole file. Compared with `main`: one line in `text()`: `Log.w(TAG, "sos: the text failed", e)`, so the log has the whole error.

```kotlin
package au.screentime.kid.sos

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.SystemClock
import android.telephony.SmsManager
import android.util.Log
import au.screentime.core.model.api.DeviceState
import au.screentime.kid.admin.KidDeviceAdminReceiver
import au.screentime.kid.calls.callablesOf
import au.screentime.kid.status.StatusHub
import au.screentime.kid.sync.TrustedClock
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

private const val TAG = "Sos"

/**
 * The SOS on this phone (docs/SPEC.md §15), for the service: the positions, the texts to the parents, the calls to
 * the server, and the SOS screen through [StatusHub.sos]. Every change goes through one lock, so a news message, a
 * tick and the start never mix.
 */
class SosController(private val context: Context, private val clock: TrustedClock, private val api: SosApi) {
    private val store = SosStore(context)
    private val locator = Locator(context, clock, ::battery)
    private val lock = Mutex()
    private var sos: LocalSos? = store.load()

    /** From the last snapshot: who to text and call, and what to call the kid. */
    private var state: DeviceState? = null

    /** An SOS is on: nothing counts and the service ticks every 30 seconds. */
    val active: Boolean get() = sos?.active == true

    /** Something is still to send for an SOS that has ended. */
    val pending: Boolean get() = sos != null

    /** After a restart of the app: an SOS that was on goes on taking positions. */
    fun resume() {
        if (!active) return
        turnOnLocation()
        locator.start()
    }

    /** The snapshot the service just loaded, with the server's time when it was made. */
    suspend fun onSnapshot(snapshot: DeviceState, serverTimeMs: Long) = lock.withLock {
        state = snapshot
        sos?.let { update(it.checkedAgainst(snapshot.activeSos, serverTimeMs, clock.nowMs())) }
        publish()
    }

    /**
     * The countdown finished (docs/SPEC.md §15 steps 1 to 3): the SOS starts now. The first text waits up to 10
     * seconds for a position, then the server hears about it.
     */
    suspend fun start() = lock.withLock {
        if (active) return@withLock
        var next = startSos(UUID.randomUUID().toString(), clock.nowMs())
        Log.i(TAG, "sos: started")
        update(next)
        turnOnLocation()
        locator.start()
        val fix = locator.fresh()
        if (fix != null) next = next.withFix(fix).copy(startFix = fix)
        text(sosText(kidName(), fix, battery(), clock.nowMs()))
        next = next.textSent(clock.nowMs())
        update(next)
        send()
    }

    /** The kid held **I'm safe**. */
    suspend fun endByKid() = lock.withLock {
        sos?.let { update(it.endedByKid(clock.nowMs())) }
        send()
    }

    /** `sos_ack`, `sos_extended` or `sos_ended` from the live channel. */
    suspend fun onNews(news: SosNews) = lock.withLock {
        val before = sos ?: return@withLock
        val after = before.withNews(news, clock.nowMs())
        if (after.seenBy != before.seenBy) Log.i(TAG, "sos: seen by ${news.byName}")
        if (after.autoStopAtMs != before.autoStopAtMs) Log.i(TAG, "sos: kept on for longer by ${news.byName}")
        update(after)
        send()
    }

    /** Every 30 seconds while an SOS is on, and at each sync while an ended one still has something to send. */
    suspend fun tick() = lock.withLock {
        val now = clock.nowMs()
        sos?.let { current ->
            var next = current.autoStopped(now)
            if (next.active) locator.latest()?.let { next = next.withFix(it) }
            update(next)
        }
        send()
    }

    /** Sends what the server does not have, texts when there is no connection, and finishes an ended SOS. */
    private suspend fun send() {
        var next = sos ?: return
        val now = clock.nowMs()
        val before = next
        next = api.flush(next, now)
        if (before.startReportedAtMs == null && next.startReportedAtMs != null) Log.i(TAG, "sos: sent to the server")
        val sent = before.queue.size - next.queue.size
        if (sent > 0) Log.i(TAG, "sos: $sent position(s) sent")
        if (next.textDue(now)) {
            text(sosText(kidName(), next.lastFix, battery(), now, again = true))
            next = next.textSent(now)
        }
        if (!next.active && !next.endTextSent) {
            Log.i(TAG, "sos: ended by ${next.endedBy?.name?.lowercase()}")
            locator.stop()
            text(sosEndText(kidName(), next))
            next = next.copy(endTextSent = true)
        }
        update(next)
    }

    /** Keeps [next], forgets it once it is [LocalSos.done], and shows it. */
    private fun update(next: LocalSos) {
        sos = next.takeIf { !it.done }
        store.save(sos)
        publish()
    }

    private fun publish() {
        val snapshot = state
        StatusHub.sos.value = if (snapshot == null) {
            null
        } else {
            sos.view(
                parents = callablesOf(snapshot.parents, emptyList()),
                parentNames = snapshot.parents.map { it.displayName },
                emergencyNumber = snapshot.family.emergencyNumber,
            )
        }
    }

    private fun kidName(): String = state?.kid?.name ?: "your kid"

    /** A text to every parent with a mobile; it works without data (docs/SPEC.md §15 step 2). */
    private fun text(message: String) {
        val numbers = state?.parents.orEmpty().mapNotNull { it.phoneE164 }
        if (numbers.isEmpty()) {
            Log.w(TAG, "sos: no parent has a mobile number, so no text")
            return
        }
        try {
            val sms = context.getSystemService(SmsManager::class.java)
            for (number in numbers) sms.sendMultipartTextMessage(number, null, sms.divideMessage(message), null, null)
            Log.i(TAG, "sos: texted ${numbers.size} parent(s)")
        } catch (e: Exception) {
            // No permission, or no SIM: the push and the email still go.
            Log.w(TAG, "sos: the text failed", e)
        }
    }

    /** Device Owner may turn location on, and does for an SOS: the kid may have turned it off. */
    private fun turnOnLocation() {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        if (context.getSystemService(LocationManager::class.java).isLocationEnabled) return
        dpm.setLocationEnabled(KidDeviceAdminReceiver.component(context), true)
        Log.i(TAG, "sos: location turned on")
    }

    private fun battery(): Int? = context.getSystemService(BatteryManager::class.java)
        .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        .takeIf { it in 0..100 }

    /**
     * The phone's position from Android's own location providers (fused, GPS and network), every 30 seconds while
     * an SOS is on. Device Owner keeps location on and grants the permission (docs/SPEC.md §12.1).
     */
    private class Locator(
        private val context: Context,
        private val clock: TrustedClock,
        private val battery: () -> Int?,
    ) {
        private val manager = context.getSystemService(LocationManager::class.java)
        private val listener = LocationListener { offer(it) }
        private var running = false

        /** The newest position and its trusted time. */
        @Volatile
        private var best: Pair<Location, Long>? = null

        fun start() {
            if (running) return
            running = true
            for (provider in providers()) {
                try {
                    manager.getLastKnownLocation(provider)?.let(::offer)
                    manager.requestLocationUpdates(provider, SOS_TICK_MS, 0f, context.mainExecutor, listener)
                } catch (e: SecurityException) {
                    Log.w(TAG, "sos: no location permission")
                }
            }
        }

        fun stop() {
            if (!running) return
            running = false
            manager.removeUpdates(listener)
        }

        /** The newest position, unless it is older than [maxAgeMs]. */
        fun latest(maxAgeMs: Long = 10 * 60_000L): SosFix? {
            val (location, atMs) = best ?: return null
            if (clock.nowMs() - atMs > maxAgeMs) return null
            return SosFix(
                atMs = atMs,
                lat = location.latitude,
                lng = location.longitude,
                accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                batteryPct = battery(),
            )
        }

        /** A position from the last 2 minutes, waiting up to 10 seconds for one. */
        suspend fun fresh(): SosFix? = latest(2 * 60_000L) ?: withTimeoutOrNull(10_000L) {
            var fix: SosFix? = null
            while (fix == null) {
                delay(500)
                fix = latest(2 * 60_000L)
            }
            fix
        }

        private fun offer(location: Location) {
            val ageMs = (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000
            val current = best
            if (current == null || location.elapsedRealtimeNanos > current.first.elapsedRealtimeNanos) {
                best = location to clock.nowMs() - ageMs
                val accuracy = if (location.hasAccuracy()) " ±${location.accuracy.toInt()} m" else ""
                Log.i(TAG, "sos: position from ${location.provider}$accuracy")
            }
        }

        private fun providers(): List<String> =
            listOf(LocationManager.FUSED_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                .filter { manager.allProviders.contains(it) && manager.isProviderEnabled(it) }
    }
}
```

### 5.3 `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

Replace the whole file. Compared with `main`: the network callback also syncs when an SOS still has something to send (with a comment), the loop's comment, and the new `sosOn` branch at the end of the loop's `when`.

```kotlin
package au.screentime.kid.service

import android.app.KeyguardManager
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
import au.screentime.kid.admin.Policies
import au.screentime.kid.block.BlockActivity
import au.screentime.kid.data.FileStateStore
import au.screentime.kid.data.KidDatabase
import au.screentime.kid.data.PrefsClockStore
import au.screentime.kid.data.RoomSegmentStore
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.live.Answer
import au.screentime.kid.live.LiveChannel
import au.screentime.kid.live.answerOf
import au.screentime.kid.live.liveUrl
import au.screentime.kid.live.parentModeNewsOf
import au.screentime.kid.parentmode.CodeSession
import au.screentime.kid.parentmode.ParentModeApi
import au.screentime.kid.parentmode.ParentModeStore
import au.screentime.kid.parentmode.parentModeNow
import au.screentime.kid.sos.SOS_TICK_MS
import au.screentime.kid.sos.SosApi
import au.screentime.kid.sos.SosController
import au.screentime.kid.sos.sosNewsOf
import au.screentime.kid.status.StatusHub
import au.screentime.kid.status.WarningTracker
import au.screentime.kid.status.kidStatus
import au.screentime.kid.status.nextCheckAtMs
import au.screentime.kid.sync.Syncer
import au.screentime.kid.sync.TrustedClock
import au.screentime.kid.usage.Recorder
import au.screentime.kid.usage.dayStartMs
import au.screentime.kid.usage.todayInput
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import java.time.OffsetDateTime
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The always-on part of the kid app (docs/SPEC.md §12.1, "Foreground service"): records usage segments from the
 * screen and unlock broadcasts, syncs with the server (§8.3), and keeps the notification, the warnings and the main
 * screen up to date (§16.2), and shows the block screen while the engine says the device is locked (§12.1). While the
 * block screen can be seen, or the kid waits for an answer to "Ask for more time" or "I'm the parent", or parent mode is
 * on, or an SOS is on, it also keeps the live channel open (§8.3), so a parent's grant or answer shows within
 * seconds. While parent mode is on (§12.3) the device is not blocked and nothing counts. While an SOS is on (§15)
 * nothing counts either, and [SosController] takes a position and sends it every 30 seconds, screen on or off.
 * Everything runs one at a time on [scope], so the database and the parent mode store see one change after another.
 */
class KidService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))

    private lateinit var clock: TrustedClock
    private lateinit var recorder: Recorder
    private lateinit var segments: RoomSegmentStore
    private lateinit var states: FileStateStore
    private lateinit var syncer: Syncer
    private lateinit var notifier: Notifier
    private lateinit var parentStore: ParentModeStore
    private var parentApi: ParentModeApi? = null
    private lateinit var sos: SosController
    private var engine: HttpClientEngine? = null
    private var api: ApiClient? = null
    private var live: LiveChannel? = null
    private var liveJob: Job? = null
    private var started = false

    /** [SystemClock.elapsedRealtime] of the last sync, for "every 5 minutes" and "if the last sync is older than 2 minutes". */
    private var lastSyncElapsed = 0L
    private var lastSyncOk = true

    /**
     * The live channel has news (or just connected), or a screen sent something; the loop syncs, so a sync never runs
     * inside the live channel.
     */
    @Volatile
    private var syncWanted = false

    /** One sync at a time: a slow sync that is failing must not overlap the next one. */
    private val syncLock = Mutex()

    /** The engine said locked at the last run: the block screen is up and nothing counts (docs/SPEC.md §12.1). */
    private var blocked = false

    /** Parent mode was on at the last run: not blocked, and nothing counts (docs/SPEC.md §12.3). */
    private var paused = false

    /** An SOS was on at the last run: nothing counts (docs/SPEC.md §15 step 8). */
    private var sosOn = false

    private val warnings = WarningTracker()

    /** Trusted time of the next warning, lock or new period, so the loop wakes up for it (at least once a minute). */
    private var nextCheckAt = 0L

    /** Wakes the loop early, when an unlock or a sync has moved [nextCheckAt], or the live channel has news. */
    private val wake = Channel<Unit>(Channel.CONFLATED)

    private val screen = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val at = clock.nowMs()
            when (intent.action) {
                Intent.ACTION_USER_PRESENT, Intent.ACTION_SCREEN_ON -> scope.launch { onScreenOn(at) }
                Intent.ACTION_SCREEN_OFF -> scope.launch {
                    recorder.stop(at)
                    sync()
                }
            }
        }
    }

    private val network = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            // Back online: what an SOS still has to send goes at once, not at the next tick.
            scope.launch { if (!lastSyncOk || sos.pending) sync() }
        }
    }

    override fun onCreate() {
        super.onCreate()
        // A service started with startForegroundService must call startForeground first, even if it stops at once.
        notifier = Notifier(this)
        startForeground(Notifier.STATUS_ID, notifier.starting(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
        val enrolment = EnrolmentStore(this).load()
        if (enrolment?.confirmed != true) {
            stopSelf()
            return
        }
        // Again on every start, so an app update gets the policies it added (Lock Task in CARD-033).
        Policies.apply(this)

        clock = TrustedClock(
            store = PrefsClockStore(this),
            elapsed = SystemClock::elapsedRealtime,
            wall = System::currentTimeMillis,
            bootCount = { Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT, 0) },
        )
        parentStore = ParentModeStore(this)
        segments = RoomSegmentStore(KidDatabase.open(this).segments())
        states = FileStateStore(this)
        recorder = Recorder(segments) { UUID.randomUUID().toString() }
        val http = OkHttp.create()
        val client = ApiClient(enrolment.serverUrl, http, token = { enrolment.deviceToken })
        engine = http
        api = client
        parentApi = ParentModeApi(client)
        sos = SosController(this, clock, SosApi(client))
        sos.resume()
        syncer = Syncer(client, segments, states, clock, log = { Log.w(TAG, it) })
        live = LiveChannel(
            engine = http,
            url = liveUrl(enrolment.serverUrl),
            token = { enrolment.deviceToken },
            onNews = { frame ->
                frame?.let(::answerOf)?.let(::onAnswer)
                frame?.let(::parentModeNewsOf)?.let {
                    Log.i(TAG, "parent mode: news active=${it.active}")
                    StatusHub.parentModeNews.value = it
                }
                frame?.let(::sosNewsOf)?.let { news ->
                    scope.launch {
                        sos.onNews(news)
                        report()
                    }
                }
                syncWanted = true
                wake.trySend(Unit)
            },
            log = { Log.i(TAG, "live: $it") },
        )

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
                // While in use, or in parent mode with the screen on, until the next warning, lock, period or end of
                // parent mode (at least once a minute; in parent mode a sync then if the live channel is down, to see
                // a parent end it). Blocked with the screen on, the same while the live channel is open; while it is
                // down, at least every 30 seconds, to see a parent's grant soon. Otherwise a minute. During an SOS, at
                // least every 30 seconds whatever the screen does, and a sync every 5 minutes (every tick while the
                // live channel is down), so a parent's end or a new schedule still arrives.
                val untilNext = (nextCheckAt - clock.nowMs()).coerceIn(SECOND, MINUTE)
                val normal = when {
                    inUse() || (paused && screenOn()) -> untilNext
                    blocked && screenOn() -> if (live?.connected == true) untilNext else minOf(untilNext, BLOCKED_POLL)
                    else -> MINUTE
                }
                val wait = if (sos.active) minOf(normal, SOS_TICK_MS) else normal
                // Woken early: sync if the live channel asked for it, then work out the wait again.
                if (withTimeoutOrNull(wait) { wake.receive() } != null) {
                    if (syncWanted) sync()
                    continue
                }
                if (sos.active) sos.tick()
                when {
                    inUse() -> {
                        recorder.tick(clock.nowMs())
                        if (SystemClock.elapsedRealtime() - lastSyncElapsed >= 5 * MINUTE) sync() else report()
                    }
                    blocked && screenOn() -> if (live?.connected == true) report() else sync()
                    paused && screenOn() -> if (live?.connected == true) report() else sync()
                    sosOn -> {
                        val recent = SystemClock.elapsedRealtime() - lastSyncElapsed < 5 * MINUTE
                        if (live?.connected == true && recent) report() else sync()
                    }
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!started) return START_STICKY
        when (intent?.action) {
            // A screen just sent something (docs/SPEC.md §16.2): sync soon, so the next snapshot shows it.
            ACTION_SYNC -> {
                syncWanted = true
                wake.trySend(Unit)
            }
            ACTION_PARENT_CODE -> {
                val minutes = intent.getIntExtra(EXTRA_MINUTES, 0).takeIf { it > 0 }
                scope.launch { startWithCode(minutes) }
            }
            ACTION_END_PARENT_MODE -> scope.launch { endParentMode() }
            ACTION_SOS_START -> scope.launch {
                sos.start()
                StatusHub.sosCountdown.value = null
                report()
            }
            ACTION_SOS_END -> scope.launch {
                sos.endByKid()
                report()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (started) {
            unregisterReceiver(screen)
            getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(network)
        }
        scope.cancel()
        live?.close()
        api?.close()
        engine?.close()
        super.onDestroy()
    }

    private fun screenOn(): Boolean = getSystemService(PowerManager::class.java).isInteractive

    /**
     * The screen is on and unlocked, not blocked by us, not in parent mode and no SOS: counting (docs/SPEC.md §3, Q19,
     * §12, §15).
     */
    private fun inUse(): Boolean =
        screenOn() && !getSystemService(KeyguardManager::class.java).isKeyguardLocked && !blocked && !paused && !sosOn

    private suspend fun onScreenOn(at: Long) {
        val stale = !lastSyncOk || SystemClock.elapsedRealtime() - lastSyncElapsed >= 2 * MINUTE
        if (blocked || paused || sosOn) {
            // The block screen comes back up through report(); a fresh sync may bring a grant, or the end of parent
            // mode.
            if (stale) sync() else report()
            return
        }
        // Screen on without a lock screen, or the unlock after it: only one segment either way.
        if (!inUse() || segments.open() != null) return
        recorder.start(at)
        if (stale) sync() else report()
    }

    /** A parent answered "Ask for more time": the screens show it for 4 seconds, and a heads-up says it too. */
    private fun onAnswer(answer: Answer) {
        Log.i(TAG, "answer: approved=${answer.approved} minutes=${answer.minutes}")
        StatusHub.answer.value = answer
        notifier.showAnswer(answer)
    }

    /** The parent code was right and a parent picked how long (docs/SPEC.md §12.3): parent mode starts here and now. */
    private suspend fun startWithCode(minutes: Int?) {
        val local = parentStore.load()
        parentStore.save(local.copy(code = CodeSession(UUID.randomUUID().toString(), minutes, clock.nowMs())))
        Log.i(TAG, "parent mode: started with the code for ${minutes?.let { "$it min" } ?: "until ended"}")
        sync()
    }

    /** **End now**, on the main screen or the notification. */
    private suspend fun endParentMode() {
        parentStore.save(parentStore.load().copy(endedAtMs = clock.nowMs(), endReported = false))
        Log.i(TAG, "parent mode: ended on this device")
        sync()
    }

    private suspend fun sync() {
        syncLock.withLock {
            // This sync also brings whatever the live channel announced.
            syncWanted = false
            // What the server must hear about parent mode goes first, so the snapshot after it shows it.
            val local = parentStore.load()
            if (local.pending) parentApi?.let { parentStore.save(it.flush(local, clock.nowMs())) }
            // And whatever an SOS still has to send.
            if (sos.pending) sos.tick()
            val ok = syncer.sync()
            lastSyncElapsed = SystemClock.elapsedRealtime()
            lastSyncOk = ok
            if (ok) {
                segments.prune(clock.nowMs() - KEEP_DAYS * 24 * 60 * MINUTE)
            } else {
                recorder.markOffline()
            }
        }
        report()
    }

    /**
     * Runs the engine and shows what it says: the notification, a warning when one is due (only while in use), the
     * main screen through [StatusHub], the block screen, the live channel, and the log (`adb logcat -s KidService`).
     * Becoming locked ends the open segment; becoming unlocked starts one if the device is in use.
     */
    private suspend fun report() {
        val now = clock.nowMs()
        nextCheckAt = now + MINUTE
        val cached = states.load() ?: return
        val own = segments.since(dayStartMs(cached.state, now))
        val result = evaluate(todayInput(cached.state, own, now))
        val serverTimeMs = OffsetDateTime.parse(cached.state.serverTime).toInstant().toEpochMilli()
        val parentMode = parentModeNow(cached.state.parentMode, serverTimeMs, parentStore.load(), now)
        val status = kidStatus(cached.state, result, now, lastSyncOk, SystemClock.elapsedRealtime(), parentMode)
        sos.onSnapshot(cached.state, serverTimeMs)

        // Counting stops when the device becomes blocked, parent mode starts or an SOS starts, and starts again after
        // all three.
        val wasCounting = !blocked && !paused && !sosOn
        blocked = status.locked
        if (paused != (parentMode != null)) Log.i(TAG, "parent mode: ${if (parentMode != null) "on" else "off"}")
        paused = parentMode != null
        if (sosOn != sos.active) Log.i(TAG, "sos: ${if (sos.active) "on" else "off"}")
        sosOn = sos.active
        val counting = !blocked && !paused && !sosOn
        if (wasCounting && !counting) recorder.stop(now)
        if (!wasCounting && counting && inUse()) recorder.start(now)

        StatusHub.status.value = status
        // The block screen closes itself when StatusHub says unlocked.
        if (blocked && screenOn()) BlockActivity.show(this)
        updateLive(waiting = status.pendingMinutes != null || StatusHub.parentModeAsked.value)
        notifier.showStatus(status, now, StatusHub.sos.value)
        if (status.locked) {
            notifier.cancelWarning()
        } else if (inUse()) {
            warnings.check(status)?.let { notifier.showWarning(status, it) }
        }
        nextCheckAt = nextCheckAtMs(status, now)
        wake.trySend(Unit)
        Log.i(
            TAG,
            "pool=${cached.state.device.pool.wire} used=${result.usedSec}s remaining=${result.remainingSec}s " +
                "left=${status.leftSec}s locked=${status.locked} parentMode=$paused sos=$sosOn online=$lastSyncOk " +
                "segments=${own.size}",
        )
    }

    /**
     * The live channel is open only while the screen is on and something may come: blocked (docs/SPEC.md §8.3),
     * [waiting] for an answer to "Ask for more time" or "I'm the parent", in parent mode (a parent may end it), or
     * during an SOS (a parent's "I'm on it"). Otherwise FCM covers the rest (CARD-034b).
     */
    private fun updateLive(waiting: Boolean) {
        val channel = live ?: return
        val want = screenOn() && (blocked || waiting || paused || sosOn)
        if (want && liveJob == null) {
            Log.i(TAG, "live: started")
            liveJob = scope.launch { channel.run() }
        } else if (!want && liveJob != null) {
            Log.i(TAG, "live: stopped")
            liveJob?.cancel()
            liveJob = null
        }
    }

    companion object {
        private const val TAG = "KidService"
        private const val SECOND = 1_000L
        private const val MINUTE = 60_000L

        /** How often a blocked device with the screen on asks the server for news while the live channel is down. */
        private const val BLOCKED_POLL = 30_000L

        /** Sent segments are kept this long, then forgotten (docs/SPEC.md §8.3, offline buffer). */
        private const val KEEP_DAYS = 30L

        private const val ACTION_SYNC = "au.screentime.kid.action.SYNC"
        private const val ACTION_PARENT_CODE = "au.screentime.kid.action.PARENT_CODE"
        private const val EXTRA_MINUTES = "minutes"

        /** **End now** in the notification uses it too. */
        const val ACTION_END_PARENT_MODE = "au.screentime.kid.action.END_PARENT_MODE"

        private const val ACTION_SOS_START = "au.screentime.kid.action.SOS_START"
        private const val ACTION_SOS_END = "au.screentime.kid.action.SOS_END"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, KidService::class.java))
        }

        /** From a screen of the app, which is in front: sync as soon as the service can. */
        fun syncSoon(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_SYNC))
        }

        /** After a right parent code: parent mode for [minutes], or until ended when null. */
        fun startParentMode(context: Context, minutes: Int?) {
            context.startService(
                Intent(context, KidService::class.java)
                    .setAction(ACTION_PARENT_CODE)
                    .putExtra(EXTRA_MINUTES, minutes ?: 0),
            )
        }

        /** **End now** on the main screen. */
        fun endParentMode(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_END_PARENT_MODE))
        }

        /** The SOS countdown finished: the SOS starts (docs/SPEC.md §15). */
        fun startSos(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_SOS_START))
        }

        /** The kid held **I'm safe**. */
        fun endSos(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_SOS_END))
        }
    }
}
```

## 6. Detailed spec

Nothing the kid sees changes. What changes:

| Event | Before | Now |
|---|---|---|
| A text to the parents | `sos: the text failed: SecurityException`, no text | `sos: texted 1 parent(s)`, and the text is in the emulator's sent messages |
| A text fails for another reason | `sos: the text failed: <class name>` | `sos: the text failed` with the whole error and stack trace under it |
| 30-second tick during an SOS, block screen not up | Only the position goes up | Also a sync if the live channel is down, or if the last sync was 5 minutes ago or more; otherwise a report line |
| The network comes back during an SOS that has something to send | Waits for the next tick (up to 30 s) | A sync at once, which sends it first |

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-038b-sos-fixes
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-038b-sos-fixes.md` must exist and `android/app-kid/src/main/kotlin/au/screentime/kid/sos/Sos.kt` too (from CARD-038). If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Replace 5.1 to 5.3. Build and test:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat assembleDebug test
   cd ..
   ```
   Commit: `CARD-038b: SOS fixes on the kid phone`.
3. Run the acceptance checks in section 8, including the emulator run (8.2), in this session.
4. Push and open the PR (section 10).
5. Wait for the CI check to finish (`gh pr checks <number> --watch`).
6. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback. The throwaway `local-dev-only-…` values below are fine, and so are the made-up phone number `+61412345678` and the emulator's position.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints sixteen lines:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml, app-kid\build\test-results\testDebugUnitTest\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.core.time.DurationFormatTest tests="9" failures="0" errors="0"
  au.screentime.core.time.EngineVectorsTest tests="27" failures="0" errors="0"
  au.screentime.core.model.api.ApiClientTest tests="13" failures="0" errors="0"
  au.screentime.kid.ask.SenderTest tests="5" failures="0" errors="0"
  au.screentime.kid.calls.CallsTest tests="5" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolLinkTest tests="4" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolRulesTest tests="7" failures="0" errors="0"
  au.screentime.kid.live.LiveTest tests="7" failures="0" errors="0"
  au.screentime.kid.parentmode.ParentModeTest tests="9" failures="0" errors="0"
  au.screentime.kid.sos.SosTest tests="9" failures="0" errors="0"
  au.screentime.kid.status.KidStatusTest tests="12" failures="0" errors="0"
  au.screentime.kid.status.WarningTrackerTest tests="5" failures="0" errors="0"
  au.screentime.kid.sync.SyncerTest tests="4" failures="0" errors="0"
  au.screentime.kid.sync.TrustedClockTest tests="4" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="10" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```

### 8.2 On the emulator

Run every step below **in this session**, and paste the **real terminal output** of each step into the handback. A summary is not accepted, and neither is "run earlier in this session" for output you no longer have. If your context was summarised partway through, run the steps again from step 1.

**Run the steps one after another, without long breaks**, exactly as written. In CARD-038 the steps were run with half an hour between some of them, and with extra checks in between; that made the results hard to read. If you want to look at something extra, do it, but never run `SosLog` or `& $adb logcat -c` outside the steps: they clear the log that the next step reads. Paste any extra command you ran, with its output, under "Deviations".

The emulator has a pretend SIM, so it can "send" texts: they go nowhere, but Android keeps them in its list of sent messages, which `Texts` below prints. **Never do this run on a real phone.**

**The emulator.** Use the same emulator as in CARD-038, with nobody signed in. Remove the app from CARD-038 first (each command prints `Success...`, or an error if there was nothing to remove; both are fine), keep the screen from turning off by itself for 30 minutes, make sure Wi-Fi and mobile data are on, and put the emulator in Sydney:

```powershell
& $adb shell am task lock stop
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
& $adb shell svc wifi enable
& $adb shell svc data enable
& $adb emu geo fix 151.2093 -33.8688
```

`geo fix` prints `OK`. `& $adb devices` must list exactly one `emulator-5554   device`. If it says `offline` for more than a minute, use the cold boot steps James gave you for CARD-030b; do not wait longer than 5 minutes. If `uninstall` fails with `DELETE_FAILED_INTERNAL_ERROR` and `remove-active-admin` with a `SecurityException` (the app is still Device Owner), wipe the emulator (Device Manager › **Wipe Data**), cold boot it, and run the commands above again. That is not a deviation, but say that you did it under "Outside the repo".

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). `dev-sos.ts` and `dev-contacts.ts` sign a parent token with `JWT_SECRET`, so `$env:JWT_SECRET` must be the same value as in `deploy\.env`:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
pnpm --filter @screentime/server exec tsx scripts/dev-contacts.ts Alex +61412345678
```

`seed-dev.ts` prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` `dev-contacts.ts` gives Dad the mobile number `+61412345678` (made up), so the SOS texts go to it. If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

Do the run between 6 am and 10 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Tap-Text` taps the words on the screen (with a package, only words of that app). `Tap-Desc` taps, and `Hold-Desc` presses and holds for 2.6 seconds, the thing on the screen whose description (what a screen reader says) is the given text. `Sos` runs `dev-sos.ts` for Alex: `Sos show`, `Sos seen`, `Sos end`. `SosLog` prints the app's `sos:` log lines and its last report line **since the last `SosLog`**, then clears the log. `Wait-Log` waits until a log line with the given words shows up (it does not clear the log). `Texts` prints the texts the emulator has sent, newest first. `Emails` prints the server's SOS emails (with no email set up, the server only logs them). `Wait-Unblocked` and `Wait-Blocked` wait until the block screen goes or comes back. `Top` prints the screen in front.

```powershell
function Find-Node([string]$attribute, [string]$value) {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
  $node = $ui.SelectNodes('//node') | Where-Object { $_.GetAttribute($attribute) -eq $value } | Select-Object -First 1
  if (-not $node) { throw "No '$value' on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  @([int](($b[0] + $b[2]) / 2), [int](($b[1] + $b[3]) / 2))
}
function Tap-Text([string]$text, [int]$wait = 2, [string]$package = "") {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
  $node = $ui.SelectNodes('//node') | Where-Object { $_.text -eq $text -and (-not $package -or $_.package -eq $package) } | Select-Object -First 1
  if (-not $node) { throw "No '$text' on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
  Start-Sleep -Seconds $wait
}
function Tap-Desc([string]$desc) {
  $p = Find-Node "content-desc" $desc
  & $adb shell input tap $p[0] $p[1]
}
function Hold-Desc([string]$desc) {
  $p = Find-Node "content-desc" $desc
  & $adb shell input swipe $p[0] $p[1] $p[0] $p[1] 2600
}
function Shot([string]$name) {
  & $adb shell screencap -p /sdcard/shot.png
  & $adb pull /sdcard/shot.png "$t\$name.png" | Out-Null
}
function Open-Link([string]$link) {
  & $adb shell "am start -W -a android.intent.action.VIEW -d '$link' au.screentime.kid"
  Start-Sleep -Seconds 3
}
function Open-App {
  & $adb shell am start -n au.screentime.kid/.MainActivity | Out-Null
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
function Bedtime([int]$minutes, [int]$allowance = 720) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-bedtime.ts Alex $minutes $allowance
}
function Sos([string]$action) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-sos.ts Alex $action
}
function SosLog {
  $lines = & $adb logcat -d -s Sos:I KidService:I
  $lines | Select-String 'sos:' | ForEach-Object { $_.Line.Trim() }
  $lines | Select-String 'pool=' | Select-Object -Last 1 | ForEach-Object { $_.Line.Trim() }
  & $adb logcat -c
}
function Wait-Log([string]$words, [int]$max = 90) {
  $start = Get-Date
  do {
    Start-Sleep -Seconds 2
    $hit = & $adb logcat -d -s Sos:I | Select-String -SimpleMatch $words | Select-Object -First 1
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($hit -or $seconds -gt $max)
  if ($hit) { "'$words' after {0:N0} s" -f $seconds } else { "No '$words' after $max s" }
}
function Texts {
  & $adb shell content query --uri content://sms --projection address:type:body
}
function Emails {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api | Select-String 'alert for'
}
function Top {
  & $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
}
function Wait-Unblocked([int]$max = 45) {
  $start = Get-Date
  do {
    Start-Sleep -Milliseconds 500
    $top = (& $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1).Line
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($top -notmatch 'BlockActivity' -or $seconds -gt $max)
  if ($top -match 'BlockActivity') { "Still blocked after $max s" } else { "Unblocked after {0:N0} s" -f $seconds }
}
function Wait-Blocked([int]$max = 45) {
  $start = Get-Date
  do {
    Start-Sleep -Milliseconds 500
    $top = (& $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1).Line
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($top -match 'BlockActivity' -or $seconds -gt $max)
  if ($top -match 'BlockActivity') { "Blocked after {0:N0} s" -f $seconds } else { "Still not blocked after $max s" }
}
$sosButton = "SOS. Press and hold for 2 seconds."
$safeButton = "Hold: I'm safe. Press and hold for 2 seconds."
```

In the texts below, `<lat>,<lng>` is the emulator's position with 5 decimals, for example `-33.86880,151.20930`; the last digit may differ a little. `(±N m)` may be missing if the emulator gives no accuracy, and `Battery N%.` if it gives no battery level; both are fine.

**The run.** From `android`, one step at a time; check each expected result before the next step.

1. Install, make it Device Owner, and pair. In a second PowerShell window, from the repo root, with the same `$env:DATABASE_URL`, run `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` and copy the `Emulator link`. Back in the first window:
   ```powershell
   Bedtime 60
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb shell cmd role add-role-holder android.app.role.CALL_REDIRECTION au.screentime.kid
   & $adb logcat -c
   Open-App
   Open-Link "<the emulator link>"
   Tap-Text "Yes"
   Start-Sleep -Seconds 10
   Shot "1-home"
   & $adb shell dumpsys package au.screentime.kid | Select-String '(SEND_SMS|READ_PHONE_STATE|_LOCATION): granted'
   ```
   `1-home` shows the main screen as in CARD-037 ("Hi Alex", the ring, **Ask for more time**, **Message Dad**, **I'm the parent**) and the red **SOS** circle in the top right corner, not on top of "Hi Alex". The `dumpsys` line prints five lines, one each for `android.permission.SEND_SMS`, `READ_PHONE_STATE`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` and `ACCESS_BACKGROUND_LOCATION`, each with `granted=true`.
2. A tap only shows the hint:
   ```powershell
   Tap-Desc $sosButton
   Start-Sleep -Milliseconds 700
   Shot "2-tap-hint"
   Start-Sleep -Seconds 4
   Top
   ```
   `2-tap-hint` shows the main screen with the message "Hold the SOS button for 2 seconds" near the bottom. `Top` shows `au.screentime.kid/.MainActivity`: no countdown.
3. Hold, then **Cancel**: nothing is sent. Run the first two lines **together, in one go**, so **Cancel** is tapped within the 5 seconds:
   ```powershell
   Hold-Desc $sosButton; Tap-Text "Cancel" 2
   Start-Sleep -Seconds 8
   Shot "3-cancelled"
   SosLog
   Sos show
   ```
   `3-cancelled` shows the main screen as in `1-home`. `SosLog` prints no `sos:` line, only the report line, with `sos=false`. `Sos show` fails with `Error: Alex has never sent an SOS` (that is the expected result here).
4. Hold, and let the countdown run out:
   ```powershell
   Hold-Desc $sosButton; Start-Sleep -Seconds 1; Shot "4-countdown"
   Start-Sleep -Seconds 20
   Shot "5-sos-on"
   SosLog
   Sos show
   Texts
   Emails
   ```
   `4-countdown` shows the full-screen red countdown: "SOS", "Sending in", a big 4 or 3, the line about the alert, and the white **Cancel**. `5-sos-on` shows the dark red SOS screen: "SOS is on", "Sent to Dad. They can see where you are.", a call button for Dad, **Emergency 000**, and the white **Hold: I'm safe**. `SosLog` has, in this order, `sos: started`, a `sos: position from …` line, `sos: texted 1 parent(s)`, `sos: sent to the server`, and `sos: on` (from `KidService`), and **no** `sos: the text failed`; the last line has `sos=true` and `used=<U>s`: write down `<U>`. `Sos show` prints `Alex's SOS is active; seen by nobody; N position(s), …` with N 1 or 2, and `Last position: <lat>,<lng> …`. `Texts` prints a row with `address=+61412345678, type=2, body=SOS from Alex. Location: https://maps.google.com/?q=<lat>,<lng> (±N m). Battery N%.` (`type=2` means sent). `Emails` prints a line with `SMTP not configured: alert for dad@example.com: SOS from Alex`.
5. Positions keep going up, and nothing counts:
   ```powershell
   & $adb emu geo fix 151.2100 -33.8700
   Start-Sleep -Seconds 65
   SosLog
   Sos show
   ```
   `SosLog` has at least one `sos: 1 position(s) sent`. If it has a report line, that line has `sos=true` and the **same** `used=<U>s` as in step 4. `Sos show` prints `2 position(s)` or more, and `Last position: -33.87000,151.21000 …`.
6. Dad says "I'm on it":
   ```powershell
   Sos seen
   Start-Sleep -Seconds 5
   Shot "6-seen"
   & $adb shell cmd statusbar expand-notifications
   Start-Sleep -Seconds 2
   Shot "7-notification"
   & $adb shell cmd statusbar collapse
   Start-Sleep -Seconds 1
   SosLog
   ```
   `Sos seen` prints `Dad is on it (Alex).` `6-seen` shows the SOS screen with the green "✓ Dad has seen your SOS". `7-notification` shows the app's notification "SOS is on", "Dad has seen your SOS", with no countdown. `SosLog` has `sos: seen by Dad`.
7. Bedtime during the SOS: the SOS screen stays in front:
   ```powershell
   Bedtime 60 0
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 10
   Shot "8-sos-over-block"
   Top
   SosLog
   ```
   `dev-bedtime.ts` changes the database only, so the phone hears about it at its next sync: turning the screen off and on makes one. `8-sos-over-block` shows the SOS screen as in `6-seen` (not the block screen's "Out of Phone time"). `Top` shows `au.screentime.kid/.block.BlockActivity` (the block screen is up, under the SOS). The last `SosLog` line has `locked=true` and `sos=true`.
8. **Hold: I'm safe**:
   ```powershell
   Hold-Desc $safeButton
   Start-Sleep -Seconds 10
   Shot "9-safe-blocked"
   SosLog
   Sos show
   Texts
   ```
   `9-safe-blocked` shows the block screen ("Out of Phone time", **Ask for more time**, **Message Dad**, **Emergency 000**, **I'm the parent**) with the red **SOS** circle at the right of the clock. `SosLog` has `sos: ended by kid`, `sos: texted 1 parent(s)` and `sos: off`; the last line has `locked=true` and `sos=false`. `Sos show` prints `Alex's SOS is ended, ended by kid; seen by Dad; …`. The newest `Texts` row has `body=Alex is safe: SOS ended. Last location: https://maps.google.com/?q=-33.87000,151.21000 …`.
9. A new SOS from the main screen; Dad ends it from his phone:
   ```powershell
   Bedtime 60
   Wait-Unblocked
   Hold-Desc $sosButton
   Start-Sleep -Seconds 20
   SosLog
   Sos end
   Start-Sleep -Seconds 10
   Shot "10-ended-by-dad"
   SosLog
   Sos show
   Texts
   ```
   `Wait-Unblocked` prints `Unblocked after N s`. The first `SosLog` has `sos: started`, `sos: sent to the server` and `sos: on`. `Sos end` prints `Dad ended the SOS (Alex).` `10-ended-by-dad` shows the main screen as in `1-home`. The second `SosLog` has `sos: ended by parent`, `sos: texted 1 parent(s)` and `sos: off`. `Sos show` prints `Alex's SOS is ended, ended by parent (Dad); …`. The newest `Texts` row has `body=Alex's SOS was ended by Dad. Last location: …`.
10. An SOS with no internet, then back online:
    ```powershell
    & $adb shell svc wifi disable
    & $adb shell svc data disable
    Start-Sleep -Seconds 5
    Hold-Desc $sosButton
    Start-Sleep -Seconds 25
    Shot "11-offline"
    SosLog
    Sos show
    & $adb shell svc wifi enable
    & $adb shell svc data enable
    Wait-Log "sent to the server" 120
    Start-Sleep -Seconds 3
    SosLog
    Sos show
    Hold-Desc $safeButton
    Start-Sleep -Seconds 10
    SosLog
    Texts
    ```
    `11-offline` shows the SOS screen with "No internet. We texted Dad where you are." The first `SosLog` has `sos: started` and `sos: texted 1 parent(s)`, and **no** `sos: sent to the server`. The first `Sos show` still prints the step 9 SOS (`… is ended, ended by parent (Dad); …`): the server has not heard of the new one. `Wait-Log` prints `'sent to the server' after N s` with N **60 or less**. The second `Sos show` prints `Alex's SOS is active; …`. The last `SosLog` has `sos: ended by kid` and `sos: off`. `Texts` now has, newest first: `Alex is safe: SOS ended. …`, `SOS from Alex. …`, `Alex's SOS was ended by Dad. …`, `SOS from Alex. …`, `Alex is safe: SOS ended. …`, `SOS from Alex. …`: six rows, all `address=+61412345678, type=2`.
11. Undo, so the emulator can be used again:
    ```powershell
    & $adb shell svc wifi enable
    & $adb shell svc data enable
    & $adb shell am task lock stop
    & $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
    & $adb uninstall au.screentime.kid
    & $adb shell settings put system screen_off_timeout 60000
    cd ..
    docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
    Remove-Item Env:DATABASE_URL
    Remove-Item Env:JWT_SECRET
    ```
    `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success`.

- [ ] Steps 1 to 11 gave the expected results, run in this session. Paste the real output of every command in steps 1 to 10 into the handback (the `dumpsys`, `Bedtime`, `Sos`, `SosLog`, `Texts`, `Emails`, `Top`, `Wait-Log`, `Wait-Unblocked` lines).
- [ ] The eleven screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c38b\`: `1-home.png`, `2-tap-hint.png`, `3-cancelled.png`, `4-countdown.png`, `5-sos-on.png`, `6-seen.png`, `7-notification.png`, `8-sos-over-block.png`, `9-safe-blocked.png`, `10-ended-by-dad.png`, `11-offline.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 3 files (in any order):
  ```
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/sos/SosController.kt
  ```

## 9. Tests

No test changes: `SosTest` (9 tests) is as in CARD-038 and must still pass. The three fixes are checked by the emulator run in 8.2: the texts (steps 4, 8, 9 and 10), the sync during an SOS (step 7) and the send when the network comes back (step 10).

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit (step 2). Message format: `CARD-038b: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-038b-sos-fixes`
5. Open a PR into `main` titled `CARD-038b: SOS fixes on the kid phone`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-038b-sos-fixes --title "CARD-038b: SOS fixes on the kid phone" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-038b-sos-fixes.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: sixteen suites, SosTest 9, all `failures="0"`
   - [x] emulator run steps 1 to 11 — results as expected
   - [x] eleven screenshots in C:\Users\james\OpenCode\Testing\temp\c38b\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 3 files

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

- **Step 1: no SOS button in `1-home`**: the app thinks the emulator has no SIM. Paste `& $adb shell getprop gsm.sim.state` and `& $adb logcat -d -s KidService:I | Select-Object -Last 5`, and stop there.
- **Step 1: a permission shows `granted=false`, or is missing**: paste the `dumpsys` output and `& $adb logcat -d -s Policies:W | Select-Object -Last 10`, and stop there.
- **Step 3: `Tap-Text` says `No 'Cancel' on screen`, or the SOS started**: the countdown ran out before the tap. Paste `SosLog`, end the SOS with `Hold-Desc $safeButton`, wait 10 seconds, and run step 3 once more. If it happens again, say so under "Deviations" and go on with step 4 (in that case `Sos show` in step 4 prints the newer SOS and the counts may be one higher; say so).
- **`Hold-Desc` or `Tap-Desc` says `No '…' on screen`**: take a screenshot `no-button` and paste `Top`, and stop there.
- **Step 4: no `sos: position from …` line, and the text says "No location yet."**: location is off or the emulator has no position. Run `& $adb emu geo fix 151.2093 -33.8688` again, paste `& $adb shell settings get secure location_mode` and `SosLog`, and stop there.
- **`SosLog` has `sos: the text failed`** (with a stack trace under it): this card fixes exactly that, so it must not happen. Paste the line and the first 15 lines of the stack trace under it (`& $adb logcat -d -s Sos:W | Select-Object -First 20`) and the `dumpsys` output of step 1, and stop there.
- **`Texts` prints an error, or nothing, although `SosLog` has `sos: texted 1 parent(s)`**: paste both and go on with the run; say so under "Deviations". If `Texts` shows `type=5` (failed) rows, paste them and go on.
- **`Sos` says `the API said 401`**: `$env:JWT_SECRET` is not the same as `JWT_SECRET` in `deploy\.env`. Set it again as in "The server" and repeat.
- **Step 5: the `used=` number grew**: paste both `SosLog` outputs (step 4 and step 5) and stop there. Do not try to fix it.
- **Step 7: `Top` does not show `BlockActivity`**: paste `& $adb logcat -d -s KidService:I | Select-Object -Last 15` and `Top`, and stop there.
- **Step 6 or 9: the screen does not change within 10 seconds of `Sos seen` or `Sos end`**: the live channel is down. Paste `& $adb logcat -d -s KidService:I | Select-String 'live:'` and `SosLog`, and stop there.
- **Step 10: `Wait-Log` prints `No 'sent to the server' after 120 s`**: paste `& $adb logcat -d -s Sos:I KidService:I | Select-Object -Last 40` (not `SosLog`), `& $adb shell dumpsys connectivity | Select-String 'Active default network'` and `Sos show`, and stop there.
- **You are stuck in the block screen** and need the emulator back: `& $adb shell am task lock stop`, then `Bedtime 60`.
- **`Bedtime` says the bedtime would be after midnight**: it is too late in the day. Do the run the next day after 6 am.
- **`wm dismiss-keyguard` does nothing** (the lock screen stays): swipe up with `& $adb shell input swipe 540 1800 540 600` instead and say so under "Deviations".
- **`dpm set-device-owner` says there are accounts, several users, or already provisioned**: use a fresh emulator (Device Manager › **Wipe Data**), do not sign in, and repeat from step 1.
- **`INSTALL_FAILED_TEST_ONLY`**: you left out `-t` in `adb install`.
- **Never tap Emergency 000**, and never run this on a real phone.
- **Temporary files** (the PR body, `ui.xml`, the screenshots, any helper scripts) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **Every difference from the card is a deviation**, in any file, including tests, comments and how you ran a check. List each one under "Deviations". If you explain why something happened, say whether you checked it or are guessing.
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-038b. Please review and merge if it is good.

CARD: CARD-038b SOS fixes on the kid phone
PR: <full PR URL>
Branch: bob/card-038b-sos-fixes
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
