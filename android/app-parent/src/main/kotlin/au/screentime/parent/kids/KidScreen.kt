package au.screentime.parent.kids

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Kid
import au.screentime.core.ui.AvatarColors
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.R
import au.screentime.parent.today.initial
import java.time.Instant
import kotlinx.coroutines.launch

/**
 * The kid page (docs/SPEC.md §16.4): the kid's devices with Rename and Remove, and Add device.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KidScreen(kid: Kid, vm: KidsViewModel, onBack: () -> Unit, onAdd: (DeviceForm) -> Unit, error: String?, onSchedule: () -> Unit, onContacts: () -> Unit) {
    BackHandler(onBack = onBack)
    val state = vm.state
    val scope = rememberCoroutineScope()
    val devices = state.devices.filter { it.kidId == kid.id }
    val now = Instant.now()
    var renaming by remember { mutableStateOf<Device?>(null) }
    var removing by remember { mutableStateOf<Device?>(null) }
    var showingForm by remember { mutableStateOf(false) }

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
            Avatar(kid)
            Spacer(Modifier.size(12.dp))
            Text(
                text = kid.name,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = { scope.launch { vm.load(pulled = true) } },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Column {
                        Text(
                            text = "Devices",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onBackground,
                        )
                        Text(
                            text = "Phones count as Phone time. Tablets and PCs share Screens time.",
                            style = MaterialTheme.typography.bodySmall,
                            color = ScreenTimeTheme.colors.muted,
                        )
                    }
                }
                if (devices.isEmpty()) {
                    item {
                        Text(
                            text = "No devices yet.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = ScreenTimeTheme.colors.muted,
                        )
                    }
                } else {
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = MaterialTheme.shapes.medium,
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline),
                        ) {
                            Column {
                                devices.forEachIndexed { index, d ->
                                    if (index > 0) {
                                        HorizontalDivider(color = ScreenTimeTheme.colors.outline)
                                    }
                                    DeviceRow(d, now, onRename = { renaming = d }, onRemove = { removing = d })
                                }
                            }
                        }
                    }
                }
                if (error != null) {
                    item {
                        Text(
                            text = error,
                            style = MaterialTheme.typography.bodyMedium,
                            color = ScreenTimeTheme.colors.critical,
                        )
                    }
                }
                item {
                    FilledTonalButton(
                        onClick = { showingForm = true },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) {
                        Icon(painterResource(R.drawable.ic_add), contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Add device")
                    }
                }
                item {
                    Text(
                        text = "Settings",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                }
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.medium,
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline),
                    ) {
                        Column {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onSchedule() }
                                    .padding(16.dp),
                            ) {
                                Text(
                                    text = "Schedule",
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    text = "Time each day, wake-up and bedtime.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = ScreenTimeTheme.colors.muted,
                                )
                            }
                            HorizontalDivider(color = ScreenTimeTheme.colors.outline)
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onContacts() }
                                    .padding(16.dp),
                            ) {
                                Text(
                                    text = "Always callable",
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    text = "Numbers ${kid.name}'s phone can call when locked.",
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
    if (renaming != null) {
        RenameDialog(renaming!!, vm) { renaming = null }
    }
    if (removing != null) {
        RemoveDialog(removing!!, vm) { removing = null }
    }
    if (showingForm) {
        FormDialog(onPick = { form -> showingForm = false; onAdd(form) }, onDone = { showingForm = false })
    }
}

/** One device row: the name and the form and last seen, and the Rename and Remove buttons. */
@Composable
private fun DeviceRow(d: Device, now: Instant, onRename: () -> Unit, onRemove: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = d.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "${formName(d.form)} · ${lastSeenText(d.lastSeenAt, now)}",
                style = MaterialTheme.typography.bodySmall,
                color = ScreenTimeTheme.colors.muted,
            )
        }
        TextButton(onClick = onRename, modifier = Modifier.semantics { contentDescription = "Rename ${d.name}" }) {
            Text("Rename")
        }
        TextButton(onClick = onRemove, modifier = Modifier.semantics { contentDescription = "Remove ${d.name}" }) {
            Text("Remove", color = ScreenTimeTheme.colors.danger)
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

/** The rename dialog: the name in a field, and the error under it when there is one. */
@Composable
private fun RenameDialog(d: Device, vm: KidsViewModel, onDone: () -> Unit) {
    var text by remember { mutableStateOf(d.name) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        title = { Text("Rename device") },
        text = {
            Column {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                error?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = ScreenTimeTheme.colors.critical,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val name = cleanDeviceName(text) ?: return@TextButton
                    busy = true
                    scope.launch {
                        val e = vm.rename(d, name)
                        busy = false
                        if (e == null) onDone() else error = e
                    }
                },
                enabled = cleanDeviceName(text) != null && !busy,
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDone) {
                Text("Cancel")
            }
        },
        onDismissRequest = onDone,
    )
}

/** The remove dialog: the warning, and the error under the text when there is one. */
@Composable
private fun RemoveDialog(d: Device, vm: KidsViewModel, onDone: () -> Unit) {
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        title = { Text("Remove ${d.name}?") },
        text = {
            Column {
                Text(
                    text = "It is signed out of ScreenTime and stops limiting time. To add it again you need a new code.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                error?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = ScreenTimeTheme.colors.critical,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    busy = true
                    scope.launch {
                        val e = vm.remove(d)
                        busy = false
                        if (e == null) onDone() else error = e
                    }
                },
                enabled = !busy,
            ) {
                Text("Remove", color = ScreenTimeTheme.colors.danger)
            }
        },
        dismissButton = {
            TextButton(onClick = onDone) {
                Text("Cancel")
            }
        },
        onDismissRequest = onDone,
    )
}

/** The form choice: Phone, Tablet and PC, each with its detail line. */
@Composable
private fun FormDialog(onPick: (DeviceForm) -> Unit, onDone: () -> Unit) {
    AlertDialog(
        title = { Text("What are you adding?") },
        text = {
            Column {
                Text(
                    text = "You get a code that works once, for 10 minutes.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(8.dp))
                listOf(DeviceForm.PHONE, DeviceForm.TABLET, DeviceForm.PC).forEach { form ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPick(form) }
                            .padding(vertical = 12.dp),
                    ) {
                        Text(
                            text = formName(form),
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = formDetail(form),
                            style = MaterialTheme.typography.bodySmall,
                            color = ScreenTimeTheme.colors.muted,
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDone) {
                Text("Cancel")
            }
        },
        onDismissRequest = onDone,
    )
}
