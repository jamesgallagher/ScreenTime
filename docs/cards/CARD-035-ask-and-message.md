# CARD-035: Ask for more time and Message

| Field | Value |
|---|---|
| Card | CARD-035 |
| Title | Ask for more time and Message |
| Size | M |
| Depends on | CARD-034 (live channel while blocked), merged to `main` |
| Spec sections | docs/SPEC.md §9.3 (`/v1/device/time-requests`, `/v1/device/messages`), §10 (`request_resolved`), §12.1 ("As built (CARD-035)"), §16.2 ("Main screen", "Block screen", "Ask for more time sheet", "Message sheet") |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-035-ask-and-message` |
| PR title | `CARD-035: Ask for more time and Message` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

Until now the kid can only look at the time left and the block screen. This card gives the kid the first two buttons, on the main screen and on the block screen:

- **Ask for more time** opens a sheet: "How much more?", **15 min** / **30 min** / **1 hour**, an optional reason, **Send**. While no parent has answered, the screen shows "Waiting for Dad…" with a pulsing dot, and the button is greyed out.
- **Message Dad** (or "Message Mum and Dad": the names come from the family) opens a sheet with the family's ready-made messages and a field for the kid's own words, **Send**, then "Sent ✓".
- **The answer**: when a parent says yes or no, the screen shows "Dad said yes! +30 min 🎉" on green, or "Dad said not this time", for 4 seconds, and the phone shows it as a heads-up notification too. A yes on the block screen unlocks the phone (the grant comes with the answer).

The new code: `ask/Sender.kt` (sends the two things and turns errors into words; unit tests), `ask/Sheets.kt` (the buttons, the cards and the two sheets, shared by both screens), the answer in `live/Live.kt`, the family's names, presets and waiting request in `status/KidStatus.kt`, and small changes to the service, the notifier and both screens.

Claude added `server/scripts/dev-answer.ts`: it answers the kid's waiting request through the API, as Dad would in the parent app, so the run in 8.2 can try yes and no.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `SenderTest` (5 tests), `LiveTest` (6) and `KidStatusTest` (9); on the emulator the kid asks from the main screen and from the block screen, sees "Waiting for Dad…", sees a yes and a no, a yes unlocks the block screen within 10 seconds, a preset message and an own message reach the server (the own one after a failed offline send), and the database rows prove it; the ten screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No notification actions ("Ask for more", "Message" on the status notification): a later card. No contact row, Emergency, SOS or "I'm the parent" button (CARD-036 to CARD-038). No FCM (CARD-034b). No queue for sends made offline: the kid taps **Send** again.
- No change to `core-model`, `core-time`, `core-ui`, `app-parent`, `packages/`, `web/`, `server/` or `docs/`, and no change to `build.gradle.kts`, `libs.versions.toml` or `AndroidManifest.xml` files. No new dependency of any kind.
- Never run the app on a real phone or tablet in this card, and never install a **release** build anywhere.
- No change to the Gradle wrapper files.
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, Room 2.8.5, KSP 2.3.12, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36. No new library: the sheets are Material 3's `ModalBottomSheet`, already in the Compose BOM.

Claude built this exact code in GitHub Actions before writing the card, so it compiles and the tests pass. Claude also ran `Sender` and the live channel on a PC against the real server: an ask with a reason, a second ask answered 409, a yes, a no, a yes with 45 minutes instead of 15, a preset message, an own message, and the same message sent twice with one id (stored once).

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c35"
New-Item -ItemType Directory -Force $t | Out-Null
```

**If you are ever stuck inside the block screen on the emulator**, this always gets you out: `& $adb shell am task lock stop`.

## 5. Files

Create or replace exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â`, `â€` or `ðŸ` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7), `…` (U+2026), `±` (U+00B1), `✓` (U+2713), `·` (U+00B7) and the party popper emoji `🎉` (U+1F389); copy them exactly.

| File | Action |
|---|---|
| `android/app-kid/src/main/kotlin/au/screentime/kid/ask/Sender.kt` | create (5.1) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/ask/Sheets.kt` | create (5.2) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/live/Live.kt` | replace (5.3) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/live/LiveChannel.kt` | replace (5.4) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt` | replace (5.5) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt` | replace (5.6) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt` | replace (5.7) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt` | replace (5.8) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt` | replace (5.9) |
| `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt` | replace (5.10) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/ask/SenderTest.kt` | create (5.11) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt` | replace (5.12) |
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt` | replace (5.13) |

That is 13 files.

### 5.1 `android/app-kid/src/main/kotlin/au/screentime/kid/ask/Sender.kt`

```kotlin
package au.screentime.kid.ask

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.KidMessageCreate
import au.screentime.core.model.api.Opt
import au.screentime.core.model.api.TimeRequestCreate
import au.screentime.kid.live.Answer
import au.screentime.kid.status.minutesText
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/** The longest reason or message a kid can write (docs/SPEC.md §9.3). */
const val MAX_TEXT = 160

/** What the kid can ask for (docs/SPEC.md §16.2, "Ask for more time sheet"). */
val ASK_MINUTES = listOf(15, 30, 60)

/** How a send went. The kid sees words, never a code (docs/SPEC.md §16.1). */
enum class SendResult { SENT, ALREADY_ASKED, OFFLINE, FAILED }

/**
 * Sends the kid's "Ask for more time" and messages to the server (docs/SPEC.md §9.3). The caller makes [id] once
 * for what the kid is sending and uses it again for a retry, so something that reached the server just before the
 * connection broke is not stored twice.
 */
class Sender(private val api: ApiClient) {
    suspend fun ask(id: String, minutes: Int, reason: String): SendResult = send {
        val text = reason.trim().take(MAX_TEXT)
        api.postDeviceTimeRequests(TimeRequestCreate(id, minutes, if (text.isEmpty()) Opt.Absent else Opt.Value(text)))
    }

    suspend fun message(id: String, body: String, presetId: String?): SendResult = send {
        api.postDeviceMessages(
            KidMessageCreate(id, body.trim().take(MAX_TEXT), if (presetId == null) Opt.Absent else Opt.Value(presetId)),
        )
    }

    private suspend fun send(call: suspend () -> Unit): SendResult = try {
        call()
        SendResult.SENT
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiException) {
        // 409: this pool already has a request waiting for an answer.
        if (e.status == 409) SendResult.ALREADY_ASKED else SendResult.FAILED
    } catch (e: IOException) {
        SendResult.OFFLINE
    } catch (e: Exception) {
        SendResult.FAILED
    }
}

/** The line under the Send button after a send that did not work; null when there is nothing to say. */
fun sendErrorText(result: SendResult, parents: String): String? = when (result) {
    SendResult.SENT, SendResult.ALREADY_ASKED -> null
    SendResult.OFFLINE -> "Can't reach $parents right now. Check the internet and try again."
    SendResult.FAILED -> "That didn't work. Try again in a minute."
}

/** "Dad said yes! +15 min 🎉" or "Dad said not this time" (docs/SPEC.md §16.2). */
fun answerText(answer: Answer): String = if (answer.approved) {
    "${answer.byName} said yes! +${minutesText(answer.minutes)} 🎉"
} else {
    "${answer.byName} said not this time"
}
```

### 5.2 `android/app-kid/src/main/kotlin/au/screentime/kid/ask/Sheets.kt`

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
private fun SheetTitle(text: String) {
    Text(text, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
}

/** A big rounded choice: teal when picked, grey otherwise. */
@Composable
private fun Choice(text: String, selected: Boolean, modifier: Modifier, align: TextAlign, onClick: () -> Unit) {
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
private fun ErrorLine(text: String) {
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
private suspend fun sendWith(context: Context, block: suspend (Sender) -> SendResult): SendResult {
    val enrolment = EnrolmentStore(context).load() ?: return SendResult.FAILED
    val engine = OkHttp.create()
    val api = ApiClient(enrolment.serverUrl, engine, token = { enrolment.deviceToken })
    return try {
        block(Sender(api))
    } finally {
        api.close()
        engine.close()
    }
}
```

### 5.3 `android/app-kid/src/main/kotlin/au/screentime/kid/live/Live.kt`

Replace the whole file. Compared with `main`: two more imports, and `Answer` and `answerOf` at the end.

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
```

### 5.4 `android/app-kid/src/main/kotlin/au/screentime/kid/live/LiveChannel.kt`

Replace the whole file. Compared with `main`: `onNews` now gets the message (null on a connect), and the class comment says so.

```kotlin
package au.screentime.kid.live

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlin.coroutines.cancellation.CancellationException
import kotlin.random.Random
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The WebSocket to the server (docs/SPEC.md §8.3, §10). [run] connects with the device token, sends [PING] every
 * 30 seconds, and calls [onNews] when it connects (with null: a message may have been missed while it was down) and
 * with every message that is not a pong. A socket that has said nothing for 75 seconds is dead. After a failure or a
 * close it waits 1, 2, 4 … 60 seconds (±20%) and connects again, until the coroutine is cancelled. [onNews] must
 * return at once: the service only takes note and syncs in its own loop.
 */
class LiveChannel(
    engine: HttpClientEngine,
    private val url: String,
    private val token: () -> String,
    private val onNews: (frame: String?) -> Unit,
    private val log: (String) -> Unit = {},
    private val random: () -> Double = Random::nextDouble,
) : AutoCloseable {
    private val http = HttpClient(engine) { install(WebSockets) }

    /** True while a socket is open. */
    @Volatile
    var connected = false
        private set

    suspend fun run() {
        var attempt = 0
        while (true) {
            try {
                http.webSocket(url, request = { header(HttpHeaders.Authorization, "Bearer ${token()}") }) {
                    connected = true
                    attempt = 0
                    log("connected")
                    onNews(null)
                    val pinger = launch {
                        while (true) {
                            send(Frame.Text(PING))
                            delay(PING_MS)
                        }
                    }
                    try {
                        while (true) {
                            val next = withTimeoutOrNull(DEAD_MS) { incoming.receiveCatching() }
                            if (next == null) {
                                log("nothing for 75 s, reconnecting")
                                break
                            }
                            val frame = next.getOrNull()
                            if (frame == null) {
                                log("closed: ${withTimeoutOrNull(1_000) { closeReason.await() }}")
                                break
                            }
                            if (frame is Frame.Text) {
                                val text = frame.readText()
                                if (asksForSync(text)) onNews(text)
                            }
                        }
                    } finally {
                        pinger.cancel()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log("failed: $e")
            } finally {
                connected = false
            }
            val wait = backoffMs(attempt, 0.8 + 0.4 * random())
            attempt++
            delay(wait)
        }
    }

    override fun close() = http.close()

    private companion object {
        const val PING_MS = 30_000L
        const val DEAD_MS = 75_000L
    }
}
```

### 5.5 `android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt`

Replace the whole file. Compared with `main`: `Preset`, three new fields at the end of `KidStatus` (with defaults, so `WarningTrackerTest` is unchanged), `parentsOr` and `parentsAnd`, the three fields filled in `kidStatus`, and `parentsText` and `minutesText`.

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

### 5.6 `android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt`

```kotlin
package au.screentime.kid.status

import au.screentime.kid.live.Answer
import kotlinx.coroutines.flow.MutableStateFlow

/** The latest status, from the service to the screens of the same process. Null until the first sync. */
object StatusHub {
    val status = MutableStateFlow<KidStatus?>(null)

    /** A parent's answer that just came in; the screen showing it sets it back to null after 4 seconds. */
    val answer = MutableStateFlow<Answer?>(null)
}
```

### 5.7 `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

Replace the whole file. Compared with `main`: the class comment, `@Volatile` on `syncWanted`, `onNews` reads an answer, `onStartCommand` handles `ACTION_SYNC`, the new `onAnswer`, `updateLive(waiting = ...)` (the live channel also stays open while the kid waits for an answer), and `ACTION_SYNC` and `syncSoon` in the companion.

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
 * block screen can be seen, or the kid waits for an answer to "Ask for more time", it also keeps the live channel open
 * (§8.3), so a parent's grant or answer shows within seconds. Everything runs one at a time on [scope], so the
 * database sees one change after another.
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
        segments = RoomSegmentStore(KidDatabase.open(this).segments())
        states = FileStateStore(this)
        recorder = Recorder(segments) { UUID.randomUUID().toString() }
        val http = OkHttp.create()
        val client = ApiClient(enrolment.serverUrl, http, token = { enrolment.deviceToken })
        engine = http
        api = client
        syncer = Syncer(client, segments, states, clock, log = { Log.w(TAG, it) })
        live = LiveChannel(
            engine = http,
            url = liveUrl(enrolment.serverUrl),
            token = { enrolment.deviceToken },
            onNews = { frame ->
                frame?.let(::answerOf)?.let(::onAnswer)
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
                // While in use, until the next warning, lock or period (at least once a minute). Blocked with the
                // screen on, the same while the live channel is open; while it is down, at least every 30 seconds,
                // to see a parent's grant soon. Otherwise a minute.
                val untilNext = (nextCheckAt - clock.nowMs()).coerceIn(SECOND, MINUTE)
                val wait = when {
                    inUse() -> untilNext
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
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A screen just sent something (docs/SPEC.md §16.2): sync soon, so the next snapshot shows it.
        if (intent?.action == ACTION_SYNC && started) {
            syncWanted = true
            wake.trySend(Unit)
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

    /** A parent answered "Ask for more time": the screens show it for 4 seconds, and a heads-up says it too. */
    private fun onAnswer(answer: Answer) {
        Log.i(TAG, "answer: approved=${answer.approved} minutes=${answer.minutes}")
        StatusHub.answer.value = answer
        notifier.showAnswer(answer)
    }

    private suspend fun sync() {
        syncLock.withLock {
            // This sync also brings whatever the live channel announced.
            syncWanted = false
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
        val status = kidStatus(cached.state, result, now, lastSyncOk, SystemClock.elapsedRealtime())

        val wasBlocked = blocked
        blocked = status.locked
        if (blocked && !wasBlocked) recorder.stop(now)
        if (!blocked && wasBlocked && inUse()) recorder.start(now)

        StatusHub.status.value = status
        // The block screen closes itself when StatusHub says unlocked.
        if (blocked && screenOn()) BlockActivity.show(this)
        updateLive(waiting = status.pendingMinutes != null)
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

    /**
     * The live channel is open only while the screen is on and the kid is waiting for something: blocked (docs/SPEC.md
     * §8.3), or [waiting] for an answer to "Ask for more time". Otherwise FCM covers the rest (CARD-034b).
     */
    private fun updateLive(waiting: Boolean) {
        val channel = live ?: return
        val want = screenOn() && (blocked || waiting)
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

        fun start(context: Context) {
            context.startForegroundService(Intent(context, KidService::class.java))
        }

        /** From a screen of the app, which is in front: sync as soon as the service can. */
        fun syncSoon(context: Context) {
            context.startService(Intent(context, KidService::class.java).setAction(ACTION_SYNC))
        }
    }
}
```

### 5.8 `android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt`

Replace the whole file. Compared with `main`: the "answers" channel, `showAnswer`, and two constants.

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
 * The kid app's notifications (docs/SPEC.md §16.2): the silent status notification of the foreground service, the
 * heads-up warnings before a lock, and a parent's answer to "Ask for more time".
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

### 5.9 `android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt`

Replace the whole file. Compared with `main`: the comment, three imports, and `AskAndMessage` under the details (portrait) or in the right column, which now scrolls (landscape and tablets).

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
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Level
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.delay

/**
 * The kid's main screen (docs/SPEC.md §16.2): "Hi Alex", the ring with the time left, bedtime, "Offline · still
 * counting" when the last sync failed, and **Ask for more time** and **Message Mum and Dad**. SOS and "I'm the
 * parent" come with their cards.
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
                    AskAndMessage(s, Look.DAY)
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
                AskAndMessage(s, Look.DAY)
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

### 5.10 `android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt`

Replace the whole file. Compared with `main`: the comment, two imports, and `AskAndMessage` at the bottom.

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
import au.screentime.kid.ask.AskAndMessage
import au.screentime.kid.ask.Look
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.clockText
import java.time.LocalTime
import kotlinx.coroutines.delay

/**
 * The block screen's content (docs/SPEC.md §16.2): the time at the top, a moon or an hourglass, "It's bedtime",
 * when the device is back, and **Ask for more time** and **Message Mum and Dad**. Calls, SOS and "I'm the parent"
 * come with their cards.
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
        AskAndMessage(status, Look.NIGHT)
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

### 5.11 `android/app-kid/src/test/kotlin/au/screentime/kid/ask/SenderTest.kt`

```kotlin
package au.screentime.kid.ask

import au.screentime.core.model.api.ApiClient
import au.screentime.kid.live.Answer
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
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class SenderTest {
    private val requests = mutableListOf<HttpRequestData>()

    private fun sender(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) = Sender(
        ApiClient(
            "https://api.example",
            MockEngine { request ->
                requests += request
                handler(request)
            },
            token = { "device-token" },
        ),
    )

    private fun MockRequestHandleScope.json(text: String, status: HttpStatusCode = HttpStatusCode.Created) =
        respond(text, status, headersOf(HttpHeaders.ContentType, "application/json"))

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    private val request = """{"id":"r1","kidId":"k1","kidName":"Alex","deviceId":"d1","deviceName":"Pixel 7",""" +
        """"pool":"phone","minutes":30,"reason":null,"status":"pending","createdAt":"2026-10-27T09:00:00Z",""" +
        """"resolvedAt":null,"resolvedByName":null,"grantId":null,"grantedMinutes":null}"""

    private val message = """{"id":"m1","kidId":"k1","kidName":"Alex","deviceId":"d1","deviceName":"Pixel 7",""" +
        """"body":"Can you call me?","presetId":"p1","createdAt":"2026-10-27T09:00:00Z"}"""

    @Test
    fun anAskSendsTheMinutesAndATrimmedReason() = runBlocking {
        val send = sender { json(request) }

        assertEquals(SendResult.SENT, send.ask("r1", 30, "  homework  "))
        assertEquals(SendResult.SENT, send.ask("r2", 15, "   "))

        assertEquals("/v1/device/time-requests", requests[0].url.encodedPath)
        assertEquals("Bearer device-token", requests[0].headers[HttpHeaders.Authorization])
        assertEquals("""{"id":"r1","minutes":30,"reason":"homework"}""", requests[0].bodyText())
        // No reason: the field is left out.
        assertEquals("""{"id":"r2","minutes":15}""", requests[1].bodyText())
    }

    @Test
    fun aMessageSendsThePresetIdOnlyWhenThereIsOne() = runBlocking {
        val send = sender { json(message) }

        assertEquals(SendResult.SENT, send.message("m1", "Can you call me?", "p1"))
        assertEquals(SendResult.SENT, send.message("m2", " I'm at Sam's ", null))

        assertEquals("/v1/device/messages", requests[0].url.encodedPath)
        assertEquals("""{"id":"m1","body":"Can you call me?","presetId":"p1"}""", requests[0].bodyText())
        assertEquals("""{"id":"m2","body":"I'm at Sam's"}""", requests[1].bodyText())
    }

    @Test
    fun theServerAndTheNetworkSayWhatWentWrong() = runBlocking {
        val conflict = """{"error":{"code":"conflict","message":"Already waiting."}}"""

        assertEquals(SendResult.ALREADY_ASKED, sender { json(conflict, HttpStatusCode.Conflict) }.ask("r1", 15, ""))
        assertEquals(SendResult.FAILED, sender { respond("", HttpStatusCode.BadGateway) }.ask("r1", 15, ""))
        assertEquals(SendResult.OFFLINE, sender { throw IOException("no network") }.message("m1", "Hi", null))
    }

    @Test
    fun theKidSeesWordsNotCodes() {
        assertNull(sendErrorText(SendResult.SENT, "Mum or Dad"))
        assertNull(sendErrorText(SendResult.ALREADY_ASKED, "Mum or Dad"))
        assertEquals(
            "Can't reach Mum or Dad right now. Check the internet and try again.",
            sendErrorText(SendResult.OFFLINE, "Mum or Dad"),
        )
        assertEquals("That didn't work. Try again in a minute.", sendErrorText(SendResult.FAILED, "Dad"))
    }

    @Test
    fun theAnswerSaysWhoAndHowMuch() {
        assertEquals("Dad said yes! +15 min 🎉", answerText(Answer(approved = true, minutes = 15, byName = "Dad")))
        assertEquals("Mum said yes! +1h 30m 🎉", answerText(Answer(approved = true, minutes = 90, byName = "Mum")))
        assertEquals("Dad said not this time", answerText(Answer(approved = false, minutes = 0, byName = "Dad")))
    }
}
```

### 5.12 `android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt`

Replace the whole file. One new test at the end, `aParentsAnswerIsReadFromRequestResolved`; the others are unchanged.

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
}
```

### 5.13 `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt`

Replace the whole file. Two new tests at the end; the others are unchanged.

```kotlin
package au.screentime.kid.status

import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.DeviceStateMessagePresetsItem
import au.screentime.core.model.api.DeviceStateParentsItem
import au.screentime.core.model.api.DeviceStatePendingRequest
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

### 6.1 What the kid sees

| Where | What |
|---|---|
| Main screen, portrait | under "Bedtime 2:21 pm": the card (if any), then **Ask for more time** (filled teal pill, 56 dp, full width up to 420 dp) and **Message Dad** (tonal pill, 56 dp), 12 dp apart |
| Main screen, landscape or tablet | the same, in the right column under the details; the column scrolls if it does not fit |
| Block screen | at the bottom, under the picture and the words: the card (if any), **Ask for more time** (light `onNight` pill with night-blue text) and **Message Dad** (outlined in `onNight`) |
| Waiting card | "Waiting for Dad…" (or "Waiting for Mum or Dad…") with a 12 dp dot pulsing between 30% and 100% every 0.9 s; grey `surfaceVariant` by day, `onNight` at 12% on the block screen. **Ask for more time** is greyed out while it shows |
| Answer card | 4 seconds: "Dad said yes! +30 min 🎉" bold white on green `#16A34A`, or "Dad said not this time" on the waiting card's colours. It replaces the waiting card |
| Ask sheet | "How much more?" (headline, bold); **15 min**, **30 min**, **1 hour** as three equal 56 dp pills (picked: teal with white text; others grey), 15 picked first; "Why? (optional)" field with "0/160" under it on the right; **Send** (56 dp, full width), "Sending…" while it sends; a red line under the field if it failed |
| Message sheet | "Message Dad"; one full-width pill per ready-made message (left-aligned, teal when picked); "Or write your own" field with "0/160"; **Send**, enabled once a message is picked or written. Typing in the field unpicks the ready-made one. After sending: big teal "Sent ✓" for 1.5 s, then the sheet closes |
| Heads-up notification | the answer's words as the title, on the channel "Answers from your parents"; it goes away after a minute |

### 6.2 What happens

| Event | What the app does |
|---|---|
| **Send** in the ask sheet | `POST /v1/device/time-requests` `{ id, minutes, reason? }` (a blank reason is left out). Sent, or 409 "already asked": the sheet closes and the service syncs, so the snapshot's `pendingRequest` shows the waiting card |
| **Send** in the message sheet | `POST /v1/device/messages` `{ id, body, presetId? }` (`presetId` only for a ready-made message) |
| No connection | the sheet stays open with "Can't reach Dad right now. Check the internet and try again."; **Send** again uses the same id, so nothing is stored twice |
| Any other error | "That didn't work. Try again in a minute." |
| A request is waiting and the screen is on | the live channel is open, also when the phone is not blocked (log `live: started`) |
| `request_resolved` comes down the live channel | log `answer: approved=true minutes=30`; the answer card and the heads-up; then the usual sync (a yes brings its grant, and a yes on the block screen unlocks) |

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-035-ask-and-message
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-035-ask-and-message.md` and `server/scripts/dev-answer.ts` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Create or replace 5.1 to 5.10. Build:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app-kid:assembleDebug
   cd ..
   ```
   Commit: `CARD-035: ask for more time and message`.
3. Create or replace 5.11 to 5.13. Run `.\gradlew.bat :app-kid:testDebugUnitTest` (from `android`). Commit: `CARD-035: sender, answer and status tests`.
4. Run the acceptance checks in section 8, including the emulator run (8.2), in this session.
5. Push and open the PR (section 10).
6. Wait for the CI check to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback. The throwaway `local-dev-only-…` values below are fine.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints thirteen lines:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml, app-kid\build\test-results\testDebugUnitTest\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.core.time.DurationFormatTest tests="9" failures="0" errors="0"
  au.screentime.core.time.EngineVectorsTest tests="27" failures="0" errors="0"
  au.screentime.core.model.api.ApiClientTest tests="13" failures="0" errors="0"
  au.screentime.kid.ask.SenderTest tests="5" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolLinkTest tests="4" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolRulesTest tests="7" failures="0" errors="0"
  au.screentime.kid.live.LiveTest tests="6" failures="0" errors="0"
  au.screentime.kid.status.KidStatusTest tests="9" failures="0" errors="0"
  au.screentime.kid.status.WarningTrackerTest tests="5" failures="0" errors="0"
  au.screentime.kid.sync.SyncerTest tests="4" failures="0" errors="0"
  au.screentime.kid.sync.TrustedClockTest tests="4" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="10" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```

### 8.2 On the emulator

Run every step below **in this session**, and paste the **real terminal output** of each step into the handback. A summary is not accepted, and neither is "run earlier in this session" for output you no longer have. If your context was summarised partway through, run the steps again from step 1.

**The emulator.** Use the same emulator as in CARD-034, with nobody signed in. Remove the app from CARD-034 first (each command prints `Success...`, or an error if there was nothing to remove; both are fine), and keep the screen from turning off by itself for 30 minutes:

```powershell
& $adb shell am task lock stop
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
```

`& $adb devices` must list exactly one `emulator-5554   device`. If it says `offline` for more than a minute, use the cold boot steps James gave you for CARD-030b; do not wait longer than 5 minutes. If `uninstall` fails with `DELETE_FAILED_INTERNAL_ERROR` and `remove-active-admin` with a `SecurityException` (the app is still Device Owner), wipe the emulator (Device Manager › **Wipe Data**), cold boot it, and run the commands above again. That is not a deviation, but say that you did it under "Outside the repo".

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). `dev-answer.ts` signs a parent token with `JWT_SECRET`, so `$env:JWT_SECRET` must be the same value as in `deploy\.env`:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
```

The last line prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` The family has one parent, "Dad", and five ready-made messages, the first two being "Can I have more time?" and "I'm done, you can lock it". If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

Do the run between 6 am and 10 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Answer yes` makes Dad say yes to Alex's waiting request (`Answer yes 45` gives 45 minutes instead; `Answer no` says no). `Type-Text` types into the field that has the focus (a space is typed as `%s`). `Tap-Text "Send" 0` taps without waiting afterwards ("Sent ✓" shows for only 1.5 seconds). `Hide-Keyboard` presses Back once, which closes the on-screen keyboard and leaves the sheet open. `Requests` and `Messages` print the database rows. `KidLog` prints the service's `live:` and `answer:` log lines.

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
function Type-Text([string]$text) {
  & $adb shell input text $text
  Start-Sleep -Seconds 1
}
function Hide-Keyboard {
  & $adb shell input keyevent KEYCODE_BACK
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
function Answer([string]$answer, [string]$minutes = "") {
  if ($minutes) {
    pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-answer.ts Alex $answer $minutes
  } else {
    pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-answer.ts Alex $answer
  }
}
function Requests {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select minutes, reason, status from time_requests order by created_at"
}
function Messages {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select body, preset_id is not null as preset from kid_messages order by created_at"
}
function Notes {
  & $adb shell dumpsys notification --noredact | Select-String 'pkg=au.screentime.kid|android.title=|android.text=' | ForEach-Object { $_.Line.Trim() }
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
function KidLog {
  & $adb logcat -d -s KidService:I | Select-String 'live:|answer:' | ForEach-Object { $_.Line.Trim() }
}
```

`Answer yes` prints `Dad said yes to Alex's request for 30 min (homework) +30 min.`; `Answer no` prints `Dad said no to Alex's request for 15 min (no reason).`

**The run.** From `android`, one step at a time; check each expected result before the next step. The answer card shows for only 4 seconds, so in steps 3 and 6 run `Answer` and `Shot` straight after each other, without a pause.

1. Install, make it Device Owner and pair. In a second PowerShell window, from the repo root, with the same `$env:DATABASE_URL`, run `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` and copy the `Emulator link`. Back in the first window:
   ```powershell
   Bedtime 60
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   Open-App
   Open-Link "<the emulator link>"
   Tap-Text "Yes"
   Start-Sleep -Seconds 10
   Shot "1-home"
   ```
   `1-home` shows "Hi Alex", the ring with about `1h`, "Bedtime …", and under it **Ask for more time** (teal) and **Message Dad** (light teal).
2. Ask from the main screen, for 30 minutes, because of homework:
   ```powershell
   Tap-Text "Ask for more time"
   Shot "2-ask-sheet"
   Tap-Text "30 min"
   Tap-Text "Why? (optional)"
   Type-Text "homework"
   Hide-Keyboard
   Tap-Text "Send"
   Start-Sleep -Seconds 5
   Shot "3-waiting"
   Requests
   KidLog
   ```
   `2-ask-sheet` shows the sheet over the main screen: "How much more?", the three pills with **15 min** teal, the "Why? (optional)" field with `0/160`, and **Send**. `3-waiting` shows the main screen with the card "Waiting for Dad…" above a greyed-out **Ask for more time**. `Requests` has one row: `30 | homework | pending`. `KidLog` has `live: started` and `live: connected`: the channel opened although the phone is not blocked.
3. Dad says yes:
   ```powershell
   Answer yes
   Shot "4-yes"
   Start-Sleep -Seconds 5
   Notes
   KidLog
   Requests
   ```
   `4-yes` shows the green card "Dad said yes! +30 min 🎉" where the waiting card was, and **Ask for more time** teal again. `Notes` has `android.title=String (Dad said yes! +30 min 🎉)`. `KidLog` now also has `answer: approved=true minutes=30`, then `live: stopped`. `Requests`: `30 | homework | approved`.
4. A ready-made message:
   ```powershell
   Tap-Text "Message Dad"
   Shot "5-message-sheet"
   Tap-Text "Can I have more time?"
   Tap-Text "Send" 0
   Start-Sleep -Milliseconds 700
   Shot "6-sent"
   Start-Sleep -Seconds 3
   Messages
   ```
   `5-message-sheet` shows "Message Dad", the five ready-made messages as grey pills, "Or write your own" with `0/160`, and a greyed-out **Send**. `6-sent` shows the big teal "Sent ✓". `Messages` has one row: `Can I have more time? | t`.
5. Out of time, ask from the block screen, and Dad says no:
   ```powershell
   Bedtime 60 0
   Screen-Off
   Screen-On
   Start-Sleep -Seconds 10
   Tap-Text "Ask for more time"
   Tap-Text "Send"
   Start-Sleep -Seconds 5
   Shot "7-block-waiting"
   Answer no
   Shot "8-block-no"
   Top
   ```
   `7-block-waiting` shows the block screen (hourglass, "Out of Phone time") with "Waiting for Dad…" above a faded **Ask for more time** and the outlined **Message Dad**. `8-block-no` shows "Dad said not this time" in place of the waiting card, still on the block screen. `Top` shows `au.screentime.kid/.block.BlockActivity`.
6. Ask for an hour from the block screen; Dad says yes, which unlocks:
   ```powershell
   Tap-Text "Ask for more time"
   Tap-Text "1 hour"
   Tap-Text "Send"
   Start-Sleep -Seconds 5
   Answer yes
   Wait-Unblocked
   Shot "9-unblocked"
   Requests
   ```
   `Wait-Unblocked` prints `Unblocked after N s` with N **10 or less**. `9-unblocked` shows the main screen with the ring and, if it is still within the 4 seconds, the green "Dad said yes! +1h 🎉" (the card may already be gone; that is fine). `Requests` ends with `15 | | denied` and `60 | | approved`.
7. An own message, first with the server down:
   ```powershell
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env stop api
   Tap-Text "Message Dad"
   Tap-Text "Or write your own"
   Type-Text "At%sSams%shouse"
   Hide-Keyboard
   Tap-Text "Send"
   Start-Sleep -Seconds 15
   Shot "10-offline"
   docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env start api
   Start-Sleep -Seconds 10
   curl.exe -s http://localhost:8080/health
   Tap-Text "Send"
   Start-Sleep -Seconds 5
   Messages
   ```
   `10-offline` shows the message sheet with "At Sams house" in the field, `13/160`, and the red line "Can't reach Dad right now. Check the internet and try again." under it. `curl.exe` shows `"status":"ok"`. `Messages` has two rows: `Can I have more time? | t` and `At Sams house | f` (only one `At Sams house`).
8. Undo, so the emulator can be used again:
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

- [ ] Steps 1 to 8 gave the expected results, run in this session. Paste the real output of every command in steps 2 to 7 into the handback (the `Bedtime`, `Answer`, `Requests`, `Messages`, `Notes`, `KidLog`, `Top`, `Wait-Unblocked` and `curl.exe` lines).
- [ ] The ten screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c35\`: `1-home.png`, `2-ask-sheet.png`, `3-waiting.png`, `4-yes.png`, `5-message-sheet.png`, `6-sent.png`, `7-block-waiting.png`, `8-block-no.png`, `9-unblocked.png`, `10-offline.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png`.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 13 files (in any order):
  ```
  android/app-kid/src/main/kotlin/au/screentime/kid/ask/Sender.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/ask/Sheets.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/block/BlockScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/home/HomeScreen.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/live/Live.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/live/LiveChannel.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/status/StatusHub.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/ask/SenderTest.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `android/app-kid/src/test/kotlin/au/screentime/kid/ask/SenderTest.kt` | An ask sends the minutes and a trimmed reason, and leaves a blank reason out; a message sends `presetId` only for a ready-made one; 409 is "already asked", 502 "failed", no network "offline"; the words for each; the answer's words ("+15 min", "+1h 30m"). |
| `android/app-kid/src/test/kotlin/au/screentime/kid/live/LiveTest.kt` | As in CARD-034, plus: a yes and a no are read from `request_resolved`; other envelopes, missing or wrong fields and non-JSON give no answer. |
| `android/app-kid/src/test/kotlin/au/screentime/kid/status/KidStatusTest.kt` | As in CARD-032, plus: the parents, the ready-made messages and the waiting request come from the snapshot; "Mum or Dad", "Mum, Dad or Nan"; "15 min", "1h 30m". |

The sheets, the cards and the live channel's answer are checked by the emulator run in 8.2, not by unit tests.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-035: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-035-ask-and-message`
5. Open a PR into `main` titled `CARD-035: Ask for more time and Message`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-035-ask-and-message --title "CARD-035: Ask for more time and Message" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-035-ask-and-message.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: thirteen suites, SenderTest 5, LiveTest 6, KidStatusTest 9, all `failures="0"`
   - [x] emulator run steps 1 to 8 — results as expected
   - [x] ten screenshots in C:\Users\james\OpenCode\Testing\temp\c35\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 13 files

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

- **`Tap-Text` says `No 'Send' on screen`** after typing: the keyboard may cover it. Run `Hide-Keyboard` once more and repeat the `Tap-Text`. If the sheet closed instead, open it again, redo the step, and say so under "Deviations".
- **`Hide-Keyboard` closed the whole sheet** (no keyboard was up): open the sheet again, do the step again without `Hide-Keyboard`, and say so under "Deviations".
- **`Type-Text` typed nothing**: the field did not get the focus. Tap the field once more with `Tap-Text` and type again.
- **`3-waiting` has no waiting card**: wait 10 seconds and take the shot again. If it still has none, paste `Requests` and `& $adb logcat -d -s KidService:I | Select-Object -Last 15`, and stop there.
- **`4-yes` shows the waiting card or nothing**: the 4 seconds were over, or the answer had not arrived yet. Paste `KidLog`; if it has `answer: approved=true`, the answer arrived: run step 6's ask and answer once more on the main screen to get the shot, and say so under "Deviations". If it has no `answer:` line, stop there.
- **`Answer` says `the API said 401`**: `$env:JWT_SECRET` is not the same as `JWT_SECRET` in `deploy\.env`. Set it again as in "The server" and repeat.
- **`Answer` says `Alex has no request waiting for an answer`**: the **Send** before it did not go through. Paste `Requests`, and stop there.
- **`Wait-Unblocked` prints `Still blocked after 45 s`**: paste `KidLog` and `& $adb logcat -d -s KidService:I | Select-Object -Last 10`, and stop there.
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
Claude, here is Bob's handback for CARD-035. Please review and merge if it is good.

CARD: CARD-035 Ask for more time and Message
PR: <full PR URL>
Branch: bob/card-035-ask-and-message
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
