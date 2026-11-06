# CARD-059 emulator run. Run from the repo root with: pwsh -File docs\cards\CARD-059-run.ps1
# It wipes the emulator and the development database. Every line it prints goes into the handback.
param([string]$Repo = (Get-Location).Path)
$ErrorActionPreference = 'Stop'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$adb = "$sdk\platform-tools\adb.exe"
$t = Join-Path (Split-Path $Repo) 'temp'
New-Item -ItemType Directory -Force $t | Out-Null
$apk = "$Repo\android\app-kid\build\outputs\apk\debug\app-kid-debug.apk"
$kidPkg = 'au.screentime.kid'
$clock = 'com.google.android.deskclock'
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
function Sync-Now { Sleep-Screen; Wake-Screen }
function Rule([string]$package, [string]$mode) { pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-app-rule.ts Alex rule $package $mode }
function Version-Installed { (& $adb shell "dumpsys package $kidPkg" | Select-String 'versionCode=(\d+)' | Select-Object -First 1).Matches[0].Groups[1].Value }
function State-Of([string]$package) { (& $adb shell "dumpsys package $package" | Select-String 'hidden=(true|false) suspended=(true|false)' | Select-Object -First 1).Matches[0].Value }
function Update-Log { & $adb logcat -d -s KidService:I | Select-String 'update:|remove:' | ForEach-Object { '  ' + $_.Line.Trim() } }
function Db([string]$sql) { (docker exec screentime-db-1 psql -U screentime -d screentime -At -c $sql) -join ' ' }
function Wait-Log([string]$words, [int]$max = 150) {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $max) {
        if ((& $adb logcat -d -s KidService:I | Select-String $words)) {
            Write-Host ("  log after {0:n0} s: $words" -f ((Get-Date) - $start).TotalSeconds)
            return $true
        }
        Start-Sleep -Seconds 5
    }
    Write-Host "  not in the log after $max s: $words"
    return $false
}
function Wait-Version([string]$want, [int]$max = 180) {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $max) {
        if ((Version-Installed) -eq $want) {
            Write-Host ("  version $want after {0:n0} s" -f ((Get-Date) - $start).TotalSeconds)
            return $true
        }
        Start-Sleep -Seconds 5
    }
    Write-Host "  still version $(Version-Installed) after $max s"
    return $false
}
$free = 'hidden=false suspended=false'
$suspended = 'hidden=false suspended=true'

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

Write-Output '--- 3. Build version 2, then install version 1'
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
Push-Location "$Repo\android"
& .\gradlew.bat :app-kid:assembleDebug '-PkidTestOnly=false' '-PkidVersionCode=2' '-PkidVersionName=0.1.1' --quiet 2>&1 | Where-Object { $_ -notmatch '^w:' } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'Version 2 did not build' }
Copy-Item $apk "$t\card059-kid-v2.apk" -Force
& .\gradlew.bat :app-kid:assembleDebug '-PkidTestOnly=false' --quiet 2>&1 | Where-Object { $_ -notmatch '^w:' } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'Version 1 did not build' }
Pop-Location
& $adb install -t $apk | Select-Object -Last 1
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
Check 'version 1 is on the device' ((Version-Installed) -eq '1')
Start-Sleep -Seconds 10
Check 'the server has its version' ((Db 'select app_version from devices') -eq '0.1.0')
$deviceId = Db 'select id from devices'
Rule $clock 'blocked'
Sync-Now
Start-Sleep -Seconds 5
Check 'Clock is blocked' ((State-Of $clock) -eq $suspended)

Write-Output '--- 4. A version for another device is not offered'
pwsh -File android\publish-kid.ps1 -Apk "$t\card059-kid-v2.apk" -VersionCode 2 -VersionName 0.1.1 -To deploy\releases -DeviceId '00000000-0000-4000-8000-000000000000'
Start-Sleep -Seconds 65
Sync-Now
Start-Sleep -Seconds 10
Check 'nothing offered' (-not (Update-Log | Select-String 'offered'))
Check 'still version 1' ((Version-Installed) -eq '1')

Write-Output '--- 5. Published for this device: it updates itself, with the screen off'
pwsh -File android\publish-kid.ps1 -Apk "$t\card059-kid-v2.apk" -VersionCode 2 -VersionName 0.1.1 -To deploy\releases -DeviceId $deviceId
Start-Sleep -Seconds 65
Sync-Now
Check 'offered' (Wait-Log 'update: offered 0.1.1')
Check 'downloaded' (Wait-Log 'update: downloaded 0.1.1')
Check 'not installed while the screen is on' ((Version-Installed) -eq '1')
Update-Log
Sleep-Screen
Check 'installed with the screen off' (Wait-Version '2')
Update-Log
Wake-Screen
Start-Sleep -Seconds 20
Sync-Now
Start-Sleep -Seconds 70
Sync-Now
Start-Sleep -Seconds 5
Write-Output "  owners: $((& $adb shell dpm list-owners) -join ' ')"
Check 'still Device Owner' (((& $adb shell dpm list-owners) -join ' ').Contains($kidPkg))
Check 'the service came back' (((& $adb shell dumpsys activity services $kidPkg) -join ' ').Contains('KidService'))
Check 'still enrolled: the server has the new version' ((Db 'select app_version from devices') -eq '0.1.1')
Check 'usage access stayed' (((& $adb shell cmd appops get $kidPkg GET_USAGE_STATS) -join ' ').Contains('allow'))
Check 'Clock is still blocked' ((State-Of $clock) -eq $suspended)

Write-Output '--- 6. Remove needs the parent code, even in parent mode'
function Parent-Code { [regex]::Match((pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-parent-mode.ts Alex code) -join ' ', '[0-9]{6}').Value }
& $adb shell am start -n au.screentime.kid/.MainActivity 2>&1 | Out-Null
Start-Sleep -Seconds 4
Tap-Text "I'm the parent" 3
Tap-Text 'Enter parent code instead' 2
& $adb shell input text (Parent-Code)
Start-Sleep -Seconds 2
Tap-Text 'Until I end it' 4
$kid = Screen-Text
Write-Output "  kid: $kid"
Tap-Text 'Remove Screen Time' 2
Shot 'card059-remove'
Write-Output "  sheet: $(Screen-Text)"
Tap-Text 'Remove it' 2
Write-Output "  sheet: $(Screen-Text)"
& $adb shell input text 000000
Start-Sleep -Seconds 2
$after = Screen-Text
Write-Output "  wrong code: $after"
Check 'a wrong code does nothing' ($after.Contains("That's not the code") -and ((& $adb shell dpm list-owners) -join ' ').Contains($kidPkg))
& $adb shell input text (Parent-Code)
Start-Sleep -Seconds 10
Update-Log
Write-Output "  screen: $(Screen-Text)"
Shot 'card059-uninstall'
Check 'no longer Device Owner' (-not ((& $adb shell dpm list-owners) -join ' ').Contains($kidPkg))
Check 'Clock is free' ((State-Of $clock) -eq $free)
Check 'the server revoked the device' ((Db 'select revoked_at is not null from devices') -eq 't')
Check 'the parents are told' ((Db "select count(*) from events where kind = 'device.removed'") -eq '1')
Check 'Android asks to uninstall' ((Screen-Text) -match '(?i)uninstall')
Tap-Text 'Cancel' 3
& $adb shell am start -n au.screentime.kid/.MainActivity 2>&1 | Out-Null
Start-Sleep -Seconds 4
$left = Screen-Text
Write-Output "  cancelled, then opened: $left"
Check 'cancelled: the app no longer acts enrolled' (-not $left.Contains('Hi Alex'))
Check 'cancelled: nothing crashed' (-not (& $adb logcat -d -b crash))
& $adb shell am start -a android.intent.action.DELETE -d package:au.screentime.kid 2>&1 | Out-Null
Start-Sleep -Seconds 3
Tap-Text 'Uninstall' 5
Check 'the app is gone' (-not (& $adb shell pm list packages $kidPkg))

# The emulator, the adb server and the Gradle daemon hold this window's output open, so a pipe into Tee-Object would never end while they run.
Get-Process emulator*, qemu-system* -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
& $adb kill-server 2>&1 | Out-Null
& "$Repo\android\gradlew.bat" -p "$Repo\android" --stop 2>&1 | Out-Null
Write-Output "--- Finished with $failed failed."
