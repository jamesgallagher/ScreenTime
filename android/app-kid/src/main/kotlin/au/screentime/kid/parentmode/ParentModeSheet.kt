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
