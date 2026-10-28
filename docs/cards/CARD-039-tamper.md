# CARD-039: Tamper detection and the caught screen

| Field | Value |
|---|---|
| Card | CARD-039 |
| Title | Tamper detection and the caught screen |
| Size | M |
| Depends on | CARD-038c (SOS texts on their own thread), merged to `main` |
| Spec sections | docs/SPEC.md §14 ("Tamper detection", "As built (CARD-039)"), §9.2 (`POST /v1/device/events`) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-039-tamper` |
| PR title | `CARD-039: Tamper detection and the caught screen` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

The Android kid app is Device Owner, so it already **stops** most tricks (uninstall, safe mode, factory reset, changing the date in Settings). This card makes it **notice and report** the attempts it cannot simply stop, and show the kid a cheesy "caught" screen. The server side is already built: `POST /v1/device/events` stores each event and notifies the parents.

The kid app now detects three kinds of attempt (docs/SPEC.md §14):

| Kind | When |
|---|---|
| `tamper.clock` | Android says the clock was set, and the phone's clock is now more than 2 minutes away from trusted time (the server's time plus the time since the last answer). Payload `offsetMin`: minutes ahead, negative when behind. |
| `tamper.policy` | A Device Owner policy that was on after the last start is found off, and is turned on again. Payload `missing`: the names, comma-separated. |
| `tamper.call_blocked` | `CallGuard` stopped a call to a number that is not on the list, while blocked. No payload: the number is never sent or logged. |

The same kind again within a minute counts as the same attempt: it is only logged. Events wait in a queue (SharedPreferences `tamper`) and go to the server before every sync, so an attempt made offline is sent when the phone is back online.

The **caught screen** (`tamper/CaughtActivity`) covers everything for 8 seconds, then closes itself: it fades between police blue and red and shows a big emoji, a headline, a line with the parents' names, a tilted "REPORTED" stamp and "Back in 8 s". Three versions take turns. While the phone is blocked it sits on top of the block screen, and the block screen is still there when it closes.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with the new `TamperTest` (9 tests); the emulator run passes: a clock set 10 minutes ahead, a pretend missing policy and a blocked call each show the caught screen and reach the server's `events` table, a repeat within a minute does neither, and a blocked call made offline reaches the server within a minute of going back online; the six screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No server, web, `packages/` or `docs/` change. No parent app, no FCM (CARD-034b), no Windows (CARD-051).
- No other change to the app than the 9 files in section 5: not `core-model`, `core-time`, `core-ui`, `app-parent`, no `build.gradle.kts` or `libs.versions.toml`. No new dependency of any kind.
- No event for a missing call redirection role: it stays a warning in the log.
- Never run the app on a real phone or tablet in this card. Never install a **release** build anywhere.
- **Never tap Emergency 000**, on the emulator or anywhere, and never place a call to an emergency number. The only numbers you call in this card are `0400111222` (made up).
- No change to the Gradle wrapper files.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, Room 2.8.5, KSP 2.3.12, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36. No new library.

Claude built this exact code in GitHub Actions before writing the card, so it compiles and the tests pass. Claude also checked on James's emulator that `adb shell cmd alarm set-time` moves the clock while the app is Device Owner, which is how step 2 tries a clock change.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c39"
New-Item -ItemType Directory -Force $t | Out-Null
```

**If you are ever stuck inside the block screen on the emulator**, this always gets you out: `& $adb shell am task lock stop`.

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy each code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â`, `â€` or `ðŸ` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7), `…` (U+2026) and the emoji `🕵️` (U+1F575 U+FE0F: two characters), `🚨` (U+1F6A8) and `💻` (U+1F4BB); copy them exactly.

| File | Action |
|---|---|
| `android/app-kid/src/main/kotlin/au/screentime/kid/tamper/Tamper.kt` | create (5.1) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/tamper/TamperStore.kt` | create (5.2) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/tamper/CaughtActivity.kt` | create (5.3) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt` | replace (5.4) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt` | replace (5.5) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/calls/CallGuard.kt` | replace (5.6) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt` | replace (5.7) |
| `android/app-kid/src/main/AndroidManifest.xml` | replace (5.8) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/tamper/TamperTest.kt` | create (5.9) |

That is 9 files: 4 new, 5 replaced.

### 5.1 `android/app-kid/src/main/kotlin/au/screentime/kid/tamper/Tamper.kt`

New. The rules with no Android in them, so they can be unit-tested: the 2-minute clock check, which policies are missing, the one-minute repeat, the event as the server reads it, the queue limit, the three caught lines, and `TamperApi`, which uploads the queue.

```kotlin
package au.screentime.kid.tamper

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.DeviceEventIn
import au.screentime.core.model.api.DeviceEventKind
import au.screentime.core.model.api.DeviceEventUpload
import au.screentime.kid.status.parentsText
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.abs
import kotlin.math.roundToLong
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The phone's clock may be this far from trusted time before it counts as changed (docs/SPEC.md §14). */
const val CLOCK_SLACK_MS = 2 * 60_000L

/** The same kind of attempt again within this time is the same attempt: no second event, no second caught screen. */
const val REPEAT_MS = 60_000L

/** How long the caught screen stays up, in seconds. */
const val CAUGHT_SEC = 8

/** At most this many events wait to be sent; the oldest go first. */
const val MAX_QUEUE = 100

/** Events in one upload (docs/SPEC.md §9.2). */
const val MAX_UPLOAD = 50

/**
 * The phone's clock was set to [wallMs] while trusted time says [trustedMs]: the minutes it is ahead, rounded (negative
 * when behind), or null when it is within 2 minutes, which is only the clock putting itself right.
 */
fun clockJumpMin(wallMs: Long, trustedMs: Long): Long? {
    val diff = wallMs - trustedMs
    return if (abs(diff) > CLOCK_SLACK_MS) (diff / 60_000.0).roundToLong() else null
}

/**
 * The policies that were on after the last start and are off now, so someone turned them off (docs/SPEC.md §14).
 * A policy that is new in this version of the app was never on, so it is not missing.
 */
fun missingPolicies(before: Set<String>, now: Set<String>): List<String> = (before - now).sorted()

/** True when an attempt of the same kind was recorded less than a minute before [nowMs]. */
fun isRepeat(lastAtMs: Long?, nowMs: Long): Boolean = lastAtMs != null && nowMs - lastAtMs in 0 until REPEAT_MS

/** One event for `POST /v1/device/events`, at trusted time [atMs]. */
fun tamperEvent(id: String, kind: DeviceEventKind, atMs: Long, payload: Map<String, String> = emptyMap()): DeviceEventIn =
    DeviceEventIn(
        id = id,
        kind = kind,
        at = Instant.ofEpochMilli(atMs).toString(),
        payload = if (payload.isEmpty()) null else JsonObject(payload.mapValues { JsonPrimitive(it.value) }),
    )

/** The queue with [event] at the end, keeping only the newest [MAX_QUEUE]. */
fun List<DeviceEventIn>.plusEvent(event: DeviceEventIn): List<DeviceEventIn> = (this + event).takeLast(MAX_QUEUE)

/** What the caught screen says (docs/SPEC.md §14): a big emoji, a headline and one line under it. */
data class CaughtLine(val emoji: String, val title: String, val body: String)

/**
 * The [n]th caught screen: the three lines of docs/SPEC.md §14 take turns, with the kid's name and the parents'
 * names ("Mum and Dad have been told.", "Dad has been told.").
 */
fun caughtLine(n: Int, kidName: String, parentNames: List<String>): CaughtLine {
    val parents = parentsText(parentNames, "and")
    val told = if (parentNames.size == 1) "has" else "have"
    return when (Math.floorMod(n, 3)) {
        0 -> {
            val who = parents.replaceFirstChar { it.uppercase() }
            CaughtLine("🕵️", "Nice try, Agent $kidName!", "$who $told been told.")
        }
        1 -> CaughtLine("🚨", "Busted!", "The Time Police have filed a report.")
        else -> CaughtLine("💻", "Whoa there, hacker!", "This attempt has been sent to HQ ($parents).")
    }
}

/** Sends tamper events to the server (docs/SPEC.md §9.2). */
class TamperApi(private val api: ApiClient) {
    /**
     * Sends [queue], oldest first, [MAX_UPLOAD] at a time, and returns the events that went. Stops at the first upload
     * that does not get through. Any answer from the server counts as sent: sending it again would get the same answer.
     */
    suspend fun flush(queue: List<DeviceEventIn>): List<DeviceEventIn> {
        val sent = mutableListOf<DeviceEventIn>()
        for (batch in queue.chunked(MAX_UPLOAD)) {
            try {
                api.postDeviceEvents(DeviceEventUpload(batch))
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                // Stored or refused, it would be the same next time.
            } catch (e: Exception) {
                return sent
            }
            sent += batch
        }
        return sent
    }
}
```

### 5.2 `android/app-kid/src/main/kotlin/au/screentime/kid/tamper/TamperStore.kt`

New. The queue, the time of the last attempt of each kind, and the caught screen counter, in SharedPreferences `tamper`.

```kotlin
package au.screentime.kid.tamper

import android.content.Context
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceEventIn
import au.screentime.core.model.api.DeviceEventKind
import kotlinx.serialization.builtins.ListSerializer

/**
 * Tamper events the server has not got yet, and what the service needs to know about past attempts, in
 * SharedPreferences, so a queue made offline is still sent after a restart. Only the service uses it.
 */
class TamperStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("tamper", Context.MODE_PRIVATE)
    private val list = ListSerializer(DeviceEventIn.serializer())

    /** The events still to send, oldest first. */
    fun queue(): List<DeviceEventIn> = try {
        prefs.getString(QUEUE, null)?.let { ApiJson.decodeFromString(list, it) }.orEmpty()
    } catch (e: IllegalArgumentException) {
        // Not readable (SerializationException is an IllegalArgumentException): nothing to send.
        emptyList()
    }

    fun saveQueue(events: List<DeviceEventIn>) {
        prefs.edit().putString(QUEUE, ApiJson.encodeToString(list, events)).commit()
    }

    /** Trusted time of the last attempt of [kind] that was recorded. */
    fun lastAt(kind: DeviceEventKind): Long? = prefs.getLong(LAST + kind.wire, -1).takeIf { it >= 0 }

    fun setLastAt(kind: DeviceEventKind, atMs: Long) {
        prefs.edit().putLong(LAST + kind.wire, atMs).commit()
    }

    /** Which caught screen comes next: 0, 1, 2, 3, … */
    fun nextCaught(): Int {
        val n = prefs.getInt(CAUGHT, 0)
        prefs.edit().putInt(CAUGHT, n + 1).commit()
        return n
    }

    private companion object {
        const val QUEUE = "queue"
        const val LAST = "lastAt."
        const val CAUGHT = "caught"
    }
}
```

### 5.3 `android/app-kid/src/main/kotlin/au/screentime/kid/tamper/CaughtActivity.kt`

New. The caught screen. The look: the whole screen fades between blue `#1D4ED8` and red `#B91C1C` (600 ms each way). In the middle, one under the other: the emoji at 96 sp; 24 dp; the headline, white, 34 sp, the heaviest weight; 12 dp; the line under it, white at 90%, 20 sp; 40 dp; the word "REPORTED" in white, 28 sp, the heaviest weight, wide letter spacing, in a white 3 dp rounded box, tilted 8 degrees to the left like a stamp; 40 dp; "Back in 8 s" counting down, white at 70%, 14 sp.

```kotlin
package au.screentime.kid.tamper

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
import androidx.compose.animation.animateColor
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.service.KidService
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.delay

/** The two colours the caught screen fades between, like the lights on a police car. */
private val PoliceBlue = Color(0xFF1D4ED8)
private val PoliceRed = Color(0xFFB91C1C)

/**
 * The "caught" screen (docs/SPEC.md §14): after a tamper attempt, cheesy on purpose, over everything for 8 seconds,
 * then it closes itself. Back does nothing. It opens in the block screen's task, so while the device is blocked it
 * sits on top of the block screen in Lock Task, and the block screen is what is left when it closes.
 */
class CaughtActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.insetsController?.let {
            it.hide(WindowInsets.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })
        setContent {
            val line by StatusHub.caught.collectAsState()
            var left by remember { mutableIntStateOf(CAUGHT_SEC) }
            LaunchedEffect(Unit) {
                while (left > 0) {
                    delay(1_000)
                    left -= 1
                }
                close()
            }
            ScreenTimeTheme {
                line?.let { CaughtScreen(it, left) }
            }
        }
    }

    private fun close() {
        StatusHub.caught.value = null
        Log.i(TAG, "closed")
        finish()
        // Whatever applies now (the block screen, or nothing) shows at once, not at the next tick.
        KidService.syncSoon(this)
    }

    companion object {
        private const val TAG = "CaughtActivity"

        /** Shows [StatusHub.caught], from the service. */
        fun show(context: Context) {
            context.startActivity(Intent(context, CaughtActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

/**
 * Full screen, fading between police blue and red. In the middle: the emoji (96 sp), the headline (34 sp, black
 * weight), the line under it (20 sp), a white "REPORTED" stamp tipped to one side, and "Back in 8 s" counting down.
 */
@Composable
private fun CaughtScreen(line: CaughtLine, left: Int) {
    val lights = rememberInfiniteTransition(label = "lights")
    val background by lights.animateColor(
        initialValue = PoliceBlue,
        targetValue = PoliceRed,
        animationSpec = infiniteRepeatable(tween(600, easing = LinearEasing), RepeatMode.Reverse),
        label = "background",
    )
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
            .safeDrawingPadding()
            .padding(horizontal = 32.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(line.emoji, fontSize = 96.sp)
        Spacer(Modifier.height(24.dp))
        Text(
            text = line.title,
            fontSize = 34.sp,
            lineHeight = 40.sp,
            fontWeight = FontWeight.Black,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = line.body,
            fontSize = 20.sp,
            lineHeight = 28.sp,
            color = Color.White.copy(alpha = 0.9f),
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(40.dp))
        Text(
            text = "REPORTED",
            modifier = Modifier
                .rotate(-8f)
                .border(3.dp, Color.White, RoundedCornerShape(8.dp))
                .padding(horizontal = 16.dp, vertical = 8.dp),
            fontSize = 28.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 4.sp,
            color = Color.White,
        )
        Spacer(Modifier.height(40.dp))
        Text(
            text = "Back in $left s",
            fontSize = 14.sp,
            color = Color.White.copy(alpha = 0.7f),
        )
    }
}
```

### 5.4 `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt`

Replace the whole file. Compared with `main`: one import and `caught`, what the caught screen shows while it is up.

```kotlin
package au.screentime.kid.status

import au.screentime.kid.live.Answer
import au.screentime.kid.live.ParentModeNews
import au.screentime.kid.sos.SosView
import au.screentime.kid.tamper.CaughtLine
import kotlinx.coroutines.flow.MutableStateFlow

/** The latest status, from the service to the screens of the same process. Null until the first sync. */
object StatusHub {
    val status = MutableStateFlow<KidStatus?>(null)

    /** A parent's answer that just came in; the screen showing it sets it back to null after 4 seconds. */
    val answer = MutableStateFlow<Answer?>(null)

    /** True while the "Hand to a parent" sheet is open: the service keeps the live channel open for the answer. */
    val parentModeAsked = MutableStateFlow(false)

    /** The last `parent_mode` message; the "Hand to a parent" sheet shows a no. */
    val parentModeNews = MutableStateFlow<ParentModeNews?>(null)

    /** The SOS that is on (docs/SPEC.md §15); the screens show it over everything. */
    val sos = MutableStateFlow<SosView?>(null)

    /**
     * `SystemClock.elapsedRealtime()` when the SOS countdown started, `SOS_FIRED` once it finished, null when there is
     * none. The service sets it back to null when it shows the SOS.
     */
    val sosCountdown = MutableStateFlow<Long?>(null)

    /** What the caught screen says while it is up (docs/SPEC.md §14); it sets it back to null when it closes. */
    val caught = MutableStateFlow<CaughtLine?>(null)
}
```

### 5.5 `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt`

Replace the whole file. Compared with `main`: `apply` reads back which policies are on before and after applying them (`onNow`), and `checkAgainst` keeps what was found off for the service, which asks with `takeMissing`. Both are `@Synchronized`: the setup screen and the service can call them at the same time.

```kotlin
package au.screentime.kid.admin

import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import android.os.UserManager
import android.telecom.TelecomManager
import android.util.Log
import au.screentime.kid.BuildConfig
import au.screentime.kid.tamper.missingPolicies

/** The Device Owner policies of docs/SPEC.md §12.1. Applying them again changes nothing, so the app does it on every start. */
object Policies {
    private const val TAG = "Policies"

    /** Names for the policies that are not user restrictions, as [onNow] reports them. */
    private const val AUTO_TIME = "auto_time"
    private const val AUTO_TIME_ZONE = "auto_time_zone"
    private const val UNINSTALL_BLOCKED = "uninstall_blocked"

    /** Keys in the "policies" SharedPreferences: what was on after the last [apply], and what was found off since. */
    private const val APPLIED = "applied"
    private const val MISSING = "missing"

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
     * A policy that was on after the last time and is found off is a tamper attempt (docs/SPEC.md §14): it is turned
     * on again here, and kept for the service, which asks with [takeMissing].
     */
    @Synchronized
    fun apply(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        val before = onNow(context, dpm, admin)

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
        // power menu and the phone's own lock screen (with its emergency call button) still work. On a phone with a
        // SIM the phone app may run too, for its call screen and the emergency dialer.
        dpm.setLockTaskPackages(admin, (listOf(context.packageName) + phonePackages(context)).distinct().toTypedArray())
        dpm.setLockTaskFeatures(
            admin,
            DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD,
        )
        grantRuntimePermissions(context)
        checkAgainst(context, before, onNow(context, dpm, admin))
        if (canCall(context) && !context.getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_CALL_REDIRECTION)) {
            // Without it every call goes through while blocked. Given with adb at setup (docs/SPEC.md §12.1).
            Log.w(TAG, "calls: not the call redirection app, so calls are not checked while blocked")
        }
    }

    /**
     * The policies that were on after the last [apply] and found off before this one, since the service last asked;
     * empty when none. Asking forgets them.
     */
    @Synchronized
    fun takeMissing(context: Context): List<String> {
        val prefs = prefs(context)
        val missing = prefs.getStringSet(MISSING, null).orEmpty().sorted()
        if (missing.isNotEmpty()) prefs.edit().remove(MISSING).commit()
        return missing
    }

    /** Keeps what was on [before] this run but on [after] the last one, and remembers [after] for the next run. */
    private fun checkAgainst(context: Context, before: Set<String>, after: Set<String>) {
        val prefs = prefs(context)
        // Nothing to compare with the first time, after setup.
        val missing = prefs.getStringSet(APPLIED, null)?.let { missingPolicies(it, before) }.orEmpty()
        if (missing.isNotEmpty()) Log.w(TAG, "policies: found off and turned on again: ${missing.joinToString()}")
        prefs.edit()
            .putStringSet(APPLIED, after)
            .putStringSet(MISSING, prefs.getStringSet(MISSING, null).orEmpty() + missing)
            .commit()
    }

    /** Which of the policies [apply] turns on are on right now, by name: a restriction, auto time, uninstall blocked. */
    private fun onNow(context: Context, dpm: DevicePolicyManager, admin: ComponentName): Set<String> {
        val restrictions = dpm.getUserRestrictions(admin)
        val names = RESTRICTIONS.filter { restrictions.getBoolean(it) }.toMutableSet()
        if (!BuildConfig.DEBUG) {
            val debugging = UserManager.DISALLOW_DEBUGGING_FEATURES
            if (restrictions.getBoolean(debugging)) names += debugging
            if (dpm.isUninstallBlocked(admin, context.packageName)) names += UNINSTALL_BLOCKED
        }
        if (dpm.getAutoTimeEnabled(admin)) names += AUTO_TIME
        if (dpm.getAutoTimeZoneEnabled(admin)) names += AUTO_TIME_ZONE
        return names
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences("policies", Context.MODE_PRIVATE)

    private fun canCall(context: Context): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_CALLING)

    /**
     * The phone app (the default one and the one the phone came with; often the same) and Android's call service,
     * which shows a "Call with" choice on a phone with two SIMs. None on a tablet.
     */
    private fun phonePackages(context: Context): List<String> {
        if (!canCall(context)) return emptyList()
        val telecom = context.getSystemService(TelecomManager::class.java)
        return listOfNotNull(telecom.defaultDialerPackage, telecom.systemDialerPackage, "com.android.server.telecom")
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

### 5.6 `android/app-kid/src/main/kotlin/au/screentime/kid/calls/CallGuard.kt`

Replace the whole file. Compared with `main`: a stopped call also tells the service (`KidService.callBlocked`), and the comment says so.

```kotlin
package au.screentime.kid.calls

import android.net.Uri
import android.telecom.CallRedirectionService
import android.telecom.PhoneAccountHandle
import android.util.Log
import android.widget.Toast
import au.screentime.kid.service.KidService
import au.screentime.kid.status.StatusHub

/**
 * Stops calls to numbers that are not on the kid's list while the device is blocked (docs/SPEC.md §12.1). Android
 * asks it about every outgoing call, once the app holds the "call redirection" role (given with adb when the phone
 * is set up). Android never asks about emergency calls, so they always go through. While the device may be used,
 * or before the service has worked out the first status, every call goes through. A stopped call is a tamper attempt
 * (docs/SPEC.md §14): the service tells the parents and shows the caught screen.
 */
class CallGuard : CallRedirectionService() {
    override fun onPlaceCall(handle: Uri, initialPhoneAccount: PhoneAccountHandle, allowInteractiveResponse: Boolean) {
        val status = StatusHub.status.value
        val number = handle.schemeSpecificPart.orEmpty()
        if (status == null || !status.locked || mayCall(number, status.callables, status.emergencyNumber)) {
            Log.i(TAG, "call: allowed")
            placeCallUnmodified()
        } else {
            // Never log the number itself.
            Log.i(TAG, "call: blocked")
            cancelCall()
            Toast.makeText(this, "Right now you can only call the people on your list", Toast.LENGTH_LONG).show()
            KidService.callBlocked(this)
        }
    }

    private companion object {
        const val TAG = "CallGuard"
    }
}
```

### 5.7 `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

Replace the whole file. Compared with `main`: the store and API for tamper events; `TIME_SET` (`Intent.ACTION_TIME_CHANGED`) on the screen receiver; `checkPolicies` at each start; `onTimeSet`, `onTamper`, `showCaughtIfWanted` and `sendTamper`; `sync` sends the queue first; `report` shows a waiting caught screen, and does not show the block screen while the caught screen is up (showing it would close the caught screen); the `callBlocked` start.

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
import au.screentime.core.model.api.DeviceEventKind
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
import au.screentime.kid.tamper.CaughtActivity
import au.screentime.kid.tamper.TamperApi
import au.screentime.kid.tamper.TamperStore
import au.screentime.kid.tamper.caughtLine
import au.screentime.kid.tamper.clockJumpMin
import au.screentime.kid.tamper.isRepeat
import au.screentime.kid.tamper.plusEvent
import au.screentime.kid.tamper.tamperEvent
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
 * A tamper attempt (§14: the clock set by hand, a policy found off, a call stopped while blocked) goes to the server
 * with the next sync and shows the caught screen.
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
    private lateinit var tamper: TamperStore
    private var tamperApi: TamperApi? = null
    private var kidName = ""
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

    /** A tamper attempt was recorded and the kid has not seen the caught screen for it yet. */
    private var caughtWanted = false

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
                Intent.ACTION_TIME_CHANGED -> scope.launch { onTimeSet() }
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
        tamper = TamperStore(this)
        tamperApi = TamperApi(client)
        kidName = enrolment.kidName
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
            addAction(Intent.ACTION_TIME_CHANGED)
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
            // A start: the app, the setup screen or Android after a reboot. The policies were just applied again.
            null -> scope.launch { checkPolicies() }
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
            ACTION_CALL_BLOCKED -> scope.launch { onTamper(DeviceEventKind.TAMPER_CALL_BLOCKED) }
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
        showCaughtIfWanted()
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

    /** The phone's clock was set. Trusted time does not move; set more than 2 minutes away from it is an attempt. */
    private suspend fun onTimeSet() {
        if (!clock.isAnchored) return
        val offsetMin = clockJumpMin(System.currentTimeMillis(), clock.nowMs()) ?: return
        onTamper(DeviceEventKind.TAMPER_CLOCK, mapOf("offsetMin" to "$offsetMin"))
    }

    /** Device Owner policies found off and turned on again (see [Policies.apply]). */
    private suspend fun checkPolicies() {
        val missing = Policies.takeMissing(this)
        if (missing.isEmpty()) return
        onTamper(DeviceEventKind.TAMPER_POLICY, mapOf("missing" to missing.joinToString(",").take(200)))
    }

    /**
     * A tamper attempt (docs/SPEC.md §14): it is queued for the server and the kid sees the caught screen, now or when
     * they next unlock. The same kind again within a minute is the same attempt and is only logged.
     */
    private suspend fun onTamper(kind: DeviceEventKind, payload: Map<String, String> = emptyMap()) {
        val now = clock.nowMs()
        if (isRepeat(tamper.lastAt(kind), now)) {
            Log.i(TAG, "tamper: ${kind.wire} again")
            return
        }
        tamper.setLastAt(kind, now)
        tamper.saveQueue(tamper.queue().plusEvent(tamperEvent(UUID.randomUUID().toString(), kind, now, payload)))
        Log.i(TAG, "tamper: ${kind.wire}")
        caughtWanted = true
        showCaughtIfWanted()
        sync()
    }

    /** The caught screen, if one is wanted and the kid can see it: screen on and unlocked. Never over an SOS. */
    private fun showCaughtIfWanted() {
        if (!caughtWanted || !screenOn() || getSystemService(KeyguardManager::class.java).isKeyguardLocked) return
        caughtWanted = false
        if (sos.active) return
        val status = StatusHub.status.value
        val showing = StatusHub.caught.value != null
        val name = status?.kidName ?: kidName
        StatusHub.caught.value = caughtLine(tamper.nextCaught(), name, status?.parentNames.orEmpty())
        Log.i(TAG, "tamper: caught screen")
        if (!showing) CaughtActivity.show(this)
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
            // And whatever an SOS still has to send, and the tamper attempts.
            if (sos.pending) sos.tick()
            sendTamper()
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

    /** Sends the tamper events in the queue. An attempt recorded while they were on the way stays for the next sync. */
    private suspend fun sendTamper() {
        val queued = tamper.queue()
        if (queued.isEmpty()) return
        val sent = tamperApi?.flush(queued).orEmpty().map { it.id }.toSet()
        if (sent.isEmpty()) return
        tamper.saveQueue(tamper.queue().filterNot { it.id in sent })
        Log.i(TAG, "tamper: ${sent.size} sent")
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
        showCaughtIfWanted()
        // The block screen closes itself when StatusHub says unlocked. While the caught screen is up, it waits:
        // showing it would close the caught screen, which sits on top of it.
        if (blocked && screenOn() && StatusHub.caught.value == null) BlockActivity.show(this)
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
        private const val ACTION_CALL_BLOCKED = "au.screentime.kid.action.CALL_BLOCKED"

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

        /** [CallGuard][au.screentime.kid.calls.CallGuard] stopped a call while blocked: a tamper attempt. */
        fun callBlocked(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_CALL_BLOCKED))
        }
    }
}
```

### 5.8 `android/app-kid/src/main/AndroidManifest.xml`

Replace the whole file. Compared with `main`: the `CaughtActivity` entry with its comment, after the block screen's.

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

        <!--
            The "caught" screen after a tamper attempt (docs/SPEC.md §14), 8 seconds over everything. It joins the
            block screen's task, so while blocked it sits on top of the block screen in Lock Task. Kept out of
            Recents; only the app itself opens it.
        -->
        <activity
            android:name=".tamper.CaughtActivity"
            android:exported="false"
            android:excludeFromRecents="true"
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

### 5.9 `android/app-kid/src/test/kotlin/au/screentime/kid/tamper/TamperTest.kt`

New. 9 tests, described in section 9.

```kotlin
package au.screentime.kid.tamper

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.DeviceEventIn
import au.screentime.core.model.api.DeviceEventKind
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TamperTest {
    private val now = Instant.parse("2026-10-28T05:00:00Z").toEpochMilli()
    private val minute = 60_000L

    private fun event(n: Int) = tamperEvent("e$n", DeviceEventKind.TAMPER_CALL_BLOCKED, now + n)

    @Test
    fun aClockSetMoreThanTwoMinutesAwayIsAnAttempt() {
        assertNull(clockJumpMin(now, now))
        assertNull(clockJumpMin(now + 2 * minute, now))
        assertNull(clockJumpMin(now - 2 * minute, now))
        assertEquals(10L, clockJumpMin(now + 10 * minute + 5_000, now))
        // A server clock a little ahead of the phone's still makes 10.
        assertEquals(10L, clockJumpMin(now + 10 * minute - 800, now))
        assertEquals(-3L, clockJumpMin(now - 3 * minute, now))
    }

    @Test
    fun onlyAPolicyThatWasOnBeforeCanBeMissing() {
        assertEquals(listOf("auto_time", "no_safe_boot"), missingPolicies(setOf("no_safe_boot", "auto_time", "a"), setOf("a")))
        // New in this version of the app: never on, so not missing.
        assertEquals(emptyList<String>(), missingPolicies(setOf("a"), setOf("a", "no_add_user")))
        assertEquals(emptyList<String>(), missingPolicies(setOf("a", "b"), setOf("a", "b")))
    }

    @Test
    fun theSameKindWithinAMinuteIsTheSameAttempt() {
        assertFalse(isRepeat(null, now))
        assertTrue(isRepeat(now - 59_000, now))
        assertFalse(isRepeat(now - minute, now))
        // The last one is in the future: trusted time went back after a reboot without the server.
        assertFalse(isRepeat(now + 5_000, now))
    }

    @Test
    fun anEventIsSentAsTheServerReadsIt() {
        val clock = tamperEvent("e1", DeviceEventKind.TAMPER_CLOCK, now, mapOf("offsetMin" to "10"))
        assertEquals(
            """{"id":"e1","kind":"tamper.clock","at":"2026-10-28T05:00:00Z","payload":{"offsetMin":"10"}}""",
            ApiJson.encodeToString(DeviceEventIn.serializer(), clock),
        )
        assertEquals(
            """{"id":"e2","kind":"tamper.call_blocked","at":"2026-10-28T05:00:00Z"}""",
            ApiJson.encodeToString(DeviceEventIn.serializer(), tamperEvent("e2", DeviceEventKind.TAMPER_CALL_BLOCKED, now)),
        )
    }

    @Test
    fun theQueueKeepsTheNewestHundred() {
        val full = (1..MAX_QUEUE).map(::event)
        val more = full.plusEvent(event(101))

        assertEquals(MAX_QUEUE, more.size)
        assertEquals("e2", more.first().id)
        assertEquals("e101", more.last().id)
        assertEquals(listOf("e1"), emptyList<DeviceEventIn>().plusEvent(event(1)).map { it.id })
    }

    @Test
    fun theCaughtScreenTakesTurnsAndNamesTheParents() {
        val dad = listOf("Dad")
        val both = listOf("Mum", "Dad")

        assertEquals(CaughtLine("🕵️", "Nice try, Agent Alex!", "Dad has been told."), caughtLine(0, "Alex", dad))
        assertEquals("Mum and Dad have been told.", caughtLine(0, "Alex", both).body)
        assertEquals("Your parents have been told.", caughtLine(0, "Alex", emptyList()).body)
        assertEquals(CaughtLine("🚨", "Busted!", "The Time Police have filed a report."), caughtLine(1, "Alex", dad))
        assertEquals(
            CaughtLine("💻", "Whoa there, hacker!", "This attempt has been sent to HQ (Mum and Dad)."),
            caughtLine(2, "Alex", both),
        )
        assertEquals(caughtLine(0, "Alex", dad), caughtLine(3, "Alex", dad))
    }

    private val requests = mutableListOf<HttpRequestData>()

    private fun api(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = TamperApi(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
    )

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    @Test
    fun flushSendsFiftyAtATimeOldestFirst() = runBlocking {
        val queue = (1..120).map(::event)

        val sent = api { respond("", HttpStatusCode.NoContent) }.flush(queue)

        assertEquals(queue, sent)
        assertEquals(3, requests.size)
        assertTrue(requests.all { it.url.encodedPath == "/v1/device/events" })
        assertTrue(requests[0].bodyText().startsWith("""{"events":[{"id":"e1","kind":"tamper.call_blocked","""))
        assertTrue(requests[2].bodyText().contains(""""id":"e101""""))
        assertFalse(requests[1].bodyText().contains(""""id":"e101""""))
    }

    @Test
    fun flushStopsAtTheFirstUploadThatDoesNotGetThrough() = runBlocking {
        val queue = (1..70).map(::event)

        val sent = api { if (requests.size == 1) respond("", HttpStatusCode.NoContent) else throw IOException("offline") }
            .flush(queue)

        assertEquals(queue.take(50), sent)
        assertEquals(2, requests.size)
    }

    @Test
    fun anAnswerThatIsAnErrorCountsAsSent() = runBlocking {
        val sent = api { respond("""{"error":{"code":"validation","message":"bad"}}""", HttpStatusCode.UnprocessableEntity) }
            .flush(listOf(event(1)))

        assertEquals(listOf(event(1)), sent)
    }
}
```

## 6. Detailed spec

| What happens | Log lines (`KidService`, unless said) | Caught screen | Server |
|---|---|---|---|
| The clock is set more than 2 minutes away from trusted time | `tamper: tamper.clock`, `tamper: caught screen`, `tamper: 1 sent` | yes | a `tamper.clock` event, payload `{"offsetMin": "10"}` for 10 minutes ahead |
| The clock is set back to the right time | nothing | no | nothing |
| A policy that was on is found off | `Policies`: `policies: found off and turned on again: …`; then as above with `tamper.policy` | yes | a `tamper.policy` event, payload `{"missing": "…"}` |
| A call to a number not on the list, while blocked | `CallGuard`: `call: blocked`; then as above with `tamper.call_blocked` | yes, over the block screen | a `tamper.call_blocked` event, payload `{}` |
| The same kind again within a minute | `tamper: tamper.call_blocked again` (or `.clock`, `.policy`) | no | nothing |
| An attempt while offline | `tamper: …`, `tamper: caught screen`, no `sent` | yes | the event, when the network is back |

The caught lines take turns, starting with the first on a new install: "🕵️ Nice try, Agent Alex! / Dad has been told." (or "Mum and Dad have been told."), "🚨 Busted! / The Time Police have filed a report.", "💻 Whoa there, hacker! / This attempt has been sent to HQ (Dad)."

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-039-tamper
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-039-tamper.md` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create and replace the files of section 5. Build and test:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat assembleDebug test
   cd ..
   ```
   Commit: `CARD-039: Tamper detection and the caught screen`.
3. Run the acceptance checks in section 8, including the emulator run (8.2), in this session.
4. Push and open the PR (section 10).
5. Wait for the CI check to finish (`gh pr checks <number> --watch`).
6. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback. The throwaway `local-dev-only-…` values below are fine, and so are the made-up phone numbers `+61412345678` and `0400111222`.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints seventeen lines:
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
  au.screentime.kid.tamper.TamperTest tests="9" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="10" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```

### 8.2 On the emulator

Run every step below **in this session**, one after another without long breaks, exactly as written, and paste the **real terminal output** of each step into the handback. A summary is not accepted. If your context was summarised partway through, run the steps again from step 1. Never run `TamperLog` or `& $adb logcat -c` outside the steps: they clear the log that the next step reads. Paste any extra command you ran, with its output, under "Deviations". **Never do this run on a real phone.**

**The emulator.** Start from a **wiped** emulator: `& $adb emu kill`, then start it with `emulator -avd Medium_Phone_API_37.0 -wipe-data` (as in CARD-038c), and do not sign in. Wait until `& $adb devices` lists exactly one `emulator-5554   device` and `& $adb shell getprop sys.boot_completed` prints `1`. Then (the first three commands print an error on a wiped emulator; that is fine):

```powershell
& $adb shell am task lock stop
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
& $adb shell svc wifi enable
& $adb shell svc data enable
```

`& $adb shell pm list packages au.screentime` must print nothing. If it prints `package:au.screentime.kid`, the wipe did not happen: wipe again.

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). `$env:JWT_SECRET` must be the same value as in `deploy\.env`:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
pnpm --filter @screentime/server exec tsx scripts/dev-contacts.ts Alex +61412345678
```

`seed-dev.ts` prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` `dev-contacts.ts` gives Dad the mobile number `+61412345678`. If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

Do the run between 6 am and 10 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Set-Clock N` sets the emulator's clock to the PC's time plus N minutes (`Set-Clock 0` puts it right again). `TamperLog` prints the app's tamper, call and policy log lines and the caught screen's `closed` **since the last `TamperLog`**, then clears the log. `Wait-Log` waits until a log line with the given words shows up (it does not clear the log). `Events` prints the tamper events the server has stored. `Add-FakePolicy` stops the app and pretends a policy named `no_fun` was on after the last start (the app stores what was on in `shared_prefs/policies.xml`): the next start finds it off. `Call-Number` calls a number as in CARD-036. `Top` prints the screen in front; `LockState` prints whether Lock Task is on.

```powershell
function Tap-Text([string]$text, [int]$wait = 2) {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
  $node = $ui.SelectNodes('//node') | Where-Object { $_.text -eq $text } | Select-Object -First 1
  if (-not $node) { throw "No '$text' on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
  Start-Sleep -Seconds $wait
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
function Set-Clock([int]$minutes) {
  $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $minutes * 60000
  & $adb shell cmd alarm set-time $ms
  Start-Sleep -Seconds 2
  "PC: {0:HH:mm:ss}  emulator: {1}" -f (Get-Date), (& $adb shell date '+%H:%M:%S')
}
function TamperLog {
  & $adb logcat -d -s KidService:I CallGuard:I Policies:W CaughtActivity:I | Select-String 'tamper:|call:|policies:|CaughtActivity' | ForEach-Object { $_.Line.Trim() }
  & $adb logcat -c
}
function Wait-Log([string]$words, [int]$max = 90) {
  $start = Get-Date
  do {
    Start-Sleep -Seconds 2
    $hit = & $adb logcat -d -s KidService:I | Select-String -SimpleMatch $words | Select-Object -First 1
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($hit -or $seconds -gt $max)
  if ($hit) { "'$words' after {0:N0} s" -f $seconds } else { "No '$words' after $max s" }
}
function Events {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select kind, payload from events where kind like 'tamper.%' order by at"
}
function Add-FakePolicy {
  & $adb shell am force-stop au.screentime.kid
  Start-Sleep -Seconds 2
  $xml = (& $adb exec-out run-as au.screentime.kid cat shared_prefs/policies.xml) -join "`n"
  $xml = $xml -replace '<set name="applied">', '<set name="applied"><string>no_fun</string>'
  Set-Content "$t\policies.xml" $xml -Encoding ascii
  & $adb push "$t\policies.xml" /data/local/tmp/policies.xml | Out-Null
  & $adb shell "cat /data/local/tmp/policies.xml | run-as au.screentime.kid sh -c 'cat > shared_prefs/policies.xml'"
  & $adb exec-out run-as au.screentime.kid cat shared_prefs/policies.xml | Select-String -SimpleMatch 'no_fun'
}
function Call-Number([string]$number) {
  & $adb shell am start -a android.intent.action.CALL -d "tel:$number" | Out-Null
  Start-Sleep -Seconds 3
}
function Top {
  & $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
}
function LockState {
  & $adb shell dumpsys activity activities | Select-String 'mLockTaskModeState' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
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
```

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
   TamperLog
   Events
   ```
   `1-home` shows the main screen as in CARD-038c ("Hi Alex", the ring, the red **SOS** circle). `TamperLog` prints **nothing**: the first start has nothing to compare with. `Events` prints `(0 rows)`.
2. The clock set 10 minutes ahead:
   ```powershell
   Set-Clock 10
   Shot "2-caught-clock"
   Start-Sleep -Seconds 10
   Top
   TamperLog
   Events
   ```
   `Set-Clock` shows the emulator 10 minutes ahead of the PC. `2-caught-clock` shows the caught screen: blue, red or purple between them, 🕵️, "Nice try, Agent Alex!", "Dad has been told.", the tilted "REPORTED" stamp and "Back in N s" (N 6 or 7). `Top` shows `au.screentime.kid/.MainActivity`: the caught screen has closed. `TamperLog` has `tamper: tamper.clock`, `tamper: caught screen`, `tamper: 1 sent` and `CaughtActivity: closed`. `Events` has one row: `tamper.clock | {"offsetMin": "10"}`.
3. Again within a minute, then back to the right time. Start this step **right after** step 2:
   ```powershell
   Set-Clock 20
   Start-Sleep -Seconds 3
   Top
   Set-Clock 0
   Start-Sleep -Seconds 3
   TamperLog
   Events
   ```
   The first `Set-Clock` shows 20 minutes ahead, the second the PC's time. `Top` shows `MainActivity` (no caught screen). `TamperLog` has `tamper: tamper.clock again` and nothing else with `tamper:`. `Events` still has the one row of step 2.
4. A pretend missing policy:
   ```powershell
   Add-FakePolicy
   & $adb logcat -c
   Open-App
   Start-Sleep -Seconds 2
   Shot "3-caught-policy"
   Start-Sleep -Seconds 10
   Top
   TamperLog
   Events
   ```
   `Add-FakePolicy` ends with a line that has `<string>no_fun</string>`. `3-caught-policy` shows the caught screen with 🚨, "Busted!" and "The Time Police have filed a report.". `Top` shows `MainActivity`. `TamperLog` has `policies: found off and turned on again: no_fun`, `tamper: tamper.policy`, `tamper: caught screen`, `tamper: 1 sent` and `CaughtActivity: closed`. `Events` has two rows, the second `tamper.policy | {"missing": "no_fun"}`.
5. A call that is not on the list, while blocked:
   ```powershell
   Bedtime 60 0
   Screen-Off
   Screen-On
   Wait-Blocked
   Call-Number 0400111222
   Shot "4-caught-call"
   Top
   LockState
   Start-Sleep -Seconds 10
   Shot "5-back-to-block"
   Top
   LockState
   TamperLog
   Events
   ```
   `Wait-Blocked` prints `Blocked after N s`. `4-caught-call` shows the caught screen with 💻, "Whoa there, hacker!" and "This attempt has been sent to HQ (Dad).". The first `Top` shows `au.screentime.kid/.tamper.CaughtActivity` and the first `LockState` `LOCKED`. `5-back-to-block` shows the block screen ("Out of Phone time"). The second `Top` shows `BlockActivity`, the second `LockState` `LOCKED`. `TamperLog` has `call: blocked`, `tamper: tamper.call_blocked`, `tamper: caught screen`, `tamper: 1 sent` and `CaughtActivity: closed`. `Events` has three rows, the third `tamper.call_blocked | {}`.
6. The same call again within a minute:
   ```powershell
   Call-Number 0400111222
   Top
   TamperLog
   Events
   ```
   `Top` shows `BlockActivity` (no caught screen). `TamperLog` has `call: blocked` and `tamper: tamper.call_blocked again`. `Events` still has three rows.
7. A blocked call with no internet, then back online:
   ```powershell
   & $adb shell svc wifi disable
   & $adb shell svc data disable
   Start-Sleep -Seconds 65
   & $adb logcat -c
   Call-Number 0400111222
   Shot "6-caught-offline"
   Start-Sleep -Seconds 12
   TamperLog
   Events
   & $adb shell svc wifi enable
   & $adb shell svc data enable
   Wait-Log "tamper: 1 sent" 90
   TamperLog
   Events
   ```
   The 65 seconds take the run past the one-minute repeat of step 6. `6-caught-offline` shows the caught screen with 🕵️ and "Nice try, Agent Alex!" again (the fourth one starts the turns again). The first `TamperLog` has `call: blocked`, `tamper: tamper.call_blocked`, `tamper: caught screen` and `CaughtActivity: closed`, and **no** `tamper: 1 sent`. The first `Events` still has three rows. `Wait-Log` prints `'tamper: 1 sent' after N s` with N **60 or less**. The second `TamperLog` has `tamper: 1 sent`. The second `Events` has four rows, the last two `tamper.call_blocked | {}`.
8. Undo, so the emulator can be used again:
   ```powershell
   Set-Clock 0
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

- [ ] Steps 1 to 8 gave the expected results, run in this session. Paste the real output of every helper and command in steps 1 to 7 into the handback (`Set-Clock`, `Add-FakePolicy`, `Top`, `LockState`, `Wait-Blocked`, `Wait-Log`, `TamperLog`, `Events`).
- [ ] The six screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c39\`: `1-home.png`, `2-caught-clock.png`, `3-caught-policy.png`, `4-caught-call.png`, `5-back-to-block.png`, `6-caught-offline.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png` or `.xml` from the temp folder.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 9 files:
  ```
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/calls/CallGuard.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/tamper/CaughtActivity.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/tamper/Tamper.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/tamper/TamperStore.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/tamper/TamperTest.kt
  ```

## 9. Tests

`TamperTest` (5.9), 9 tests:

| Test | Checks |
|---|---|
| `aClockSetMoreThanTwoMinutesAwayIsAnAttempt` | exactly 2 minutes either way is fine; 10 minutes 5 seconds ahead and 10 minutes less 0.8 seconds ahead are both `10` (rounded); 3 minutes behind is `-3` |
| `onlyAPolicyThatWasOnBeforeCanBeMissing` | the missing names come sorted; a policy new in this version is not missing |
| `theSameKindWithinAMinuteIsTheSameAttempt` | none before, 59 s, 60 s, and a last time in the future |
| `anEventIsSentAsTheServerReadsIt` | the JSON of an event with and without a payload |
| `theQueueKeepsTheNewestHundred` | the 101st event pushes out the oldest |
| `theCaughtScreenTakesTurnsAndNamesTheParents` | the three lines, one, two and no parents, and the fourth is the first again |
| `flushSendsFiftyAtATimeOldestFirst` | 120 events go as 50, 50 and 20, in order |
| `flushStopsAtTheFirstUploadThatDoesNotGetThrough` | no network on the second upload: only the first 50 count as sent |
| `anAnswerThatIsAnErrorCountsAsSent` | a 422 counts as sent, so a bad event is not sent forever |

The other 16 suites are unchanged and must still pass. The rest is checked by the emulator run in 8.2.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit (step 2). Message format: `CARD-039: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-039-tamper`
5. Open a PR into `main` titled `CARD-039: Tamper detection and the caught screen`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (create the folder first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-039-tamper --title "CARD-039: Tamper detection and the caught screen" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-039-tamper.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: seventeen suites, TamperTest 9, all `failures="0"`
   - [x] emulator run steps 1 to 8 — results as expected
   - [x] six screenshots in C:\Users\james\OpenCode\Testing\temp\c39\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 9 files

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

- **Step 2: `Set-Clock` shows the emulator at the PC's time** (the clock did not move): paste the output of `& $adb shell cmd alarm set-time ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 600000)` and `& $adb shell date`, and stop there.
- **Step 2: the clock moved but `TamperLog` has no `tamper: tamper.clock`**: paste `& $adb logcat -d -s KidService:I | Select-Object -Last 15` (not `TamperLog`) and stop there.
- **No caught screen in a screenshot, but `TamperLog` has `tamper: caught screen`**: paste `Top` and `& $adb logcat -d -b all | Select-String 'CaughtActivity' | Select-Object -Last 15`, and stop there.
- **`tamper: 1 sent` is missing in steps 2, 4 or 5**: paste `& $adb logcat -d -s KidService:W KidService:I | Select-Object -Last 20` and `docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api --tail 30`, and stop there.
- **Step 4: `Add-FakePolicy` prints no `no_fun` line**: paste `& $adb exec-out run-as au.screentime.kid cat shared_prefs/policies.xml` and the output of `Add-FakePolicy`, and stop there. If `am force-stop` printed an error, paste it too.
- **Step 4: no `policies: found off …` line**: paste `& $adb logcat -d -s Policies:W KidService:I | Select-Object -Last 20` and stop there.
- **Step 5: `Top` shows the phone app's call screen**, or `TamperLog` has `call: allowed`: paste `& $adb shell cmd role get-role-holders android.app.role.CALL_REDIRECTION` and `TamperLog`, end the call with `& $adb shell input keyevent KEYCODE_ENDCALL`, and stop there.
- **Step 5: `5-back-to-block` does not show the block screen**, or the second `LockState` is not `LOCKED`: paste `Top`, `LockState` and `& $adb logcat -d -s KidService:I BlockActivity:I | Select-Object -Last 20`, and stop there.
- **Step 7: `Wait-Log` prints `No 'tamper: 1 sent' after 90 s`**: paste `& $adb logcat -d -s KidService:I KidService:W | Select-Object -Last 30` (not `TamperLog`) and `& $adb shell dumpsys connectivity | Select-String 'Active default network'`, and stop there.
- **The `Events` rows show the payload with other spacing**, for example `{"offsetMin":"10"}`: that is fine.
- **`Bedtime` says the bedtime would be after midnight**: it is too late in the day. Do the run the next day after 6 am.
- **`wm dismiss-keyguard` does nothing** (the lock screen stays): swipe up with `& $adb shell input swipe 540 1800 540 600` instead and say so under "Deviations".
- **`dpm set-device-owner` says there are accounts, several users, or already provisioned**: wipe the emulator again, do not sign in, and repeat from step 1.
- **`INSTALL_FAILED_TEST_ONLY`**: you left out `-t` in `adb install`.
- **You are stuck in the block screen** and need the emulator back: `& $adb shell am task lock stop`, then `Bedtime 60`.
- **Never tap Emergency 000**, and never run this on a real phone.
- **Temporary files** (the PR body, `ui.xml`, `policies.xml`, the screenshots, any helper scripts) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
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
Claude, here is Bob's handback for CARD-039. Please review and merge if it is good.

CARD: CARD-039 Tamper detection and the caught screen
PR: <full PR URL>
Branch: bob/card-039-tamper
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
