package au.screentime.parent.home

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.Me
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.BuildConfig

/** The Settings tab (docs/SPEC.md §16.4): who is signed in, the app lock, the parent code, and sign out. */
@Composable
fun SettingsScreen(me: Me, secure: Boolean, onSignOut: () -> Unit) {
    var showConfirm by remember { mutableStateOf(false) }
    var showParentCode by rememberSaveable { mutableStateOf(false) }
    if (showParentCode) {
        ParentCodeScreen(onBack = { showParentCode = false })
    } else {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            ScreenHeader("Settings")
            Column(
                modifier = Modifier.padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SettingsCard("Signed in as") {
                    Text(
                        text = me.parent?.displayName.orEmpty(),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = me.parent?.email.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = ScreenTimeTheme.colors.muted,
                    )
                    me.family?.let {
                        Text(
                            text = it.name,
                            style = MaterialTheme.typography.bodyMedium,
                            color = ScreenTimeTheme.colors.muted,
                        )
                    }
                }
                SettingsCard("App lock") {
                    Text(
                        text = if (secure) {
                            "The app locks when you have been away from it for 5 minutes. Open it with your fingerprint or this phone's PIN."
                        } else {
                            "This phone has no screen lock, so the app can't lock itself. Set a PIN in the phone's settings."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                SettingsCard("Parent code") {
                    Text(
                        text = "For a kid's device that can't reach the internet.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = ScreenTimeTheme.colors.muted,
                    )
                    TextButton(onClick = { showParentCode = true }) {
                        Text("Show parent code")
                    }
                }
                OutlinedButton(
                    onClick = { showConfirm = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) {
                    Text("Sign out")
                }
                Text(
                    text = "Version ${BuildConfig.VERSION_NAME}",
                    style = MaterialTheme.typography.bodySmall,
                    color = ScreenTimeTheme.colors.muted,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 16.dp),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
    if (showConfirm) {
        AlertDialog(
            onDismissRequest = { showConfirm = false },
            title = { Text("Sign out of Screen Time?") },
            text = { Text("You'll need a new code from your email to sign in again.") },
            confirmButton = {
                TextButton(onClick = {
                    showConfirm = false
                    onSignOut()
                }) {
                    Text("Sign out")
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirm = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}

/** A settings card: the label and its content. */
@Composable
private fun SettingsCard(label: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.medium),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = ScreenTimeTheme.colors.muted,
            )
            content()
        }
    }
}
