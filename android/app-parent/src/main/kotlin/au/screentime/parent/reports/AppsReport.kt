package au.screentime.parent.reports

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.AppReport
import au.screentime.core.model.api.AppReportApp
import au.screentime.core.ui.ScreenTimeTheme
import java.time.ZoneId

/** The Apps report (docs/SPEC.md §12.9): screen time on top, then the apps, most used first. */
fun LazyListScope.appsReport(report: AppReport, shared: Boolean, zone: ZoneId, ui: ReportUi, dim: Modifier) {
    item(key = "screen-time") { ScreenTimeCard(report, shared, dim) }
    item(key = "apps") { AppsCard(report, zone, ui, dim) }
}

@Composable
private fun ScreenTimeCard(report: AppReport, shared: Boolean, modifier: Modifier) {
    val device = report.devices.firstOrNull { it.deviceId == report.deviceId }
    ReportCard(
        modifier = modifier,
        title = "Screen time",
        description = if (device != null) "Time this device was in use." else "Time in use, counted once when two devices were used together.",
    ) {
        if (report.screenTime.isEmpty()) {
            Text("No devices in this report.", style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.muted)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                for (p in report.screenTime) {
                    Column {
                        Text(screenTimeLabel(p.pool, shared, device), style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.muted)
                        Text(totalDuration(p.usedSec), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun AppsCard(report: AppReport, zone: ZoneId, ui: ReportUi, modifier: Modifier) {
    val split = splitOther(report.apps)
    val max = report.apps.firstOrNull()?.totalSec ?: 0
    ReportCard(
        modifier = modifier,
        title = "Apps",
        description = "Most used first. App time and screen time can differ a little: the Screen Time app counts only as screen time, and always-allowed apps only as app time.",
    ) {
        if (hasUnrecorded(report)) {
            Note("Apps on a PC aren't recorded yet.")
            Spacer(Modifier.height(8.dp))
        }
        if (report.apps.isEmpty()) {
            Text(
                "No apps used in this ${periodWord(report.period)}.",
                style = MaterialTheme.typography.bodyMedium,
                color = ScreenTimeTheme.colors.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
            )
            return@ReportCard
        }
        split.shown.forEachIndexed { i, app ->
            if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            AppRow(app, report, max, zone, small = false)
        }
        if (split.other.isNotEmpty()) {
            if (split.shown.isNotEmpty()) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            val count = split.other.size
            FoldRow(
                title = "Other",
                detail = "$count ${if (count == 1) "app" else "apps"} under a minute each",
                trailing = shortDuration(split.otherSec),
                open = ui.otherOpen,
                onToggle = { ui.otherOpen = !ui.otherOpen },
            )
            if (ui.otherOpen) {
                Column(modifier = Modifier.padding(start = 12.dp)) {
                    for (app in split.other) AppRow(app, report, max, zone, small = true)
                }
            }
        }
    }
}

@Composable
private fun AppRow(app: AppReportApp, report: AppReport, max: Int, zone: ZoneId, small: Boolean) {
    val split = deviceSplit(app, report)
    val removed = removedLine(app, zone)
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = if (small) 6.dp else 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                app.label,
                style = if (small) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(shortDuration(app.totalSec), style = MaterialTheme.typography.bodyMedium)
        }
        if (!small) {
            Spacer(Modifier.height(6.dp))
            Bar(barFraction(app.totalSec, max))
        }
        if (removed != null || split != null) {
            Spacer(Modifier.height(4.dp))
            val warning = ScreenTimeTheme.colors.warning
            Text(
                text = buildAnnotatedString {
                    if (removed != null) {
                        withStyle(SpanStyle(color = warning, fontWeight = FontWeight.Medium)) { append(removed) }
                        if (split != null) append(" · ")
                    }
                    if (split != null) append(split)
                },
                style = MaterialTheme.typography.bodySmall,
                color = ScreenTimeTheme.colors.muted,
            )
        }
    }
}
