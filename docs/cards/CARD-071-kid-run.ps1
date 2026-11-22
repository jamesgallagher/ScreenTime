# CARD-071 emulator run (kid + parent app). Run from the repo root with: pwsh -File docs\cards\CARD-071-kid-run.ps1
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
$parentModeEnd = $null
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
function Tap-Version([int]$wait = 3) {
    $node = (Ui).SelectNodes('//node') | Where-Object { $_.text -and $_.text.StartsWith('Version ') } | Select-Object -First 1
    if (-not $node) { throw "No Version link on screen: $(Screen-Text)" }
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
function Wait-For-Check-Button {
    $start = Get-Date
    do {
        $screen = Screen-Text
        if ($screen.Contains('Check for updates') -or $screen.Contains('is ready') -or $screen.Contains('is out')) {
            Write-Host "  sheet ready after $([int]((Get-Date) - $start).TotalSeconds) s: $screen"
            return $screen
        }
        Start-Sleep -Seconds 3
    } while (((Get-Date) - $start).TotalSeconds -lt 30)
    Write-Host "  sheet did not show a checkable state after 30 s: $screen"
    return $screen
}
function Swipe-To-Bottom {
    & $adb shell input swipe 540 1900 540 300 300
    Start-Sleep -Seconds 1
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

Write-Output '--- 3. Build version 901, then install version 900'
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
Push-Location "$Repo\android"
& .\gradlew.bat :app-kid:assembleDebug '-PkidTestOnly=false' '-PkidVersionCode=901' '-PkidVersionName=0.9.1' --quiet 2>&1 | Where-Object { $_ -notmatch '^w:' } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'Version 901 did not build' }
Copy-Item $kidApk "$t\card071-kid-901.apk" -Force
Write-Output "  built 901: $t\card071-kid-901.apk"
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
Start-Sleep -Seconds 10
Check 'the server has version 0.9.0' ((Db 'select app_version from devices') -eq '0.9.0')
$deviceId = Db 'select id from devices'
Write-Output "  deviceId: $deviceId"

Write-Output '--- 4. Criterion 14: parent mode off shows no Version; parent mode on shows Version 0.9.0'
Open-Package $kidPkg
Start-Sleep -Seconds 3
$before = Screen-Text
Write-Output "  main screen (parent mode off): $before"
Check 'parent mode off: no Version on main screen' (-not $before.Contains('Version'))
Tap-Text "I'm the parent" 3
$asked = Screen-Text
Write-Output "  screen after tap: $asked"
if ($asked.Contains('Enter parent code instead') -or $asked.Contains('Hand to a parent') -or $asked.Contains("We've asked")) {
    Write-Output '  sheet opened'
} else {
    Write-Output '  sheet title not seen in uiautomator; continuing'
}
$parentOut = pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-parent-mode.ts Alex yes 15
$parentOut | ForEach-Object { Write-Output "  parent-mode script: $_" }
Check 'parent mode script reports turned on' (($parentOut | Out-String).Contains('turned parent mode on'))
$banner = Wait-Screen 'End now' 60
Write-Output "  parent mode banner: $banner"
Check 'parent mode on: banner shows End now' ($banner.Contains('End now'))
Check 'parent mode on: Version 0.9.0 shown' ($banner.Contains('Version 0.9.0'))
$node = (Ui).SelectNodes('//node') | Where-Object { $_.text -and $_.text.Contains('Parent mode') } | Select-Object -First 1
if ($node) { $script:parentModeEnd = $node.text }
Write-Output "  parent mode end text: $parentModeEnd"
Check 'captured parent mode end text' (-not [string]::IsNullOrWhiteSpace($parentModeEnd))

Write-Output '--- 5. Criterion 15: Version link opens the sheet, up to date'
Tap-Version
$sheet = Wait-Screen "You're up to date" 60
Write-Output "  update sheet: $sheet"
Shot 'card071-kid-uptodate'
Check 'sheet says You are up to date' ($sheet.Contains("You're up to date"))

Write-Output '--- 6. Criterion 16: publish 901 for this device, Check for updates shows the offer'
pwsh -File android\publish-kid.ps1 -Apk "$t\card071-kid-901.apk" -VersionCode 901 -VersionName 0.9.1 -To deploy\releases -DeviceId $deviceId
Start-Sleep -Seconds 1
$sheet16 = Screen-Text
Write-Output "  sheet after publish: $sheet16"
if ($sheet16.Contains('Check for updates')) {
    Tap-Text 'Check for updates' 3
} else {
    Write-Output '  the sheet already shows the offer (auto-check beat the tap)'
}
$offer = Wait-Screen 'Update now?' 60
Write-Output "  offer sheet: $offer"
Shot 'card071-kid-offer'
Check 'offer sheet shows 0.9.1' ($offer.Contains('0.9.1') -and ($offer.Contains('is ready') -or $offer.Contains('is out')))

Write-Output '--- 7. Criterion 17: Update now with the screen on, app comes back, parent mode survives'
Tap-Text 'Update now' 3
$start = Get-Date
do {
    if ((Version-Installed $kidPkg) -eq '901') { break }
    Start-Sleep -Seconds 3
} while (((Get-Date) - $start).TotalSeconds -lt 60)
$installedAt = Get-Date
Write-Output "  version after $([int]($installedAt - $start).TotalSeconds) s: $(Version-Installed $kidPkg)"
Check 'versionCode is 901' ((Version-Installed $kidPkg) -eq '901')
$focusStart = Get-Date
$focusLine = ''
do {
    $focusLine = Focus
    if ($focusLine.Contains('au.screentime.kid')) { break }
    Start-Sleep -Seconds 1
} while (((Get-Date) - $focusStart).TotalSeconds -lt 15)
Write-Output "  focus: $focusLine"
Check 'ST Kid (au.screentime.kid) is the focused window' ($focusLine.Contains('au.screentime.kid'))
$after = Wait-Screen 'End now' 30
Write-Output "  screen after update: $after"
Check 'parent mode still on' ($after.Contains('End now') -and $after.Contains('Parent mode'))
$beforeEnd = if ($parentModeEnd) { ([regex]::Match($parentModeEnd, 'ends .+?(?=\s*\||$)')).Value.Trim() } else { '' }
$afterEnd = ([regex]::Match($after, 'ends .+?(?=\s*\||$)')).Value.Trim()
Write-Output "  parent mode end before: $beforeEnd"
Write-Output "  parent mode end after:  $afterEnd"
if ([string]::IsNullOrWhiteSpace($beforeEnd)) {
    Write-Output '  parent mode end time was not captured'
    Check 'parent mode end time unchanged' $false
} else {
    Check 'parent mode end time unchanged' ($beforeEnd -eq $afterEnd)
}

Write-Output '--- 8. Sign in the parent app (for criterion 23), server still up'
Push-Location "$Repo\android"
& .\gradlew.bat :app-parent:assembleDebug '-PparentVersionCode=900' '-PparentVersionName=0.9.0' --quiet 2>&1 | Where-Object { $_ -notmatch '^w:' } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'Parent app 900 did not build' }
Pop-Location
& $adb install -t $parentApk | Select-Object -Last 1
Open-Package $parentPkg
Start-Sleep -Seconds 3
Tap-Text 'Email' 2
& $adb shell input text 'dad@example.com'
Start-Sleep -Seconds 1
Tap-Text 'Send code' 5
$code = [regex]::Match(((docker logs --tail 20 screentime-api-1 2>&1 | Select-String 'sign-in code' | Select-Object -Last 1).Line), '\d{6}$').Value
Write-Output "  sign-in code: $code"
& $adb shell input text $code
Start-Sleep -Seconds 1
Tap-Text 'Sign in' 5
if ((Screen-Text).Contains('Allow')) { Tap-Text 'Allow' 3 }
$parentMain = Screen-Text
Write-Output "  parent main screen: $parentMain"
Check 'parent signed in' ($parentMain.Contains('Today'))
Tap-Text 'Settings' 3
Swipe-To-Bottom
$parentSettings = Screen-Text
Write-Output "  parent settings: $parentSettings"
Check 'parent Settings shows Version 0.9.0' ($parentSettings.Contains('Version 0.9.0'))

Write-Output '--- 9. Criteria 18 and 23: server stopped, both apps fail to check'
docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" stop api 2>&1 | Out-Null
Write-Output '  api stopped'

Write-Output '  9a. Kid app cannot check'
Open-Package $kidPkg
Start-Sleep -Seconds 3
$kidScreen = Screen-Text
if (-not $kidScreen.Contains('Check for updates')) {
    Tap-Version
}
$sheet18a = Wait-For-Check-Button
if ($sheet18a.Contains('Check for updates')) {
    Tap-Text 'Check for updates' 3
} else {
    Write-Output '  sheet has no Check for updates button; waiting for the error text'
}
$kidFail = Wait-Screen "Couldn't check. Check the internet and try again." 60
Write-Output "  kid fail sheet: $kidFail"
Check 'kid shows the check-failed message' ($kidFail.Contains("Couldn't check. Check the internet and try again."))
& $adb shell input keyevent KEYCODE_BACK
Start-Sleep -Seconds 1

Write-Output '  9b. Parent app cannot check'
Open-Package $parentPkg
Start-Sleep -Seconds 3
Tap-Text 'Settings' 3
Swipe-To-Bottom
Start-Sleep -Seconds 1
Tap-Version
$sheet23 = Wait-For-Check-Button
if ($sheet23.Contains('Check for updates')) {
    Tap-Text 'Check for updates' 3
} else {
    Write-Output '  sheet has no Check for updates button; waiting for the error text'
}
$parentFail = Wait-Screen "Couldn't check. Check the internet and try again." 60
Write-Output "  parent fail sheet: $parentFail"
Check 'parent shows the check-failed message' ($parentFail.Contains("Couldn't check. Check the internet and try again."))

docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" start api 2>&1 | Out-Null
Write-Output '  api starting, waiting for health'
Check 'api health returned' (Wait-Health)

Write-Output '--- 10. Cleanup'
Get-Process emulator*, qemu-system* -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
& $adb kill-server 2>&1 | Out-Null
& "$Repo\android\gradlew.bat" -p "$Repo\android" --stop 2>&1 | Out-Null
Write-Output "--- Finished with $failed failed."
