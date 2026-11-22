# CARD-073: proves criteria 5 to 10 in Windows Sandbox, in THREE separate boots. The guest
# (in-sandbox-stall.ps1) takes -Stage 1/2/3; the host writes run-<n>.wsb, starts one fresh VM per stage and
# waits for that stage's C:\out\stage<n>.done file, because a real lock or disconnect ends a Sandbox VM's
# usefulness and a reboot from a locked or disconnected session never logs on again:
#   stage 1 (criteria 5, 6, 7): enrol as Sam with 1 minute of Screens time (the allowance is set once, with
#     dev-bedtime.ts Sam 120 1), freeze the tray, prove the lock and disconnect decisions within 15 s, and
#     the syncs continue while the tray is frozen (the host answers the criterion-7 last_seen_at handshake);
#   stage 2 (criteria 8, 9): before it, the host clears the windows devices' usage segments and writes a new
#     enrolment code, then the guest stalls the lock loop with --stall-test-file and proves the watchdog
#     restart and the relock, and exactly one tray after it;
#   stage 3 (criterion 10): the same clearing and a new code, then a normal run, the lock decision within 5 s.
# After stage 3 the host waits 65 s and runs the criterion-9 tamper query. Every ImagePath carries
# --real-lock-test (CARD-073): the Sandbox has no console session (WTSGetActiveConsoleSessionId = 4294967295), so
# --session is unavoidable, and Program.cs refuses --session/--stall-test-file without a guard key -- either
# --dry-lock (which simulates every lock) or --real-lock-test (which changes nothing else, so the tray calls
# LockWorkStation and the service calls WTSDisconnectSession for real). The guest prints the WTS state before and
# after each lock, so the run shows the session really locking (SessionFlags 0) or disconnecting (state 4).
# Run from the repo root, with Docker Desktop running, Windows Sandbox turned on and the PC unlocked:
#   pwsh -File windows\installer\sandbox\Test-Stall.ps1 -Msi <path to ScreenTime.msi>
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
$script:lastWsbId = $null

# wsb list prints one line per running Sandbox, the id first, and nothing when none runs (as Test-Remote.ps1
# uses it). A previous VM must be gone before the next one starts, or the new one is blocked.
function Sandbox-FirstId {
    $first = (wsb list 2>&1 | Select-Object -First 1)
    if ($first -and "$first".Trim()) { return ("$first".Trim() -split "\s+")[0] }
    return $null
}
function Wait-SandboxEmpty([int]$timeoutSec) {
    $waited = 0
    while ($waited -lt $timeoutSec) {
        if (-not (Sandbox-FirstId)) { return $true }
        Start-Sleep 5
        $waited += 5
    }
    return $false
}
function Show-GuestResults {
    if (Test-Path $results) {
        "--- guest results.txt so far:"
        Get-Content $results
    } else {
        "--- guest results.txt: not present"
    }
}
# A stage's own verdict: PASS only when the stage's done file appeared and none of its criterion lines failed.
function Stage-Verdict([int]$n, [bool]$doneSeen, [int]$elapsedSec) {
    if (-not $doneSeen) { return "stage $n verdict: FAIL (no stage$n.done within 900 s)" }
    $block = @()
    $inBlock = $false
    foreach ($line in @(Get-Content $results -ErrorAction SilentlyContinue)) {
        if ($line -match "=== stage $n") { $inBlock = $true; continue }
        if ($inBlock -and $line -match "=== stage \d") { $inBlock = $false }
        if ($inBlock) { $block += $line }
    }
    $crit = @($block | Where-Object { $_ -match "^\d{2}:\d{2}:\d{2} criterion" })
    $bad = @($crit | Where-Object { $_ -cmatch "FAIL|NOT RUN" })   # case-sensitive: "none failed" is not a FAIL
    if ($crit.Count -eq 0) { return "stage $n verdict: FAIL (stage$n.done after $elapsedSec s but no criterion line was printed)" }
    if ($bad.Count -eq 0) { return "stage $n verdict: PASS (stage$n.done after $elapsedSec s, $($crit.Count) criterion lines, none failed)" }
    return "stage $n verdict: FAIL (stage$n.done after $elapsedSec s, $($bad.Count) of $($crit.Count) criterion lines failed)"
}
trap {
    "--- FAILURE: $($_.Exception.Message)"
    Show-GuestResults
    if ($script:lastWsbId) {
        "--- cleanup: stopping Sandbox $script:lastWsbId"
        try { wsb stop --id $script:lastWsbId 2>&1 | Out-Null } catch { }
    }
    exit 1
}

# The guest prints its own PASS/FAIL lines; this one is the host's own check (criterion 7, last_seen_at).
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
    Write-Host "  seconds between the two epochs: $delta (the window is 50 to 130 s because one 60 s sync in the 70 s gap moves last_seen_at about 60 s and two syncs move it about 120 s)"
    if ($delta -ge 50 -and $delta -le 130) {
        Set-Content (Join-Path $out "go7.txt") "PASS"
        return "criterion 7 (host) last_seen_at moved $delta s in 70 s (50 to 130 s, one or two 60 s syncs expected): PASS"
    }
    Set-Content (Join-Path $out "go7.txt") "FAIL: $delta s between the two epochs (50 to 130 s expected)"
    return "criterion 7 (host) last_seen_at moved $delta s in 70 s (50 to 130 s, one or two 60 s syncs expected): FAIL"
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

$stageVerdicts = @()
$hostVerdicts = @()
$answered7 = $false
$missingDone = @()

foreach ($n in 1..3) {
    "--- stage $n of 3 (a fresh Sandbox VM; the guest runs in-sandbox-stall.ps1 -Stage $n)"
    if ($n -gt 1) {
        # Criterion 8's own setup: the session must be unlocked and ALREADY out of time when the stall flag goes on, so
        # today's allowance is 0 minutes for stage 2 and back to 1 minute for stage 3 (the guest creates the flag before
        # the service is started in stage 2).
        $allowance = 0
        if ($n -eq 3) { $allowance = 1 }
        $bed = pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-bedtime.ts Sam 120 $allowance 2>&1
        $bed | ForEach-Object { "  $_" }
        # The stage's device enrols fresh under the same kid Sam: without this delete it would inherit the
        # earlier devices' minutes and start already out of time.
        $q = "delete from usage_segments where device_id in (select id from devices where platform='windows')"
        "  query: $q"
        $del = (docker exec screentime-db-1 psql -U screentime -d screentime -At -c $q) -join " "
        "  $del"
        $codeOut = pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc
        $codeOut | ForEach-Object { "  $_" }
        $codeLine = ($codeOut | Select-String "\d{6}") | Select-Object -First 1
        if (-not $codeLine) {
            "FAIL: no enrolment code printed by dev-enrol-code.ts for stage $n"
            $stageVerdicts += "stage $n verdict: FAIL (no enrolment code)"
            $missingDone += $n
            break
        }
        Set-Content (Join-Path $in "code.txt") $codeLine.Matches[0].Value
        "  code.txt: enrolment code $($codeLine.Matches[0].Value)"
    }
    Set-Content (Join-Path $in "stage.txt") "$n"
    $wsb = Join-Path $work "run-$n.wsb"
    Set-Content $wsb @"
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox-stall.ps1 -Stage $n</Command></LogonCommand>
</Configuration>
"@
    if (-not (Wait-SandboxEmpty 300)) {
        "  a Sandbox is still running after 300 s; wsb list:"
        wsb list 2>&1 | ForEach-Object { "    $_" }
        $id = Sandbox-FirstId
        if ($id) {
            "  stopping it: wsb stop --id $id"
            try { wsb stop --id $id 2>&1 | ForEach-Object { "    $_" } } catch { "  wsb stop failed: $($_.Exception.Message)" }
        }
        if (-not (Wait-SandboxEmpty 120)) {
            "stage $n verdict: FAIL (the previous Sandbox never stopped, so stage $n was not started)"
            $stageVerdicts += "stage $n verdict: FAIL (the previous Sandbox never stopped)"
            $missingDone += $n
            break
        }
        "  the Sandbox stopped; continuing"
    }
    "  no Sandbox running; starting run-$n.wsb (a window opens and closes by itself; do not use it)"
    Start-Process $wsb
    $waited = 0
    while ($waited -lt 120) {
        $id = Sandbox-FirstId
        if ($id) { $script:lastWsbId = $id; break }
        Start-Sleep 5
        $waited += 5
    }
    if ($script:lastWsbId) { "  Sandbox id: $script:lastWsbId" } else { "  could not get the Sandbox id (cleanup on failure may not work)" }
    $done = Join-Path $out "stage$n.done"
    $tStage = Get-Date
    $seen = $false
    $booted = $false
    while (((Get-Date) - $tStage).TotalSeconds -lt 900) {
        if (Test-Path $done) { $seen = $true; break }
        if ($n -eq 1 -and -not $answered7 -and (Test-Path (Join-Path $out "c7.txt"))) {
            $answered7 = $true
            $hostVerdicts += (Answer-C7)
        }
        if (-not $booted) {
            $head = @(Get-Content $results -ErrorAction SilentlyContinue)
            if (@($head -match "=== stage $n").Count -gt 0) {
                $booted = $true
            } elseif (((Get-Date) - $tStage).TotalSeconds -ge 300) {
                break
            }
        }
        Start-Sleep 5
    }
    $elapsed = [int]((Get-Date) - $tStage).TotalSeconds
    if (-not $booted -and -not $seen) {
        "  FAIL: no '=== stage $n' line in results.txt within 300 s: the Sandbox never booted or the LogonCommand never ran; not starting the next stage either"
        Show-GuestResults
        $stageVerdicts += "stage $n verdict: FAIL (the Sandbox never booted: no '=== stage $n' line within 300 s)"
        $missingDone += $n
        break
    }
    if ($seen) {
        "  stage $n done file after $elapsed s"
    } else {
        "  FAIL: no stage$n.done within 900 s"
        Show-GuestResults
        $missingDone += $n
        # The next stage is a fresh VM: carry on (Wait-SandboxEmpty stops this one first if it lingers).
    }
    $stageVerdicts += (Stage-Verdict $n $seen $elapsed)
}

foreach ($n in 1..3) {
    $have = @($stageVerdicts | Where-Object { $_ -like "stage $n verdict:*" })
    if ($have.Count -eq 0) { $stageVerdicts += "stage $n verdict: NOT RUN (the run stopped at an earlier stage)" }
}

"--- criterion 9 (host): tamper events for the sandbox PCs"
"  waiting 65 s so a queued tamper event would have been uploaded by one sync"
Start-Sleep 65
$q = "select kind from events where device_id in (select id from devices where platform='windows') and kind like 'tamper.%'"
"  query: $q"
$rows = @(docker exec screentime-db-1 psql -U screentime -d screentime -At -c $q | Where-Object { "$_" -match "tamper\." })
if ($rows.Count -eq 0) {
    "  none"
    $hostVerdicts += "criterion 9 (host) no tamper event for the sandbox PCs: PASS"
} else {
    $rows | ForEach-Object { "  $_" }
    $hostVerdicts += "criterion 9 (host) no tamper event for the sandbox PCs: FAIL: tamper events: $($rows -join ', ')"
}

"--- what the Sandbox saw (every line the guest printed, all stages)"
if (Test-Path $results) { Get-Content $results } else { "NOT RUN: no results.txt" }
"--- the device rows in the dev database (id, kid name, platform, last_seen_at Sydney, app_version)"
docker exec screentime-db-1 psql -U screentime -d screentime -At -c "select d.id, k.name, d.platform, to_char(d.last_seen_at at time zone 'Australia/Sydney','YYYY-MM-DD HH24:MI:SS'), coalesce(d.app_version, '-') from devices d join kids k on k.id = d.kid_id where d.platform = 'windows' order by d.enrolled_at"
"--- today's usage segments for the windows devices (id, device name, started_at, ended_at, Sydney time)"
docker exec screentime-db-1 psql -U screentime -d screentime -At -c "select s.id, d.name, to_char(s.started_at at time zone 'Australia/Sydney','HH24:MI:SS'), coalesce(to_char(s.ended_at at time zone 'Australia/Sydney','HH24:MI:SS'), '-') from usage_segments s join devices d on d.id = s.device_id where d.platform = 'windows' and s.started_at >= date_trunc('day', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney' order by s.started_at"

"--- summary"
$summaryPattern = '^\d{2}:\d{2}:\d{2} criterion|stage [123] .*PASS|stage [123] .*FAIL'
$criteria = @()
if (Test-Path $results) { $criteria = @(Get-Content $results | Where-Object { $_ -match $summaryPattern }) }
$criteria | ForEach-Object { $_ }
$hostVerdicts | ForEach-Object { $_ }
$stageVerdicts | ForEach-Object { $_ }
"--- (full logs in $out)"
"=== done"
$failed = @(($criteria + $hostVerdicts + $stageVerdicts) | Where-Object { $_ -cmatch "FAIL|NOT RUN" })   # case-sensitive: the verdict wording "none failed" must not count
if ($failed.Count -gt 0 -or $missingDone.Count -gt 0) { exit 1 }
exit 0