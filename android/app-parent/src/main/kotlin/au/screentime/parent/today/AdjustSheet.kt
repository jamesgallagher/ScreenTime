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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TodayKid
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.R
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * The adjust sheet (docs/SPEC.md §16.4): a Material 3 bottom sheet that adds or takes away time in
 * 15-minute steps, with a preview and a lock-now button. Swiping it down or tapping outside closes it
 * without sending anything.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdjustSheet(kid: TodayKid, startPool: Pool, vm: TodayViewModel, onDone: () -> Unit) {
    var pool by remember { mutableStateOf(startPool) }
    var amount by remember { mutableStateOf(ADJUST_DEFAULT) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmLock by remember { mutableStateOf(false) }
    // A new id whenever the pool or the amount changes; the same id on a retry after an error with nothing changed.
    var id by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var lockId by remember { mutableStateOf(UUID.randomUUID().toString()) }
    val scope = rememberCoroutineScope()

    fun changePool(p: Pool) {
        pool = p
        amount = ADJUST_DEFAULT
        error = null
        id = UUID.randomUUID().toString()
        lockId = UUID.randomUUID().toString()
    }

    fun changeAmount(a: Int) {
        amount = a
        id = UUID.randomUUID().toString()
    }

    // Today reloads while the sheet is open, so the pool is always read from the newest kid passed in.
    val poolView = kid.pools.first { it.pool == pool }

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
                text = adjustTitle(kid.name),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(16.dp))
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                kid.pools.forEachIndexed { index, p ->
                    SegmentedButton(
                        selected = pool == p.pool,
                        onClick = { if (!busy) changePool(p.pool) },
                        shape = SegmentedButtonDefaults.itemShape(index, kid.pools.size),
                        enabled = !busy,
                    ) {
                        Text(poolName(p.pool))
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedIconButton(
                    onClick = { changeAmount(stepDown(amount)) },
                    enabled = amount > ADJUST_MIN && !busy,
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(
                        painterResource(R.drawable.ic_remove),
                        contentDescription = "15 minutes less",
                    )
                }
                Text(
                    text = formatAdjust(amount),
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = when {
                        amount > 0 -> MaterialTheme.colorScheme.primary
                        amount < 0 -> ScreenTimeTheme.colors.danger
                        else -> ScreenTimeTheme.colors.muted
                    },
                    modifier = Modifier.widthIn(min = 160.dp),
                    textAlign = TextAlign.Center,
                )
                OutlinedIconButton(
                    onClick = { changeAmount(stepUp(amount)) },
                    enabled = amount < ADJUST_MAX && !busy,
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(
                        painterResource(R.drawable.ic_add),
                        contentDescription = "15 minutes more",
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                QUICK_AMOUNTS.forEach { q ->
                    FilterChip(
                        selected = amount == q,
                        onClick = { if (!busy) changeAmount(q) },
                        label = { Text(formatAdjust(q)) },
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            Text(
                text = adjustPreview(poolView, amount),
                style = MaterialTheme.typography.bodyLarge,
                color = ScreenTimeTheme.colors.muted,
            )
            if (error != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = error!!,
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.critical,
                )
            }
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = {
                    scope.launch {
                        busy = true
                        val words = vm.adjust(kid.id, pool, amount, id)
                        busy = false
                        if (words == null) onDone() else error = words
                    }
                },
                enabled = amount != 0 && !busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) {
                if (busy) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    Text("Apply")
                }
            }
            if (!poolView.locked) {
                Spacer(Modifier.height(8.dp))
                TextButton(
                    onClick = { confirmLock = true },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Lock now", color = ScreenTimeTheme.colors.danger)
                }
            }
        }
    }

    if (confirmLock) {
        AlertDialog(
            title = { Text(lockTitle(kid.name, pool)) },
            text = { Text(lockText(kid.name, poolView)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmLock = false
                        scope.launch {
                            busy = true
                            val words = vm.lockNow(kid.id, pool, lockId)
                            busy = false
                            if (words == null) onDone() else error = words
                        }
                    },
                ) {
                    Text("Lock now", color = ScreenTimeTheme.colors.danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmLock = false }) {
                    Text("Cancel")
                }
            },
            onDismissRequest = { confirmLock = false },
        )
    }
}
