package au.screentime.parent.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.AppMark

/** The sign-in screen (docs/SPEC.md §11.1). */
@Composable
fun SignInScreen(vm: SignInViewModel) {
    val state = vm.state
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .imePadding(),
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 400.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            AppMark()
            Spacer(Modifier.height(24.dp))
            Text(
                text = "Screen Time",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Parent sign-in",
                style = MaterialTheme.typography.bodyLarge,
                color = ScreenTimeTheme.colors.muted,
            )
            Spacer(Modifier.height(32.dp))
            if (state.codeSent) {
                Text(
                    text = "We emailed a 6-digit code to ${state.email}. It works for 10 minutes.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(16.dp))
                OutlinedTextField(
                    value = state.code,
                    onValueChange = vm::setCode,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Code") },
                    singleLine = true,
                    enabled = !state.busy,
                    isError = state.error != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { vm.verify() }),
                    textStyle = MaterialTheme.typography.headlineSmall.copy(letterSpacing = 6.sp, textAlign = TextAlign.Center),
                )
                message(state.error, state.note)
                Spacer(Modifier.height(16.dp))
                pillButton("Sign in", state.busy) { vm.verify() }
                Spacer(Modifier.height(8.dp))
                TextButton(
                    enabled = !state.busy,
                    onClick = vm::sendCode,
                ) {
                    Text("Send a new code")
                }
                TextButton(
                    enabled = !state.busy,
                    onClick = vm::changeEmail,
                ) {
                    Text("Use a different email")
                }
            } else {
                OutlinedTextField(
                    value = state.email,
                    onValueChange = vm::setEmail,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Email") },
                    singleLine = true,
                    enabled = !state.busy,
                    isError = state.error != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { vm.sendCode() }),
                )
                message(state.error, state.note)
                Spacer(Modifier.height(16.dp))
                pillButton("Send code", state.busy) { vm.sendCode() }
            }
        }
    }
}

/** The message under the fields: the error in the danger colour, or else the note in the muted colour. */
@Composable
private fun message(error: String?, note: String?) {
    val text = error ?: note ?: return
    Spacer(Modifier.height(8.dp))
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (error != null) ScreenTimeTheme.colors.danger else ScreenTimeTheme.colors.muted,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The pill button: full width, at least 48 dp high, a progress indicator while busy. */
@Composable
private fun pillButton(text: String, busy: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = !busy,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            Text(text, style = MaterialTheme.typography.labelLarge)
        }
    }
}
