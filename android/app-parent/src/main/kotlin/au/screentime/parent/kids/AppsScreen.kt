package au.screentime.parent.kids

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
 * The Apps page (docs/SPEC.md §12.4, §16.4): what is on the kid's Android devices, what is new and what has been
 * used. Its data comes through [KidsViewModel.apps].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppsScreen(kid: Kid, vm: KidsViewModel, zone: ZoneId, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val scope = rememberCoroutineScope()
    var apps by remember { mutableStateOf<List<KidApp>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        vm.apps(kid.id).onSuccess {
            apps = sortApps(it)
            error = null
        }.onFailure { e ->
            error = actionError(e as Exception)
        }
    }

    LaunchedEffect(kid.id) { load() }

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
                    items(loaded, key = { it.packageName }) { app -> AppRow(app, zone) }
                }
            }
        }
    }
}

/** One app: a circle with its initial, its name, where it came from, first use, and today's time or "Removed". */
@Composable
private fun AppRow(app: KidApp, zone: ZoneId) {
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
    }
}
