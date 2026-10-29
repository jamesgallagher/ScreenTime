# CARD-043b: Parent app: schedule and always-callable numbers

| Field | Value |
|---|---|
| Card | CARD-043b |
| Title | Parent app: schedule and always-callable numbers |
| Size | M |
| Depends on | CARD-043, merged to `main` |
| Spec sections | docs/SPEC.md §16.4 (Kids › kid › Schedule, Always callable), §7 (schedule), Q33 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-043b-parent-schedule` |
| PR title | `CARD-043b: Parent app: schedule and always-callable numbers` |

## 1. Project context

Read `AGENTS.md` first (rules 8 and 9: temp files go in `C:\Users\james\OpenCode\Testing\temp\`; the handback has the **real output of every emulator step** and lists every workaround). CARD-043 made the parent app's Kids tab: the list, the kid page with devices, and Add device. The kid page still says "Schedule and contacts are in the web app for now."

This card adds two pages, opened from the kid page:

1. **Schedule**: the two warnings and, for each day Monday to Sunday, the Screens and Phone allowances, wake-up and bedtime. Every value has **−** and **+** buttons that move one step (15 minutes for times and allowances). **Copy Monday to weekdays** and **Copy Saturday to weekend**. **Save schedule** at the bottom.
2. **Always callable**: up to 10 names and numbers the kid's phone can call while locked. Add, edit, remove, **Save numbers**.

The server and the generated client are done: `getKidsSchedule(kidId): Schedule`, `putKidsSchedule(kidId, ScheduleInput): Schedule`, `getKidsContacts(kidId): List<KidContact>`, `putKidsContacts(kidId, KidContactsPut): List<KidContact>`. The web app has the same editors (`web/src/lib/schedule.ts`, `web/src/components/schedule-editor.tsx`, `contacts-editor.tsx`); this card's words follow them. The web uses drop-down lists; the phone uses −/+ steppers instead (bigger targets, no long lists).

As in CARD-043: you **copy** the files in section 5 exactly, and you **write** the code from section 6. The tests are the contract and must pass unchanged; Claude ran them in CI against its own small implementation. "Copy", "Write" and "Change" mean what CARD-041 §5 says.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `EditorsTest` (9 tests) and the seven earlier suites unchanged; the emulator run (8.2) passes with its output pasted; the seven screenshots exist; the **Android / build and test** check is green.

## 3. Out of scope

- No change outside `android/app-parent/`. No new library. No `androidx.navigation` (plain Compose state, as CARD-043).
- No drop-down menus, no time-picker dialogs: steppers only (6.3).
- No adding, renaming or archiving kids. No push (CARD-042). No change to the kid app.
- Never run on a real phone, never install a release build, never commit secrets (`deploy/.env`, tokens, keys, `google-services.json`, `local.properties`). Never paste a device token.

## 4. Tech

As CARD-043: Kotlin, Compose Material 3, the project's `ScreenTimeTheme`. Times are the API's `"HH:MM"` strings (`"24:00"` is midnight at the end of the day); allowances are whole minutes.

## 5. Files

Copy these two. Section 6 says what to write.

### 5.1 `android/app-parent/src/main/res/drawable/ic_delete.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Remove an always-callable number: Material Symbols "delete", 24 dp. Compose tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <path
        android:fillColor="#FF000000"
        android:pathData="M280,840Q247,840 223.5,816.5Q200,793 200,760L200,240L160,240L160,160L360,160L360,120L600,120L600,160L800,160L800,240L760,240L760,760Q760,793 736.5,816.5Q713,840 680,840L280,840ZM680,240L280,240L280,760L680,760L680,240ZM360,680L440,680L440,320L360,320L360,680ZM520,680L600,680L600,320L520,320L520,680Z" />
</vector>
```

### 5.2 `…/test/…/kids/EditorsTest.kt`

Path: `android/app-parent/src/test/kotlin/au/screentime/parent/kids/EditorsTest.kt`.

```kotlin
package au.screentime.parent.kids

import au.screentime.core.model.api.KidContactsPut
import au.screentime.core.model.api.KidContactsPutContactsItem
import au.screentime.core.model.api.Schedule
import au.screentime.core.model.api.ScheduleDay
import au.screentime.core.model.api.ScheduleInput
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** CARD-043b: the schedule and always-callable editors' pure helpers. Copied verbatim from the card. */
class EditorsTest {
    private fun day(weekday: Int, screens: Int = 120, phone: Int = 60, wake: String = "07:00", bedtime: String = "20:30") =
        ScheduleDay(weekday, screens, phone, wake, bedtime)

    private val week = (1..7).map { day(it, screens = it * 15) }

    @Test
    fun clockWords() {
        assertEquals("12:00 am", formatClock("00:00"))
        assertEquals("7:00 am", formatClock("07:00"))
        assertEquals("12:30 pm", formatClock("12:30"))
        assertEquals("8:45 pm", formatClock("20:45"))
        assertEquals("midnight", formatClock("24:00"))
    }

    @Test
    fun timeOptionsRunInQuarterHours() {
        val wake = wakeOptions("07:00")
        assertEquals(96, wake.size)
        assertEquals(Option("00:00", "12:00 am"), wake.first())
        assertEquals(Option("23:45", "11:45 pm"), wake.last())
        val bed = bedtimeOptions("20:30")
        assertEquals(96, bed.size)
        assertEquals(Option("00:15", "12:15 am"), bed.first())
        assertEquals(Option("24:00", "midnight"), bed.last())
        // A saved value off the grid is kept, in order.
        val odd = bedtimeOptions("20:40")
        assertEquals(97, odd.size)
        assertEquals(listOf("20:30", "20:40", "20:45"), odd.map { it.value }.filter { it.startsWith("20:") && it > "20:15" })
    }

    @Test
    fun allowances() {
        assertEquals("No time", formatAllowance(0))
        assertEquals("15m", formatAllowance(15))
        assertEquals("2h", formatAllowance(120))
        assertEquals("1h 30m", formatAllowance(90))
        val options = allowanceOptions(60)
        assertEquals(49, options.size)
        assertEquals(Option(0, "No time"), options.first())
        assertEquals(Option(720, "12h"), options.last())
        // Longer than 12 hours (the API allows 24) is kept at the end.
        assertEquals(Option(900, "15h"), allowanceOptions(900).last())
        assertEquals(50, allowanceOptions(900).size)
    }

    @Test
    fun warningOptions() {
        assertEquals(listOf("10 min before", "15 min before", "20 min before", "30 min before", "45 min before", "60 min before"),
            warnOptions(WARN1_OPTIONS, 15).map { it.label })
        assertEquals(listOf(1, 2, 3, 4, 5, 10), warnOptions(WARN2_OPTIONS, 4).map { it.value })
    }

    @Test
    fun steppersMoveOneOptionAndStopAtTheEnds() {
        val options = allowanceOptions(120)
        assertEquals(135, step(options, 120, 1))
        assertEquals(105, step(options, 120, -1))
        assertEquals(0, step(options, 0, -1))
        assertEquals(720, step(options, 720, 1))
        assertEquals("20:45", step(bedtimeOptions("20:30"), "20:30", 1))
        assertEquals("20:30", step(bedtimeOptions("20:40"), "20:40", -1))
        assertEquals(10, step(warnOptions(WARN1_OPTIONS, 15), 15, -1))
    }

    @Test
    fun copyButtons() {
        val weekdays = copyMondayToWeekdays(week)
        assertEquals(listOf(15, 15, 15, 15, 15, 90, 105), weekdays.map { it.screensMin })
        assertEquals((1..7).toList(), weekdays.map { it.weekday })
        val weekend = copySaturdayToWeekend(week)
        assertEquals(listOf(15, 30, 45, 60, 75, 90, 90), weekend.map { it.screensMin })
        assertEquals(7, weekend.last().weekday)
    }

    @Test
    fun scheduleRules() {
        assertNull(dayError(day(1)))
        assertEquals("Bedtime must be after wake-up.", dayError(day(1, wake = "21:00", bedtime = "20:30")))
        assertEquals("Bedtime must be after wake-up.", dayError(day(1, wake = "20:30", bedtime = "20:30")))
        assertNull(dayError(day(1, wake = "07:00", bedtime = "24:00")))
        assertNull(warningsError(15, 5))
        assertEquals("The first warning must come before the second.", warningsError(10, 10))
        assertTrue(scheduleValid(ScheduleInput(15, 5, week)))
        assertFalse(scheduleValid(ScheduleInput(5, 10, week)))
        assertFalse(scheduleValid(ScheduleInput(15, 5, week.map { if (it.weekday == 3) it.copy(wake = "23:00") else it })))
        assertEquals(ScheduleInput(15, 5, week), inputOf(Schedule(4, 15, 5, week)))
    }

    @Test
    fun phoneNumbers() {
        assertEquals("+61412345678", normalisePhone("0412 345 678"))
        assertEquals("+61412345678", normalisePhone("(04) 1234-5678"))
        assertEquals("+61298765432", normalisePhone("02 9876 5432"))
        assertEquals("+447700900123", normalisePhone("+44 7700 900123"))
        assertNull(normalisePhone(""))
        assertNull(normalisePhone("12345"))
        assertNull(normalisePhone("0412 345 67"))
        assertNull(normalisePhone("+0412345678"))
    }

    @Test
    fun contactRows() {
        val mum = ContactRow("  Mum ", "0412 345 678")
        assertNull(labelError(mum))
        assertNull(phoneError(mum))
        assertEquals("Type a name.", labelError(ContactRow("  ", "0412345678")))
        assertEquals("40 letters at most.", labelError(ContactRow("x".repeat(41), "0412345678")))
        assertEquals("Type a number like 0412 345 678 or +61412345678.", phoneError(ContactRow("Dad", "123")))
        assertTrue(contactsValid(listOf(mum)))
        assertTrue(contactsValid(emptyList()))
        assertFalse(contactsValid(listOf(mum, ContactRow("Dad", ""))))
        assertFalse(contactsValid(List(11) { mum }))
        assertEquals(KidContactsPut(listOf(KidContactsPutContactsItem("Mum", "+61412345678"))), contactsBody(listOf(mum)))
        assertEquals("Add a number", addNumberText(9))
        assertEquals("10 numbers at most", addNumberText(10))
        assertEquals("Remove Mum", removeLabel(mum))
        assertEquals("Remove this number", removeLabel(ContactRow("", "")))
    }
}
```

## 6. What to write

All in `android/app-parent/src/main/kotlin/au/screentime/parent/kids/`.

### 6.1 `Editors.kt` (new)

Pure Kotlin, package `au.screentime.parent.kids`; `EditorsTest` checks it. The Kotlin twin of `web/src/lib/schedule.ts` and `normalisePhone` in `web/src/lib/kid.ts`. Use `formatDuration` from `au.screentime.core.time` (already a dependency).

- `val WEEKDAYS`: `"Monday"` … `"Sunday"` (index 0 is weekday 1). `val WARN1_OPTIONS = listOf(10, 15, 20, 30, 45, 60)`, `val WARN2_OPTIONS = listOf(1, 2, 3, 5, 10)`, `const val MAX_CONTACTS = 10`.
- `data class Option<T>(val value: T, val label: String)`.
- `fun formatClock(time: String): String`: 12-hour, `"12:00 am"`, `"7:00 am"`, `"12:30 pm"`; `"24:00"` is `"midnight"`.
- `fun wakeOptions(current: String)` and `fun bedtimeOptions(current: String)`: `List<Option<String>>` every 15 minutes, labelled with `formatClock`. Wake-up runs `"00:00"` to `"23:45"`; bedtime `"00:15"` to `"24:00"`. If `current` is not on that grid, add it in time order (as `withCurrent` in the web file).
- `fun formatAllowance(minutes: Int)`: `0` is `"No time"`, else `formatDuration(minutes * 60L)` (`"15m"`, `"2h"`, `"1h 30m"`).
- `fun allowanceOptions(current: Int)`: `0` to `720` by 15, plus `current` in order when not on the list (the API allows up to 1440).
- `fun warnOptions(base: List<Int>, current: Int)`: `base` plus `current`, no duplicates, sorted, labelled `"$m min before"`.
- `fun <T> step(options: List<Option<T>>, current: T, by: Int): T`: the value `by` places along (`-1` or `+1`), stopping at the first and last; an unknown `current` stays as it is.
- `fun copyMondayToWeekdays(days: List<ScheduleDay>)`: Tuesday to Friday become copies of Monday with their own `weekday`. `fun copySaturdayToWeekend(days)`: Sunday becomes a copy of Saturday.
- `fun dayError(day: ScheduleDay): String?`: `"Bedtime must be after wake-up."` when `day.wake >= day.bedtime` (string compare, as the server does), else `null`.
- `fun warningsError(warn1Min: Int, warn2Min: Int): String?`: `"The first warning must come before the second."` unless `warn1Min > warn2Min`.
- `fun scheduleValid(input: ScheduleInput): Boolean`: no warnings error and no day error. `fun inputOf(schedule: Schedule): ScheduleInput`.
- `fun normalisePhone(text: String): String?`: drop spaces, `-`, `.`, `(`, `)`; `0` plus 9 digits starting 1–9 becomes `+61` plus the 9 digits; the result must match `^\+[1-9][0-9]{6,14}$`, else `null`.
- `data class ContactRow(val label: String, val phone: String)`: one row as typed.
- `fun labelError(row)`: blank → `"Type a name."`; longer than 40 after trimming → `"40 letters at most."`; else `null`. `fun phoneError(row)`: `"Type a number like 0412 345 678 or +61412345678."` when `normalisePhone` gives `null`.
- `fun contactsValid(rows)`: at most 10 rows and no row errors. `fun contactsBody(rows): KidContactsPut`: trimmed labels and normalised numbers.
- `fun addNumberText(count)`: `"Add a number"`, or `"10 numbers at most"` at 10. `fun removeLabel(row)`: `"Remove ${label trimmed}"`, or `"Remove this number"` when blank.

### 6.2 `KidsViewModel.kt` (change)

Add four functions. Each runs its call inside `viewModelScope.async { … }.await()` like `rename` (so leaving the page cannot cancel a save halfway), rethrows `CancellationException`, and uses `actionError(e)` for the words.

- `suspend fun schedule(kidId: String): Result<Schedule>` and `suspend fun contacts(kidId: String): Result<List<KidContact>>`: a failure is `Result.failure(e)`.
- `suspend fun saveSchedule(kidId: String, input: ScheduleInput): Result<Schedule>` and `suspend fun saveContacts(kidId: String, rows: List<ContactRow>): Result<List<KidContact>>` (sends `contactsBody(rows)`): the server's answer, or a failure.

### 6.3 Shared look: the stepper row

Write it once in `ScheduleScreen.kt` as `@Composable private fun Stepper(label: String, value: String, what: String, onLess: (() -> Unit)?, onMore: (() -> Unit)?)`:

`Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically)`: `label` (`bodyLarge`, `Modifier.weight(1f)`); `IconButton` with `ic_remove`, `contentDescription = "Less $what"`, enabled when `onLess != null`; `value` (`bodyLarge`, `FontWeight.SemiBold`, `textAlign = TextAlign.Center`, `Modifier.widthIn(min = 96.dp)`); `IconButton` with `ic_add`, `contentDescription = "More $what"`, enabled when `onMore != null`. A button is disabled (`null`) when `step` would not change the value.

### 6.4 `ScheduleScreen.kt` (new)

`@Composable fun ScheduleScreen(kid: Kid, vm: KidsViewModel, onBack: () -> Unit)`.

**State:** `saved: ScheduleInput?` (the server's copy) and `draft: ScheduleInput?`, both `remember`; `busy`, `error: String?`, `justSaved: Boolean`, `confirmLeave: Boolean`. `LaunchedEffect(kid.id)` loads `vm.schedule(kid.id)`: success sets both to `inputOf(it)`; failure sets `error`. `dirty = draft != saved`. Any edit sets `draft` and clears `justSaved` and `error`.

**Back:** `BackHandler` and the back arrow both do: dirty → `confirmLeave = true`; else `onBack()`. The dialog (`AlertDialog`): title `"Discard changes?"`, text `"Your changes to ${kid.name}'s schedule are not saved."`, confirm `TextButton` `"Discard"` (danger colour) → `onBack()`, dismiss `"Keep editing"`.

**Layout:** `Column(Modifier.fillMaxSize())`:

1. The top row exactly as `KidScreen`'s (back arrow, 40 dp avatar, 12 dp), with `"${kid.name}'s schedule"` in `headlineSmall`, `FontWeight.SemiBold`.
2. While loading: a centred `CircularProgressIndicator`. A load failure: `Problem(error) { reload }` from `today/`.
3. Otherwise a `LazyColumn(Modifier.weight(1f))`, 16 dp sides, 12 dp between, 16 dp bottom. Cards in the Today style (surface, 1 dp outline, `shapes.medium`), content padded 16 dp:
   - **Warnings** card: `"Warnings"` (`titleMedium`, `FontWeight.SemiBold`), `"How long before time runs out ${kid.name} gets a warning."` (`bodySmall`, muted), 8 dp, then `Stepper("First warning", label, "first warning", …)` over `warnOptions(WARN1_OPTIONS, warn1Min)` and `Stepper("Second warning", label, "second warning", …)` over `warnOptions(WARN2_OPTIONS, warn2Min)`; under them `warningsError(…)` in `bodySmall`, critical colour, when not null.
   - **One card per day**, Monday to Sunday (`key = weekday`): `WEEKDAYS[weekday - 1]` (`titleMedium`, `FontWeight.SemiBold`), then four steppers, with `what` = `"$dayName <label>"`:
     `Stepper("Screens", formatAllowance(screensMin), "Monday Screens", …)` over `allowanceOptions`; `"Phone"` likewise; `"Wake-up"` (`formatClock(wake)`) over `wakeOptions`; `"Bedtime"` (`formatClock(bedtime)`) over `bedtimeOptions`. Under them `dayError(day)` in `bodySmall`, critical colour, when not null.
   - Right after the **Monday** card: a `TextButton` `"Copy Monday to weekdays"` → `copyMondayToWeekdays`. Right after the **Saturday** card: `"Copy Saturday to weekend"` → `copySaturdayToWeekend`.
4. A bottom bar (not in the list): `HorizontalDivider(color = ScreenTimeTheme.colors.outline)`, then `Column(Modifier.fillMaxWidth().padding(16.dp))`:
   - one status line (`bodyMedium`): a save `error` (critical colour); else when `justSaved`: `"Saved. ${kid.name}'s devices pick it up on their next sync."` (`primary`); else when dirty: `"Unsaved changes"` (muted); else nothing.
   - 8 dp, then a full-width pill `Button` `"Save schedule"` (`heightIn(min = 48.dp)`), enabled when dirty, `scheduleValid(draft)` and not busy. It calls `vm.saveSchedule(kid.id, draft)`; success sets `saved` and `draft` to `inputOf(answer)` and `justSaved = true`; failure sets `error = actionError(e)`.

### 6.5 `ContactsScreen.kt` (new)

`@Composable fun ContactsScreen(kid: Kid, vm: KidsViewModel, onBack: () -> Unit)`. The same pattern as 6.4: `saved: List<ContactRow>?` and `draft`, loaded from `vm.contacts(kid.id)` as `ContactRow(c.label, c.phoneE164)`; `tried` (Save was tapped once: only then show row errors); the same back rule and dialog with `"Your changes to ${kid.name}'s numbers are not saved."`.

**Layout:**

1. The top row with `"Always callable"`.
2. Loading and failure as 6.4.
3. A `LazyColumn(Modifier.weight(1f))` as 6.4:
   - `"${kid.name}'s phone can call these numbers even when it is locked. The emergency number always works."` (`bodyMedium`, muted).
   - No rows: `"No numbers yet. Add Mum and Dad first."` (`bodyLarge`, muted).
   - One card per row (`itemsIndexed`): `Column(Modifier.padding(16.dp))` with `"Contact ${i + 1}"` (`titleSmall`, `FontWeight.SemiBold`) and an `IconButton` with `ic_delete`, `contentDescription = removeLabel(row)`, tint danger, at the end of the same `Row`; then an `OutlinedTextField` (full width, `singleLine`, `label = { Text("Name") }`, `placeholder = { Text("Name, like Mum") }`, `isError` and `supportingText` = `labelError(row)` when `tried`); 8 dp; an `OutlinedTextField` with `label = { Text("Phone number") }`, `placeholder = { Text("0412 345 678") }`, `keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone)`, and `phoneError(row)` the same way.
   - A full-width `OutlinedButton` (`heightIn(min = 48.dp)`) with `ic_add` and `addNumberText(draft.size)`, enabled below `MAX_CONTACTS`; it adds `ContactRow("", "")`.
4. The bottom bar as 6.4, with `"Saved."` for `justSaved` and the button `"Save numbers"`, enabled when dirty and not busy. Tapping it sets `tried = true`; if `contactsValid(draft)` is false it stops there (the row errors now show); else `vm.saveContacts(kid.id, draft)`, and success sets `saved` and `draft` to the answer's rows (now the server's `+61…` form), `tried = false`, `justSaved = true`.

### 6.6 `KidScreen.kt` and `KidsScreen.kt` (change)

- `KidScreen` gets two more parameters at the end: `onSchedule: () -> Unit, onContacts: () -> Unit`. Replace the line `"Schedule and contacts are in the web app for now."` with a heading `"Settings"` (`titleMedium`, `FontWeight.SemiBold`) and **one** card (the devices card style) holding two clickable rows with a divider between, each `Column(Modifier.fillMaxWidth().clickable { … }.padding(16.dp))`: `"Schedule"` (`bodyLarge`, `FontWeight.SemiBold`) over `"Time each day, wake-up and bedtime."` (`bodySmall`, muted); `"Always callable"` over `"Numbers ${kid.name}'s phone can call when locked."`.
- `KidsScreen` keeps one more `rememberSaveable` value, `kidPage: String?` (`"schedule"`, `"contacts"` or `null`). With a kid open: `"schedule"` shows `ScheduleScreen(kid, vm) { kidPage = null }`, `"contacts"` shows `ContactsScreen(…)`, else `KidScreen(…, onSchedule = { kidPage = "schedule" }, onContacts = { kidPage = "contacts" })`. Closing the kid (back) also sets `kidPage = null`.

## 7. Steps

As CARD-041 §7 with this card's names: branch `bob/card-043b-parent-schedule` from the latest `main` (check `docs/cards/CARD-043b-parent-schedule.md` exists after the pull); copy 5, write 6 in order; `.\gradlew.bat assembleDebug test` until green (fix your code, never the tests); commit `CARD-043b: Parent app: schedule and always-callable numbers`; run 8; push; PR (10); wait for CI; handback (12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] `.\gradlew.bat assembleDebug test` → `BUILD SUCCESSFUL`, no `w:` lines in `app-parent` files.
- [ ] The test summary command from CARD-041 §8.1 prints **eight** lines: the seven from CARD-043 plus `au.screentime.parent.kids.EditorsTest tests="9" failures="0" errors="0"`.
- [ ] `EditorsTest.kt` and `ic_delete.xml` are byte-identical to this card.

### 8.2 On the emulator

Paste the **real output of every step** (AGENTS rule 9). A step without output counts as NOT RUN. Any extra command, restart or force-stop goes under "Deviations" with why.

**Setup:** run CARD-041 §8.2 "The emulator" block exactly, and its "The server" block **without its last three lines** (the two `dev-bedtime.ts` and the `dev-usage.ts`: this card wants the seeded default week, Monday to Friday `120|90|07:00|20:30`, weekend `180|120|08:00|21:00`). Then paste its **Helpers** block with `$t` set to the `c43b` folder. Then also paste these. `Sched` prints Alex's newest schedule from the database (version, the two warnings, then Monday, Friday and Saturday Screens minutes). `Nums` prints Alex's always-callable numbers. `Find` swipes up until the text is on screen.

```powershell
function Db([string]$sql) {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -At -c $sql
}
function Sched {
  Db "select v.version, v.warn1_min, v.warn2_min, v.days->0->>'screensMin', v.days->4->>'screensMin', v.days->5->>'screensMin' from schedule_versions v join kids k on k.id = v.kid_id where k.name = 'Alex' order by v.version desc limit 1"
}
function Nums {
  Db "select c.label, c.phone_e164 from kid_contacts c join kids k on k.id = c.kid_id where k.name = 'Alex' order by c.sort"
}
function Find([string]$text) {
  for ($i = 0; $i -lt 10; $i++) {
    if ((Screen-Text) -match [regex]::Escape($text)) { return "found $text" }
    & $adb shell input swipe 540 1600 540 900 400
    Start-Sleep -Seconds 1
  }
  throw "No '$text' after 10 swipes"
}
```

**The run**, from `android`:

1. Install, sign in, open Alex. Run CARD-041 §8.2 step 1 exactly, then:
   ```powershell
   Tap-Text "Kids" 3
   Tap-Text "Alex" 3
   Find "Always callable"
   Shot "1-kid"
   Screen-Text
   Sched
   ```
   `1-kid` shows the **Settings** heading and one card with **Schedule** / `Time each day, wake-up and bedtime.` and **Always callable** / `Numbers Alex's phone can call when locked.`; no web-app line. `Sched` prints `1|15|5|120|120|180`.
2. The schedule page:
   ```powershell
   Tap-Text "Schedule" 3
   Shot "2-schedule"
   Screen-Text
   ```
   `2-schedule` shows the back arrow, "A", `Alex's schedule`, the **Warnings** card (`15 min before`, `5 min before`) and the top of the **Monday** card (`2h`, `1h 30m`, `7:00 am`, `8:30 pm`), and a greyed **Save schedule**. `Screen-Text` has `Alex's schedule | Warnings | How long before time runs out Alex gets a warning. | First warning | 15 min before | Second warning | 5 min before | Monday | Screens | 2h | Phone | 1h 30m | Wake-up | 7:00 am | Bedtime | 8:30 pm` (and maybe more) and `Save schedule`.
3. A warnings error, then fixed:
   ```powershell
   Tap-Desc "More second warning"
   Tap-Desc "More second warning"
   Tap-Desc "Less first warning"
   Shot "3-error"
   Screen-Text
   Tap-Desc "More first warning"
   Screen-Text
   ```
   The second warning goes `5` → `10`, the first `15` → `10`. `3-error` shows `The first warning must come before the second.` in red and **Save schedule** greyed, with `Unsaved changes`. After **More first warning** the first is `15 min before`, the red line is gone and **Save schedule** is enabled.
4. Monday plus 30 minutes of Screens, copied to the weekdays, saved:
   ```powershell
   Tap-Desc "More Monday Screens"
   Tap-Desc "More Monday Screens"
   Find "Copy Monday to weekdays"
   Tap-Text "Copy Monday to weekdays"
   Find "Friday"
   Shot "4-copied"
   Screen-Text
   Tap-Text "Save schedule" 3
   Screen-Text
   Sched
   ```
   Monday's Screens reads `2h 30m`; `4-copied` shows Friday's Screens `2h 30m` too. After saving, the status line is `Saved. Alex's devices pick it up on their next sync.` and the button greyed. `Sched` prints `2|15|10|150|150|180`.
5. Leaving with unsaved changes:
   ```powershell
   Tap-Desc "Less Friday Phone"
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   Shot "5-discard"
   Screen-Text
   Tap-Text "Discard" 3
   Screen-Text
   ```
   `5-discard` shows `Discard changes?` / `Your changes to Alex's schedule are not saved.` with **Keep editing** and red **Discard**. After **Discard**, `Screen-Text` is Alex's page (`Devices`, `Settings`).
6. Always callable: add Mum, then a bad number:
   ```powershell
   Find "Always callable"
   Tap-Text "Always callable" 3
   Screen-Text
   Tap-Text "Add a number" 2
   Tap-Text "Name"
   & $adb shell input text "Mum"
   Tap-Text "Phone number"
   & $adb shell input text "0412%s345%s678"
   Hide-Keyboard
   Tap-Text "Save numbers" 3
   Shot "6-saved"
   Screen-Text
   Nums
   Tap-Text "Add a number" 2
   Tap-Text "Name"
   & $adb shell input text "Dad"
   Tap-Text "Phone number"
   & $adb shell input text "123"
   Hide-Keyboard
   Tap-Text "Save numbers" 3
   Shot "7-bad-number"
   Screen-Text
   Nums
   ```
   The first `Screen-Text` has `Always callable | Alex's phone can call these numbers even when it is locked. The emergency number always works. | No numbers yet. Add Mum and Dad first. | Add a number`. `6-saved` shows **Contact 1** with `Mum` and `+61412345678`, and `Saved.`; `Nums` prints `Mum|+61412345678`. `7-bad-number` shows **Contact 2** with `Type a number like 0412 345 678 or +61412345678.` in red under the number; `Nums` still prints only `Mum|+61412345678`.
7. Remove Dad's row, leave, undo:
   ```powershell
   Tap-Desc "Remove Dad"
   Screen-Text
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   Screen-Text
   ```
   The first `Screen-Text` has `Contact 1` and `Mum` but no `Contact 2` and no `Dad`, and no `Unsaved changes` (the list is back to the saved one). BACK goes straight to Alex's page, no dialog. Then CARD-041 §8.2 step 12 exactly.

- [ ] Steps 1 to 7 gave the expected results, with the real output of every command pasted.
- [ ] Seven screenshots in `C:\Users\james\OpenCode\Testing\temp\c43b\`: `1-kid`, `2-schedule`, `3-error`, `4-copied`, `5-discard`, `6-saved`, `7-bad-number` (`.png`). Not committed.

### 8.3 Repo

- [ ] `git status` clean of `deploy/.env`, `local.properties`, `build/`, screenshots.
- [ ] CI **Android / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 8 files:
  ```
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/ContactsScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/Editors.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/KidScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/KidsScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/KidsViewModel.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/ScheduleScreen.kt
  android/app-parent/src/main/res/drawable/ic_delete.xml
  android/app-parent/src/test/kotlin/au/screentime/parent/kids/EditorsTest.kt
  ```

## 9. Tests

`EditorsTest` (9, copied, unchanged): the clock words; the time and allowance lists, keeping an off-grid saved value; the warning lists; the steppers; the copy buttons; the schedule rules; phone numbers; contact rows and their words. The screens are checked by 8.2.

## 10. Git and pull request

As CARD-041 §10 with this card's branch, title and card path, 8 files, eight suites (54 tests), seven screenshots in `temp\c43b`. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions"; never change a test. CARD-041 §11 traps still apply (PIN-locked emulator, `Pull`, temp files, Emergency 000). New ones:

- **`Sched` prints nothing**: the server block was not run, or not from the repo root; paste its output and stop.
- **Step 3: `No 'More second warning' on screen`**: the `contentDescription` is not `"More $what"` with `what` in lower case for the warnings (6.4). Fix the code, not the step.
- **Step 4: Friday still shows `2h`**: the copy changed `draft` but the day cards read `saved`; every card reads `draft`.
- **Step 6: the text goes into the wrong field**: `Tap-Text "Name"` taps the **last** "Name" on screen, which is the newest row. If it missed, paste `Screen-Text` and stop.
- **Step 7: `Unsaved changes` still shows**: dirty must compare the rows, `draft != saved`, both `List<ContactRow>`.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- For an emulator or device run, paste the real output of **every** step (every `Screen-Text`, helper and script line). "The screenshots are the evidence" or "from earlier in the session" is not accepted: a step without its pasted output counts as `NOT RUN`, and Claude sends the PR back.
- Every workaround (force-stop, app restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-043b. Please review and merge if it is good.

CARD: CARD-043b Parent app: schedule and always-callable numbers
PR: <full PR URL>
Branch: bob/card-043b-parent-schedule
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
