# CARD-072 emulator run (kid out of time + remote update + parent app). Run from the repo root with: pwsh -File docs\cards\CARD-072-run.ps1
# It wipes the emulator and the development database. Every line it prints goes into the handback.
param([string]$Repo = (Get-Location).Path)
$ErrorActionPreference = 'Stop'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$adb = "$sdk\platform-tools\adb.exe"
$t = Join-Path (Split-Path $Repo) 'temp'
New-Item -ItemType Directory -Force $t | Out-Null
$kidApk = "$Repo\android\app-kid\build\outputs\apk\debug\app-kid-debug.apk"
$parentApk = "$Repo\android\app-parent\build\outputs\apk\debug\app-parent-debug.apk"
$kidPkg = 'au.screentime.kid'
$parentPkg = 'au.screentime.parent'
$failed = 0
# A stop anywhere must not leave the emulator or the adb server running: they hold this window's output open, so the run would look hung.
trap {
    Write-Output "STOPPED: $_"
    & $adb logcat -d -b crash 2>&1 | Select-Object -Last 40
    Get-Process emulator*, qemu-system* -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
    & $adb kill-server 2>&1 | Out-Null
    & "$Repo\android\gradlew.bat" -p "$Repo\android" --stop 2>&1 | Out-Null
    exit 1
}

function Check([string]$name, [bool]$ok) {
    if ($ok) { Write-Output "PASS $name" } else { Write-Output "FAIL $name"; $script:failed++ }
}
function Ui {
    & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
    & $adb pull /sdcard/ui.xml "$t\ui.xml" 2>&1 | Out-Null
    [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
    return $ui
}
function Tap-Text([string]$text, [int]$wait = 2) {
    $node = (Ui).SelectNodes('//node') | Where-Object { $_.text -eq $text } | Select-Object -First 1
    if (-not $node) { throw "No '$text' on screen" }
    $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
    & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
    Start-Sleep -Seconds $wait
}
function Screen-Text { ((Ui).SelectNodes('//node') | Where-Object { $_.text } | ForEach-Object { $_.text }) -join ' | ' }
function Shot([string]$name) {
    & $adb shell screencap -p /sdcard/shot.png
    & $adb pull /sdcard/shot.png "$t\$name.png" 2>&1 | Out-Null
}
function Sleep-Screen { & $adb shell input keyevent KEYCODE_SLEEP; Start-Sleep -Seconds 3 }
function Wake-Screen { & $adb shell input keyevent KEYCODE_WAKEUP; & $adb shell wm dismiss-keyguard; Start-Sleep -Seconds 2 }
function Open-Package([string]$package) {
    & $adb shell monkey -p $package -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
    Start-Sleep -Seconds 3
}
function Version-Installed([string]$package) {
    (& $adb shell "dumpsys package $package" | Select-String 'versionCode=(\d+)' | Select-Object -First 1).Matches[0].Groups[1].Value
}
function Focus { ((& $adb shell dumpsys window | Select-String 'mCurrentFocus') -join ' ').Trim() }
function Db([string]$sql) { (docker exec screentime-db-1 psql -U screentime -d screentime -At -c $sql) -join ' ' }
function Wait-Screen([string]$text, [int]$max = 60) {
    $start = Get-Date
    do {
        $screen = Screen-Text
        if ($screen.Contains($text)) {
            Write-Host "  saw '$text' after $([int]((Get-Date) - $start).TotalSeconds) s"
            return $screen
        }
        Start-Sleep -Seconds 3
    } while (((Get-Date) - $start).TotalSeconds -lt $max)
    Write-Host "  did not see '$text' after $max s"
    return $screen
}
function Wait-Health {
    $start = Get-Date
    do {
        try {
            $r = Invoke-WebRequest -Uri 'http://localhost:8080/health' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 3
    } while (((Get-Date) - $start).TotalSeconds -lt 120)
    return $false
}
function Wait-Version([string]$code, [int]$max = 120) {
    $start = Get-Date
    do {
        $elapsed = [int]((Get-Date) - $start).TotalSeconds
        $v = Version-Installed $kidPkg
        Write-Host "  version poll after ${elapsed} s: $v"
        if ($v -eq $code) { return $elapsed }
        Start-Sleep -Seconds 2
    } while ($elapsed -lt $max)
    return -1
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
Wake-Screen
Check 'no Screen Time app on the emulator' (-not (& $adb shell pm list packages au.screentime))

Write-Output '--- 2. A fresh server, with nothing published'
Remove-Item "$Repo\deploy\releases" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$Repo\deploy\releases" | Out-Null
Set-Content "$Repo\deploy\.env" "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" down -v 2>&1 | Out-Null
docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" up -d --build --wait 2>&1 | Out-Null
$env:DATABASE_URL = 'postgres://screentime:local-dev-only@localhost:5432/screentime'
$env:JWT_SECRET = 'local-dev-only-secret-at-least-32-characters'
Set-Location $Repo
pnpm --silent --filter '@screentime/server' exec tsx scripts/seed-dev.ts dad@example.com
Check 'server health returned' (Wait-Health)

Write-Output '--- 3. Build version 901, then install version 900'
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
Push-Location "$Repo\android"
& .\gradlew.bat :app-kid:assembleDebug '-PkidTestOnly=false' '-PkidVersionCode=901' '-PkidVersionName=0.9.1' --quiet 2>&1 | Where-Object { $_ -notmatch '^w:' } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'Version 901 did not build' }
Copy-Item $kidApk "$t\card072-kid-901.apk" -Force
Write-Output "  built 901: $t\card072-kid-901.apk"
& .\gradlew.bat :app-kid:assembleDebug '-PkidTestOnly=false' '-PkidVersionCode=900' '-PkidVersionName=0.9.0' --quiet 2>&1 | Where-Object { $_ -notmatch '^w:' } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'Version 900 did not build' }
Pop-Location
& $adb install -t $kidApk | Select-Object -Last 1
foreach ($try in 1..8) {
    $said = (& $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver 2>&1) -join "`n"
    if ($said -match '^Success') { Write-Output "  Device Owner on try $try"; break }
    Write-Output "  try ${try}: not yet"
    Start-Sleep -Seconds 20
}
& $adb shell cmd appops set au.screentime.kid GET_USAGE_STATS allow
& $adb logcat -c
$link = (pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-enrol-code.ts Alex phone | Select-String 'screentime://\S+').Matches[0].Value
& $adb shell "am start -W -a android.intent.action.VIEW -d '$link' au.screentime.kid" | Out-Null
Start-Sleep -Seconds 4
Tap-Text 'Yes' 5
Check 'version 900 is on the device' ((Version-Installed $kidPkg) -eq '900')
$appVersion = ''
$versionWait = Get-Date
do {
    $appVersion = Db 'select app_version from devices'
    if ($appVersion -eq '0.9.0') { break }
    Start-Sleep -Seconds 3
} while (((Get-Date) - $versionWait).TotalSeconds -lt 60)
Check 'the server has version 0.9.0' ($appVersion -eq '0.9.0')
$deviceId = Db 'select id from devices'
Write-Output "  deviceId: $deviceId"

Write-Output '--- 4. Criterion 13: kid out of time and blocked, not in parent mode'
Open-Package $kidPkg
$main = Screen-Text
Write-Output "  main screen: $main"
Check 'main screen has no Version' (-not $main.Contains('Version'))
$grant = pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-grant.ts Alex phone -1440 2>&1
$grant | ForEach-Object { Write-Output "  dev-grant: $_" }
Check 'grant script says Removed' (($grant | Out-String).Contains('Removed'))
Sleep-Screen
Start-Sleep -Seconds 5
Wake-Screen
$blocked = Wait-Screen 'Out of Phone time' 180
Write-Output "  blocked screen: $blocked"
$focusBlocked = Focus
Write-Output "  focus: $focusBlocked"
Check 'block screen shows Out of Phone time' ($blocked.Contains('Out of Phone time'))
Check 'block screen is the focused kid window' ($focusBlocked.Contains('au.screentime.kid'))
Check 'not in parent mode: no Parent mode text' (-not $blocked.Contains('Parent mode'))
Check 'not in parent mode: no Version text' (-not $blocked.Contains('Version '))

Write-Output '--- 5. Criterion 13 (the tap): publish 901 for this device and call the remote update route'
pwsh -File android\publish-kid.ps1 -Apk "$t\card072-kid-901.apk" -VersionCode 901 -VersionName 0.9.1 -To deploy\releases -DeviceId $deviceId | ForEach-Object { Write-Output "  publish-kid: $_" }
$remote = pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-remote-update.ts $deviceId 2>&1
$remote | ForEach-Object { Write-Output "  dev-remote-update: $_" }
Check 'remote update route returned 202' (($remote | Out-String).Contains(' 202 '))

Write-Output '--- 6. Criterion 14: version 901 installs and the block screen comes back'
$installSec = Wait-Version '901' 120
Write-Output "  version 901 after $installSec s"
Check 'version 901 installed within 120 s' ($installSec -ge 0 -and $installSec -le 120)
$versionAt = Get-Date
$backSec = -1
$focusAfter = ''
$after = ''
do {
    $focusAfter = Focus
    $after = Screen-Text
    $backSec = [int]((Get-Date) - $versionAt).TotalSeconds
    Write-Output "  back poll after ${backSec} s: focus=$focusAfter; screen=$after"
    if ($focusAfter.Contains('au.screentime.kid') -and $after.Contains('Out of Phone time')) { break }
    Start-Sleep -Seconds 3
} while ($backSec -lt 60)
Write-Output "  final focus: $focusAfter"
Write-Output "  final screen: $after"
Check 'block screen back within 15 s and is the block screen' ($after.Contains('Out of Phone time') -and $focusAfter.Contains('au.screentime.kid') -and $backSec -ge 0 -and $backSec -le 15 -and -not $after.Contains('Version '))
Shot 'card072-after-update'
& $adb logcat -d -s KidService | Select-String 'update:|remote' | Select-Object -Last 40 | ForEach-Object { Write-Output "  logcat: $_" }

Write-Output '--- 7. Criterion 15: DB shows version 901 and the snapshot has no appUpdate'
$deviceRow = Db "select app_version, app_version_code, update_requested_code, update_requested_at from devices where id = '$deviceId'"
Write-Output "  device row: $deviceRow"
$appVersionCode = Db "select app_version_code from devices where id = '$deviceId'"
Check 'DB app_version_code is 901' ($appVersionCode -eq '901')
$xml = (& $adb shell run-as au.screentime.kid cat shared_prefs/enrolment.xml 2>&1) -join "`n"
$token = [regex]::Match($xml, 'name="deviceToken">([^<]+)<').Groups[1].Value
if ($token) {
    $snap = Invoke-RestMethod -Uri 'http://localhost:8080/v1/device/state' -Headers @{ authorization = "Bearer $token" }
    Write-Output "  GET /v1/device/state appUpdate: $($snap.appUpdate | ConvertTo-Json -Compress)"
    Check 'snapshot appUpdate is null' ($null -eq $snap.appUpdate)
} else {
    Write-Output '  run-as gave no device token'
    $fallback = Db "select case when update_requested_code is not null and (app_version_code is null or app_version_code < update_requested_code) then 'appUpdate NOT null' else 'appUpdate null' end from devices where id = '$deviceId'"
    Write-Output "  DB fallback: $fallback"
    Check 'fallback says appUpdate null' ($fallback -eq 'appUpdate null')
}

Write-Output '--- 8. Criterion 16: second remote update returns 409 no_update'
$again = pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-remote-update.ts $deviceId 2>&1
$again | ForEach-Object { Write-Output "  dev-remote-update: $_" }
Check 'second remote update returned 409' (($again | Out-String).Contains(' 409 '))
Check 'second remote update returned no_update' (($again | Out-String).Contains('no_update'))

Write-Output '--- 9. Criterion 17: parent app shows Version 0.9.1 and Up to date'
Write-Output '--- 9a. Give the kid time so the block screen closes (the parent app cannot come to the front while Block Task is pinned)'
$unlock = pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-grant.ts Alex phone 1440 2>&1
$unlock | ForEach-Object { Write-Output "  dev-grant: $_" }
$closed = $false
$start = Get-Date
do {
    $f = Focus
    $s = Screen-Text
    Write-Output "  unlock poll after $([int]((Get-Date) - $start).TotalSeconds) s: focus=$f; screen=$s"
    if (-not $f.Contains('BlockActivity') -and -not $s.Contains('Out of Phone time')) { $closed = $true; break }
    Start-Sleep -Seconds 3
} while (((Get-Date) - $start).TotalSeconds -lt 120)
Check 'block screen closed after time was given' $closed
Push-Location "$Repo\android"
& .\gradlew.bat :app-parent:assembleDebug '-PparentVersionCode=900' '-PparentVersionName=0.9.0' --quiet 2>&1 | Where-Object { $_ -notmatch '^w:' } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'Parent app 900 did not build' }
Pop-Location
& $adb install -t $parentApk | Select-Object -Last 1
Open-Package $parentPkg
$signin = Wait-Screen 'Email' 40
Write-Output "  parent sign-in screen: $signin"
Tap-Text 'Email' 2
& $adb shell input text 'dad@example.com'
Start-Sleep -Seconds 1
Tap-Text 'Send code' 5
$code = [regex]::Match(((docker logs --tail 30 screentime-api-1 2>&1 | Select-String 'sign-in code' | Select-Object -Last 1).Line), '\d{6}$').Value
Write-Output "  sign-in code: $code"
& $adb shell input text $code
Start-Sleep -Seconds 1
Tap-Text 'Sign in' 5
if ((Screen-Text).Contains('Allow')) { Tap-Text 'Allow' 3 }
$parentMain = Wait-Screen 'Kids' 30
Write-Output "  parent main screen: $parentMain"
Tap-Text 'Kids' 4
$kidsScreen = Screen-Text
Write-Output "  kids screen: $kidsScreen"
Tap-Text 'Alex' 4
$row = Screen-Text
Write-Output "  Alex row (initial): $row"
if (-not ($row.Contains('Version 0.9.1') -and $row.Contains('Up to date'))) {
    Write-Output '  pulling to refresh'
    & $adb shell input swipe 540 800 540 1600 300
    Start-Sleep -Seconds 3
    $row = Screen-Text
    Write-Output "  Alex row (after pull): $row"
}
Shot 'card072-parent-row'
Check 'Alex row shows Version 0.9.1' ($row.Contains('Version 0.9.1'))
Check 'Alex row shows Up to date' ($row.Contains('Up to date'))

Write-Output '--- 10. Cleanup'
Get-Process emulator*, qemu-system* -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
& $adb kill-server 2>&1 | Out-Null
& "$Repo\android\gradlew.bat" -p "$Repo\android" --stop 2>&1 | Out-Null
Write-Output "--- Finished with $failed failed."
