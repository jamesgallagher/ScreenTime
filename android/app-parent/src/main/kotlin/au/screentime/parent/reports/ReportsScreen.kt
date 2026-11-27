package au.screentime.parent.reports

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.Kid
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.SiteReportSite
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.R
import au.screentime.parent.home.ScreenHeader
import au.screentime.parent.kids.KidsViewModel
import au.screentime.parent.kids.formBadge
import au.screentime.parent.kids.isShared
import au.screentime.parent.today.Problem
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.launch

/** What the cards of one report remember while the parent looks at it (open folds, the category, the words). */
class ReportUi {
    var otherOpen by mutableStateOf(false)
    var behindOpen by mutableStateOf(false)
    var showAllSites by mutableStateOf(false)
    var filter by mutableStateOf<SiteFilter>(SiteFilter.All)
    var words by mutableStateOf("")
}

/**
 * The Reports tab (docs/SPEC.md §12.9, §12.10, §12.12, §16.4): Apps, Websites and Searches for a kid or shared
 * device, by day, week or month, on all devices or one, the same as the web app's Reports page.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen(vm: ReportsViewModel, kids: KidsViewModel, zone: ZoneId) {
    val state = vm.state
    val choice = state.choice
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    LaunchedEffect(Unit) { kids.load() }

    val list = kids.state.kids
    val kid = list?.let { all -> all.find { it.id == choice.kidId } ?: all.firstOrNull { !isShared(it) } ?: all.firstOrNull() }
    val today = LocalDate.now(zone)
    val date = choice.date?.takeIf { !it.isAfter(today) } ?: today
    val shared = kid != null && isShared(kid)
    val query = kid?.let { ReportQuery(choice.kind, it.id, if (shared) null else choice.deviceId, choice.period, date) }
    val first = remember { mutableStateOf(true) }
    LaunchedEffect(query) {
        if (query != null) {
            vm.show(query, force = first.value)
            first.value = false
        }
    }
    val ui = remember(choice.kind, kid?.id) { ReportUi() }
    var editing by remember { mutableStateOf<SiteReportSite?>(null) }
    fun go(next: ReportChoice) = vm.choose(next)

    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader("Reports", subtitle(choice.kind))
        when {
            list == null && kids.state.error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            list == null -> Problem(kids.state.error!!) { scope.launch { kids.load(pulled = true) } }
            kid == null || query == null -> NothingYet()
            else -> PullToRefreshBox(
                isRefreshing = state.refreshing,
                onRefresh = { vm.show(query, pulled = true) },
                modifier = Modifier.fillMaxSize(),
            ) {
                val shown = state.shown?.takeIf { it.query.kind == query.kind && it.query.kidId == query.kidId }
                val stale = shown != null && shown.query != query
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item(key = "kind") {
                        KindSwitch(choice.kind) { go(choice.copy(kind = it)) }
                    }
                    item(key = "kid") {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            KidPicker(list, kid, Modifier.weight(1f)) { go(choice.copy(kidId = it.id, deviceId = null)) }
                            Spacer(Modifier.width(8.dp))
                            PeriodSwitch(choice.period) { go(choice.copy(period = it)) }
                        }
                    }
                    item(key = "period") {
                        PeriodStepper(choice.period, date, today) { go(choice.copy(date = it)) }
                    }
                    if (shown != null && !shared) {
                        val chips = chipDevices(devicesOf(shown))
                        if (chips.isNotEmpty()) {
                            item(key = "devices") {
                                DeviceChips(chips, query.deviceId) { go(choice.copy(deviceId = it)) }
                            }
                        }
                    }
                    when {
                        shown == null && state.error != null -> item(key = "error") {
                            ErrorCard(state.error) { vm.show(query, force = true) }
                        }
                        shown == null -> item(key = "loading") {
                            Box(Modifier.fillMaxWidth().padding(top = 64.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator()
                            }
                        }
                        else -> {
                            if (state.error != null) {
                                item(key = "error-line") {
                                    Text(state.error, style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.critical)
                                }
                            }
                            val dim = Modifier.alpha(if (stale) 0.6f else 1f)
                            when (shown) {
                                is ReportData.Apps -> appsReport(shown.report, shared, zone, ui, dim)
                                is ReportData.Websites -> websitesReport(
                                    report = shown.report,
                                    zone = zone,
                                    ui = ui,
                                    dim = dim,
                                    onEdit = { editing = it },
                                    onSearches = { go(choice.copy(kind = ReportKind.SEARCHES)) },
                                )
                                is ReportData.Searches -> searchesReport(shown.report, zone, today, ui, dim)
                            }
                        }
                    }
                }
            }
        }
    }
    editing?.let { site -> SiteClassSheet(site, vm) { editing = null } }
}

private fun subtitle(kind: ReportKind): String = when (kind) {
    ReportKind.APPS -> "Which apps were used, and for how long."
    ReportKind.WEBSITES -> "Websites looked up, private windows too."
    ReportKind.SEARCHES -> "Every search sent, private windows too."
}

private fun devicesOf(data: ReportData): List<ChipDevice> = when (data) {
    is ReportData.Apps -> data.report.devices.map { ChipDevice(it.deviceId, it.name, it.form, it.removedAt != null) }
    is ReportData.Websites -> data.report.devices.map { ChipDevice(it.deviceId, it.name, it.form, it.removedAt != null) }
    is ReportData.Searches -> data.report.devices.map { ChipDevice(it.deviceId, it.name, it.form, it.removedAt != null) }
}

/** No kids or shared devices yet. */
@Composable
private fun NothingYet() {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(96.dp))
        Text("Nothing to report yet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        Text(
            text = "Add a kid and their devices first. Reports show which apps, websites and searches they use.",
            style = MaterialTheme.typography.bodyLarge,
            color = ScreenTimeTheme.colors.muted,
            textAlign = TextAlign.Center,
        )
    }
}

/** Apps · Websites · Searches: the same kid, device, period and date carry over. */
@Composable
private fun KindSwitch(kind: ReportKind, onChange: (ReportKind) -> Unit) {
    val kinds = ReportKind.entries
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        kinds.forEachIndexed { i, k ->
            SegmentedButton(
                selected = k == kind,
                onClick = { onChange(k) },
                shape = SegmentedButtonDefaults.itemShape(index = i, count = kinds.size),
            ) {
                Text(k.label)
            }
        }
    }
}

/** Day · Week · Month, with no tick so the three fit beside the kid. */
@Composable
private fun PeriodSwitch(period: ReportPeriod, onChange: (ReportPeriod) -> Unit) {
    val periods = ReportPeriod.entries
    SingleChoiceSegmentedButtonRow {
        periods.forEachIndexed { i, p ->
            SegmentedButton(
                selected = p == period,
                onClick = { onChange(p) },
                shape = SegmentedButtonDefaults.itemShape(index = i, count = periods.size),
                icon = {},
            ) {
                Text(periodName(p), maxLines = 1)
            }
        }
    }
}

/** The kid or shared device: a button with the name, and a menu with the kids, then the shared devices. */
@Composable
private fun KidPicker(kids: List<Kid>, kid: Kid, modifier: Modifier, onPick: (Kid) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedButton(
            onClick = { open = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp),
            contentPadding = PaddingValues(horizontal = 12.dp),
        ) {
            Text(kid.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(" ▾", color = ScreenTimeTheme.colors.muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            val people = kids.filterNot { isShared(it) }
            val shared = kids.filter { isShared(it) }
            if (people.isNotEmpty() && shared.isNotEmpty()) MenuHeading("Kids")
            for (k in people) {
                DropdownMenuItem(text = { Text(k.name) }, onClick = { open = false; onPick(k) })
            }
            if (shared.isNotEmpty()) MenuHeading("Shared devices")
            for (k in shared) {
                DropdownMenuItem(text = { Text(k.name) }, onClick = { open = false; onPick(k) })
            }
        }
    }
}

@Composable
private fun MenuHeading(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = ScreenTimeTheme.colors.muted,
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
    )
}

/** ‹ the period › and, when it is not the current one, the jump back to it. */
@Composable
private fun PeriodStepper(period: ReportPeriod, date: LocalDate, today: LocalDate, onDate: (LocalDate) -> Unit) {
    val current = isCurrentPeriod(period, date, today)
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { onDate(shiftPeriod(period, date, -1)) }) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = "Before")
            }
            Column(modifier = Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(periodLabel(period, date, today), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(periodDates(period, date), style = MaterialTheme.typography.bodySmall, color = ScreenTimeTheme.colors.muted)
            }
            IconButton(onClick = { onDate(shiftPeriod(period, date, 1)) }, enabled = !current) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = "After", modifier = Modifier.rotate(180f))
            }
        }
        if (!current) {
            TextButton(onClick = { onDate(today) }) { Text(currentLabel(period)) }
        }
    }
}

/** All devices, then one chip per device (a removed one says so). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeviceChips(devices: List<ChipDevice>, deviceId: String?, onChange: (String?) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            FilterChip(selected = deviceId == null, onClick = { onChange(null) }, label = { Text("All devices") })
        }
        items(devices, key = { it.deviceId }) { d ->
            FilterChip(
                selected = deviceId == d.deviceId,
                onClick = { onChange(d.deviceId) },
                label = { Text(if (d.removed) "${d.name} · removed" else d.name) },
                leadingIcon = { Text(formBadge(d.form)) },
            )
        }
    }
}

@Composable
private fun ErrorCard(text: String, onRetry: () -> Unit) {
    ReportCard {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.critical, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            OutlinedButton(onClick = onRetry) { Text("Try again") }
        }
    }
}

// ---- Pieces the three reports share. ----

/** A report card: the outlined surface of the other tabs, with an optional title and line under it. */
@Composable
fun ReportCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    description: String? = null,
    borderColor: Color? = null,
    action: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .border(1.dp, borderColor ?: MaterialTheme.colorScheme.outline, MaterialTheme.shapes.medium),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            if (title != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    action?.invoke()
                }
            }
            if (description != null) {
                Text(description, style = MaterialTheme.typography.bodySmall, color = ScreenTimeTheme.colors.muted, modifier = Modifier.padding(top = 2.dp))
            }
            if (title != null || description != null) Spacer(Modifier.height(12.dp))
            content()
        }
    }
}

/** A line on a soft background above the cards: a device not sending yet (muted), or turned off (warning). */
@Composable
fun Note(text: String, warning: Boolean = false, modifier: Modifier = Modifier) {
    val colors = ScreenTimeTheme.colors
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (warning) MaterialTheme.colorScheme.onSurface else colors.muted,
        modifier = modifier
            .fillMaxWidth()
            .background(if (warning) colors.warning.copy(alpha = 0.15f) else colors.surfaceVariant, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
}

/** A bar against the longest row. */
@Composable
fun Bar(fraction: Float, color: Color = MaterialTheme.colorScheme.primary, height: Int = 8) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(height.dp)
            .background(ScreenTimeTheme.colors.surfaceVariant, RoundedCornerShape(50)),
    ) {
        if (fraction > 0f) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(height.dp)
                    .background(color, RoundedCornerShape(50)),
            )
        }
    }
}

/** A number in a soft tile: "Searches 12". */
@Composable
fun Stat(label: String, value: String, modifier: Modifier = Modifier, warning: Boolean = false) {
    val colors = ScreenTimeTheme.colors
    Column(
        modifier = modifier
            .background(if (warning) colors.warning.copy(alpha = 0.15f) else colors.surfaceVariant, RoundedCornerShape(16.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            value,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            color = if (warning) colors.warning else MaterialTheme.colorScheme.onSurface,
        )
    }
}

/** A small rounded label: "Private", "×3", "Games". */
@Composable
fun Pill(text: String, background: Color, color: Color) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Medium,
        color = color,
        maxLines = 1,
        modifier = Modifier
            .background(background, RoundedCornerShape(50))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** The fold-out row at the bottom of a list: "Other · 3 apps under a minute each". */
@Composable
fun FoldRow(title: String, detail: String, trailing: String?, open: Boolean, onToggle: () -> Unit) {
    TextButton(
        onClick = onToggle,
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = ScreenTimeTheme.colors.muted)
        }
        if (trailing != null) {
            Text(trailing, style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.muted)
            Spacer(Modifier.size(8.dp))
        }
        Text(if (open) "▴" else "▾", color = ScreenTimeTheme.colors.muted)
    }
}
