# CARD-044: Parent app: SOS alarm

| Field | Value |
|---|---|
| Card | CARD-044 |
| Title | Parent app: SOS alarm |
| Size | M |
| Depends on | CARD-042 and CARD-034b, merged to `main` |
| Spec sections | docs/SPEC.md §13 (parent notifications, the `critical` channel), §15 (SOS), §16 (parent app) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-044-sos-alarm` |
| PR title | `CARD-044: Parent app: SOS alarm` |

## 1. Project context

Read `AGENTS.md` first (rules 8 and 9: temp files go in `C:\Users\james\OpenCode\Testing\temp\`; the handback has the **real output of every emulator step** and lists every workaround). When a kid holds SOS on their phone, the server writes `sos.started` and pushes it to every parent app (CARD-020, CARD-016). Today the parent app (`android/app-parent`) shows it like any other push: one notification on the `critical` channel (CARD-042). That is not enough for "my kid needs help".

This card makes `sos.started`:

1. **Ring**: the phone's alarm sound, looping on the alarm stream, plus vibration, until this parent taps **I'm on it**, **Silence alarm** or **End SOS**, or the SOS ends.
2. **Take the screen**: a full-screen red SOS page, over the lock screen, with the kid's last position, battery, **Open in Maps**, who is on it, **I'm on it**, **Keep on 2 more hours** and **End SOS**. It reads `GET /v1/sos/{id}` every 30 s and whenever an `sos.*` push arrives.
3. **Stay visible**: a red banner at the top of the app while any SOS is on.

Settings gets an **SOS alarm** card with the two Android permissions the alarm needs (full-screen alerts, Do Not Disturb access).

**Already on `main` (Claude did it; do not change):** `server/scripts/dev-ask.ts Alex sos` starts an SOS from a pretend phone at a Sydney position, so the emulator can ring without a kid phone. `scripts/dev-sos.ts Alex end` ends it as Dad.

As in CARD-042: you **copy** the file in section 5 exactly, and you **write** the code from section 6. The test is the contract and must pass unchanged; Claude ran it in CI against its own small implementation. "Copy", "Write" and "Change" mean what CARD-041 §5 says.

**Not in this card:** "Call Alex" from SPEC §15.5. The server does not store a kid's own phone number, so there is nothing to dial; it comes later with a number field on the kid.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `SosTest` (5 tests) and the nine earlier `app-parent` suites unchanged; the emulator run (8.2) shows the alarm ringing and the SOS page over the lock screen from a real push; the six screenshots exist; the **Android / build and test** check is green.

## 3. Out of scope

- No change outside `android/app-parent/`. No new library, no sound file (use Android's own alarm sound).
- No change to other notifications, the Inbox words (`inbox/Inbox.kt` already has the `sos.*` lines) or the kid app.
- No "Call Alex" (see section 1). No map inside the app: **Open in Maps** hands a `geo:` link to the phone's maps app.
- Never run on a real phone, never install a release build, never commit secrets (`deploy/.env`, `deploy/firebase-service-account.json`, `google-services.json`, tokens). **Never print** the service account key, an FCM token or a session token.

## 4. Tech

As CARD-042. The alarm plays from a foreground service (`foregroundServiceType="mediaPlayback"`). Android lets an app start one from a high-priority FCM message, which `sos.started` is. The SOS page is an activity with `showWhenLocked` and `turnScreenOn`, opened by the notification's full-screen intent.

## 5. Files

Copy this one. Section 6 says what to write.

### 5.1 `…/test/…/sos/SosTest.kt`

Path: `android/app-parent/src/test/kotlin/au/screentime/parent/sos/SosTest.kt`.

```kotlin
package au.screentime.parent.sos

import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.SosAck
import au.screentime.core.model.api.SosLocation
import au.screentime.core.model.api.SosLocationVia
import au.screentime.parent.push.parseEnvelope
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** CARD-044: the parent app's SOS words and rules. Copied verbatim from the card. */
class SosTest {
    private fun event(kind: String, payload: String): EventItem = parseEnvelope(
        """{"v":1,"type":"$kind","at":"2026-10-29T03:00:00Z","data":{"id":"e1","kind":"$kind",""" +
            """"at":"2026-10-29T03:00:00Z","kidId":"k1","kidName":"Alex","deviceId":"d1",""" +
            """"deviceName":"Alex's Pixel 7","payload":$payload}}""",
    )!!

    private val now = Instant.parse("2026-10-29T03:10:00Z")

    private fun loc(at: String, accuracy: Double?, battery: Int?, via: SosLocationVia) =
        SosLocation(at = at, lat = -33.8688, lng = 151.2093, accuracyM = accuracy, batteryPct = battery, via = via)

    @Test
    fun whichEventsRing() {
        val started = event("sos.started", """{"sosId":"s1","startedAt":"2026-10-29T03:00:00Z","location":null}""")
        assertEquals("s1", sosIdOf(started))
        assertTrue(ringsAlarm(started))
        assertFalse(stopsAlarm(started))
        val acked = event("sos.acked", """{"sosId":"s1","byName":"Mum"}""")
        assertEquals("s1", sosIdOf(acked))
        assertFalse(ringsAlarm(acked))
        assertFalse(stopsAlarm(acked))
        val ended = event("sos.ended", """{"sosId":"s1","endedBy":"kid","byName":null}""")
        assertFalse(ringsAlarm(ended))
        assertTrue(stopsAlarm(ended))
        assertNull(sosIdOf(event("time_request", """{"sosId":"s1"}""")))
        assertFalse(ringsAlarm(event("sos.started", """{}""")))
    }

    @Test
    fun timeWords() {
        assertEquals("SOS from Alex", sosTitle("Alex"))
        assertEquals("just now", agoText(Instant.parse("2026-10-29T03:09:30Z"), now))
        assertEquals("just now", agoText(Instant.parse("2026-10-29T03:11:00Z"), now))
        assertEquals("1 min ago", agoText(Instant.parse("2026-10-29T03:09:00Z"), now))
        assertEquals("10 min ago", agoText(Instant.parse("2026-10-29T03:00:00Z"), now))
        assertEquals("1h 5m ago", agoText(Instant.parse("2026-10-29T02:05:00Z"), now))
    }

    @Test
    fun locationWords() {
        assertEquals("No location yet", locationText(null, now))
        val good = loc("2026-10-29T03:09:00Z", 19.6, 54, SosLocationVia.DATA)
        assertEquals("-33.86880, 151.20930 · ±20 m · 1 min ago", locationText(good, now))
        assertEquals("Battery 54%", batteryText(good))
        val text = loc("2026-10-29T03:00:00Z", null, null, SosLocationVia.SMS)
        assertEquals("-33.86880, 151.20930 · 10 min ago · by text", locationText(text, now))
        assertNull(batteryText(text))
        assertNull(batteryText(null))
        assertEquals("geo:0,0?q=-33.86880,151.20930(Alex)", mapsUri(good, "Alex"))
        assertEquals("geo:0,0?q=-33.86880,151.20930(Al ex)", mapsUri(good, "Al (ex)"))
    }

    @Test
    fun whoIsOnIt() {
        fun ack(name: String) = SosAck(parentId = name, byName = name, at = "2026-10-29T03:01:00Z")
        assertEquals("No one has said they're on it yet", acksText(emptyList()))
        assertEquals("Mum is on it", acksText(listOf(ack("Mum"))))
        assertEquals("Mum and Dad are on it", acksText(listOf(ack("Mum"), ack("Dad"))))
        assertEquals("Mum, Dad and Nan are on it", acksText(listOf(ack("Mum"), ack("Dad"), ack("Nan"))))
        assertEquals("Mum is on it", acksText(listOf(ack("Mum"), ack("Mum"))))
    }

    @Test
    fun endedWords() {
        assertEquals("Alex said they're safe", endedText("kid", null, "Alex"))
        assertEquals("Ended by Dad", endedText("parent", "Dad", "Alex"))
        assertEquals("Ended by a parent", endedText("parent", null, "Alex"))
        assertEquals("Stopped by itself", endedText("auto", null, "Alex"))
    }
}
```

## 6. What to write

All in `android/app-parent/src/main/`; Kotlin files under `kotlin/au/screentime/parent/`. Log with tag `Sos` (`Log.i("Sos", …)`), and never log a token.

### 6.1 `sos/Sos.kt` (new)

Pure Kotlin, package `au.screentime.parent.sos`; `SosTest` checks every function. Read the test first: it is the exact contract for each string.

- `fun sosIdOf(e: EventItem): String?`: the payload's string `sosId` when `e.kind` starts with `sos.`, else null. Same style as `requestIdOf` in `push/Push.kt`.
- `fun ringsAlarm(e: EventItem): Boolean`: `sos.started` **with** an `sosId`.
- `fun stopsAlarm(e: EventItem): Boolean`: `sos.ended`.
- `fun sosTitle(kidName: String): String`: `"SOS from Alex"`.
- `fun agoText(at: Instant, now: Instant): String`: whole minutes between them, never below 0. Under 1: `"just now"`. Under 60: `"N min ago"`. Else `"Hh Mm ago"`.
- `fun locationText(loc: SosLocation?, now: Instant): String`: null gives `"No location yet"`. Otherwise these parts joined by `" · "`: lat and lng with 5 decimals (`String.format(Locale.ROOT, "%.5f, %.5f", …)`); `"±N m"` with the accuracy rounded, only when there is one; `agoText(loc.at)`; `"by text"` only when `via` is `sms`.
- `fun batteryText(loc: SosLocation?): String?`: `"Battery 54%"`, or null.
- `fun mapsUri(loc: SosLocation, kidName: String): String`: `"geo:0,0?q=<lat>,<lng>(<name>)"`, with 5 decimals and no comma space, and `(` and `)` removed from the name.
- `fun acksText(acks: List<SosAck>): String`: the distinct `byName`s, oldest first. None: `"No one has said they're on it yet"`. One: `"Mum is on it"`. Two or more: `"Mum, Dad and Nan are on it"`.
- `fun endedText(endedBy: String?, byName: String?, kidName: String): String`: `endedBy` is the wire value. `"kid"` gives `"Alex said they're safe"`. `"parent"` gives `"Ended by Dad"`, or `"Ended by a parent"` without a name. Anything else gives `"Stopped by itself"`.

### 6.2 `sos/SosAlarm.kt` (new)

**`object SosNews`**: `val changed = MutableStateFlow(0)`. `fun bump()` adds 1. The SOS page and the banner reload when it changes.

**`class SosAlarm : Service()`**, a foreground service:

- `onStartCommand` with `ACTION_RING` and the extras `EXTRA_SOS_ID`, `EXTRA_KID_NAME` and `EXTRA_DEVICE_NAME`:
  - Build the notification on `CHANNEL_CRITICAL`. Title `sosTitle(kidName)`, text `"On <device name>. Tap to see where."`, `ic_inbox`, category `Notification.CATEGORY_ALARM`, ongoing.
  - Its content intent **and** its full-screen intent both open `SosActivity` with the same extras, with `PendingIntent.FLAG_IMMUTABLE or FLAG_UPDATE_CURRENT` and request code `sosId.hashCode()`.
  - Call `startForeground(ALARM_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)` with `ALARM_ID = 9001`.
  - Then start the sound, unless it is already playing: a `MediaPlayer` with `AudioAttributes` usage `USAGE_ALARM` and content type `CONTENT_TYPE_SONIFICATION`. The source is `RingtoneManager.getDefaultUri(TYPE_ALARM)`, or `TYPE_RINGTONE` when that is null. Set `isLooping = true` and use `prepare()` then `start()`.
  - Also vibrate with `Vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 400), 0), <the same alarm AudioAttributes>)`.
  - Log `sos: alarm on`. Remember the SOS id.
- `ACTION_STOP`: when the sound is playing, stop and release the player, cancel the vibration and log `sos: alarm off`. Always `stopForeground(STOP_FOREGROUND_REMOVE)` and `stopSelf()`. A stop when nothing plays logs nothing. `onDestroy` releases the player too, if one is left, and logs nothing.
- Any exception while starting the sound is logged as `sos: no sound: <class simple name>`. The notification and page still show.
- Companion:
  - `fun ring(context: Context, sosId: String, kidName: String, deviceName: String?)`: `context.startForegroundService(…)`.
  - `fun stop(context: Context)`: `context.startService(…)` with `ACTION_STOP`, inside `try` so it does nothing when the service is not running (catch `IllegalStateException`).
  - `val ringing = MutableStateFlow<String?>(null)`: the SOS id while the alarm plays. Set it when the sound starts, and clear it on stop.

### 6.3 `sos/SosActivity.kt` (new)

`class SosActivity : ComponentActivity()`. In `onCreate`, **before** `setContent`, call `setShowWhenLocked(true)` and `setTurnScreenOn(true)`. Read the SOS id from `EXTRA_SOS_ID`, and handle `onNewIntent` (a newer SOS replaces the page's id). Content is `ScreenTimeTheme { SosScreen(...) }`. The session is `(application as ParentApp).session`, and this parent's id is `(session.state.value as? SessionState.SignedIn)?.me?.parent?.id`. Not signed in: the page shows only the title, `"Sign in to Screen Time Parent to see this SOS."` and **Close**.

**Loading:** call `session.call { getSosById(id) }` at once, then every 30 s while started (`repeatOnLifecycle(STARTED)`), and again each time `SosNews.changed` changes. A failure keeps the last good SOS and shows the line `"Can't reach the server. Trying again…"`. Before the first answer: a centred white progress spinner. When the SOS comes back `ended`, call `SosAlarm.stop`.

**Layout** (portrait, `Column` filling the screen, `verticalScroll`, padding 24 dp, background `ScreenTimeTheme.colors.danger`, all text white):

1. `sosTitle(kidName)`, 32 sp bold. While active, the line under it is `"Started <timeOfDay> · <agoText>"`, with `timeOfDay` from `inbox/Inbox.kt`, 16 sp. When ended, the line is `"SOS ended"`, 24 sp bold, then `endedText(...)`.
2. 16 dp gap. A card (`Surface`, white at 15% alpha, 16 dp rounded corners, 16 dp padding) holding:
   - `"Last seen"` (14 sp, 80% alpha).
   - `locationText(lastLocation, now)` (18 sp).
   - `batteryText` when not null (16 sp).
   - **Open in Maps**: an `OutlinedButton` with a white border and white text, only when there is a location. It starts `Intent(ACTION_VIEW, Uri.parse(mapsUri(...)))`. When no app can take it (`ActivityNotFoundException`), show a `Toast`: `"No maps app on this phone."`.
3. 16 dp gap. `acksText(acks)` (16 sp).
4. 24 dp gap. Buttons, each full width, at least 56 dp tall, 12 dp apart. While active:
   - **I'm on it**: a filled `Button`, white with `danger` text, bold 18 sp. It calls `postSosAck`, then `SosAlarm.stop`, then reloads. When this parent's id is already in `acks`, show `"✓ You're on it"` (18 sp bold, centred) in its place.
   - **Silence alarm**: a `TextButton` with white text, only while `SosAlarm.ringing` equals this SOS's id. It calls `SosAlarm.stop` only (nothing is sent).
   - **Keep on 2 more hours**: an outlined white button. It calls `postSosExtend`, then reloads.
   - **End SOS**: an outlined white button. It opens the dialog below.
   When ended, the only button is **Close** (`finish()`).
5. A failed action shows its error in white, 14 sp, under the buttons. Use `answerError(e)` from `inbox/Inbox.kt` (a 409 gives its "already" words). Then reload.

**End dialog:** an `AlertDialog` with title `"End Alex's SOS?"`, text `"Only end it when you know Alex is safe. Everyone gets told."`, confirm button **Yes, end it** (`postSosEnd`, then `SosAlarm.stop`, then reload) and dismiss button **Cancel**.

Back closes the page; it does not stop the alarm.

### 6.4 `push/ParentPushService.kt` (change)

In `onMessageReceived`, after parsing:

- `ringsAlarm(e)`: `SosAlarm.ring(this, sosIdOf(e)!!, e.kidName ?: "Your kid", e.deviceName)`. Do **not** also call `show` (the alarm's notification is the one notification).
- `stopsAlarm(e)`: `SosAlarm.stop(this)`, then `show(this, e)`.
- Otherwise `show(this, e)` as now.
- Then, for any event with an `sosIdOf(e)`, call `SosNews.bump()`.

### 6.5 `push/Notifications.kt` (change)

In `show`, when `sosIdOf(e)` is not null, the intent opens `SosActivity` (with `EXTRA_SOS_ID`, `EXTRA_KID_NAME`, `EXTRA_DEVICE_NAME`) instead of `MainActivity`. Put the three extra names in `sos/SosAlarm.kt`'s companion as `const val`s (`"au.screentime.parent.SOS_ID"`, `"au.screentime.parent.SOS_KID"`, `"au.screentime.parent.SOS_DEVICE"`) and use them everywhere.

### 6.6 `home/HomeScreen.kt` (change)

Load `session.call { getSos(active = true) }` in the same loop that loads the Inbox, and again when `SosNews.changed` changes. Ignore failures and keep the last list. Pass the `Session` in as a new parameter from `MainActivity.kt` (the one call to `HomeScreen`).

While the list is not empty, show a banner at the very top, above the tab content. Use one row per active SOS, newest first, as a `Surface` in `danger` colour, at least 56 dp tall, with 16 dp horizontal padding. Each row has white bold 16 sp `"SOS from Alex is on"`, then at the end a white `TextButton` **See it** that opens `SosActivity` with the extras.

### 6.7 `home/SettingsScreen.kt` (change)

A new `SettingsCard("SOS alarm")` above "Parent code" holds two rows. Each row is a `Row` with the label on the left (16 sp) and, on the right, either `"On"` in `muted` colour or a `TextButton` **Turn on**:

- **Full-screen alerts**: on when `NotificationManager.canUseFullScreenIntent()` is true. **Turn on** opens `Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` with `data = Uri.parse("package:au.screentime.parent")`.
- **Ring in Do Not Disturb**: on when `NotificationManager.isNotificationPolicyAccessGranted` is true. **Turn on** opens `Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS`.

Under the rows, in `muted` 14 sp: `"So an SOS rings and fills the screen, even when the phone is locked or quiet."`. Read both values again on every `ON_RESUME`, so coming back from Android's page shows **On**.

### 6.8 `AndroidManifest.xml` (change)

Add these permissions next to the others: `USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `VIBRATE`, `ACCESS_NOTIFICATION_POLICY`. Inside `<application>`, after `ParentPushService`:

```xml
<!-- The SOS page, over the lock screen (docs/SPEC.md §15, CARD-044). -->
<activity
    android:name=".sos.SosActivity"
    android:exported="false"
    android:launchMode="singleTop"
    android:excludeFromRecents="true"
    android:showWhenLocked="true"
    android:turnScreenOn="true" />

<!-- Rings the SOS alarm until a parent answers (docs/SPEC.md §15, CARD-044). -->
<service
    android:name=".sos.SosAlarm"
    android:exported="false"
    android:foregroundServiceType="mediaPlayback" />
```

## 7. Steps

As CARD-041 §7 with this card's names. Branch `bob/card-044-sos-alarm` from the latest `main`, and check `docs/cards/CARD-044-sos-alarm.md` exists after the pull. Copy section 5, then write section 6 in order. Run `.\gradlew.bat assembleDebug test` until green: fix your code, never the tests. Commit as `CARD-044: Parent app: SOS alarm`. Run section 8, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] `.\gradlew.bat assembleDebug test` → `BUILD SUCCESSFUL`, with no `w:` lines in `app-parent` files.
- [ ] The test summary command from CARD-041 §8.1 prints the nine earlier `app-parent` suites with `failures="0" errors="0"`, plus `au.screentime.parent.sos.SosTest tests="5" failures="0" errors="0"`. Paste it all.
- [ ] `SosTest.kt` is byte-identical to this card.

### 8.2 On the emulator

Paste the **real output of every step** (AGENTS rule 9). A step without output counts as NOT RUN. Any extra command, restart, retry or script change goes under "Deviations" with why. **Run `Hide-Keyboard` before every tap on a text field** after typing in another one. If a step fails, paste its output and stop: retry a step **at most once**.

**Setup.** CARD-042 §8.2 setup 1 to 4 exactly, with `$t` set to the `c44` folder. Setup 3 keeps `$env:DATABASE_URL` and `$env:JWT_SECRET` set in the same window; every helper below needs them. Then add these helpers:

```powershell
function Screen-On {
  & $adb shell input keyevent KEYCODE_WAKEUP
  Start-Sleep -Seconds 2
}
function Screen-Off {
  & $adb shell input keyevent KEYCODE_SLEEP
  Start-Sleep -Seconds 2
}
function SosLog {
  & $adb logcat -d -s Sos:I Sos:W | Select-String 'sos:' | ForEach-Object { $_.Line.Trim() }
}
function Wait-Sos([string]$line, [int]$seconds = 30) {
  for ($i = 0; $i -lt $seconds; $i++) {
    if (& $adb logcat -d -s Sos:I | Select-String -SimpleMatch $line) { "'$line' after $i s"; return }
    Start-Sleep -Seconds 1
  }
  "No '$line' after $seconds s"
}
function SosCli([string]$what) {
  Push-Location ..
  pnpm --filter @screentime/server exec tsx scripts/dev-sos.ts $what.Split(' ')
  Pop-Location
}
function Top {
  & $adb shell dumpsys activity activities | Select-String 'topResumedActivity' | ForEach-Object { $_.Line.Trim() }
}
```

**The run**, from `android`, all in one PowerShell session:

1. Install, sign in and allow notifications: CARD-042 §8.2 step 1 exactly (`Shot "1-permission"` included). `Db` prints `1`.
2. The Settings card:
   ```powershell
   Tap-Text "Settings" 2
   Shot "2-settings"
   Screen-Text
   & $adb shell appops set au.screentime.parent USE_FULL_SCREEN_INTENT allow
   & $adb shell cmd notification allow_dnd au.screentime.parent
   & $adb shell input keyevent KEYCODE_HOME
   Open-App
   Screen-Text
   Tap-Text "Today" 2
   ```
   The first `Screen-Text` has `SOS alarm`, `Full-screen alerts`, `Ring in Do Not Disturb` and the line under them; each row says `On` or `Turn on`. After the two `adb` lines and coming back, both rows say `On`.
3. A locked phone rings and shows the SOS page:
   ```powershell
   Screen-Off
   & $adb logcat -c
   Ask "Alex sos"
   Wait-Sos "sos: alarm on"
   Start-Sleep -Seconds 3
   Shot "3-locked"
   Top
   Screen-Text
   & $adb shell dumpsys audio | Select-String 'usage=USAGE_ALARM' | Select-Object -First 2 | ForEach-Object { $_.Line.Trim() }
   ```
   `Ask` prints `Alex started an SOS from "Alex's Dev Phone".`. `Wait-Sos` finds `sos: alarm on` within 30 s. The screen turned on by itself. `3-locked` shows the red page with `SOS from Alex`, `Started …`, `Last seen`, `-33.86880, 151.20930 · ±20 m · just now`, `Battery 54%`, **Open in Maps**, `No one has said they're on it yet`, **I'm on it**, **Silence alarm**, **Keep on 2 more hours** and **End SOS**. `Top` names `au.screentime.parent/.sos.SosActivity`. The `dumpsys audio` lines show at least one player with `usage=USAGE_ALARM`.
4. I'm on it:
   ```powershell
   Tap-Text "I'm on it" 4
   Wait-Sos "sos: alarm off"
   Shot "4-on-it"
   Screen-Text
   SosCli "Alex show"
   ```
   `Wait-Sos` finds `sos: alarm off`. `4-on-it` shows `✓ You're on it` and `Dad is on it`, with no **Silence alarm**. `SosCli` shows the SOS with an ack by Dad.
5. End it:
   ```powershell
   Tap-Text "End SOS" 2
   Screen-Text
   Tap-Text "Yes, end it" 4
   Shot "5-ended"
   Screen-Text
   Db "select ended_by_kind from sos_incidents order by started_at desc limit 1"
   Tap-Text "Close" 2
   Top
   ```
   The dialog shows `End Alex's SOS?`, its text, **Yes, end it** and **Cancel**. `5-ended` shows `SOS ended` and `Ended by Dad`, with only **Close**. `Db` prints `parent`. After **Close**, `Top` no longer names `SosActivity`.
6. The app is open, the banner shows, and the SOS ends from elsewhere:
   ```powershell
   Open-App
   & $adb logcat -c
   Ask "Alex sos"
   Wait-Sos "sos: alarm on"
   Start-Sleep -Seconds 2
   Shot "6-banner"
   & $adb shell cmd statusbar collapse
   Start-Sleep -Seconds 1
   Screen-Text
   Tap-Text "See it" 4
   Tap-Text "Silence alarm" 2
   Wait-Sos "sos: alarm off"
   SosCli "Alex end"
   Start-Sleep -Seconds 8
   Screen-Text
   Tap-Text "Close" 2
   Start-Sleep -Seconds 3
   Screen-Text
   SosLog
   ```
   `6-banner` shows the SOS heads-up or the SOS page. Android picks one when the phone is in use, and either is fine. After the collapse, `Screen-Text` has `SOS from Alex is on` and **See it**, unless the page is already up; if it is, skip `Tap-Text "See it"` and say so. **Silence alarm** gives `sos: alarm off`. After `SosCli "Alex end"`, the page shows `SOS ended` and `Ended by Dad` within 8 s, because the push reloads it. After **Close**, the last `Screen-Text` has no `SOS from Alex is on`. `SosLog` shows `sos: alarm on` and `sos: alarm off` once each, and no `no sound`.
7. Undo: CARD-042 §8.2 step 7 exactly.

- [ ] Setup and steps 1 to 7 gave the expected results, with the real output of every command pasted.
- [ ] Six screenshots in `C:\Users\james\OpenCode\Testing\temp\c44\`: `1-permission`, `2-settings`, `3-locked`, `4-on-it`, `5-ended`, `6-banner` (`.png`). Not committed.

### 8.3 Repo

- [ ] `git status` clean of `deploy/.env`, `deploy/firebase-service-account.json`, `google-services.json`, `local.properties`, `build/`, screenshots.
- [ ] CI **Android / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 10 files:
  ```
  android/app-parent/src/main/AndroidManifest.xml
  android/app-parent/src/main/kotlin/au/screentime/parent/MainActivity.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/home/HomeScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/home/SettingsScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/push/Notifications.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/push/ParentPushService.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/sos/Sos.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/sos/SosActivity.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/sos/SosAlarm.kt
  android/app-parent/src/test/kotlin/au/screentime/parent/sos/SosTest.kt
  ```

## 9. Tests

`SosTest` has 5 tests, copied unchanged. They cover which events ring and stop the alarm, the time words, the location, battery and maps words, who is on it, and the ended words. Step 8.2 checks the rest with a real push.

## 10. Git and pull request

As CARD-041 §10, with this card's branch, title and card path, 10 files, ten suites, and six screenshots in `temp\c44`. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". Never change a test. The CARD-041 §11 and CARD-042 §11 traps still apply. New ones:

- **Step 3: no `sos: alarm on`**: run `SosLog` and `& $adb logcat -d -s FirebaseMessaging AndroidRuntime | Select-Object -Last 20` and paste both. A `ForegroundServiceStartNotAllowedException` means the service was started some way other than from `onMessageReceived`.
- **Step 3: the alarm logs on but the screen stays off**: full-screen alerts are off. Paste `& $adb shell appops get au.screentime.parent USE_FULL_SCREEN_INTENT`, then do step 2's two `adb` lines and run step 3 once more.
- **Step 3: `Ask` says 409**: an SOS from an earlier try is still on. Run `SosCli "Alex end"` and try again once.
- **Step 4: the sound keeps going after I'm on it**: `SosAlarm.stop` is not called, or `ACTION_STOP` does not release the player.
- **Step 6: the page does not change after `SosCli "Alex end"`**: `SosNews.bump()` is not called, or the page does not collect `SosNews.changed`.

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
Claude, here is Bob's handback for CARD-044. Please review and merge if it is good.

CARD: CARD-044 Parent app: SOS alarm
PR: <full PR URL>
Branch: bob/card-044-sos-alarm
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
