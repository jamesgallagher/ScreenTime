package au.screentime.parent.update

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.core.ui.update.UpdateState

/**
 * "ST Parent 0.1.3 is ready · Update" (docs/SPEC.md §12.7, §16.4): one quiet row at the top of every tab, under
 * the SOS banner and above Waiting for you. Nothing is drawn when there is nothing newer, or while an SOS is on.
 */
@Composable
fun UpdateRow(sosActive: Boolean) {
    val state by ParentUpdates.source.state.collectAsState()
    if (!showsUpdateRow(state, sosActive)) return
    val colors = ScreenTimeTheme.colors
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = colors.surface),
        border = BorderStroke(1.dp, colors.outline),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .padding(start = 16.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = updateTitle(state),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = if (state is UpdateState.Failed) colors.critical else colors.onSurface,
                )
                updateDetail(state)?.let {
                    Text(text = it, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
                }
            }
            if (updateButton(state)) {
                Button(
                    onClick = { ParentUpdates.source.update() },
                    modifier = Modifier
                        .padding(start = 12.dp)
                        .heightIn(min = 48.dp),
                ) {
                    Text("Update")
                }
            } else {
                CircularProgressIndicator(
                    modifier = Modifier
                        .padding(start = 12.dp, end = 8.dp)
                        .size(24.dp),
                    strokeWidth = 3.dp,
                    color = colors.primary,
                )
            }
        }
    }
}
