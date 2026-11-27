package au.screentime.parent.reports

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.SiteCategory
import au.screentime.core.model.api.SiteClassOverride
import au.screentime.core.model.api.SiteClassSource
import au.screentime.core.model.api.SiteReportSite
import au.screentime.core.ui.ScreenTimeTheme
import kotlinx.coroutines.launch

/**
 * A parent sets what a site is for the whole family (docs/SPEC.md §12.10), or goes back to the automatic sorting:
 * the web app's "Change what this site is" dialog as a bottom sheet.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SiteClassSheet(site: SiteReportSite, vm: ReportsViewModel, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var kind by remember(site.site) { mutableStateOf(startKind(site.kind)) }
    var category by remember(site.site) { mutableStateOf(site.category ?: SiteCategory.OTHER) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun run(block: suspend () -> String?) {
        busy = true
        error = null
        scope.launch {
            val result = block()
            busy = false
            if (result == null) onDone() else error = result
        }
    }
    ModalBottomSheet(onDismissRequest = onDone, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .navigationBarsPadding()
                .padding(bottom = 16.dp),
        ) {
            Text(siteName(site), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                (if (site.label != null) "${site.site}. " else "") + "Set what this site is for the whole family. The automatic sorting never changes it back.",
                style = MaterialTheme.typography.bodyMedium,
                color = ScreenTimeTheme.colors.muted,
            )
            Spacer(Modifier.height(16.dp))
            Text("What is it?", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            for ((k, label) in PICKABLE_KINDS) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .selectable(selected = kind == k, role = Role.RadioButton, onClick = { kind = k }),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = kind == k, onClick = null)
                    Spacer(Modifier.size(8.dp))
                    Text(label, style = MaterialTheme.typography.bodyLarge)
                }
            }
            Spacer(Modifier.height(12.dp))
            Text("Category", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (c in SiteCategory.entries) {
                    FilterChip(selected = category == c, onClick = { category = c }, label = { Text(categoryLabel(c)) })
                }
            }
            if (error != null) {
                Spacer(Modifier.height(8.dp))
                Text(error!!, style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.critical)
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { run { vm.setSiteClass(site.site, SiteClassOverride(kind = kind, category = category)) } },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                if (busy) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Save")
            }
            if (site.source == SiteClassSource.PARENT) {
                TextButton(
                    onClick = { run { vm.clearSiteClass(site.site) } },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Text("Go back to automatic")
                }
            }
        }
    }
}
