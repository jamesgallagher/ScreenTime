# CARD-032: Time left, warnings and the main screen

| Field | Value |
|---|---|
| Card | CARD-032 |
| Title | Time left, warnings and the main screen |
| Size | M |
| Depends on | CARD-031 (usage tracking and sync), merged to `main` |
| Spec sections | docs/SPEC.md §12.1 ("Foreground service", "As built (CARD-031)" and "As built (CARD-032)"), §16.1, §16.2 ("Persistent notification", "Main screen", "Warnings") |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-032-time-left` |
| PR title | `CARD-032: Time left, warnings and the main screen` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

After CARD-031 the kid app counts screen time and syncs, but the kid sees nothing: the notification only says "Screen Time is on" and the app still shows "All set, Alex". This card shows the kid **how much time is left**:

- **Status** (`status/KidStatus.kt`, pure Kotlin): after every engine run the service works out what to show: "Phone · 1h 12m left", "Bedtime 8:30 pm", the ring colour, and when locked "It's bedtime" / "Phone is back at 7:00 am" or "Out of Phone time" / "New time tomorrow". "Time left" is the time until the device locks, so a bedtime that comes before the allowance runs out counts too.
- **Notification** (`service/Notifier.kt`): the service's notification now shows that title and text, with the system chronometer counting down to the lock, and "Offline" when the last sync failed. Tapping it opens the app.
- **Warnings** (`status/Warnings.kt`): a heads-up notification at 15 and at 5 minutes before the lock (the schedule's `warn1Min` and `warn2Min`), each once; the second one also buzzes on a phone.
- **Timing** (`service/KidService.kt`): instead of a fixed one-minute loop, the service wakes up exactly at the next warning, lock or period change (at least once a minute). There is no `AlarmManager` alarm: warnings and locks only matter while the screen is on, and then the service is awake anyway (SPEC §12.1, "As built (CARD-032)").
- **Main screen** (`home/HomeScreen.kt`): replaces "All set": "Hi Alex", a 240 dp ring with the time left in the middle, "Phone left", the bedtime line, and "Offline · still counting" when offline. The ring counts down every second. Tablets and landscape put the ring on the left and the words on the right. The buttons (ask for more time, message, SOS, parent) come with their own cards.

Nothing locks yet: a locked device only says so (the block screen is CARD-033).

Claude added `server/scripts/dev-bedtime.ts` to `main` for this card: it moves a kid's bedtime to a few minutes from now, so you can see both warnings and the bedtime lock on the emulator in a few minutes.

**Also from CARD-031:** your last handback did not run the emulator steps. This card's emulator run (8.2) repeats them (segments, offline, reboot): run every step in this session and paste the real output.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with the new `KidStatusTest` (7) and `WarningTrackerTest` (5); on the emulator the main screen and the notification show the time left, both warnings appear, the bedtime lock shows "It's bedtime", and the CARD-031 checks (segments, offline segment, reboot) give the expected rows; the six screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No block screen, Lock Task or `startLockTask` (CARD-033). No FCM, WebSocket or WorkManager (CARD-034).
- No buttons on the main screen and no notification actions (ask, message: CARD-035; parent mode: CARD-037; SOS: CARD-038).
- No `AlarmManager`, no new permission other than `VIBRATE` (5.1).
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
$t = "C:\Users\james\OpenCode\Testing\temp\c32"
New-Item -ItemType Directory -Force $t | Out-Null
```

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7), `·` (U+00B7, middle dot) and `…` (U+2026, ellipsis); copy them exactly, they are not typos.

| File | Action |
|---|---|
| `android/app-kid/src/main/AndroidManifest.xml` | replace (5.1) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt` | create (5.2) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/Warnings.kt` | create (5.3) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt` | create (5.4) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt` | create (5.5) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt` | replace (5.6) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt` | create (5.7) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupScreen.kt` | replace (5.8) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt` | replace (5.9) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt` | create (5.10) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/WarningTrackerTest.kt` | create (5.11) |

That is 11 files.

### 5.1 `android/app-kid/src/main/AndroidManifest.xml`

The same as on `main`, plus the `VIBRATE` permission after `ACCESS_NETWORK_STATE`.

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

### 5.2 `android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt`

```kotlin
package au.screentime.kid.status

import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.Pool
import au.screentime.core.time.EngineResult
import au.screentime.core.time.LockReason
import au.screentime.core.time.formatDuration
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

/** How much time is left, for the ring and notification colours (docs/SPEC.md §16.1). */
enum class Level { PLENTY, LOW, CRITICAL, LOCKED }

/**
 * What the notification and the main screen show (docs/SPEC.md §16.2), worked out from one engine result.
 * Times are epoch milliseconds of the trusted clock, except [elapsedMs].
 */
data class KidStatus(
    val kidName: String,
    /** "Phone" or "Screens". */
    val poolName: String,
    /** "phone" or "tablet", for "This phone locks at 8:30 pm". */
    val deviceWord: String,
    /** Null while the device may be used. */
    val lockReason: LockReason?,
    /** Seconds until the device locks, 0 when locked. */
    val leftSec: Long,
    /** Seconds the pool was used today, on all its devices. */
    val usedSec: Long,
    /** When the device locks; null when locked, or when it does not lock before the end of the day. */
    val lockAtMs: Long?,
    /** [lockAtMs] as a time of day, "8:30 pm". */
    val lockAtText: String?,
    /** When the engine must run again (docs/SPEC.md §7.3). */
    val reevaluateAtMs: Long,
    /** Today's bedtime while it is still to come, "8:30 pm". */
    val bedtime: String?,
    /** Bedtime or early morning: when the device can be used again, "7:00 am". */
    val backAt: String?,
    val warn1Min: Int,
    val warn2Min: Int,
    /** False when the last sync failed: the device still counts (docs/SPEC.md §8.4). */
    val online: Boolean,
    /** `SystemClock.elapsedRealtime()` when this was worked out, so a screen can count down without the service. */
    val elapsedMs: Long,
) {
    val locked: Boolean get() = lockReason != null

    /** [leftSec] at a later `elapsedRealtime`, never below 0. */
    fun leftSecAt(elapsedNowMs: Long): Long =
        if (lockAtMs == null) leftSec else maxOf(0L, leftSec - (elapsedNowMs - elapsedMs) / 1000)

    /** The ring colour: warning at [warn1Min] or less, critical at [warn2Min] or less. */
    fun level(left: Long = leftSec): Level = when {
        locked -> Level.LOCKED
        lockAtMs == null -> Level.PLENTY
        left <= warn2Min * 60L -> Level.CRITICAL
        left <= warn1Min * 60L -> Level.LOW
        else -> Level.PLENTY
    }

    /** The notification title: "Phone · 1h 12m left", or "It's bedtime" when locked. */
    fun title(left: Long = leftSec): String =
        lockReason?.let { headline(it) } ?: "$poolName · ${formatDuration(left)} left"

    /** "Out of Phone time", "It's bedtime" or "Not yet, it's early". */
    fun headline(reason: LockReason): String = when (reason) {
        LockReason.OUT_OF_TIME -> "Out of $poolName time"
        LockReason.BEDTIME -> "It's bedtime"
        LockReason.BEFORE_WAKE -> "Not yet, it's early"
    }

    /** The line under it: "Bedtime 8:30 pm"; when locked "Phone is back at 7:00 am" or "New time tomorrow". */
    fun subline(): String? = when (lockReason) {
        null -> bedtime?.let { "Bedtime $it" }
        LockReason.OUT_OF_TIME -> "New time tomorrow"
        else -> backAt?.let { "${deviceWord.replaceFirstChar(Char::uppercase)} is back at $it" }
    }

    /** The big number in the ring: "1h 12m", or "<1m" in the last minute. */
    fun ringText(left: Long = leftSec): String = if (left < 60) "<1m" else formatDuration(left)

    /** How full the ring is: the part of today's time that is still left. */
    fun ringFraction(left: Long = leftSec): Float = when {
        locked -> 0f
        left + usedSec <= 0L -> 1f
        else -> left.toFloat() / (left + usedSec)
    }
}

/** The status for [result], the engine's answer for [state] at [nowMs]. */
fun kidStatus(state: DeviceState, result: EngineResult, nowMs: Long, online: Boolean, elapsedMs: Long): KidStatus {
    val tz = ZoneId.of(state.family.timezone)
    val local = Instant.ofEpochMilli(nowMs).atZone(tz)
    val date = local.toLocalDate()
    fun dayOf(weekday: Int) = state.schedule.days.first { it.weekday == weekday }
    val today = dayOf(date.dayOfWeek.value)

    val lockAtMs = result.nextLockAt?.toEpochMilli()
    val leftSec = when {
        result.locked -> 0L
        lockAtMs != null -> maxOf(0L, (lockAtMs - nowMs) / 1000)
        else -> result.remainingSec
    }
    val bedtime = if (today.bedtime == "24:00") {
        null
    } else {
        LocalTime.parse(today.bedtime).takeIf { local.toLocalTime() < it }?.let(::clockText)
    }
    val backAt = when (result.lockReason) {
        LockReason.BEFORE_WAKE -> clockText(LocalTime.parse(today.wake))
        LockReason.BEDTIME -> clockText(LocalTime.parse(dayOf(date.plusDays(1).dayOfWeek.value).wake))
        else -> null
    }

    return KidStatus(
        kidName = state.kid.name,
        poolName = if (state.device.pool == Pool.PHONE) "Phone" else "Screens",
        deviceWord = if (state.device.form == DeviceForm.TABLET) "tablet" else "phone",
        lockReason = if (result.locked) result.lockReason else null,
        leftSec = leftSec,
        usedSec = result.usedSec,
        lockAtMs = lockAtMs,
        lockAtText = lockAtMs?.let { clockText(Instant.ofEpochMilli(it).atZone(tz).toLocalTime()) },
        reevaluateAtMs = result.reevaluateAt.toEpochMilli(),
        bedtime = bedtime,
        backAt = backAt,
        warn1Min = state.schedule.warn1Min,
        warn2Min = state.schedule.warn2Min,
        online = online,
        elapsedMs = elapsedMs,
    )
}

/** A time of day the en-AU way (docs/SPEC.md §16.1): "8:30 pm", "12:05 am". */
fun clockText(time: LocalTime): String {
    val hour = if (time.hour % 12 == 0) 12 else time.hour % 12
    val half = if (time.hour < 12) "am" else "pm"
    return "$hour:${time.minute.toString().padStart(2, '0')} $half"
}

/**
 * When the service must look again (docs/SPEC.md §12.1): the first of warn 1, warn 2, the lock and [KidStatus.reevaluateAtMs]
 * that is still to come, and at least once a minute.
 */
fun nextCheckAtMs(status: KidStatus, nowMs: Long): Long {
    val lockAt = status.lockAtMs
    val events = buildList {
        add(status.reevaluateAtMs)
        if (lockAt != null) {
            add(lockAt)
            add(lockAt - status.warn1Min * 60_000L)
            add(lockAt - status.warn2Min * 60_000L)
        }
    }
    val next = events.filter { it > nowMs }.minOrNull() ?: Long.MAX_VALUE
    return minOf(next, nowMs + 60_000L)
}
```

### 5.3 `android/app-kid/src/main/kotlin/au/screentime/kid/status/Warnings.kt`

```kotlin
package au.screentime.kid.status

/** The two heads-up warnings before a lock (docs/SPEC.md §16.2, Q7). */
enum class Warning { FIRST, SECOND }

/**
 * Decides when to show a warning: each one once, when the time left falls to its threshold while the device is in
 * use. When a parent adds time the time left goes back above a threshold, and that warning can show again. A device
 * that is locked, or does not lock today, has no time left to warn about.
 */
class WarningTracker {
    private var lastLeftSec = Long.MAX_VALUE

    /** The warning to show for [status], or null. Call it only while the device is in use. */
    fun check(status: KidStatus): Warning? {
        val before = lastLeftSec
        val left = if (status.lockAtMs == null) Long.MAX_VALUE else status.leftSec
        lastLeftSec = left
        if (left <= 0) return null
        val warn1 = status.warn1Min * 60L
        val warn2 = status.warn2Min * 60L
        return when {
            left <= warn2 && before > warn2 -> Warning.SECOND
            left <= warn1 && before > warn1 -> Warning.FIRST
            else -> null
        }
    }
}

/** "15 minutes left". */
fun warningTitle(status: KidStatus, warning: Warning): String {
    val minutes = if (warning == Warning.FIRST) status.warn1Min else status.warn2Min
    return if (minutes == 1) "1 minute left" else "$minutes minutes left"
}

/** "This phone locks at 8:30 pm.", and at the second warning "Time to finish up." too. */
fun warningText(status: KidStatus, warning: Warning): String {
    val locks = status.lockAtText?.let { "This ${status.deviceWord} locks at $it." }
    val finish = if (warning == Warning.SECOND) "Time to finish up." else null
    return listOfNotNull(locks, finish).joinToString(" ")
}
```

### 5.4 `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt`

```kotlin
package au.screentime.kid.status

import kotlinx.coroutines.flow.MutableStateFlow

/** The latest status, from the service to the screens of the same process. Null until the first sync. */
object StatusHub {
    val status = MutableStateFlow<KidStatus?>(null)
}
```

### 5.5 `android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt`

```kotlin
package au.screentime.kid.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.VibrationEffect
import android.os.VibratorManager
import au.screentime.kid.MainActivity
import au.screentime.kid.R
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Warning
import au.screentime.kid.status.warningText
import au.screentime.kid.status.warningTitle

/**
 * The kid app's notifications (docs/SPEC.md §16.2): the silent status notification of the foreground service, and
 * the heads-up warnings before a lock.
 */
class Notifier(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    init {
        manager.createNotificationChannel(
            NotificationChannel(STATUS_CHANNEL, "Screen Time", NotificationManager.IMPORTANCE_LOW),
        )
        manager.createNotificationChannel(
            NotificationChannel(WARNING_CHANNEL, "Time warnings", NotificationManager.IMPORTANCE_HIGH).apply {
                // Heads-up without a sound; the phone buzzes itself at the second warning.
                setSound(null, null)
                enableVibration(false)
            },
        )
    }

    /** Opens the main screen. */
    private val openApp: PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** What the service shows before the first sync. */
    fun starting(): Notification = Notification.Builder(context, STATUS_CHANNEL)
        .setSmallIcon(R.drawable.ic_status)
        .setContentTitle("Screen Time")
        .setContentText("Screen Time is on")
        .setContentIntent(openApp)
        .setOngoing(true)
        .build()

    /**
     * "Phone · 1h 12m left", "Bedtime 8:30 pm", with the system chronometer counting down to the lock. The
     * chronometer runs on the wall clock, so the lock is moved by the gap between the trusted clock ([nowMs]) and it.
     */
    fun showStatus(status: KidStatus, nowMs: Long) {
        val builder = Notification.Builder(context, STATUS_CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(status.title())
            .setContentText(status.subline())
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
        if (!status.online) builder.setSubText("Offline")
        val lockAt = status.lockAtMs
        if (lockAt != null) {
            builder
                .setWhen(System.currentTimeMillis() + (lockAt - nowMs))
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
        } else {
            builder.setShowWhen(false)
        }
        manager.notify(STATUS_ID, builder.build())
    }

    /** A heads-up warning; it goes away by itself when the device locks. The second one buzzes on a phone. */
    fun showWarning(status: KidStatus, warning: Warning) {
        val notification = Notification.Builder(context, WARNING_CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(warningTitle(status, warning))
            .setContentText(warningText(status, warning))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setTimeoutAfter(maxOf(1_000L, status.leftSec * 1000))
            .build()
        manager.notify(WARNING_ID, notification)
        if (warning == Warning.SECOND && status.deviceWord == "phone") {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
                .vibrate(VibrationEffect.createWaveform(longArrayOf(0, 250, 150, 250), -1))
        }
    }

    fun cancelWarning() {
        manager.cancel(WARNING_ID)
    }

    companion object {
        const val STATUS_ID = 1
        private const val WARNING_ID = 2
        private const val STATUS_CHANNEL = "status"
        private const val WARNING_CHANNEL = "warnings"
    }
}
```

### 5.6 `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

Replace the whole file. Compared with `main`: the notification moved to `Notifier`, the loop waits until `nextCheckAt` (or is woken through `wake`), and `report()` publishes the status, the notification and the warnings.

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
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The always-on part of the kid app (docs/SPEC.md §12.1, "Foreground service"): records usage segments from the
 * screen and unlock broadcasts, syncs with the server (§8.3), and keeps the notification, the warnings and the main
 * screen up to date (§16.2). Everything runs one at a time on [scope], so the database sees one change after another.
 * Locking comes in CARD-033; for now a locked device only says so.
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

    private val warnings = WarningTracker()

    /** Trusted time of the next warning, lock or new period, so the loop wakes up for it (at least once a minute). */
    private var nextCheckAt = 0L

    /** Wakes the loop early, when an unlock or a sync has moved [nextCheckAt]. */
    private val wake = Channel<Unit>(Channel.CONFLATED)

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
        notifier = Notifier(this)
        startForeground(Notifier.STATUS_ID, notifier.starting(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
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
                // While in use, until the next warning, lock or period (at least once a minute); otherwise a minute.
                val wait = if (inUse()) (nextCheckAt - clock.nowMs()).coerceIn(SECOND, MINUTE) else MINUTE
                // Woken early: only work out the wait again.
                if (withTimeoutOrNull(wait) { wake.receive() } != null) continue
                if (!inUse()) continue
                recorder.tick(clock.nowMs())
                if (SystemClock.elapsedRealtime() - lastSyncElapsed >= 5 * MINUTE) sync() else report()
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

    /**
     * Runs the engine and shows what it says: the notification, a warning when one is due (only while in use), the
     * main screen through [StatusHub], and the log (`adb logcat -s KidService`).
     */
    private suspend fun report() {
        val now = clock.nowMs()
        nextCheckAt = now + MINUTE
        val cached = states.load() ?: return
        val own = segments.since(dayStartMs(cached.state, now))
        val result = evaluate(todayInput(cached.state, own, now))
        val status = kidStatus(cached.state, result, now, lastSyncOk, SystemClock.elapsedRealtime())

        StatusHub.status.value = status
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

        /** Sent segments are kept this long, then forgotten (docs/SPEC.md §8.3, offline buffer). */
        private const val KEEP_DAYS = 30L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, KidService::class.java))
        }
    }
}
```

### 5.7 `android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt`

```kotlin
package au.screentime.kid.home

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.screentime.core.time.formatDuration
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Level
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.delay

/**
 * The kid's main screen (docs/SPEC.md §16.2): "Hi Alex", the ring with the time left, bedtime, and "Offline · still
 * counting" when the last sync failed. The buttons (ask, message, SOS, parent) come with their cards.
 */
@Composable
fun HomeScreen() {
    val status by StatusHub.status.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        val s = status
        if (s == null) Waiting() else Home(s)
    }
}

/** Before the first sync after the app started. */
@Composable
private fun Waiting() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(16.dp))
        Text("Getting your time…", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Home(s: KidStatus) {
    // The time left counts down every second on the screen; the service sends a new status at least once a minute.
    var elapsed by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            elapsed = SystemClock.elapsedRealtime()
        }
    }
    val left = s.leftSecAt(elapsed)

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(24.dp),
    ) {
        if (maxWidth >= 600.dp) {
            // Tablet or landscape: the ring on the left half, the words on the right.
            Row(modifier = Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    Ring(s, left)
                }
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                    Greeting(s.kidName)
                    Spacer(Modifier.height(16.dp))
                    Details(s, TextAlign.Start)
                }
            }
        } else {
            Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                Greeting(s.kidName, Modifier.fillMaxWidth())
                Spacer(Modifier.weight(1f))
                Ring(s, left)
                Spacer(Modifier.height(24.dp))
                Details(s, TextAlign.Center)
                Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Greeting(name: String, modifier: Modifier = Modifier) {
    Text(
        text = "Hi $name",
        modifier = modifier,
        style = MaterialTheme.typography.headlineMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** "Bedtime 8:30 pm" (or when a locked device is back), and the offline line. */
@Composable
private fun Details(s: KidStatus, align: TextAlign) {
    s.subline()?.let {
        Text(
            text = it,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = align,
        )
    }
    if (!s.online) {
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Offline · still counting",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = align,
        )
    }
}

/** The 240 dp ring: the time left (or why it is locked) in the middle, the arc coloured by how much is left. */
@Composable
private fun Ring(s: KidStatus, left: Long) {
    val colors = ScreenTimeTheme.colors
    val track = MaterialTheme.colorScheme.surfaceVariant
    val arc: Color = when (s.level(left)) {
        Level.PLENTY -> colors.primary
        Level.LOW -> colors.warning
        Level.CRITICAL -> colors.critical
        Level.LOCKED -> track
    }
    val fraction = s.ringFraction(left)
    val description = s.lockReason?.let { s.headline(it) } ?: "${formatDuration(left)} of ${s.poolName} left"

    Box(
        modifier = Modifier
            .size(240.dp)
            .clearAndSetSemantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 20.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            val topLeft = Offset(inset, inset)
            drawArc(track, 0f, 360f, useCenter = false, topLeft = topLeft, size = arcSize, style = Stroke(stroke))
            if (fraction > 0f) {
                drawArc(
                    arc,
                    startAngle = -90f,
                    sweepAngle = 360f * fraction,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
            }
        }
        Column(modifier = Modifier.width(176.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val reason = s.lockReason
            if (reason == null) {
                Text(
                    text = s.ringText(left),
                    style = MaterialTheme.typography.displayMedium.copy(fontFeatureSettings = "tnum"),
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 1,
                )
                Text(
                    text = "${s.poolName} left",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(
                    text = s.headline(reason),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
```

### 5.8 `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupScreen.kt`

Replace the whole file. Compared with `main`: `SetupState.Done` shows `HomeScreen()`, the `DoneScreen` function is gone, and there is one new import (`au.screentime.kid.home.HomeScreen`).

```kotlin
package au.screentime.kid.setup

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.enrol.serverLabel
import au.screentime.kid.home.HomeScreen

/** Guide for the computer part of setup (docs/SPEC.md §12.1). */
private const val GUIDE = "github.com/jamesgallagher/ScreenTime › docs/guides/android-provisioning.md"

@Composable
fun SetupScreen(vm: SetupViewModel) {
    when (val s = vm.state) {
        SetupState.NotOwner -> NotOwnerScreen(onCheckAgain = vm::refresh)
        is SetupState.EnterCode -> EnterCodeScreen(
            state = s,
            onScan = vm::onScan,
            onCodeChange = vm::onCodeChange,
            onConnect = vm::onConnect,
            onEditServer = vm::onEditServer,
            onServerTextChange = vm::onServerTextChange,
            onServerDone = vm::onServerDone,
        )
        is SetupState.Scanning -> QrScanScreen(onCode = vm::onLink, onCancel = vm::onScanCancel, onFailed = vm::onScanFailed)
        is SetupState.Confirm -> ConfirmScreen(s.kidName, vm.deviceWord, onYes = vm::onConfirm, onNo = vm::onReject)
        is SetupState.Done -> HomeScreen()
    }
}

/** Every setup screen: centred column, at most 480 dp wide, scrolls when the keyboard is up. */
@Composable
private fun SetupPage(content: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 480.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            content = content,
        )
    }
}

@Composable
private fun Title(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.headlineMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun Body(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyLarge,
        color = ScreenTimeTheme.colors.muted,
        textAlign = TextAlign.Center,
    )
}

/** Secondary pill button: same size as [BigButton], neutral grey. */
@Composable
private fun TonalButton(text: String, onClick: () -> Unit, enabled: Boolean = true) {
    FilledTonalButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
    ) {
        Text(text, style = MaterialTheme.typography.titleMedium)
    }
}

/** Primary pill button, 56 dp high and full width (docs/SPEC.md §16.1, kid buttons). */
@Composable
private fun BigButton(text: String, onClick: () -> Unit, enabled: Boolean = true, busy: Boolean = false) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(24.dp),
                strokeWidth = 3.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            Text(text, style = MaterialTheme.typography.titleMedium)
        }
    }
}

/** The app's mark: a teal circle with a white hourglass, 72 dp. */
@Composable
private fun HourglassMark() {
    val primary = MaterialTheme.colorScheme.primary
    val onPrimary = MaterialTheme.colorScheme.onPrimary
    Canvas(
        modifier = Modifier
            .size(72.dp)
            .semantics { contentDescription = "Screen Time" },
    ) {
        drawCircle(primary)
        val w = size.width
        val h = size.height
        val glass = Path().apply {
            moveTo(w * 0.32f, h * 0.26f)
            lineTo(w * 0.68f, h * 0.26f)
            lineTo(w * 0.5f, h * 0.5f)
            lineTo(w * 0.68f, h * 0.74f)
            lineTo(w * 0.32f, h * 0.74f)
            lineTo(w * 0.5f, h * 0.5f)
            close()
        }
        drawPath(glass, onPrimary)
        val bar = h * 0.05f
        drawLine(onPrimary, Offset(w * 0.28f, h * 0.24f), Offset(w * 0.72f, h * 0.24f), strokeWidth = bar)
        drawLine(onPrimary, Offset(w * 0.28f, h * 0.76f), Offset(w * 0.72f, h * 0.76f), strokeWidth = bar)
    }
}

@Composable
private fun NotOwnerScreen(onCheckAgain: () -> Unit) {
    SetupPage {
        HourglassMark()
        Spacer(Modifier.height(24.dp))
        Title("Ask a parent to finish setup")
        Spacer(Modifier.height(12.dp))
        Body("Screen Time needs a computer to finish setting up. Mum or Dad can follow the guide:")
        Spacer(Modifier.height(12.dp))
        Text(
            text = GUIDE,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))
        TonalButton(text = "Check again", onClick = onCheckAgain)
    }
}

@Composable
private fun EnterCodeScreen(
    state: SetupState.EnterCode,
    onScan: () -> Unit,
    onCodeChange: (String) -> Unit,
    onConnect: () -> Unit,
    onEditServer: () -> Unit,
    onServerTextChange: (String) -> Unit,
    onServerDone: () -> Unit,
) {
    SetupPage {
        HourglassMark()
        Spacer(Modifier.height(24.dp))
        Title("Connect to your family")
        Spacer(Modifier.height(12.dp))
        Body("On Mum or Dad's phone, open Screen Time, choose your name and tap Add device. Then scan the QR code, or type the code.")
        Spacer(Modifier.height(32.dp))
        TonalButton(text = "Scan QR code", onClick = onScan, enabled = !state.busy)
        Spacer(Modifier.height(24.dp))
        Text(
            text = "or type the code",
            style = MaterialTheme.typography.bodyMedium,
            color = ScreenTimeTheme.colors.muted,
        )
        Spacer(Modifier.height(12.dp))
        CodeBoxes(code = state.code, enabled = !state.busy && !state.editingServer, onChange = onCodeChange, onDone = onConnect)
        Spacer(Modifier.height(16.dp))
        val message = state.error ?: state.note
        if (message != null) {
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = if (state.error != null) ScreenTimeTheme.colors.critical else ScreenTimeTheme.colors.muted,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))
        }
        BigButton(
            text = "Connect",
            onClick = onConnect,
            enabled = state.code.length == 6 && !state.editingServer,
            busy = state.busy,
        )
        Spacer(Modifier.height(24.dp))
        if (state.editingServer) {
            OutlinedTextField(
                value = state.serverText,
                onValueChange = onServerTextChange,
                label = { Text("Server address") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onServerDone() }),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onServerDone) { Text("Done") }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Server: ${serverLabel(state.server)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.muted,
                )
                TextButton(onClick = onEditServer, enabled = !state.busy) { Text("Change") }
            }
        }
    }
}

/**
 * Six boxes over one hidden text field, so the number keyboard, paste and backspace all work.
 * The box for the next digit has a primary border.
 */
@Composable
private fun CodeBoxes(code: String, enabled: Boolean, onChange: (String) -> Unit, onDone: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(enabled) {
        if (enabled) focus.requestFocus()
    }
    val colors = ScreenTimeTheme.colors
    BasicTextField(
        value = code,
        onValueChange = onChange,
        enabled = enabled,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = Modifier
            .focusRequester(focus)
            .semantics { contentDescription = "6-digit code" },
        decorationBox = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (i in 0 until 6) {
                    val digit = code.getOrNull(i)?.toString() ?: ""
                    val current = enabled && i == code.length
                    Box(
                        modifier = Modifier
                            .size(width = 48.dp, height = 60.dp)
                            .background(colors.surfaceVariant, RoundedCornerShape(12.dp))
                            .border(
                                width = if (current) 2.dp else 1.dp,
                                color = if (current) colors.primary else colors.outline,
                                shape = RoundedCornerShape(12.dp),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = digit,
                            fontSize = 28.sp,
                            fontWeight = FontWeight.Bold,
                            color = colors.onSurface,
                        )
                    }
                }
            }
        },
    )
}

@Composable
private fun KidInitial(name: String) {
    Box(
        modifier = Modifier
            .size(96.dp)
            .background(MaterialTheme.colorScheme.primary, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = name.take(1).uppercase(),
            fontSize = 44.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}

@Composable
private fun ConfirmScreen(kidName: String, deviceWord: String, onYes: () -> Unit, onNo: () -> Unit) {
    SetupPage {
        KidInitial(kidName)
        Spacer(Modifier.height(24.dp))
        Title("This $deviceWord belongs to $kidName. Correct?")
        Spacer(Modifier.height(32.dp))
        BigButton(text = "Yes", onClick = onYes)
        Spacer(Modifier.height(8.dp))
        TextButton(
            onClick = onNo,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            Text("No, that's not me", style = MaterialTheme.typography.titleMedium)
        }
    }
}
```

### 5.9 `android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt`

Replace the whole file. Only the comment on `SetupState.Done` changed.

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

    /** Enrolled and confirmed: the main screen. */
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

### 5.10 `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt`

It uses `state()` from `usage/StateFixture.kt` (CARD-031).

```kotlin
package au.screentime.kid.status

import au.screentime.core.model.api.DeviceState
import au.screentime.core.time.LockReason
import au.screentime.core.time.evaluate
import au.screentime.kid.usage.state
import au.screentime.kid.usage.todayInput
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class KidStatusTest {
    /** Monday 26 October 2026 in Sydney at [time]: 60 min of Phone, 120 of Screens, 07:00 to 20:30. */
    private fun at(time: String): Long =
        LocalDateTime.parse("2026-10-26T$time").atZone(ZoneId.of("Australia/Sydney")).toInstant().toEpochMilli()

    private fun statusAt(time: String, state: DeviceState = state(), elapsedMs: Long = 0): KidStatus {
        val now = at(time)
        return kidStatus(state, evaluate(todayInput(state, emptyList(), now)), now, online = true, elapsedMs = elapsedMs)
    }

    private fun used(from: String, to: String) =
        """{"id": "s1", "deviceId": "d2", "startedAt": "2026-10-26T$from:00+11:00", "endedAt": "2026-10-26T$to:00+11:00"}"""

    @Test
    fun plentyOfTimeShowsTheTimeLeftAndBedtime() {
        val s = statusAt("10:00")

        assertEquals("Phone · 1h left", s.title())
        assertEquals("Bedtime 8:30 pm", s.subline())
        assertEquals("11:00 am", s.lockAtText)
        assertEquals(3600L, s.leftSec)
        assertEquals(Level.PLENTY, s.level())
        assertEquals(1f, s.ringFraction())
        assertEquals("Alex", s.kidName)
        assertEquals("phone", s.deviceWord)
    }

    @Test
    fun tenMinutesLeftIsLowAndTheRingShowsWhatIsLeft() {
        val s = statusAt("10:50", state(segments = used("10:00", "10:50")))

        assertEquals(600L, s.leftSec)
        assertEquals("Phone · 10m left", s.title())
        assertEquals(Level.LOW, s.level())
        assertEquals(Level.CRITICAL, s.level(300))
        assertEquals(1f / 6, s.ringFraction(), 0.0001f)
        assertEquals("10m", s.ringText())
        assertEquals("<1m", s.ringText(59))
    }

    @Test
    fun bedtimeCutsTheTimeLeftShort() {
        val s = statusAt("20:20", state(pool = "screens"))

        assertEquals(600L, s.leftSec)
        assertEquals("Screens · 10m left", s.title())
        assertEquals("8:30 pm", s.lockAtText)
        assertEquals(Level.LOW, s.level())
    }

    @Test
    fun lockedStatesSayWhyAndWhenItIsBack() {
        val bedtime = statusAt("21:00")
        assertEquals(LockReason.BEDTIME, bedtime.lockReason)
        assertEquals("It's bedtime", bedtime.title())
        assertEquals("Phone is back at 7:00 am", bedtime.subline())
        assertEquals(0L, bedtime.leftSec)
        assertNull(bedtime.lockAtMs)
        assertEquals(Level.LOCKED, bedtime.level())
        assertEquals(0f, bedtime.ringFraction())

        val early = statusAt("06:00")
        assertEquals("Not yet, it's early", early.title())
        assertEquals("Phone is back at 7:00 am", early.subline())

        val out = statusAt("09:30", state(segments = used("08:00", "09:00")))
        assertEquals("Out of Phone time", out.title())
        assertEquals("New time tomorrow", out.subline())
    }

    @Test
    fun theScreenCountsDownFromTheElapsedClock() {
        val s = statusAt("10:00", elapsedMs = 5_000)

        assertEquals(3600L - 90, s.leftSecAt(95_000))
        assertEquals(0L, s.leftSecAt(5_000 + 4_000_000))
    }

    @Test
    fun clockTextIsTwelveHour() {
        assertEquals("12:05 am", clockText(LocalTime.parse("00:05")))
        assertEquals("12:00 pm", clockText(LocalTime.parse("12:00")))
        assertEquals("8:30 pm", clockText(LocalTime.parse("20:30")))
        assertEquals("7:00 am", clockText(LocalTime.parse("07:00")))
    }

    @Test
    fun theNextCheckIsTheNextWarningOrTheLockAndAtLeastEveryMinute() {
        // Locks at 11:00: the next event (warn 1 at 10:45) is far away, so one minute.
        assertEquals(at("10:01"), nextCheckAtMs(statusAt("10:00"), at("10:00")))
        // 10:44:30: warn 1 at 10:45.
        val now = at("10:44:30")
        assertEquals(at("10:45"), nextCheckAtMs(statusAt("10:00"), now))
        // 10:59:30: the lock at 11:00.
        assertEquals(at("11:00"), nextCheckAtMs(statusAt("10:00"), at("10:59:30")))
    }
}
```

### 5.11 `android/app-kid/src/test/kotlin/au/screentime/kid/status/WarningTrackerTest.kt`

```kotlin
package au.screentime.kid.status

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class WarningTrackerTest {
    /** A phone that locks at 8:30 pm with [leftSec] left; null means locked. Warnings at 15 and 5 minutes. */
    private fun left(leftSec: Long?) = KidStatus(
        kidName = "Alex",
        poolName = "Phone",
        deviceWord = "phone",
        lockReason = null,
        leftSec = leftSec ?: 0,
        usedSec = 0,
        lockAtMs = leftSec?.let { 1_000_000L },
        lockAtText = leftSec?.let { "8:30 pm" },
        reevaluateAtMs = 1_000_000L,
        bedtime = "8:30 pm",
        backAt = null,
        warn1Min = 15,
        warn2Min = 5,
        online = true,
        elapsedMs = 0,
    )

    private fun WarningTracker.run(vararg minutes: Double?): List<Warning?> =
        minutes.map { check(left(it?.let { m -> (m * 60).toLong() })) }

    @Test
    fun eachWarningShowsOnceOnTheWayDown() {
        val shown = WarningTracker().run(20.0, 15.0, 14.0, 10.0, 5.0, 4.0, 1.0, 0.0)

        assertEquals(listOf(null, Warning.FIRST, null, null, Warning.SECOND, null, null, null), shown)
    }

    @Test
    fun startingWithLittleTimeLeftShowsOnlyTheSecond() {
        val shown = WarningTracker().run(3.0, 2.0)

        assertEquals(listOf(Warning.SECOND, null), shown)
    }

    @Test
    fun moreTimeFromAParentLetsTheWarningsShowAgain() {
        val shown = WarningTracker().run(4.0, 25.0, 15.0, 5.0)

        assertEquals(listOf(Warning.SECOND, null, Warning.FIRST, Warning.SECOND), shown)
    }

    @Test
    fun lockedThenUnlockedWarnsAgain() {
        val shown = WarningTracker().run(4.0, null, 10.0)

        assertEquals(listOf(Warning.SECOND, null, Warning.FIRST), shown)
    }

    @Test
    fun theWordsSayHowLongAndWhen() {
        val s = left(600)

        assertEquals("15 minutes left", warningTitle(s, Warning.FIRST))
        assertEquals("This phone locks at 8:30 pm.", warningText(s, Warning.FIRST))
        assertEquals("5 minutes left", warningTitle(s, Warning.SECOND))
        assertEquals("This phone locks at 8:30 pm. Time to finish up.", warningText(s, Warning.SECOND))
        assertNull(WarningTracker().check(left(null)))
    }
}
```

## 6. Detailed spec

### 6.1 What the kid sees

| Situation | Notification title | Notification text | Ring (main screen) | Under the ring |
|---|---|---|---|---|
| 1h 12m to the lock | `Phone · 1h 12m left` | `Bedtime 8:30 pm` | `1h 12m`, `Phone left`, teal arc | `Bedtime 8:30 pm` |
| 15 min or less | `Phone · 15m left` | `Bedtime 8:30 pm` | amber arc | same |
| 5 min or less | `Phone · 5m left` | `Bedtime 8:30 pm` | orange arc | same |
| Bedtime (after 8:30 pm) | `It's bedtime` | `Phone is back at 7:00 am` | `It's bedtime`, no arc | `Phone is back at 7:00 am` |
| Before wake-up | `Not yet, it's early` | `Phone is back at 7:00 am` | `Not yet, it's early` | same |
| Allowance used up | `Out of Phone time` | `New time tomorrow` | `Out of Phone time` | `New time tomorrow` |
| Last sync failed | as above, sub text `Offline` | | | `Offline · still counting` |

A device in the Screens pool says "Screens" instead of "Phone" in the title and the ring ("Screens · 1h left", "Screens left"); "Phone is back" becomes "Tablet is back" on a tablet. When unlocked and a lock is coming, the notification also shows the system chronometer counting down to it. Before the first sync the main screen shows a spinner and "Getting your time…".

### 6.2 Warnings

| When | Title | Text | Extra |
|---|---|---|---|
| Time to the lock falls to `warn1Min` (15) while in use | `15 minutes left` | `This phone locks at 8:30 pm.` | heads-up, no sound |
| Time to the lock falls to `warn2Min` (5) while in use | `5 minutes left` | `This phone locks at 8:30 pm. Time to finish up.` | heads-up, a short double buzz on a phone |

Each warning shows once. When a parent adds time and the time left goes back above a threshold, that warning can show again later. Starting with less than 5 minutes left shows only the second. The warning notification goes away by itself at the lock.

### 6.3 When the service looks again

The service's loop sleeps until the first of: warn 1, warn 2, the lock, the engine's `reevaluateAt` (wake-up, bedtime, midnight), and one minute from now. While the screen is off it sleeps a minute at a time and does nothing. An unlock runs the engine at once.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-032-time-left
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-032-time-left.md` and `server/scripts/dev-bedtime.ts` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create or replace 5.1 to 5.9. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-032: status, warnings, notification and the main screen`.
3. Create 5.10 and 5.11. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-032: status and warning tests`.
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
  au.screentime.kid.usage.RecorderTest tests="9" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```
- [ ] The merged debug manifest has the vibrate permission and still has the service. From `android`, this prints `True` twice:
  ```powershell
  $m = Get-Content app-kid\build\intermediates\merged_manifest\debug\processDebugMainManifest\AndroidManifest.xml -Raw
  $m -match 'android.permission.VIBRATE'
  $m -match 'android:foregroundServiceType="systemExempted"'
  ```

### 8.2 On the emulator

Run every step below **in this session**, even if an earlier session ran something similar. Paste the real output into the handback. "NOT RUN: a previous session ran them" is not accepted.

**The emulator.** Use the same emulator as in CARD-031, with nobody signed in. Remove the app from CARD-031 first (each command prints `Success...`, or an error if there was nothing to remove; both are fine), and keep the screen from turning off by itself for 30 minutes:

```powershell
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

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Segments` lists the device's segments on the server, with their length in seconds. `Bedtime` moves Alex's bedtime to the given minutes from now. `Notes` prints the titles and texts of the app's notifications.

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
function Bedtime([int]$minutes) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-bedtime.ts Alex $minutes
}
function Notes {
  & $adb shell dumpsys notification --noredact | Select-String 'pkg=au.screentime.kid|android.title=|android.text=|android.subText=' | ForEach-Object { $_.Line.Trim() }
}
```

`Bedtime` prints `Bedtime for Alex today is now HH:MM (Australia/Sydney), schedule version N.` Write down each `HH:MM`; the expected results below use it. `Notes` also prints lines of other apps' notifications; only look at the ones under `pkg=au.screentime.kid`.

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
   & $adb shell settings put system user_rotation 1
   Start-Sleep -Seconds 3
   Shot "2-landscape"
   & $adb shell settings put system user_rotation 0
   Start-Sleep -Seconds 3
   ```
   `1-home` shows "Hi Alex" at the top left, a teal ring with about `30m` (29m to 31m) and "Phone left" in it, and "Bedtime <HH:MM>" under it in 12-hour time (for example `Bedtime 2:47 pm`). `2-landscape` shows the ring on the left half and "Hi Alex" and the bedtime line on the right half.
2. The service runs and its notification shows the time left:
   ```powershell
   & $adb shell dumpsys activity services au.screentime.kid | Select-String 'KidService'
   Notes
   & $adb shell cmd statusbar expand-notifications
   Start-Sleep -Seconds 2
   Shot "3-notification"
   & $adb shell cmd statusbar collapse
   & $adb logcat -d -s KidService:I
   ```
   `Select-String` prints at least one line with `au.screentime.kid/.service.KidService`. `Notes` shows `android.title=String (Phone · 29m left)` (or 28m to 30m) and `android.text=String (Bedtime <HH:MM>)`. `3-notification` shows that notification with the hourglass icon and a countdown timer. The log has lines like `pool=phone used=...s remaining=...s left=...s locked=false online=true segments=1`.
3. One segment (from CARD-031). Leave the screen on for 70 seconds, then turn it off:
   ```powershell
   Start-Sleep -Seconds 70
   Screen-Off
   Segments
   ```
   One row: `seconds` 70 or more, `open` f, `recorded_offline` f.
4. Offline (from CARD-031). Stop the API, use the screen, turn it off and on again (both syncs fail), look at the app, then start the API and unlock:
   ```powershell
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env stop api
   Screen-On
   Start-Sleep -Seconds 70
   Screen-Off
   Screen-On
   Open-App
   Start-Sleep -Seconds 5
   Shot "4-offline"
   Notes
   Screen-Off
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env start api
   Start-Sleep -Seconds 15
   Screen-On
   Start-Sleep -Seconds 10
   Segments
   ```
   `4-offline` shows "Offline · still counting" under the bedtime line. `Notes` shows `android.subText=String (Offline)`. `Segments` shows four rows, oldest first: (70 or more, f, f), (70 or more, f, **t**), (a few seconds, f, **t**), (empty `seconds`, **t** `open`, f). If `curl.exe -s http://localhost:8080/health` does not show `"status":"ok"` after the 15 seconds, wait until it does, then do the last three lines again.
5. The first warning. Bedtime in 16 minutes; turn the screen off and on so the app syncs the new schedule; wait until 15 minutes are left:
   ```powershell
   Bedtime 16
   Screen-Off
   Screen-On
   Open-App
   Start-Sleep -Seconds 120
   Notes
   & $adb shell cmd statusbar expand-notifications
   Start-Sleep -Seconds 2
   Shot "5-warning"
   & $adb shell cmd statusbar collapse
   ```
   `Notes` shows `android.title=String (15 minutes left)` and `android.text=String (This phone locks at <HH:MM>.)`, with the `HH:MM` that `Bedtime 16` printed in 12-hour time. `5-warning` shows that warning in the shade, above or below the status notification (which now says `Phone · 14m left` or `13m`). On the main screen the ring is amber.
6. The second warning. Bedtime in 6 minutes:
   ```powershell
   Bedtime 6
   Screen-Off
   Screen-On
   Open-App
   Start-Sleep -Seconds 120
   Notes
   ```
   `Notes` shows `android.title=String (5 minutes left)` and `android.text=String (This phone locks at <HH:MM>. Time to finish up.)`. (The emulator does not buzz; that is fine.)
7. The bedtime lock. Bedtime in 1 minute, then wait for it:
   ```powershell
   Bedtime 1
   Screen-Off
   Screen-On
   Open-App
   Start-Sleep -Seconds 150
   Shot "6-bedtime"
   Notes
   & $adb logcat -d -s KidService:I | Select-Object -Last 3
   ```
   `6-bedtime` shows "Hi Alex", the empty grey ring with "It's bedtime" in it, and "Phone is back at 7:00 am" under it (8:00 am if tomorrow is Saturday or Sunday). `Notes` shows `android.title=String (It's bedtime)` and no `minutes left` warning any more. The last log lines say `locked=true`. Nothing is locked yet; that is CARD-033.
8. After a reboot the service runs again (from CARD-031):
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
   `Select-String` again prints a line with `au.screentime.kid/.service.KidService`. In `Segments` every row is closed (`open` f) except one new open segment at the end.
9. Undo, so the emulator can be used again:
   ```powershell
   & $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb uninstall au.screentime.kid
   & $adb shell settings put system screen_off_timeout 60000
   cd ..
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item Env:DATABASE_URL
   ```
   `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success`.

- [ ] Steps 1 to 9 gave the expected results, run in this session. Paste into the handback: the `Notes` lines under `pkg=au.screentime.kid` of steps 2, 4, 5, 6 and 7, the `Segments` output of steps 3, 4 and 8, the `Bedtime` lines, and the `KidService` log lines of steps 2 and 7.
- [ ] The six screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c32\`: `1-home.png`, `2-landscape.png`, `3-notification.png`, `4-offline.png`, `5-warning.png`, `6-bedtime.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 11 files (in any order):
  ```
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/setup/SetupViewModel.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/Warnings.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/status/WarningTrackerTest.kt
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt` | With plenty of time: title, bedtime line, lock time, level and a full ring. With 10 minutes left: low (critical at 5), the ring shows the part left, `<1m` in the last minute. A bedtime before the allowance runs out cuts the time left. Bedtime, early morning and out of time each say why and when it is back. The screen counts down from the elapsed clock, never below 0. 12-hour times. The next check is the next warning or the lock, and at least once a minute. |
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/WarningTrackerTest.kt` | Each warning shows once on the way down. Starting under 5 minutes shows only the second. More time lets both show again. Locked then unlocked warns again. The titles and texts. |

The notification, the service timing and the screen are checked by the emulator run in 8.2, not by unit tests.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-032: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-032-time-left`
5. Open a PR into `main` titled `CARD-032: Time left, warnings and the main screen`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-032-time-left --title "CARD-032: Time left, warnings and the main screen" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-032-time-left.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: eleven suites, KidStatusTest 7, WarningTrackerTest 5, all `failures="0"`
   - [x] merged debug manifest — output: `True` twice
   - [x] emulator run steps 1 to 9 — results as expected
   - [x] six screenshots in C:\Users\james\OpenCode\Testing\temp\c32\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 11 files

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

- **`1-home` still shows "Getting your time…" after 10 seconds**: the first sync has not finished. Wait 20 more seconds and take the shot again. If it stays, paste `& $adb logcat -d -s KidService` into the handback.
- **`Bedtime` says the bedtime would be after midnight**: it is too late in the day. Do the run the next day after 6 am.
- **`Bedtime` prints `Usage: ...`**: you are not in `android`, or `$env:DATABASE_URL` is not set in this window.
- **No warning in step 5 or 6**: the warning only shows while the screen is on and unlocked. Check that `Screen-On` left the emulator unlocked (`5-warning` would show the lock screen). Paste the last 10 `KidService` log lines into the handback. Do not change the code.
- **The warning disappeared from the top of the screen before the shot**: that is normal for a heads-up notification; it stays in the shade, which is what `5-warning` shows.
- **The time in a notification text is not in 12-hour time, or the `·` shows as another character**: paste the `Notes` line exactly as printed; do not change the code.
- **`Segments` in step 4 shows three rows, not four**: the screen-on in the middle did not sync. Paste the `KidService` log lines of step 4. Do not change the code.
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
Claude, here is Bob's handback for CARD-032. Please review and merge if it is good.

CARD: CARD-032 Time left, warnings and the main screen
PR: <full PR URL>
Branch: bob/card-032-time-left
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
