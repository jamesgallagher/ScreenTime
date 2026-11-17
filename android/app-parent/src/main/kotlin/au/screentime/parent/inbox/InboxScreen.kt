package au.screentime.parent.inbox

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.TimeRequest
import au.screentime.core.time.formatDuration
import au.screentime.core.ui.AvatarColors
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.kids.AppRule
import au.screentime.parent.R
import au.screentime.parent.home.ScreenHeader
import au.screentime.parent.today.Problem
import au.screentime.parent.today.poolName
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.launch

/**
 * The Inbox screen (docs/SPEC.md §16.4): the family history. What waits for a parent is in the "Waiting for you"
 * strip at the top of every tab (WaitingStrip). The home screen polls the Inbox every 30 seconds, so this screen
 * has no loop of its own.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(vm: InboxViewModel, zone: ZoneId) {
    val state = vm.state
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { vm.load() }
    val now = Instant.now()
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader("Inbox")
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = { scope.launch { vm.load(pulled = true) } },
            modifier = Modifier.fillMaxSize(),
        ) {
            when {
                state.requests == null && state.error == null -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
                state.requests == null -> Problem(state.error!!) { scope.launch { vm.load(pulled = true) } }
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (state.error != null) {
                        item {
                            Text(
                                text = state.error,
                                style = MaterialTheme.typography.bodyMedium,
                                color = ScreenTimeTheme.colors.critical,
                            )
                        }
                    }
                    item {
                        Text(
                            text = "History",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onBackground,
                        )
                    }
                    if (state.events.isEmpty()) {
                        item {
                            Text(
                                text = "Nothing yet",
                                style = MaterialTheme.typography.bodyLarge,
                                color = ScreenTimeTheme.colors.muted,
                            )
                        }
                    } else {
                        for ((heading, events) in byDay(state.events, now, zone)) {
                            item(key = "day-$heading") {
                                Text(
                                    text = heading,
                                    modifier = Modifier.padding(start = 4.dp, top = 4.dp),
                                    style = MaterialTheme.typography.labelLarge,
                                    color = ScreenTimeTheme.colors.muted,
                                )
                            }
                            item(key = "events-$heading") {
                                Card(
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = MaterialTheme.shapes.medium,
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                    border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline),
                                ) {
                                    Column {
                                        events.forEachIndexed { index, e ->
                                            if (index > 0) {
                                                HorizontalDivider(
                                                    modifier = Modifier.padding(start = 64.dp),
                                                    color = ScreenTimeTheme.colors.outline,
                                                )
                                            }
                                            EventRow(e, zone)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One event row: the tone's badge, the line and its detail, and the time of day. */
@Composable
private fun EventRow(e: EventItem, zone: ZoneId) {
    val v = eventView(e, zone)
    val tint = dotColor(v.tone)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .background(tint.copy(alpha = 0.14f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = badge(v.tone), fontSize = 16.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = v.text,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            v.detail?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.muted,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text = timeOfDay(Instant.parse(e.at), zone),
            style = MaterialTheme.typography.bodySmall,
            color = ScreenTimeTheme.colors.muted,
        )
    }
}

/** The little picture in an event's badge. */
private fun badge(tone: EventTone): String = when (tone) {
    EventTone.SOS -> "\uD83C\uDD98"
    EventTone.ALERT -> "\u26A0\uFE0F"
    EventTone.REQUEST -> "\u23F3"
    EventTone.MESSAGE -> "\uD83D\uDCAC"
    EventTone.TIME -> "\u23F1\uFE0F"
    EventTone.INFO -> "\uD83D\uDCF1"
}

/** The colour of an event's dot, from its tone. */
@Composable
private fun dotColor(tone: EventTone): Color {
    val colors = ScreenTimeTheme.colors
    return when (tone) {
        EventTone.SOS -> colors.danger
        EventTone.ALERT -> colors.warning
        EventTone.REQUEST -> MaterialTheme.colorScheme.primary
        EventTone.MESSAGE -> AvatarColors[1]
        EventTone.TIME -> AvatarColors[3]
        EventTone.INFO -> colors.muted
    }
}
