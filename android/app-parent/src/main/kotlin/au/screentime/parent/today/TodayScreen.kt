package au.screentime.parent.today

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.repeatOnLifecycle
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TodayKid
import au.screentime.core.model.api.TodayPool
import au.screentime.core.ui.AvatarColors
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.home.ScreenHeader
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The Today screen (docs/SPEC.md §16.4): one card per kid, refreshed every 30 seconds; the ± button opens the adjust sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(vm: TodayViewModel) {
    val state = vm.state
    val scope = rememberCoroutineScope()
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while (true) {
                vm.load()
                delay(REFRESH_MS)
            }
        }
    }
    // The kid and pool the adjust sheet is open for.
    var adjusting by remember { mutableStateOf<Pair<String, Pool>?>(null) }
    val adjustingKid = adjusting?.let { (kidId, pool) ->
        state.today?.kids?.find { it.id == kidId }?.let { it to pool }
    }
    if (adjusting != null && adjustingKid == null) adjusting = null
    val now = Instant.now()
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader("Today", state.today?.let { dayTitle(it.date) })
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = { scope.launch { vm.load(pulled = true) } },
            modifier = Modifier.fillMaxSize(),
        ) {
            when (val today = state.today) {
                null -> if (state.error != null) {
                    Problem(state.error) { scope.launch { vm.load(pulled = true) } }
                } else {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
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
                    if (today.kids.isEmpty()) {
                        item {
                            Text(
                                text = "No kids yet. Add them in the Screen Time web app.",
                                style = MaterialTheme.typography.bodyLarge,
                                color = ScreenTimeTheme.colors.muted,
                            )
                        }
                    }
                    items(today.kids, key = { it.id }) { kid ->
                        KidCard(kid, now) { adjusting = kid.id to it.pool }
                    }
                }
            }
        }
    }
    if (adjustingKid != null) {
        AdjustSheet(adjustingKid.first, adjustingKid.second, vm) { adjusting = null }
    }
}

/** A kid card: the avatar and name, each pool's row, and the chips. */
@Composable
private fun KidCard(kid: TodayKid, now: Instant, onAdjust: (TodayPool) -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.medium),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(kid)
                Spacer(Modifier.size(12.dp))
                Text(
                    text = kid.name,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            for (pool in kid.pools) {
                Spacer(Modifier.height(16.dp))
                PoolRow(kid, pool) { onAdjust(pool) }
            }
            val chips = kidChips(kid, now)
            if (chips.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    chips.forEach { ChipView(it) }
                }
            }
        }
    }
}

/** The kid's avatar: a 40 dp circle in the kid's colour with the initial. */
@Composable
private fun Avatar(kid: TodayKid) {
    val color = AvatarColors.getOrElse(kid.avatarColor.ordinal) { AvatarColors[0] }
    Box(
        modifier = Modifier
            .size(40.dp)
            .background(color, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initial(kid.name),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = Color.White,
        )
    }
}

/** A pool row: the name and status with the ± button, the bar, and the detail. */
@Composable
private fun PoolRow(kid: TodayKid, pool: TodayPool, onAdjust: () -> Unit) {
    val view = poolView(pool)
    val toneColor = toneColor(view.tone)
    Column {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = view.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = view.status,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = toneColor,
            )
            Spacer(Modifier.width(8.dp))
            OutlinedIconButton(
                onClick = onAdjust,
                modifier = Modifier
                    .size(36.dp)
                    .semantics { contentDescription = "Change ${kid.name}'s ${poolName(pool.pool)}" },
            ) {
                Text(
                    text = "±",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
        ) {
            if (view.fraction > 0) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(view.fraction)
                        .fillMaxSize()
                        .background(toneColor, CircleShape),
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            text = view.detail,
            style = MaterialTheme.typography.bodySmall,
            color = ScreenTimeTheme.colors.muted,
        )
    }
}

/** A chip under a kid card. */
@Composable
private fun ChipView(chip: Chip) {
    val (textColor, background) = when (chip.tone) {
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.onSurface to MaterialTheme.colorScheme.surfaceVariant
        ChipTone.PRIMARY -> MaterialTheme.colorScheme.primary to MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
        ChipTone.WARNING -> ScreenTimeTheme.colors.warning to ScreenTimeTheme.colors.warning.copy(alpha = 0.15f)
    }
    Text(
        text = chip.text,
        style = MaterialTheme.typography.labelMedium,
        color = textColor,
        modifier = Modifier
            .background(background, RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/** The colour of a pool's bar and "left" text. */
@Composable
private fun toneColor(tone: Tone): Color {
    val colors = ScreenTimeTheme.colors
    val scheme = MaterialTheme.colorScheme
    return when (tone) {
        Tone.OK -> scheme.primary
        Tone.WARNING -> colors.warning
        Tone.CRITICAL -> colors.critical
        Tone.LOCKED -> colors.muted
    }
}

/** The "no answer yet and an error" state: a centred, scrollable column with a Try again button. */
@Composable
fun Problem(text: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(96.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            color = ScreenTimeTheme.colors.muted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        FilledTonalButton(onClick = onRetry) {
            Text("Try again")
        }
    }
}
