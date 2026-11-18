# CARD-064 emulator run. Run from the repo root with: pwsh -File docs\cards\CARD-064-run.ps1
# It wipes the emulator and the development database. Every line it prints goes into the handback.
# It takes three debug builds (900, 901, 902) of the parent app through the dev server's releases folder.
param([string]$Repo = (Get-Location).Path)
$ErrorActionPreference = 'Stop'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$adb = "$sdk\platform-tools\adb.exe"
$t = Join-Path (Split-Path $Repo) 'temp'
$work = "$t\card064"
New-Item -ItemType Directory -Force $work | Out-Null
$parentApk = "$Repo\android\app-parent\build\outputs\apk\debug\app-parent-debug.apk"
$parent = 'au.screentime.parent'
$releases = "$Repo\deploy\releases"
$failed = 0

function Check([string]$name, [bool]$ok) {
    if ($ok) { Write-Output "PASS $name" } else { Write-Output "FAIL $name"; $script:failed++ }
}
function Ui {
    & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
    & $adb pull /sdcard/ui.xml "$t\ui.xml" 2>&1 | Out-Null
    [xml]$ui = Get-Content "$t\ui.xml" -Raw -Encoding UTF8
    $ui.SelectNodes('//node')
}
function Tap-Text([string]$text, [int]$wait = 2) {
    $node = Ui | Where-Object { $_.text -eq $text } | Select-Object -First 1
    if (-not $node) { throw "No '$text' on screen" }
    $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
    & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
    Start-Sleep -Seconds $wait
}
function Screen-Text { ((Ui) | Where-Object { $_.text } | ForEach-Object { $_.text }) -join ' | ' }
function Shot([string]$name) {
    & $adb shell screencap -p /sdcard/shot.png
    & $adb pull /sdcard/shot.png "$t\$name.png" 2>&1 | Out-Null
    Write-Output "  screenshot: $t\$name.png"
}
function Open-Package([string]$package) {
    & $adb shell monkey -p $package -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
    Start-Sleep -Seconds 3
}
function Psql([string]$sql) { (docker exec screentime-db-1 psql -U screentime -d screentime -Atc $sql) -join ' ' }
function Focus { ((& $adb shell dumpsys window | Select-String 'mCurrentFocus') -join ' ').Trim() }
function Installed {
    $d = & $adb shell dumpsys package $parent
    $code = ($d | Select-String 'versionCode=(\d+)' | Select-Object -First 1).Matches[0].Groups[1].Value
    $by = ($d | Select-String 'installerPackageName=(\S+)' | Select-Object -First 1).Matches[0].Groups[1].Value
    "versionCode=$code installer=$by"
}
# Writes the APK first and parent.json last, as deploy\publish-downloads.ps1 does.
function Publish([string]$apk, [int]$code, [string]$name, [string]$sha = '', [string[]]$parentIds = @()) {
    $file = "parent-$code.apk"
    Copy-Item $apk "$releases\$file" -Force
    $release = [ordered]@{
        versionCode = $code
        versionName = $name
        sha256      = if ($sha) { $sha } else { (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant() }
        sizeBytes   = (Get-Item $apk).Length
        file        = $file
    }
    if ($parentIds.Count -gt 0) { $release.parentIds = $parentIds }
    [IO.File]::WriteAllText("$releases\parent.json", ($release | ConvertTo-Json -Compress))
    Write-Output "  published: $([IO.File]::ReadAllText("$releases\parent.json"))"
}
function Settings-Bottom {
    Tap-Text 'Settings' 2
    & $adb shell input swipe 540 1900 540 300 300
    Start-Sleep -Seconds 1
}
# Waits up to $seconds for $text on the screen; returns the last Screen-Text.
function Wait-For([string]$text, [int]$seconds) {
    $end = (Get-Date).AddSeconds($seconds)
    do {
        $screen = Screen-Text
        if ($screen.Contains($text)) { return $screen }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $end)
    return $screen
}
# After Update, answers whatever asks until version $code is installed: Android's "Update this app?" (Update) and
# Play Protect's "App scan recommended" (More details, then Install without scanning; never Scan app, which uploads
# the APK to Google). Prints each question and returns their names in order.
function Answer-Until([int]$code, [string]$shot) {
    $asked = @()
    $end = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $end -and -not (Installed).Contains("versionCode=$code ")) {
        $screen = Screen-Text
        if ($screen.Contains('Update this app?')) {
            Write-Host "  Android asks: $screen"
            Shot "$shot-android" | Write-Host
            $asked += 'Update this app?'
            Tap-Text 'Update' 3
        } elseif ($screen.Contains('App scan recommended')) {
            Write-Host "  Play Protect asks: $screen"
            Shot "$shot-play-protect" | Write-Host
            $asked += 'Play Protect'
            if ($screen.Contains('More details')) { Tap-Text 'More details' 2 }
            # "Install without scanning" is the last line of a longer text block: tap just above its bottom edge.
            $node = Ui | Where-Object { $_.text -like '*Install without scanning' } | Select-Object -First 1
            $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
            & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ($b[3] - 24)
            Start-Sleep -Seconds 3
        } else {
            Start-Sleep -Seconds 1
        }
    }
    return ,$asked
}
function Wait-Version([int]$code) {
    $end = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $end -and -not (Installed).Contains("versionCode=$code ")) { Start-Sleep -Seconds 1 }
}

Write-Output '--- 1. Three versions of the debug app'
Push-Location "$Repo\android"
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
foreach ($v in @(@(900, '0.9.0'), @(901, '0.9.1'), @(902, '0.9.2'))) {
    .\gradlew.bat :app-parent:assembleDebug "-PparentVersionCode=$($v[0])" "-PparentVersionName=$($v[1])" --quiet 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "build $($v[0]) failed" }
    Copy-Item $parentApk "$work\parent-$($v[0]).apk" -Force
    Write-Output "  built $($v[0]): $((Get-Item "$work\parent-$($v[0]).apk").Length) bytes"
}
Pop-Location

Write-Output '--- 2. A wiped emulator'
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

Write-Output '--- 3. A fresh server with no parent.json'
Set-Content "$Repo\deploy\.env" "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" down -v 2>&1 | Out-Null
docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" up -d --build --wait 2>&1 | Out-Null
$env:DATABASE_URL = 'postgres://screentime:local-dev-only@localhost:5432/screentime'
$env:JWT_SECRET = 'local-dev-only-secret-at-least-32-characters'
Set-Location $Repo
pnpm --silent --filter '@screentime/server' exec tsx scripts/seed-dev.ts dad@example.com
New-Item -ItemType Directory -Force "$work\releases-before" | Out-Null
Get-ChildItem $releases -Filter 'parent*' -ErrorAction SilentlyContinue | Move-Item -Destination "$work\releases-before" -Force
Check 'no parent.json' (-not (Test-Path "$releases\parent.json"))

Write-Output '--- 4. Version 0.9.0 installed by "Chrome", signed in (criterion 14)'
& $adb push "$work\parent-900.apk" /data/local/tmp/parent-900.apk | Out-Null
& $adb shell pm install -i com.android.chrome /data/local/tmp/parent-900.apk
Write-Output "  $(Installed)"
Open-Package $parent
Tap-Text 'Email'
& $adb shell input text 'dad@example.com'
Start-Sleep -Seconds 1
Tap-Text 'Send code' 4
$code = [regex]::Match(((docker logs --tail 20 screentime-api-1 2>&1 | Select-String 'sign-in code' | Select-Object -Last 1).Line), '\d{6}$').Value
& $adb shell input text $code
Start-Sleep -Seconds 1
Tap-Text 'Sign in' 5
if ((Screen-Text).Contains('Allow')) { Tap-Text 'Allow' 3 }
$screen = Screen-Text
Write-Output "  $screen"
Check 'signed in on Today' ($screen.Contains('Today'))
Check 'no update row' (-not $screen.Contains('ST Parent'))
Settings-Bottom
$screen = Wait-For 'Up to date' 15
Write-Output "  $screen"
Check 'Settings: Version 0.9.0 and Up to date' ($screen.Contains('Version 0.9.0') -and $screen.Contains('Up to date'))
Write-Output "  parent_sessions: $(Psql "select client, app_version from parent_sessions where revoked_at is null")"

Write-Output '--- 5. 0.9.1 published; Check for updates (criterion 15)'
Publish "$work\parent-901.apk" 901 '0.9.1'
Tap-Text 'Check for updates' 0
$screen = Wait-For 'ST Parent 0.9.1 is ready' 60
Write-Output "  $screen"
Check 'row: ST Parent 0.9.1 is ready' ($screen.Contains('ST Parent 0.9.1 is ready'))
Shot 'card064-ready'

Write-Output '--- 6. Install unknown apps not allowed yet: Update (criterion 16)'
Write-Output "  appops: $((& $adb shell appops get $parent REQUEST_INSTALL_PACKAGES) -join ' ')"
Tap-Text 'Update' 4
$screen = Screen-Text
Write-Output "  $screen"
Write-Output "  focus: $(Focus)"
Check "Android's screen is up, not ST Parent" (-not (Focus).Contains("$parent/"))
Shot 'card064-unknown-sources'
for ($i = 0; $i -lt 4 -and -not (Focus).Contains("$parent/"); $i++) {
    & $adb shell input keyevent KEYCODE_BACK
    Start-Sleep -Seconds 2
}
$screen = Wait-For "didn't install" 10
Write-Output "  $screen"
Check "row: ST Parent 0.9.1 didn't install" ($screen.Contains("ST Parent 0.9.1 didn't install"))
Shot 'card064-didnt-install'

Write-Output '--- 7. Allowed; Update; whatever asks is answered (criterion 17)'
& $adb shell appops set $parent REQUEST_INSTALL_PACKAGES allow
Write-Output "  appops: $((& $adb shell appops get $parent REQUEST_INSTALL_PACKAGES) -join ' ')"
Tap-Text 'Update' 0
$asked1 = Answer-Until 901 'card064-first'
Write-Output "  questions on the first update: [$($asked1 -join ', ')]"
$installedAt = Get-Date
$inst = Installed
Write-Output "  $inst"
Check 'versionCode 901, its own installer' ($inst -eq 'versionCode=901 installer=au.screentime.parent')

Write-Output '--- 8. Does the app come back by itself? (criterion 18)'
$back = $false
while (((Get-Date) - $installedAt).TotalSeconds -lt 15) {
    if ((Focus).Contains("$parent/")) { $back = $true; break }
    Start-Sleep -Seconds 1
}
Write-Output "  focus: $(Focus)"
Check 'ST Parent is in front within 15 s' $back
if (-not $back) { Write-Output '  opening it by hand for the next steps'; Open-Package $parent }
Start-Sleep -Seconds 5
$v = Psql "select app_version from parent_sessions where revoked_at is null and client = 'android'"
Write-Output "  app_version: $v"
Check 'app_version is 0.9.1' ($v -eq '0.9.1')

Write-Output '--- 9. 0.9.2: no question from Android (criterion 19)'
Publish "$work\parent-902.apk" 902 '0.9.2'
Settings-Bottom
Tap-Text 'Check for updates' 0
$screen = Wait-For 'ST Parent 0.9.2 is ready' 60
Write-Output "  $screen"
Check 'row: ST Parent 0.9.2 is ready' ($screen.Contains('ST Parent 0.9.2 is ready'))
Tap-Text 'Update' 0
$asked2 = Answer-Until 902 'card064-second'
Write-Output "  questions on the second update: [$($asked2 -join ', ')]"
Check 'Android did not ask Update this app?' (-not ($asked2 -contains 'Update this app?'))
$inst = Installed
Write-Output "  $inst"
Check 'versionCode 902' ($inst.Contains('versionCode=902 '))
Start-Sleep -Seconds 5
Write-Output "  focus: $(Focus)"
if (-not (Focus).Contains("$parent/")) { Write-Output '  opening it by hand'; Open-Package $parent }
Settings-Bottom
$screen = Wait-For 'Up to date' 20
Write-Output "  $screen"
Check 'Settings: Version 0.9.2 and Up to date' ($screen.Contains('Version 0.9.2') -and $screen.Contains('Up to date'))
Shot 'card064-second-update'
$files = (& $adb shell "run-as $parent ls cache/update 2>/dev/null") -join ' '
Write-Output "  cache/update: [$files]"
Check 'old update files deleted' (-not $files.Contains('parent-901') -and -not $files.Contains('parent-902'))

Write-Output '--- 10. A wrong sha256 is refused (criterion 20)'
Copy-Item "$work\parent-902.apk" "$work\parent-903.apk" -Force
& $adb logcat -c
Publish "$work\parent-903.apk" 903 '0.9.3' ('0' * 64)
Tap-Text 'Check for updates' 0
Start-Sleep -Seconds 60
$screen = Screen-Text
Write-Output "  after 60 s: $screen"
Check 'never ready' (-not $screen.Contains('is ready'))
$log = (& $adb logcat -d -s 'ParentUpdate:*' | Select-String 'update:') -join "`n  "
Write-Output "  logcat:`n  $log"
Check 'logged: does not match' ($log.Contains('does not match'))

Write-Output '--- 11. Offered to another parent only (criterion 21)'
Publish "$work\parent-903.apk" 903 '0.9.3' '' @([guid]::NewGuid().ToString())
Write-Output '  waiting 65 s, then leaving and reopening the app so the 1-minute check runs'
Start-Sleep -Seconds 65
& $adb shell input keyevent KEYCODE_HOME
Start-Sleep -Seconds 2
Open-Package $parent
Settings-Bottom
$screen = Wait-For 'Up to date' 20
Write-Output "  $screen"
Check 'Settings: Up to date, no row' ($screen.Contains('Up to date') -and -not $screen.Contains('ST Parent 0.9.3'))

Write-Output '--- Done'
Remove-Item "$releases\parent.json", "$releases\parent-90*.apk" -Force -ErrorAction SilentlyContinue
Get-ChildItem "$work\releases-before" | Move-Item -Destination $releases -Force
Write-Output "  failed checks: $failed"
