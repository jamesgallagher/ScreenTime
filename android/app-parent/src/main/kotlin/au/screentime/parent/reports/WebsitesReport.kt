package au.screentime.parent.reports

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.SiteClassSource
import au.screentime.core.model.api.SiteKind
import au.screentime.core.model.api.SiteReport
import au.screentime.core.model.api.SiteReportSite
import au.screentime.core.ui.ScreenTimeTheme
import java.time.LocalDate
import java.time.ZoneId

/**
 * The Websites report (docs/SPEC.md §12.10): sites worth a look, the categories, the websites by active time, the
 * sites behind the scenes, and on PCs the browser time, private windows and pages.
 */
fun LazyListScope.websitesReport(
    report: SiteReport,
    zone: ZoneId,
    ui: ReportUi,
    dim: Modifier,
    onEdit: (SiteReportSite) -> Unit,
    onSearches: () -> Unit,
) {
    val missing = notRecorded(report)
    if (missing.isNotEmpty()) {
        item(key = "sites-missing") {
            val verb = if (missing.size == 1) "hasn't" else "haven't"
            Note("${namesList(missing.map { it.name })} $verb sent any websites yet. A PC needs the latest Screen Time.", modifier = dim)
        }
    }
    val worth = report.sites.filter { isWorthALook(it.category) }
    if (worth.isNotEmpty()) {
        item(key = "worth") { WorthALookCard(worth, dim) { ui.filter = SiteFilter.Category(it.category); ui.showAllSites = false } }
    }
    if (report.categories.isNotEmpty()) {
        item(key = "categories") { CategoriesCard(report, ui, dim) }
    }
    item(key = "sites") { SitesCard(report, zone, ui, dim, onEdit) }
    if (report.behindTheScenes.isNotEmpty()) {
        item(key = "behind") { BehindCard(report, zone, ui, dim, onEdit) }
    }
    if (hasPc(report)) {
        item(key = "pc") { PcCard(report, dim, onSearches) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WorthALookCard(sites: List<SiteReportSite>, modifier: Modifier, onPick: (SiteReportSite) -> Unit) {
    val danger = ScreenTimeTheme.colors.danger
    ReportCard(modifier = modifier, borderColor = danger.copy(alpha = 0.5f)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("⚠", color = danger)
            Spacer(Modifier.width(8.dp))
            Text(
                if (sites.size == 1) "1 site worth a look" else "${sites.size} sites worth a look",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (s in sites) {
                Text(
                    text = "${siteName(s)} · ${categoryLabel(s.category)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = danger,
                    modifier = Modifier
                        .background(danger.copy(alpha = 0.12f), RoundedCornerShape(50))
                        .clickable { onPick(s) }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun CategoriesCard(report: SiteReport, ui: ReportUi, modifier: Modifier) {
    val max = report.categories.firstOrNull()?.minutes ?: 0
    val colors = ScreenTimeTheme.colors
    ReportCard(modifier = modifier, title = "Categories", description = "Active time on websites, by category. Tap one to see its sites.") {
        for (c in report.categories) {
            val filter = SiteFilter.Category(c.category)
            val selected = ui.filter == filter
            val flagged = isWorthALook(c.category)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (selected) colors.primarySoft else Color.Transparent, RoundedCornerShape(12.dp))
                    .clickable {
                        ui.filter = if (selected) SiteFilter.All else filter
                        ui.showAllSites = false
                    }
                    .padding(horizontal = 8.dp, vertical = 8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        categoryLabel(c.category),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = when {
                            flagged -> colors.danger
                            c.category == null -> colors.muted
                            else -> MaterialTheme.colorScheme.onSurface
                        },
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        if (c.sites == 1) "1 site" else "${c.sites} sites",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.muted,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(activeTime(c.minutes), style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(4.dp))
                Bar(
                    barFraction(c.minutes, max),
                    color = when {
                        flagged -> colors.danger
                        c.category == null -> colors.muted
                        else -> MaterialTheme.colorScheme.primary
                    },
                    height = 6,
                )
            }
        }
    }
}

@Composable
private fun SitesCard(report: SiteReport, zone: ZoneId, ui: ReportUi, modifier: Modifier, onEdit: (SiteReportSite) -> Unit) {
    val filter = ui.filter
    val sites = filterSites(report.sites, filter)
    val shown = if (ui.showAllSites) sites else sites.take(SITES_SHOWN)
    val max = sites.firstOrNull()?.minutes ?: 0
    ReportCard(
        modifier = modifier,
        title = if (filter is SiteFilter.Category) "Websites: ${categoryLabel(filter.category)}" else "Websites",
        description = "Seen on the device, not necessarily opened: a page can bring in other sites. Active time counts the minutes in which a site was looked up.",
        action = if (filter is SiteFilter.Category) {
            { TextButton(onClick = { ui.filter = SiteFilter.All; ui.showAllSites = false }) { Text("Show all") } }
        } else {
            null
        },
    ) {
        if (sites.isEmpty()) {
            Text(
                "No websites in this ${periodWord(report.period)}.",
                style = MaterialTheme.typography.bodyMedium,
                color = ScreenTimeTheme.colors.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
            )
            return@ReportCard
        }
        shown.forEachIndexed { i, s ->
            if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            SiteRow(s, report, max, zone, small = false, onEdit = onEdit)
        }
        if (!ui.showAllSites && sites.size > SITES_SHOWN) {
            Spacer(Modifier.height(8.dp))
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                OutlinedButton(onClick = { ui.showAllSites = true }) { Text("Show all ${sites.size} sites") }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
private fun SiteRow(site: SiteReportSite, report: SiteReport, max: Int, zone: ZoneId, small: Boolean, onEdit: (SiteReportSite) -> Unit) {
    val colors = ScreenTimeTheme.colors
    val flagged = isWorthALook(site.category)
    val split = siteDeviceSplit(site, report)
    val source = sourceLine(site)
    val owner = ownerLine(site)
    val name = siteName(site)
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = if (small) 6.dp else 10.dp)) {
        if (!small) {
            Box(
                modifier = Modifier
                    .padding(top = 2.dp)
                    .size(36.dp)
                    .background(if (flagged) colors.danger.copy(alpha = 0.15f) else colors.surfaceVariant, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(siteInitial(site), fontWeight = FontWeight.SemiBold, color = if (flagged) colors.danger else colors.muted)
            }
            Spacer(Modifier.width(12.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (site.label != null) {
                        Text(site.site, style = MaterialTheme.typography.bodySmall, color = colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                Text(activeTime(site.minutes), style = MaterialTheme.typography.bodyMedium)
            }
            if (!small) {
                Spacer(Modifier.height(6.dp))
                Bar(barFraction(site.minutes, max), color = if (flagged) colors.danger else MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.height(6.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val label = if (small) kindLabel(site.kind) else if (site.kind == SiteKind.UNKNOWN) "Unknown" else categoryLabel(site.category)
                when {
                    flagged -> Pill(label, colors.danger.copy(alpha = 0.15f), colors.danger)
                    site.kind == null -> Pill(label, colors.surfaceVariant, colors.muted)
                    else -> Pill(label, colors.surfaceVariant, MaterialTheme.colorScheme.onSurface)
                }
                val meta = listOfNotNull(owner, appsLine(site), whenLine(site, report.period, zone), split).joinToString(" · ")
                Text(meta, style = MaterialTheme.typography.bodySmall, color = colors.muted)
            }
            if (source != null) {
                Text(
                    source,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (site.source == SiteClassSource.FAMILY_DNS) FontWeight.Medium else FontWeight.Normal,
                    color = if (site.source == SiteClassSource.FAMILY_DNS) colors.danger else colors.muted,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        IconButton(onClick = { onEdit(site) }, modifier = Modifier.semantics { contentDescription = "Change what $name is" }) {
            Text("⋮", style = MaterialTheme.typography.titleLarge, color = colors.muted)
        }
    }
}

@Composable
private fun BehindCard(report: SiteReport, zone: ZoneId, ui: ReportUi, modifier: Modifier, onEdit: (SiteReportSite) -> Unit) {
    val sites = report.behindTheScenes
    val max = sites.firstOrNull()?.minutes ?: 0
    ReportCard(modifier = modifier) {
        FoldRow(
            title = "Behind the scenes",
            detail = "${sites.size} ${if (sites.size == 1) "site" else "sites"} that serve files, ads or apps for other sites. Nobody opens these.",
            trailing = null,
            open = ui.behindOpen,
            onToggle = { ui.behindOpen = !ui.behindOpen },
        )
        if (ui.behindOpen) {
            sites.forEachIndexed { i, s ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                SiteRow(s, report, max, zone, small = true, onEdit = onEdit)
            }
        }
    }
}

@Composable
private fun PcCard(report: SiteReport, modifier: Modifier, onSearches: () -> Unit) {
    val colors = ScreenTimeTheme.colors
    ReportCard(
        modifier = modifier,
        title = "On PCs",
        description = "Read from the browser window in front (Edge, Chrome, Brave, Firefox). Pages are kept for 90 days.",
    ) {
        if (titlesCut(report)) {
            Note("Pages before ${dayLabel(LocalDate.parse(report.titlesKeptFrom))} are no longer kept.")
            Spacer(Modifier.height(12.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Stat("In a browser", totalDuration(report.browserSec), Modifier.weight(1f))
            Stat("Private windows", totalDuration(report.privateSec), Modifier.weight(1f), warning = report.privateSec > 0)
        }
        TextButton(onClick = onSearches, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
            Text("Searches are on the Searches tab ›")
        }
        Text("Pages", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        if (report.pages.isEmpty()) {
            Text("No pages seen.", style = MaterialTheme.typography.bodyMedium, color = colors.muted)
        } else {
            report.pages.forEachIndexed { i, p ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(p.page, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(browserLabel(p.`package`), style = MaterialTheme.typography.bodySmall, color = colors.muted)
                    }
                    if (p.private) {
                        Spacer(Modifier.width(8.dp))
                        Pill("Private", colors.warning.copy(alpha = 0.15f), colors.warning)
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(shortDuration(p.sec), style = MaterialTheme.typography.bodyMedium, color = colors.muted)
                }
            }
        }
    }
}
