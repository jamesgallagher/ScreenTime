# CARD-036: Calls from the block screen

| Field | Value |
|---|---|
| Card | CARD-036 |
| Title | Calls from the block screen |
| Size | M |
| Depends on | CARD-035 (ask and message), merged to `main` |
| Spec sections | docs/SPEC.md §9.4 (the snapshot's `parents`, `contacts`, `family.emergencyNumber`, `device.hasCellular`), §12.1 ("Device Owner policies", "From the block screen", "As built (CARD-036)"), §16.2 ("Block screen") |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-036-calls` |
| PR title | `CARD-036: Calls from the block screen` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

When a kid's phone is out of time or it is bedtime, the block screen covers everything (Lock Task). A kid must still be able to phone Mum, Dad and a few chosen people, and the emergency number. This card adds that, only on a **phone with a SIM** (a tablet shows no call buttons):

- **A row of round call buttons** on the block screen, above **Ask for more time**: one per parent who has a mobile number, then the kid's "always callable" contacts that the parents chose (for example "Grandma"). Each is a 64 dp coloured circle with the initials, the name under it. One tap calls straight away; Android's own call screen shows over the block screen, and hanging up goes back to it.
- **Emergency 000**, a red outlined button under **Message Dad**: it opens the phone's dialer with `000` filled in. The kid presses the green button there (an app is not allowed to place an emergency call itself).
- **A guard for other numbers**: while the phone is blocked, a call to any number that is not on the list is stopped, and a message says "Right now you can only call the people on your list". Emergency numbers always go through: Android never asks the app about them. While the phone may be used, every call goes through.

How it works on Android:

- The phone app may now run in Lock Task too. `admin/Policies.kt` adds the phone app's package (and Android's call service, `com.android.server.telecom`, for the "Call with" choice on a two-SIM phone) to the Lock Task list on a phone. Without that, the call screen could not open while blocked.
- The guard is a `CallRedirectionService` (`calls/CallGuard.kt`). Android asks it about every outgoing call, but only once the app holds the **call redirection role**. An app cannot give itself that role, so it is given with one `adb` command when the phone is set up, like `dpm set-device-owner`. Section 8.2 does it on the emulator.
- `calls/Calls.kt` holds the pure logic (who is on the list, initials, whether two numbers are the same: `0412 345 678` is the same as `+61412345678`), with unit tests. `calls/CallButtons.kt` holds the row, the emergency button, `call()` and `dialEmergency()`.

Claude added `server/scripts/dev-contacts.ts`: it gives Dad a mobile number and sets Alex's contacts through the API, as a parent would in the app, so the run in 8.2 has people to call.

This card also checks something CARD-035 missed on the emulator: **Ask for more time** and the answer on the **block screen** (steps 3 and 9).

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `CallsTest` (5 tests) and `KidStatusTest` (10); on the emulator the block screen shows the call buttons for Dad and Grandma and **Emergency 000**; a tap on Dad opens the call screen over the block screen and hanging up goes back to it, still in Lock Task; a call to a number off the list is stopped while blocked and goes through once unblocked; Grandma's number in national form goes through; **Emergency 000** opens the dialer with `000`; an ask and a no work on the block screen, and a yes unlocks it within 10 seconds; the screen scrolls on its side; the eleven screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No SOS button (CARD-038), no "I'm the parent" (CARD-037), no "caught" screen and no `tamper.call_blocked` event for a stopped call (CARD-039), no SMS (a later card). No call buttons on the main screen: when the phone is not blocked, the kid uses the phone app as usual.
- No change to `core-model`, `core-time`, `core-ui`, `app-parent`, `packages/`, `web/`, `server/` or `docs/`, and no change to any `build.gradle.kts` or `libs.versions.toml`. The only manifest that changes is `android/app-kid/src/main/AndroidManifest.xml` (5.7). No new dependency of any kind.
- **Never place a real emergency call.** In step 7 the dialer shows `000`: do **not** press its green call button. Press Back.
- Never run the app on a real phone or tablet in this card, and never install a **release** build anywhere.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, Room 2.8.5, KSP 2.3.12, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36. No new library: `CallRedirectionService`, `TelecomManager` and `RoleManager` are part of Android.

Claude built this exact code in GitHub Actions before writing the card, so it compiles and the tests pass, and ran `dev-contacts.ts` against the real server.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c36"
New-Item -ItemType Directory -Force $t | Out-Null
```

**If you are ever stuck inside the block screen on the emulator**, this always gets you out: `& $adb shell am task lock stop`.

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7) and `…` (U+2026); copy them exactly.

| File | Action |
|---|---|
| `android/app-kid/src/main/kotlin/au/screentime/kid/calls/Calls.kt` | create (5.1) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/calls/CallGuard.kt` | create (5.2) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/calls/CallButtons.kt` | create (5.3) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt` | replace (5.4) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt` | replace (5.5) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt` | replace (5.6) |
| `android/app-kid/src/main/AndroidManifest.xml` | replace (5.7) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/calls/CallsTest.kt` | create (5.8) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt` | replace (5.9) |

That is 9 files.

### 5.1 `android/app-kid/src/main/kotlin/au/screentime/kid/calls/Calls.kt`

```kotlin
package au.screentime.kid.calls

import au.screentime.core.model.api.DeviceStateContactsItem
import au.screentime.core.model.api.DeviceStateParentsItem

/** Someone the kid can always call (docs/SPEC.md §12.1, Q33): a parent with a mobile, or an always-callable contact. */
data class Callable(val label: String, val number: String)

/** The call buttons, in order: the parents with a mobile (oldest first), then the kid's contacts in the parents' order. */
fun callablesOf(parents: List<DeviceStateParentsItem>, contacts: List<DeviceStateContactsItem>): List<Callable> =
    parents.mapNotNull { p -> p.phoneE164?.let { Callable(p.displayName, it) } } +
        contacts.map { Callable(it.label, it.phoneE164) }

/** The letters in a call button: "D" for "Dad", "GJ" for "Grandma Jo", "?" when there are none. */
fun initials(label: String): String {
    val letters = label.split(' ').filter { it.isNotBlank() }.take(2).map { it.first().uppercaseChar() }
    return if (letters.isEmpty()) "?" else letters.joinToString("")
}

/**
 * Whether the kid may call [dialled] while the device is blocked: a number on the list, or the family's emergency
 * number. Android never asks about the emergency numbers it knows itself (000, 112, 911 …), so those always work.
 */
fun mayCall(dialled: String, callables: List<Callable>, emergencyNumber: String): Boolean =
    sameNumber(dialled, emergencyNumber) || callables.any { sameNumber(dialled, it.number) }

/**
 * Whether two phone numbers are the same: equal after taking out spaces, dashes, dots and brackets, or one in
 * international form (+61 412 345 678) and the other in national form with its leading 0 (0412 345 678).
 * Anything with other characters (`*`, `#`, letters, a pause) is never the same as anything.
 */
fun sameNumber(a: String, b: String): Boolean {
    val x = plain(a) ?: return false
    val y = plain(b) ?: return false
    return x == y || national(x, y) || national(y, x)
}

/** [n] with only its digits and a leading `+`, or null when it is not a plain phone number. */
private fun plain(n: String): String? {
    val kept = n.trim().filterNot { it == ' ' || it == '-' || it == '.' || it == '(' || it == ')' }
    val ok = kept.isNotEmpty() && kept.withIndex().all { (i, c) -> c.isDigit() || (c == '+' && i == 0) }
    return if (ok && kept != "+") kept else null
}

/** [intl] is +<country code of 1 to 3 digits><[local] without its leading 0>. */
private fun national(intl: String, local: String): Boolean {
    if (!intl.startsWith("+") || !local.startsWith("0") || local.startsWith("00") || local.length < 7) return false
    val rest = local.drop(1)
    val digits = intl.drop(1)
    return digits.endsWith(rest) && digits.length - rest.length in 1..3
}
```

### 5.2 `android/app-kid/src/main/kotlin/au/screentime/kid/calls/CallGuard.kt`

```kotlin
package au.screentime.kid.calls

import android.net.Uri
import android.telecom.CallRedirectionService
import android.telecom.PhoneAccountHandle
import android.util.Log
import android.widget.Toast
import au.screentime.kid.status.StatusHub

/**
 * Stops calls to numbers that are not on the kid's list while the device is blocked (docs/SPEC.md §12.1). Android
 * asks it about every outgoing call, once the app holds the "call redirection" role (given with adb when the phone
 * is set up). Android never asks about emergency calls, so they always go through. While the device may be used,
 * or before the service has worked out the first status, every call goes through.
 * The "caught" screen and the parents' notification for a stopped call come with CARD-039.
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
        }
    }

    private companion object {
        const val TAG = "CallGuard"
    }
}
```

### 5.3 `android/app-kid/src/main/kotlin/au/screentime/kid/calls/CallButtons.kt`

```kotlin
package au.screentime.kid.calls

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.telecom.TelecomManager
import android.util.Log
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.screentime.core.ui.AvatarColors
import au.screentime.core.ui.ScreenTimeTheme

private const val TAG = "Calls"

/** The dark theme's danger red (docs/SPEC.md §16.1): the light one is too dark to read on the night background. */
private val EmergencyRed = Color(0xFFF87171)

/**
 * The row of round call buttons on the block screen (docs/SPEC.md §16.2): a 64 dp circle with the initials in the
 * avatar colours, the name under it. One tap calls. The row scrolls sideways when it does not fit.
 */
@Composable
fun ContactRow(callables: List<Callable>, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
    ) {
        callables.forEachIndexed { i, who ->
            ContactButton(who, AvatarColors[i % AvatarColors.size]) { call(context, who) }
        }
    }
}

@Composable
private fun ContactButton(who: Callable, color: Color, onTap: () -> Unit) {
    val colors = ScreenTimeTheme.colors
    Column(
        modifier = Modifier
            .width(72.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClickLabel = "Call ${who.label}", role = Role.Button, onClick = onTap),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .background(color, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = initials(who.label),
                modifier = Modifier.clearAndSetSemantics { },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = who.label,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.onNight,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** **Emergency 000**, outlined in red: opens the phone's dialer with the number filled in (docs/SPEC.md §12.1). */
@Composable
fun EmergencyButton(number: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    OutlinedButton(
        onClick = { dialEmergency(context, number) },
        modifier = modifier
            .widthIn(max = 420.dp)
            .fillMaxWidth()
            .height(56.dp),
        border = BorderStroke(1.5.dp, EmergencyRed),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = EmergencyRed),
    ) {
        Text("Emergency $number", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
}

/**
 * Calls [who] straight away through Android's own phone app, which shows its call screen over the block screen
 * (the policies let it run in Lock Task). The app has the phone permission because it is Device Owner.
 */
fun call(context: Context, who: Callable) {
    try {
        context.getSystemService(TelecomManager::class.java)
            .placeCall(Uri.fromParts("tel", who.number, null), Bundle())
        Log.i(TAG, "call: placing to ${who.label}")
    } catch (e: SecurityException) {
        Log.w(TAG, "call: no phone permission", e)
        Toast.makeText(context, "Calls don't work on this phone yet", Toast.LENGTH_LONG).show()
    }
}

/**
 * Opens the dialer with [number] filled in, for the kid to press the green button: an app cannot place an
 * emergency call itself (docs/SPEC.md §12.1).
 */
fun dialEmergency(context: Context, number: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)))
        Log.i(TAG, "call: dialer opened for the emergency number")
    } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "call: no dialer", e)
    }
}
```

### 5.4 `android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt`

Replace the whole file. Compared with `main`: two imports, three new fields at the end of `KidStatus` (`canCall`, `callables`, `emergencyNumber`, with defaults, so `WarningTrackerTest` is unchanged), and the three filled in `kidStatus`.

```kotlin
package au.screentime.kid.status

import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.Pool
import au.screentime.core.time.EngineResult
import au.screentime.core.time.LockReason
import au.screentime.core.time.formatDuration
import au.screentime.kid.calls.Callable
import au.screentime.kid.calls.callablesOf
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

/** How much time is left, for the ring and notification colours (docs/SPEC.md §16.1). */
enum class Level { PLENTY, LOW, CRITICAL, LOCKED }

/** A ready-made message the kid can send with one tap (docs/SPEC.md §16.2, "Message sheet"). */
data class Preset(val id: String, val text: String)

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
    /** The family's parents, oldest first: "Mum", "Dad". */
    val parentNames: List<String> = emptyList(),
    val presets: List<Preset> = emptyList(),
    /** Minutes of the kid's "Ask for more time" that no parent has answered yet; null when there is none. */
    val pendingMinutes: Int? = null,
    /** A phone with a SIM: the block screen has call buttons and **Emergency** (docs/SPEC.md §12.1, Q28). */
    val canCall: Boolean = false,
    /** The call buttons: the parents with a mobile, then the kid's always-callable contacts. */
    val callables: List<Callable> = emptyList(),
    /** The family's emergency number, "000". */
    val emergencyNumber: String = "000",
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

    /** "Mum or Dad", for "Waiting for Mum or Dad…". */
    val parentsOr: String get() = parentsText(parentNames, "or")

    /** "Mum and Dad", for "Message Mum and Dad". */
    val parentsAnd: String get() = parentsText(parentNames, "and")

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
        parentNames = state.parents.map { it.displayName },
        presets = state.messagePresets.map { Preset(it.id, it.text) },
        pendingMinutes = state.pendingRequest?.minutes,
        canCall = state.device.form == DeviceForm.PHONE && state.device.hasCellular,
        callables = callablesOf(state.parents, state.contacts),
        emergencyNumber = state.family.emergencyNumber,
    )
}

/** "Dad", "Mum or Dad", "Mum, Dad or Nan" with [word] "or"; "your parents" when there are none. */
fun parentsText(names: List<String>, word: String): String = when (names.size) {
    0 -> "your parents"
    1 -> names[0]
    else -> names.dropLast(1).joinToString(", ") + " $word " + names.last()
}

/** Minutes the kid's way: "15 min", "45 min", "1h", "1h 30m". */
fun minutesText(minutes: Int): String = if (minutes < 60) "$minutes min" else formatDuration(minutes * 60L)

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

### 5.5 `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt`

Replace the whole file. Compared with `main`: the comment, four imports, `verticalScroll` on the column (so a phone on its side can scroll), a 24 dp gap under the words, and the call row and **Emergency** around `AskAndMessage`.

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import au.screentime.kid.ask.AskAndMessage
import au.screentime.kid.ask.Look
import au.screentime.kid.calls.ContactRow
import au.screentime.kid.calls.EmergencyButton
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.clockText
import java.time.LocalTime
import kotlinx.coroutines.delay

/**
 * The block screen's content (docs/SPEC.md §16.2): the time at the top, a moon or an hourglass, "It's bedtime",
 * when the device is back, and **Ask for more time** and **Message Mum and Dad**. A phone with a SIM also has the
 * row of call buttons above them and **Emergency 000** under them. SOS and "I'm the parent" come with their cards.
 * When it all does not fit (a phone on its side), the screen scrolls; otherwise the gaps share the spare height.
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
            .verticalScroll(rememberScrollState())
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
        Spacer(Modifier.height(24.dp))
        if (status.canCall && status.callables.isNotEmpty()) {
            ContactRow(status.callables)
            Spacer(Modifier.height(20.dp))
        }
        AskAndMessage(status, Look.NIGHT)
        if (status.canCall) {
            Spacer(Modifier.height(12.dp))
            EmergencyButton(status.emergencyNumber)
        }
        Spacer(Modifier.height(8.dp))
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

### 5.6 `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt`

Replace the whole file. Compared with `main`: two imports, the Lock Task list with the phone packages, the warning when the app does not hold the call redirection role, and `canCall` and `phonePackages`.

```kotlin
package au.screentime.kid.admin

import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import android.os.UserManager
import android.telecom.TelecomManager
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
        // power menu and the phone's own lock screen (with its emergency call button) still work. On a phone with a
        // SIM the phone app may run too, for its call screen and the emergency dialer.
        dpm.setLockTaskPackages(admin, (listOf(context.packageName) + phonePackages(context)).distinct().toTypedArray())
        dpm.setLockTaskFeatures(
            admin,
            DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD,
        )
        grantRuntimePermissions(context)
        if (canCall(context) && !context.getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_CALL_REDIRECTION)) {
            // Without it every call goes through while blocked. Given with adb at setup (docs/SPEC.md §12.1).
            Log.w(TAG, "calls: not the call redirection app, so calls are not checked while blocked")
        }
    }

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

### 5.7 `android/app-kid/src/main/AndroidManifest.xml`

Replace the whole file. Compared with `main`: the `CALL_PHONE` permission with a `uses-feature` that makes the phone optional, and the `CallGuard` service.

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

### 5.8 `android/app-kid/src/test/kotlin/au/screentime/kid/calls/CallsTest.kt`

```kotlin
package au.screentime.kid.calls

import au.screentime.core.model.api.DeviceStateContactsItem
import au.screentime.core.model.api.DeviceStateParentsItem
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CallsTest {
    private val list = listOf(Callable("Dad", "+61412345678"), Callable("Grandma", "+61298765432"))

    @Test
    fun parentsWithAMobileComeFirstThenTheContacts() {
        val parents = listOf(
            DeviceStateParentsItem("p1", "Mum", "+61400000001"),
            DeviceStateParentsItem("p2", "Dad", null),
        )
        val contacts = listOf(DeviceStateContactsItem("Grandma", "+61298765432"), DeviceStateContactsItem("Sam", "+61400000002"))

        assertEquals(
            listOf(Callable("Mum", "+61400000001"), Callable("Grandma", "+61298765432"), Callable("Sam", "+61400000002")),
            callablesOf(parents, contacts),
        )
        assertEquals(emptyList<Callable>(), callablesOf(emptyList(), emptyList()))
    }

    @Test
    fun initialsAreTheFirstLettersOfTheFirstTwoWords() {
        assertEquals("D", initials("Dad"))
        assertEquals("GJ", initials("Grandma Jo"))
        assertEquals("AB", initials(" anna  bell smith "))
        assertEquals("?", initials("  "))
    }

    @Test
    fun theSameNumberInAnyUsualFormMatches() {
        assertTrue(sameNumber("+61412345678", "+61412345678"))
        assertTrue(sameNumber("+61 412 345 678", "+61412345678"))
        assertTrue(sameNumber("0412 345 678", "+61412345678"))
        assertTrue(sameNumber("(02) 9876-5432", "+61298765432"))
        assertTrue(sameNumber("+61412345678", "0412345678"))
        assertTrue(sameNumber("000", "000"))
    }

    @Test
    fun otherNumbersAndOddFormsNeverMatch() {
        assertFalse(sameNumber("0412345679", "+61412345678"))
        assertFalse(sameNumber("412345678", "+61412345678"))
        assertFalse(sameNumber("00", "000"))
        assertFalse(sameNumber("*31#0412345678", "+61412345678"))
        assertFalse(sameNumber("0412345678,1", "+61412345678"))
        assertFalse(sameNumber("+", "+"))
        assertFalse(sameNumber("", ""))
        // A short number is not the end of a long one.
        assertFalse(sameNumber("045678", "+61412345678"))
    }

    @Test
    fun whileBlockedOnlyTheListAndTheEmergencyNumberMayBeCalled() {
        assertTrue(mayCall("0412 345 678", list, "000"))
        assertTrue(mayCall("+61298765432", list, "000"))
        assertTrue(mayCall("000", list, "000"))
        assertFalse(mayCall("0400 111 222", list, "000"))
        assertFalse(mayCall("0400111222", emptyList(), "000"))
    }
}
```

### 5.9 `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt`

Replace the whole file. Compared with `main`: four imports and one new test, `aPhoneWithASimGetsTheCallButtonsATabletDoesNot`, before the last one; the others are unchanged.

```kotlin
package au.screentime.kid.status

import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.DeviceStateContactsItem
import au.screentime.core.model.api.DeviceStateMessagePresetsItem
import au.screentime.core.model.api.DeviceStateParentsItem
import au.screentime.core.model.api.DeviceStatePendingRequest
import au.screentime.core.time.LockReason
import au.screentime.core.time.evaluate
import au.screentime.kid.calls.Callable
import au.screentime.kid.usage.state
import au.screentime.kid.usage.todayInput
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
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

    @Test
    fun theParentsPresetsAndAWaitingRequestComeFromTheSnapshot() {
        val family = state().copy(
            parents = listOf(DeviceStateParentsItem("p1", "Mum", null), DeviceStateParentsItem("p2", "Dad", "+61400000000")),
            messagePresets = listOf(DeviceStateMessagePresetsItem("m1", "Can you call me?")),
            pendingRequest = DeviceStatePendingRequest("r1", 30, "2026-10-26T00:00:00Z"),
        )

        val s = statusAt("10:00", family)

        assertEquals(listOf("Mum", "Dad"), s.parentNames)
        assertEquals(listOf(Preset("m1", "Can you call me?")), s.presets)
        assertEquals(30, s.pendingMinutes)
        assertEquals("Mum or Dad", s.parentsOr)
        assertEquals("Mum and Dad", s.parentsAnd)
        assertNull(statusAt("10:00").pendingMinutes)
    }

    @Test
    fun aPhoneWithASimGetsTheCallButtonsATabletDoesNot() {
        val family = state().copy(
            parents = listOf(DeviceStateParentsItem("p1", "Mum", null), DeviceStateParentsItem("p2", "Dad", "+61400000000")),
            contacts = listOf(DeviceStateContactsItem("Grandma", "+61298765432")),
        )

        val phone = statusAt("10:00", family)

        assertTrue(phone.canCall)
        assertEquals(listOf(Callable("Dad", "+61400000000"), Callable("Grandma", "+61298765432")), phone.callables)
        assertEquals("000", phone.emergencyNumber)
        val tablet = family.copy(device = family.device.copy(form = DeviceForm.TABLET))
        assertFalse(statusAt("10:00", tablet).canCall)
        val noSim = family.copy(device = family.device.copy(hasCellular = false))
        assertFalse(statusAt("10:00", noSim).canCall)
    }

    @Test
    fun namesAndMinutesReadTheKidsWay() {
        assertEquals("your parents", parentsText(emptyList(), "or"))
        assertEquals("Dad", parentsText(listOf("Dad"), "or"))
        assertEquals("Mum, Dad or Nan", parentsText(listOf("Mum", "Dad", "Nan"), "or"))
        assertEquals("15 min", minutesText(15))
        assertEquals("45 min", minutesText(45))
        assertEquals("1h", minutesText(60))
        assertEquals("1h 30m", minutesText(90))
    }
}
```

## 6. Detailed spec

### 6.1 What the kid sees on the block screen

From the top, on a phone with a SIM:

| Part | What |
|---|---|
| Time, picture, words | unchanged from CARD-033 |
| Call row | 24 dp under the words' area. One button per person: a 64 dp circle in the avatar colours in order (teal, violet, pink, blue …) with the initials in bold white ("D", "G"), and the name under it in `onNight`, one line. 16 dp between buttons, centred; the row scrolls sideways if it is wider than the screen. Not shown when nobody has a number |
| Card, **Ask for more time**, **Message Dad** | unchanged from CARD-035, 20 dp under the row |
| **Emergency 000** | 12 dp under **Message Dad**: a 56 dp pill outlined in light red `#F87171` with bold light red text, full width up to 420 dp. The number is the family's emergency number |

On a tablet or a phone without a SIM: no call row and no **Emergency**, as in CARD-035. If it all does not fit (a phone on its side), the screen scrolls up and down.

### 6.2 What happens

| Event | What the app does |
|---|---|
| Tap a call button | `TelecomManager.placeCall` to that number, log `call: placing to Dad` (tag `Calls`); Android's call screen opens over the block screen |
| Hang up | the call screen closes and the block screen is back, still in Lock Task |
| Tap **Emergency 000** | the dialer opens with `000` filled in, log `call: dialer opened for the emergency number`; Back returns to the block screen |
| Any outgoing call | Android asks `CallGuard` first (tag `CallGuard`). Blocked and not on the list: `call: blocked`, the call is cancelled, a toast "Right now you can only call the people on your list". Otherwise: `call: allowed`. Numbers are never logged |
| The app starts without the call redirection role | log `calls: not the call redirection app, so calls are not checked while blocked` (tag `Policies`, a warning) |

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-036-calls
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-036-calls.md` and `server/scripts/dev-contacts.ts` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create or replace 5.1 to 5.7. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-036: calls from the block screen`.
3. Create or replace 5.8 and 5.9. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-036: call list and status tests`.
4. Run the acceptance checks in section 8, including the emulator run (8.2), in this session.
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback. The throwaway `local-dev-only-…` values below are fine. The phone numbers below are made up; they are fine too.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints fourteen lines:
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
  au.screentime.kid.live.LiveTest tests="6" failures="0" errors="0"
  au.screentime.kid.status.KidStatusTest tests="10" failures="0" errors="0"
  au.screentime.kid.status.WarningTrackerTest tests="5" failures="0" errors="0"
  au.screentime.kid.sync.SyncerTest tests="4" failures="0" errors="0"
  au.screentime.kid.sync.TrustedClockTest tests="4" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="10" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```

### 8.2 On the emulator

Run every step below **in this session**, and paste the **real terminal output** of each step into the handback. A summary is not accepted, and neither is "run earlier in this session" for output you no longer have. If your context was summarised partway through, run the steps again from step 1.

**The emulator.** Use the same emulator as in CARD-035 (a phone with the Play Store or Google APIs image), with nobody signed in. Remove the app from CARD-035 first (each command prints `Success...`, or an error if there was nothing to remove; both are fine), and keep the screen from turning off by itself for 30 minutes:

```powershell
& $adb shell am task lock stop
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
& $adb shell pm has-feature android.hardware.telephony.calling
& $adb shell telecom get-default-dialer
```

`pm has-feature` must print `true`: the emulator has a (pretend) SIM, so the app treats it as a phone with a SIM. If it prints `false`, stop and ask James. `telecom get-default-dialer` prints the phone app's package (for example `com.google.android.dialer`); paste it into the handback.

`& $adb devices` must list exactly one `emulator-5554   device`. If it says `offline` for more than a minute, use the cold boot steps James gave you for CARD-030b; do not wait longer than 5 minutes. If `uninstall` fails with `DELETE_FAILED_INTERNAL_ERROR` and `remove-active-admin` with a `SecurityException` (the app is still Device Owner), wipe the emulator (Device Manager › **Wipe Data**), cold boot it, and run the commands above again. That is not a deviation, but say that you did it under "Outside the repo".

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). `dev-contacts.ts` and `dev-answer.ts` sign a parent token with `JWT_SECRET`, so `$env:JWT_SECRET` must be the same value as in `deploy\.env`:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
pnpm --filter @screentime/server exec tsx scripts/dev-contacts.ts Alex +61412345678 Grandma=+61298765432
```

`seed-dev.ts` prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` `dev-contacts.ts` prints `Dad is on +61412345678; Alex can call Dad and Grandma.` If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

Do the run between 6 am and 10 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Tap-Text` taps the words on the screen; `Tap-Desc` taps a button by its description (for example the phone app's red "End call" button). `Call-Number` asks Android to call a number, as the phone app would when the kid types one. `CallLog` prints the app's `call:` and `calls:` log lines **since the last `CallLog`**, then clears the log. `LockState` prints whether Lock Task is on (`LOCKED`) or off (`NONE`). `Top` prints the screen in front.

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
function Tap-Desc([string]$desc, [int]$wait = 3) {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
  $node = $ui.SelectNodes('//node') | Where-Object { $_.'content-desc' -eq $desc } | Select-Object -First 1
  if (-not $node) { throw "No '$desc' button on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
  Start-Sleep -Seconds $wait
}
function Type-Text([string]$text) {
  & $adb shell input text $text
  Start-Sleep -Seconds 1
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
function Answer([string]$answer) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-answer.ts Alex $answer
}
function Requests {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select minutes, status from time_requests order by created_at"
}
function Call-Number([string]$number) {
  & $adb shell am start -a android.intent.action.CALL -d "tel:$number" | Out-Null
  Start-Sleep -Seconds 4
}
function CallLog {
  & $adb logcat -d -s Calls:I CallGuard:I Policies:W | Select-String 'call:|calls:' | ForEach-Object { $_.Line.Trim() }
  & $adb logcat -c
}
function LockState {
  & $adb shell dumpsys activity activities | Select-String 'mLockTaskModeState' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
}
function Top {
  & $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
}
function Wait-Unblocked {
  $start = Get-Date
  do {
    Start-Sleep -Milliseconds 500
    $top = (& $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1).Line
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($top -notmatch 'BlockActivity' -or $seconds -gt 45)
  if ($top -match 'BlockActivity') { "Still blocked after 45 s" } else { "Unblocked after {0:N0} s" -f $seconds }
}
```

**The run.** From `android`, one step at a time; check each expected result before the next step.

1. Install, make it Device Owner, give it the call redirection role, and pair. In a second PowerShell window, from the repo root, with the same `$env:DATABASE_URL`, run `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` and copy the `Emulator link`. Back in the first window:
   ```powershell
   Bedtime 60
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb shell cmd role add-role-holder android.app.role.CALL_REDIRECTION au.screentime.kid
   & $adb shell cmd role get-role-holders android.app.role.CALL_REDIRECTION
   & $adb logcat -c
   Open-App
   Open-Link "<the emulator link>"
   Tap-Text "Yes"
   Start-Sleep -Seconds 10
   Shot "1-home"
   CallLog
   ```
   `get-role-holders` prints `au.screentime.kid`. `1-home` shows the main screen as in CARD-035 ("Hi Alex", the ring, **Ask for more time**, **Message Dad**) and **no** call buttons. `CallLog` prints nothing (no `calls: not the call redirection app` warning).
2. Out of time:
   ```powershell
   Bedtime 60 0
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 10
   Shot "2-block"
   Top
   LockState
   ```
   `2-block` shows the block screen (hourglass, "Out of Phone time", "New time tomorrow"), then the call row with a teal **D** circle labelled "Dad" and a violet **G** circle labelled "Grandma", then **Ask for more time**, **Message Dad** and the red outlined **Emergency 000**. `Top` shows `au.screentime.kid/.block.BlockActivity`; `LockState` shows `mLockTaskModeState=LOCKED`.
3. Ask on the block screen, and Dad says no:
   ```powershell
   Tap-Text "Ask for more time"
   Tap-Text "Send"
   Start-Sleep -Seconds 5
   Shot "3-block-waiting"
   Answer no
   Shot "4-block-no"
   Top
   Requests
   ```
   `3-block-waiting` shows the block screen with "Waiting for Dad…" above a faded **Ask for more time**. `4-block-no` shows "Dad said not this time" in its place, still on the block screen. `Answer no` prints `Dad said no to Alex's request for 15 min (no reason).` `Top` shows `BlockActivity`. `Requests` has one row: `15 | denied`.
4. Call Dad from the block screen, then hang up:
   ```powershell
   Tap-Text "Dad" 6
   Shot "5-calling-dad"
   Top
   LockState
   Tap-Desc "End call"
   Start-Sleep -Seconds 3
   Top
   LockState
   CallLog
   ```
   `5-calling-dad` shows the phone app's call screen calling `+61 412 345 678` (or `0412 345 678`). The first `Top` shows the phone app (the package from `telecom get-default-dialer`, an `InCallActivity`), the first `LockState` `LOCKED`. After **End call**, `Top` shows `BlockActivity` again and `LockState` still `LOCKED`. `CallLog` has `call: placing to Dad` and `call: allowed`.
5. A number that is not on the list is stopped:
   ```powershell
   Call-Number 0400111222
   Shot "6-blocked-number"
   Top
   CallLog
   ```
   `CallLog` has `call: blocked`, and no `call: allowed`. `Top` shows `BlockActivity` (no call screen stayed open). `6-blocked-number` shows the block screen, probably with the grey toast "Right now you can only call the people on your list" near the bottom (if the toast was already gone, that is fine).
6. Grandma's number in the national form goes through:
   ```powershell
   Call-Number 0298765432
   Top
   Tap-Desc "End call"
   Start-Sleep -Seconds 3
   Top
   CallLog
   ```
   The first `Top` shows the phone app's `InCallActivity`; after **End call**, `BlockActivity`. `CallLog` has `call: allowed` and no `call: blocked`.
7. **Emergency 000** opens the dialer. **Do not press the dialer's green call button.**
   ```powershell
   Tap-Text "Emergency 000" 4
   Shot "7-emergency-dialer"
   Top
   LockState
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   Top
   CallLog
   ```
   `7-emergency-dialer` shows the phone app's dial pad with `000` typed in. The first `Top` shows the phone app, `LockState` `LOCKED`. After two Backs (the first may only close the dial pad), `Top` shows `BlockActivity`. `CallLog` has `call: dialer opened for the emergency number`. If one Back already brought the block screen, the second Back does nothing; that is fine.
8. On its side, the block screen scrolls:
   ```powershell
   & $adb shell settings put system user_rotation 1
   Start-Sleep -Seconds 3
   Shot "8-landscape"
   & $adb shell input swipe 1200 900 1200 200 600
   Start-Sleep -Seconds 2
   Shot "9-landscape-scrolled"
   & $adb shell settings put system user_rotation 0
   Start-Sleep -Seconds 3
   ```
   `8-landscape` shows the top part of the block screen on its side (time, hourglass, words), nothing squashed or overlapping. `9-landscape-scrolled` shows the lower part after the swipe: the call row and the buttons down to **Emergency 000**.
9. Ask for an hour on the block screen; Dad says yes, which unlocks; then the same number goes through:
   ```powershell
   Tap-Text "Ask for more time"
   Tap-Text "1 hour"
   Tap-Text "Send"
   Start-Sleep -Seconds 5
   Answer yes
   Wait-Unblocked
   Shot "10-unblocked"
   LockState
   Call-Number 0400111222
   Top
   Tap-Desc "End call"
   Start-Sleep -Seconds 3
   CallLog
   Requests
   ```
   `Answer yes` prints `Dad said yes to Alex's request for 60 min (no reason) +60 min.` `Wait-Unblocked` prints `Unblocked after N s` with N **10 or less**. `10-unblocked` shows the main screen (ring, about `59m`, no call buttons). `LockState` shows `NONE`. The call to `0400111222` now opens the call screen (`Top` shows `InCallActivity`), and `CallLog` has `call: allowed` and no `call: blocked`. `Requests` has `15 | denied` and `60 | approved`.
10. Undo, so the emulator can be used again:
    ```powershell
    & $adb shell am task lock stop
    & $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
    & $adb uninstall au.screentime.kid
    & $adb shell settings put system screen_off_timeout 60000
    cd ..
    docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
    Remove-Item Env:DATABASE_URL
    Remove-Item Env:JWT_SECRET
    ```
    `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success` (it also takes the role away).

- [ ] Steps 1 to 10 gave the expected results, run in this session. Paste the real output of every command in steps 1 to 9 into the handback (the `pm has-feature`, `telecom get-default-dialer`, `get-role-holders`, `Bedtime`, `Answer`, `Requests`, `Top`, `LockState`, `CallLog` and `Wait-Unblocked` lines).
- [ ] The ten screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c36\`: `1-home.png`, `2-block.png`, `3-block-waiting.png`, `4-block-no.png`, `5-calling-dad.png`, `6-blocked-number.png`, `7-emergency-dialer.png`, `8-landscape.png`, `9-landscape-scrolled.png`, `10-unblocked.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 9 files (in any order):
  ```
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/calls/CallButtons.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/calls/CallGuard.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/calls/Calls.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/calls/CallsTest.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/calls/CallsTest.kt` | Parents with a mobile come first, then the contacts in order; initials; the same number in international and national form, with spaces, dashes and brackets, matches; another number, a short one, or one with `*`, `#` or a pause never matches; while blocked only the list and the emergency number may be called. |
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt` | As in CARD-035, plus: a phone with a SIM gets the call list and the emergency number; a tablet and a phone without a SIM get no call buttons. |

The buttons, the call screen over Lock Task and the guard are checked by the emulator run in 8.2, not by unit tests.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-036: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-036-calls`
5. Open a PR into `main` titled `CARD-036: Calls from the block screen`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-036-calls --title "CARD-036: Calls from the block screen" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-036-calls.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: fourteen suites, CallsTest 5, KidStatusTest 10, all `failures="0"`
   - [x] emulator run steps 1 to 10 — results as expected
   - [x] ten screenshots in C:\Users\james\OpenCode\Testing\temp\c36\
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

- **`Tap-Desc "End call"` says `No 'End call' button on screen`**: the phone app names the button differently. Run `& $adb shell input keyevent KEYCODE_ENDCALL` instead, wait 3 seconds, carry on, and say so under "Deviations". Do it the same way in steps 6 and 9.
- **Step 4: the call screen does not show** (`Top` still shows `BlockActivity`): take a screenshot `5-calling-dad-missing`, paste `CallLog`, `Top`, `LockState` and `& $adb logcat -d | Select-String 'LockTask|Telecom' | Select-Object -Last 20`, and stop there.
- **Step 1: `get-role-holders` prints nothing**, or `add-role-holder` prints an error: paste both outputs and stop there. Do not try other ways to give the role.
- **Step 5: `CallLog` has `call: allowed` instead of `call: blocked`**, or nothing at all: paste `CallLog`, `& $adb shell cmd role get-role-holders android.app.role.CALL_REDIRECTION` and `LockState`, end any call with **End call**, and stop there.
- **Step 7: the dialer shows nothing typed**, or opens something else: paste `Top`, press Back until `Top` shows `BlockActivity`, carry on with step 8, and say so under "Deviations". **Never press the green call button.**
- **Step 8: the swipe did nothing** (`9-landscape-scrolled` looks the same as `8-landscape`): try `& $adb shell input swipe 1200 700 1200 100 600` once; if it still does not scroll, carry on and say so under "Deviations".
- **`Answer` says `the API said 401`**: `$env:JWT_SECRET` is not the same as `JWT_SECRET` in `deploy\.env`. Set it again as in "The server" and repeat.
- **`Wait-Unblocked` prints `Still blocked after 45 s`**: paste `& $adb logcat -d -s KidService:I | Select-Object -Last 10`, and stop there.
- **You are stuck in the block screen** and need the emulator back: `& $adb shell am task lock stop`, then `Bedtime 60`.
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
Claude, here is Bob's handback for CARD-036. Please review and merge if it is good.

CARD: CARD-036 Calls from the block screen
PR: <full PR URL>
Branch: bob/card-036-calls
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
