# CARD-037: Parent mode on the kid phone

| Field | Value |
|---|---|
| Card | CARD-037 |
| Title | Parent mode on the kid phone |
| Size | L |
| Depends on | CARD-036 (calls from the block screen), merged to `main` |
| Spec sections | docs/SPEC.md §9.3 (the parent-mode device endpoints), §9.4 (the snapshot's `parentMode` and `family.parentCodeSecret`), §10 (`parent_mode` message), §12.3 ("Parent mode", "As built (CARD-037)"), §16.2 (main screen, block screen) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-037-parent-mode` |
| PR title | `CARD-037: Parent mode on the kid phone` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

**Parent mode** is the only pause: a parent picks up the kid's phone and makes it unlocked, and not counting, for a while ("I need to check her messages", "she can finish this call", "let's sort out the settings"). The server side was built in earlier cards. This card builds it on the Android kid app:

- **I'm the parent**, a quiet text button at the bottom of the main screen and the block screen. It opens a sheet, "Hand to a parent", which asks every parent at once (a push to their phones: "Alex's phone: approve parent mode?"). When a parent approves in their app, the kid's phone unlocks within seconds. If a parent says no, the sheet says "Dad said no.".
- **Enter parent code instead**, in the same sheet, for when no parent can answer or the phone is offline. The parent app shows a 6-digit code that changes every 30 seconds (like a bank's authenticator app). The kid's phone checks it by itself, without the internet: it has the family's secret from the server. After a right code the parent picks **How long?**: 2 min, 5 min, 15 min, 1 hour or Until I end it.
- **While parent mode is on**: the block screen closes, no time is counted, and the notification and the main screen say "Parent mode · ends 4:15 pm" (or "Parent mode · until you end it") and "Time isn't counting", with an **End now** button. When it ends, by time, by **End now**, or by a parent in the app, the phone is blocked again at once if it is out of time or bedtime.

How it works:

- `parentmode/ParentMode.kt` is the pure logic, with unit tests: the code check (RFC 6238 "TOTP", the standard authenticator-app code), whether parent mode is on right now, and the calls to the server.
- A code session starts on the phone itself, so the server does not know about it until the phone is online. The service keeps it (and an **End now**) in a small store, `parentmode/ParentModeStore.kt`, and sends it before each sync until the server has it.
- `parentmode/ParentModeSheet.kt` holds the button, the sheet and the banner. The service (`service/KidService.kt`) treats parent mode like "not blocked, and not counting".

Claude added `server/scripts/dev-parent-mode.ts`: it plays the parent, so the run in 8.2 can say yes or no, show the parent code, or end parent mode, without the parent app (which does not exist yet).

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `ParentModeTest` (9 tests), `KidStatusTest` (12) and `LiveTest` (7); on the emulator **I'm the parent** shows on the main screen and the block screen; a parent's no shows "Dad said no."; a parent's yes unlocks the block screen within 10 seconds; a 2-minute parent mode ends by itself and blocks again, and no time was counted during it; a wrong parent code is refused and the right one, then **5 min**, unlocks; **End now** in the notification, **End now** on the main screen and a parent's end from the app each block it again within 10 seconds; the eleven screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No parent app screens (a later card), no SOS (CARD-038), no "caught" screen (CARD-039), no FCM (CARD-034b): the phone hears a parent's answer over the live channel while the screen is on, as in CARD-035.
- No change to `core-model`, `core-time`, `core-ui`, `app-parent`, `packages/`, `web/`, `server/` or `docs/`, and no change to any `build.gradle.kts`, `libs.versions.toml` or `AndroidManifest.xml`. No new dependency of any kind.
- Never run the app on a real phone or tablet in this card, and never install a **release** build anywhere.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token or the family's parent-code secret into the PR or the handback. The 6-digit codes from step 6 are fine to paste: they expire after a minute.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, Room 2.8.5, KSP 2.3.12, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36. No new library: the code check uses `javax.crypto.Mac` (HMAC-SHA1), which is part of Java.

Claude built this exact code in GitHub Actions before writing the card, so it compiles and the tests pass, ran `dev-parent-mode.ts` against the real server, and checked that it prints the same codes as the Kotlin code for the RFC 6238 test vectors.

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c37"
New-Item -ItemType Directory -Force $t | Out-Null
```

**If you are ever stuck inside the block screen on the emulator**, this always gets you out: `& $adb shell am task lock stop`.

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7), `·` (U+00B7) and `…` (U+2026); copy them exactly.

| File | Action |
|---|---|
| `android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentMode.kt` | create (5.1) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentModeStore.kt` | create (5.2) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentModeSheet.kt` | create (5.3) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/live/Live.kt` | replace (5.4) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt` | replace (5.5) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt` | replace (5.6) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/ask/Sheets.kt` | replace (5.7) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt` | replace (5.8) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt` | replace (5.9) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt` | replace (5.10) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt` | replace (5.11) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/parentmode/ParentModeTest.kt` | create (5.12) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt` | replace (5.13) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt` | replace (5.14) |

That is 14 files.

### 5.1 `android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentMode.kt`

```kotlin
package au.screentime.kid.parentmode

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.DeviceStateParentMode
import au.screentime.core.model.api.ParentModeByCode
import au.screentime.core.model.api.ParentModeRequestCreate
import au.screentime.kid.ask.SendResult
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.time.Instant
import java.time.OffsetDateTime
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.coroutines.cancellation.CancellationException

/** How long parent mode can be turned on for, in minutes; null is "Until I end it" (docs/SPEC.md §12.3). */
val PARENT_MODE_MINUTES: List<Int?> = listOf(2, 5, 15, 60, null)

/** "2 min", "1 hour", "Until I end it". */
fun durationText(minutes: Int?): String = when (minutes) {
    null -> "Until I end it"
    60 -> "1 hour"
    else -> "$minutes min"
}

/**
 * Parent mode started on this device with the parent code (docs/SPEC.md §12.3). Times are trusted-clock epoch
 * milliseconds. [reportedAtMs] is set once the server has it.
 */
data class CodeSession(
    val id: String,
    val durationMin: Int?,
    val startedAtMs: Long,
    val reportedAtMs: Long? = null,
) {
    /** Null for "Until I end it". */
    val endsAtMs: Long? get() = durationMin?.let { startedAtMs + it * 60_000L }
}

/** What this device did about parent mode that the server may not know yet. */
data class LocalParentMode(
    val code: CodeSession? = null,
    /** When **End now** was last tapped on this device. */
    val endedAtMs: Long? = null,
    /** False until the server has that **End now**. */
    val endReported: Boolean = true,
) {
    /** Something still to send to the server. */
    val pending: Boolean get() = (code != null && code.reportedAtMs == null) || !endReported
}

/** Parent mode is on until [endsAtMs] (null: until a parent ends it), started by [byName] (null: the parent code). */
data class ParentModeOn(val endsAtMs: Long?, val byName: String?)

/**
 * Whether parent mode is on at [nowMs]: from the snapshot ([server], fetched at the server's [serverTimeMs]), or
 * from what this device did itself. A code session the server does not have yet counts, and so does one the server
 * got after this snapshot was made. An **End now** on this device beats a snapshot made before it.
 */
fun parentModeNow(server: DeviceStateParentMode, serverTimeMs: Long, local: LocalParentMode, nowMs: Long): ParentModeOn? {
    val ended = local.endedAtMs
    val code = local.code
    if (code != null && (ended == null || ended < code.startedAtMs)) {
        val endsAt = code.endsAtMs
        val reported = code.reportedAtMs
        val notInSnapshot = reported == null || serverTimeMs < reported
        if (notInSnapshot && (endsAt == null || nowMs < endsAt)) return ParentModeOn(endsAt, null)
    }
    if (!server.active || (ended != null && serverTimeMs <= ended)) return null
    val endsAt = server.endsAt?.let { OffsetDateTime.parse(it).toInstant().toEpochMilli() }
    return if (endsAt == null || nowMs < endsAt) ParentModeOn(endsAt, server.byName) else null
}

/**
 * Whether [code] is the parent code at [nowMs] for the family's base32 [secret]: a 6-digit TOTP (RFC 6238, SHA-1,
 * 30-second steps), one step either side also accepted (docs/SPEC.md §12.3).
 */
fun codeOk(secret: String, code: String, nowMs: Long): Boolean {
    val key = base32Decode(secret) ?: return false
    if (key.isEmpty() || code.length != 6 || !code.all { it in '0'..'9' }) return false
    return (-1..1).any { parentCode(key, nowMs + it * STEP_MS) == code }
}

/** The 6-digit code for [key] in the 30-second step that holds [timeMs]. */
fun parentCode(key: ByteArray, timeMs: Long): String {
    val mac = Mac.getInstance("HmacSHA1")
    mac.init(SecretKeySpec(key, "HmacSHA1"))
    val hash = mac.doFinal(ByteBuffer.allocate(8).putLong(Math.floorDiv(timeMs, STEP_MS)).array())
    val at = hash[hash.size - 1].toInt() and 0x0F
    val number = ((hash[at].toInt() and 0x7F) shl 24) or
        ((hash[at + 1].toInt() and 0xFF) shl 16) or
        ((hash[at + 2].toInt() and 0xFF) shl 8) or
        (hash[at + 3].toInt() and 0xFF)
    return (number % 1_000_000).toString().padStart(6, '0')
}

/** RFC 4648 base32 (`A`–`Z`, `2`–`7`), any case, `=` padding ignored; null for any other character. */
fun base32Decode(text: String): ByteArray? {
    val out = ByteArrayOutputStream()
    var buffer = 0
    var bits = 0
    for (c in text.uppercase()) {
        if (c == '=') continue
        val value = BASE32.indexOf(c)
        if (value < 0) return null
        buffer = ((buffer shl 5) or value) and 0xFFFF
        bits += 5
        if (bits >= 8) {
            bits -= 8
            out.write((buffer shr bits) and 0xFF)
        }
    }
    return out.toByteArray()
}

private const val BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
private const val STEP_MS = 30_000L

/** Parent mode's calls to the server (docs/SPEC.md §9.3). */
class ParentModeApi(private val api: ApiClient) {
    /**
     * "I'm the parent": every parent gets a push to approve. [id] is made once when the screen opens, so a retry
     * does not ask twice. A 409 means parent mode is already on, which is what the kid wanted.
     */
    suspend fun request(id: String): SendResult = try {
        api.postDeviceParentModeRequests(ParentModeRequestCreate(id))
        SendResult.SENT
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiException) {
        if (e.status == 409) SendResult.SENT else SendResult.FAILED
    } catch (e: IOException) {
        SendResult.OFFLINE
    } catch (e: Exception) {
        SendResult.FAILED
    }

    /**
     * Sends what the server does not have yet: a code session, then an **End now**, in that order. Returns [local]
     * with what was sent marked; what failed for want of a connection stays to be sent next time. Any answer from
     * the server counts as sent: sending it again would get the same answer.
     */
    suspend fun flush(local: LocalParentMode, nowMs: Long): LocalParentMode {
        var out = local
        val code = local.code
        if (code != null && code.reportedAtMs == null) {
            val sent = deliver {
                api.postDeviceParentMode(
                    ParentModeByCode(code.id, code.durationMin, Instant.ofEpochMilli(code.startedAtMs).toString()),
                )
            }
            if (!sent) return out
            out = out.copy(code = code.copy(reportedAtMs = nowMs))
        }
        if (!local.endReported && deliver { api.postDeviceParentModeEnd() }) out = out.copy(endReported = true)
        return out
    }

    private suspend fun deliver(call: suspend () -> Unit): Boolean = try {
        call()
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiException) {
        true
    } catch (e: Exception) {
        false
    }
}
```

### 5.2 `android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentModeStore.kt`

```kotlin
package au.screentime.kid.parentmode

import android.content.Context

/**
 * [LocalParentMode] in SharedPreferences, so a code session and an **End now** survive a restart until the server
 * has them. Only the service writes it, one change at a time.
 */
class ParentModeStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("parent_mode", Context.MODE_PRIVATE)

    fun load(): LocalParentMode {
        val id = prefs.getString(CODE_ID, null)
        val code = if (id == null) {
            null
        } else {
            CodeSession(
                id = id,
                durationMin = prefs.getInt(CODE_MINUTES, 0).takeIf { it > 0 },
                startedAtMs = prefs.getLong(CODE_STARTED, 0),
                reportedAtMs = prefs.getLong(CODE_REPORTED, 0).takeIf { it > 0 },
            )
        }
        return LocalParentMode(
            code = code,
            endedAtMs = prefs.getLong(ENDED, 0).takeIf { it > 0 },
            endReported = prefs.getBoolean(END_REPORTED, true),
        )
    }

    fun save(local: LocalParentMode) {
        val edit = prefs.edit().clear()
        local.code?.let {
            edit.putString(CODE_ID, it.id)
                .putInt(CODE_MINUTES, it.durationMin ?: 0)
                .putLong(CODE_STARTED, it.startedAtMs)
                .putLong(CODE_REPORTED, it.reportedAtMs ?: 0)
        }
        local.endedAtMs?.let { edit.putLong(ENDED, it) }
        // Written at once: the next thing may be a reboot.
        edit.putBoolean(END_REPORTED, local.endReported).commit()
    }

    private companion object {
        const val CODE_ID = "codeId"
        const val CODE_MINUTES = "codeMinutes"
        const val CODE_STARTED = "codeStartedAtMs"
        const val CODE_REPORTED = "codeReportedAtMs"
        const val ENDED = "endedAtMs"
        const val END_REPORTED = "endReported"
    }
}
```

### 5.3 `android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentModeSheet.kt`

```kotlin
package au.screentime.kid.parentmode

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.ask.Choice
import au.screentime.kid.ask.ErrorLine
import au.screentime.kid.ask.Look
import au.screentime.kid.ask.SendResult
import au.screentime.kid.ask.SheetTitle
import au.screentime.kid.ask.withApi
import au.screentime.kid.live.ParentModeNews
import au.screentime.kid.service.KidService
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.StatusHub
import java.util.UUID

private enum class Step { WAITING, CODE, HOW_LONG }

/**
 * **I'm the parent**, a quiet text button at the bottom of the main screen and the block screen (docs/SPEC.md
 * §16.2). It opens the "Hand to a parent" sheet, which closes by itself once parent mode is on.
 */
@Composable
fun ParentButton(status: KidStatus, look: Look, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    LaunchedEffect(status.parentMode) {
        if (status.parentMode) open = false
    }
    val color = if (look == Look.DAY) {
        MaterialTheme.colorScheme.onSurfaceVariant
    } else {
        ScreenTimeTheme.colors.onNight.copy(alpha = 0.7f)
    }
    TextButton(onClick = { open = true }, modifier = modifier) {
        Text("I'm the parent", style = MaterialTheme.typography.titleSmall, color = color)
    }
    if (open && !status.parentMode) ParentModeSheet(status, onDone = { open = false })
}

/**
 * "Hand to a parent" (docs/SPEC.md §12.3, §16.2): asks every parent to approve as soon as it opens, and offers the
 * parent code instead. After a right code a parent picks how long, and the service starts parent mode.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ParentModeSheet(status: KidStatus, onDone: () -> Unit) {
    val context = LocalContext.current
    var step by remember { mutableStateOf(Step.WAITING) }
    var asked by remember { mutableStateOf<SendResult?>(null) }
    // One request each time the sheet opens.
    val id = remember { UUID.randomUUID().toString() }
    val news by StatusHub.parentModeNews.collectAsState()
    LaunchedEffect(Unit) {
        StatusHub.parentModeNews.value = null
        StatusHub.parentModeAsked.value = true
        asked = withApi(context, SendResult.FAILED) { ParentModeApi(it).request(id) }
        // The service opens the live channel for the answer.
        KidService.syncSoon(context)
    }
    DisposableEffect(Unit) {
        onDispose {
            StatusHub.parentModeAsked.value = false
            StatusHub.parentModeNews.value = null
        }
    }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDone, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
        ) {
            when (step) {
                Step.WAITING -> Waiting(status, asked, news?.takeIf { !it.active && it.requestId == id }) {
                    step = Step.CODE
                }
                Step.CODE -> CodeEntry(status.parentCodeSecret) { step = Step.HOW_LONG }
                Step.HOW_LONG -> HowLong { minutes ->
                    KidService.startParentMode(context, minutes)
                    onDone()
                }
            }
        }
    }
}

/** "We've asked Mum and Dad to approve." with a spinner, or why not; and **Enter parent code instead**. */
@Composable
private fun Waiting(status: KidStatus, asked: SendResult?, no: ParentModeNews?, onCode: () -> Unit) {
    SheetTitle("Hand to a parent")
    Spacer(Modifier.height(16.dp))
    val line = when {
        no != null -> "${no.byName ?: status.parentsOr} said no."
        asked == SendResult.OFFLINE -> "Can't reach ${status.parentsAnd} right now. A parent can use the parent code."
        asked == SendResult.FAILED -> "That didn't work. A parent can use the parent code."
        else -> "We've asked ${status.parentsAnd} to approve."
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (no == null && (asked == null || asked == SendResult.SENT)) {
            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 3.dp)
            Spacer(Modifier.width(16.dp))
        }
        Text(line, style = MaterialTheme.typography.bodyLarge)
    }
    Spacer(Modifier.height(24.dp))
    FilledTonalButton(
        onClick = onCode,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
    ) {
        Text("Enter parent code instead", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
}

/**
 * The 6-digit parent code, in big digits with the number keypad. It is checked as soon as the sixth digit is in,
 * against the phone's clock, which Device Owner keeps set automatically (docs/SPEC.md §12.1).
 */
@Composable
private fun CodeEntry(secret: String, onRight: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    SheetTitle("Parent code")
    Spacer(Modifier.height(8.dp))
    Text(
        text = "Type the 6 numbers from the Screen Time app on a parent's phone.",
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(16.dp))
    OutlinedTextField(
        value = code,
        onValueChange = { typed ->
            code = typed.filter { it in '0'..'9' }.take(6)
            wrong = false
            if (code.length == 6) {
                if (codeOk(secret, code, System.currentTimeMillis())) {
                    onRight()
                } else {
                    wrong = true
                    code = ""
                }
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .focusRequester(focus),
        textStyle = MaterialTheme.typography.displaySmall.copy(
            textAlign = TextAlign.Center,
            letterSpacing = 12.sp,
            fontWeight = FontWeight.Bold,
        ),
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        shape = RoundedCornerShape(16.dp),
    )
    if (wrong) ErrorLine("That's not the code. Try the one on the phone now.")
}

/** "How long?": 2 min, 5 min, 15 min, 1 hour or Until I end it. */
@Composable
private fun HowLong(onPick: (Int?) -> Unit) {
    SheetTitle("How long?")
    Spacer(Modifier.height(16.dp))
    for (minutes in PARENT_MODE_MINUTES) {
        Choice(durationText(minutes), selected = false, modifier = Modifier.fillMaxWidth(), align = TextAlign.Center) {
            onPick(minutes)
        }
        Spacer(Modifier.height(8.dp))
    }
}

/**
 * On the main screen while parent mode is on, in place of the kid's buttons: "Parent mode · ends 4:15 pm" and
 * **End now**. The line under the ring says "Time isn't counting".
 */
@Composable
fun ParentModeBanner(status: KidStatus, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Column(
        modifier = modifier
            .widthIn(max = 420.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(ScreenTimeTheme.colors.primary.copy(alpha = 0.12f))
            .padding(20.dp),
    ) {
        Text(status.parentModeText(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { KidService.endParentMode(context) },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            Text("End now", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
    }
}
```

### 5.4 `android/app-kid/src/main/kotlin/au/screentime/kid/live/Live.kt`

Replace the whole file. Compared with `main`: `ParentModeNews` and `parentModeNewsOf` at the end.

```kotlin
package au.screentime.kid.live

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/** What the device sends every 30 seconds to keep the socket alive (docs/SPEC.md §10). */
const val PING = """{"type":"ping"}"""

/**
 * The live channel's address for [serverUrl] (`GET /v1/device/ws`, docs/SPEC.md §9): `https` becomes `wss` and
 * `http` becomes `ws`.
 */
fun liveUrl(serverUrl: String): String {
    val base = serverUrl.trimEnd('/')
    val socket = when {
        base.startsWith("https://") -> "wss://" + base.removePrefix("https://")
        base.startsWith("http://") -> "ws://" + base.removePrefix("http://")
        else -> throw IllegalArgumentException("not an http or https address: $serverUrl")
    }
    return "$socket/v1/device/ws"
}

/**
 * How long to wait before reconnect number [attempt] (0 for the first): 1, 2, 4 … 60 seconds, times [jitter],
 * which is between 0.8 and 1.2 (docs/SPEC.md §8.3, ±20%).
 */
fun backoffMs(attempt: Int, jitter: Double): Long {
    val base = minOf(1_000L shl attempt.coerceIn(0, 6), 60_000L)
    return (base * jitter).toLong()
}

/**
 * True when a frame from the server means "sync now": any envelope (docs/SPEC.md §10) except `pong`. A frame that
 * is not a JSON object with a `type` means nothing.
 */
fun asksForSync(frame: String): Boolean {
    val type = try {
        (Json.parseToJsonElement(frame) as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull
    } catch (e: IllegalArgumentException) {
        // Not JSON (SerializationException is an IllegalArgumentException), or a `type` that is not a string.
        null
    }
    return type != null && type != "pong"
}

/** A parent's answer to the kid's "Ask for more time" (docs/SPEC.md §10, `request_resolved`). */
data class Answer(
    val approved: Boolean,
    /** What the yes gave, which may differ from what was asked; 0 for a no. */
    val minutes: Int,
    /** "Dad". */
    val byName: String,
)

/** The [Answer] in a `request_resolved` envelope, or null for any other frame. */
fun answerOf(frame: String): Answer? = try {
    val envelope = Json.parseToJsonElement(frame) as? JsonObject
    val data = envelope?.get("data") as? JsonObject
    if (envelope?.get("type")?.jsonPrimitive?.contentOrNull != "request_resolved" || data == null) {
        null
    } else {
        val approved = data["approved"]?.jsonPrimitive?.booleanOrNull
        val minutes = data["minutes"]?.jsonPrimitive?.intOrNull
        val byName = data["byName"]?.jsonPrimitive?.contentOrNull
        if (approved == null || minutes == null || byName == null) null else Answer(approved, minutes, byName)
    }
} catch (e: IllegalArgumentException) {
    null
}

/**
 * A parent turned parent mode on or off for this device (docs/SPEC.md §10, `parent_mode`). [requestId] is set when
 * it answers this device's "I'm the parent"; [active] false with a [requestId] is a no.
 */
data class ParentModeNews(val active: Boolean, val requestId: String?, val byName: String?)

/** The [ParentModeNews] in a `parent_mode` envelope, or null for any other frame. */
fun parentModeNewsOf(frame: String): ParentModeNews? = try {
    val envelope = Json.parseToJsonElement(frame) as? JsonObject
    val data = envelope?.get("data") as? JsonObject
    val active = data?.get("active")?.jsonPrimitive?.booleanOrNull
    if (envelope?.get("type")?.jsonPrimitive?.contentOrNull != "parent_mode" || active == null) {
        null
    } else {
        ParentModeNews(
            active = active,
            requestId = data["requestId"]?.jsonPrimitive?.contentOrNull,
            byName = data["byName"]?.jsonPrimitive?.contentOrNull,
        )
    }
} catch (e: IllegalArgumentException) {
    null
}
```

### 5.5 `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt`

Replace the whole file. Compared with `main`: one import and two new flows, `parentModeAsked` and `parentModeNews`.

```kotlin
package au.screentime.kid.status

import au.screentime.kid.live.Answer
import au.screentime.kid.live.ParentModeNews
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
}
```

### 5.6 `android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt`

Replace the whole file. Compared with `main`: one import, four new fields at the end of `KidStatus` (with defaults, so `WarningTrackerTest` is unchanged), `title()` and `subline()` for parent mode, `parentModeText()`, the `parentMode` parameter of `kidStatus` (not locked while it is on), and the end of parent mode in `nextCheckAtMs`.

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
import au.screentime.kid.parentmode.ParentModeOn
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
    /** Parent mode is on (docs/SPEC.md §12.3): not locked, and nothing counts. */
    val parentMode: Boolean = false,
    /** When parent mode ends; null while it is off or lasts until a parent ends it. */
    val parentModeEndsAtMs: Long? = null,
    /** [parentModeEndsAtMs] as a time of day, "4:15 pm". */
    val parentModeEndsText: String? = null,
    /** The family's secret for the parent code (base32). */
    val parentCodeSecret: String = "",
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

    /** The notification title: "Phone · 1h 12m left", "It's bedtime" when locked, or the parent mode line. */
    fun title(left: Long = leftSec): String = when {
        parentMode -> parentModeText()
        else -> lockReason?.let { headline(it) } ?: "$poolName · ${formatDuration(left)} left"
    }

    /** "Parent mode · ends 4:15 pm", or "Parent mode · until you end it". */
    fun parentModeText(): String =
        "Parent mode · " + (parentModeEndsText?.let { "ends $it" } ?: "until you end it")

    /** "Out of Phone time", "It's bedtime" or "Not yet, it's early". */
    fun headline(reason: LockReason): String = when (reason) {
        LockReason.OUT_OF_TIME -> "Out of $poolName time"
        LockReason.BEDTIME -> "It's bedtime"
        LockReason.BEFORE_WAKE -> "Not yet, it's early"
    }

    /** The line under it: "Bedtime 8:30 pm"; when locked "Phone is back at 7:00 am" or "New time tomorrow". */
    fun subline(): String? = when {
        parentMode -> "Time isn't counting"
        else -> lockSubline()
    }

    private fun lockSubline(): String? = when (lockReason) {
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

/**
 * The status for [result], the engine's answer for [state] at [nowMs]. While [parentMode] is on the device is not
 * locked and does not lock (docs/SPEC.md §12.3).
 */
fun kidStatus(
    state: DeviceState,
    result: EngineResult,
    nowMs: Long,
    online: Boolean,
    elapsedMs: Long,
    parentMode: ParentModeOn? = null,
): KidStatus {
    val tz = ZoneId.of(state.family.timezone)
    val local = Instant.ofEpochMilli(nowMs).atZone(tz)
    val date = local.toLocalDate()
    fun dayOf(weekday: Int) = state.schedule.days.first { it.weekday == weekday }
    val today = dayOf(date.dayOfWeek.value)

    val lockAtMs = if (parentMode != null) null else result.nextLockAt?.toEpochMilli()
    val leftSec = when {
        result.locked && parentMode == null -> 0L
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
        lockReason = if (result.locked && parentMode == null) result.lockReason else null,
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
        parentMode = parentMode != null,
        parentModeEndsAtMs = parentMode?.endsAtMs,
        parentModeEndsText = parentMode?.endsAtMs?.let { clockText(Instant.ofEpochMilli(it).atZone(tz).toLocalTime()) },
        parentCodeSecret = state.family.parentCodeSecret,
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
 * When the service must look again (docs/SPEC.md §12.1): the first of warn 1, warn 2, the lock, the end of parent mode
 * and [KidStatus.reevaluateAtMs] that is still to come, and at least once a minute.
 */
fun nextCheckAtMs(status: KidStatus, nowMs: Long): Long {
    val lockAt = status.lockAtMs
    val events = buildList {
        add(status.reevaluateAtMs)
        status.parentModeEndsAtMs?.let(::add)
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

### 5.7 `android/app-kid/src/main/kotlin/au/screentime/kid/ask/Sheets.kt`

Replace the whole file. Compared with `main`: `SheetTitle`, `Choice` and `ErrorLine` are `internal` instead of `private` (the parent mode sheet uses them), and `sendWith` now uses the new `withApi` at the end of the file.

```kotlin
package au.screentime.kid.ask

import android.content.Context
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.ApiClient
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.live.Answer
import au.screentime.kid.service.KidService
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Preset
import au.screentime.kid.status.StatusHub
import io.ktor.client.engine.okhttp.OkHttp
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The light main screen, or the night-blue block screen. */
enum class Look { DAY, NIGHT }

private enum class Sheet { ASK, MESSAGE }

/** How long a parent's answer stays on the screen (docs/SPEC.md §16.2). */
private const val ANSWER_MS = 4_000L

/** The green of "Dad said yes!" (the green kid avatar colour, docs/SPEC.md §16.1). */
private val Yes = Color(0xFF16A34A)

/**
 * The kid's two buttons, **Ask for more time** and **Message Mum and Dad**, with the card above them: a parent's
 * answer for 4 seconds, or "Waiting for Mum or Dad…" while a request has no answer (docs/SPEC.md §16.2). The
 * buttons open the two sheets. Used by the main screen ([Look.DAY]) and the block screen ([Look.NIGHT]).
 */
@Composable
fun AskAndMessage(status: KidStatus, look: Look, modifier: Modifier = Modifier) {
    var sheet by remember { mutableStateOf<Sheet?>(null) }
    val answer by StatusHub.answer.collectAsState()
    LaunchedEffect(answer) {
        val shown = answer ?: return@LaunchedEffect
        delay(ANSWER_MS)
        StatusHub.answer.compareAndSet(shown, null)
    }

    Column(modifier = modifier.widthIn(max = 420.dp).fillMaxWidth()) {
        val waiting = status.pendingMinutes
        val shown = answer
        when {
            shown != null -> {
                AnswerCard(shown, look)
                Spacer(Modifier.height(16.dp))
            }
            waiting != null -> {
                WaitingCard("Waiting for ${status.parentsOr}…", look)
                Spacer(Modifier.height(16.dp))
            }
        }
        KidButton("Ask for more time", primary = true, look = look, enabled = waiting == null) { sheet = Sheet.ASK }
        Spacer(Modifier.height(12.dp))
        KidButton("Message ${status.parentsAnd}", primary = false, look = look) { sheet = Sheet.MESSAGE }
    }

    when (sheet) {
        Sheet.ASK -> AskSheet(status, onDone = { sheet = null })
        Sheet.MESSAGE -> MessageSheet(status, onDone = { sheet = null })
        null -> {}
    }
}

/** A 56 dp pill (docs/SPEC.md §16.1): filled or tonal by day, light or outlined on the night background. */
@Composable
private fun KidButton(text: String, primary: Boolean, look: Look, enabled: Boolean = true, onClick: () -> Unit) {
    val colors = ScreenTimeTheme.colors
    val size = Modifier
        .fillMaxWidth()
        .height(56.dp)
    val label: @Composable () -> Unit = {
        Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
    when {
        primary && look == Look.DAY -> Button(onClick = onClick, modifier = size, enabled = enabled) { label() }
        primary -> Button(
            onClick = onClick,
            modifier = size,
            enabled = enabled,
            colors = ButtonDefaults.buttonColors(
                containerColor = colors.onNight,
                contentColor = colors.nightTop,
                disabledContainerColor = colors.onNight.copy(alpha = 0.3f),
                disabledContentColor = colors.nightTop.copy(alpha = 0.7f),
            ),
        ) { label() }
        look == Look.DAY -> FilledTonalButton(onClick = onClick, modifier = size, enabled = enabled) { label() }
        else -> OutlinedButton(
            onClick = onClick,
            modifier = size,
            enabled = enabled,
            border = BorderStroke(1.5.dp, colors.onNight),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.onNight),
        ) { label() }
    }
}

/** "Waiting for Mum or Dad…" with a gently pulsing dot. */
@Composable
private fun WaitingCard(text: String, look: Look) {
    val colors = ScreenTimeTheme.colors
    val day = look == Look.DAY
    val container = if (day) MaterialTheme.colorScheme.surfaceVariant else colors.onNight.copy(alpha = 0.12f)
    val content = if (day) MaterialTheme.colorScheme.onSurface else colors.onNight
    val dot = if (day) colors.primary else colors.onNight
    val pulse by rememberInfiniteTransition(label = "waiting").animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "dot",
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(container)
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(12.dp)
                .alpha(pulse)
                .background(dot, CircleShape),
        )
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.titleMedium, color = content)
    }
}

/** "Dad said yes! +15 min 🎉" on green, or "Dad said not this time" on a neutral card. */
@Composable
private fun AnswerCard(answer: Answer, look: Look) {
    val colors = ScreenTimeTheme.colors
    val container = when {
        answer.approved -> Yes
        look == Look.DAY -> MaterialTheme.colorScheme.surfaceVariant
        else -> colors.onNight.copy(alpha = 0.12f)
    }
    val content = when {
        answer.approved -> Color.White
        look == Look.DAY -> MaterialTheme.colorScheme.onSurface
        else -> colors.onNight
    }
    Text(
        text = answerText(answer),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(container)
            .padding(horizontal = 20.dp, vertical = 16.dp),
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        color = content,
        textAlign = TextAlign.Center,
    )
}

/** "How much more?": 15 min, 30 min or 1 hour, a reason if the kid wants, and **Send**. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AskSheet(status: KidStatus, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var minutes by remember { mutableIntStateOf(ASK_MINUTES.first()) }
    var reason by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // A new id when the request changes; the same one for a retry.
    val id = remember(minutes, reason) { UUID.randomUUID().toString() }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDone, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
        ) {
            SheetTitle("How much more?")
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (m in ASK_MINUTES) {
                    Choice(
                        text = if (m == 60) "1 hour" else "$m min",
                        selected = m == minutes,
                        modifier = Modifier.weight(1f),
                        align = TextAlign.Center,
                    ) { minutes = m }
                }
            }
            Spacer(Modifier.height(16.dp))
            TextBox(reason, { reason = it }, "Why? (optional)")
            error?.let { ErrorLine(it) }
            Spacer(Modifier.height(16.dp))
            SendButton(sending, enabled = !sending) {
                sending = true
                error = null
                scope.launch {
                    val result = sendWith(context) { it.ask(id, minutes, reason) }
                    sending = false
                    error = sendErrorText(result, status.parentsOr)
                    if (error == null) {
                        // The next snapshot has the request, and the screen shows "Waiting for…".
                        KidService.syncSoon(context)
                        onDone()
                    }
                }
            }
        }
    }
}

/** "Message Mum and Dad": the family's ready-made messages, or the kid's own words, and **Send**; then "Sent ✓". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MessageSheet(status: KidStatus, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var preset by remember { mutableStateOf<Preset?>(null) }
    var own by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // A new id when the message changes; the same one for a retry.
    val id = remember(preset, own) { UUID.randomUUID().toString() }
    if (sent) {
        LaunchedEffect(Unit) {
            delay(1_500)
            onDone()
        }
    }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDone, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
        ) {
            if (sent) {
                Text(
                    text = "Sent ✓",
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 48.dp),
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    color = ScreenTimeTheme.colors.primary,
                    textAlign = TextAlign.Center,
                )
                return@Column
            }
            SheetTitle("Message ${status.parentsAnd}")
            Spacer(Modifier.height(16.dp))
            for (p in status.presets) {
                Choice(p.text, selected = p == preset, modifier = Modifier.fillMaxWidth(), align = TextAlign.Start) {
                    preset = p
                    own = ""
                }
                Spacer(Modifier.height(8.dp))
            }
            Spacer(Modifier.height(8.dp))
            TextBox(own, {
                own = it
                if (it.isNotBlank()) preset = null
            }, "Or write your own")
            error?.let { ErrorLine(it) }
            Spacer(Modifier.height(16.dp))
            SendButton(sending, enabled = !sending && (preset != null || own.isNotBlank())) {
                val body = preset?.text ?: own
                val presetId = preset?.id
                sending = true
                error = null
                scope.launch {
                    val result = sendWith(context) { it.message(id, body, presetId) }
                    sending = false
                    error = sendErrorText(result, status.parentsAnd)
                    if (error == null) sent = true
                }
            }
        }
    }
}

@Composable
internal fun SheetTitle(text: String) {
    Text(text, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
}

/** A big rounded choice: teal when picked, grey otherwise. */
@Composable
internal fun Choice(text: String, selected: Boolean, modifier: Modifier, align: TextAlign, onClick: () -> Unit) {
    val colors = ScreenTimeTheme.colors
    Surface(
        onClick = onClick,
        modifier = modifier.heightIn(min = 56.dp),
        shape = RoundedCornerShape(28.dp),
        color = if (selected) colors.primary else MaterialTheme.colorScheme.surfaceVariant,
        contentColor = if (selected) colors.onPrimary else MaterialTheme.colorScheme.onSurface,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(
                text = text,
                modifier = Modifier.fillMaxWidth(),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                textAlign = align,
            )
        }
    }
}

/** A text field of at most [MAX_TEXT] characters, with "0/160" under it. */
@Composable
private fun TextBox(value: String, onValue: (String) -> Unit, label: String) {
    OutlinedTextField(
        value = value,
        onValueChange = { onValue(it.take(MAX_TEXT)) },
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label) },
        supportingText = {
            Text("${value.length}/$MAX_TEXT", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.End)
        },
        minLines = 2,
        maxLines = 4,
        shape = RoundedCornerShape(16.dp),
    )
}

@Composable
internal fun ErrorLine(text: String) {
    Spacer(Modifier.height(8.dp))
    Text(text, style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.danger)
}

@Composable
private fun SendButton(sending: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        enabled = enabled,
    ) {
        Text(
            text = if (sending) "Sending…" else "Send",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

/** Runs [block] with a [Sender] on this device's own token, then closes the connection. */
private suspend fun sendWith(context: Context, block: suspend (Sender) -> SendResult): SendResult =
    withApi(context, SendResult.FAILED) { block(Sender(it)) }

/** Runs [block] with an [ApiClient] on this device's own token, then closes it; [fallback] when not paired. */
internal suspend fun <T> withApi(context: Context, fallback: T, block: suspend (ApiClient) -> T): T {
    val enrolment = EnrolmentStore(context).load() ?: return fallback
    val engine = OkHttp.create()
    val api = ApiClient(enrolment.serverUrl, engine, token = { enrolment.deviceToken })
    return try {
        block(api)
    } finally {
        api.close()
        engine.close()
    }
}
```

### 5.8 `android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt`

Replace the whole file. Compared with `main`: the comment, three imports, `KidActions` in place of the two `AskAndMessage` calls, and no "Offline · still counting" line in parent mode.

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import au.screentime.kid.ask.AskAndMessage
import au.screentime.kid.ask.Look
import au.screentime.kid.parentmode.ParentButton
import au.screentime.kid.parentmode.ParentModeBanner
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Level
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.delay

/**
 * The kid's main screen (docs/SPEC.md §16.2): "Hi Alex", the ring with the time left, bedtime, "Offline · still
 * counting" when the last sync failed, **Ask for more time**, **Message Mum and Dad** and **I'm the parent**; in
 * parent mode the parent mode banner with **End now**. SOS comes with its card.
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
            // Tablet or landscape: the ring on the left half, the words and buttons on the right.
            Row(modifier = Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    Ring(s, left)
                }
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Greeting(s.kidName)
                    Spacer(Modifier.height(16.dp))
                    Details(s, TextAlign.Start)
                    Spacer(Modifier.height(24.dp))
                    KidActions(s)
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
                KidActions(s)
            }
        }
    }
}

/**
 * **Ask for more time**, **Message Mum and Dad** and **I'm the parent**; while parent mode is on, the parent mode
 * banner with **End now** instead.
 */
@Composable
private fun KidActions(s: KidStatus) {
    if (s.parentMode) {
        ParentModeBanner(s)
    } else {
        AskAndMessage(s, Look.DAY)
        Spacer(Modifier.height(8.dp))
        ParentButton(
            s,
            Look.DAY,
            Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth(),
        )
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
    if (!s.online && !s.parentMode) {
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

### 5.9 `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt`

Replace the whole file. Compared with `main`: the comment, one import, and `ParentButton` at the bottom.

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
import au.screentime.kid.parentmode.ParentButton
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.clockText
import java.time.LocalTime
import kotlinx.coroutines.delay

/**
 * The block screen's content (docs/SPEC.md §16.2): the time at the top, a moon or an hourglass, "It's bedtime",
 * when the device is back, and **Ask for more time** and **Message Mum and Dad**. A phone with a SIM also has the
 * row of call buttons above them and **Emergency 000** under them. **I'm the parent** is last. SOS comes with its
 * card.
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
        ParentButton(status, Look.NIGHT)
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

### 5.10 `android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt`

Replace the whole file. Compared with `main`: the comments, the `endParentMode` intent, and the **End now** action while parent mode is on.

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
import au.screentime.kid.ask.answerText
import au.screentime.kid.live.Answer
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Warning
import au.screentime.kid.status.warningText
import au.screentime.kid.status.warningTitle

/**
 * The kid app's notifications (docs/SPEC.md §16.2): the silent status notification of the foreground service (with
 * **End now** while parent mode is on), the heads-up warnings before a lock, and a parent's answer to "Ask for more
 * time".
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
        manager.createNotificationChannel(
            NotificationChannel(ANSWER_CHANNEL, "Answers from your parents", NotificationManager.IMPORTANCE_HIGH).apply {
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

    /** Ends parent mode through the service. */
    private val endParentMode: PendingIntent = PendingIntent.getService(
        context,
        1,
        Intent(context, KidService::class.java).setAction(KidService.ACTION_END_PARENT_MODE),
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
     * In parent mode: "Parent mode · ends 4:15 pm", "Time isn't counting" and **End now**.
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
        if (status.parentMode) {
            builder.addAction(Notification.Action.Builder(null, "End now", endParentMode).build())
        }
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

    /** "Dad said yes! +15 min 🎉" or "Dad said not this time", heads-up; it goes away by itself after a minute. */
    fun showAnswer(answer: Answer) {
        val notification = Notification.Builder(context, ANSWER_CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(answerText(answer))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000L)
            .build()
        manager.notify(ANSWER_ID, notification)
    }

    fun cancelWarning() {
        manager.cancel(WARNING_ID)
    }

    companion object {
        const val STATUS_ID = 1
        private const val WARNING_ID = 2
        private const val ANSWER_ID = 3
        private const val STATUS_CHANNEL = "status"
        private const val WARNING_CHANNEL = "warnings"
        private const val ANSWER_CHANNEL = "answers"
    }
}
```

### 5.11 `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

Replace the whole file. Compared with `main`: the comment, six imports, the parent mode store and calls, the `paused` flag (parent mode on: not blocked and not counting), the news from the live channel, the loop's wait in parent mode, the two new actions in `onStartCommand`, `startWithCode` and `endParentMode`, the parent mode sent before each sync, parent mode in `report()` and `updateLive`, and the two new functions in the companion.

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
 * on, it also keeps the live channel open (§8.3), so a parent's grant or answer shows within seconds. While parent
 * mode is on (§12.3) the device is not blocked and nothing counts. Everything runs one at a time on [scope], so the
 * database and the parent mode store see one change after another.
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
        parentStore = ParentModeStore(this)
        segments = RoomSegmentStore(KidDatabase.open(this).segments())
        states = FileStateStore(this)
        recorder = Recorder(segments) { UUID.randomUUID().toString() }
        val http = OkHttp.create()
        val client = ApiClient(enrolment.serverUrl, http, token = { enrolment.deviceToken })
        engine = http
        api = client
        parentApi = ParentModeApi(client)
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
                // down, at least every 30 seconds, to see a parent's grant soon. Otherwise a minute.
                val untilNext = (nextCheckAt - clock.nowMs()).coerceIn(SECOND, MINUTE)
                val wait = when {
                    inUse() || (paused && screenOn()) -> untilNext
                    blocked && screenOn() -> if (live?.connected == true) untilNext else minOf(untilNext, BLOCKED_POLL)
                    else -> MINUTE
                }
                // Woken early: sync if the live channel asked for it, then work out the wait again.
                if (withTimeoutOrNull(wait) { wake.receive() } != null) {
                    if (syncWanted) sync()
                    continue
                }
                when {
                    inUse() -> {
                        recorder.tick(clock.nowMs())
                        if (SystemClock.elapsedRealtime() - lastSyncElapsed >= 5 * MINUTE) sync() else report()
                    }
                    blocked && screenOn() -> if (live?.connected == true) report() else sync()
                    paused && screenOn() -> if (live?.connected == true) report() else sync()
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

    /** The screen is on and unlocked, not blocked by us and not in parent mode: counting (docs/SPEC.md §3, Q19, §12). */
    private fun inUse(): Boolean =
        screenOn() && !getSystemService(KeyguardManager::class.java).isKeyguardLocked && !blocked && !paused

    private suspend fun onScreenOn(at: Long) {
        val stale = !lastSyncOk || SystemClock.elapsedRealtime() - lastSyncElapsed >= 2 * MINUTE
        if (blocked || paused) {
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

        // Counting stops when the device becomes blocked or parent mode starts, and starts again after both.
        val wasCounting = !blocked && !paused
        blocked = status.locked
        if (paused != (parentMode != null)) Log.i(TAG, "parent mode: ${if (parentMode != null) "on" else "off"}")
        paused = parentMode != null
        val counting = !blocked && !paused
        if (wasCounting && !counting) recorder.stop(now)
        if (!wasCounting && counting && inUse()) recorder.start(now)

        StatusHub.status.value = status
        // The block screen closes itself when StatusHub says unlocked.
        if (blocked && screenOn()) BlockActivity.show(this)
        updateLive(waiting = status.pendingMinutes != null || StatusHub.parentModeAsked.value)
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
                "left=${status.leftSec}s locked=${status.locked} parentMode=$paused online=$lastSyncOk segments=${own.size}",
        )
    }

    /**
     * The live channel is open only while the screen is on and something may come: blocked (docs/SPEC.md §8.3),
     * [waiting] for an answer to "Ask for more time" or "I'm the parent", or in parent mode (a parent may end it).
     * Otherwise FCM covers the rest (CARD-034b).
     */
    private fun updateLive(waiting: Boolean) {
        val channel = live ?: return
        val want = screenOn() && (blocked || waiting || paused)
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
    }
}
```

### 5.12 `android/app-kid/src/test/kotlin/au/screentime/kid/parentmode/ParentModeTest.kt`

```kotlin
package au.screentime.kid.parentmode

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.DeviceStateParentMode
import au.screentime.kid.ask.SendResult
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ParentModeTest {
    /** The RFC 6238 test key, "12345678901234567890", in base32. */
    private val rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    private fun ms(iso: String) = Instant.parse(iso).toEpochMilli()

    private val off = DeviceStateParentMode(active = false, endsAt = null, byName = null)

    @Test
    fun theDurationsReadAsOnTheChips() {
        assertEquals(
            listOf("2 min", "5 min", "15 min", "1 hour", "Until I end it"),
            PARENT_MODE_MINUTES.map(::durationText),
        )
    }

    @Test
    fun base32IsDecodedInAnyCaseWithPadding() {
        assertArrayEquals("12345678901234567890".toByteArray(), base32Decode(rfcSecret))
        assertArrayEquals("12345678901234567890".toByteArray(), base32Decode(rfcSecret.lowercase()))
        assertArrayEquals("f".toByteArray(), base32Decode("MY======"))
        assertArrayEquals("foobar".toByteArray(), base32Decode("MZXW6YTBOI======"))
        assertNull(base32Decode("MZXW1"))
    }

    @Test
    fun theCodesAreTheRfc6238OnesCutToSixDigits() {
        val key = base32Decode(rfcSecret)!!
        assertEquals("287082", parentCode(key, 59_000L))
        assertEquals("081804", parentCode(key, 1_111_111_109_000L))
        assertEquals("050471", parentCode(key, 1_111_111_111_000L))
        assertEquals("005924", parentCode(key, 1_234_567_890_000L))
        assertEquals("279037", parentCode(key, 2_000_000_000_000L))
        assertEquals("353130", parentCode(key, 20_000_000_000_000L))
    }

    @Test
    fun aCodeIsGoodForOneStepEitherSide() {
        val now = 1_111_111_109_000L
        assertTrue(codeOk(rfcSecret, "081804", now))
        // 30 seconds later the code shown before still works; 60 seconds later it does not.
        assertTrue(codeOk(rfcSecret, "081804", now + 30_000L))
        assertTrue(codeOk(rfcSecret, "081804", now - 30_000L))
        assertFalse(codeOk(rfcSecret, "081804", now + 60_000L))
        assertFalse(codeOk(rfcSecret, "081805", now))
        assertFalse(codeOk(rfcSecret, "81804", now))
        assertFalse(codeOk(rfcSecret, "08180a", now))
        assertFalse(codeOk("not base32!", "081804", now))
        assertFalse(codeOk("", "081804", now))
    }

    @Test
    fun theSnapshotSaysWhenAParentTurnedItOn() {
        val now = ms("2026-10-27T05:00:00Z")
        val on = DeviceStateParentMode(active = true, endsAt = "2026-10-27T05:15:00.000Z", byName = "Dad")

        assertEquals(ParentModeOn(ms("2026-10-27T05:15:00Z"), "Dad"), parentModeNow(on, now - 1_000, LocalParentMode(), now))
        // Its time ran out before the next snapshot.
        assertNull(parentModeNow(on, now - 1_000, LocalParentMode(), ms("2026-10-27T05:15:00Z")))
        val forever = DeviceStateParentMode(active = true, endsAt = null, byName = "Mum")
        assertEquals(ParentModeOn(null, "Mum"), parentModeNow(forever, now, LocalParentMode(), now + 86_400_000L))
        assertNull(parentModeNow(off, now, LocalParentMode(), now))
    }

    @Test
    fun aCodeSessionCountsUntilTheSnapshotHasIt() {
        val start = ms("2026-10-27T05:00:00Z")
        val code = CodeSession("c1", 15, start)
        val local = LocalParentMode(code = code)

        // Not sent yet: on for 15 minutes, whatever the snapshot says.
        assertEquals(ParentModeOn(start + 15 * 60_000L, null), parentModeNow(off, start - 60_000L, local, start + 60_000L))
        assertNull(parentModeNow(off, start - 60_000L, local, start + 15 * 60_000L))
        // Sent at 05:01: an older snapshot still counts the code, a newer one is the truth.
        val sent = LocalParentMode(code = code.copy(reportedAtMs = start + 60_000L))
        assertEquals(ParentModeOn(start + 15 * 60_000L, null), parentModeNow(off, start, sent, start + 120_000L))
        assertNull(parentModeNow(off, start + 90_000L, sent, start + 120_000L))
        // "Until I end it".
        val forever = LocalParentMode(code = CodeSession("c2", null, start))
        assertEquals(ParentModeOn(null, null), parentModeNow(off, start, forever, start + 86_400_000L))
    }

    @Test
    fun endNowBeatsOlderSnapshotsAndCodeSessions() {
        val now = ms("2026-10-27T05:00:00Z")
        val on = DeviceStateParentMode(active = true, endsAt = null, byName = "Dad")
        val ended = LocalParentMode(endedAtMs = now, endReported = false)

        assertNull(parentModeNow(on, now - 1_000, ended, now + 1_000))
        // A snapshot made after the end is the truth again: a parent turned it on later.
        assertEquals(ParentModeOn(null, "Dad"), parentModeNow(on, now + 5_000, ended, now + 6_000))
        // A code session that started before the end is over; one that started after it counts.
        val before = ended.copy(code = CodeSession("c1", null, now - 60_000L))
        assertNull(parentModeNow(off, now - 120_000L, before, now + 1_000))
        val after = ended.copy(code = CodeSession("c2", 5, now + 1_000))
        assertEquals(ParentModeOn(now + 1_000 + 5 * 60_000L, null), parentModeNow(off, now - 120_000L, after, now + 2_000))
    }

    private val requests = mutableListOf<HttpRequestData>()

    private fun api(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = ParentModeApi(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
    )

    private val session = """{"id":"c1","kidId":"k1","kidName":"Alex","deviceId":"d1","deviceName":"Pixel 7",""" +
        """"method":"code","status":"active","requestedAt":"2026-10-27T05:00:00Z","startedAt":"2026-10-27T05:00:00Z",""" +
        """"endsAt":null,"endedAt":null,"durationMin":null,"approvedByName":null,"endedByName":null}"""

    private fun MockRequestHandleScope.json(text: String, status: HttpStatusCode = HttpStatusCode.Created) =
        respond(text, status, headersOf(HttpHeaders.ContentType, "application/json"))

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    @Test
    fun askingTheParentsSendsTheIdAndAlreadyOnIsFine() = runBlocking {
        assertEquals(SendResult.SENT, api { json(session) }.request("r1"))
        assertEquals("/v1/device/parent-mode-requests", requests[0].url.encodedPath)
        assertEquals("""{"id":"r1"}""", requests[0].bodyText())

        val conflict = """{"error":{"code":"conflict","message":"Parent mode is already on."}}"""
        assertEquals(SendResult.SENT, api { json(conflict, HttpStatusCode.Conflict) }.request("r2"))
        assertEquals(SendResult.FAILED, api { json("{}", HttpStatusCode.BadGateway) }.request("r3"))
        assertEquals(SendResult.OFFLINE, api { throw IOException("no network") }.request("r4"))
    }

    @Test
    fun flushSendsTheCodeSessionThenTheEndAndKeepsWhatDidNotGo() = runBlocking {
        val start = ms("2026-10-27T05:00:00Z")
        val local = LocalParentMode(code = CodeSession("c1", null, start), endedAtMs = start + 60_000L, endReported = false)

        val done = api { request ->
            if (request.url.encodedPath.endsWith("/end")) respond("", HttpStatusCode.NoContent) else json(session)
        }.flush(local, start + 120_000L)

        assertEquals(LocalParentMode(CodeSession("c1", null, start, start + 120_000L), start + 60_000L, true), done)
        assertFalse(done.pending)
        assertEquals("/v1/device/parent-mode", requests[0].url.encodedPath)
        assertEquals("""{"id":"c1","durationMin":null,"startedAt":"2026-10-27T05:00:00Z"}""", requests[0].bodyText())
        assertEquals("/v1/device/parent-mode/end", requests[1].url.encodedPath)

        // Offline: nothing changes, and the end waits for the code session.
        requests.clear()
        assertEquals(local, api { throw IOException("no network") }.flush(local, start + 120_000L))
        assertEquals(1, requests.size)
        assertTrue(local.pending)
    }
}
```

### 5.13 `android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt`

Replace the whole file. Compared with `main`: one new test at the end, `parentModeNewsIsReadFromParentMode`.

```kotlin
package au.screentime.kid.live

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class LiveTest {
    @Test
    fun theAddressSwapsTheSchemeAndAddsThePath() {
        assertEquals("ws://10.0.2.2:8080/v1/device/ws", liveUrl("http://10.0.2.2:8080"))
        assertEquals("wss://screentime.gallagherhome.au/v1/device/ws", liveUrl("https://screentime.gallagherhome.au/"))
        assertThrows<IllegalArgumentException> { liveUrl("ftp://example.com") }
    }

    @Test
    fun theBackoffDoublesUpToAMinute() {
        val waits = (0..8).map { backoffMs(it, 1.0) }

        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L, 60_000L), waits)
    }

    @Test
    fun theJitterIsTwentyPercentEitherWay() {
        assertEquals(800L, backoffMs(0, 0.8))
        assertEquals(1_200L, backoffMs(0, 1.2))
        assertEquals(48_000L, backoffMs(10, 0.8))
        assertEquals(72_000L, backoffMs(10, 1.2))
        assertEquals(60_000L, backoffMs(Int.MAX_VALUE, 1.0))
    }

    @Test
    fun everyEnvelopeButAPongAsksForASync() {
        assertTrue(asksForSync("""{"v":1,"type":"grant_added","at":"2026-10-27T09:00:00Z","data":{}}"""))
        assertTrue(asksForSync("""{"v":1,"type":"state_changed","at":"2026-10-27T09:00:00Z","data":{}}"""))
        assertTrue(asksForSync("""{"v":1,"type":"something_new","at":"2026-10-27T09:00:00Z","data":{}}"""))
        assertFalse(asksForSync("""{"v":1,"type":"pong","at":"2026-10-27T09:00:00Z","data":{}}"""))
    }

    @Test
    fun aFrameThatIsNotAnEnvelopeMeansNothing() {
        assertFalse(asksForSync("hello"))
        assertFalse(asksForSync(""))
        assertFalse(asksForSync("[1, 2]"))
        assertFalse(asksForSync("""{"v":1}"""))
        assertFalse(asksForSync("""{"type":{"a":1}}"""))
        assertFalse(asksForSync("""{"type":null}"""))
    }

    @Test
    fun aParentsAnswerIsReadFromRequestResolved() {
        val yes = """{"v":1,"type":"request_resolved","at":"2026-10-27T09:00:00Z","data":""" +
            """{"requestId":"r1","approved":true,"minutes":30,"byName":"Dad","grant":{"id":"g1"}}}"""
        val no = """{"v":1,"type":"request_resolved","at":"2026-10-27T09:00:00Z","data":""" +
            """{"requestId":"r1","approved":false,"minutes":0,"byName":"Mum","grant":null}}"""

        assertEquals(Answer(approved = true, minutes = 30, byName = "Dad"), answerOf(yes))
        assertEquals(Answer(approved = false, minutes = 0, byName = "Mum"), answerOf(no))
        assertNull(answerOf("""{"v":1,"type":"grant_added","at":"2026-10-27T09:00:00Z","data":{"byName":"Dad"}}"""))
        assertNull(answerOf("""{"v":1,"type":"request_resolved","at":"2026-10-27T09:00:00Z","data":{"approved":true}}"""))
        assertNull(answerOf("""{"type":"request_resolved","data":{"approved":"yes","minutes":15,"byName":"Dad"}}"""))
        assertNull(answerOf("not json"))
    }

    @Test
    fun parentModeNewsIsReadFromParentMode() {
        val yes = """{"v":1,"type":"parent_mode","at":"2026-10-27T09:00:00Z","data":""" +
            """{"active":true,"endsAt":"2026-10-27T09:15:00.000Z","byName":"Dad","requestId":"r1"}}"""
        val no = """{"v":1,"type":"parent_mode","at":"2026-10-27T09:00:00Z","data":""" +
            """{"active":false,"endsAt":null,"byName":"Mum","requestId":"r1"}}"""
        val ended = """{"v":1,"type":"parent_mode","at":"2026-10-27T09:00:00Z","data":""" +
            """{"active":false,"endsAt":null,"byName":"Dad","requestId":null}}"""

        assertEquals(ParentModeNews(active = true, requestId = "r1", byName = "Dad"), parentModeNewsOf(yes))
        assertEquals(ParentModeNews(active = false, requestId = "r1", byName = "Mum"), parentModeNewsOf(no))
        assertEquals(ParentModeNews(active = false, requestId = null, byName = "Dad"), parentModeNewsOf(ended))
        assertNull(parentModeNewsOf("""{"v":1,"type":"request_resolved","data":{"active":true}}"""))
        assertNull(parentModeNewsOf("""{"v":1,"type":"parent_mode","data":{"active":"yes"}}"""))
        assertNull(parentModeNewsOf("""{"v":1,"type":"parent_mode","data":null}"""))
        assertNull(parentModeNewsOf("not json"))
    }
}
```

### 5.14 `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt`

Replace the whole file. Compared with `main`: one import, `statusAt` takes a `parentMode`, and two new tests at the end; the others are unchanged.

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
import au.screentime.kid.parentmode.ParentModeOn
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

    private fun statusAt(
        time: String,
        state: DeviceState = state(),
        elapsedMs: Long = 0,
        parentMode: ParentModeOn? = null,
    ): KidStatus {
        val now = at(time)
        val result = evaluate(todayInput(state, emptyList(), now))
        return kidStatus(state, result, now, online = true, elapsedMs = elapsedMs, parentMode = parentMode)
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

    @Test
    fun parentModeUnlocksAndSaysWhenItEnds() {
        val s = statusAt("21:00", parentMode = ParentModeOn(at("21:15"), "Dad"))

        assertFalse(s.locked)
        assertNull(s.lockReason)
        assertNull(s.lockAtMs)
        assertTrue(s.parentMode)
        assertEquals("Parent mode · ends 9:15 pm", s.title())
        assertEquals("Time isn't counting", s.subline())
        assertEquals(Level.PLENTY, s.level())
        assertEquals(at("21:15"), s.parentModeEndsAtMs)
        assertEquals("ABC", s.parentCodeSecret)

        val forever = statusAt("10:00", parentMode = ParentModeOn(null, null))
        assertEquals("Parent mode · until you end it", forever.title())
        assertNull(forever.lockAtMs)
        assertEquals(3600L, forever.leftSec)
        assertFalse(statusAt("10:00").parentMode)
    }

    @Test
    fun theEndOfParentModeIsANextCheck() {
        val s = statusAt("21:00", parentMode = ParentModeOn(at("21:00:20"), "Dad"))

        assertEquals(at("21:00:20"), nextCheckAtMs(s, at("21:00")))
        assertEquals(at("21:01:20"), nextCheckAtMs(s, at("21:00:20")))
    }
}
```

## 6. Detailed spec

### 6.1 What the kid and the parent see

| Where | What |
|---|---|
| Main screen, parent mode off | Under **Ask for more time** and **Message Dad**, 8 dp lower: **I'm the parent**, a text button (no box) in the grey of the secondary text, centred, full width up to 420 dp |
| Block screen | **I'm the parent** at the very bottom, under **Emergency 000** on a phone with a SIM, in the night text colour at 70% |
| Tap **I'm the parent** | A bottom sheet, "Hand to a parent", with a small spinner and "We've asked Dad to approve." (all parents' names: "Mum and Dad"), and a big tonal button **Enter parent code instead**. Offline: "Can't reach Dad right now. A parent can use the parent code." Any other failure: "That didn't work. A parent can use the parent code." |
| A parent says no | The spinner goes and the line says "Dad said no." |
| A parent says yes | The sheet closes, the block screen closes, the main screen shows the banner |
| **Enter parent code instead** | "Parent code", "Type the 6 numbers from the Screen Time app on a parent's phone.", and one big field (bold, centred, wide letter spacing) with the number keypad. At the sixth digit it is checked. Wrong: the field empties and a red line says "That's not the code. Try the one on the phone now." Right: "How long?" |
| "How long?" | Five big grey pills: **2 min**, **5 min**, **15 min**, **1 hour**, **Until I end it**. A tap starts parent mode and closes the sheet |
| Main screen, parent mode on | The ring as before, the line under it says "Time isn't counting", and in place of the kid's buttons a teal-tinted rounded box with "Parent mode · ends 4:15 pm" (or "Parent mode · until you end it") in bold and a full-width **End now** button |
| Notification, parent mode on | Title "Parent mode · ends 4:15 pm", text "Time isn't counting", an **End now** action, no countdown |

### 6.2 What happens

| Event | What the app does (log tag `KidService`) |
|---|---|
| The sheet opens | `POST /v1/device/parent-mode-requests` with a new id; asks the service to sync; the live channel stays open while the sheet is open |
| A `parent_mode` message on the live channel | `parent mode: news active=true` (or `false`), then a sync |
| Parent mode starts (any way) | `parent mode: on`; the block screen closes; counting stops; the report line says `parentMode=true` |
| Right code and a duration | `parent mode: started with the code for 5 min` (or `until ended`); the session is kept on the phone and sent with `POST /v1/device/parent-mode` before the sync |
| **End now** (notification or main screen) | `parent mode: ended on this device`; sent with `POST /v1/device/parent-mode/end` before the sync |
| Parent mode ends (any way) | `parent mode: off`; blocked again at once if out of time or bedtime, otherwise counting starts again |
| Offline | The code session and **End now** wait on the phone and are sent at the next sync that gets through |

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-037-parent-mode
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-037-parent-mode.md` and `server/scripts/dev-parent-mode.ts` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create or replace 5.1 to 5.11. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-037: parent mode on the kid phone`.
3. Create or replace 5.12 to 5.14. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-037: parent mode tests`.
4. Run the acceptance checks in section 8, including the emulator run (8.2), in this session.
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token, device token or parent-code secret in the PR or the handback. The throwaway `local-dev-only-…` values below are fine, and so are the 6-digit codes.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints fifteen lines:
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
  au.screentime.kid.status.KidStatusTest tests="12" failures="0" errors="0"
  au.screentime.kid.status.WarningTrackerTest tests="5" failures="0" errors="0"
  au.screentime.kid.sync.SyncerTest tests="4" failures="0" errors="0"
  au.screentime.kid.sync.TrustedClockTest tests="4" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="10" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```

### 8.2 On the emulator

Run every step below **in this session**, and paste the **real terminal output** of each step into the handback. A summary is not accepted, and neither is "run earlier in this session" for output you no longer have. If your context was summarised partway through, run the steps again from step 1.

**The emulator.** Use the same emulator as in CARD-036, with nobody signed in. Remove the app from CARD-036 first (each command prints `Success...`, or an error if there was nothing to remove; both are fine), and keep the screen from turning off by itself for 30 minutes:

```powershell
& $adb shell am task lock stop
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
```

`& $adb devices` must list exactly one `emulator-5554   device`. If it says `offline` for more than a minute, use the cold boot steps James gave you for CARD-030b; do not wait longer than 5 minutes. If `uninstall` fails with `DELETE_FAILED_INTERNAL_ERROR` and `remove-active-admin` with a `SecurityException` (the app is still Device Owner), wipe the emulator (Device Manager › **Wipe Data**), cold boot it, and run the commands above again. That is not a deviation, but say that you did it under "Outside the repo".

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). `dev-parent-mode.ts` signs a parent token with `JWT_SECRET`, so `$env:JWT_SECRET` must be the same value as in `deploy\.env`:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
```

`seed-dev.ts` prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

Do the run between 6 am and 10 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Tap-Text` taps the words on the screen (in any case); with a package, only words of that app (`com.android.systemui` is the notification shade). `Parent` runs `dev-parent-mode.ts` for Alex: `Parent no`, `Parent yes 2`, `Parent yes forever`, `Parent code`, `Parent end`. `Sessions` prints the parent mode rows in the database. `PmLog` prints the app's `parent mode:` log lines and its last report line **since the last `PmLog`**, then clears the log. `Wait-Unblocked` and `Wait-Blocked` wait until the block screen goes or comes back, and say how long it took. `Top` prints the screen in front.

```powershell
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
function Type-Text([string]$text) {
  & $adb shell input text $text
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
function Bedtime([int]$minutes, [int]$allowance = 720) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-bedtime.ts Alex $minutes $allowance
}
function Parent([string]$action, [string]$duration = "") {
  if ($duration) {
    pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Alex $action $duration
  } else {
    pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Alex $action
  }
}
function Sessions {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select method, duration_min, started_at is not null as started, ended_at is not null as ended from parent_mode_sessions order by requested_at"
}
function PmLog {
  $lines = & $adb logcat -d -s KidService:I
  $lines | Select-String 'parent mode:' | ForEach-Object { $_.Line.Trim() }
  $lines | Select-String 'pool=' | Select-Object -Last 1 | ForEach-Object { $_.Line.Trim() }
  & $adb logcat -c
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
   ```
   `1-home` shows the main screen as in CARD-036 ("Hi Alex", the ring, **Ask for more time**, **Message Dad**) and, under them, the grey text button **I'm the parent**.
2. Out of time:
   ```powershell
   Bedtime 60 0
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 10
   Shot "2-block"
   Top
   PmLog
   ```
   `2-block` shows the block screen ("Out of Phone time", **Ask for more time**, **Message Dad**, **Emergency 000**) with **I'm the parent** at the bottom, in light grey. `Top` shows `au.screentime.kid/.block.BlockActivity`. `PmLog` prints no `parent mode:` line, and a last line with `locked=true parentMode=false`.
3. Ask, and Dad says no:
   ```powershell
   Tap-Text "I'm the parent" 4
   Shot "3-asked"
   Parent no
   Start-Sleep -Seconds 4
   Shot "4-said-no"
   Top
   PmLog
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   ```
   `3-asked` shows the sheet "Hand to a parent" with a spinner, "We've asked Dad to approve." and **Enter parent code instead**. `Parent no` prints `Dad said no to Alex's "I'm the parent".` `4-said-no` shows the same sheet with "Dad said no." and no spinner. `Top` shows `BlockActivity`. `PmLog` has `parent mode: news active=false`. Back closes the sheet.
4. Ask again, and Dad says yes for 2 minutes:
   ```powershell
   Tap-Text "I'm the parent" 4
   Parent yes 2
   Wait-Unblocked
   Start-Sleep -Seconds 3
   Shot "5-parent-mode"
   & $adb shell cmd statusbar expand-notifications
   Start-Sleep -Seconds 2
   Shot "6-notification"
   & $adb shell cmd statusbar collapse
   Start-Sleep -Seconds 1
   PmLog
   ```
   `Parent yes 2` prints `Dad turned parent mode on for Alex for 2 min.` `Wait-Unblocked` prints `Unblocked after N s` with N **10 or less**. `5-parent-mode` shows the main screen: the line under the ring says "Time isn't counting", and in place of the buttons a light teal box with "Parent mode · ends <a time 2 minutes from now>" and **End now**; no **I'm the parent**. `6-notification` shows the app's notification "Parent mode · ends …", "Time isn't counting", with an **End now** action (if the notification is folded, the action may be hidden; that is fine here). `PmLog` has `parent mode: news active=true` and `parent mode: on`, and its last line has `locked=false parentMode=true` and `used=<U>s`: write down `<U>`.
5. Wait; parent mode ends by itself and the block screen comes back:
   ```powershell
   Wait-Blocked 180
   Shot "7-blocked-again"
   PmLog
   ```
   `Wait-Blocked` prints `Blocked after N s` with N between about 60 and 130 (the 2 minutes started at step 4). `7-blocked-again` shows the block screen as in `2-block`. `PmLog` has `parent mode: off`, and its last line has `locked=true parentMode=false` and the **same** `used=<U>s` as in step 4: nothing was counted in parent mode.
6. The parent code: a wrong one, then the right one, then 5 minutes:
   ```powershell
   Tap-Text "I'm the parent" 4
   Tap-Text "Enter parent code instead" 3
   Type-Text "111111"
   Shot "8-wrong-code"
   Parent code
   ```
   `8-wrong-code` shows "Parent code", the empty field, the number keypad and the red line "That's not the code. Try the one on the phone now." (If by chance `111111` was the right code, the screen shows "How long?": say so and go on.) `Parent code` prints `The parent code for Alex's family is <six digits> (changes in N s).` Type those six digits at once:
   ```powershell
   Type-Text "<the six digits>"
   Shot "9-how-long"
   Tap-Text "5 min"
   Wait-Unblocked
   PmLog
   Sessions
   ```
   `9-how-long` shows "How long?" and the five pills **2 min**, **5 min**, **15 min**, **1 hour**, **Until I end it**. `Wait-Unblocked` prints `Unblocked after N s` with N **10 or less**. `PmLog` has `parent mode: started with the code for 5 min` and `parent mode: on`. `Sessions` has a `code | 5 | t | f` row.
7. **End now** in the notification:
   ```powershell
   & $adb shell cmd statusbar expand-notifications
   Start-Sleep -Seconds 2
   Tap-Text "End now" 2 "com.android.systemui"
   & $adb shell cmd statusbar collapse
   Wait-Blocked
   PmLog
   Sessions
   ```
   `Wait-Blocked` prints `Blocked after N s` with N **10 or less**. `PmLog` has `parent mode: ended on this device` and `parent mode: off`. `Sessions` now has `code | 5 | t | t`.
8. Until I end it; Dad ends it from his phone:
   ```powershell
   Tap-Text "I'm the parent" 4
   Parent yes forever
   Wait-Unblocked
   Start-Sleep -Seconds 3
   Shot "10-until-ended"
   Parent end
   Wait-Blocked
   PmLog
   ```
   `Parent yes forever` prints `Dad turned parent mode on for Alex until a parent ends it.` `Wait-Unblocked` prints N **10 or less**. `10-until-ended` shows the main screen with "Parent mode · until you end it" and **End now**. `Parent end` prints `Dad ended parent mode on Alex's device.` `Wait-Blocked` prints `Blocked after N s` with N **10 or less**. `PmLog` has `parent mode: news active=true`, `parent mode: on`, `parent mode: news active=false` and `parent mode: off`.
9. **End now** on the main screen:
   ```powershell
   Tap-Text "I'm the parent" 4
   Parent yes 15
   Wait-Unblocked
   Start-Sleep -Seconds 3
   Tap-Text "End now"
   Wait-Blocked
   Shot "11-ended-on-screen"
   PmLog
   Sessions
   ```
   `Wait-Unblocked` and `Wait-Blocked` print N **10 or less**. `11-ended-on-screen` shows the block screen. `PmLog` has `parent mode: on`, `parent mode: ended on this device` and `parent mode: off`. `Sessions` has 6 rows, in this order:
   ```
    method | duration_min | started | ended
   --------+--------------+---------+-------
    push   |              | f       | t
    push   |            2 | t       | f
    push   |              | f       | t
    code   |            5 | t       | t
    push   |              | t       | t
    push   |           15 | t       | t
   ```
   (Row 1 is Dad's no. Row 2 ran out by itself, so it was never "ended". Row 3 is the ask from step 6 that nobody answered; the ask in step 8 closed it. Row 5 is "Until I end it".)
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
    `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success`.

- [ ] Steps 1 to 10 gave the expected results, run in this session. Paste the real output of every command in steps 1 to 9 into the handback (the `Bedtime`, `Parent`, `Sessions`, `Top`, `PmLog`, `Wait-Unblocked` and `Wait-Blocked` lines).
- [ ] The eleven screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c37\`: `1-home.png`, `2-block.png`, `3-asked.png`, `4-said-no.png`, `5-parent-mode.png`, `6-notification.png`, `7-blocked-again.png`, `8-wrong-code.png`, `9-how-long.png`, `10-until-ended.png`, `11-ended-on-screen.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 14 files (in any order):
  ```
  android/app-kid/src/main/kotlin/au/screentime/kid/ask/Sheets.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/live/Live.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentMode.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentModeSheet.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentModeStore.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/parentmode/ParentModeTest.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/parentmode/ParentModeTest.kt` | The duration names; base32 in any case with padding, and a bad character refused; the RFC 6238 SHA-1 test vectors cut to 6 digits; a code is good one step either side and no further, and a short, non-digit or bad-secret code never is; parent mode from the snapshot until its end; a code session counts until a snapshot made after the server got it; **End now** beats older snapshots and older code sessions but not newer ones; asking sends the id, and a 409 counts as sent; the code session is sent before the end, and nothing is marked sent when offline. |
| `android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt` | As in CARD-036, plus: a `parent_mode` message is read with its `active`, `requestId` and `byName`, and anything else is not. |
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt` | As in CARD-036, plus: in parent mode at bedtime the phone is not locked and does not lock, and the title and the line under it are the parent mode ones; the end of parent mode is a next check. |

The sheet, the banner, the notification and the service are checked by the emulator run in 8.2, not by unit tests.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-037: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-037-parent-mode`
5. Open a PR into `main` titled `CARD-037: Parent mode on the kid phone`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-037-parent-mode --title "CARD-037: Parent mode on the kid phone" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-037-parent-mode.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: fifteen suites, ParentModeTest 9, KidStatusTest 12, LiveTest 7, all `failures="0"`
   - [x] emulator run steps 1 to 10 — results as expected
   - [x] eleven screenshots in C:\Users\james\OpenCode\Testing\temp\c37\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 14 files

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

- **`Parent yes` or `Parent no` says `Alex has no "I'm the parent" waiting for an answer`**: the sheet's ask did not reach the server. Take a screenshot `ask-missing`, paste `& $adb logcat -d -s KidService:I | Select-Object -Last 10` and `Sessions`, and stop there.
- **`Parent` says `the API said 401`**: `$env:JWT_SECRET` is not the same as `JWT_SECRET` in `deploy\.env`. Set it again as in "The server" and repeat.
- **Step 4 or 8: `Wait-Unblocked` prints `Still blocked after 45 s`**: paste `PmLog` and `Sessions`, and stop there.
- **Step 5: `Wait-Blocked 180` prints `Still not blocked after 180 s`**: paste `PmLog` and `Top`, and stop there.
- **Step 5: the `used=` number grew**: paste both `PmLog` outputs (step 4 and step 5) and stop there. Do not try to fix it.
- **Step 6: the right code says "That's not the code"**: the emulator's clock may be wrong. Paste `& $adb shell date` and `Get-Date -AsUTC` (both), run `Parent code` again and type the new code once more. If it fails again, stop there.
- **Step 6: `Type-Text` types nothing** (the field is still empty in the screenshot): tap the field once with `& $adb shell input tap 540 1500`, then type again, and say so under "Deviations".
- **Step 7: `Tap-Text` says `No 'End now' on screen`**: the notification is folded. Run `& $adb shell input swipe 540 600 540 1400 300` (a swipe down on it unfolds it) and the same `Tap-Text "End now" 2 "com.android.systemui"` again. If it still fails, collapse the shade, tap **End now** on the main screen instead, carry on, and say so under "Deviations".
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
Claude, here is Bob's handback for CARD-037. Please review and merge if it is good.

CARD: CARD-037 Parent mode on the kid phone
PR: <full PR URL>
Branch: bob/card-037-parent-mode
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
