# CARD-058 emulator run. Run from the repo root with: pwsh -File docs\cards\CARD-058-run.ps1
# It wipes the emulator and the development database. Every line it prints goes into the handback.
param([string]$Repo = (Get-Location).Path)
$ErrorActionPreference = 'Stop'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$adb = "$sdk\platform-tools\adb.exe"
$t = Join-Path (Split-Path $Repo) 'temp'
New-Item -ItemType Directory -Force $t | Out-Null
$kidApk = "$Repo\android\app-kid\build\outputs\apk\debug\app-kid-debug.apk"
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
# Screen off makes the service sync at once. A real device also gets a push, which the emulator's server cannot send.
function Sync-Now {
    & $adb shell input keyevent KEYCODE_SLEEP
    Start-Sleep -Seconds 3
    & $adb shell input keyevent KEYCODE_WAKEUP
    & $adb shell wm dismiss-keyguard
    Start-Sleep -Seconds 2
}
function Apps { (pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-apps.ts Alex) -join "`n" }
function Rule([string]$package, [string]$mode) { pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-app-rule.ts Alex rule $package $mode }
function Approval([string]$onOff) { pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-app-rule.ts Alex approval $onOff }
function State-Of([string]$package) {
    $line = (& $adb shell "dumpsys package $package" | Select-String 'hidden=(true|false) suspended=(true|false)' | Select-Object -First 1).Matches[0].Value
    return $line
}
function Wait-State([string]$package, [string]$want, [int]$max = 30) {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $max) {
        $now = State-Of $package
        if ($now -eq $want) {
            Write-Host ("  {0} after {1:n0} s: $now" -f $package, ((Get-Date) - $start).TotalSeconds)
            return $true
        }
        Start-Sleep -Seconds 2
    }
    Write-Host "  $package still: $(State-Of $package)"
    return $false
}
function Wait-Apps([string]$words, [int]$max = 75) {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $max) {
        if ((Apps).Contains($words)) {
            Write-Host ("  seen after {0:n0} s: $words" -f ((Get-Date) - $start).TotalSeconds)
            return $true
        }
        Start-Sleep -Seconds 3
    }
    Write-Host "  not seen in $max s: $words"
    return $false
}
function Top { ((& $adb shell dumpsys activity activities | Select-String 'topResumedActivity' | Select-Object -First 1).Line -replace '.* u0 ', '' -replace ' t\d+\}', '').Trim() }
function Blocked-Log {
    & $adb logcat -d -s KidService:I | Select-String 'apps: blocked' | Select-Object -Last 1 | ForEach-Object { '  ' + $_.Line.Trim() }
}
$free = 'hidden=false suspended=false'
$suspended = 'hidden=false suspended=true'
$hidden = 'hidden=true suspended=false'

Write-Output '--- 1. A wiped emulator'
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

Write-Output '--- 3. Install, Device Owner, usage access, enrol'
& $adb install -t $kidApk | Select-Object -Last 1
foreach ($try in 1..8) {
    $said = (& $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver 2>&1) -join "`n"
    if ($said -match '^Success') { Write-Output "  Device Owner on try $try"; break }
    Write-Output "  try ${try}: $(($said -split "`n" | Where-Object { $_ -match 'IllegalState' }) -join '')"
    Start-Sleep -Seconds 20
}
if (-not ((& $adb shell dpm list-owners) -join ' ').Contains('au.screentime.kid')) { throw 'Could not become Device Owner' }
& $adb shell cmd appops set au.screentime.kid GET_USAGE_STATS allow
& $adb logcat -c
$link = (pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-enrol-code.ts Alex phone | Select-String 'screentime://\S+').Matches[0].Value
& $adb shell "am start -W -a android.intent.action.VIEW -d '$link' au.screentime.kid" | Out-Null
Start-Sleep -Seconds 4
Tap-Text 'Yes' 5
Check 'the list reached the server' (Wait-Apps 'com.android.settings')
Home

function Rule-Limit([string]$package, [int]$minutes) { pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-app-rule.ts Alex rule $package limit $minutes }
function Tablet-Usage([string]$package, [int]$seconds) { pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-app-rule.ts Alex tablet-usage $package $seconds }
function Kid-Screen {
    & $adb shell am start -n au.screentime.kid/.MainActivity 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    Screen-Text
}
function Own-Seconds([string]$package) {
    $line = (Apps) -split "`n" | Where-Object { $_ -match "^usage $([regex]::Escape($package)) " -and $_ -notmatch 'Test tablet' } | Select-Object -First 1
    if (-not $line) { return 0 }
    return [int]($line -split ' ')[-1]
}
function Limit-Log {
    & $adb logcat -d -s KidService:I | Select-String 'apps: told|tamper:' | ForEach-Object { '  ' + $_.Line.Trim() }
}
$clock = 'com.google.android.deskclock'

Write-Output '--- 4. A limit, and time on the other device counts'
Rule-Limit $clock 5
Tablet-Usage $clock 260
Sync-Now
$kid = Kid-Screen
Write-Output "  kid: $kid"
Check 'the kid sees the limit' ($kid.Contains('Clock · less than a minute left'))
Check 'not blocked yet' ((State-Of $clock) -eq $free)
$now = Apps
Check 'the server has the limit' ($now.Contains("rule $clock limit 5"))
Check 'the server has the other device' ($now.Contains("usage $clock Test tablet 260"))

Write-Output '--- 5. Used up: warned, told and blocked'
& $adb logcat -c
Open-Package $clock
Check 'Clock is in front' ((Top).Contains('deskclock'))
$start = Get-Date
Check 'Clock is blocked at the limit' (Wait-State $clock $suspended 75)
Write-Output ("  blocked after {0:n0} s of use" -f ((Get-Date) - $start).TotalSeconds)
Limit-Log
$log = (& $adb logcat -d -s KidService:I | Select-String 'apps: told').Line -join ' '
Check 'the kid was warned' ($log.Contains('5 minutes of Clock left'))
Check 'the kid was told' ($log.Contains("That's all your Clock for today"))
Home
Open-Package $clock
$top = Top
Write-Output "  top: $top"
Check 'Clock will not open' (-not $top.Contains('deskclock'))
Tap-Text 'Close'
$kid = Kid-Screen
Write-Output "  kid: $kid"
Shot 'card058-kid'
Check 'the kid sees it is done' ($kid.Contains('Clock · done for today'))
Sync-Now
$own = Own-Seconds $clock
Write-Output "  this device's seconds: $own"
Check 'the time reached the server' ($own -gt 0)
Home

Write-Output '--- 6. More time from a parent lets it open again'
Rule-Limit $clock 10
Sync-Now
Check 'Clock is free' (Wait-State $clock $free)
$kid = Kid-Screen
Write-Output "  kid: $kid"
Check 'the kid sees the new time' ($kid -match 'Clock · \d+m left')
Home

Write-Output '--- 7. Time in parent mode does not count'
Sync-Now
$before = Own-Seconds $clock
& $adb shell am start -n au.screentime.kid/.MainActivity 2>&1 | Out-Null
Start-Sleep -Seconds 3
Tap-Text "I'm the parent" 4
pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-parent-mode.ts Alex yes forever
Start-Sleep -Seconds 5
Open-Package $clock
Start-Sleep -Seconds 40
Home
pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-parent-mode.ts Alex end
Start-Sleep -Seconds 5
Sync-Now
$after = Own-Seconds $clock
Write-Output "  seconds before: $before, after 40 s of use in parent mode: $after"
Check 'it did not count' (($after - $before) -lt 15)

Write-Output '--- 8. Usage access off: a tamper attempt, and limited apps stay blocked'
& $adb logcat -c
& $adb shell cmd appops set au.screentime.kid GET_USAGE_STATS ignore
Sync-Now
Check 'Clock is blocked' (Wait-State $clock $suspended 45)
Limit-Log
$tamper = (docker exec screentime-db-1 psql -U screentime -d screentime -Atc "select kind, payload->>'missing' from events where kind = 'tamper.policy'") -join ' '
Write-Output "  events: $tamper"
Check 'parents are told' ($tamper.Contains('tamper.policy|usage_access'))
Start-Sleep -Seconds 10
& $adb shell cmd appops set au.screentime.kid GET_USAGE_STATS allow
Sync-Now
Check 'with access back Clock is free' (Wait-State $clock $free 45)
Home

Write-Output '--- 9. Limits the server refuses'
$bad = Rule-Limit $clock 7
Write-Output "  $bad"
Check 'not in steps of 5' ($bad -match '422')
$bad = Rule-Limit $clock 485
Write-Output "  $bad"
Check 'over 8 hours' ($bad -match '422')

Write-Output '--- 10. The parent app shows it'
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
Tap-Text 'Kids'
Tap-Text 'Alex' 3
& $adb shell input swipe 500 1800 500 500 300
Start-Sleep -Seconds 2
Tap-Text 'Apps' 4
$found = $false
foreach ($i in 1..6) {
    $page = Screen-Text
    if ($page.Contains('10 min a day')) { $found = $true; break }
    & $adb shell input swipe 500 1500 500 500 400
    Start-Sleep -Seconds 2
}
Write-Output "  $page"
Shot 'card058-apps'
Check 'the page shows the limit' $found
Check "the page shows today's time against it" ($page -match 'Today .+ of 10m')

# The emulator holds this window's output open, so a pipe into Tee-Object would never end while it runs.
Get-Process emulator*, qemu-system* -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
Write-Output "--- Finished with $failed failed."
