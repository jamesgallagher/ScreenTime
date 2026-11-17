# CARD-062 emulator run. Run from the repo root with: pwsh -File docs\cards\CARD-062-run.ps1
# It wipes the emulator and the development database. Every line it prints goes into the handback.
param([string]$Repo = (Get-Location).Path)
$ErrorActionPreference = 'Stop'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$adb = "$sdk\platform-tools\adb.exe"
$t = Join-Path (Split-Path $Repo) 'temp'
New-Item -ItemType Directory -Force $t | Out-Null
$parentApk = "$Repo\android\app-parent\build\outputs\apk\debug\app-parent-debug.apk"
$parent = 'au.screentime.parent'
$failed = 0

function Check([string]$name, [bool]$ok) {
    if ($ok) { Write-Output "PASS $name" } else { Write-Output "FAIL $name"; $script:failed++ }
}
function Tap-Text([string]$text, [int]$wait = 2) {
    & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
    & $adb pull /sdcard/ui.xml "$t\ui.xml" 2>&1 | Out-Null
    [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
    $node = $ui.SelectNodes('//node') | Where-Object { $_.text -eq $text } | Select-Object -First 1
    if (-not $node) { throw "No '$text' on screen" }
    $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
    & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
    Start-Sleep -Seconds $wait
}
function Screen-Text {
    & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
    & $adb pull /sdcard/ui.xml "$t\ui.xml" 2>&1 | Out-Null
    [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
    ($ui.SelectNodes('//node') | Where-Object { $_.text } | ForEach-Object { $_.text }) -join ' | '
}
function Shot([string]$name) {
    & $adb shell screencap -p /sdcard/shot.png
    & $adb pull /sdcard/shot.png "$t\$name.png" 2>&1 | Out-Null
}
function Open-Package([string]$package) {
    & $adb shell monkey -p $package -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
    Start-Sleep -Seconds 3
}
function Home { & $adb shell input keyevent KEYCODE_HOME; Start-Sleep -Seconds 1 }
function Dev-Ask([string]$kid, [string]$mode, [string[]]$words = @()) {
    $args = @($kid, $mode)
    if ($words.Count -gt 0) { $args += $words }
    pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-ask.ts @args
}

Write-Output '--- 1. A wiped emulator; a fresh server'
Get-Process emulator*, qemu-system* -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
Start-Sleep -Seconds 3
& $adb kill-server 2>&1 | Out-Null
& $adb start-server 2>&1 | Out-Null
Start-Process "$sdk\emulator\emulator.exe" -ArgumentList '-avd Medium_Phone_API_37.0 -wipe-data -no-snapshot-save -no-audio -no-boot-anim -no-window -memory 3072' -WindowStyle Hidden
$start = Get-Date
do {
    Start-Sleep -Seconds 5
    if (((Get-Date) - $start).TotalMinutes -gt 6) { throw 'The emulator did not start in 6 minutes' }
} until ((& $adb devices) -match 'emulator-\d+\s+device' -and (& $adb shell getprop sys.boot_completed 2>$null) -eq '1')
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell input keyevent KEYCODE_WAKEUP
& $adb shell wm dismiss-keyguard
Check 'no Screen Time app on the emulator' (-not (& $adb shell pm list packages au.screentime))

Write-Output '--- 2. A fresh server'
Set-Content "$Repo\deploy\.env" "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" down -v 2>&1 | Out-Null
docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" up -d --build --wait 2>&1 | Out-Null
$env:DATABASE_URL = 'postgres://screentime:local-dev-only@localhost:5432/screentime'
$env:JWT_SECRET = 'local-dev-only-secret-at-least-32-characters'
Set-Location $Repo
pnpm --silent --filter '@screentime/server' exec tsx scripts/seed-dev.ts dad@example.com

Write-Output '--- 3. Install the parent app and sign in'
& $adb install -t $parentApk | Select-Object -Last 1
Start-Sleep -Seconds 6
Open-Package $parent
Start-Sleep -Seconds 2
Tap-Text 'Email'
& $adb shell input text 'dad@example.com'
Start-Sleep -Seconds 1
& $adb shell input keyevent KEYCODE_BACK
Start-Sleep -Seconds 1
Tap-Text 'Send code' 4
$code = [regex]::Match(((docker logs --tail 20 screentime-api-1 2>&1 | Select-String 'sign-in code' | Select-Object -Last 1).Line), '\d{6}$').Value
& $adb shell input text $code
Start-Sleep -Seconds 1
& $adb shell input keyevent KEYCODE_BACK
Start-Sleep -Seconds 1
Tap-Text 'Sign in' 5
if ((Screen-Text).Contains('Allow ST Parent')) { Tap-Text 'Allow' 3 }
Check 'signed in' ((Screen-Text).Contains('Today'))

Write-Output '--- 4. Nothing waiting: no "Waiting for you"'
$screen = Screen-Text
Write-Output "  $screen"
Check 'nothing waiting' (-not $screen.Contains('Waiting for you'))

Write-Output '--- 5. Three things waiting'
Dev-Ask Alex 30 'Finishing my homework video'
Dev-Ask Alex parent-mode
Dev-Ask Alex message 'Can you pick me up at 5?'
Write-Output '  waiting 35 s for the poll'
Start-Sleep -Seconds 35
$screen = Screen-Text
Write-Output "  $screen"
Check 'strip says Waiting for you · 3' ($screen.Contains('Waiting for you') -and $screen.Contains('3'))
Check 'Message from Alex is folded (newest)' ($screen.Contains('Message from Alex'))
Tap-Text 'Show 2 more' 3
$screen = Screen-Text
Write-Output "  $screen"
Check 'Alex wants 30m more Phone' ($screen.Contains('Alex wants 30m more Phone'))
Check 'Alex wants parent mode' ($screen.Contains('Alex wants parent mode'))
Shot 'card062-strip'

Write-Output '--- 6. The strip is on the Kids and Settings tabs too'
Tap-Text 'Kids' 3
$screen = Screen-Text
Write-Output "  $screen"
Check 'Waiting for you on Kids' ($screen.Contains('Waiting for you'))
Tap-Text 'Settings' 3
$screen = Screen-Text
Write-Output "  $screen"
Check 'Waiting for you on Settings' ($screen.Contains('Waiting for you'))
Tap-Text 'Today' 3

Write-Output '--- 7. Got it on the message'
Tap-Text 'Got it' 3
$screen = Screen-Text
Write-Output "  $screen"
Check 'Message from Alex is gone' (-not $screen.Contains('Message from Alex'))
$seen = (docker exec screentime-db-1 psql -U screentime -d screentime -Atc "select id, seen_at, seen_by from kid_messages") -join ' '
Write-Output "  kid_messages: $seen"
Check 'seen_at is set' ($seen -match '\S+\|\S+ \S+\|\S+')
$events = (docker exec screentime-db-1 psql -U screentime -d screentime -Atc "select kind, payload from events where kind = 'kid_message.seen'") -join ' '
Write-Output "  events: $events"
Check 'one kid_message.seen event' ($events -match 'kid_message.seen')

Write-Output '--- 8. Yes, 30m on the time request'
Tap-Text 'Yes, 30m' 3
$screen = Screen-Text
Write-Output "  $screen"
Check 'time request is gone' (-not $screen.Contains('Alex wants 30m more Phone'))
$requests = (docker exec screentime-db-1 psql -U screentime -d screentime -Atc "select status, grant_id from time_requests") -join ' '
Write-Output "  time_requests: $requests"
Check 'request is approved with a grant' ($requests -match 'approved\|\S+')

Write-Output '--- 9. Answer opens parent mode; Say no; Close'
Tap-Text 'Answer' 3
$screen = Screen-Text
Write-Output "  $screen"
Check 'Parent mode for Alex?' ($screen.Contains('Parent mode for Alex?'))
Tap-Text 'Say no' 3
$screen = Screen-Text
Write-Output "  $screen"
Check 'done page shows you said no' ($screen.Contains('You said no'))
Tap-Text 'Close' 3
$screen = Screen-Text
Write-Output "  $screen"
Check 'on Today with no Waiting for you' ($screen.Contains('Today') -and -not $screen.Contains('Waiting for you'))
Shot 'card062-empty'

# The emulator holds this window's output open, so a pipe into Tee-Object would never end while it runs.
Get-Process emulator*, qemu-system* -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
Write-Output "--- Finished with $failed failed."
