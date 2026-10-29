# CARD-034b: Kid app: push (FCM)

| Field | Value |
|---|---|
| Card | CARD-034b |
| Title | Kid app: push (FCM) |
| Size | S |
| Depends on | CARD-042, merged to `main` |
| Spec sections | docs/SPEC.md §8.3 (live channel), §10 (push and WebSocket messages), §13 (kid device notifications) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-034b-kid-push` |
| PR title | `CARD-034b: Kid app: push (FCM)` |

## 1. Project context

Read `AGENTS.md` first (rules 8 and 9: temp files go in `C:\Users\james\OpenCode\Testing\temp\`; the handback has the **real output of every emulator step** and lists every workaround). The kid app (`android/app-kid`) hears the server over its WebSocket (`live/LiveChannel.kt`, CARD-034): every frame goes to the `onNews` lambda in `service/KidService.kt`, which handles answers, parent mode and SOS and then syncs. When the socket is down (the phone dozing, a bad network), the kid misses news until the next sync. The server already sends the same envelopes by FCM to every Android device that has a push token (`PUT /v1/device/push-token`, CARD-016/017), as the one data field `msg`.

This card makes the kid app:

1. Start Firebase, send its FCM token to the server when the service starts and whenever the token changes.
2. Treat a push exactly like a WebSocket frame: hand `msg` to the same `onNews`.
3. Show "Dad added 15 min of Phone time" when a parent changes time (`grant_added`), on the existing **Answers from your parents** channel. SPEC §10: every Android push that changes time shows a notification, which keeps FCM high priority from being downgraded.

**Already on `main` (Claude did them; do not change):** `firebase-messaging` in `app-kid/build.gradle.kts`, and the four `BuildConfig` strings `FIREBASE_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID`, read from the git-ignored `android/app-kid/google-services.json` (James saved it). Without that file they are empty and the app runs without push. No `google-services` plugin: the app starts Firebase itself, exactly as the parent app's `push/Firebase.kt` does (CARD-042).

As in CARD-042: you **copy** the file in section 5 exactly, and you **write** the code from section 6. The test is the contract and must pass unchanged; Claude ran it in CI against its own small implementation. "Copy", "Write" and "Change" mean what CARD-041 §5 says.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with `KidPushTest` (3 tests) and every earlier `app-kid` suite unchanged; the emulator run (8.2) shows a real push reaching the kid app, also while the emulator is in deep sleep; the three screenshots exist; the **Android / build and test** check is green.

## 3. Out of scope

- No change outside `android/app-kid/`. No new library, no `google-services` plugin.
- No new notification channel; no change to how answers, parent mode or SOS are handled (they already work from `onNews`).
- No change to the live channel. Push is extra, not a replacement.
- Never run on a real phone, never install a release build, never commit secrets (`deploy/.env`, `deploy/firebase-service-account.json`, `google-services.json`, tokens). **Never print** the service account key, an FCM token or a device token.

## 4. Tech

As CARD-039b and CARD-042. `FirebaseMessagingService` runs in the app's process; the kid app is Device Owner, which lets it start its foreground service from the background.

## 5. Files

Copy this one. Section 6 says what to write.

### 5.1 `…/test/…/push/KidPushTest.kt`

Path: `android/app-kid/src/test/kotlin/au/screentime/kid/push/KidPushTest.kt`.

```kotlin
package au.screentime.kid.push

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** CARD-034b: what the kid app makes of a `grant_added` push. Copied verbatim from the card. */
class KidPushTest {
    private fun frame(minutes: Int, pool: String = "phone", requestId: String? = null, type: String = "grant_added") =
        """{"v":1,"type":"$type","at":"2026-10-29T05:00:00Z","data":{"byName":"Dad","grant":{"id":"g1","pool":"$pool",""" +
            """"minutes":$minutes,"day":"2026-10-29","createdAt":"2026-10-29T05:00:00Z","byName":"Dad","note":null,""" +
            """"requestId":${requestId?.let { "\"$it\"" } ?: "null"}}}}"""

    @Test
    fun grantsAreRead() {
        assertEquals(GrantNews("g1", "phone", 15, "Dad", false), grantNewsOf(frame(15)))
        assertEquals(GrantNews("g1", "screens", -90, "Dad", false), grantNewsOf(frame(-90, "screens")))
        assertEquals(GrantNews("g1", "phone", 30, "Dad", true), grantNewsOf(frame(30, requestId = "r1")))
    }

    @Test
    fun otherFramesAreNotGrants() {
        assertNull(grantNewsOf(frame(15, type = "state_changed")))
        assertNull(grantNewsOf("""{"v":1,"type":"grant_added","at":"2026-10-29T05:00:00Z","data":{}}"""))
        assertNull(grantNewsOf("not json"))
        assertNull(grantNewsOf("[1,2]"))
    }

    @Test
    fun theNotificationWords() {
        assertEquals("Dad added 15 min of Phone time", grantText(GrantNews("g", "phone", 15, "Dad", false)))
        assertEquals("Mum added 2h of Screens time", grantText(GrantNews("g", "screens", 120, "Mum", false)))
        assertEquals("Dad took away 1h 30m of Screens time", grantText(GrantNews("g", "screens", -90, "Dad", false)))
        // A yes to "Ask for more time" already shows "Dad said yes!", so its grant shows nothing more.
        assertNull(grantText(GrantNews("g", "phone", 30, "Dad", true)))
        assertNull(grantText(GrantNews("g", "phone", 0, "Dad", false)))
    }
}
```

## 6. What to write

All in `android/app-kid/src/main/`; Kotlin files under `kotlin/au/screentime/kid/`.

### 6.1 `push/KidPush.kt` (new)

Pure Kotlin, package `au.screentime.kid.push`; `KidPushTest` checks it. Parse by hand with `kotlinx.serialization.json`, as `answerOf` in `live/Live.kt` does.

- `data class GrantNews(val grantId: String, val pool: String, val minutes: Int, val byName: String, val fromRequest: Boolean)`.
- `fun grantNewsOf(frame: String): GrantNews?`: for a `grant_added` envelope, the `data.grant` object's `id`, `pool` (`"screens"` or `"phone"`), `minutes`, `byName`, and `fromRequest` = its `requestId` is not null. `null` for any other type, a missing field, or text that is not a JSON object (catch `IllegalArgumentException`).
- `fun grantText(news: GrantNews): String?`: `null` when `fromRequest` (the "Dad said yes!" answer already shows) or `minutes == 0`; else `"$byName added <amount> of <Pool> time"` for more minutes and `"$byName took away <amount> of <Pool> time"` for fewer, where `<amount>` is `minutesText(abs(minutes))` from `status/KidStatus.kt` (`"15 min"`, `"2h"`, `"1h 30m"`) and `<Pool>` is `Phone` or `Screens`.

### 6.2 `push/KidFirebase.kt` (new)

`object KidFirebase` with `fun start(context: Context): Boolean` exactly as the parent app's `Push.start` (`android/app-parent/src/main/kotlin/au/screentime/parent/push/Firebase.kt`), using `au.screentime.kid.BuildConfig`, and `fun token(onToken: (String) -> Unit)`: does nothing unless started, else `FirebaseMessaging.getInstance().token.addOnSuccessListener { onToken(it) }`.

### 6.3 `push/KidPushService.kt` (new)

`class KidPushService : FirebaseMessagingService()`:

- `onCreate()`: `KidFirebase.start(this)`, then `super.onCreate()`.
- `onMessageReceived(message)`: `message.data["msg"]?.let { KidService.push(this, it) }`.
- `onNewToken(token)`: `KidService.newToken(this)`.

### 6.4 `service/KidService.kt` (change)

- Move the `onNews = { frame -> … }` lambda's body into `private fun onNews(frame: String?)` and pass `onNews = ::onNews`. In it, **before** the existing lines, add: `frame?.let(::grantNewsOf)?.let(::grantText)?.let(notifier::showGrant)`.
- Two new actions in the companion, next to `ACTION_SYNC`: `ACTION_PUSH = "au.screentime.kid.action.PUSH"` with `EXTRA_FRAME = "frame"`, and `ACTION_PUSH_TOKEN = "au.screentime.kid.action.PUSH_TOKEN"`. Helpers `fun push(context: Context, frame: String)` and `fun newToken(context: Context)`, which use `context.startForegroundService(…)` (the app may be in the background; it is Device Owner, so this is allowed).
- `onStartCommand`: `ACTION_PUSH` → `intent.getStringExtra(EXTRA_FRAME)?.let { Log.i(TAG, "push: news"); onNews(it) }`. `ACTION_PUSH_TOKEN` → `sendToken()`.
- In `onCreate`, after `started = true`: `KidFirebase.start(this)` and `sendToken()`.
- `private fun sendToken()`: `KidFirebase.token { token -> scope.launch { … } }`, where the coroutine calls `api.putDevicePushToken(PushTokenPut(token))` and logs `Log.i(TAG, "push: token sent")`; rethrow `CancellationException`; any other exception logs `Log.w(TAG, "push: token not sent: ${e.javaClass.simpleName}")` (never the token). The next start tries again.

### 6.5 `service/Notifier.kt` (change)

`fun showGrant(text: String)`: like `showAnswer` (the `answers` channel, `ic_status`, the open-app intent, auto-cancel, gone after a minute), with `setContentTitle(text)` and its own id `GRANT_ID = 4` (check that 4 is not already used in `Notifier`; if it is, take the next free number). One id for every grant: a newer grant replaces the last one, and the same grant from the socket and from FCM shows once.

### 6.6 `AndroidManifest.xml` (change)

Inside `<application>`, after the `KidService` service:

```xml
<!-- FCM pushes, handed to KidService like a WebSocket frame (docs/SPEC.md §10, CARD-034b). -->
<service
    android:name=".push.KidPushService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

## 7. Steps

As CARD-041 §7 with this card's names: branch `bob/card-034b-kid-push` from the latest `main` (check `docs/cards/CARD-034b-kid-push.md` exists after the pull); copy 5, write 6 in order; `.\gradlew.bat assembleDebug test` until green (fix your code, never the tests); commit `CARD-034b: Kid app: push (FCM)`; run 8; push; PR (10); wait for CI; handback (12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] `.\gradlew.bat assembleDebug test` → `BUILD SUCCESSFUL`, no `w:` lines in `app-kid` files.
- [ ] The test summary command from CARD-041 §8.1, with `app-kid` in place of `app-parent` in its path, prints every earlier `app-kid` suite with `failures="0" errors="0"`, plus `au.screentime.kid.push.KidPushTest tests="3" failures="0" errors="0"`. Paste it all.
- [ ] `KidPushTest.kt` is byte-identical to this card.

### 8.2 On the emulator

Paste the **real output of every step** (AGENTS rule 9). A step without output counts as NOT RUN. Any extra command, restart or force-stop goes under "Deviations" with why.

**Setup.**

1. `Test-Path android\app-kid\google-services.json` and `Test-Path deploy\firebase-service-account.json` both print `True`. If not, stop and ask James.
2. CARD-039b §8.2 "The emulator" block exactly (a **wiped** emulator), then `& $adb shell pm list packages com.google.android.gms`, which must list `package:com.google.android.gms`.
3. The server: CARD-042 §8.2 setup 3 exactly (it sets `$env:FIREBASE_SERVICE_ACCOUNT_JSON`, so the `Count` line prints `0`, and seeds the family).
4. Paste CARD-039b §8.2 **Helpers** with `$t` set to the `c34b` folder (only `Tap-Text`, `Shot`, `Open-Link`, `Open-App`, `Screen-On`, `Screen-Off` and `Wait-Log` are used), and CARD-043b's `Db` helper, plus these. `Titles` prints the title of every notification the kid app is showing now.
   ```powershell
   function Titles {
     & $adb shell dumpsys notification --noredact | Select-String 'pkg=au.screentime.kid|android.title=' | ForEach-Object { $_.Line.Trim() } | Select-String 'android.title='
   }
   function Grant([string]$pool, [int]$minutes) {
     pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-grant.ts Alex $pool $minutes
   }
   function Shade {
     & $adb shell cmd statusbar expand-notifications
     Start-Sleep -Seconds 2
   }
   function PushLog {
     & $adb logcat -d -s KidService:I KidService:W | Select-String 'push:' | ForEach-Object { $_.Line.Trim() }
     & $adb logcat -c
   }
   ```

**The run**, from `android`, all in one PowerShell session:

1. Install, make it Device Owner, pair; the token reaches the server. As CARD-039b §8.2 step 1, but **without** its `Bedtime 60`, and with `TamperLog` and `Events` replaced:
   ```powershell
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb shell cmd role add-role-holder android.app.role.CALL_REDIRECTION au.screentime.kid
   & $adb logcat -c
   Open-App
   Open-Link "<the emulator link>"
   Tap-Text "Yes"
   Wait-Log "push: token sent"
   Shot "1-home"
   Db "select count(*) from devices where fcm_token is not null and revoked_at is null"
   PushLog
   ```
   `Wait-Log` prints `'push: token sent' after N s`. `1-home` shows "Hi Alex". `Db` prints `1`. `PushLog` prints the `push: token sent` line and no `token not sent`.
2. A grant arrives by push, and shows the notification:
   ```powershell
   & $adb shell input keyevent KEYCODE_HOME
   Grant phone 15
   Wait-Log "push: news"
   Shade
   Shot "2-grant"
   Titles
   PushLog
   & $adb shell input keyevent KEYCODE_BACK
   ```
   `Grant` prints that Dad added 15 minutes of Phone for Alex. `Wait-Log` finds `push: news` within 30 s. `2-grant` shows the shade with **Dad added 15 min of Phone time**; `Titles` has `android.title=String (Dad added 15 min of Phone time)` **once** (the socket and FCM both brought it; one id), next to the status notification's title. `PushLog` has at least one `push: news`.
3. Deep sleep: the socket is cut, the push still gets through:
   ```powershell
   Screen-Off
   & $adb shell dumpsys deviceidle force-idle
   Start-Sleep -Seconds 5
   & $adb logcat -c
   Grant screens -30
   Wait-Log "push: news" 60
   & $adb shell dumpsys deviceidle unforce
   Screen-On
   Shade
   Shot "3-doze"
   Titles
   PushLog
   ```
   `force-idle` prints `Now forced in to deep idle mode`. `Wait-Log` finds `push: news` within 60 s. `3-doze` shows **Dad took away 30 min of Screens time**; `Titles` has it and no longer the 15-minute one (it replaced it). `unforce` prints `Light state: ACTIVE, deep state: ACTIVE` or similar.
4. Undo: CARD-039b §8.2 step 7 exactly, then `Remove-Item Env:FIREBASE_SERVICE_ACCOUNT_JSON`.

- [ ] Setup and steps 1 to 4 gave the expected results, with the real output of every command pasted.
- [ ] Three screenshots in `C:\Users\james\OpenCode\Testing\temp\c34b\`: `1-home`, `2-grant`, `3-doze` (`.png`). Not committed.

### 8.3 Repo

- [ ] `git status` clean of `deploy/.env`, `deploy/firebase-service-account.json`, `google-services.json`, `local.properties`, `build/`, screenshots.
- [ ] CI **Android / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 7 files:
  ```
  android/app-kid/src/main/AndroidManifest.xml
  android/app-kid/src/main/kotlin/au/screentime/kid/push/KidFirebase.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/push/KidPush.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/push/KidPushService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt
  android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt
  android/app-kid/src/test/kotlin/au/screentime/kid/push/KidPushTest.kt
  ```

## 9. Tests

`KidPushTest` (3, copied, unchanged): grants read from the envelope; other frames are not grants; the notification words. The rest is checked by 8.2 with a real push.

## 10. Git and pull request

As CARD-041 §10 with this card's branch, title and card path, 7 files, three screenshots in `temp\c34b`. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions"; never change a test. CARD-039b §11 and CARD-042 §11 traps still apply (the enrol code works once for 10 minutes; `Count` must be `0`). New ones:

- **Step 1: no `push: token sent` in 90 s**: run `PushLog`; a `token not sent` names the error. No line at all: `FIREBASE_APP_ID` is empty because `google-services.json` was missing at build time, or `sendToken()` is not called after `started = true`. Paste and stop.
- **Step 2: the notification shows twice**: `showGrant` does not use the one `GRANT_ID`.
- **Step 2: `push: news` never comes but the notification shows**: the socket brought it, FCM did not. Paste `docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api --tail 20` (it names a push error, never the key) and stop.
- **Step 3: `force-idle` says the screen is on**: run `Screen-Off` again, wait 5 s, and repeat `force-idle`.

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
Claude, here is Bob's handback for CARD-034b. Please review and merge if it is good.

CARD: CARD-034b Kid app: push (FCM)
PR: <full PR URL>
Branch: bob/card-034b-kid-push
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
