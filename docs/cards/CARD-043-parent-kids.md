# CARD-043: Parent app: Kids tab, devices and add device

| Field | Value |
|---|---|
| Card | CARD-043 |
| Title | Parent app: Kids tab, devices and add device |
| Size | M |
| Depends on | CARD-041, merged to `main` |
| Spec sections | docs/SPEC.md §16.4 (Kids › kid, Add device), §6 (enrolment) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-043-parent-kids` |
| PR title | `CARD-043: Parent app: Kids tab, devices and add device` |

## 1. Project context

Read `AGENTS.md` first (rules 8 and 9: temp files go in `C:\Users\james\OpenCode\Testing\temp\`; the handback has the **real output of every emulator step** and lists every workaround). The parent app (`android/app-parent`) has sign-in, Today with the adjust sheet, and the Inbox (CARD-040, CARD-041). Its **Kids** tab is still a "coming soon" page.

This card makes the Kids tab real:

1. **Kids**: one row per kid with the number of devices. Tapping a kid opens the **kid page**.
2. **Kid page**: the kid's devices (name, kind, when last seen) with **Rename** and **Remove**, and **Add device**.
3. **Add device**: pick Phone, Tablet or PC; the app gets a one-time code from the server and shows it full screen: a QR code (not for a PC), the 6 digits in big type and a 10-minute countdown. It asks the server for the device list every 3 seconds and says **Connected** when the new device has enrolled.

The schedule editor and the always-callable contacts come in CARD-043b; adding or editing kids stays in the web app. The server and the generated client (`getKids`, `getDevices`, `patchDevicesById`, `deleteDevicesById`, `postKidsEnrolmentCodes`) are done. The web app has the same screens: `web/src/lib/kid.ts`, `web/src/components/devices-panel.tsx` and `web/src/components/add-device-dialog.tsx`; this card's words follow them.

As in CARD-041: you **copy** the files given here exactly, and you **write** the code from section 6. The tests are the contract and must pass unchanged; Claude ran them in CI against its own small implementation.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `KidsTest` (7 tests) and the six earlier suites unchanged; the emulator run (8.2) passes with its output pasted; the eight screenshots exist; the **Android / build and test** check is green.

## 3. Out of scope

- No schedule editor, no contacts (CARD-043b). No adding, renaming or archiving kids. No parent mode on a device (CARD-042). No push.
- No change outside `android/app-parent/` except the two lines in `android/gradle/libs.versions.toml` (5.1).
- No new library except `com.google.zxing:core` (5.1). In particular no `androidx.navigation` (the screens switch with plain Compose state) and no QR library other than zxing core.
- Never run on a real phone, never install a release build, never commit secrets (`deploy/.env`, tokens, keys, `google-services.json`, `local.properties`). Never paste a device token.

## 4. Tech

Unchanged from CARD-041 §4 (versions, PowerShell, `$env:JAVA_HOME`, `$adb`). Use `$t = "C:\Users\james\OpenCode\Testing\temp\c43"`. New: `com.google.zxing:core:3.5.3`, plain JVM, which turns text into a QR matrix; the app draws it with a Compose `Canvas`. `androidx.activity.compose.BackHandler` (already there through `activity-compose`; `app-kid/.../setup/QrScanner.kt` uses it) handles the back button.

## 5. Files

Kotlin under `android/app-parent/src/main/kotlin/au/screentime/parent/` (`…/`), tests under `android/app-parent/src/test/kotlin/au/screentime/parent/`.

| File | Action |
|---|---|
| `android/gradle/libs.versions.toml` | change: two lines (5.1) |
| `android/app-parent/build.gradle.kts` | change: one line (5.1) |
| `android/app-parent/src/main/res/drawable/ic_arrow_back.xml` | create, **copy** (5.2) |
| `…/kids/Kids.kt` | create, **write** (6.1) |
| `…/kids/KidsViewModel.kt` | create, **write** (6.2) |
| `…/kids/KidsScreen.kt` | create, **write** (6.3) |
| `…/kids/KidScreen.kt` | create, **write** (6.4) |
| `…/kids/AddDeviceScreen.kt` | create, **write** (6.5) |
| `…/home/HomeScreen.kt` | change, **write** (6.6) |
| `…/MainActivity.kt` | change, **write** (6.6) |
| `android/app-parent/src/test/kotlin/au/screentime/parent/kids/KidsTest.kt` | create, **copy** (5.3) |

11 files: 6 new, 5 changed. **Copy** and **write** mean the same as in CARD-041 §5 (exact characters, UTF-8, one newline at the end; KDoc on every public name; the card's words exactly).

### 5.1 The zxing library

In `android/gradle/libs.versions.toml`, add as the **first** line under `[versions]`:

```toml
zxing = "3.5.3"
```

and as the **first** line under `[libraries]`:

```toml
zxing-core = { group = "com.google.zxing", name = "core", version.ref = "zxing" }
```

In `android/app-parent/build.gradle.kts`, add right after `    implementation(libs.ktor.client.okhttp)`:

```kotlin
    implementation(libs.zxing.core)
```

Nothing else in these two files changes.

### 5.2 `android/app-parent/src/main/res/drawable/ic_arrow_back.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The kid page's back arrow: Material Symbols Rounded "arrow_back", 24 dp. Compose tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <path
        android:fillColor="#FF000000"
        android:pathData="M313,520L509,716Q521,728 520.5,744Q520,760 508,772Q496,783 480,783.5Q464,784 452,772L188,508Q182,502 179.5,495Q177,488 177,480Q177,472 179.5,465Q182,458 188,452L452,188Q463,177 479.5,177Q496,177 508,188Q520,200 520,216.5Q520,233 508,245L313,440L760,440Q777,440 788.5,451.5Q800,463 800,480Q800,497 788.5,508.5Q777,520 760,520L313,520Z" />
</vector>
```

### 5.3 `…/test/…/kids/KidsTest.kt`

```kotlin
package au.screentime.parent.kids

import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Platform
import au.screentime.core.model.api.Pool
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class KidsTest {
    private val now = Instant.parse("2026-10-28T05:00:00Z")

    private fun device(id: String, kidId: String = "k1", form: DeviceForm = DeviceForm.PHONE) = Device(
        id, kidId, Platform.ANDROID, form, if (form == DeviceForm.PHONE) Pool.PHONE else Pool.SCREENS, "Pixel 7",
        true, "Pixel 7", "Android 14", "0.1.0", null, "2026-10-20T00:00:00Z", null,
    )

    @Test
    fun formsHaveNamesAndSayWhichTimeTheyUse() {
        assertEquals("Phone", formName(DeviceForm.PHONE))
        assertEquals("Tablet", formName(DeviceForm.TABLET))
        assertEquals("PC", formName(DeviceForm.PC))
        assertEquals("Android phone. Counts as Phone time.", formDetail(DeviceForm.PHONE))
        assertEquals("Android tablet. Counts as Screens time.", formDetail(DeviceForm.TABLET))
        assertEquals("Windows PC account. Counts as Screens time.", formDetail(DeviceForm.PC))
    }

    @Test
    fun lastSeenReadsInMinutesHoursAndDays() {
        assertEquals("Never connected", lastSeenText(null, now))
        assertEquals("Seen just now", lastSeenText("2026-10-28T04:59:30Z", now))
        assertEquals("Seen 12 min ago", lastSeenText("2026-10-28T04:48:00Z", now))
        assertEquals("Seen 3h ago", lastSeenText("2026-10-28T01:30:00Z", now))
        assertEquals("Seen 1 day ago", lastSeenText("2026-10-27T04:00:00Z", now))
        assertEquals("Seen 2 days ago", lastSeenText("2026-10-26T04:00:00Z", now))
    }

    @Test
    fun theCodeCountsDownAndReadsInTwoHalves() {
        assertEquals("10:00", countdownText("2026-10-28T05:10:00Z", now))
        assertEquals("9:41", countdownText("2026-10-28T05:09:40.200Z", now))
        assertEquals("0:05", countdownText("2026-10-28T05:00:05Z", now))
        assertEquals("0:00", countdownText("2026-10-28T04:59:00Z", now))
        assertEquals("123 456", spacedCode("123456"))
    }

    @Test
    fun aNameIsTrimmedAndAtMostFortyCharacters() {
        assertEquals("Alex's tablet", cleanDeviceName("  Alex's tablet "))
        assertNull(cleanDeviceName("   "))
        assertEquals(40, cleanDeviceName("x".repeat(40))?.length)
        assertNull(cleanDeviceName("x".repeat(41)))
    }

    @Test
    fun theNewDeviceIsTheOneThatWasNotThereBefore() {
        val before = setOf("d1")
        assertNull(newDevice(before, listOf(device("d1")), "k1"))
        assertEquals("d2", newDevice(before, listOf(device("d1"), device("d2")), "k1")?.id)
        // Another kid's new device is not this kid's.
        assertNull(newDevice(before, listOf(device("d1"), device("d3", kidId = "k2")), "k1"))
    }

    @Test
    fun theAddDeviceStepSaysWhatToDoOnTheDevice() {
        assertEquals("Add Alex's phone", addTitle("Alex", DeviceForm.PHONE))
        assertEquals("Add Alex's PC", addTitle("Alex", DeviceForm.PC))
        assertEquals(
            "On Alex's tablet, open Screen Time and tap Scan QR code, or type the code.",
            addHint("Alex", DeviceForm.TABLET),
        )
        assertEquals(
            "On the PC, a parent runs the ScreenTime installer and types this code for Alex's Windows account.",
            addHint("Alex", DeviceForm.PC),
        )
    }

    @Test
    fun theQrCodeIsASquareOfModules() {
        val qr = qrModules("screentime://enrol?code=123456&server=https%3A%2F%2Fscreentime.gallagherhome.au")
        assertTrue(qr.size >= 21)
        assertTrue(qr.all { it.size == qr.size })
        assertTrue(qr.any { row -> row.any { it } })
        // The finder pattern: the top-left corner module is dark.
        assertTrue(qr[0][0])
    }
}
```

## 6. What to write

### 6.1 `kids/Kids.kt` (new)

Package `au.screentime.parent.kids`. Pure Kotlin (zxing is plain JVM, so it is allowed here); `KidsTest` checks every function. They are the Kotlin twins of `web/src/lib/kid.ts` and `add-device-dialog.tsx`.

- `fun formName(form: DeviceForm): String`: `"Phone"`, `"Tablet"`, `"PC"`.
- `fun formDetail(form: DeviceForm): String`: `"Android phone. Counts as Phone time."`, `"Android tablet. Counts as Screens time."`, `"Windows PC account. Counts as Screens time."`.
- `fun lastSeenText(lastSeenAt: String?, now: Instant): String`: `null` is `"Never connected"`. Otherwise whole minutes since then, rounded down: under 1 `"Seen just now"`; under 60 `"Seen $m min ago"`; under 24 hours `"Seen ${h}h ago"`; else `"Seen $d day ago"` for 1 and `"Seen $d days ago"` for more.
- `fun countdownText(expiresAt: String, now: Instant): String`: seconds left, rounded **up**, at least 0, as `"m:ss"`: `"10:00"`, `"9:41"`, `"0:00"`. Do the rounding with `(ms + 999) / 1000`, not `Math.ceilDiv` (not on Android).
- `fun spacedCode(code: String): String`: `"123456"` → `"123 456"`.
- `fun cleanDeviceName(text: String): String?`: the trimmed text, or `null` when it is empty or longer than 40 characters (the server's limit).
- `fun newDevice(before: Set<String>, devices: List<Device>, kidId: String): Device?`: the first device of `kidId` whose id is not in `before` (the ids the kid had when the code was made), or `null`.
- `fun addTitle(kidName: String, form: DeviceForm): String`: `"Add $kidName's <word>"`, where `<word>` is `"phone"`, `"tablet"` or `"PC"`.
- `fun addHint(kidName: String, form: DeviceForm): String`: for a PC `"On the PC, a parent runs the ScreenTime installer and types this code for $kidName's Windows account."`; otherwise `"On $kidName's <word>, open Screen Time and tap Scan QR code, or type the code."`.
- `fun qrModules(text: String): List<List<Boolean>>`: rows of modules, `true` = dark, with **no** quiet zone. Use `QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 0))` and read the `BitMatrix` with `get(x, y)`, row `y` by row.
- `fun actionError(e: Exception): String`: an `ApiException` → `"Something went wrong on the server. Try again soon."`; anything else → `"Can't reach Screen Time. Check the internet connection and try again."` (not in the tests).

### 6.2 `kids/KidsViewModel.kt` (new)

An `AndroidViewModel` like `InboxViewModel` (`session = getApplication<ParentApp>().session`).

```kotlin
/** The Kids tab's state. `kids` is null until the first answer. */
data class KidsState(
    val kids: List<Kid>? = null,
    val devices: List<Device> = emptyList(),
    val refreshing: Boolean = false,
    val error: String? = null,
)
```

- `suspend fun load(pulled: Boolean = false)`: as `InboxViewModel.load`, same error texts, asking `getKids()` then `getDevices()`.
- `suspend fun rename(device: Device, name: String): String?`: `patchDevicesById(device.id, DevicePatch(name = name))`, then `load()`.
- `suspend fun remove(device: Device): String?`: `deleteDevicesById(device.id)`, then `load()`.
- `suspend fun newCode(kidId: String, form: DeviceForm): Result<EnrolmentCode>`: `postKidsEnrolmentCodes(kidId, EnrolmentCodeCreate(form))`; a failure is `Result.failure` with the exception.
- `suspend fun refreshDevices()`: `getDevices()` into `state.devices` only; any error is ignored (the next poll tries again).
- `fun clear()`: back to `KidsState()`.

`rename` and `remove` return `null` when it worked, else `actionError(e)`; both rethrow `CancellationException` and return `null` on `SignedOutException`. **Run each call in `viewModelScope.launch { … }.join()`**, as `InboxViewModel.answer` does since PR #95, so a dialog closing cannot cancel it halfway.

### 6.3 `kids/KidsScreen.kt` (new)

`@Composable fun KidsScreen(vm: KidsViewModel)`. It owns which page shows, with `rememberSaveable` state: the open kid's id (`String?`) and, while adding, the chosen `DeviceForm` and the `EnrolmentCode` (keep these two in `remember`, not saveable). It shows:

- the **add device** page (6.5) when a code is open; else
- the **kid page** (6.4) when a kid id is open and that kid is in `state.kids` (if not, clear the id); else
- the **list**, below.

Load: `LaunchedEffect(Unit) { vm.load() }`, plus pull-to-refresh exactly as on the Inbox. No 30-second poll.

**The list:** `ScreenHeader("Kids", "Schedules, devices and contacts.")`, then the same loading / `Problem` / `LazyColumn` pattern as the Inbox (16 dp sides, 12 dp between). If `kids` is empty: `"No kids yet"` (`titleMedium`, `FontWeight.SemiBold`) and under it `"Add a kid in the Screen Time web app, then add their phone, tablet or PC here."` (`bodyLarge`, muted). Otherwise one card per kid (the Today card style: white, 1 dp outline, `shapes.medium`), clickable, `Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically)`: the 40 dp avatar circle with the initial (as on Today: use `avatarColor` and `initial` from `today/`), 12 dp, a `Column(Modifier.weight(1f))` with the name (`titleMedium`, `FontWeight.SemiBold`) and the count (`bodyMedium`, muted): `"No devices"`, `"1 device"`, `"$n devices"` (devices of that kid in `state.devices`).

### 6.4 `kids/KidScreen.kt` (new)

`@Composable fun KidScreen(kid: Kid, vm: KidsViewModel, onBack: () -> Unit, onAdd: (DeviceForm) -> Unit)`. `BackHandler(onBack = onBack)`.

Layout: a `Column(Modifier.fillMaxSize())`:

1. A top row: `IconButton(onClick = onBack)` with `ic_arrow_back`, `contentDescription = "Back"`; then the 40 dp avatar, 12 dp, the kid's name in `headlineSmall`, `FontWeight.SemiBold`. Padding 8 dp start, 16 dp end, 16 dp top and bottom.
2. A `LazyColumn` (16 dp sides, 12 dp between, 16 dp bottom), with pull-to-refresh as on the list:
   - The heading `"Devices"` (`titleMedium`, `FontWeight.SemiBold`) and under it `"Phones count as Phone time. Tablets and PCs share Screens time."` (`bodySmall`, muted).
   - If the kid has no devices: `"No devices yet."` (`bodyLarge`, muted). Else **one** card with a row per device, `HorizontalDivider(color = ScreenTimeTheme.colors.outline)` between rows. A row is `Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically)`: a `Column(Modifier.weight(1f))` with the name (`bodyLarge`, `FontWeight.SemiBold`) and `"${formName(d.form)} · ${lastSeenText(d.lastSeenAt, now)}"` (`bodySmall`, muted); then `TextButton` `"Rename"` with `Modifier.semantics { contentDescription = "Rename ${d.name}" }` and `TextButton` `"Remove"` in `ScreenTimeTheme.colors.danger` with `contentDescription = "Remove ${d.name}"`.
   - A full-width `FilledTonalButton` (`heightIn(min = 48.dp)`) with `ic_add` and the text `"Add device"`. It opens the form choice.
   - The line `"Schedule and contacts are in the web app for now."` (`bodySmall`, muted).

**Rename dialog** (`AlertDialog`): title `"Rename device"`; text: an `OutlinedTextField` with the device's name filled in, `label = { Text("Name") }`, `singleLine = true`, and the error (critical colour, `bodySmall`) under it when there is one; `confirmButton` `TextButton` `"Save"`, enabled while `cleanDeviceName(text) != null` and not busy, which launches `vm.rename(d, cleanDeviceName(text)!!)` and closes on `null`, else shows the words; `dismissButton` `"Cancel"`.

**Remove dialog** (`AlertDialog`): title `"Remove ${d.name}?"`; text `"It is signed out of ScreenTime and stops limiting time. To add it again you need a new code."`; `confirmButton` `TextButton` `"Remove"` in the danger colour → `vm.remove(d)`, close on `null`, else show the words under the text; `dismissButton` `"Cancel"`.

**Form choice** (`AlertDialog`): title `"What are you adding?"`; text: `"You get a code that works once, for 10 minutes."` (`bodyMedium`), 8 dp, then three clickable rows (`Modifier.fillMaxWidth().clickable { … }.padding(vertical = 12.dp)`) for Phone, Tablet, PC in that order, each a `Column` with `formName` (`bodyLarge`, `FontWeight.SemiBold`) and `formDetail` (`bodySmall`, muted). Tapping a row closes the dialog and calls `onAdd(form)`. `dismissButton` `"Cancel"`, no confirm button (pass an empty `confirmButton = {}`).

### 6.5 `kids/AddDeviceScreen.kt` (new)

`@Composable fun AddDeviceScreen(kid: Kid, form: DeviceForm, code: EnrolmentCode, before: Set<String>, vm: KidsViewModel, onNewCode: () -> Unit, onClose: () -> Unit)`. `KidsScreen` gets the code: when `onAdd(form)` fires it remembers `before` = the ids of the kid's devices now, calls `vm.newCode(kid.id, form)`, and on success opens this page; on failure it shows `actionError(e)` as a critical `bodyMedium` line on the kid page, just above **Add device** (pass it to `KidScreen` as an extra `error: String?` parameter). `onNewCode` does the same again for the same form; `onClose` clears the code and form (back to the kid page). `BackHandler(onBack = onClose)`.

State: `now` ticks every second (`LaunchedEffect(Unit) { while (true) { now = Instant.now(); delay(1_000) } }`); `expired` = `countdownText(code.expiresAt, now) == "0:00"`; `connected` = `newDevice(before, vm.state.devices, kid.id)`. While not connected and not expired: `LaunchedEffect(code) { while (true) { delay(3_000); vm.refreshDevices() } }` (stop when connected).

Layout: `Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally)`:

1. `addTitle(kid.name, form)`: `headlineSmall`, `FontWeight.SemiBold`, centred.
2. 8 dp. `addHint(kid.name, form)`: `bodyLarge`, muted, centred.
3. Not for a PC: 24 dp, then a `Box(Modifier.background(Color.White, RoundedCornerShape(16.dp)).padding(12.dp))` holding a `Canvas(Modifier.size(232.dp).semantics { contentDescription = "Enrolment QR code" })` that draws `qrModules(code.qrPayload)`: each dark module a filled square of `size.width / modules.size`, colour `Color(0xFF1C1917)`. Draw at `alpha = 0.2f` when expired. (White and near-black in both themes, so phones can scan it.)
4. 24 dp. `"Or type this code"` (`bodyMedium`, muted) for a phone or tablet; `"The code"` for a PC.
5. 4 dp. `spacedCode(code.code)` in `fontSize = 48.sp`, `FontWeight.SemiBold`, `letterSpacing = 2.sp`, `onBackground` (muted when expired).
6. 8 dp. When connected: `"Connected: ${connected.name}"` in `titleMedium`, `FontWeight.SemiBold`, `MaterialTheme.colorScheme.primary`. Else when expired: `"This code has expired."` (`bodyMedium`, `ScreenTimeTheme.colors.critical`). Else: `"Works once. Expires in ${countdownText(code.expiresAt, now)}"` (`bodyMedium`, muted).
7. 32 dp. One full-width pill `Button` (`heightIn(min = 48.dp)`): connected → `"Done"` (`onClose`); expired → `"Make a new code"` (`onNewCode`); otherwise an `OutlinedButton` `"Cancel"` (`onClose`).

### 6.6 `home/HomeScreen.kt` and `MainActivity.kt` (change)

- `HomeScreen` gets one more parameter after `inbox`: `kids: KidsViewModel`. `Tab.KIDS` shows `KidsScreen(kids)`. `ComingSoonPage` is no longer used: delete it.
- `MainActivity`: `private val kids: KidsViewModel by viewModels()`, cleared with the others on sign-out, passed to `HomeScreen`.

## 7. Steps

As CARD-041 §7 with this card's names: branch `bob/card-043-parent-kids` from the latest `main` (check `docs/cards/CARD-043-parent-kids.md` exists after the pull); copy 5, write 6 in order; `.\gradlew.bat assembleDebug test` until green (fix your code, never the tests); commit `CARD-043: Parent app: Kids tab, devices and add device`; run 8; push; PR (10); wait for CI; handback (12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] `.\gradlew.bat assembleDebug test` → `BUILD SUCCESSFUL`, no `w:` lines in `app-parent` files.
- [ ] The test summary command from CARD-041 §8.1 prints **seven** lines: the six from CARD-041 plus `au.screentime.parent.kids.KidsTest tests="7" failures="0" errors="0"`.
- [ ] `KidsTest.kt` and `ic_arrow_back.xml` are byte-identical to this card.

### 8.2 On the emulator

Paste the **real output of every step** (AGENTS rule 9). A step without output counts as NOT RUN. Any extra command, restart or force-stop goes under "Deviations" with why.

**Setup:** run CARD-041 §8.2 "The emulator" and "The server" blocks exactly (they leave no PIN, and Alex with the pretend PC `alex on Dev PC`), and paste its **Helpers** block, with `$t` set to the `c43` folder. Then also paste this helper. `Enrol` enrols a pretend Android tablet with the code shown on screen, as the kid app would, and prints only the kid's name (never the device token):

```powershell
function Enrol([string]$name) {
  $code = [regex]::Match((Screen-Text), '(\d{3}) (\d{3})').Groups | Select-Object -Skip 1 | ForEach-Object { $_.Value }
  $body = @{ code = ($code -join ''); platform = 'android'; hasCellular = $false; model = $name; osVersion = 'Android 14'; appVersion = 'dev' } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -Uri http://localhost:8080/v1/enrol -ContentType 'application/json' -Body $body
  "enrolled for $($r.kid.name)"
}
```

**The run**, from `android`:

1. Install, sign in, open Kids. Run CARD-041 §8.2 step 1 (install and sign-in) exactly, then:
   ```powershell
   Tap-Text "Kids" 3
   Shot "1-kids"
   Screen-Text
   ```
   `1-kids` shows "Kids", "Schedules, devices and contacts.", a card for Alex (teal "A", "1 device") and one for Sam (violet "S", "No devices"). `Screen-Text` has `Kids | Schedules, devices and contacts. | A | Alex | 1 device | S | Sam | No devices`.
2. Alex's page:
   ```powershell
   Tap-Text "Alex" 3
   Shot "2-kid"
   Screen-Text
   ```
   The back arrow, "A" and "Alex", "Devices" and the line under it, one card with `alex on Dev PC` / `PC · Seen just now` (or `Seen N min ago`) and **Rename** and red **Remove**, the **Add device** button and the web-app line. `Screen-Text` has all those words.
3. Rename the PC:
   ```powershell
   Tap-Desc "Rename alex on Dev PC"
   Shot "3-rename"
   Tap-Text "alex on Dev PC"
   & $adb shell input keyevent KEYCODE_MOVE_END
   1..20 | ForEach-Object { & $adb shell input keyevent KEYCODE_DEL }
   & $adb shell input text "Study%sPC"
   Hide-Keyboard
   Tap-Text "Save" 3
   Screen-Text
   ```
   `3-rename` shows the "Rename device" dialog with the name in a **Name** field. After **Save** the row reads `Study PC`; `Screen-Text` has `Study PC` and no `alex on Dev PC`.
4. Add a tablet:
   ```powershell
   Tap-Text "Add device"
   Shot "4-forms"
   Screen-Text
   Tap-Text "Tablet" 3
   Shot "5-code"
   Screen-Text
   ```
   `4-forms` shows "What are you adding?", the line under it, and Phone, Tablet and PC each with its detail line. `5-code` shows "Add Alex's tablet", the hint, a QR code on white, "Or type this code", six digits as `NNN NNN` in big type and `Works once. Expires in 9:5N` (or `10:00`), and **Cancel**. `Screen-Text` has `Add Alex's tablet | On Alex's tablet, open Screen Time and tap Scan QR code, or type the code. | Or type this code | NNN NNN | Works once. Expires in …`.
5. The tablet enrols; the page sees it:
   ```powershell
   Enrol "Alex's Tablet"
   Start-Sleep -Seconds 5
   Shot "6-connected"
   Screen-Text
   Tap-Text "Done" 3
   Screen-Text
   ```
   `Enrol` prints `enrolled for Alex`. Within 5 seconds `6-connected` shows `Connected: Alex's Tablet` in teal and a **Done** pill. After **Done**, the kid page lists `Alex's Tablet` with `Tablet · Never connected` (or `Seen just now`) under `Study PC`, or above it.
6. Remove the tablet:
   ```powershell
   Tap-Desc "Remove Alex's Tablet"
   Screen-Text
   Tap-Text "Remove" 3
   Shot "7-removed"
   Screen-Text
   ```
   The first `Screen-Text` has `Remove Alex's Tablet? | It is signed out of ScreenTime and stops limiting time. To add it again you need a new code. | Cancel | Remove`. After it, `7-removed` shows only `Study PC`; `Screen-Text` has no `Alex's Tablet`.
7. A PC code has no QR; back goes back:
   ```powershell
   Tap-Text "Add device"
   Tap-Text "PC" 3
   Shot "8-pc-code"
   Screen-Text
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   Screen-Text
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   Screen-Text
   ```
   `8-pc-code` shows "Add Alex's PC", the PC hint, **no** QR code, "The code" and the digits. The second `Screen-Text` is Alex's page (`Devices`, `Study PC`); the third is the Kids list (`Schedules, devices and contacts.`).
8. Undo: CARD-041 §8.2 step 12 exactly.

- [ ] Steps 1 to 8 gave the expected results, with the real output of every command pasted.
- [ ] Eight screenshots in `C:\Users\james\OpenCode\Testing\temp\c43\`: `1-kids`, `2-kid`, `3-rename`, `4-forms`, `5-code`, `6-connected`, `7-removed`, `8-pc-code` (`.png`). Not committed.

### 8.3 Repo

- [ ] `git status` clean of `deploy/.env`, `local.properties`, `build/`, screenshots.
- [ ] CI **Android / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 11 files:
  ```
  android/app-parent/build.gradle.kts
  android/app-parent/src/main/kotlin/au/screentime/parent/MainActivity.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/home/HomeScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/AddDeviceScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/KidScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/Kids.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/KidsScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/kids/KidsViewModel.kt
  android/app-parent/src/main/res/drawable/ic_arrow_back.xml
  android/app-parent/src/test/kotlin/au/screentime/parent/kids/KidsTest.kt
  android/gradle/libs.versions.toml
  ```

## 9. Tests

`KidsTest` (7, copied, unchanged): form names and details; last seen in minutes, hours, days; the countdown and the spaced code; the name rule; which device is new; the add page's title and hint; the QR matrix. The screens are checked by 8.2.

## 10. Git and pull request

As CARD-041 §10 with this card's branch, title and card path, 11 files, seven suites (45 tests), eight screenshots in `temp\c43`. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions"; never change a test. CARD-041 §11 traps still apply (PIN-locked emulator and `-92`, `Pull`, temp files, Emergency 000). New ones:

- **`Unresolved reference: zxing`**: 5.1 not done, or Gradle not re-synced: run the build again from `android`.
- **`KidsTest` `theCodeCountsDownAndReadsInTwoHalves` fails on `9:41`**: the seconds are rounded down; round up with `(ms + 999) / 1000`.
- **Step 3: `Tap-Text "alex on Dev PC"` hits the row, not the field**: the dialog is not open; paste `Screen-Text` and stop.
- **Step 5: no `Connected` after 5 seconds**: wait 5 more seconds and run `Screen-Text` again; if still not, the 3-second poll or `newDevice` is wrong: paste both and stop. If `Enrol` fails with 401 or 409, the code expired or was used: tap **Cancel**, run step 4 again from `Tap-Text "Add device"`, then step 5.
- **Step 7: the first BACK leaves the app**: `BackHandler` is missing on the add page or kid page.

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
Claude, here is Bob's handback for CARD-043. Please review and merge if it is good.

CARD: CARD-043 Parent app: Kids tab, devices and add device
PR: <full PR URL>
Branch: bob/card-043-parent-kids
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
