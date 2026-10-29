# CARD-042: Parent app: push notifications, parent-mode approval and parent code

| Field | Value |
|---|---|
| Card | CARD-042 |
| Title | Parent app: push notifications, parent-mode approval and parent code |
| Size | M |
| Depends on | CARD-043b, merged to `main` |
| Spec sections | docs/SPEC.md §10 (push), §12.3 (parent mode), §13 (notifications, channels), §16.4 (Parent code) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-042-parent-push` |
| PR title | `CARD-042: Parent app: push notifications, parent-mode approval and parent code` |

## 1. Project context

Read `AGENTS.md` first (rules 8 and 9: temp files go in `C:\Users\james\OpenCode\Testing\temp\`; the handback has the **real output of every emulator step** and lists every workaround). The server already sends pushes with Firebase Cloud Messaging (FCM) when `FIREBASE_SERVICE_ACCOUNT_JSON` is set (CARD-016). To each parent it sends the event exactly as `/v1/events` lists it, wrapped in an envelope `{ "v": 1, "type": <kind>, "at": …, "data": <event> }`, as the one FCM data field `msg`. The parent app does nothing with push yet.

This card makes the parent app:

1. **Get pushes**: start Firebase, send its FCM token to the server (`putMePushToken`) after sign-in and whenever the token changes, ask for the notification permission, make the four channels of SPEC §13, and show each push as a notification with the same words as the Inbox (`eventView`).
2. **Approve parent mode**: tapping a "… asked for parent mode" notification opens a page with **How long?** (2 min, 5 min, 15 min, 1 hour, Until I end it), **Approve** and **Say no**.
3. **Show the parent code**: Settings › **Show parent code** shows the 6-digit code (RFC 6238 TOTP from the family secret) with a 30-second countdown, for a kid device that is offline.

The SOS alarm (full screen, looping sound) is CARD-044; here SOS pushes are plain notifications on the `critical` channel.

**Already on `main` (Claude did them; do not change):** `firebase-bom` 34.0.0 and `firebase-messaging` in `android/gradle/libs.versions.toml` and `app-parent/build.gradle.kts`; and four `BuildConfig` strings, `FIREBASE_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID`, which the build reads from the git-ignored `android/app-parent/google-services.json` (James saved it). Without that file they are empty strings and the app must run without push. There is **no** `google-services` Gradle plugin: the app starts Firebase itself (6.2). `server/scripts/dev-ask.ts` can now also ask for parent mode (`dev-ask.ts Alex parent-mode`).

As in CARD-043: you **copy** the file in section 5 exactly, and you **write** the code from section 6. The test is the contract and must pass unchanged; Claude ran it in CI against its own small implementation. "Copy", "Write" and "Change" mean what CARD-041 §5 says.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `PushTest` (6 tests) and the eight earlier suites unchanged; the emulator run (8.2) passes with its output pasted, including a real push arriving on the emulator; the six screenshots exist; the **Android / build and test** check is green.

## 3. Out of scope

- No change outside `android/app-parent/`. No new library, no `google-services` plugin, no `kotlinx-coroutines-play-services` (use the Task listeners).
- No SOS alarm or full-screen intent (CARD-044). No notification switches screen (later). No kid app change (CARD-034b).
- No storing the parent-code secret on the phone: keep it in memory while the page is open.
- Never run on a real phone, never install a release build, never commit secrets: `deploy/.env`, `deploy/firebase-service-account.json`, `google-services.json`, tokens, `local.properties`. **Never print** the service account key, an FCM token, a sign-in code or a device token: the steps below print only counts.

## 4. Tech

As CARD-043. Firebase: `com.google.firebase.FirebaseApp`, `FirebaseOptions`, `com.google.firebase.messaging.FirebaseMessaging` and `FirebaseMessagingService`. Notifications with the platform `android.app.Notification.Builder` and `NotificationChannel` (minSdk 34, so no compat classes are needed).

## 5. Files

Copy this one. Section 6 says what to write.

### 5.1 `…/test/…/push/PushTest.kt`

Path: `android/app-parent/src/test/kotlin/au/screentime/parent/push/PushTest.kt`.

```kotlin
package au.screentime.parent.push

import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** CARD-042: the parent app's push helpers. Copied verbatim from the card. */
class PushTest {
    private val request = """{"v":1,"type":"parent_mode.request","at":"2026-10-29T03:00:00Z","data":{"id":"e1",""" +
        """"kind":"parent_mode.request","at":"2026-10-29T03:00:00Z","kidId":"k1","kidName":"Alex","deviceId":"d1",""" +
        """"deviceName":"Alex's Pixel 7","payload":{"requestId":"r1"},"extra":true}}"""

    @Test
    fun envelopesBecomeEvents() {
        val e = parseEnvelope(request)!!
        assertEquals("e1", e.id)
        assertEquals("parent_mode.request", e.kind)
        assertEquals("Alex", e.kidName)
        assertEquals("Alex's Pixel 7", e.deviceName)
        assertEquals(JsonPrimitive("r1"), e.payload["requestId"])
        assertEquals("r1", requestIdOf(e))
        assertNull(parseEnvelope(request.replace("\"v\":1", "\"v\":2")))
        assertNull(parseEnvelope("not json"))
        assertNull(parseEnvelope("""{"v":1,"type":"x","at":"2026-10-29T03:00:00Z","data":{}}"""))
    }

    @Test
    fun onlyParentModeRequestsHaveARequestId() {
        val time = parseEnvelope(request.replace("\"kind\":\"parent_mode.request\"", "\"kind\":\"time_request\""))!!
        assertNull(requestIdOf(time))
    }

    @Test
    fun channels() {
        assertEquals("critical", channelFor("sos.started"))
        assertEquals("critical", channelFor("sos.ended"))
        assertEquals("alerts", channelFor("tamper.clock"))
        assertEquals("alerts", channelFor("parent_mode.request"))
        assertEquals("alerts", channelFor("parent_mode.used"))
        assertEquals("requests", channelFor("time_request"))
        assertEquals("requests", channelFor("kid_message"))
        assertEquals("info", channelFor("grant.by_other_parent"))
        assertEquals("info", channelFor("device.enrolled"))
        assertEquals("info", channelFor("overspend"))
    }

    @Test
    fun approvalWords() {
        assertEquals(listOf("2 min", "5 min", "15 min", "1 hour", "Until I end it"), PARENT_MODE_MINUTES.map { durationText(it) })
        assertEquals("Parent mode for Alex?", approveTitle("Alex"))
        assertEquals("Alex's Pixel 7 is asking. Time doesn't count and the device is unlocked while it is on.", approveText("Alex's Pixel 7"))
        assertEquals("A device is asking. Time doesn't count and the device is unlocked while it is on.", approveText(null))
    }

    @Test
    fun parentCodeIsTheRfc6238Code() {
        // RFC 6238 appendix B, SHA-1, the last 6 of the 8 digits. The secret is "12345678901234567890" in base32.
        val secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        assertEquals("287082", codeAt(secret, 59_000L))
        assertEquals("081804", codeAt(secret, 1_111_111_109_000L))
        assertEquals("005924", codeAt(secret, 1_234_567_890_000L))
        assertEquals("279037", codeAt(secret.lowercase(), 2_000_000_000_000L))
        assertNull(codeAt("not base32!", 59_000L))
        assertNull(codeAt("", 59_000L))
    }

    @Test
    fun countdown() {
        assertEquals(30, secondsLeft(0L))
        assertEquals(30, secondsLeft(30_999L))
        assertEquals(1, secondsLeft(29_000L))
        assertEquals(1, secondsLeft(59_999L))
        assertEquals(29, secondsLeft(1_234_567_891_000L))
    }
}
```

## 6. What to write

All in `android/app-parent/src/main/`; Kotlin files under `kotlin/au/screentime/parent/`.

### 6.1 `push/Push.kt` (new)

Pure Kotlin, package `au.screentime.parent.push`; `PushTest` checks it.

- `fun parseEnvelope(msg: String): EventItem?`: parse with `ApiJson`; `null` unless it is a JSON object with `"v": 1` and a `data` object that decodes as `EventItem` (unknown keys ignored). Any exception → `null`.
- Channel ids `const val CHANNEL_CRITICAL = "critical"`, `CHANNEL_ALERTS = "alerts"`, `CHANNEL_REQUESTS = "requests"`, `CHANNEL_INFO = "info"`. `fun channelFor(kind: String): String`: `sos.*` → critical; `tamper.*` and `parent_mode.*` → alerts; `time_request` and `kid_message` → requests; everything else → info.
- `fun requestIdOf(e: EventItem): String?`: the payload's `requestId` string for a `parent_mode.request`, else `null`.
- `val PARENT_MODE_MINUTES: List<Int?> = listOf(2, 5, 15, 60, null)` and `fun durationText(minutes: Int?)`: `"2 min"`, `"5 min"`, `"15 min"`, `"1 hour"`, `"Until I end it"` (as the kid app's `parentmode/ParentMode.kt`).
- `fun approveTitle(kidName: String)`: `"Parent mode for $kidName?"`. `fun approveText(deviceName: String?)`: `"$deviceName is asking. Time doesn't count and the device is unlocked while it is on."`, with `"A device"` for `null`.
- `fun codeAt(secret: String, nowMs: Long): String?`: the 6-digit parent code for the base32 `secret` at `nowMs` (RFC 6238, HMAC-SHA1, 30-second steps), or `null` when the secret is empty or not base32. Port `parentCode` and `base32Decode` from `android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentMode.kt` (do not import from the kid app; the parent app has its own copy).
- `fun secondsLeft(nowMs: Long): Int`: seconds until the next code, `30 - (nowMs mod 30 000) / 1000`, so 30 down to 1.

### 6.2 `push/Firebase.kt` (new)

`object Push` with:

- `fun start(context: Context): Boolean`: `false` when `BuildConfig.FIREBASE_APP_ID` is empty. Otherwise, if `FirebaseApp.getApps(context)` is empty, `FirebaseApp.initializeApp(context, FirebaseOptions.Builder().setApplicationId(BuildConfig.FIREBASE_APP_ID).setApiKey(BuildConfig.FIREBASE_API_KEY).setProjectId(BuildConfig.FIREBASE_PROJECT_ID).setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID).build())`; then `true`. Remember the answer in a `started` property.
- `fun register(session: Session, scope: CoroutineScope)`: does nothing unless `started`. `FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> scope.launch { send(session, token) } }`.
- `suspend fun send(session: Session, token: String)`: `session.call { putMePushToken(PushTokenPut(token)) }`; rethrow `CancellationException`; any other exception is logged with `Log.w("Push", "token not sent: ${e.javaClass.simpleName}")` (never the token) and dropped: the next start sends it again.

### 6.3 `push/Notifications.kt` (new)

- `fun createChannels(context: Context)`: four `NotificationChannel`s with `NotificationManager.createNotificationChannels`: `critical` "SOS" `IMPORTANCE_HIGH` with `setBypassDnd(true)`; `alerts` "Alerts" `IMPORTANCE_HIGH`; `requests` "Requests" `IMPORTANCE_DEFAULT`; `info` "Other news" `IMPORTANCE_LOW`. Descriptions: "When a kid presses SOS.", "Parent mode and tamper alerts.", "Time requests and messages from the kids.", "Everything else, like a new device or the other parent's changes.".
- `fun show(context: Context, e: EventItem)`: `val v = eventView(e, ZoneId.systemDefault())` (from `inbox/Inbox.kt`). Build `Notification.Builder(context, channelFor(e.kind))` with `setSmallIcon(R.drawable.ic_inbox)`, `setContentTitle(v.text)`, `setContentText(v.detail)` (when not null), `setWhen(Instant.parse(e.at).toEpochMilli())`, `setShowWhen(true)`, `setAutoCancel(true)` and a content intent: `PendingIntent.getActivity(context, e.id.hashCode(), intent, FLAG_IMMUTABLE or FLAG_UPDATE_CURRENT)`, where `intent` is `Intent(context, MainActivity::class.java)` with, for a `parent_mode.request` (`requestIdOf(e) != null`), the extras `EXTRA_REQUEST_ID`, `EXTRA_KID_NAME` (`e.kidName ?: "your kid"`) and `EXTRA_DEVICE_NAME` (`e.deviceName`). Post it with `NotificationManager.notify(e.id.hashCode(), …)`. Without the permission Android drops it, which is fine.
- `const val EXTRA_REQUEST_ID = "au.screentime.parent.REQUEST_ID"`, `EXTRA_KID_NAME = "au.screentime.parent.KID_NAME"`, `EXTRA_DEVICE_NAME = "au.screentime.parent.DEVICE_NAME"`.

### 6.4 `push/ParentPushService.kt` (new)

`class ParentPushService : FirebaseMessagingService()`:

- `onMessageReceived(message)`: `message.data["msg"]?.let(::parseEnvelope)?.let { show(this, it) }`.
- `onNewToken(token)`: when `(application as ParentApp).session.state.value is SessionState.SignedIn`, `CoroutineScope(Dispatchers.IO).launch { Push.send(session, token) }`.

### 6.5 `push/ParentModeScreen.kt` (new)

```kotlin
/** A parent-mode request opened from its notification. */
data class ParentModeAsk(val requestId: String, val kidName: String, val deviceName: String?)
```

`class ParentModeViewModel(app: Application) : AndroidViewModel(app)` with `suspend fun approve(requestId: String, minutes: Int?): String?` (`postParentModeRequestsApprove(requestId, ParentModeStart(minutes))`) and `suspend fun deny(requestId: String): String?` (`postParentModeRequestsDeny(requestId)`): `null` when it worked, else `answerError(e)` from `inbox/Inbox.kt` (a 409 there already says "Someone already answered this request."). Run each in `viewModelScope.async { … }.await()` and rethrow `CancellationException`, as `KidsViewModel.rename`.

`@Composable fun ParentModeScreen(ask: ParentModeAsk, vm: ParentModeViewModel, onDone: () -> Unit)`. `BackHandler(onBack = onDone)`. State: `minutes` (starts at 15), `busy`, `error`, `done: String?`.

`Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp))`:

1. `approveTitle(ask.kidName)` (`headlineSmall`, `FontWeight.SemiBold`); 8 dp; `approveText(ask.deviceName)` (`bodyLarge`, muted).
2. When `done` is null: 24 dp; `"How long?"` (`titleMedium`, `FontWeight.SemiBold`); one row per `PARENT_MODE_MINUTES`: `Row(Modifier.fillMaxWidth().selectable(selected = …, onClick = …, role = Role.RadioButton).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically)` with a `RadioButton(selected, onClick = null)`, 12 dp, `durationText(m)` (`bodyLarge`). Then the error (critical colour, `bodyMedium`) when there is one; 24 dp; a full-width pill `Button` `"Approve"` (`heightIn(min = 48.dp)`, disabled while busy); 8 dp; a full-width `OutlinedButton` `"Say no"`.
   - **Approve** → `vm.approve(ask.requestId, minutes)`; `null` → `done = "Done. ${ask.deviceName ?: "The device"} is in parent mode ${if (minutes == null) "until you end it" else "for " + durationText(minutes)}."`.
   - **Say no** → `vm.deny(ask.requestId)`; `null` → `done = "Done. You said no to ${ask.deviceName ?: "the device"}."`.
3. When `done` is set: 24 dp; `done` (`titleMedium`, `MaterialTheme.colorScheme.primary`); 24 dp; a full-width pill `Button` `"Close"` → `onDone()`.

### 6.6 `home/ParentCodeScreen.kt` (new)

`@Composable fun ParentCodeScreen(onBack: () -> Unit)`. `BackHandler(onBack = onBack)`. Get the session with `(LocalContext.current.applicationContext as ParentApp).session`. `LaunchedEffect(Unit)` loads `session.call { getFamilyParentCode() }.secret` into a `secret: String?` (an error sets `error = "Can't reach Screen Time. Check the internet connection."`; rethrow `CancellationException`). `now` ticks every second as in `AddDeviceScreen`.

Layout: the top row as `KidScreen`'s, without the avatar, with `"Parent code"`; then `Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally)`:

- `"Type this on the kid's device to start parent mode when it can't reach the internet."` (`bodyLarge`, muted, centred).
- Loading: `CircularProgressIndicator()`. Error: `Problem(error) { retry }` from `today/`.
- Otherwise: 24 dp; `spacedCode(codeAt(secret, now)!!)` (from `kids/Kids.kt`) in `fontSize = 48.sp`, `FontWeight.SemiBold`, `letterSpacing = 2.sp`, with `Modifier.semantics { contentDescription = "Parent code" }`; 16 dp; a `Row` with `CircularProgressIndicator(progress = { secondsLeft(now) / 30f }, modifier = Modifier.size(24.dp))`, 8 dp, and `"New code in ${secondsLeft(now)}s"` (`bodyMedium`, muted).

Use `System.currentTimeMillis()` for `now` (the phone's clock; the kid device checks one step either side).

### 6.7 Changes

- **`ParentApp.kt`**: after making the session, `Push.start(this)` and `createChannels(this)`.
- **`AndroidManifest.xml`**: `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`, and inside `<application>`:
  ```xml
  <!-- FCM pushes for the parent (docs/SPEC.md §13, CARD-042). -->
  <service
      android:name=".push.ParentPushService"
      android:exported="false">
      <intent-filter>
          <action android:name="com.google.firebase.MESSAGING_EVENT" />
      </intent-filter>
  </service>
  ```
- **`MainActivity.kt`**:
  - `private val parentMode: ParentModeViewModel by viewModels()` and `private var ask by mutableStateOf<ParentModeAsk?>(null)`.
  - `askFrom(intent)` in `onCreate` and in `override fun onNewIntent(intent: Intent)` (call `super`, then `setIntent(intent)`): when the intent has `EXTRA_REQUEST_ID`, set `ask` from the three extras and remove them from the intent.
  - A `registerForActivityResult(ActivityResultContracts.RequestPermission()) { }` launcher. In the `LaunchedEffect(state)`: when `state is SessionState.SignedIn`, call `Push.register(session, lifecycleScope)` and, if `POST_NOTIFICATIONS` is not granted, launch the permission request.
  - In the signed-in branch, when the app is not locked and `ask != null`: show `ParentModeScreen(ask!!, parentMode) { ask = null }` in place of `HomeScreen`. On sign-out set `ask = null`.
- **`home/SettingsScreen.kt`**: a new `SettingsCard("Parent code")` above the sign-out card, with `"For a kid's device that can't reach the internet."` (`bodyMedium`, muted) and a `TextButton` `"Show parent code"`. It sets a `rememberSaveable` flag that shows `ParentCodeScreen { flag = false }` in place of the Settings column.

## 7. Steps

As CARD-041 §7 with this card's names: branch `bob/card-042-parent-push` from the latest `main` (check `docs/cards/CARD-042-parent-push.md` exists after the pull); copy 5, write 6 in order; `.\gradlew.bat assembleDebug test` until green (fix your code, never the tests); commit `CARD-042: Parent app: push notifications, parent-mode approval and parent code`; run 8; push; PR (10); wait for CI; handback (12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] `.\gradlew.bat assembleDebug test` → `BUILD SUCCESSFUL`, no `w:` lines in `app-parent` files.
- [ ] The test summary command from CARD-041 §8.1 prints **nine** lines: the eight from CARD-043b plus `au.screentime.parent.push.PushTest tests="6" failures="0" errors="0"`.
- [ ] `PushTest.kt` is byte-identical to this card.

### 8.2 On the emulator

Paste the **real output of every step** (AGENTS rule 9). A step without output counts as NOT RUN. Any extra command, restart or force-stop goes under "Deviations" with why. **Run `Hide-Keyboard` before every tap on a text field** after typing in another one.

**Setup.**

1. Check the files and the emulator. From the repo root:
   ```powershell
   Test-Path android\app-parent\google-services.json
   Test-Path deploy\firebase-service-account.json
   ```
   Both print `True`. If not, stop and ask James.
2. CARD-041 §8.2 "The emulator" block exactly, then `& $adb shell pm list packages com.google.android.gms`, which must print `package:com.google.android.gms` (FCM needs Google Play services). If it prints nothing, the emulator image has no Google Play: stop and say so.
3. The server, with Firebase. From the repo root (this replaces CARD-041's server block; it never prints the key):
   ```powershell
   Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
   $env:FIREBASE_SERVICE_ACCOUNT_JSON = Get-Content deploy\firebase-service-account.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 5
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
   (docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String 'Firebase is not configured').Count
   $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
   $env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
   pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
   ```
   The `Count` line prints `0` (the server has the key). Then the seed line as in CARD-041.
4. Paste CARD-041 §8.2 **Helpers** with `$t` set to the `c42` folder, and CARD-043b's `Db` helper, plus:
   ```powershell
   function Ask([string]$what) {
     Push-Location ..
     pnpm --filter @screentime/server exec tsx scripts/dev-ask.ts $what.Split(' ')
     Pop-Location
   }
   function Shade {
     & $adb shell cmd statusbar expand-notifications
     Start-Sleep -Seconds 2
   }
   ```

**The run**, from `android`, all in one PowerShell session (keep the environment variables set):

1. Install (no `-g`), sign in, allow notifications, token sent:
   ```powershell
   & $adb install -r app-parent\build\outputs\apk\debug\app-parent-debug.apk
   Open-App
   Tap-Text "Email"
   & $adb shell input text "dad@example.com"
   Hide-Keyboard
   Tap-Text "Send code" 4
   $code = Code
   Tap-Text "Code"
   & $adb shell input text $code
   Hide-Keyboard
   Tap-Text "Sign in" 6
   Shot "1-permission"
   Screen-Text
   Tap-Text "Allow" 5
   Db "select count(*) from parent_sessions where fcm_token is not null and revoked_at is null"
   & $adb shell dumpsys notification | Select-String "mId='(critical|alerts|requests|info)'" | Measure-Object | Select-Object -ExpandProperty Count
   ```
   `1-permission` shows Android's "Allow Screen Time Parent to send you notifications?" over Today. After **Allow**, `Db` prints `1` (one session with a token; never print the token). The last line prints 4 or more (the four channels exist).
2. A parent-mode request while the app is in the background:
   ```powershell
   & $adb shell input keyevent KEYCODE_HOME
   Ask "Alex parent-mode"
   Start-Sleep -Seconds 5
   Shade
   Shot "2-push"
   Screen-Text
   ```
   `Ask` prints `Alex asked for parent mode from "Alex's Dev Phone".`. `2-push` shows the notification shade with **Screen Time Parent** and `Alex asked for parent mode on Alex's Dev Phone`. `Screen-Text` has that line.
3. Approve for 5 minutes:
   ```powershell
   Tap-Text "Alex asked for parent mode on Alex's Dev Phone" 4
   Shot "3-approve"
   Screen-Text
   Tap-Text "5 min"
   Tap-Text "Approve" 4
   Screen-Text
   Db "select method, duration_min, started_at is not null from parent_mode_sessions order by requested_at desc limit 1"
   Tap-Text "Close" 2
   Screen-Text
   ```
   `3-approve` shows `Parent mode for Alex?`, `Alex's Dev Phone is asking. …`, `How long?` with five radio rows (15 min selected), **Approve** and **Say no**. After **Approve**: `Done. Alex's Dev Phone is in parent mode for 5 min.`; `Db` prints `push|5|t`. After **Close**, Today (`Screen-Text` starts with `Today`).
4. A no, and a time request on the `requests` channel:
   ```powershell
   & $adb shell input keyevent KEYCODE_HOME
   Ask "Alex parent-mode"
   Ask "Sam 30 Homework"
   Start-Sleep -Seconds 5
   Shade
   Shot "4-two"
   Screen-Text
   Tap-Text "Alex asked for parent mode on Alex's Dev Phone" 4
   Tap-Text "Say no" 4
   Screen-Text
   Db "select method, coalesce(duration_min, 0), started_at is not null from parent_mode_sessions order by requested_at desc limit 1"
   Tap-Text "Close" 2
   ```
   `4-two` shows both notifications: `Sam asked for 30m more Phone` (with `“Homework”` under it) and Alex's parent-mode line. After **Say no**: `Done. You said no to Alex's Dev Phone.`; `Db` prints `push|0|f`.
5. Answered elsewhere: the 409 words.
   ```powershell
   & $adb shell input keyevent KEYCODE_HOME
   Ask "Alex parent-mode"
   Start-Sleep -Seconds 5
   Push-Location ..; pnpm --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Alex no; Pop-Location
   Shade
   Tap-Text "Alex asked for parent mode on Alex's Dev Phone" 4
   Tap-Text "Approve" 4
   Shot "5-late"
   Screen-Text
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   ```
   `5-late` shows the page with `Someone already answered this request.` in red above **Approve**. BACK goes to Today.
6. The parent code matches the server's:
   ```powershell
   Tap-Text "Settings" 2
   Tap-Text "Show parent code" 3
   Shot "6-code"
   Screen-Text
   Push-Location ..; pnpm --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Alex code; Pop-Location
   Screen-Text
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   Screen-Text
   ```
   `6-code` shows `Parent code`, the line under it, six digits as `NNN NNN` in big type, a small ring and `New code in Ns`. The code the script prints equals the digits in one of the two `Screen-Text`s (the code changes every 30 s). BACK shows Settings again (`Signed in as`).
7. Undo: CARD-041 §8.2 step 12 exactly, then `Remove-Item Env:FIREBASE_SERVICE_ACCOUNT_JSON`.

- [ ] Setup and steps 1 to 7 gave the expected results, with the real output of every command pasted.
- [ ] Six screenshots in `C:\Users\james\OpenCode\Testing\temp\c42\`: `1-permission`, `2-push`, `3-approve`, `4-two`, `5-late`, `6-code` (`.png`). Not committed.

### 8.3 Repo

- [ ] `git status` clean of `deploy/.env`, `deploy/firebase-service-account.json`, `google-services.json`, `local.properties`, `build/`, screenshots.
- [ ] CI **Android / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 11 files:
  ```
  android/app-parent/src/main/AndroidManifest.xml
  android/app-parent/src/main/kotlin/au/screentime/parent/MainActivity.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/ParentApp.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/home/ParentCodeScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/home/SettingsScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/push/Firebase.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/push/Notifications.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/push/ParentModeScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/push/ParentPushService.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/push/Push.kt
  android/app-parent/src/test/kotlin/au/screentime/parent/push/PushTest.kt
  ```

## 9. Tests

`PushTest` (6, copied, unchanged): envelopes to events; the request id; the channels; the approval words; the parent code against RFC 6238; the countdown. The rest is checked by 8.2 with a real push.

## 10. Git and pull request

As CARD-041 §10 with this card's branch, title and card path, 11 files, nine suites (60 tests), six screenshots in `temp\c42`. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions"; never change a test. CARD-041 §11 traps still apply. New ones:

- **Setup 3: `Count` prints `1`**: the key did not reach the server. Check `$env:FIREBASE_SERVICE_ACCOUNT_JSON.Length` is over 1000 (print only the length), then run the `down -v` and `up` lines again from the same window.
- **Step 1: no permission dialog**: the request is not launched after sign-in, or the app was installed with `-g`. Fix the code.
- **Step 1: `Db` prints `0`**: wait 10 s and run it again. Still `0`: run `& $adb logcat -d -s Push FirebaseMessaging | Select-Object -Last 20` and paste it (it must not contain a token); `FIREBASE_APP_ID` may be empty because `google-services.json` was missing at build time: build again.
- **Step 2: no notification after 5 s**: wait 10 s more and `Shade` again. Still none: paste `docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api --tail 20` (it names a push error, never the key) and stop.
- **Step 3: tapping the notification opens Today, not the approval page**: the extras are not read in `onNewIntent`, or the `PendingIntent` request code is the same for every notification.

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
Claude, here is Bob's handback for CARD-042. Please review and merge if it is good.

CARD: CARD-042 Parent app: push notifications, parent-mode approval and parent code
PR: <full PR URL>
Branch: bob/card-042-parent-push
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
