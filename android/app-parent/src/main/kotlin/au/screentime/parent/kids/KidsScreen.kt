package au.screentime.parent.kids

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.EnrolmentCode
import au.screentime.core.model.api.Kid
import au.screentime.core.ui.AvatarColors
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.home.ScreenHeader
import au.screentime.parent.today.Problem
import au.screentime.parent.today.initial
import kotlinx.coroutines.launch

/**
 * The Kids tab (docs/SPEC.md §16.4): one row per kid, the kid page, and the add-device page. It owns
 * which page shows.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KidsScreen(vm: KidsViewModel) {
    val state = vm.state
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { vm.load() }
    // The open kid's id, the open page for a kid, and while adding, the chosen form and the code.
    var openKidId by rememberSaveable { mutableStateOf<String?>(null) }
    var kidPage by rememberSaveable { mutableStateOf<String?>(null) }
    var addingForm by remember { mutableStateOf<DeviceForm?>(null) }
    var addingCode by remember { mutableStateOf<EnrolmentCode?>(null) }
    var addError by remember { mutableStateOf<String?>(null) }
    var beforeIds by remember { mutableStateOf<Set<String>>(emptySet()) }

    val openKid = openKidId?.let { id -> state.kids?.find { it.id == id } }
    if (openKid == null && (openKidId != null || addingCode != null)) {
        openKidId = null
        addingCode = null
        addingForm = null
        kidPage = null
    }

    fun onAdd(form: DeviceForm) {
        val kid = openKid ?: return
        beforeIds = state.devices.filter { it.kidId == kid.id }.map { it.id }.toSet()
        addingForm = form
        addError = null
        scope.launch {
            val result = vm.newCode(kid.id, form)
            result.onSuccess { code ->
                addingCode = code
            }.onFailure { e ->
                addError = actionError(e as Exception)
            }
        }
    }

    when {
        addingCode != null -> {
            val kid = openKid!!
            val form = addingForm!!
            val code = addingCode!!
            AddDeviceScreen(
                kid = kid,
                form = form,
                code = code,
                before = beforeIds,
                vm = vm,
                onNewCode = { onAdd(form) },
                onClose = { addingCode = null; addingForm = null },
            )
        }
        openKid != null -> {
            when (kidPage) {
                "schedule" -> ScheduleScreen(kid = openKid, vm = vm, onBack = { kidPage = null })
                "contacts" -> ContactsScreen(kid = openKid, vm = vm, onBack = { kidPage = null })
                else -> KidScreen(
                    kid = openKid,
                    vm = vm,
                    onBack = { openKidId = null; kidPage = null },
                    onAdd = { onAdd(it) },
                    error = addError,
                    onSchedule = { kidPage = "schedule" },
                    onContacts = { kidPage = "contacts" },
                )
            }
        }
        else -> {
            KidsList(vm, state) { kid -> openKidId = kid.id }
        }
    }
}

/** The list: one card per kid with the number of devices. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KidsList(vm: KidsViewModel, state: KidsState, onOpen: (Kid) -> Unit) {
    val scope = rememberCoroutineScope()
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader("Kids", "Schedules, devices and contacts.")
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = { scope.launch { vm.load(pulled = true) } },
            modifier = Modifier.fillMaxSize(),
        ) {
            when {
                state.kids == null && state.error == null -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
                state.kids == null -> Problem(state.error!!) { scope.launch { vm.load(pulled = true) } }
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
                    if (state.kids.isEmpty()) {
                        item {
                            Column {
                                Text(
                                    text = "No kids yet",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onBackground,
                                )
                                Text(
                                    text = "Add a kid in the Screen Time web app, then add their phone, tablet or PC here.",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = ScreenTimeTheme.colors.muted,
                                )
                            }
                        }
                    }
                    items(state.kids, key = { it.id }) { kid ->
                        KidRowCard(kid, state.devices) { onOpen(kid) }
                    }
                }
            }
        }
    }
}

/** A kid card: the avatar and name, what devices they have, and a chevron. */
@Composable
private fun KidRowCard(kid: Kid, devices: List<Device>, onClick: () -> Unit) {
    val countText = devicesSummary(devices.filter { it.kidId == kid.id })
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.medium),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(kid)
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = kid.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = countText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = ScreenTimeTheme.colors.muted,
                )
            }
            Text("\u203A", fontSize = 28.sp, color = ScreenTimeTheme.colors.muted)
        }
    }
}

/** The kid's avatar: a 40 dp circle in the kid's colour with the initial. */
@Composable
private fun Avatar(kid: Kid) {
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
