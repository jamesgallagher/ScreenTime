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
        is SetupState.Done -> DoneScreen(s.kidName, vm.deviceWord)
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

@Composable
private fun DoneScreen(kidName: String, deviceWord: String) {
    SetupPage {
        KidInitial(kidName)
        Spacer(Modifier.height(24.dp))
        Title("All set, $kidName")
        Spacer(Modifier.height(12.dp))
        Body("Screen Time is looking after this $deviceWord now.")
    }
}
