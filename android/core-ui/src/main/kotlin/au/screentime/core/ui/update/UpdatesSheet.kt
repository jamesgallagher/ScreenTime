package au.screentime.core.ui.update

import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.screentime.core.ui.ScreenTimeTheme

/** When the last check finished (elapsed realtime, ms), so a sheet opened again within a minute does not repeat it. */
private object LastCheck {
    var finishedAt: Long? = null
}

/**
 * "Version 0.1.8", a small muted link (docs/SPEC.md §12.11): the kid app's main screen under the parent mode
 * banner, the parent app's Settings. 48 dp to tap.
 */
@Composable
fun VersionLink(versionName: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = modifier.heightIn(min = 48.dp)) {
        Text(
            text = "Version $versionName",
            style = MaterialTheme.typography.bodySmall,
            color = ScreenTimeTheme.colors.muted,
        )
    }
}

/**
 * **Updates** (docs/SPEC.md §12.11): the app's name, "Version 0.1.8", one status line and one main button.
 * Opening it checks at once (see [checkOnOpen]). When there is something newer it asks "… Update now?"; the tap on
 * **Update now** is the yes. **Later** only closes the sheet.
 *
 * @param whatWillHappen the line under **Update now**: [WhatWillHappen.KID] or [WhatWillHappen.PARENT].
 * @param sosActive an install would stop an SOS alarm, so **Update now** is not offered while one is on.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdatesSheet(
    source: UpdateSource,
    appName: String,
    versionName: String,
    whatWillHappen: String,
    onDismiss: () -> Unit,
    sosActive: Boolean = false,
) {
    val state by source.state.collectAsState()
    var previous by remember { mutableStateOf<UpdateState?>(null) }
    LaunchedEffect(Unit) {
        val last = LastCheck.finishedAt
        val seconds = last?.let { (SystemClock.elapsedRealtime() - it) / 1000 }
        if (checkOnOpen(source.state.value, seconds)) source.checkNow()
    }
    LaunchedEffect(state) {
        if (previous == UpdateState.Checking && state != UpdateState.Checking) {
            LastCheck.finishedAt = SystemClock.elapsedRealtime()
        }
        previous = state
    }
    val colors = ScreenTimeTheme.colors
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "Updates",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "$appName · Version $versionName",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted,
            )
            Spacer(Modifier.height(12.dp))
            val status = statusLine(state)
            if (status != null) {
                Text(
                    text = status,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (state is UpdateState.Failed || state == UpdateState.CheckFailed) colors.critical else colors.onSurface,
                )
            }
            Spacer(Modifier.height(12.dp))
            val label = mainButton(state)
            val offered = mainButtonUpdates(state)
            if (label == null) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .size(32.dp)
                        .semantics { contentDescription = status ?: "Working" },
                    strokeWidth = 3.dp,
                    color = colors.primary,
                )
            } else if (offered && sosActive) {
                Text(
                    text = "Not while an SOS is on.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted,
                )
            } else {
                Button(
                    onClick = { if (offered) source.update() else source.checkNow() },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                ) {
                    Text(label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                if (offered) {
                    Text(
                        text = whatWillHappen,
                        modifier = Modifier.padding(top = 4.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.muted,
                    )
                    TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("Later") }
                }
            }
            if (!offered || sosActive) {
                TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("Close") }
            }
        }
    }
}
