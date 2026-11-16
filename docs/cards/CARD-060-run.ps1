# CARD-060's run: games on a PC, end to end, on this PC and in the temp folder only (docs/SPEC.md §12.6).
#
# It builds a fake "Star Rail" that demands an administrator like the real game, enrols this Windows account as the
# kid, starts the service and tray (dry lock, so nothing is ever locked), plays the parent through dev-game.ts, and
# checks the desktop shortcut, the start without an administrator and the config fix. It stops what it started and
# removes the shortcuts it caused, also when a step fails.
#
# Run it from the repo root with PowerShell 7, with the local server up and seeded, after building the service and
# the tray in Release:
#   $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
#   $env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
#   pwsh -File docs\cards\CARD-060-run.ps1
param(
    [string]$Server = 'http://localhost:8080',
    [string]$Kid = 'Sam',
    [string]$Temp = 'C:\Users\james\OpenCode\Testing\temp'
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Run this with PowerShell 7 (pwsh), not Windows PowerShell 5.1.' }
if (-not $env:DATABASE_URL -or -not $env:JWT_SECRET) { throw 'Set DATABASE_URL and JWT_SECRET first (see the top of this file).' }

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $repo
$env:SERVER_URL = $Server
$t = "$Temp\c060"
$root = "$t\games"
$fake = "$root\Star Rail Games"
$log = "$Temp\c060-service.log"
$svcExe = (Resolve-Path 'windows\src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe').Path
$trayExe = (Resolve-Path 'windows\src\ScreenTime.Tray\bin\Release\net10.0-windows10.0.26100.0\win-x64\ScreenTime.Tray.exe').Path
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$local = "$env:LOCALAPPDATA\ScreenTime"
$trayLog = "$local\tray.log"
$session = (Get-Process -Id $PID).SessionId
$failed = 0

function Game { pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-game.ts $Kid @args }
function Shortcuts { @(Get-ChildItem $desktop -Filter 'Play *.lnk' | Sort-Object Name | ForEach-Object Name) }
function WaitFor([scriptblock]$until, [int]$seconds) {
    $end = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $end) { if (& $until) { return $true }; Start-Sleep -Milliseconds 500 }
    return [bool](& $until)
}
function Check([string]$what, [bool]$ok) {
    if ($ok) { "ok: $what" } else { $script:failed++; "FAILED: $what" }
}

"=== start $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') session $session desktop $desktop"
if (Shortcuts) { throw "There are already 'Play *.lnk' shortcuts on the desktop: $((Shortcuts) -join ', '). Move them away first." }
$service = $null
try {
    '=== 1 a fake game that demands an administrator'
    Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $log, "$log.err", $trayLog, "$local\games.json" -Force -ErrorAction SilentlyContinue
    dotnet build windows\tools\NeedsAdmin -c Release -p:AssemblyName=StarRail -o $fake -v q --nologo | Select-String 'Warning\(s\)|Error\(s\)' | ForEach-Object { $_.Line.Trim() }
    [IO.File]::WriteAllText("$fake\config.ini", "[General]`r`ngame_version=4.7.0`r`nchannel=1`r`nsub_channel=3`r`ncps=psseaepic`r`n")
    Check 'the fake StarRail.exe is built' (Test-Path "$fake\StarRail.exe")

    '=== 2 enrol this account as the kid'
    $code = (pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-enrol-code.ts $Kid pc | Select-String '\d{6}').Matches[0].Value
    & $svcExe enrol --server $Server --code $code --user $env:USERNAME --data $t
    Check 'enrolled' ($LASTEXITCODE -eq 0)

    '=== 3 the service finds the game and tells the server'
    $service = Start-Process $svcExe -ArgumentList @('--data', $t, '--dry-lock', '--session', $session, '--tray', $trayExe, '--games-root', $root) -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
    "service pid $($service.Id)"
    $told = WaitFor { (Test-Path $log) -and (Select-String $log -Pattern 'told the server' -Quiet) } 60
    Select-String $log -Pattern 'games: |told the server|tray .*: (started|hello)' | ForEach-Object { $_.Line.Trim() }
    Check 'the service told the server 1 game' ($told -and (Select-String $log -Pattern 'told the server 1 games' -Quiet))
    Game list

    '=== 4 a parent turns the shortcut on'
    Game shortcut starrail on
    $made = WaitFor { (Shortcuts) -contains 'Play Honkai Star Rail.lnk' } 20
    Shortcuts
    Check 'the shortcut is on the desktop' $made
    if ($made) {
        $link = (New-Object -ComObject WScript.Shell).CreateShortcut("$desktop\Play Honkai Star Rail.lnk")
        "shortcut: $($link.TargetPath) $($link.Arguments) | icon $($link.IconLocation)"
        Check 'it runs the tray with --play starrail and has the game icon' ($link.TargetPath -eq $trayExe -and $link.Arguments -eq '--play starrail' -and $link.IconLocation -eq "$fake\StarRail.exe,0")
    }

    '=== 5 the shortcut starts the game without an administrator, after fixing config.ini'
    if ($made) { Start-Process "$desktop\Play Honkai Star Rail.lnk" }
    $ran = WaitFor { Test-Path "$fake\ran.txt" } 30
    if ($ran) { Get-Content "$fake\ran.txt" }
    Get-Content "$fake\config.ini" | Select-String '^(sub_channel|cps)=' | ForEach-Object Line
    Get-Content $trayLog | Select-String 'play:' | ForEach-Object Line
    Check 'the game ran and was not elevated' ($ran -and (Get-Content "$fake\ran.txt") -match 'elevated=False .*layer=RunAsInvoker')
    Check 'config.ini has the official channel' ((Get-Content "$fake\config.ini" -Raw) -match "sub_channel=0`r`ncps=hoyoverse`r`n")

    '=== 6 the kid deletes the shortcut; a parent adds a program: both are there after the next sync'
    Remove-Item "$desktop\Play Honkai Star Rail.lnk" -Force -ErrorAction SilentlyContinue
    $added = Game add 'Who am I?' 'C:\Windows\System32\whoami.exe'
    $added
    $both = WaitFor { (Shortcuts).Count -eq 2 } 20
    Shortcuts
    Check 'both shortcuts are on the desktop' ($both -and ((Shortcuts) -join '|') -eq 'Play Honkai Star Rail.lnk|Play Who am I.lnk')

    '=== 7 the program is removed and the game turned off: the desktop is clean'
    Game remove ($added | Select-Object -First 1)
    Game shortcut starrail off
    $clean = WaitFor { (Shortcuts).Count -eq 0 } 20
    Get-Content $trayLog | Select-String 'games:' | ForEach-Object Line
    Check 'no shortcut is left' $clean
    Game list
}
finally {
    '=== stop'
    if ($service) { Stop-Process -Id $service.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep 2
    Get-Process ScreenTime.Tray -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $trayExe } | Stop-Process -Force -ErrorAction SilentlyContinue
    foreach ($name in 'Play Honkai Star Rail.lnk', 'Play Who am I.lnk') { Remove-Item "$desktop\$name" -Force -ErrorAction SilentlyContinue }
    Remove-Item "$local\games.json" -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
    "left running: $(@(Get-Process ScreenTime.* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$repo*" }).Count)"
}
"=== done: $failed failed"
exit $failed
