# CARD-033: Block screen in Lock Task

| Field | Value |
|---|---|
| Card | CARD-033 |
| Title | Block screen in Lock Task |
| Size | M |
| Depends on | CARD-032 (time left, warnings, main screen), merged to `main` |
| Spec sections | docs/SPEC.md §12.1 ("Blocked state", "As built (CARD-032)" and "As built (CARD-033)"), §16.2 ("Block screen") |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-033-block-screen` |
| PR title | `CARD-033: Block screen in Lock Task` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

After CARD-032 the kid app shows the time left and says "It's bedtime", but the phone can still be used. This card **actually locks it**:

- **Block screen** (`block/BlockActivity.kt`, `block/BlockScreen.kt`): a full-screen night-blue page with the time at the top, a moon (bedtime, early morning) or an hourglass (out of time), "It's bedtime" / "Out of Phone time" / "Not yet, it's early", and when the phone is back. No buttons yet: ask, message, calls, parent mode and SOS come in CARD-035 to CARD-038.
- **Lock Task** (`admin/Policies.kt`): Android's kiosk mode. While the block screen shows, Home, Recents and the notification shade do nothing. The power menu and the phone's own lock screen (with its emergency call button) still work.
- **The service** (`service/KidService.kt`): when the engine says locked it ends the open segment (nothing counts while blocked) and opens the block screen. While blocked with the screen on it asks the server for news every 30 seconds, so a parent's extra time or a later bedtime unlocks within about 30 seconds. When unlocked, the block screen lets go and closes, and counting starts again.
- **A fix from CARD-032** (`usage/Recorder.kt`): in your CARD-032 run, step 4, the segment that ended while the server was down came back `recorded_offline` f. The cause: the failing sync at screen off was slow, the next unlock opened a new segment first, and the old code then marked only the new one. Now a failed sync marks every segment the server has not got yet, and two syncs never run at the same time. One new test in `RecorderTest` covers it.

Claude added an optional third number to `server/scripts/dev-bedtime.ts`: today's allowance in minutes. `0` runs the kid out of time at once, so you can see the hourglass screen.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `RecorderTest` now at 10 tests; on the emulator the block screen appears at bedtime and when out of time, Home, Recents and the shade cannot leave it, nothing counts while blocked, a later bedtime closes it within about a minute, it comes back after a reboot, and the offline segments are both marked; the six screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No buttons on the block screen (CARD-035 to CARD-038). No calls, dialer in Lock Task or `CallRedirectionService` (CARD-036). No FCM or WebSocket (CARD-034).
- No change to `core-model`, `core-time`, `core-ui`, `app-parent`, `packages/`, `web/`, `server/` or `docs/`, and no change to `build.gradle.kts` or `libs.versions.toml` files. No new dependency of any kind.
- Never run the app on a real phone or tablet in this card, and never install a **release** build anywhere.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, Room 2.8.5, KSP 2.3.12, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36. No new library.

Claude built this exact code in GitHub Actions before writing the card, so it compiles and the tests pass.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c33"
New-Item -ItemType Directory -Force $t | Out-Null
```

**If you are ever stuck inside the block screen on the emulator**, this always gets you out: `& $adb shell am task lock stop`.

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7) and `·` (U+00B7); copy them exactly.

| File | Action |
|---|---|
| `android/app-kid/src/main/AndroidManifest.xml` | replace (5.1) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt` | replace (5.2) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockActivity.kt` | create (5.3) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt` | create (5.4) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt` | replace (5.5) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/usage/Recorder.kt` | replace (5.6) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/usage/RecorderTest.kt` | replace (5.7) |

That is 7 files.

### 5.1 `android/app-kid/src/main/AndroidManifest.xml`

The same as on `main`, plus the `BlockActivity` entry before the service.

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

### 5.2 `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt`

Replace the whole file. Compared with `main`: `apply` also sets the Lock Task packages and features.

```kotlin
package au.screentime.kid.admin

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import android.os.UserManager
import android.util.Log
import au.screentime.kid.BuildConfig

/** The Device Owner policies of docs/SPEC.md §12.1. Applying them again changes nothing, so the app does it on every start. */
object Policies {
    private const val TAG = "Policies"

    /** Restrictions for every build. */
    private val RESTRICTIONS = listOf(
        UserManager.DISALLOW_APPS_CONTROL,
        UserManager.DISALLOW_SAFE_BOOT,
        UserManager.DISALLOW_FACTORY_RESET,
        UserManager.DISALLOW_CONFIG_DATE_TIME,
        UserManager.DISALLOW_ADD_USER,
        UserManager.DISALLOW_AIRPLANE_MODE,
    )

    fun isDeviceOwner(context: Context): Boolean =
        context.getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(context.packageName)

    /**
     * Applies every policy. Does nothing unless the app is Device Owner.
     * A debug build leaves USB debugging on and the app uninstallable, so a developer can always reinstall it
     * and take it off as Device Owner with `adb shell dpm remove-active-admin` (debug builds are test-only).
     */
    fun apply(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)

        for (restriction in RESTRICTIONS) {
            dpm.addUserRestriction(admin, restriction)
        }
        if (!BuildConfig.DEBUG) {
            dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
            dpm.setUninstallBlocked(admin, context.packageName, true)
        }
        dpm.setAutoTimeEnabled(admin, true)
        dpm.setAutoTimeZoneEnabled(admin, true)
        // The block screen runs in Lock Task (docs/SPEC.md §12.1): no Home, Recents or notification shade, but the
        // power menu and the phone's own lock screen (with its emergency call button) still work.
        dpm.setLockTaskPackages(admin, arrayOf(context.packageName))
        dpm.setLockTaskFeatures(
            admin,
            DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD,
        )
        grantRuntimePermissions(context)
    }

    /**
     * Grants every runtime permission the manifest asks for, so the kid never sees a permission prompt.
     * Does nothing unless the app is Device Owner. The setup screen calls it before scanning, for the camera.
     */
    fun grantRuntimePermissions(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        for (permission in runtimePermissions(context)) {
            val granted = dpm.setPermissionGrantState(
                admin,
                context.packageName,
                permission,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
            )
            if (!granted) Log.w(TAG, "could not grant $permission")
        }
    }

    /** The permissions in the manifest that a user would otherwise have to allow. */
    private fun runtimePermissions(context: Context): List<String> {
        val pm = context.packageManager
        val info = pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
        return info.requestedPermissions.orEmpty().filter { name ->
            try {
                pm.getPermissionInfo(name, 0).protection == PermissionInfo.PROTECTION_DANGEROUS
            } catch (e: PackageManager.NameNotFoundException) {
                false
            }
        }
    }
}
```

### 5.3 `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockActivity.kt`

```kotlin
package au.screentime.kid.block

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.status.StatusHub

/**
 * The block screen (docs/SPEC.md §12.1 "Blocked state", §16.2 "Block screen"): out of time, bedtime and before
 * wake-up. It pins itself with Lock Task, so Home, Recents and the notification shade are gone, and it lets go and
 * closes as soon as [StatusHub] says the device may be used again (a grant, wake-up, a new day).
 */
class BlockActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.insetsController?.let {
            it.hide(WindowInsets.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        // Back does nothing here.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })
        setContent {
            val status by StatusHub.status.collectAsState()
            val locked = status?.locked == true
            LaunchedEffect(locked) {
                if (!locked) unblock()
            }
            ScreenTimeTheme {
                status?.let { BlockScreen(it) }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (StatusHub.status.value?.locked == true && !inLockTask()) {
            try {
                startLockTask()
                Log.i(TAG, "Lock Task started")
            } catch (e: IllegalArgumentException) {
                // Not allowed: the app is not Device Owner, or the policies were not applied yet.
                Log.w(TAG, "could not start Lock Task", e)
            }
        }
    }

    private fun unblock() {
        if (inLockTask()) stopLockTask()
        Log.i(TAG, "unblocked")
        finish()
    }

    private fun inLockTask(): Boolean =
        getSystemService(ActivityManager::class.java).lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    companion object {
        private const val TAG = "BlockActivity"

        /** Shows the block screen, from the service. Showing it again while it is up does nothing. */
        fun show(context: Context) {
            context.startActivity(
                Intent(context, BlockActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
```

### 5.4 `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt`

```kotlin
package au.screentime.kid.block

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.time.LockReason
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.clockText
import java.time.LocalTime
import kotlinx.coroutines.delay

/**
 * The block screen's content (docs/SPEC.md §16.2): the time at the top, a moon or an hourglass, "It's bedtime" and
 * when the device is back. The buttons (ask, message, calls, SOS, parent) come with their cards.
 */
@Composable
fun BlockScreen(status: KidStatus) {
    val colors = ScreenTimeTheme.colors
    val reason = status.lockReason ?: return
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(colors.nightTop, colors.nightBottom)))
            .safeDrawingPadding()
            .padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Clock(colors.onNight.copy(alpha = 0.7f))
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            if (reason == LockReason.OUT_OF_TIME) Hourglass(colors.onNight) else MoonAndStars(colors.onNight)
            Spacer(Modifier.height(32.dp))
            Text(
                text = status.headline(reason),
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                color = colors.onNight,
                textAlign = TextAlign.Center,
            )
            status.subline()?.let {
                Spacer(Modifier.height(12.dp))
                Text(
                    text = it,
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.onNight,
                    textAlign = TextAlign.Center,
                )
            }
        }
        Spacer(Modifier.weight(1f))
    }
}

/** The time of day, small, updated every 10 seconds. The device's clock is set automatically (docs/SPEC.md §12.1). */
@Composable
private fun Clock(color: Color) {
    var now by remember { mutableStateOf(clockText(LocalTime.now())) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(10_000)
            now = clockText(LocalTime.now())
        }
    }
    Text(text = now, style = MaterialTheme.typography.titleMedium, color = color)
}

/** Bedtime and early morning: a crescent moon with three stars, 160 dp, flat. */
@Composable
private fun MoonAndStars(color: Color) {
    Canvas(
        modifier = Modifier
            .size(160.dp)
            .clearAndSetSemantics { },
    ) {
        val w = size.width
        val moon = Path().apply { addOval(Rect(Offset(w * 0.42f, w * 0.5f), w * 0.3f)) }
        val bite = Path().apply { addOval(Rect(Offset(w * 0.58f, w * 0.38f), w * 0.26f)) }
        drawPath(Path.combine(PathOperation.Difference, moon, bite), color)
        drawCircle(color, radius = w * 0.035f, center = Offset(w * 0.78f, w * 0.22f))
        drawCircle(color, radius = w * 0.025f, center = Offset(w * 0.9f, w * 0.46f))
        drawCircle(color, radius = w * 0.02f, center = Offset(w * 0.66f, w * 0.1f))
    }
}

/** Out of time: an hourglass, 160 dp, flat. */
@Composable
private fun Hourglass(color: Color) {
    Canvas(
        modifier = Modifier
            .size(160.dp)
            .clearAndSetSemantics { },
    ) {
        val w = size.width
        val h = size.height
        val glass = Path().apply {
            moveTo(w * 0.28f, h * 0.16f)
            lineTo(w * 0.72f, h * 0.16f)
            lineTo(w * 0.5f, h * 0.5f)
            lineTo(w * 0.72f, h * 0.84f)
            lineTo(w * 0.28f, h * 0.84f)
            lineTo(w * 0.5f, h * 0.5f)
            close()
        }
        drawPath(glass, color.copy(alpha = 0.35f))
        // The sand has all run to the bottom.
        val sand = Path().apply {
            moveTo(w * 0.5f, h * 0.62f)
            lineTo(w * 0.66f, h * 0.84f)
            lineTo(w * 0.34f, h * 0.84f)
            close()
        }
        drawPath(sand, color)
        val bar = h * 0.05f
        drawLine(color, Offset(w * 0.22f, h * 0.14f), Offset(w * 0.78f, h * 0.14f), strokeWidth = bar)
        drawLine(color, Offset(w * 0.22f, h * 0.86f), Offset(w * 0.78f, h * 0.86f), strokeWidth = bar)
    }
}
```

### 5.5 `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

Replace the whole file. Compared with `main`: `blocked`, `syncLock`, `Policies.apply` at start, the loop's blocked branch, `screenOn()`, `onScreenOn` (was `onInUse`), `sync()` under the lock, and the block handling in `report()`.

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
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
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
 * screen up to date (§16.2), and shows the block screen while the engine says the device is locked (§12.1). Everything
 * runs one at a time on [scope], so the database sees one change after another.
 */
class KidService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))

    private lateinit var clock: TrustedClock
    private lateinit var recorder: Recorder
    private lateinit var segments: RoomSegmentStore
    private lateinit var states: FileStateStore
    private lateinit var syncer: Syncer
    private lateinit var notifier: Notifier
    private var engine: HttpClientEngine? = null
    private var api: ApiClient? = null
    private var started = false

    /** [SystemClock.elapsedRealtime] of the last sync, for "every 5 minutes" and "if the last sync is older than 2 minutes". */
    private var lastSyncElapsed = 0L
    private var lastSyncOk = true

    /** One sync at a time: a slow sync that is failing must not overlap the next one. */
    private val syncLock = Mutex()

    /** The engine said locked at the last run: the block screen is up and nothing counts (docs/SPEC.md §12.1). */
    private var blocked = false

    private val warnings = WarningTracker()

    /** Trusted time of the next warning, lock or new period, so the loop wakes up for it (at least once a minute). */
    private var nextCheckAt = 0L

    /** Wakes the loop early, when an unlock or a sync has moved [nextCheckAt]. */
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
            scope.launch { if (!lastSyncOk) sync() }
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
                // While in use, until the next warning, lock or period (at least once a minute). Blocked with the
                // screen on, at least every 30 seconds, to see a parent's grant soon. Otherwise a minute.
                val untilNext = (nextCheckAt - clock.nowMs()).coerceIn(SECOND, MINUTE)
                val wait = when {
                    inUse() -> untilNext
                    blocked && screenOn() -> minOf(untilNext, BLOCKED_POLL)
                    else -> MINUTE
                }
                // Woken early: only work out the wait again.
                if (withTimeoutOrNull(wait) { wake.receive() } != null) continue
                when {
                    inUse() -> {
                        recorder.tick(clock.nowMs())
                        if (SystemClock.elapsedRealtime() - lastSyncElapsed >= 5 * MINUTE) sync() else report()
                    }
                    blocked && screenOn() -> sync()
                }
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

    private fun screenOn(): Boolean = getSystemService(PowerManager::class.java).isInteractive

    /** The screen is on and unlocked, and not blocked by us: counting (docs/SPEC.md §3, Q19, §12.1). */
    private fun inUse(): Boolean =
        screenOn() && !getSystemService(KeyguardManager::class.java).isKeyguardLocked && !blocked

    private suspend fun onScreenOn(at: Long) {
        val stale = !lastSyncOk || SystemClock.elapsedRealtime() - lastSyncElapsed >= 2 * MINUTE
        if (blocked) {
            // The block screen comes back up through report(); a fresh sync may bring a grant.
            if (stale) sync() else report()
            return
        }
        // Screen on without a lock screen, or the unlock after it: only one segment either way.
        if (!inUse() || segments.open() != null) return
        recorder.start(at)
        if (stale) sync() else report()
    }

    private suspend fun sync() {
        syncLock.withLock {
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
     * main screen through [StatusHub], the block screen, and the log (`adb logcat -s KidService`). Becoming locked
     * ends the open segment; becoming unlocked starts one if the device is in use.
     */
    private suspend fun report() {
        val now = clock.nowMs()
        nextCheckAt = now + MINUTE
        val cached = states.load() ?: return
        val own = segments.since(dayStartMs(cached.state, now))
        val result = evaluate(todayInput(cached.state, own, now))
        val status = kidStatus(cached.state, result, now, lastSyncOk, SystemClock.elapsedRealtime())

        val wasBlocked = blocked
        blocked = status.locked
        if (blocked && !wasBlocked) recorder.stop(now)
        if (!blocked && wasBlocked && inUse()) recorder.start(now)

        StatusHub.status.value = status
        // The block screen closes itself when StatusHub says unlocked.
        if (blocked && screenOn()) BlockActivity.show(this)
        notifier.showStatus(status, now)
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
                "left=${status.leftSec}s locked=${result.locked} online=$lastSyncOk segments=${own.size}",
        )
    }

    companion object {
        private const val TAG = "KidService"
        private const val SECOND = 1_000L
        private const val MINUTE = 60_000L

        /** How often a blocked device with the screen on asks the server for news (docs/SPEC.md §8.3, until CARD-034). */
        private const val BLOCKED_POLL = 30_000L

        /** Sent segments are kept this long, then forgotten (docs/SPEC.md §8.3, offline buffer). */
        private const val KEEP_DAYS = 30L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, KidService::class.java))
        }
    }
}
```

### 5.6 `android/app-kid/src/main/kotlin/au/screentime/kid/usage/Recorder.kt`

Replace the whole file. Only `markOffline` and its comment changed.

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
     * The server could not be reached: the open segment and every segment the server has not got yet count as
     * recorded offline. That includes the one that ended at a screen off whose sync failed, even when the next unlock
     * opened a new segment before the failure was known. A segment the server already has is left as it is. Once
     * offline, always offline.
     */
    suspend fun markOffline() {
        val targets = (listOfNotNull(store.open()) + store.pending(Int.MAX_VALUE).map { it.segment }).distinctBy { it.id }
        for (segment in targets) {
            if (!segment.recordedOffline) store.put(segment.copy(recordedOffline = true))
        }
    }
}
```

### 5.7 `android/app-kid/src/test/kotlin/au/screentime/kid/usage/RecorderTest.kt`

Replace the whole file. One new test, `anUnlockDuringASlowFailedSyncStillMarksTheSegmentThatEnded`; the others are unchanged.

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
    fun anUnlockDuringASlowFailedSyncStillMarksTheSegmentThatEnded() = runBlocking {
        // Screen off: the segment ends and its sync starts, but the server does not answer for a while.
        recorder.start(1_000)
        recorder.stop(61_000)
        // The kid unlocks again before the sync has failed.
        recorder.start(70_000)

        recorder.markOffline()

        assertEquals(listOf(true, true), store.all().map { it.recordedOffline })
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

## 6. Detailed spec

### 6.1 What happens

| Event | What the app does |
|---|---|
| The engine says locked (bedtime, before wake-up, out of time) | ends the open segment; opens the block screen if the screen is on; the block screen starts Lock Task |
| Screen on while blocked | the block screen comes up again (it is still pinned); syncs if the last sync is 2 minutes old or failed; no segment starts |
| Blocked, screen on | syncs at least every 30 seconds |
| Blocked, screen off | nothing, once a minute |
| The engine says unlocked (grant, later bedtime, wake-up, new day) | the block screen stops Lock Task and closes; a segment starts if the screen is on and unlocked |
| Reboot while blocked | the service starts, and the first report opens the block screen again |
| Home, Recents, pulling down the shade, Back | nothing |
| A sync fails | the open segment and every segment the server has not got yet become `recordedOffline` |

### 6.2 What the block screen shows

| Lock | Picture | Headline (32 sp, bold) | Line under it |
|---|---|---|---|
| Bedtime | moon and three stars | `It's bedtime` | `Phone is back at 7:00 am` |
| Before wake-up | moon and three stars | `Not yet, it's early` | `Phone is back at 7:00 am` |
| Out of time | hourglass, sand at the bottom | `Out of Phone time` | `New time tomorrow` |

Background: the night gradient (`#1E1B4B` at the top to `#312E81` at the bottom). Text and pictures in `onNight` (`#E0E7FF`); the time at the top at 70% opacity. The system bars are hidden.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-033-block-screen
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-033-block-screen.md` must exist, and `server/scripts/dev-bedtime.ts` must mention `[allowance`. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create or replace 5.1 to 5.6. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-033: block screen, Lock Task and the offline fix`.
3. Replace 5.7. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-033: recorder test for a slow failed sync`.
4. Run the acceptance checks in section 8, including the emulator run (8.2), in this session.
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints eleven lines:
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
  au.screentime.kid.status.KidStatusTest tests="7" failures="0" errors="0"
  au.screentime.kid.status.WarningTrackerTest tests="5" failures="0" errors="0"
  au.screentime.kid.sync.SyncerTest tests="4" failures="0" errors="0"
  au.screentime.kid.sync.TrustedClockTest tests="4" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="10" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```
- [ ] The merged debug manifest has the block screen. From `android`, this prints `True` twice:
  ```powershell
  $m = Get-Content app-kid\build\intermediates\merged_manifest\debug\processDebugMainManifest\AndroidManifest.xml -Raw
  $m -match 'au.screentime.kid.block.BlockActivity'
  $m -match 'android:taskAffinity="au.screentime.kid.block"'
  ```

### 8.2 On the emulator

Run every step below **in this session**, and paste the **real terminal output** of each step into the handback. A summary is not accepted, and neither is "run earlier in this session" for output you no longer have. If your context was summarised partway through, run the steps again from step 1.

**The emulator.** Use the same emulator as in CARD-032, with nobody signed in. Remove the app from CARD-032 first (each command prints `Success...`, or an error if there was nothing to remove; both are fine), and keep the screen from turning off by itself for 30 minutes:

```powershell
& $adb shell am task lock stop
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
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

Do the run between 6 am and 10 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Bedtime 30` moves Alex's bedtime to 30 minutes from now; `Bedtime 60 0` also sets today's allowance to 0 minutes. `Top` prints which screen is in front and whether Lock Task is on. `BlockLog` prints the block screen's log lines.

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
function Segments {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select extract(epoch from ended_at - started_at)::int as seconds, ended_at is null as open, recorded_offline from usage_segments order by started_at"
}
function Bedtime([int]$minutes, [int]$allowance = 720) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-bedtime.ts Alex $minutes $allowance
}
function Notes {
  & $adb shell dumpsys notification --noredact | Select-String 'pkg=au.screentime.kid|android.title=|android.text=' | ForEach-Object { $_.Line.Trim() }
}
function Top {
  & $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
  & $adb shell dumpsys activity lock-task 2>$null | Select-String 'mLockTaskModeState|LockTask' | Select-Object -First 3 | ForEach-Object { $_.Line.Trim() }
}
function BlockLog {
  & $adb logcat -d -s BlockActivity:I
}
```

`Bedtime` prints `Bedtime for Alex today is now HH:MM (Australia/Sydney), allowance N min, schedule version N.` `Top` prints a line with the activity in front, for example `... au.screentime.kid/.block.BlockActivity ...`. If it prints no Lock Task line, `BlockLog` is what counts.

**The run.** From `android`, one step at a time; check each expected result before the next step. Times and seconds depend on how fast you go; what matters is what the card says about them.

1. Bedtime in 30 minutes, then install, make it Device Owner and pair. In a second PowerShell window, from the repo root, with the same `$env:DATABASE_URL`, run `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` and copy the `Emulator link`. Back in the first window:
   ```powershell
   Bedtime 30
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   Open-App
   Open-Link "<the emulator link>"
   Tap-Text "Yes"
   Start-Sleep -Seconds 10
   Shot "1-home"
   ```
   `1-home` shows "Hi Alex" and the teal ring with about `30m`, as in CARD-032.
2. The bedtime lock. Bedtime in 1 minute, then wait for it:
   ```powershell
   Bedtime 1
   Screen-Off
   Screen-On
   Open-App
   Start-Sleep -Seconds 150
   Shot "2-bedtime"
   Top
   BlockLog
   Segments
   ```
   `2-bedtime` shows the block screen: night-blue background, the time small at the top, a moon with three stars, "It's bedtime" and "Phone is back at 7:00 am" (8:00 am if tomorrow is Saturday or Sunday), no status bar or navigation bar. `Top` shows `au.screentime.kid/.block.BlockActivity`. `BlockLog` has `Lock Task started`. In `Segments` every row is closed (`open` f): nothing counts while blocked.
3. No way out. Press Home, Recents and Back, and try to pull down the shade:
   ```powershell
   & $adb shell input keyevent KEYCODE_HOME
   Start-Sleep -Seconds 2
   & $adb shell input keyevent KEYCODE_APP_SWITCH
   Start-Sleep -Seconds 2
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   & $adb shell cmd statusbar expand-notifications
   Start-Sleep -Seconds 2
   Shot "3-no-way-out"
   & $adb shell cmd statusbar collapse
   Top
   ```
   `3-no-way-out` still shows the block screen (no shade, no launcher, no Recents). `Top` still shows `BlockActivity`.
4. Screen off and on while blocked:
   ```powershell
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 10
   Top
   Segments
   ```
   `Top` shows `BlockActivity`. `Segments` has the same rows as in step 2, all closed: the unlock did not start a segment.
5. A later bedtime unblocks. Move bedtime to 30 minutes from now and wait at most 60 seconds:
   ```powershell
   Bedtime 30
   Start-Sleep -Seconds 60
   Shot "4-unblocked"
   Top
   BlockLog
   Segments
   ```
   `4-unblocked` shows the main screen again ("Hi Alex", the ring with about `30m`) or the launcher, not the block screen. `Top` does not show `BlockActivity`. `BlockLog` now also has `unblocked`. `Segments` ends with one open segment (`open` t): counting started again.
6. Out of time. Allowance 0 for today:
   ```powershell
   Bedtime 60 0
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 15
   Shot "5-out-of-time"
   Top
   Notes
   ```
   `5-out-of-time` shows the block screen with the hourglass (sand at the bottom), "Out of Phone time" and "New time tomorrow". `Top` shows `BlockActivity`. `Notes` has `android.title=String (Out of Phone time)`.
7. After a reboot the block screen comes back:
   ```powershell
   & $adb reboot
   & $adb wait-for-device
   $deadline = (Get-Date).AddMinutes(5)
   do { Start-Sleep -Seconds 10; $b = (& $adb shell getprop sys.boot_completed 2>$null) } until ($b -match '1' -or (Get-Date) -gt $deadline)
   Start-Sleep -Seconds 30
   Screen-On
   Start-Sleep -Seconds 15
   Shot "6-after-reboot"
   Top
   BlockLog
   ```
   `6-after-reboot` shows the out-of-time block screen again. `Top` shows `BlockActivity`, and `BlockLog` has `Lock Task started` (the log was cleared by the reboot, so this line is new).
8. Unblock, then the offline check from CARD-032 step 4 again, with the fix:
   ```powershell
   Bedtime 60
   Start-Sleep -Seconds 60
   Top
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env stop api
   Screen-On
   Start-Sleep -Seconds 70
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 10
   Screen-Off
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env start api
   Start-Sleep -Seconds 15
   Screen-On
   Start-Sleep -Seconds 10
   Segments
   ```
   `Top` does not show `BlockActivity`. The last three rows of `Segments`, oldest first: (70 or more, f, **t**), (a few seconds, f, **t**), (empty `seconds`, **t** `open`, f). If `curl.exe -s http://localhost:8080/health` does not show `"status":"ok"` after the 15 seconds, wait until it does, then do the last three lines again.
9. Undo, so the emulator can be used again:
   ```powershell
   & $adb shell am task lock stop
   & $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb uninstall au.screentime.kid
   & $adb shell settings put system screen_off_timeout 60000
   cd ..
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item Env:DATABASE_URL
   ```
   `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success`.

- [ ] Steps 1 to 9 gave the expected results, run in this session. Paste the real output of every command in steps 2 to 8 into the handback (the `Bedtime`, `Top`, `BlockLog`, `Segments` and `Notes` lines).
- [ ] The six screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c33\`: `1-home.png`, `2-bedtime.png`, `3-no-way-out.png`, `4-unblocked.png`, `5-out-of-time.png`, `6-after-reboot.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 7 files (in any order):
  ```
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockActivity.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/usage/Recorder.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/usage/RecorderTest.kt
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/usage/RecorderTest.kt` | As in CARD-031, plus: when the kid unlocks again before a slow sync has failed, both the segment that ended and the new open one are marked offline. |

Lock Task, the block screen and the service's block handling are checked by the emulator run in 8.2, not by unit tests.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-033: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-033-block-screen`
5. Open a PR into `main` titled `CARD-033: Block screen in Lock Task`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-033-block-screen --title "CARD-033: Block screen in Lock Task" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-033-block-screen.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: eleven suites, RecorderTest 10, all `failures="0"`
   - [x] merged debug manifest — output: `True` twice
   - [x] emulator run steps 1 to 9 — results as expected
   - [x] six screenshots in C:\Users\james\OpenCode\Testing\temp\c33\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 7 files

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

- **The block screen does not appear in step 2** (`Top` shows the main screen, and the notification says "It's bedtime"): Android may have refused to open it from the background. Paste `& $adb logcat -d | Select-String 'BlockActivity|Background activity|BAL|ActivityTaskManager' | Select-Object -Last 20` into the handback and stop there. Do not change the code.
- **`BlockLog` has a `could not start Lock Task` warning**: the policies were not applied. Paste the warning line and `& $adb shell dpm list-owners`, and stop there.
- **You are stuck in the block screen** and need the emulator back: `& $adb shell am task lock stop`, then `Bedtime 60`.
- **`Top` prints nothing**: run `& $adb shell dumpsys activity activities | Select-String 'Resumed'` and paste what it prints.
- **Step 5 still shows the block screen after 60 seconds**: wait 30 more seconds and run `Top` again. If it still shows, paste `& $adb logcat -d -s KidService:I | Select-Object -Last 10`.
- **Step 8 rows not as expected**: paste the full `Segments` output and `& $adb logcat -d -s KidService` lines of step 8. Do not change the code.
- **`Bedtime` says the bedtime would be after midnight**: it is too late in the day. Do the run the next day after 6 am.
- **`wm dismiss-keyguard` does nothing** (the lock screen stays): swipe up with `& $adb shell input swipe 540 1800 540 600` instead and say so under "Deviations".
- **`dpm set-device-owner` says there are accounts, several users, or already provisioned**: use a fresh emulator (Device Manager › **Wipe Data**), do not sign in, and repeat from step 1.
- **`INSTALL_FAILED_TEST_ONLY`**: you left out `-t` in `adb install`.
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
Claude, here is Bob's handback for CARD-033. Please review and merge if it is good.

CARD: CARD-033 Block screen in Lock Task
PR: <full PR URL>
Branch: bob/card-033-block-screen
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
