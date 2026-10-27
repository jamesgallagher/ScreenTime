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
