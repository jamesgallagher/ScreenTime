# CARD-039b: Caught screen without the full-screen hint, and the rest of the CARD-039 run

| Field | Value |
|---|---|
| Card | CARD-039b |
| Title | Caught screen without the full-screen hint, and the rest of the CARD-039 run |
| Size | S |
| Depends on | CARD-039 (tamper detection and the caught screen), merged to `main` |
| Spec sections | docs/SPEC.md §14 ("Tamper detection", "As built (CARD-039)") |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-039b-caught-screen` |
| PR title | `CARD-039b: Caught screen without the full-screen hint` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

CARD-039 (merged) made the kid app detect tamper attempts (the clock set by hand, a Device Owner policy found off, a call stopped while blocked), report them to the server and show the "caught" screen for 8 seconds. Its emulator run found two problems, both in the card, not in Bob's work:

1. **The caught screen hid the status and navigation bars**, so Android put its own "Viewing full screen · To exit, swipe down from the top of your screen · Got it" box on top of it, which dimmed the caught screen for most of its 8 seconds. The fix: the caught screen keeps the bars (its colours go behind them). That is the only code change.
2. **Step 4 could not start the app again**: Android lets nobody force-stop a Device Owner app, so `am force-stop` did nothing and the pretend missing policy was never checked. This card restarts the emulator instead, which is also what really happens when a phone is switched off and on. Steps 5 to 8 of CARD-039 did not run, so this card runs them.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes; the emulator run passes: the caught screen shows with no "Viewing full screen" box; after a reboot the pretend missing policy is found, reported and shows the caught screen; a blocked call shows the caught screen over the block screen in Lock Task and the block screen is back after it; a repeat within a minute does nothing; a blocked call made offline reaches the server within a minute of going back online; the six screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No other change to the app than the one file in section 5. No server, web, `packages/` or `docs/` change. No new dependency.
- Never run the app on a real phone or tablet in this card. Never install a **release** build anywhere.
- **Never tap Emergency 000**, on the emulator or anywhere, and never place a call to an emergency number. The only number you call in this card is `0400111222` (made up).
- No change to the Gradle wrapper files.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a device token, or any key. Never paste a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`. No new library. All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c39b"
New-Item -ItemType Directory -Force $t | Out-Null
```

**If you are ever stuck inside the block screen on the emulator**, this always gets you out: `& $adb shell am task lock stop`.

## 5. Files

Replace exactly this file. The path is relative to the repo root. Copy the code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â`, `â€` or `ðŸ` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `§` (U+00A7) and the emoji of CARD-039; copy them exactly.

| File | Action |
|---|---|
| `android/app-kid/src/main/kotlin/au/screentime/kid/tamper/CaughtActivity.kt` | replace (5.1) |

That is 1 file.

### 5.1 `android/app-kid/src/main/kotlin/au/screentime/kid/tamper/CaughtActivity.kt`

Replace the whole file. Compared with `main`: the two `android.view.WindowInsets…` imports and the four lines in `onCreate` that hid the bars are gone, and the class comment says why.

```kotlin
package au.screentime.kid.tamper

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.animateColor
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import au.screentime.core.ui.ScreenTimeTheme
import au.screentime.kid.service.KidService
import au.screentime.kid.status.StatusHub
import kotlinx.coroutines.delay

/** The two colours the caught screen fades between, like the lights on a police car. */
private val PoliceBlue = Color(0xFF1D4ED8)
private val PoliceRed = Color(0xFFB91C1C)

/**
 * The "caught" screen (docs/SPEC.md §14): after a tamper attempt, cheesy on purpose, over everything for 8 seconds,
 * then it closes itself. Back does nothing. It opens in the block screen's task, so while the device is blocked it
 * sits on top of the block screen in Lock Task, and the block screen is what is left when it closes. The status and
 * navigation bars stay, over its colours: hiding them makes Android show its "Viewing full screen" hint on top, the
 * first time, which covers the screen for most of its 8 seconds.
 */
class CaughtActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })
        setContent {
            val line by StatusHub.caught.collectAsState()
            var left by remember { mutableIntStateOf(CAUGHT_SEC) }
            LaunchedEffect(Unit) {
                while (left > 0) {
                    delay(1_000)
                    left -= 1
                }
                close()
            }
            ScreenTimeTheme {
                line?.let { CaughtScreen(it, left) }
            }
        }
    }

    private fun close() {
        StatusHub.caught.value = null
        Log.i(TAG, "closed")
        finish()
        // Whatever applies now (the block screen, or nothing) shows at once, not at the next tick.
        KidService.syncSoon(this)
    }

    companion object {
        private const val TAG = "CaughtActivity"

        /** Shows [StatusHub.caught], from the service. */
        fun show(context: Context) {
            context.startActivity(Intent(context, CaughtActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

/**
 * Full screen, fading between police blue and red. In the middle: the emoji (96 sp), the headline (34 sp, black
 * weight), the line under it (20 sp), a white "REPORTED" stamp tipped to one side, and "Back in 8 s" counting down.
 */
@Composable
private fun CaughtScreen(line: CaughtLine, left: Int) {
    val lights = rememberInfiniteTransition(label = "lights")
    val background by lights.animateColor(
        initialValue = PoliceBlue,
        targetValue = PoliceRed,
        animationSpec = infiniteRepeatable(tween(600, easing = LinearEasing), RepeatMode.Reverse),
        label = "background",
    )
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
            .safeDrawingPadding()
            .padding(horizontal = 32.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(line.emoji, fontSize = 96.sp)
        Spacer(Modifier.height(24.dp))
        Text(
            text = line.title,
            fontSize = 34.sp,
            lineHeight = 40.sp,
            fontWeight = FontWeight.Black,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = line.body,
            fontSize = 20.sp,
            lineHeight = 28.sp,
            color = Color.White.copy(alpha = 0.9f),
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(40.dp))
        Text(
            text = "REPORTED",
            modifier = Modifier
                .rotate(-8f)
                .border(3.dp, Color.White, RoundedCornerShape(8.dp))
                .padding(horizontal = 16.dp, vertical = 8.dp),
            fontSize = 28.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 4.sp,
            color = Color.White,
        )
        Spacer(Modifier.height(40.dp))
        Text(
            text = "Back in $left s",
            fontSize = 14.sp,
            color = Color.White.copy(alpha = 0.7f),
        )
    }
}
```

## 6. Detailed spec

The caught screen looks as in CARD-039, except that the status bar (time, signal, battery) shows at the top and the navigation handle at the bottom, over the blue and red, and Android shows no "Viewing full screen" box. Nothing else changes. What the run checks is in docs/SPEC.md §14, "As built (CARD-039)", and in the table in section 6 of `docs/cards/CARD-039-tamper.md`.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-039b-caught-screen
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-039b-caught-screen.md` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Replace 5.1. Build and test:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat assembleDebug test
   cd ..
   ```
   Commit: `CARD-039b: Caught screen without the full-screen hint`.
3. Run the acceptance checks in section 8, including the emulator run (8.2), in this session, on a **freshly wiped** emulator.
4. Push and open the PR (section 10).
5. Wait for the CI check to finish (`gh pr checks <number> --watch`).
6. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback. The throwaway `local-dev-only-…` values below are fine, and so are the made-up phone numbers `+61412345678` and `0400111222`.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The tests really ran. From `android`, this prints seventeen lines:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml, app-kid\build\test-results\testDebugUnitTest\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.core.time.DurationFormatTest tests="9" failures="0" errors="0"
  au.screentime.core.time.EngineVectorsTest tests="27" failures="0" errors="0"
  au.screentime.core.model.api.ApiClientTest tests="13" failures="0" errors="0"
  au.screentime.kid.ask.SenderTest tests="5" failures="0" errors="0"
  au.screentime.kid.calls.CallsTest tests="5" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolLinkTest tests="4" failures="0" errors="0"
  au.screentime.kid.enrol.EnrolRulesTest tests="7" failures="0" errors="0"
  au.screentime.kid.live.LiveTest tests="7" failures="0" errors="0"
  au.screentime.kid.parentmode.ParentModeTest tests="9" failures="0" errors="0"
  au.screentime.kid.sos.SosTest tests="9" failures="0" errors="0"
  au.screentime.kid.status.KidStatusTest tests="12" failures="0" errors="0"
  au.screentime.kid.status.WarningTrackerTest tests="5" failures="0" errors="0"
  au.screentime.kid.sync.SyncerTest tests="4" failures="0" errors="0"
  au.screentime.kid.sync.TrustedClockTest tests="4" failures="0" errors="0"
  au.screentime.kid.tamper.TamperTest tests="9" failures="0" errors="0"
  au.screentime.kid.usage.RecorderTest tests="10" failures="0" errors="0"
  au.screentime.kid.usage.TodayInputTest tests="4" failures="0" errors="0"
  ```


### 8.2 On the emulator

Run every step below **in this session**, one after another without long breaks, exactly as written, and paste the **real terminal output** of each step into the handback. A summary is not accepted. If your context was summarised partway through, run the steps again from step 1. Never run `TamperLog` or `& $adb logcat -c` outside the steps: they clear the log that the next step reads. Paste any extra command you ran, with its output, under "Deviations". **Never do this run on a real phone.**

**The emulator.** Start from a **wiped** emulator: `& $adb emu kill`, then start it with `emulator -avd Medium_Phone_API_37.0 -wipe-data` (as in CARD-038c), and do not sign in. Wait until `& $adb devices` lists exactly one `emulator-5554   device` and `& $adb shell getprop sys.boot_completed` prints `1`. Then (the first three commands print an error on a wiped emulator; that is fine):

```powershell
& $adb shell am task lock stop
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
& $adb shell svc wifi enable
& $adb shell svc data enable
```

`& $adb shell pm list packages au.screentime` must print nothing. If it prints `package:au.screentime.kid`, the wipe did not happen: wipe again.

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). `$env:JWT_SECRET` must be the same value as in `deploy\.env`:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
pnpm --filter @screentime/server exec tsx scripts/dev-contacts.ts Alex +61412345678
```

`seed-dev.ts` prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` `dev-contacts.ts` gives Dad the mobile number `+61412345678`. If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`.

Do the run between 6 am and 10 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Set-Clock N` sets the emulator's clock to the PC's time plus N minutes (`Set-Clock 0` puts it right again). `TamperLog` prints the app's tamper, call and policy log lines and the caught screen's `closed` **since the last `TamperLog`**, then clears the log. `Wait-Log` waits until a log line with the given words shows up (it does not clear the log). `Events` prints the tamper events the server has stored. `Add-FakePolicy` pretends a policy named `no_fun` was on after the last start (the app stores what was on in `shared_prefs/policies.xml`): the next start of the app finds it off. `Reboot` restarts the emulator and waits until it has booted: Android lets nobody stop a Device Owner app, so a reboot is the way to start it again. `Call-Number` calls a number as in CARD-036. `Top` prints the screen in front; `LockState` prints whether Lock Task is on.

```powershell
function Tap-Text([string]$text, [int]$wait = 2) {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
  $node = $ui.SelectNodes('//node') | Where-Object { $_.text -eq $text } | Select-Object -First 1
  if (-not $node) { throw "No '$text' on screen" }
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
  Start-Sleep -Seconds $wait
}
function Shot([string]$name) {
  & $adb shell screencap -p /sdcard/shot.png
  & $adb pull /sdcard/shot.png "$t\$name.png" | Out-Null
}
function Open-Link([string]$link) {
  & $adb shell "am start -W -a android.intent.action.VIEW -d '$link' au.screentime.kid"
  Start-Sleep -Seconds 3
}
function Open-App {
  & $adb shell am start -n au.screentime.kid/.MainActivity | Out-Null
  Start-Sleep -Seconds 3
}
function Screen-On {
  & $adb shell input keyevent KEYCODE_WAKEUP
  Start-Sleep -Seconds 1
  & $adb shell wm dismiss-keyguard
  Start-Sleep -Seconds 2
}
function Screen-Off {
  & $adb shell input keyevent KEYCODE_SLEEP
  Start-Sleep -Seconds 5
}
function Bedtime([int]$minutes, [int]$allowance = 720) {
  pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-bedtime.ts Alex $minutes $allowance
}
function Set-Clock([int]$minutes) {
  $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $minutes * 60000
  & $adb shell cmd alarm set-time $ms
  Start-Sleep -Seconds 2
  "PC: {0:HH:mm:ss}  emulator: {1}" -f (Get-Date), (& $adb shell date '+%H:%M:%S')
}
function TamperLog {
  & $adb logcat -d -s KidService:I CallGuard:I Policies:W CaughtActivity:I | Select-String 'tamper:|call:|policies:|CaughtActivity' | ForEach-Object { $_.Line.Trim() }
  & $adb logcat -c
}
function Wait-Log([string]$words, [int]$max = 90) {
  $start = Get-Date
  do {
    Start-Sleep -Seconds 2
    $hit = & $adb logcat -d -s KidService:I | Select-String -SimpleMatch $words | Select-Object -First 1
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($hit -or $seconds -gt $max)
  if ($hit) { "'$words' after {0:N0} s" -f $seconds } else { "No '$words' after $max s" }
}
function Events {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select kind, payload from events where kind like 'tamper.%' order by at"
}
function Add-FakePolicy {
  $xml = (& $adb exec-out run-as au.screentime.kid cat shared_prefs/policies.xml) -join "`n"
  $xml = $xml -replace '<set name="applied">', '<set name="applied"><string>no_fun</string>'
  Set-Content "$t\policies.xml" $xml -Encoding ascii
  & $adb push "$t\policies.xml" /data/local/tmp/policies.xml | Out-Null
  & $adb shell "cat /data/local/tmp/policies.xml | run-as au.screentime.kid sh -c 'cat > shared_prefs/policies.xml'"
  & $adb exec-out run-as au.screentime.kid cat shared_prefs/policies.xml | Select-String -SimpleMatch 'no_fun'
}
function Reboot {
  & $adb reboot
  & $adb wait-for-device
  $start = Get-Date
  do {
    Start-Sleep -Seconds 2
    $done = & $adb shell getprop sys.boot_completed 2>$null
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($done -match '1' -or $seconds -gt 180)
  if ($done -match '1') { "Booted after {0:N0} s" -f $seconds } else { "Not booted after 180 s" }
  Start-Sleep -Seconds 15
}
function Call-Number([string]$number) {
  & $adb shell am start -a android.intent.action.CALL -d "tel:$number" | Out-Null
  Start-Sleep -Seconds 3
}
function Top {
  & $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
}
function LockState {
  & $adb shell dumpsys activity activities | Select-String 'mLockTaskModeState' | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() }
}
function Wait-Blocked([int]$max = 45) {
  $start = Get-Date
  do {
    Start-Sleep -Milliseconds 500
    $top = (& $adb shell dumpsys activity activities | Select-String 'topResumedActivity|ResumedActivity:' | Select-Object -First 1).Line
    $seconds = ((Get-Date) - $start).TotalSeconds
  } until ($top -match 'BlockActivity' -or $seconds -gt $max)
  if ($top -match 'BlockActivity') { "Blocked after {0:N0} s" -f $seconds } else { "Still not blocked after $max s" }
}
```


**The run.** From `android`, one step at a time; check each expected result before the next step.

1. Install, make it Device Owner, and pair. In a second PowerShell window, from the repo root, with the same `$env:DATABASE_URL`, run `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` and copy the `Emulator link`. A code works once, for 10 minutes, and only until the next `docker compose down -v`: make it right before this step. Back in the first window:
   ```powershell
   Bedtime 60
   & $adb install -r -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
   & $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb shell cmd role add-role-holder android.app.role.CALL_REDIRECTION au.screentime.kid
   & $adb logcat -c
   Open-App
   Open-Link "<the emulator link>"
   Tap-Text "Yes"
   Start-Sleep -Seconds 10
   Shot "1-home"
   TamperLog
   Events
   ```
   `1-home` shows the main screen ("Hi Alex", the ring, the red **SOS** circle). `TamperLog` prints **nothing**. `Events` prints `(0 rows)`.
2. The clock set 10 minutes ahead, then put right:
   ```powershell
   Set-Clock 10
   Shot "2-caught-clock"
   Start-Sleep -Seconds 10
   Top
   TamperLog
   Events
   Set-Clock 0
   ```
   The first `Set-Clock` shows the emulator 10 minutes ahead of the PC, the second the PC's time. `2-caught-clock` shows the caught screen: blue, red or purple between them, 🕵️, "Nice try, Agent Alex!", "Dad has been told.", the tilted "REPORTED" stamp and "Back in N s", with the status bar at the top and **no** "Viewing full screen" box. `Top` shows `au.screentime.kid/.MainActivity`. `TamperLog` has `tamper: tamper.clock`, `tamper: caught screen`, `tamper: 1 sent` and `CaughtActivity: closed`. `Events` has one row: `tamper.clock | {"offsetMin": "10"}`.
3. A pretend missing policy, found when the phone starts again. Do not open the app between `Add-FakePolicy` and `Reboot`:
   ```powershell
   Add-FakePolicy
   Reboot
   Screen-On
   Start-Sleep -Seconds 2
   Shot "3-caught-policy"
   Wait-Log "tamper: 1 sent" 90
   Start-Sleep -Seconds 10
   Top
   TamperLog
   Events
   ```
   `Add-FakePolicy` ends with a line that has `<string>no_fun</string>`. `Reboot` prints `Booted after N s`. `3-caught-policy` shows the caught screen with 🚨, "Busted!" and "The Time Police have filed a report.". `Wait-Log` prints `'tamper: 1 sent' after N s`. `Top` does **not** show `CaughtActivity`: it has closed, and the home screen is in front. `TamperLog` has `policies: found off and turned on again: no_fun`, `tamper: tamper.policy`, `tamper: caught screen`, `tamper: 1 sent` and `CaughtActivity: closed`. `Events` has two rows, the second `tamper.policy | {"missing": "no_fun"}`.
4. A call that is not on the list, while blocked:
   ```powershell
   Bedtime 60 0
   Screen-Off
   Screen-On
   Wait-Blocked
   Call-Number 0400111222
   Shot "4-caught-call"
   Top
   LockState
   Start-Sleep -Seconds 10
   Shot "5-back-to-block"
   Top
   LockState
   TamperLog
   Events
   ```
   `Wait-Blocked` prints `Blocked after N s`. `4-caught-call` shows the caught screen with 💻, "Whoa there, hacker!" and "This attempt has been sent to HQ (Dad).". The first `Top` shows `au.screentime.kid/.tamper.CaughtActivity` and the first `LockState` `LOCKED`. `5-back-to-block` shows the block screen ("Out of Phone time"). The second `Top` shows `BlockActivity`, the second `LockState` `LOCKED`. `TamperLog` has `call: blocked`, `tamper: tamper.call_blocked`, `tamper: caught screen`, `tamper: 1 sent` and `CaughtActivity: closed`. `Events` has three rows, the third `tamper.call_blocked | {}`.
5. The same call again within a minute:
   ```powershell
   Call-Number 0400111222
   Top
   TamperLog
   Events
   ```
   `Top` shows `BlockActivity` (no caught screen). `TamperLog` has `call: blocked` and `tamper: tamper.call_blocked again`. `Events` still has three rows.
6. A blocked call with no internet, then back online:
   ```powershell
   & $adb shell svc wifi disable
   & $adb shell svc data disable
   Start-Sleep -Seconds 65
   & $adb logcat -c
   Call-Number 0400111222
   Shot "6-caught-offline"
   Start-Sleep -Seconds 12
   TamperLog
   Events
   & $adb shell svc wifi enable
   & $adb shell svc data enable
   Wait-Log "tamper: 1 sent" 90
   TamperLog
   Events
   ```
   The 65 seconds take the run past the one-minute repeat of step 5. `6-caught-offline` shows the caught screen with 🕵️ and "Nice try, Agent Alex!" again (the fourth one starts the turns again). The first `TamperLog` has `call: blocked`, `tamper: tamper.call_blocked`, `tamper: caught screen` and `CaughtActivity: closed`, and **no** `tamper: 1 sent`. The first `Events` still has three rows. `Wait-Log` prints `'tamper: 1 sent' after N s` with N **60 or less**. The second `TamperLog` has `tamper: 1 sent`. The second `Events` has four rows, the last two `tamper.call_blocked | {}`.
7. Undo, so the emulator can be used again:
   ```powershell
   Set-Clock 0
   & $adb shell svc wifi enable
   & $adb shell svc data enable
   & $adb shell am task lock stop
   & $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
   & $adb uninstall au.screentime.kid
   & $adb shell settings put system screen_off_timeout 60000
   cd ..
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item Env:DATABASE_URL
   Remove-Item Env:JWT_SECRET
   ```
   `remove-active-admin` prints `Success: Admin removed ...`; `uninstall` prints `Success`.

- [ ] Steps 1 to 7 gave the expected results, run in this session. Paste the real output of every helper and command in steps 1 to 6 into the handback (`Set-Clock`, `Add-FakePolicy`, `Reboot`, `Top`, `LockState`, `Wait-Blocked`, `Wait-Log`, `TamperLog`, `Events`).

- [ ] The six screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c39b\`: `1-home.png`, `2-caught-clock.png`, `3-caught-policy.png`, `4-caught-call.png`, `5-back-to-block.png`, `6-caught-offline.png`. Do not commit them. Claude looks at them.


### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/` changed.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png` or `.xml` from the temp folder.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly this 1 file:
  ```
  android/app-kid/src/main/kotlin/au/screentime/kid/tamper/CaughtActivity.kt
  ```


## 9. Tests

No test changes. The 17 suites of CARD-039 (with `TamperTest`, 9 tests) must still pass. The fix and the rest of tamper detection are checked by the emulator run in 8.2.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit (step 2). Message format: `CARD-039b: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-039b-caught-screen`
5. Open a PR into `main` titled `CARD-039b: Caught screen without the full-screen hint`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (create the folder first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-039b-caught-screen --title "CARD-039b: Caught screen without the full-screen hint" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-039b-caught-screen.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] tests ran — output: seventeen suites, TamperTest 9, all `failures="0"`
   - [x] emulator run steps 1 to 7 — results as expected
   - [x] six screenshots in C:\Users\james\OpenCode\Testing\temp\c39b\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 1 file

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
   Only tick a box if you ran the command and saw that output. If you could not run something, leave the box empty and say why.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).


## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first error lines, not the whole log.

Known traps, and what to do:

- **Step 2: `Set-Clock` shows the emulator at the PC's time** (the clock did not move): paste the output of `& $adb shell cmd alarm set-time ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 600000)` and `& $adb shell date`, and stop there.
- **Step 2: the clock moved but `TamperLog` has no `tamper: tamper.clock`**: paste `& $adb logcat -d -s KidService:I | Select-Object -Last 15` (not `TamperLog`) and stop there.
- **A caught screen still has the "Viewing full screen" box**: this card removes exactly that, so it must not happen. Check that 5.1 is copied exactly, paste `git diff main -- android/app-kid/src/main/kotlin/au/screentime/kid/tamper/CaughtActivity.kt`, and stop there.
- **No caught screen in a screenshot, but `TamperLog` has `tamper: caught screen`**: paste `Top` and `& $adb logcat -d -b all | Select-String 'CaughtActivity' | Select-Object -Last 15`, and stop there.
- **`tamper: 1 sent` is missing in steps 2, 3 or 4**: paste `& $adb logcat -d -s KidService:W KidService:I | Select-Object -Last 20` and `docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api --tail 30`, and stop there.
- **Step 3: `Add-FakePolicy` prints no `no_fun` line**: paste `& $adb exec-out run-as au.screentime.kid cat shared_prefs/policies.xml` and the output of `Add-FakePolicy`, and stop there.
- **Step 3: `Reboot` prints `Not booted after 180 s`**, or `adb devices` shows `offline`: use the cold boot steps James gave you for CARD-030b (do not wipe), then go on from `Screen-On`, and say so under "Deviations".
- **Step 3: `3-caught-policy` shows the home screen or the app, not the caught screen**, but `TamperLog` later has `tamper: caught screen`: the caught screen came and went before the shot (the lock screen was not up after the reboot). Say so under "Deviations" and go on.
- **Step 3: no `policies: found off …` line**: paste `& $adb logcat -d -s Policies:W KidService:I | Select-Object -Last 20` and `& $adb exec-out run-as au.screentime.kid cat shared_prefs/policies.xml`, and stop there.
- **Step 4: `Top` shows the phone app's call screen**, or `TamperLog` has `call: allowed`: paste `& $adb shell cmd role get-role-holders android.app.role.CALL_REDIRECTION` and `TamperLog`, end the call with `& $adb shell input keyevent KEYCODE_ENDCALL`, and stop there.
- **Step 4: `5-back-to-block` does not show the block screen**, or the second `LockState` is not `LOCKED`: paste `Top`, `LockState` and `& $adb logcat -d -s KidService:I BlockActivity:I | Select-Object -Last 20`, and stop there.
- **Step 6: `Wait-Log` prints `No 'tamper: 1 sent' after 90 s`**: paste `& $adb logcat -d -s KidService:I KidService:W | Select-Object -Last 30` (not `TamperLog`) and `& $adb shell dumpsys connectivity | Select-String 'Active default network'`, and stop there.
- **The `Events` rows show the payload with other spacing**, for example `{"offsetMin":"10"}`: that is fine.
- **Step 1: the app says "That code didn't work"**: the server turned the code down (used, older than 10 minutes, or made before a `down -v`); the app and the network are fine. Make a new code, run `Open-Link` with the new link once and `Tap-Text "Yes"`, and say so under "Deviations". If the new code fails too, paste `docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api --tail 30` and stop there. Do not try to work out why in your head: run the commands.
- **`Bedtime` says the bedtime would be after midnight**: it is too late in the day. Do the run the next day after 6 am.
- **`wm dismiss-keyguard` does nothing** (the lock screen stays): swipe up with `& $adb shell input swipe 540 1800 540 600` instead and say so under "Deviations".
- **`dpm set-device-owner` says there are accounts, several users, or already provisioned**: wipe the emulator again, do not sign in, and repeat from step 1.
- **`INSTALL_FAILED_TEST_ONLY`**: you left out `-t` in `adb install`.
- **You are stuck in the block screen** and need the emulator back: `& $adb shell am task lock stop`, then `Bedtime 60`.
- **Never tap Emergency 000**, and never run this on a real phone.
- **Temporary files** (the PR body, `ui.xml`, `policies.xml`, the screenshots, any helper scripts) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **Every difference from the card is a deviation**, in any file, including tests, comments and how you ran a check. List each one under "Deviations". If you explain why something happened, say whether you checked it or are guessing.
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-039b. Please review and merge if it is good.

CARD: CARD-039b Caught screen without the full-screen hint
PR: <full PR URL>
Branch: bob/card-039b-caught-screen
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
