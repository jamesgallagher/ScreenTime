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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
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
import androidx.compose.ui.unit.sp
import au.screentime.core.model.api.Kid
import au.screentime.core.model.api.ScheduleDay
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
    // The weekday whose editor sheet is open.
    var editing by remember { mutableStateOf<Int?>(null) }

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
                    item(key = "week") {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = MaterialTheme.shapes.medium,
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline),
                        ) {
                            Column {
                                (1..7).forEach { weekday ->
                                    if (weekday > 1) HorizontalDivider(color = ScreenTimeTheme.colors.outline)
                                    DayRow(d.days.first { it.weekday == weekday }) { editing = weekday }
                                }
                            }
                        }
                    }
                    item(key = "copy") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            AssistChip(onClick = { copyMonday() }, label = { Text("Monday → weekdays") })
                            AssistChip(onClick = { copySaturday() }, label = { Text("Saturday → Sunday") })
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
    val editDay = editing
    val editDraft = draft
    if (editDay != null && editDraft != null) {
        val day = editDraft.days.first { it.weekday == editDay }
        DaySheet(
            day = day,
            onScreens = { by -> applyEdit(stepScreens(editDay, by)) },
            onPhone = { by -> applyEdit(stepPhone(editDay, by)) },
            canScreens = { by -> stepScreens(editDay, by) != null },
            canPhone = { by -> stepPhone(editDay, by) != null },
            onClock = { wake, bedtime ->
                applyEdit(editDraft.copy(days = editDraft.days.map {
                    if (it.weekday == editDay) it.copy(wake = wake, bedtime = bedtime) else it
                }))
            },
            onDone = { editing = null },
        )
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

/** One day in the week overview: the day, its time and its hours, and a chevron; a tap opens the day's editor. */
@Composable
private fun DayRow(day: ScheduleDay, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = WEEKDAYS[day.weekday - 1].take(3),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.width(52.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = allowanceLine(day),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = hoursLine(day),
                style = MaterialTheme.typography.bodyMedium,
                color = ScreenTimeTheme.colors.muted,
            )
            dayError(day)?.let {
                Text(text = it, style = MaterialTheme.typography.bodySmall, color = ScreenTimeTheme.colors.critical)
            }
        }
        Text("\u203A", fontSize = 28.sp, color = ScreenTimeTheme.colors.muted)
    }
}

/**
 * One day's editor: Screens and Phone time with − and +, and wake-up and bedtime as clock buttons that open a clock
 * picker. Changes go into the draft at once; the page's **Save schedule** saves them.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DaySheet(
    day: ScheduleDay,
    onScreens: (Int) -> Unit,
    onPhone: (Int) -> Unit,
    canScreens: (Int) -> Boolean,
    canPhone: (Int) -> Boolean,
    onClock: (wake: String, bedtime: String) -> Unit,
    onDone: () -> Unit,
) {
    val dayName = WEEKDAYS[day.weekday - 1]
    var picking by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = onDone, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(modifier = Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 24.dp)) {
            Text(dayName, style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Stepper(
                label = "Screens",
                value = formatAllowance(day.screensMin),
                what = "$dayName Screens",
                onLess = if (canScreens(-1)) { { onScreens(-1) } } else null,
                onMore = if (canScreens(1)) { { onScreens(1) } } else null,
            )
            Stepper(
                label = "Phone",
                value = formatAllowance(day.phoneMin),
                what = "$dayName Phone",
                onLess = if (canPhone(-1)) { { onPhone(-1) } } else null,
                onMore = if (canPhone(1)) { { onPhone(1) } } else null,
            )
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ClockButton("Wake-up", day.wake, Modifier.weight(1f)) { picking = "wake" }
                ClockButton("Bedtime", day.bedtime, Modifier.weight(1f)) { picking = "bedtime" }
            }
            dayError(day)?.let {
                Spacer(Modifier.height(8.dp))
                Text(text = it, style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.critical)
            }
            Spacer(Modifier.height(20.dp))
            Button(onClick = onDone, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Text("Done")
            }
        }
    }
    val which = picking
    if (which != null) {
        val bedtime = which == "bedtime"
        ClockDialog(
            title = if (bedtime) "$dayName bedtime" else "$dayName wake-up",
            time = if (bedtime) day.bedtime else day.wake,
            bedtime = bedtime,
            onPick = { picked ->
                picking = null
                if (bedtime) onClock(day.wake, picked) else onClock(picked, day.bedtime)
            },
            onDone = { picking = null },
        )
    }
}

/** A tall button with a small label over the time: "Wake-up / 7:00 am". */
@Composable
private fun ClockButton(label: String, time: String, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = ScreenTimeTheme.colors.muted)
            Text(formatClock(time), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

/** The clock picker in a dialog; the picked time snaps to the quarter hour. A bedtime can also be "Midnight". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ClockDialog(title: String, time: String, bedtime: Boolean, onPick: (String) -> Unit, onDone: () -> Unit) {
    val (hour, minute) = pickerStart(time)
    val state = rememberTimePickerState(initialHour = hour, initialMinute = minute, is24Hour = false)
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text(title) },
        text = { TimePicker(state = state) },
        confirmButton = {
            TextButton(onClick = { onPick(pickedClock(state.hour, state.minute, bedtime)) }) { Text("OK") }
        },
        dismissButton = {
            Row {
                if (bedtime) TextButton(onClick = { onPick("24:00") }) { Text("Midnight") }
                TextButton(onClick = onDone) { Text("Cancel") }
            }
        },
    )
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
