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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.screentime.core.model.api.Kid
import au.screentime.core.model.api.ScheduleInput
import au.screentime.core.ui.AvatarColors
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.parent.R
import au.screentime.parent.today.Problem
import au.screentime.parent.today.initial
import kotlinx.coroutines.launch

/**
 * The schedule page (docs/SPEC.md §16.4): the two warnings and, for each day, the Screens and Phone
 * allowances, wake-up and bedtime, each with − and + steppers, plus the copy buttons and Save.
 */
@Composable
fun ScheduleScreen(kid: Kid, vm: KidsViewModel, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var saved by remember { mutableStateOf<ScheduleInput?>(null) }
    var draft by remember { mutableStateOf<ScheduleInput?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var justSaved by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }

    val dirty = draft != saved

    fun loadSchedule() {
        scope.launch {
            vm.schedule(kid.id).onSuccess {
                val input = inputOf(it)
                saved = input
                draft = input
                error = null
            }.onFailure { e ->
                error = actionError(e as Exception)
            }
        }
    }

    LaunchedEffect(kid.id) {
        loadSchedule()
    }

    fun backTap() {
        if (dirty) confirmLeave = true else onBack()
    }

    BackHandler(onBack = { backTap() })

    fun applyEdit(next: ScheduleInput?) {
        if (next != null) {
            draft = next
            justSaved = false
            error = null
        }
    }

    fun stepWarn(which: Int, by: Int): ScheduleInput? {
        val d = draft ?: return null
        val current = if (which == 1) d.warn1Min else d.warn2Min
        val options = if (which == 1) warnOptions(WARN1_OPTIONS, d.warn1Min) else warnOptions(WARN2_OPTIONS, d.warn2Min)
        val next = step(options, current, by)
        if (next == current) return null
        return if (which == 1) d.copy(warn1Min = next) else d.copy(warn2Min = next)
    }

    fun stepScreens(weekday: Int, by: Int): ScheduleInput? {
        val d = draft ?: return null
        val day = d.days.first { it.weekday == weekday }
        val next = step(allowanceOptions(day.screensMin), day.screensMin, by)
        if (next == day.screensMin) return null
        return d.copy(days = d.days.map { if (it.weekday == weekday) it.copy(screensMin = next) else it })
    }

    fun stepPhone(weekday: Int, by: Int): ScheduleInput? {
        val d = draft ?: return null
        val day = d.days.first { it.weekday == weekday }
        val next = step(allowanceOptions(day.phoneMin), day.phoneMin, by)
        if (next == day.phoneMin) return null
        return d.copy(days = d.days.map { if (it.weekday == weekday) it.copy(phoneMin = next) else it })
    }

    fun stepWake(weekday: Int, by: Int): ScheduleInput? {
        val d = draft ?: return null
        val day = d.days.first { it.weekday == weekday }
        val next = step(wakeOptions(day.wake), day.wake, by)
        if (next == day.wake) return null
        return d.copy(days = d.days.map { if (it.weekday == weekday) it.copy(wake = next) else it })
    }

    fun stepBedtime(weekday: Int, by: Int): ScheduleInput? {
        val d = draft ?: return null
        val day = d.days.first { it.weekday == weekday }
        val next = step(bedtimeOptions(day.bedtime), day.bedtime, by)
        if (next == day.bedtime) return null
        return d.copy(days = d.days.map { if (it.weekday == weekday) it.copy(bedtime = next) else it })
    }

    fun copyMonday() {
        val d = draft ?: return
        draft = d.copy(days = copyMondayToWeekdays(d.days))
        justSaved = false
        error = null
    }

    fun copySaturday() {
        val d = draft ?: return
        draft = d.copy(days = copySaturdayToWeekend(d.days))
        justSaved = false
        error = null
    }

    fun save() {
        val d = draft ?: return
        scope.launch {
            busy = true
            vm.saveSchedule(kid.id, d).onSuccess {
                saved = inputOf(it)
                draft = inputOf(it)
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
                text = "${kid.name}'s schedule",
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
            saved == null -> Problem(error!!) { loadSchedule() }
            else -> {
                val d = draft!!
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = MaterialTheme.shapes.medium,
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline),
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(
                                    text = "Warnings",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    text = "How long before time runs out ${kid.name} gets a warning.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = ScreenTimeTheme.colors.muted,
                                )
                                Spacer(Modifier.height(8.dp))
                                Stepper(
                                    label = "First warning",
                                    value = "${d.warn1Min} min before",
                                    what = "first warning",
                                    onLess = if (stepWarn(1, -1) != null) { { applyEdit(stepWarn(1, -1)) } } else null,
                                    onMore = if (stepWarn(1, 1) != null) { { applyEdit(stepWarn(1, 1)) } } else null,
                                )
                                Stepper(
                                    label = "Second warning",
                                    value = "${d.warn2Min} min before",
                                    what = "second warning",
                                    onLess = if (stepWarn(2, -1) != null) { { applyEdit(stepWarn(2, -1)) } } else null,
                                    onMore = if (stepWarn(2, 1) != null) { { applyEdit(stepWarn(2, 1)) } } else null,
                                )
                                warningsError(d.warn1Min, d.warn2Min)?.let {
                                    Text(
                                        text = it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = ScreenTimeTheme.colors.critical,
                                    )
                                }
                            }
                        }
                    }
                    (1..7).forEach { weekday ->
                        item(key = weekday) {
                            val day = d.days.first { it.weekday == weekday }
                            val dayName = WEEKDAYS[weekday - 1]
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = MaterialTheme.shapes.medium,
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline),
                            ) {
                                Column(modifier = Modifier.padding(16.dp)) {
                                    Text(
                                        text = dayName,
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Stepper(
                                        label = "Screens",
                                        value = formatAllowance(day.screensMin),
                                        what = "$dayName Screens",
                                        onLess = if (stepScreens(weekday, -1) != null) { { applyEdit(stepScreens(weekday, -1)) } } else null,
                                        onMore = if (stepScreens(weekday, 1) != null) { { applyEdit(stepScreens(weekday, 1)) } } else null,
                                    )
                                    Stepper(
                                        label = "Phone",
                                        value = formatAllowance(day.phoneMin),
                                        what = "$dayName Phone",
                                        onLess = if (stepPhone(weekday, -1) != null) { { applyEdit(stepPhone(weekday, -1)) } } else null,
                                        onMore = if (stepPhone(weekday, 1) != null) { { applyEdit(stepPhone(weekday, 1)) } } else null,
                                    )
                                    Stepper(
                                        label = "Wake-up",
                                        value = formatClock(day.wake),
                                        what = "$dayName Wake-up",
                                        onLess = if (stepWake(weekday, -1) != null) { { applyEdit(stepWake(weekday, -1)) } } else null,
                                        onMore = if (stepWake(weekday, 1) != null) { { applyEdit(stepWake(weekday, 1)) } } else null,
                                    )
                                    Stepper(
                                        label = "Bedtime",
                                        value = formatClock(day.bedtime),
                                        what = "$dayName Bedtime",
                                        onLess = if (stepBedtime(weekday, -1) != null) { { applyEdit(stepBedtime(weekday, -1)) } } else null,
                                        onMore = if (stepBedtime(weekday, 1) != null) { { applyEdit(stepBedtime(weekday, 1)) } } else null,
                                    )
                                    dayError(day)?.let {
                                        Text(
                                            text = it,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = ScreenTimeTheme.colors.critical,
                                        )
                                    }
                                }
                            }
                        }
                        if (weekday == 1) {
                            item(key = "copy-monday") {
                                TextButton(onClick = { copyMonday() }) {
                                    Text("Copy Monday to weekdays")
                                }
                            }
                        }
                        if (weekday == 6) {
                            item(key = "copy-saturday") {
                                TextButton(onClick = { copySaturday() }) {
                                    Text("Copy Saturday to weekend")
                                }
                            }
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
                            text = "Saved. ${kid.name}'s devices pick it up on their next sync.",
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
                        enabled = dirty && scheduleValid(d) && !busy,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) {
                        Text("Save schedule")
                    }
                }
            }
        }
    }
    if (confirmLeave) {
        AlertDialog(
            title = { Text("Discard changes?") },
            text = { Text("Your changes to ${kid.name}'s schedule are not saved.") },
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

/** A stepper row: a label, a − button, the value, and a + button. */
@Composable
private fun Stepper(label: String, value: String, what: String, onLess: (() -> Unit)?, onMore: (() -> Unit)?) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = { onLess?.invoke() }, enabled = onLess != null) {
            Icon(painterResource(R.drawable.ic_remove), contentDescription = "Less $what")
        }
        Text(
            text = value,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(min = 96.dp),
        )
        IconButton(onClick = { onMore?.invoke() }, enabled = onMore != null) {
            Icon(painterResource(R.drawable.ic_add), contentDescription = "More $what")
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
