package au.screentime.parent.reports

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.ReportPeriod
import au.screentime.core.model.api.SearchReport
import au.screentime.core.model.api.SearchReportItem
import au.screentime.core.ui.ScreenTimeTheme
import java.time.LocalDate
import java.time.ZoneId

/** The Searches report (docs/SPEC.md §12.12): every search sent, newest first, by day for a week or month. */
fun LazyListScope.searchesReport(report: SearchReport, zone: ZoneId, today: LocalDate, ui: ReportUi, dim: Modifier) {
    val (off, never) = notRecording(report)
    if (off.isNotEmpty()) {
        item(key = "searches-off") {
            Note(
                "Searches are off on ${namesList(off.map { it.name })}. Someone turned off Screen Time under Settings → Accessibility " +
                    "and it could not turn itself back on. Turn it on again there, or run the set-up step in the guide.",
                warning = true,
                modifier = dim,
            )
        }
    }
    if (never.isNotEmpty()) {
        item(key = "searches-never") {
            val one = never.size == 1
            Note(
                "${namesList(never.map { it.name })} ${if (one) "hasn't" else "haven't"} sent any searches yet. " +
                    "${if (one) "It needs" else "They need"} the latest Screen Time.",
                modifier = dim,
            )
        }
    }
    item(key = "search-totals") {
        val totals = searchTotals(report.searches)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = dim) {
            Stat("Searches", "${totals.searches}", Modifier.weight(1f))
            Stat("Different", "${totals.different}", Modifier.weight(1f))
            Stat("Private", "${totals.private}", Modifier.weight(1f), warning = totals.private > 0)
        }
    }
    item(key = "search-find") {
        ReportCard(
            modifier = dim,
            title = "Searches",
            description = "Only searches that were sent count, not words typed and deleted. Android: Chrome, the Google app and YouTube. PCs: Edge, Chrome, Brave and Firefox.",
        ) {
            if (report.searches.isEmpty()) {
                Text(
                    "No searches in this ${periodWord(report.period)}.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.muted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                )
            } else {
                OutlinedTextField(
                    value = ui.words,
                    onValueChange = { ui.words = it },
                    placeholder = { Text("Find a word") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
    if (report.searches.isEmpty()) return
    val shown = filterSearches(report.searches, ui.words)
    if (shown.isEmpty()) {
        item(key = "search-none") {
            Column(modifier = dim.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("No searches with “${ui.words.trim()}”.", style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.muted)
                TextButton(onClick = { ui.words = "" }) { Text("Show all searches") }
            }
        }
        return
    }
    val days = groupByDay(shown, zone, today)
    for (day in days) {
        item(key = "search-day-${day.date}") {
            ReportCard(
                modifier = dim,
                title = if (report.period != ReportPeriod.DAY) day.label else null,
                description = if (report.period != ReportPeriod.DAY) {
                    if (day.searches.size == 1) "1 search" else "${day.searches.size} searches"
                } else {
                    null
                },
            ) {
                day.searches.forEachIndexed { i, s ->
                    if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    SearchRow(s, report, zone)
                }
            }
        }
    }
}

@Composable
private fun SearchRow(item: SearchReportItem, report: SearchReport, zone: ZoneId) {
    val colors = ScreenTimeTheme.colors
    val device = searchDeviceName(item, report)
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.Top) {
        Column(modifier = Modifier.weight(1f)) {
            Text("“${item.query}”", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(
                listOfNotNull(whereLine(item), device, timeLine(item, zone)).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = colors.muted,
            )
        }
        if (item.count > 1) {
            Spacer(Modifier.width(8.dp))
            Box(Modifier.padding(top = 2.dp)) { Pill("×${item.count}", colors.surfaceVariant, MaterialTheme.colorScheme.onSurface) }
        }
        if (item.private == true) {
            Spacer(Modifier.width(8.dp))
            Box(Modifier.padding(top = 2.dp)) { Pill("Private", colors.warning.copy(alpha = 0.15f), colors.warning) }
        }
    }
}
