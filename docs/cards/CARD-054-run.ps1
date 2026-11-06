# CARD-054: checks the guides against the code, and tries the release path they describe on an emulator.
# Run from the repo root in PowerShell 7: pwsh -File docs\cards\CARD-054-run.ps1
# It uses a throwaway key in the temp folder and removes android\keystore.properties at the end. It never touches a real device or the server.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Run this with pwsh (PowerShell 7).' }
$Repo = (Get-Location).Path
if (-not (Test-Path "$Repo\docs\guides\windows-install.md")) { throw 'Run this from the repo root.' }
if (Test-Path "$Repo\android\keystore.properties") { throw 'android\keystore.properties is already there. It may be the real one: move it away first.' }
$temp = (Resolve-Path "$Repo\..\temp").Path
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$adb = "$sdk\platform-tools\adb.exe"
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$script:failed = 0
function Check([string]$name, [bool]$ok) {
    if ($ok) { Write-Output "PASS $name" } else { Write-Output "FAIL $name"; $script:failed++ }
}
function Screen-Text {
    (& $adb exec-out uiautomator dump /dev/tty 2>$null | Select-String -Pattern 'text="([^"]+)"' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value }) -join ' | '
}
function Clean-Up {
    Remove-Item "$Repo\android\keystore.properties" -Force -ErrorAction SilentlyContinue
    & $adb emu kill 2>$null | Out-Null
    & $adb kill-server 2>$null | Out-Null
    Push-Location "$Repo\android"
    & .\gradlew.bat --stop 2>$null | Out-Null
    Pop-Location
}
trap { Write-Output "FAIL the run stopped: $_"; Clean-Up; exit 1 }

$android = Get-Content "$Repo\docs\guides\android-provisioning.md" -Raw
$windows = Get-Content "$Repo\docs\guides\windows-install.md" -Raw
$deploy = Get-Content "$Repo\docs\guides\deploy.md" -Raw

Write-Output '--- 1. What the guides name is really there'
foreach ($file in 'android\publish-kid.ps1', 'android\gradle.properties', 'android\app-parent\build.gradle.kts', 'deploy\unraid\docker-compose.yml', '.github\workflows\windows.yml', 'server\scripts\dev-enrol-code.ts') {
    Check "file $file" (Test-Path "$Repo\$file")
}
function Source-Has([string]$words, [string[]]$folders) {
    foreach ($folder in $folders) {
        if (Get-ChildItem "$Repo\$folder" -Recurse -File -Include *.kt, *.cs, *.xaml, *.tsx | Select-String -SimpleMatch $words -List | Select-Object -First 1) { return $true }
    }
    return $false
}
$kid = 'android\app-kid\src\main'; $parent = 'android\app-parent\src\main'
foreach ($words in "I'm the parent", 'Enter parent code instead', 'Remove Screen Time', 'Remove it', 'Keep it', 'Connect to your family', 'Scan QR code') {
    Check "kid app says: $words" ((Source-Has ($words -replace "'", '') @($kid)) -or (Source-Has $words @($kid)) -or (Source-Has ($words -replace "'", '\u2019') @($kid)))
    Check "the Android guide has: $words" ($android.Contains($words))
}
foreach ($words in 'Parent sign-in', 'Send code') {
    Check "parent app says: $words" (Source-Has $words @($parent))
    Check "the Android guide has: $words" ($android.Contains($words))
}
$setup = 'windows\src\ScreenTime.Tray\Setup', 'windows\src\ScreenTime.Core\Setup'
foreach ($words in 'Your Screen Time server', 'The accounts on this PC', 'A parent: never limited', 'Screen Time answers at', 'Connect', 'Finish') {
    Check "setup window says: $words" (Source-Has $words $setup)
    Check "the Windows guide has: $words" ($windows.Contains($words))
}
Check 'the installer names Screen Time Setup' ((Get-Content "$Repo\windows\src\ScreenTime.Installer\Package.wxs" -Raw).Contains('Name="Screen Time Setup"'))
Check 'the Windows guide has Screen Time Setup' ($windows.Contains('Screen Time Setup'))
Check 'the web app says Screen Time Setup' (Source-Has 'Screen Time Setup' @('web\src'))
Check 'the web app says the guide is the way' (-not (Source-Has 'runs the ScreenTime installer' @('web\src')))
Check 'CI can build an MSI on request' ((Get-Content "$Repo\.github\workflows\windows.yml" -Raw) -match '(?m)^  workflow_dispatch:')
Check 'the Android guide warns about the key' ($android.Contains('If you lose this key') -and $android.Contains('Back it up now'))
Check 'the Android guide names the gap' ($android.Contains('Factory Reset Protection is not built'))
Check 'the deploy guide has the releases folder' ($deploy.Contains('## Kid app releases') -and $deploy.Contains('/mnt/user/appdata/screentime/releases'))
Check 'the deploy guide points at the Windows guide' ($deploy.Contains('docs/guides/windows-install.md'))
Check 'git ignores the key file' ([bool](git check-ignore android/keystore.properties))

Write-Output '--- 2. The guide''s build, with a throwaway key'
$store = "$temp\card054-test.keystore"
Remove-Item $store -Force -ErrorAction SilentlyContinue
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $store -storepass throwaway-only -keypass throwaway-only -alias screentime -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Screen Time' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
Set-Content "$Repo\android\keystore.properties" "storeFile=$($store.Replace('\','/'))`nstorePassword=throwaway-only`nkeyAlias=screentime`nkeyPassword=throwaway-only"
Push-Location "$Repo\android"
& .\gradlew.bat :app-kid:assembleRelease :app-parent:assembleRelease --quiet 2>&1 | Where-Object { $_ -notmatch '^w:' } | Select-Object -Last 5
$built = $LASTEXITCODE
Pop-Location
if ($built -ne 0) { throw 'The release builds failed.' }
$kidApk = "$Repo\android\app-kid\build\outputs\apk\release\app-kid-release.apk"
$parentApk = "$Repo\android\app-parent\build\outputs\apk\release\app-parent-release.apk"
foreach ($apk in $kidApk, $parentApk) {
    $signer = (& "$sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs $apk 2>$null | Select-Object -First 1)
    Write-Output "  $signer"
    Check "signed with the key: $(Split-Path $apk -Leaf)" ([string]$signer -match 'CN=Screen Time')
}
$status = (git status --short | Select-String 'keystore')
Check 'git sees neither the key nor its file' (-not $status)

Write-Output '--- 3. A wiped emulator, as the guide does it (release builds, no pairing)'
Start-Process "$sdk\emulator\emulator.exe" -ArgumentList '-avd Medium_Phone_API_37.0 -wipe-data -no-snapshot-save -no-audio -no-boot-anim -no-window -memory 3072' -WindowStyle Hidden
& $adb wait-for-device
$tries = 0
while ((& $adb shell getprop sys.boot_completed 2>$null) -ne '1' -and $tries -lt 100) { Start-Sleep 3; $tries++ }
Start-Sleep 20
& $adb install $kidApk | Select-Object -Last 1
foreach ($try in 1..8) {
    $said = (& $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver 2>&1) -join "`n"
    if ($said -match '^Success') { Write-Output "  Device Owner on try $try"; break }
    Write-Output "  try ${try}: not yet"
    Start-Sleep 15
}
& $adb shell cmd appops set au.screentime.kid GET_USAGE_STATS allow
& $adb shell cmd role add-role-holder android.app.role.CALL_REDIRECTION au.screentime.kid
$owners = (& $adb shell cmd device_policy list-owners) -join ' '
$usage = (& $adb shell cmd appops get au.screentime.kid GET_USAGE_STATS) -join ' '
$role = (& $adb shell cmd role get-role-holders android.app.role.CALL_REDIRECTION) -join ' '
Write-Output "  $owners"; Write-Output "  $usage"; Write-Output "  role: $role"
Check 'Device Owner' ($owners -match 'au\.screentime\.kid/\.admin\.KidDeviceAdminReceiver,DeviceOwner')
Check 'usage access' ($usage -match 'GET_USAGE_STATS: allow')
Check 'the call role' ($role -match 'au\.screentime\.kid')
& $adb shell monkey -p au.screentime.kid -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
Start-Sleep 6
$text = Screen-Text
Write-Output "  kid app: $text"
Check 'the release kid app opens on its setup screen' ($text -match 'Connect to your family')
# The keyboard covers the server line; Back closes the keyboard, not the screen.
& $adb shell input keyevent KEYCODE_BACK
Start-Sleep 2
$text = Screen-Text
Write-Output "  without the keyboard: $text"
Check 'with the real server' ($text -match 'screentime\.gallagherhome\.au')

Write-Output '--- 4. The parents'' phone'
& $adb install $parentApk | Select-Object -Last 1
& $adb shell monkey -p au.screentime.parent -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
Start-Sleep 6
$text = Screen-Text
Write-Output "  parent app: $text"
Check 'the release parent app opens on sign-in' ($text -match 'Parent sign-in')
$crashes = (& $adb logcat -d -b crash | Measure-Object -Line).Lines
Write-Output "  crash log lines: $crashes"
Check 'nothing crashed' ($crashes -eq 0)
& $adb exec-out screencap -p > "$temp\card054-parent.png"

Clean-Up
Check 'the key file is gone again' (-not (Test-Path "$Repo\android\keystore.properties"))
Write-Output "--- Finished with $script:failed failed."
