# CARD-073: proves criteria 5 to 10 in Windows Sandbox. The guest (in-sandbox-stall.ps1) installs the MSI and
# its restart-on-failure recovery, enrols as Sam with 1 minute of Screens time and records the minute being
# used up (5, section 4); freezes the tray with NtSuspendProcess and proves an out-of-time session still locks
# within 15 s and the loops still sync (6, 7); stalls the 1-second lock loop with the service's test-only
# --stall-test-file switch and proves the watchdog restarts the service and it locks, leaving exactly one tray
# and no tamper event (8, 9); then proves a normal run locks within 5 s (10). Run from the repo root, with
# Docker Desktop running, Windows Sandbox turned on and the PC unlocked:
#   pwsh -File windows\installer\sandbox\Test-Stall.ps1 -Msi <path to ScreenTime.msi>
# This script answers three handshakes the guest writes to the mapped out folder (criterion 7 last_seen_at
# twice 70 s apart, criterion 9 the tamper query after one sync, criterion 10 a cleared usage table and a new
# enrolment code), then prints every line the guest printed and the database evidence.
param([Parameter(Mandatory)][string]$Msi)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path (Split-Path (Split-Path $here))
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-stall-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null
Copy-Item $Msi (Join-Path $in "ScreenTime.msi")
Copy-Item (Join-Path $here "in-sandbox-stall.ps1") $in
$results = Join-Path $out "results.txt"

trap {
    "--- FAILURE: $($_.Exception.Message)"
    if (Test-Path $results) {
        "--- guest results.txt so far:"
        Get-Content $results
    } else {
        "--- guest results.txt: not present"
    }
    exit 1
}

# The guest prints its own PASS/FAIL lines; these two are the host's own checks (last_seen_at and tamper events).
function Answer-C7 {
    Write-Host "--- criterion 7: the PC's last_seen_at, twice 70 s apart"
    $q = "select to_char(last_seen_at at time zone 'Australia/Sydney','HH24:MI:SS') || ' epoch ' || extract(epoch from last_seen_at)::bigint from devices where platform='windows' order by last_seen_at desc limit 1"
    $row1 = (docker exec screentime-db-1 psql -U screentime -d screentime -At -c $q) -join " "
    Write-Host "  $row1"
    Start-Sleep 70
    $row2 = (docker exec screentime-db-1 psql -U screentime -d screentime -At -c $q) -join " "
    Write-Host "  $row2"
    $m1 = [regex]::Match("$row1", "epoch (\d+)")
    $m2 = [regex]::Match("$row2", "epoch (\d+)")
    if (-not $m1.Success -or -not $m2.Success) {
        Set-Content (Join-Path $out "go7.txt") "FAIL: no last_seen_at row ($row1 / $row2)"
        return "criterion 7 (host) last_seen_at twice 70 s apart: FAIL: no last_seen_at row"
    }
    $delta = [long]$m2.Groups[1].Value - [long]$m1.Groups[1].Value
    Write-Host "  seconds between the two epochs: $delta (one sync in the window is 60, two are 120)"
    if ($delta -ge 50 -and $delta -le 130) {
        Set-Content (Join-Path $out "go7.txt") "PASS"
        return "criterion 7 (host) last_seen_at moved $delta s in 70 s (50 to 130 s, one or two 60 s syncs expected): PASS"
    }
    Set-Content (Join-Path $out "go7.txt") "FAIL: $delta s between the two epochs (50 to 130 s expected)"
    return "criterion 7 (host) last_seen_at moved $delta s in 70 s (50 to 130 s, one or two 60 s syncs expected): FAIL"
}

function Answer-C9 {
    Write-Host "--- criterion 9: tamper events for this PC"
    Write-Host "  waiting 65 s so a queued tamper event would have been uploaded by one sync"
    Start-Sleep 65
    $q = "select kind from events where device_id in (select id from devices where platform='windows') and kind like 'tamper.%'"
    Write-Host "  query: $q"
    $rows = @(docker exec screentime-db-1 psql -U screentime -d screentime -At -c $q | Where-Object { "$_" -match "tamper\." })
    if ($rows.Count -eq 0) {
        Write-Host "  none"
        Set-Content (Join-Path $out "go9.txt") "PASS"
        return "criterion 9 (host) no tamper event for this PC: PASS"
    }
    $rows | ForEach-Object { Write-Host "  $_" }
    Set-Content (Join-Path $out "go9.txt") "FAIL: tamper events: $($rows -join ', ')"
    return "criterion 9 (host) no tamper event for this PC: FAIL"
}

function Answer-C10 {
    Write-Host "--- criterion 10: clearing the PC's usage for a normal run"
    $q = "delete from usage_segments where device_id in (select id from devices where platform='windows')"
    Write-Host "  query: $q"
    $del = (docker exec screentime-db-1 psql -U screentime -d screentime -At -c $q) -join " "
    Write-Host "  $del"
    $codeOut = pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc
    $codeOut | ForEach-Object { Write-Host "  $_" }
    $codeLine = ($codeOut | Select-String "\d{6}") | Select-Object -First 1
    if (-not $codeLine) {
        Set-Content (Join-Path $out "go10.txt") "FAIL: no enrolment code"
        return
    }
    $code10 = $codeLine.Matches[0].Value
    Set-Content (Join-Path $out "go10.txt") $code10
    Write-Host "  go10.txt: enrolment code $code10"
}

"--- the dev server"
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v 2>&1 | Out-Null
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait 2>&1 | Select-Object -Last 1
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
pnpm --silent --filter @screentime/server exec tsx scripts/dev-bedtime.ts Sam 120 1 | ForEach-Object { "  $_" }
$codeOut = pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc
$codeOut | ForEach-Object { "  $_" }
$codeLine = ($codeOut | Select-String "\d{6}") | Select-Object -First 1
if (-not $codeLine) { "FAIL: no enrolment code printed by dev-enrol-code.ts"; exit 1 }
$code = $codeLine.Matches[0].Value
Set-Content (Join-Path $in "code.txt") $code

$wsb = Join-Path $work "run.wsb"
Set-Content $wsb @"
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox-stall.ps1</Command></LogonCommand>
</Configuration>
"@
"--- the Sandbox (a window opens and closes by itself; do not use it)"
Start-Process $wsb

$done = $false
$hostVerdicts = @()
$answered7 = $false
$answered9 = $false
$answered10 = $false
$loopStart = Get-Date
while (((Get-Date) - $loopStart).TotalSeconds -lt 1800) {
    if (Test-Path $results) {
        $last = Get-Content $results -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ("$last" -match " done$") { $done = $true; break }
    }
    if (-not $answered7 -and (Test-Path (Join-Path $out "c7.txt"))) {
        $answered7 = $true
        $hostVerdicts += (Answer-C7)
    } elseif (-not $answered9 -and (Test-Path (Join-Path $out "c9.txt"))) {
        $answered9 = $true
        $hostVerdicts += (Answer-C9)
    } elseif (-not $answered10 -and (Test-Path (Join-Path $out "c10.txt"))) {
        $answered10 = $true
        Answer-C10
    }
    Start-Sleep 5
}

if ($done) {
    "--- the Sandbox finished after $([int]((Get-Date) - $loopStart).TotalSeconds) s"
} else {
    "FAIL: the Sandbox did not finish within 1800 s (no done line in results.txt)"
}
"--- what the Sandbox saw (every line the guest printed)"
if (Test-Path $results) { Get-Content $results } else { "NOT RUN: no results.txt" }

"--- the device rows in the dev database (id, kid name, platform, last_seen_at Sydney, app_version)"
docker exec screentime-db-1 psql -U screentime -d screentime -At -c "select d.id, k.name, d.platform, to_char(d.last_seen_at at time zone 'Australia/Sydney','YYYY-MM-DD HH24:MI:SS'), coalesce(d.app_version, '-') from devices d join kids k on k.id = d.kid_id where d.platform = 'windows' order by d.enrolled_at"
"--- today's usage segments for the windows devices (id, device name, started_at, ended_at, Sydney time)"
docker exec screentime-db-1 psql -U screentime -d screentime -At -c "select s.id, d.name, to_char(s.started_at at time zone 'Australia/Sydney','HH24:MI:SS'), coalesce(to_char(s.ended_at at time zone 'Australia/Sydney','HH24:MI:SS'), '-') from usage_segments s join devices d on d.id = s.device_id where d.platform = 'windows' and s.started_at >= date_trunc('day', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney' order by s.started_at"
"--- tamper events for this PC again"
$tamper = @(docker exec screentime-db-1 psql -U screentime -d screentime -At -c "select kind from events where device_id in (select id from devices where platform='windows') and kind like 'tamper.%'" | Where-Object { "$_" -match "tamper\." })
if ($tamper.Count -eq 0) { "  none" } else { $tamper | ForEach-Object { "  $_" } }

"--- summary"
$criteria = @()
if (Test-Path $results) { $criteria = @(Get-Content $results | Where-Object { $_ -match "^\d{2}:\d{2}:\d{2} criterion" }) }
$criteria | ForEach-Object { $_ }
$hostVerdicts | ForEach-Object { $_ }
"--- (full logs in $out)"
"=== done"
$failed = @(($criteria + $hostVerdicts) | Where-Object { $_ -match "FAIL" })
if ($failed.Count -gt 0 -or -not $done) { exit 1 }
exit 0
