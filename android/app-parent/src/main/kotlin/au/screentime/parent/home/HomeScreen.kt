package au.screentime.parent.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Badge
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.repeatOnLifecycle
import au.screentime.core.model.api.Me
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.R
import au.screentime.parent.inbox.InboxScreen
import au.screentime.parent.inbox.InboxViewModel
import au.screentime.parent.today.REFRESH_MS
import au.screentime.parent.today.TodayScreen
import au.screentime.parent.today.TodayViewModel
import java.time.ZoneId
import kotlinx.coroutines.delay

/** The four tabs of the parent app (docs/SPEC.md §16.4). */
enum class Tab(val label: String, val icon: Int) {
    TODAY("Today", R.drawable.ic_today),
    INBOX("Inbox", R.drawable.ic_inbox),
    KIDS("Kids", R.drawable.ic_kids),
    SETTINGS("Settings", R.drawable.ic_settings),
}

/** The home screen: the four tabs and the bottom navigation (docs/SPEC.md §16.4). */
@Composable
fun HomeScreen(me: Me, today: TodayViewModel, inbox: InboxViewModel, secure: Boolean, onSignOut: () -> Unit) {
    // Poll the Inbox on every tab, so the badge on the Inbox icon is right.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while (true) {
                inbox.load()
                delay(REFRESH_MS)
            }
        }
    }
    var tab by rememberSaveable { mutableStateOf(Tab.TODAY) }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                for (t in Tab.values()) {
                    NavigationBarItem(
                        selected = tab == t,
                        onClick = { tab = t },
                        icon = {
                            if (t == Tab.INBOX) {
                                BadgedBox(badge = { if (inbox.pending > 0) Badge { Text("${inbox.pending}") } }) {
                                    Icon(painterResource(t.icon), contentDescription = null)
                                }
                            } else {
                                Icon(painterResource(t.icon), contentDescription = null)
                            }
                        },
                        label = { Text(t.label) },
                    )
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.padding(padding)) {
            when (tab) {
                Tab.TODAY -> TodayScreen(today)
                Tab.INBOX -> InboxScreen(inbox, runCatching { ZoneId.of(me.family!!.timezone) }.getOrElse { ZoneId.systemDefault() })
                Tab.KIDS -> ComingSoonPage("Kids", "Schedules, devices and contacts will show here. Use the web app for now.")
                Tab.SETTINGS -> SettingsScreen(me, secure, onSignOut)
            }
        }
    }
}

/** The title of a tab. */
@Composable
fun ScreenHeader(title: String, subtitle: String? = null) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 16.dp),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        if (subtitle != null) {
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyLarge,
                color = ScreenTimeTheme.colors.muted,
            )
        }
    }
}

/** A coming-soon page: the title and a line of what will come. */
@Composable
private fun ComingSoonPage(title: String, line: String) {
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader(title)
        Text(
            text = line,
            style = MaterialTheme.typography.bodyLarge,
            color = ScreenTimeTheme.colors.muted,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

/** For a sign-in that has no family (the super admin only, docs/SPEC.md §6.2). */
@Composable
fun NoFamilyScreen(me: Me, onSignOut: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "No family here",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "This sign-in is the super admin only. Set up families in the Screen Time web app.",
            style = MaterialTheme.typography.bodyLarge,
            color = ScreenTimeTheme.colors.muted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))
        OutlinedButton(
            onClick = onSignOut,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) {
            Text("Sign out")
        }
    }
}
