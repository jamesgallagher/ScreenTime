# CARD-075 emulator run (Reports in the parent app). Run from the repo root with: pwsh -File docs\cards\CARD-075-run.ps1
# It wipes the emulator and the development database. Every line it prints goes into the handback.
param([string]$Repo = (Get-Location).Path)
$ErrorActionPreference = 'Stop'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$adb = "$sdk\platform-tools\adb.exe"
$t = Join-Path (Split-Path $Repo) 'temp'
New-Item -ItemType Directory -Force $t | Out-Null
$parentApk = "$Repo\android\app-parent\build\outputs\apk\debug\app-parent-debug.apk"
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
    if (-not $node) {
        # A report list left scrolled down hides the kind switch and the chips: page toward the top and look again.
        foreach ($try in 1..4) {
            & $adb shell input swipe 540 700 540 1600 300
            Start-Sleep -Seconds 1
            Write-Host "  looking for '$text': paged toward the top"
            $node = (Ui).SelectNodes('//node') | Where-Object { $_.text -eq $text } | Select-Object -First 1
            if ($node) { break }
        }
    }
    if (-not $node) { throw "No '$text' on screen" }
    $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
    & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
    Start-Sleep -Seconds $wait
}
# The ‹ arrow and a site's ⋮ have no text, only a content description: this finds the first node whose content-desc
# matches and taps its bounds centre, paging up and down a few times if it is off screen.
function Tap-Desc([string]$desc, [int]$wait = 2) {
    $node = (Ui).SelectNodes('//node') | Where-Object { $_.GetAttribute('content-desc') -eq $desc } | Select-Object -First 1
    if (-not $node) {
        foreach ($dir in @('down', 'down', 'up', 'up', 'up')) {
            if ($dir -eq 'down') { & $adb shell input swipe 540 1600 540 700 300 } else { & $adb shell input swipe 540 700 540 1600 300 }
            Start-Sleep -Seconds 1
            Write-Output "  looking for '$desc': paged $dir"
            $node = (Ui).SelectNodes('//node') | Where-Object { $_.GetAttribute('content-desc') -eq $desc } | Select-Object -First 1
            if ($node) { break }
        }
    }
    if (-not $node) { throw "No content-desc '$desc' on screen" }
    $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
    & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
    Start-Sleep -Seconds $wait
}
# Android's notification question writes "Don’t allow" with a typographic apostrophe (U+2019), so match a pattern.
function Tap-Match([string]$pattern, [int]$wait = 2) {
    $node = (Ui).SelectNodes('//node') | Where-Object { $_.text -match $pattern } | Select-Object -First 1
    if (-not $node) { throw "No text matching '$pattern' on screen" }
    $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
    & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
    Start-Sleep -Seconds $wait
}
function Screen-Text { ((Ui).SelectNodes('//node') | Where-Object { $_.text } | ForEach-Object { $_.text }) -join ' | ' }
function Shot([string]$name) {
    & $adb shell screencap -p /sdcard/shot.png
    & $adb pull /sdcard/shot.png "$t\$name.png" 2>&1 | Out-Null
}
function Wake-Screen { & $adb shell input keyevent KEYCODE_WAKEUP; & $adb shell wm dismiss-keyguard; Start-Sleep -Seconds 2 }
function Open-Package([string]$package) {
    & $adb shell monkey -p $package -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
    Start-Sleep -Seconds 3
}
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
# The full text of a report, from the top of the list to the bottom, so a check never misses a word below the fold.
# (A pull at the top only reloads the same report, so scrolling toward the top first is safe.)
function Collect-Screen([int]$maxSwipes = 3) {
    # Diagnostics go to the host: a Write-Output here would join the function's returned string as another array item.
    $screens = @(Screen-Text)
    Write-Host "  screen: $($screens[0])"
    for ($i = 0; $i -lt 4; $i++) {
        & $adb shell input swipe 540 700 540 1600 300
        Start-Sleep -Seconds 2
        $s = Screen-Text
        if ($s -ne $screens[-1]) {
            $screens += $s
            Write-Host "  screen (scrolled toward the top $($i + 1)): $s"
        } else { break }
    }
    for ($i = 0; $i -lt $maxSwipes; $i++) {
        & $adb shell input swipe 540 1600 540 700 300
        Start-Sleep -Seconds 1
        $s = Screen-Text
        if ($s -eq $screens[-1]) { break }
        $screens += $s
        Write-Host "  screen (paged down $($i + 1)): $s"
    }
    return ($screens -join ' ||| ')
}
function Check-Words([string]$name, [string[]]$words) {
    $all = Collect-Screen
    foreach ($w in $words) { Check "$name has '$w'" ($all.Contains($w)) }
}

Write-Output '--- 1. A wiped emulator, a fresh server, the parent app signed in'
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

Set-Content "$Repo\deploy\.env" "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" down -v 2>&1 | Out-Null
docker compose -f "$Repo\deploy\docker-compose.yml" --env-file "$Repo\deploy\.env" up -d --build --wait 2>&1 | Out-Null
$env:DATABASE_URL = 'postgres://screentime:local-dev-only@localhost:5432/screentime'
$env:JWT_SECRET = 'local-dev-only-secret-at-least-32-characters'
Set-Location $Repo
pnpm --silent --filter '@screentime/server' exec tsx scripts/seed-dev.ts dad@example.com
Check 'server health returned' (Wait-Health)

$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
Push-Location "$Repo\android"
& .\gradlew.bat :app-parent:assembleDebug --quiet 2>&1 | Where-Object { $_ -notmatch '^w:' } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'The parent app did not build' }
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
$asked = Screen-Text
Write-Output "  after sign in: $asked"
if ($asked.Contains('notifications')) {
    Tap-Match '^Don.t allow$' 3
    Write-Output '  answered the notification question with Dont allow'
}
$parentMain = Wait-Screen 'Kids' 30
Write-Output "  parent main screen: $parentMain"

Write-Output '--- 2. Yesterday in the family zone, and the report data'
$zone = [System.TimeZoneInfo]::FindSystemTimeZoneById('Australia/Sydney')
$todayLocal = [System.TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $zone).Date
$yesterday = $todayLocal.AddDays(-1).ToString('yyyy-MM-dd')
Write-Output "yesterday: $yesterday"
$env:DATABASE_URL = 'postgres://screentime:local-dev-only@localhost:5432/screentime'
$data = pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-report-data.ts Alex $yesterday 2>&1
$data | ForEach-Object { Write-Output "  dev-report-data: $_" }

Write-Output '--- 3. Criterion 40: Apps, Yesterday, All devices'
Tap-Text 'Reports' 3
Tap-Desc 'Before' 3
$period = Wait-Screen 'Yesterday' 30
Write-Output "  period screen: $period"
Check-Words 'criterion 40' @('Roblox', '50m', 'YouTube', '40m', 'Minecraft', '20m', 'Report Phone 50m', 'Report PC 20m', 'Other', '1 app under a minute each', 'All devices', 'Report Phone', 'Report PC')
Shot 'card075-apps'

Write-Output '--- 4. Criterion 41: the Report PC chip'
Tap-Text 'Report PC' 3
$pcScreen = Screen-Text
Write-Output "  screen: $pcScreen"
Check 'criterion 41: Report PC shows Minecraft' ($pcScreen.Contains('Minecraft'))
Check 'criterion 41: Report PC does not show Roblox' (-not $pcScreen.Contains('Roblox'))
Tap-Text 'All devices' 3

Write-Output '--- 5. Criterion 42: Websites, Yesterday, All devices'
Tap-Text 'Websites' 3
Check-Words 'criterion 42' @('1 site worth a look', 'Stake', 'Gambling', 'YouTube', '12m', 'Behind the scenes')
Shot 'card075-websites'

Write-Output '--- 6. Criterion 43: set Stake to Games, then go back to automatic'
Tap-Desc 'Change what Stake is' 2
$sheet = Screen-Text
Write-Output "  sheet: $sheet"
Tap-Text 'Games' 2
Tap-Text 'Save' 3
$afterSave = Collect-Screen
$overrides = Db 'select site, kind, category from site_overrides'
Write-Output "  site_overrides: $overrides"
Check 'criterion 43: no worth a look after the parent set Games' (-not $afterSave.Contains('worth a look'))
Check 'criterion 43: the Stake row says Set by a parent' ($afterSave.Contains('Set by a parent'))
Check 'criterion 43: site_overrides has stake.com website games' ($overrides.Contains('stake.com') -and $overrides.Contains('website') -and $overrides.Contains('games'))
Tap-Desc 'Change what Stake is' 2
Tap-Text 'Go back to automatic' 3
$afterBack = Collect-Screen
$overridesAfter = Db 'select site, kind, category from site_overrides'
Write-Output "  site_overrides: $overridesAfter"
Check 'criterion 43: 1 site worth a look is back' ($afterBack.Contains('1 site worth a look'))
Check 'criterion 43: site_overrides has no stake.com row any more' (-not $overridesAfter.Contains('stake.com'))

Write-Output '--- 7. Criterion 44: Searches, Yesterday'
Tap-Text 'Searches' 3
Check-Words 'criterion 44' @('volcano facts', 'Google in Chrome', 'roblox promo codes', 'Google app', 'Searches', '2')
Shot 'card075-searches'
# Collect-Screen left the list scrolled down; a pull only refreshes from the top, so page back up first.
for ($i = 0; $i -lt 4; $i++) {
    $before = Screen-Text
    & $adb shell input swipe 540 700 540 1600 300
    Start-Sleep -Seconds 1
    if ((Screen-Text) -eq $before) { break }
}
Write-Output "  screen at the top: $(Screen-Text)"

Write-Output '--- 8. Criterion 45: the server stopped, pull down on Searches'
docker stop screentime-api-1
$offline = ''
foreach ($try in 1..3) {
    & $adb shell input swipe 540 700 540 1600 300
    Start-Sleep -Seconds 5
    $offline = Screen-Text
    Write-Output "  screen (pull $try): $offline"
    if ($offline.Contains("Can't reach Screen Time. Check the internet connection.")) { break }
}
Check 'criterion 45: the can''t-reach words show' ($offline.Contains("Can't reach Screen Time. Check the internet connection."))
Check 'criterion 45: volcano facts still on screen' ($offline.Contains('volcano facts'))
Check 'criterion 45: roblox promo codes still on screen' ($offline.Contains('roblox promo codes'))
docker start screentime-api-1
Check 'server health returned' (Wait-Health)

Write-Output '--- 9. Cleanup'
$reportDevices = Db "select name, platform from devices where name like 'Report %'"
Write-Output "  devices: $reportDevices"
Get-Process emulator*, qemu-system* -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
& $adb kill-server 2>&1 | Out-Null
& "$Repo\android\gradlew.bat" -p "$Repo\android" --stop 2>&1 | Out-Null
Write-Output "--- Finished with $failed failed."
