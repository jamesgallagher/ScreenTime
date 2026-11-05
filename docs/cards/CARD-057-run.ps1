# CARD-057 emulator run. Run from the repo root with: pwsh -File docs\cards\CARD-057-run.ps1
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

Write-Output '--- 4. Block Chrome: it will not open, and it stays on the list'
Rule com.android.chrome blocked
Sync-Now
Check 'Chrome is suspended' (Wait-State com.android.chrome $suspended)
Blocked-Log
Open-Package com.android.chrome
$top = Top
Write-Output "  top: $top"
$dialog = Screen-Text
Write-Output "  dialog: $dialog"
Shot 'card057-dialog'
Check 'Chrome did not open' (-not $top.Contains('com.android.chrome'))
Check 'the dialog names the parents' ($dialog.Contains('Ask Mum or Dad'))
Tap-Text 'Close'
Home
Sync-Now
$now = Apps
Check 'Chrome is still listed, not removed' ($now -match 'com\.android\.chrome .*removed=-')
Check 'blocking raised no install alert' (-not $now.Contains('app.installed | com.android.chrome |'))

Write-Output '--- 5. Allow it again'
Rule com.android.chrome allowed
Sync-Now
Check 'Chrome is free' (Wait-State com.android.chrome $free)
Open-Package com.android.chrome
$top = Top
Write-Output "  top: $top"
Check 'Chrome opens' ($top -match 'com\.android\.chrome|FirstRun')
Home

Write-Output '--- 6. An app in front closes when it is blocked'
Open-Package com.google.android.deskclock
Check 'Clock is in front' ((Top).Contains('deskclock'))
Rule com.google.android.deskclock blocked
Sync-Now
Check 'Clock is suspended' (Wait-State com.google.android.deskclock $suspended)
Open-Package com.google.android.deskclock
$top = Top
Write-Output "  top: $top"
Check 'Clock did not open' (-not $top.Contains('deskclock'))
Tap-Text 'Close'
Rule com.google.android.deskclock allowed
Sync-Now
Check 'Clock is free' (Wait-State com.google.android.deskclock $free)
Home

Write-Output '--- 7. The Play Store is hidden instead, and stays on the list'
Rule com.android.vending blocked
Sync-Now
Check 'Play Store is hidden' (Wait-State com.android.vending $hidden)
Blocked-Log
Start-Sleep -Seconds 5
$opened = (& $adb shell monkey -p com.android.vending -c android.intent.category.LAUNCHER 1 2>&1) -join ' '
Check 'Play Store has nothing to open' ($opened -match 'No activities found')
$market = (& $adb shell am start -a android.intent.action.VIEW -d 'market://details?id=com.example' 2>&1) -join ' '
Check 'market links stop working' ($market -match 'unable to resolve')
Sync-Now
$line = (Apps) -split "`n" | Where-Object { $_ -match '^com\.android\.vending ' }
Write-Output "  $line"
Check 'Play Store is still listed, not removed' ($line -match 'removed=-')
Check 'Play services still work: not suspended' ((State-Of com.google.android.gms) -eq $free)

Write-Output '--- 8. What the device needs cannot be blocked'
$settings = Rule com.android.settings blocked
Write-Output "  $settings"
Check 'the server refuses Settings' ($settings -match '409')
$dialer = Rule com.google.android.dialer blocked
Write-Output "  $dialer"
Check 'the server refuses the phone app' ($dialer -match '409')
Check 'the server has no rule for them' (-not ((Apps) -match 'rule com\.android\.settings'))

Write-Output '--- 9. Parent mode releases blocks, and its end brings them back'
Rule com.android.chrome blocked
Sync-Now
Check 'Chrome is suspended' (Wait-State com.android.chrome $suspended)
& $adb shell am start -n au.screentime.kid/.MainActivity | Out-Null
Start-Sleep -Seconds 3
Tap-Text "I'm the parent" 4
pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-parent-mode.ts Alex yes forever
Check 'parent mode releases Chrome' (Wait-State com.android.chrome $free 45)
Check 'parent mode releases the Play Store' (Wait-State com.android.vending $free 15)
pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-parent-mode.ts Alex end
Check 'the end of parent mode blocks Chrome again' (Wait-State com.android.chrome $suspended 45)
Check 'the end of parent mode hides the Play Store again' (Wait-State com.android.vending $hidden 15)
Home

Write-Output '--- 10. New app approval: held at once, then answered'
Approval on
Sync-Now
& $adb logcat -c
& $adb install -t $parentApk | Select-Object -Last 1
Check 'the new app is suspended' (Wait-State $parent $suspended 20)
Check 'the parent is asked' (Wait-Apps 'app.approval | au.screentime.parent |')
$now = Apps
Check 'the server holds it' ($now.Contains('rule au.screentime.parent held'))
Check 'no plain install alert' (-not $now.Contains('app.installed | au.screentime.parent |'))
Blocked-Log
Rule $parent allowed
Sync-Now
Check 'Allow releases it' (Wait-State $parent $free)
Check 'the answer is in the history' (Wait-Apps 'app.answered | au.screentime.parent |' 10)

Write-Output '--- 11. A rule outlives a reinstall'
Rule $parent blocked
Sync-Now
Check 'blocked' (Wait-State $parent $suspended)
& $adb uninstall $parent
Start-Sleep -Seconds 6
& $adb install -t $parentApk | Select-Object -Last 1
Check 'blocked again after the reinstall' (Wait-State $parent $suspended 20)
Rule $parent allowed
Sync-Now
Check 'free' (Wait-State $parent $free)

Write-Output '--- 12. Held while offline, then told to the server'
& $adb uninstall $parent
Start-Sleep -Seconds 6
Rule $parent allowed | Out-Null
Sync-Now
& $adb shell svc wifi disable
& $adb shell svc data disable
Start-Sleep -Seconds 5
& $adb logcat -c
& $adb install -t $parentApk | Select-Object -Last 1
Start-Sleep -Seconds 6
Write-Output "  an app with an allowed rule, offline: $(State-Of $parent)"
Check 'an allowed app is not held' ((State-Of $parent) -eq $free)
& $adb uninstall $parent
Start-Sleep -Seconds 4
docker exec screentime-db-1 psql -U screentime -d screentime -c "delete from app_rules where package = '$parent'" | Out-Null
& $adb shell svc wifi enable
& $adb shell svc data enable
Start-Sleep -Seconds 12
Sync-Now
& $adb shell svc wifi disable
& $adb shell svc data disable
Start-Sleep -Seconds 5
& $adb install -t $parentApk | Select-Object -Last 1
Check 'offline with no rule: held by the device' (Wait-State $parent $suspended 20)
& $adb shell svc wifi enable
& $adb shell svc data enable
Check 'back online: the parent is asked again' (Wait-Apps 'rule au.screentime.parent held' 60)

Write-Output '--- 13. The parent app shows and sets it'
Rule com.android.chrome allowed
Rule com.android.vending allowed
Rule $parent allowed
Approval off
Sync-Now
Check 'the parent app is free to open' (Wait-State $parent $free)
Check 'the Play Store is back' (Wait-State com.android.vending $free)
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
$page = Screen-Text
Write-Output "  $page"
Shot 'card057-apps'
Check 'the page has the switch and the choice' ($page.Contains('New apps need approval') -and $page.Contains('Allowed') -and $page.Contains('Blocked'))
& $adb shell input keyevent KEYCODE_BACK
Start-Sleep -Seconds 1
& $adb shell input keyevent KEYCODE_BACK
Start-Sleep -Seconds 1
Tap-Text 'Inbox' 4
$inbox = Screen-Text
Write-Output "  $inbox"
Shot 'card057-inbox'
Check 'the history says who answered' ($inbox.Contains('Dad allowed ST Parent for Alex'))

# The emulator holds this window's output open, so a pipe into Tee-Object would never end while it runs.
Get-Process emulator*, qemu-system* -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
Write-Output "--- Finished with $failed failed."
