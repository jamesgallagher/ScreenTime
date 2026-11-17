package au.screentime.parent.today

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.TodayKid
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.R
import au.screentime.parent.kids.formatClock
import kotlinx.coroutines.launch

/**
 * The extend bedtime sheet (docs/SPEC.md §16.4): a later bedtime for tonight in 15-minute steps up to midnight, with
 * +30m, +1h and +2h, or back to the usual bedtime. Swiping it down or tapping outside closes it without sending.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BedtimeSheet(kid: TodayKid, vm: TodayViewModel, onDone: () -> Unit) {
    // Read once when the sheet opens, so a refresh behind it does not move the picked time.
    val bedtime = remember { vm.bedtimeOf(kid) }
    val choices = remember { bedtimeChoices(bedtime) }
    var value by remember { mutableStateOf(startChoice(bedtime)) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val extended = bedtime.extendedBy != null
    val scope = rememberCoroutineScope()

    fun send(call: suspend () -> String?) {
        scope.launch {
            busy = true
            error = null
            val words = call()
            busy = false
            if (words == null) onDone() else error = words
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDone,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = bedtimeTitle(kid.name, bedtime),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = bedtimeHelp(kid.name),
                style = MaterialTheme.typography.bodyMedium,
                color = ScreenTimeTheme.colors.muted,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(24.dp))
            val picked = value
            if (picked == null) {
                Text(
                    text = "It's too late to move bedtime tonight.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = ScreenTimeTheme.colors.muted,
                )
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedIconButton(
                        onClick = { value = stepChoice(choices, picked, -1) },
                        enabled = choices.indexOf(picked) > 0 && !busy,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(painterResource(R.drawable.ic_remove), contentDescription = "15 minutes earlier")
                    }
                    Column(
                        modifier = Modifier.widthIn(min = 180.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = bedtimeClock(picked),
                            style = MaterialTheme.typography.displaySmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            text = laterText(bedtime, picked),
                            style = MaterialTheme.typography.bodyMedium,
                            color = ScreenTimeTheme.colors.muted,
                        )
                    }
                    OutlinedIconButton(
                        onClick = { value = stepChoice(choices, picked, 1) },
                        enabled = choices.indexOf(picked) < choices.size - 1 && !busy,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(painterResource(R.drawable.ic_add), contentDescription = "15 minutes later")
                    }
                }
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    quickChoices(bedtime).forEach { (label, time) ->
                        FilterChip(
                            selected = time != null && picked == time,
                            onClick = { if (time != null) value = time },
                            enabled = time != null && !busy,
                            label = { Text(label) },
                        )
                    }
                }
            }
            if (error != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = error!!,
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.critical,
                )
            }
            if (picked != null) {
                Spacer(Modifier.height(24.dp))
                Button(
                    onClick = { send { vm.extendBedtime(kid.id, picked) } },
                    enabled = !busy && !(extended && picked == bedtime.tonight),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Text("Extend to ${bedtimeClock(picked)}")
                    }
                }
            }
            if (extended) {
                Spacer(Modifier.height(8.dp))
                TextButton(
                    onClick = { send { vm.endBedtimeExtension(kid.id) } },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Back to ${formatClock(bedtime.scheduled)}", color = ScreenTimeTheme.colors.danger)
                }
            }
        }
    }
}
