package au.screentime.parent.kids

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.Kid
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.R
import au.screentime.parent.today.Problem
import au.screentime.parent.today.initial
import java.time.ZoneId
import kotlinx.coroutines.launch

/**
 * The Apps page (docs/SPEC.md §12.4, §16.4): what is on the kid's Android devices, what is new, what has been used
 * and what is blocked. Its data comes through [KidsViewModel.apps].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppsScreen(kid: Kid, vm: KidsViewModel, zone: ZoneId, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val scope = rememberCoroutineScope()
    var apps by remember { mutableStateOf<List<KidApp>?>(null) }
    var approval by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        vm.apps(kid.id).onSuccess {
            apps = sortApps(it.apps)
            approval = it.newAppApproval
            error = null
        }.onFailure { e ->
            error = actionError(e as Exception)
        }
    }

    LaunchedEffect(kid.id) { load() }

    fun change(call: suspend () -> Result<Unit>) {
        scope.launch {
            busy = true
            call().onFailure { e -> error = actionError(e as Exception) }
            load()
            busy = false
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 16.dp, top = 16.dp, bottom = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = "Back")
            }
            Spacer(Modifier.size(4.dp))
            Text(
                text = "${kid.name}'s apps",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        val loaded = apps
        when {
            loaded == null && error != null -> Problem(error!!) { scope.launch { load() } }
            loaded == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            else -> PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        load()
                        refreshing = false
                    }
                },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (error != null) {
                        item {
                            Text(
                                text = error!!,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                    item {
                        ApprovalCard(kid, approval, !busy) { on -> change { vm.saveNewAppApproval(kid.id, on) } }
                    }
                    if (loaded.isEmpty()) {
                        item {
                            Text(
                                text = "No apps yet. They show up after ${kid.name}'s device next connects.",
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 48.dp),
                                style = MaterialTheme.typography.bodyLarge,
                                color = ScreenTimeTheme.colors.muted,
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                    items(loaded, key = { it.packageName }) { app ->
                        AppRow(
                            app,
                            zone,
                            !busy,
                            onAlwaysAllowed = { deviceId, on -> change { vm.saveAlwaysAllowed(deviceId, app.packageName, on) } },
                        ) { rule, minutes -> change { vm.saveAppRule(kid.id, app.packageName, rule, minutes) } }
                    }
                    if (loaded.isNotEmpty()) {
                        item {
                            Text(
                                text = "Blocking an app does not block its website. To stop YouTube in a browser, block the browsers too.",
                                modifier = Modifier.padding(top = 8.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = ScreenTimeTheme.colors.muted,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** The "New apps need approval" switch. */
@Composable
private fun ApprovalCard(kid: Kid, on: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "New apps need approval",
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "A new app on ${kid.name}'s device stays blocked until a parent says yes.",
                    style = MaterialTheme.typography.bodySmall,
                    color = ScreenTimeTheme.colors.muted,
                )
            }
            Spacer(Modifier.size(12.dp))
            Switch(checked = on, onCheckedChange = onChange, enabled = enabled)
        }
    }
}

/** What a parent can do about one app: nothing, answer a waiting app, or choose Allowed, Blocked or Limit. */
@Composable
private fun RuleControl(app: KidApp, enabled: Boolean, onRule: (AppRule, Int?) -> Unit) {
    when (val choice = appChoice(app)) {
        AppChoice.FIXED -> Text(
            text = "Part of the device: never blocked",
            style = MaterialTheme.typography.bodySmall,
            color = ScreenTimeTheme.colors.muted,
        )
        AppChoice.WAITING -> Column {
            Text(
                text = "Waiting for you",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onRule(AppRule.BLOCKED, null) }, enabled = enabled) { Text("Block") }
                Button(onClick = { onRule(AppRule.ALLOWED, null) }, enabled = enabled) { Text("Allow") }
            }
        }
        else -> Column {
            val count = 3
            val minutes = app.dailyMinutes ?: DEFAULT_LIMIT_MINUTES
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = choice == AppChoice.ALLOWED,
                    onClick = { if (choice != AppChoice.ALLOWED) onRule(AppRule.ALLOWED, null) },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = count),
                    enabled = enabled,
                    label = { Text("Allowed") },
                )
                SegmentedButton(
                    selected = choice == AppChoice.BLOCKED,
                    onClick = { if (choice != AppChoice.BLOCKED) onRule(AppRule.BLOCKED, null) },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = count),
                    enabled = enabled,
                    label = { Text("Blocked") },
                )
                SegmentedButton(
                    selected = choice == AppChoice.LIMIT,
                    onClick = { if (choice != AppChoice.LIMIT) onRule(AppRule.LIMIT, minutes) },
                    shape = SegmentedButtonDefaults.itemShape(index = 2, count = count),
                    enabled = enabled,
                    label = { Text("Limit") },
                )
            }
            if (choice == AppChoice.LIMIT) {
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(onClick = { onRule(AppRule.LIMIT, stepLimit(minutes, up = false)) }, enabled = enabled && minutes > 5) {
                        Text("−")
                    }
                    Text(
                        text = "$minutes min a day",
                        modifier = Modifier.padding(horizontal = 16.dp),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    OutlinedButton(onClick = { onRule(AppRule.LIMIT, stepLimit(minutes, up = true)) }, enabled = enabled && minutes < 480) {
                        Text("+")
                    }
                }
            }
        }
    }
}

/**
 * "Also when time is up, on" with one chip per device (docs/SPEC.md §12.4, §16.4): an always-allowed app still runs
 * there once the kid's time is used up, but not from bedtime to wake-up, and its time never counts.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AlwaysAllowedControl(app: KidApp, enabled: Boolean, onChange: (deviceId: String, on: Boolean) -> Unit) {
    val devices = alwaysAllowedDevices(app)
    if (devices.isEmpty()) return
    Spacer(Modifier.height(8.dp))
    Text(
        text = "Also when time is up, on",
        style = MaterialTheme.typography.bodySmall,
        color = ScreenTimeTheme.colors.muted,
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (d in devices) {
            FilterChip(
                selected = d.alwaysAllowed,
                onClick = { onChange(d.deviceId, !d.alwaysAllowed) },
                enabled = enabled,
                label = { Text(d.deviceName) },
            )
        }
    }
    if (devices.any { it.alwaysAllowed }) {
        Text(
            text = "Not from bedtime to wake-up. Time in it doesn't count.",
            style = MaterialTheme.typography.bodySmall,
            color = ScreenTimeTheme.colors.muted,
        )
    }
}

/** One app: a circle with its initial, its name, where it came from, first use, today's time or "Removed", and its rule. */
@Composable
private fun AppRow(
    app: KidApp,
    zone: ZoneId,
    enabled: Boolean,
    onAlwaysAllowed: (deviceId: String, on: Boolean) -> Unit,
    onRule: (AppRule, Int?) -> Unit,
) {
    val removed = isRemoved(app)
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = initial(app.label),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = ScreenTimeTheme.colors.muted,
                )
            }
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = app.label,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = if (removed) ScreenTimeTheme.colors.muted else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = installedLine(app, zone),
                    style = MaterialTheme.typography.bodySmall,
                    color = ScreenTimeTheme.colors.muted,
                )
                Text(
                    text = firstUsedLine(app, zone),
                    style = MaterialTheme.typography.bodySmall,
                    color = ScreenTimeTheme.colors.muted,
                )
            }
            val side = if (removed) "Removed" else todayLine(app)
            if (side != null) {
                Spacer(Modifier.size(8.dp))
                Text(
                    text = side,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (removed) ScreenTimeTheme.colors.muted else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        if (!removed) {
            Column(modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
                RuleControl(app, enabled, onRule)
                AlwaysAllowedControl(app, enabled, onAlwaysAllowed)
            }
        }
    }
}
