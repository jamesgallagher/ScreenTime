# Proves websites on a PC (docs/SPEC.md §12.10) in Windows Sandbox. Run from the repo root, with Docker
# Desktop running, Windows Sandbox turned on and the PC unlocked:
#   windows\installer\sandbox\Test-Sites.ps1 -Msi <path to ScreenTime.msi>
# Inside, in-sandbox-sites.ps1 installs the MSI, enrols the account as Sam, checks the policies and the DNS
# log, opens Edge on three pages, then closes Edge and waits for the host. The host polls dev-sites.ts until
# two runs in a row agree, writes the go-ahead, waits for the Sandbox to finish, then checks the stored sites.
param([Parameter(Mandatory)][string]$Msi)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-sites-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null
Copy-Item $Msi (Join-Path $in "ScreenTime.msi")
Copy-Item (Join-Path $here "in-sandbox-sites.ps1") $in

function HostCheck([bool]$ok, [string]$msg) {
    if ($ok) { "ok: $msg" } else { "FAILED: $msg" }
}

"--- the dev server"
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v 2>&1 | Out-Null
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait 2>&1 | Select-Object -Last 1
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
# Sam's schedule gets a 25-minute allowance; the bedtime is "minutes from now", but must not cross midnight in the
# family's time zone (dev-bedtime throws if now + minutes + 1 reaches midnight). Pick the largest value that is
# safe at any hour of the day; skip the call if the night is too close to midnight (Sam then keeps the seed
# schedule, which is also valid, so counting still runs through the ~3-minute Edge test).
$sydney = [System.TimeZoneInfo]::ConvertTime([DateTime]::Now, [System.TimeZoneInfo]::FindSystemTimeZoneById("Australia/Sydney"))
$minsUntilMidnight = 24 * 60 - ($sydney.Hour * 60 + $sydney.Minute)
$bedtimeMinutes = [Math]::Min(120, $minsUntilMidnight - 2)
if ($bedtimeMinutes -ge 5) {
    pnpm --silent --filter @screentime/server exec tsx scripts/dev-bedtime.ts Sam $bedtimeMinutes 25
} else {
    "dev-bedtime skipped (too close to midnight): Sam keeps the seed schedule"
}
$code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
Set-Content (Join-Path $in "code.txt") $code

$wsb = Join-Path $work "run.wsb"
Set-Content $wsb @"
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox-sites.ps1</Command></LogonCommand>
</Configuration>
"@
"--- the Sandbox (a window opens and closes by itself; do not use it)"
Start-Process $wsb
$results = Join-Path $out "results.txt"
$waited = 0
while (-not ((Test-Path $results) -and (Select-String -Path $results -Pattern "=== 5\." -Quiet)) -and $waited -lt 300) { Start-Sleep 5; $waited += 5 }
"--- the Sandbox reached the wait (saw it after $waited s)"

# Poll dev-sites.ts every 10 s until its output has not changed for 70 s (the service syncs about once
# a minute, so a shorter wait can stop between two uploads); at most 4 minutes.
$last = ""
$stable = 0
$t = 0
while ($t -lt 240) {
    $now = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-sites.ts Sam 2>&1 | Out-String).Trim()
    # A site row is "<site> | <package> | <lookups> | first..last". Two equal runs only count once at least one
    # site row is there (two empty runs must not be taken as the uploads being done).
    $siteRows = (($now -split "(?m)^titles:" | Select-Object -First 1) -split "`n") | Where-Object { $_ -match '^\S+ \| \S+ \| \d+ \|' }
    if ($now -eq $last -and ($siteRows | Measure-Object).Count -ge 1) { $stable++ } else { $stable = 0; $last = $now }
    if ($stable -ge 7) { break }
    Start-Sleep 10
    $t += 10
}
"--- last dev-sites.ts output (after $t s)"
$last

"--- the go-ahead"
Set-Content (Join-Path $in "stop.txt") "go"
$waited2 = 0
while (-not (Select-String -Path $results -Pattern "=== done:" -Quiet) -and $waited2 -lt 120) { Start-Sleep 5; $waited2 += 5 }
"--- what the Sandbox saw (go-ahead wait $waited s, done wait $waited2 s)"
Get-Content $results
"--- host checks"
$sitePart = ($last -split "(?m)^titles:" | Select-Object -First 1)
$titlePart = ($last -split "(?m)^titles:" | Select-Object -Skip 1)
HostCheck ($sitePart -like "*wikipedia.org | msedge.exe*") "site_daily has wikipedia.org (msedge.exe)"
HostCheck ($sitePart -like "*abc.net.au | msedge.exe*") "site_daily has abc.net.au (msedge.exe)"
HostCheck ($sitePart -like "*bing.com | msedge.exe*") "site_daily has bing.com (msedge.exe)"
HostCheck (-not ($sitePart -match 'svchost\.exe|screentime\.tray\.exe|screentime\.service\.exe')) "no svchost/tray/service package in site_daily"
function Sum-TitleSec([string]$part, [scriptblock]$pred) {
    $total = 0
    foreach ($line in ($part -split "`n") | Where-Object { $_ -match "^\d{2}:\d{2}:\d{2} \|" }) {
        $parts = $line -split '\s\|\s'
        if ($parts.Count -lt 4) { continue }
        $title = ($parts[3..($parts.Count - 1)] -join ' | ')
        if ($parts[2] -eq "msedge.exe" -and (& $pred $title)) { $total += [int]$parts[1] }
    }
    $total
}
$wikiSec = Sum-TitleSec $titlePart { param($t) $t -like "*Wikipedia*" }
HostCheck ($wikiSec -ge 10 -and $wikiSec -le 25) "Wikipedia title, msedge.exe, 10 to 25 s (got $wikiSec)"
$abcSec = Sum-TitleSec $titlePart { param($t) $t.Contains("[InPrivate]") -and $t.Contains("ABC") }
HostCheck ($abcSec -ge 20 -and $abcSec -le 35) "[InPrivate] ABC title, msedge.exe, 20 to 35 s (got $abcSec)"
$drawSec = Sum-TitleSec $titlePart { param($t) $t.Contains("how to draw") -and $t.Contains("[InPrivate]") }
HostCheck ($drawSec -ge 10 -and $drawSec -le 25) "how to draw [InPrivate] title, msedge.exe, 10 to 25 s (got $drawSec)"
$badTitlePkg = ($titlePart -split "`n") | Where-Object { $_ -match "^\d{2}:\d{2}:\d{2} \|" } | ForEach-Object {
    $parts = $_ -split '\s\|\s'
    if ($parts.Count -ge 3 -and $parts[2] -notin @("msedge.exe", "chrome.exe", "brave.exe", "firefox.exe")) { $parts[2] }
}
HostCheck (($badTitlePkg | Measure-Object).Count -eq 0) "every title row is one of the four browsers"
"--- (full logs in $out)"
