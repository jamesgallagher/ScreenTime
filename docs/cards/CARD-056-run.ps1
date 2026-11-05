# CARD-056 emulator run. Run from the repo root with: pwsh -File docs\cards\CARD-056-run.ps1
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
function Apps { (pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-apps.ts Alex) -join "`n" }
function Wait-Apps([string]$words, [int]$max = 75) {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $max) {
        $now = Apps
        if ($now.Contains($words)) {
            Write-Host ("  seen after {0:n0} s: $words" -f ((Get-Date) - $start).TotalSeconds)
            return $true
        }
        Start-Sleep -Seconds 3
    }
    Write-Host "  not seen in $max s: $words"
    return $false
}
function Count-Of([string]$text, [string]$words) { ([regex]::Matches($text, [regex]::Escape($words))).Count }
function Show-Apps([string]$filter) {
    (Apps) -split "`n" | Where-Object { $_ -match $filter } | ForEach-Object { "  $_" }
}

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

Write-Output '--- 3. Install, Device Owner, usage access. Clock is used before enrolment.'
& $adb install -t $kidApk | Select-Object -Last 1
# Play services can hold a short-lived account just after a wipe: Android then refuses, so try again.
foreach ($try in 1..8) {
    $said = (& $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver 2>&1) -join "`n"
    if ($said -match '^Success') { Write-Output "  Device Owner on try $try"; break }
    Write-Output "  try ${try}: $(($said -split "`n" | Where-Object { $_ -match 'IllegalState' }) -join '') | $((& $adb shell dumpsys account | Select-String 'Accounts: |Account \{' | ForEach-Object { $_.Line.Trim() }) -join ' ; ')"
    Start-Sleep -Seconds 20
}
if (-not ((& $adb shell dpm list-owners) -join ' ').Contains('au.screentime.kid')) { throw 'Could not become Device Owner' }
& $adb shell cmd appops set au.screentime.kid GET_USAGE_STATS allow
& $adb shell cmd appops get au.screentime.kid GET_USAGE_STATS
Open-Package com.google.android.deskclock
Home

Write-Output '--- 4. Enrol: the first list is a silent baseline'
& $adb logcat -c
$link = (pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-enrol-code.ts Alex phone | Select-String 'screentime://\S+').Matches[0].Value
& $adb shell "am start -W -a android.intent.action.VIEW -d '$link' au.screentime.kid" | Out-Null
Start-Sleep -Seconds 4
Tap-Text 'Yes' 5
Check 'the list reached the server' (Wait-Apps 'com.android.settings')
Show-Apps '^apps:|^events:|deskclock|chrome|settings|dialer'
$now = Apps
Check 'no events from the baseline' ($now.Contains('events: 0'))
Check 'Clock was already used, so it never alerts' ($now -match 'deskclock.*baseline=true \| used=20')
Check 'Chrome is pre-installed and never opened' ($now -match 'com\.android\.chrome \| Chrome \| preinstalled .*blockable=true \| baseline=true \| used=-')
Check 'Settings cannot be blocked' ($now -match 'com\.android\.settings .*blockable=false')
Check 'our own app is not on the list' (-not $now.Contains('au.screentime.kid'))

Write-Output '--- 5. A new app raises app.installed'
& $adb install -t $parentApk | Select-Object -Last 1
Check 'installed event' (Wait-Apps 'app.installed | au.screentime.parent |')
Show-Apps '^events:|^app\.|au\.screentime\.parent \|'
$now = Apps
Check 'source is other, not baseline' ($now -match 'au\.screentime\.parent \| ST Parent \| other .*baseline=false \| used=-')
& $adb logcat -d -s KidService:I | Select-String 'apps:' | ForEach-Object { '  ' + $_.Line.Trim() }

Write-Output '--- 6. First use: the new app, then a pre-installed one'
Open-Package $parent
Check 'first use of the new app' (Wait-Apps 'app.first_used | au.screentime.parent |')
Home
Open-Package com.google.android.calendar
Check 'first use of a pre-installed app' (Wait-Apps 'app.first_used | com.google.android.calendar |')
Home
Open-Package com.google.android.deskclock
Start-Sleep -Seconds 35
Home
Show-Apps '^events:|^app\.'
$now = Apps
Check 'Clock raised nothing' (-not $now.Contains('app.first_used | com.google.android.deskclock |'))
Check 'the launcher raised nothing' (-not ($now -match 'app\.first_used.*launcher'))

Write-Output '--- 7. An update of an app is not news'
$before = Count-Of (Apps) 'app.installed'
& $adb install -r -t $parentApk | Select-Object -Last 1
Start-Sleep -Seconds 8
Check 'no new event' ((Count-Of (Apps) 'app.installed') -eq $before)

Write-Output '--- 8. Removed, then back'
& $adb uninstall $parent
Start-Sleep -Seconds 5
$gone = (Apps) -split "`n" | Where-Object { $_ -match '^au\.screentime\.parent ' }
Write-Output "  $gone"
Check 'marked removed, with no event' (($gone -match 'removed=20') -and ((Count-Of (Apps) 'app.installed') -eq $before))
& $adb install -t $parentApk | Select-Object -Last 1
Start-Sleep -Seconds 8
$now = Apps
Check 'back: a second app.installed' ((Count-Of $now 'app.installed | au.screentime.parent |') -eq 2)
Check 'back: first use stays one' ((Count-Of $now 'app.first_used | au.screentime.parent |') -eq 1)
Check 'back: not removed' ($now -match 'au\.screentime\.parent .*removed=-')

Write-Output '--- 9. Installed while the service was down'
& $adb shell am force-stop au.screentime.kid
& $adb uninstall $parent
& $adb install -t $parentApk | Select-Object -Last 1
& $adb uninstall $parent
Start-Sleep -Seconds 3
& $adb shell am start -n au.screentime.kid/.MainActivity | Out-Null
Start-Sleep -Seconds 8
$gone = (Apps) -split "`n" | Where-Object { $_ -match '^au\.screentime\.parent ' }
Write-Output "  $gone"
Check 'the restart noticed it is gone' ($gone -match 'removed=20')
& $adb shell am force-stop au.screentime.kid
& $adb install -t $parentApk | Select-Object -Last 1
& $adb shell am start -n au.screentime.kid/.MainActivity | Out-Null
Start-Sleep -Seconds 8
Check 'the restart noticed it is back' ((Count-Of (Apps) 'app.installed | au.screentime.parent |') -eq 3)
Home

Write-Output '--- 10. No connection: sent when the network is back'
& $adb shell svc wifi disable
& $adb shell svc data disable
Start-Sleep -Seconds 5
& $adb logcat -c
& $adb uninstall $parent
Start-Sleep -Seconds 6
& $adb logcat -d -s KidService:I | Select-String 'apps:' | ForEach-Object { '  ' + $_.Line.Trim() }
$gone = (Apps) -split "`n" | Where-Object { $_ -match '^au\.screentime\.parent ' }
Check 'offline: the server has not heard' ($gone -match 'removed=-')
& $adb shell svc wifi enable
& $adb shell svc data enable
$start = Get-Date
do {
    Start-Sleep -Seconds 3
    $gone = (Apps) -split "`n" | Where-Object { $_ -match '^au\.screentime\.parent ' }
} until (($gone -match 'removed=20') -or ((Get-Date) - $start).TotalSeconds -gt 60)
Write-Output ("  after {0:n0} s: $gone" -f ((Get-Date) - $start).TotalSeconds)
Check 'online: the server heard' ($gone -match 'removed=20')

Write-Output '--- 11. The parent app shows it'
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
$page = Screen-Text
Write-Output "  $page"
Shot 'card056-apps'
Check 'the page lists real apps' ($page.Contains('Chrome') -and $page.Contains('Came with') -and $page.Contains('ST Parent'))
& $adb shell input keyevent KEYCODE_BACK
Start-Sleep -Seconds 1
& $adb shell input keyevent KEYCODE_BACK
Start-Sleep -Seconds 1
Tap-Text 'Inbox' 4
$inbox = Screen-Text
Write-Output "  $inbox"
Shot 'card056-inbox'
Check 'the inbox has the words' ($inbox.Contains('Alex installed ST Parent') -and $inbox.Contains('for the first time'))

Write-Output "--- Finished with $failed failed."
