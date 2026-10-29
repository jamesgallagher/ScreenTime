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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.Kid
import au.screentime.core.ui.AvatarColors
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.R
import au.screentime.parent.today.Problem
import au.screentime.parent.today.initial
import kotlinx.coroutines.launch

/**
 * The always-callable page (docs/SPEC.md §16.4): up to 10 names and numbers the kid's phone can call
 * while locked, with add, edit, remove and Save.
 */
@Composable
fun ContactsScreen(kid: Kid, vm: KidsViewModel, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var saved by remember { mutableStateOf<List<ContactRow>?>(null) }
    var draft by remember { mutableStateOf<List<ContactRow>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var justSaved by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }

    val dirty = draft != saved

    fun loadContacts() {
        scope.launch {
            vm.contacts(kid.id).onSuccess {
                val rows = it.map { c -> ContactRow(c.label, c.phoneE164) }
                saved = rows
                draft = rows
                error = null
            }.onFailure { e ->
                error = actionError(e as Exception)
            }
        }
    }

    LaunchedEffect(kid.id) {
        loadContacts()
    }

    fun backTap() {
        if (dirty) confirmLeave = true else onBack()
    }

    BackHandler(onBack = { backTap() })

    fun setLabel(index: Int, label: String) {
        val d = draft ?: return
        draft = d.mapIndexed { i, row -> if (i == index) row.copy(label = label) else row }
        justSaved = false
        error = null
    }

    fun setPhone(index: Int, phone: String) {
        val d = draft ?: return
        draft = d.mapIndexed { i, row -> if (i == index) row.copy(phone = phone) else row }
        justSaved = false
        error = null
    }

    fun addRow() {
        val d = draft ?: return
        draft = d + ContactRow("", "")
        justSaved = false
        error = null
    }

    fun removeRow(index: Int) {
        val d = draft ?: return
        draft = d.filterIndexed { i, _ -> i != index }
        justSaved = false
        error = null
    }

    fun save() {
        val d = draft ?: return
        tried = true
        if (!contactsValid(d)) return
        scope.launch {
            busy = true
            vm.saveContacts(kid.id, d).onSuccess {
                val rows = it.map { c -> ContactRow(c.label, c.phoneE164) }
                saved = rows
                draft = rows
                tried = false
                justSaved = true
                error = null
            }.onFailure { e ->
                error = actionError(e as Exception)
            }
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
            IconButton(onClick = { backTap() }) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = "Back")
            }
            Avatar(kid)
            Spacer(Modifier.size(12.dp))
            Text(
                text = "Always callable",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        when {
            saved == null && error == null -> Box(
                modifier = Modifier.weight(1f),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
            saved == null -> Problem(error!!) { loadContacts() }
            else -> {
                val d = draft!!
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        Text(
                            text = "${kid.name}'s phone can call these numbers even when it is locked. The emergency number always works.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = ScreenTimeTheme.colors.muted,
                        )
                    }
                    if (d.isEmpty()) {
                        item {
                            Text(
                                text = "No numbers yet. Add Mum and Dad first.",
                                style = MaterialTheme.typography.bodyLarge,
                                color = ScreenTimeTheme.colors.muted,
                            )
                        }
                    } else {
                        itemsIndexed(d) { i, row ->
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = MaterialTheme.shapes.medium,
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline),
                            ) {
                                Column(modifier = Modifier.padding(16.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = "Contact ${i + 1}",
                                            style = MaterialTheme.typography.titleSmall,
                                            fontWeight = FontWeight.SemiBold,
                                            color = MaterialTheme.colorScheme.onSurface,
                                            modifier = Modifier.weight(1f),
                                        )
                                        IconButton(onClick = { removeRow(i) }) {
                                            Icon(
                                                painterResource(R.drawable.ic_delete),
                                                contentDescription = removeLabel(row),
                                                tint = ScreenTimeTheme.colors.danger,
                                            )
                                        }
                                    }
                                    OutlinedTextField(
                                        value = row.label,
                                        onValueChange = { setLabel(i, it) },
                                        label = { Text("Name") },
                                        placeholder = { Text("Name, like Mum") },
                                        singleLine = true,
                                        isError = tried && labelError(row) != null,
                                        supportingText = {
                                            if (tried) {
                                                labelError(row)?.let { Text(it) }
                                            }
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    OutlinedTextField(
                                        value = row.phone,
                                        onValueChange = { setPhone(i, it) },
                                        label = { Text("Phone number") },
                                        placeholder = { Text("0412 345 678") },
                                        singleLine = true,
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                                        isError = tried && phoneError(row) != null,
                                        supportingText = {
                                            if (tried) {
                                                phoneError(row)?.let { Text(it) }
                                            }
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                            }
                        }
                    }
                    item {
                        OutlinedButton(
                            onClick = { addRow() },
                            enabled = d.size < MAX_CONTACTS,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        ) {
                            Icon(painterResource(R.drawable.ic_add), contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text(addNumberText(d.size))
                        }
                    }
                }
                HorizontalDivider(color = ScreenTimeTheme.colors.outline)
                Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                    val err = error
                    when {
                        err != null -> Text(
                            text = err,
                            style = MaterialTheme.typography.bodyMedium,
                            color = ScreenTimeTheme.colors.critical,
                        )
                        justSaved -> Text(
                            text = "Saved.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = ScreenTimeTheme.colors.primary,
                        )
                        dirty -> Text(
                            text = "Unsaved changes",
                            style = MaterialTheme.typography.bodyMedium,
                            color = ScreenTimeTheme.colors.muted,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = { save() },
                        enabled = dirty && !busy,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) {
                        Text("Save numbers")
                    }
                }
            }
        }
    }
    if (confirmLeave) {
        AlertDialog(
            title = { Text("Discard changes?") },
            text = { Text("Your changes to ${kid.name}'s numbers are not saved.") },
            confirmButton = {
                TextButton(onClick = { onBack() }) {
                    Text("Discard", color = ScreenTimeTheme.colors.danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmLeave = false }) {
                    Text("Keep editing")
                }
            },
            onDismissRequest = { confirmLeave = false },
        )
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
