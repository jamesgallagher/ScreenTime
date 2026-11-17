package au.screentime.parent.inbox

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.model.api.TimeRequest
import au.screentime.core.time.formatDuration
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.R
import au.screentime.parent.kids.AppRule
import au.screentime.parent.today.poolName
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.launch

/**
 * "Waiting for you" (docs/SPEC.md §16.4): a small card at the top of every tab, under the SOS banner, with
 * everything a kid is waiting on: time requests, parent-mode requests, new apps and messages. Nothing at all is
 * drawn when nothing waits. Folded, it shows the newest item and "Show 2 more"; open, every item, scrolling
 * inside the card past 360 dp so the tab under it stays usable.
 */
@Composable
fun WaitingStrip(vm: InboxViewModel, zone: ZoneId, onParentMode: (Waiting.ParentMode) -> Unit) {
    val now = Instant.now()
    val items = visibleWaiting(vm.state.waiting.orEmpty(), now)
    var expanded by rememberSaveable { mutableStateOf(false) }
    // A tapped notification for a waiting item opens the strip.
    LaunchedEffect(Unit) {
        WaitingNews.open.collect { if (it > 0) expanded = true }
    }
    // The request the amount dialog is open for; it closes by itself when the request leaves the list.
    var otherId by remember { mutableStateOf<String?>(null) }
    val other = items.filterIsInstance<Waiting.Time>().find { it.request.id == otherId }?.request
    if (otherId != null && other == null) otherId = null
    if (items.isEmpty()) return
    val shown = if (expanded || items.size == 1) items else items.take(1)
    val colors = ScreenTimeTheme.colors
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp)
            .animateContentSize(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = colors.primarySoft),
        border = BorderStroke(1.dp, colors.primary.copy(alpha = 0.35f)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .then(
                    if (items.size > 1) {
                        Modifier.clickable(role = Role.Button, onClickLabel = waitingToggle(items.size, expanded)) {
                            expanded = !expanded
                        }
                    } else {
                        Modifier
                    },
                )
                .heightIn(min = 40.dp)
                .padding(start = 16.dp, end = 8.dp, top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = waitingHeader(items.size),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = colors.onPrimarySoft,
                modifier = Modifier.weight(1f),
            )
            if (items.size > 1) {
                Text(
                    text = waitingToggle(items.size, expanded),
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.primary,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
            }
        }
        vm.state.notice?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.critical,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        Column(
            modifier = Modifier
                .heightIn(max = 360.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            shown.forEachIndexed { index, w ->
                if (index > 0) {
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 60.dp),
                        color = colors.primary.copy(alpha = 0.2f),
                    )
                }
                WaitingRow(w, now, zone, vm, onOther = { otherId = it }, onParentMode = onParentMode)
            }
        }
    }
    if (other != null) {
        AmountDialog(other, vm) { otherId = null }
    }
}

/** One waiting item: its badge, words and buttons. */
@Composable
private fun WaitingRow(
    w: Waiting,
    now: Instant,
    zone: ZoneId,
    vm: InboxViewModel,
    onOther: (String) -> Unit,
    onParentMode: (Waiting.ParentMode) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val busy = vm.state.busy
    // A message or a parent-mode request has one button: it sits beside the words, to keep the strip short.
    val single = w is Waiting.Message || w is Waiting.ParentMode
    val colors = ScreenTimeTheme.colors
    Column(modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .background(MaterialTheme.colorScheme.surface, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(text = waitingBadge(w), fontSize = 16.sp)
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = waitingTitle(w),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                waitingDetail(w)?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    text = waitingMeta(w, now, zone),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.muted,
                )
            }
            if (single) {
                Spacer(Modifier.width(8.dp))
                when (w) {
                    is Waiting.ParentMode -> Button(onClick = { onParentMode(w) }, enabled = !busy) { Text("Answer") }
                    is Waiting.Message -> Button(onClick = { scope.launch { vm.seen(w) } }, enabled = !busy) { Text("Got it") }
                    else -> Unit
                }
            }
        }
        if (!single) {
            Spacer(Modifier.height(4.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                when (w) {
                    is Waiting.Time -> {
                        TextButton(onClick = { onOther(w.request.id) }, enabled = !busy) {
                            Text("Other amount")
                        }
                        OutlinedButton(onClick = { scope.launch { vm.deny(w.request) } }, enabled = !busy) {
                            Text("No")
                        }
                        Button(onClick = { scope.launch { vm.approve(w.request) } }, enabled = !busy) {
                            Text("Yes, ${formatDuration(w.request.minutes * 60L)}")
                        }
                    }
                    is Waiting.NewApp -> {
                        OutlinedButton(onClick = { scope.launch { vm.answerApp(w, AppRule.BLOCKED) } }, enabled = !busy) {
                            Text("Block")
                        }
                        Button(onClick = { scope.launch { vm.answerApp(w, AppRule.ALLOWED) } }, enabled = !busy) {
                            Text("Allow")
                        }
                    }
                    else -> Unit
                }
            }
        }
    }
}

/** The little picture in an item's badge, the same as the history's. */
private fun waitingBadge(w: Waiting): String = when (w) {
    is Waiting.Time -> "⏳"
    is Waiting.ParentMode -> "🔓"
    is Waiting.NewApp -> "📱"
    is Waiting.Message -> "💬"
}

/**
 * The amount dialog: give a kid a different amount of time than they asked for, counting for today only.
 */
@Composable
private fun AmountDialog(r: TimeRequest, vm: InboxViewModel, onDone: () -> Unit) {
    var minutes by remember { mutableStateOf(r.minutes.coerceIn(15, 480)) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        title = { Text("Give ${r.kidName} more ${poolName(r.pool)}") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "${r.kidName} asked for ${formatDuration(r.minutes * 60L)}. It counts for today only.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedIconButton(
                        onClick = { minutes = (minutes - 15).coerceAtLeast(15) },
                        enabled = minutes > 15 && !vm.state.busy,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(painterResource(R.drawable.ic_remove), contentDescription = "15 minutes less")
                    }
                    Text(
                        text = formatDuration(minutes * 60L),
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.widthIn(min = 120.dp),
                        textAlign = TextAlign.Center,
                    )
                    OutlinedIconButton(
                        onClick = { minutes = (minutes + 15).coerceAtMost(480) },
                        enabled = minutes < 480 && !vm.state.busy,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(painterResource(R.drawable.ic_add), contentDescription = "15 minutes more")
                    }
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(15, 30, 60, 120).forEach { q ->
                        FilterChip(
                            selected = minutes == q,
                            onClick = { minutes = q },
                            label = { Text(formatDuration(q * 60L)) },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onDone()
                    scope.launch { vm.approve(r, minutes) }
                },
            ) {
                Text("Give ${formatDuration(minutes * 60L)}")
            }
        },
        dismissButton = {
            TextButton(onClick = onDone) {
                Text("Cancel")
            }
        },
        onDismissRequest = onDone,
    )
}
