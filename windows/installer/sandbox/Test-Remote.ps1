# CARD-072: proves criteria 18-19 in Windows Sandbox. Two CI builds A and B of this branch;
# A is installed first, B is published for the Sandbox PC only after the guest is ready.
# Run from the repo root, with Docker Desktop running and Windows Sandbox turned on:
#   pwsh -File windows\installer\sandbox\Test-Remote.ps1
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path (Split-Path (Split-Path $here))
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-remote-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null
$wsbId = $null

function Stop-SandboxIfRunning {
  if ($wsbId) {
    "--- cleanup: stopping Sandbox $wsbId"
    try { wsb stop --id $wsbId 2>&1 | Out-Null } catch { }
  }
}
function Show-SandboxDiagnostics {
  $resultsFile = Join-Path $out "results.txt"
  if (Test-Path $resultsFile) {
    "--- guest results.txt at failure:"
    Get-Content $resultsFile
  } else {
    "--- guest results.txt: not present"
  }
  $installLog = Join-Path $out "install.log"
  if (Test-Path $installLog) {
    "--- last 40 lines of install.log:"
    Get-Content $installLog | Select-Object -Last 40
  }
}
trap {
  "--- FAILURE: $($_.Exception.Message)"
  Show-SandboxDiagnostics
  Stop-SandboxIfRunning
  exit 1
}

"--- 1. two CI builds of this branch (sequential; concurrency group cancels parallel dispatches)"
Push-Location $root
try {
  git push -u origin bob/card-072-remote-update 2>&1 | Out-Null
  # push triggers nothing on windows.yml (it runs on pull_request and workflow_dispatch only for non-main).

  function Wait-RunSuccessful([string]$label, [string]$expectedId, [int]$timeoutSec) {
    $waited = 0
    while ($waited -lt $timeoutSec) {
      $view = gh run view $expectedId --repo jamesgallagher/ScreenTime --json status,conclusion 2>$null
      if ($view) {
        $parsed = $view | ConvertFrom-Json
        $status = $parsed.status
        $conclusion = $parsed.conclusion
        if ($status -eq "completed" -and $conclusion -eq "success") { return $true }
        if ($status -eq "completed") { Write-Host "NOT RUN: run $expectedId ($label) completed with conclusion=$conclusion"; return $false }
      }
      Start-Sleep 30
      $waited += 30
    }
    Write-Host "NOT RUN: run $expectedId ($label) did not succeed within $($timeoutSec/60) minutes"
    return $false
  }

  # Build A
  gh workflow run windows.yml --repo jamesgallagher/ScreenTime --ref bob/card-072-remote-update 2>&1 | Out-Null
  $aId = $null
  $waited = 0
  while ($waited -lt 180) {
    Start-Sleep 5
    $waited += 5
    $listed = gh run list --repo jamesgallagher/ScreenTime --branch bob/card-072-remote-update --workflow windows.yml --limit 1 --json databaseId,number 2>$null
    if ($listed) {
      $rows = $listed | ConvertFrom-Json
      if ($rows -and $rows.Count -gt 0) { $aId = [string]$rows[0].databaseId; $aNum = [string]$rows[0].number; break }
    }
  }
  if (-not $aId) { "NOT RUN: could not find the A run in 3 minutes"; exit 1 }
  "A dispatched: id=$aId number=$aNum"
  if (-not (Wait-RunSuccessful "A" $aId 900)) { exit 1 }
  "A succeeded: run $aId (#$aNum, version 0.1.$aNum)"

  # Build B (after A is complete)
  gh workflow run windows.yml --repo jamesgallagher/ScreenTime --ref bob/card-072-remote-update 2>&1 | Out-Null
  $bId = $null
  $waited = 0
  while ($waited -lt 180) {
    Start-Sleep 5
    $waited += 5
    $listed = gh run list --repo jamesgallagher/ScreenTime --branch bob/card-072-remote-update --workflow windows.yml --limit 5 --json databaseId,number 2>$null
    if ($listed) {
      $rows = $listed | ConvertFrom-Json
      foreach ($r in $rows) {
        $rid = [string]$r.databaseId
        if ($rid -ne $aId) { $bId = $rid; $bNum = [string]$r.number; break }
      }
      if ($bId) { break }
    }
  }
  if (-not $bId) { "NOT RUN: could not find the B run in 3 minutes"; exit 1 }
  "B dispatched: id=$bId number=$bNum"
  if (-not (Wait-RunSuccessful "B" $bId 900)) { exit 1 }
  "B succeeded: run $bId (#$bNum, version 0.1.$bNum)"

  "A = run $aId (#$aNum, version 0.1.$aNum), B = run $bId (#$bNum, version 0.1.$bNum)"
} finally {
  Pop-Location
}

"--- 2. reset and seed the dev stack"
Push-Location $root
try {
  Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v 2>&1 | Out-Null
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait 2>&1 | Select-Object -Last 1
  $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
  $env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
  pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
  $code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
  Set-Content (Join-Path $in "code.txt") $code
  if (Test-Path (Join-Path $root "deploy\releases\windows.json")) { Remove-Item (Join-Path $root "deploy\releases\windows.json") -Force }
  $existing = Get-ChildItem (Join-Path $root "deploy\releases") -Filter "ScreenTime-*.msi" -ErrorAction SilentlyContinue
  if ($existing) { Remove-Item $existing.FullName -Force }
} finally {
  Pop-Location
}

"--- 3. download A's MSI and prepare the Sandbox input folder"
$dirA = Join-Path $work "msi-$aNum"
New-Item -ItemType Directory -Force $dirA | Out-Null
gh run download $aId --repo jamesgallagher/ScreenTime --name ScreenTime-msi --dir $dirA
Copy-Item (Join-Path $dirA "ScreenTime.msi") (Join-Path $in "ScreenTime.msi")
Copy-Item (Join-Path $here "in-sandbox-remote.ps1") $in
Set-Content (Join-Path $in "a-version.txt") "0.1.$aNum"
Set-Content (Join-Path $in "b-version.txt") "0.1.$bNum"

$wsb = Join-Path $work "run.wsb"
Set-Content $wsb @"
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox-remote.ps1</Command>
  </LogonCommand>
</Configuration>
"@
"--- starting the Sandbox (a window opens and runs the guest script; do not use it)"
try {
Start-Process $wsb
$waited = 0
while ($waited -lt 180) {
  Start-Sleep 5
  $waited += 5
  $wsbId = (wsb list 2>&1 | Select-Object -First 1)
  if ($wsbId) { $wsbId = $wsbId.Trim() }
  if ($wsbId) { break }
}
if (-not $wsbId) { "NOT RUN: could not get the Sandbox id"; exit 1 }
"Sandbox id: $wsbId"

"--- 4. wait for guest ready, then wait for device to appear in dev database"
$waited = 0
$earlyExit = $false
while ($waited -lt 900) {
  if (Test-Path (Join-Path $out "ready.txt")) { break }
  if (Test-Path (Join-Path $out "done.txt")) { $earlyExit = $true; break }
  if (Test-Path (Join-Path $out "failed.txt")) { $earlyExit = $true; break }
  Start-Sleep 5; $waited += 5
}
if ($earlyExit) {
  "--- guest exited early before ready (done.txt or failed.txt found)"
  Show-SandboxDiagnostics
  Stop-SandboxIfRunning
  exit 1
}
if (-not (Test-Path (Join-Path $out "ready.txt"))) {
  "NOT RUN: the guest never wrote ready.txt within 900 s"
  Show-SandboxDiagnostics
  Stop-SandboxIfRunning
  exit 1
}
"--- guest is ready (ready.txt seen)"
if (Test-Path (Join-Path $out "results.txt")) {
  "--- checkpoint: guest results so far"
  Get-Content (Join-Path $out "results.txt")
}

"--- waiting for device to appear in dev database with app_version_code = $aNum (up to 180 s)"
$deviceId = $null
$waited = 0
while ($waited -lt 180) {
  $raw = docker exec screentime-db-1 psql -U screentime -d screentime -t -c "select app_version_code from devices where platform='windows'" 2>&1
  "  poll: raw psql app_version_code: $raw"
  $candidateId = (docker exec screentime-db-1 psql -U screentime -d screentime -t -c "select id from devices where platform='windows' limit 1" | Select-String '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | ForEach-Object { $_.Matches[0].Value })
  if ($candidateId -and $raw -match $aNum) {
    $deviceId = $candidateId
    break
  }
  Start-Sleep 5; $waited += 5
}
if (-not $deviceId) {
  "NOT RUN: device with app_version_code=$aNum never appeared within 180 s"
  Show-SandboxDiagnostics
  Stop-SandboxIfRunning
  exit 1
}
"Sandbox PC device id: $deviceId"

"--- 5. publish B for this PC only, then call dev-remote-update.ts"
Push-Location $root
try {
  pwsh -File deploy\publish-downloads.ps1 -Windows -RunId $bId -DeviceId $deviceId -To deploy\releases
  "deploy\releases\windows.json:"
  Get-Content deploy\releases\windows.json
  $updateOutput = pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-remote-update.ts $deviceId 2>&1
  $updateOutput | ForEach-Object { "  $_" }
  if (-not ($updateOutput -match ' 202 ')) {
    "NOT RUN: dev-remote-update.ts did not return 202"
    Show-SandboxDiagnostics
    Stop-SandboxIfRunning
    exit 1
  }
  Set-Content (Join-Path $in "go.txt") "b"
} finally {
  Pop-Location
}
"--- checkpoint: guest results so far (after dev-remote-update.ts)"
if (Test-Path (Join-Path $out "results.txt")) {
  Get-Content (Join-Path $out "results.txt")
}

"--- 6. wait for the guest to finish (up to 420 s)"
$waited = 0
$guestFailed = $false
while ($waited -lt 420) {
  if (Test-Path (Join-Path $out "done.txt")) {
    $doneContent = (Get-Content (Join-Path $out "done.txt") -Raw).Trim()
    if ($doneContent -eq "failed") { $guestFailed = $true }
    break
  }
  Start-Sleep 5; $waited += 5
}
if (-not (Test-Path (Join-Path $out "done.txt"))) { "NOT RUN: the guest never wrote done.txt" }
if ($guestFailed) { "--- guest reported failure" }

"--- 7. what the Sandbox saw (every line the guest printed)"
if (Test-Path (Join-Path $out "results.txt")) {
  Get-Content (Join-Path $out "results.txt")
} else {
  "NOT RUN: no results.txt"
}

"--- 8. wait for app_version to become B in dev database (up to 120 s)"
$waited = 0
$versionMatched = $false
while ($waited -lt 120) {
  $raw = docker exec screentime-db-1 psql -U screentime -d screentime -t -c "select app_version from devices where id = '$deviceId'" 2>&1
  "  poll: raw app_version: $raw"
  if ($raw -match "0\.1\.$bNum") {
    $versionMatched = $true
    break
  }
  Start-Sleep 5; $waited += 5
}
if ($versionMatched) { "app_version matched B (0.1.$bNum)" } else { "NOT RUN: app_version never became 0.1.$bNum within 120 s" }

"--- 9. criterion 19: the device row from GET /v1/devices"
Push-Location $root
try {
  # The dev script POSTs first; after B is installed there is nothing newer to offer, so that POST
  # returns 409 -- expected, printed, not a failure. Its GET /v1/devices line is the device row
  # criterion 19 asks for and alone decides the two PASS/FAIL lines below.
  $rowOutput = pnpm --silent --filter '@screentime/server' exec tsx scripts/dev-remote-update.ts $deviceId 2>&1
  $rowOutput | ForEach-Object { "  $_" }
  $rowLine = (($rowOutput | Select-String 'GET /v1/devices') | Select-Object -Last 1).Line
  if (-not $rowLine) { $rowLine = "" }
  $appVersionB = $rowLine -match ('"appVersion":"0\.1\.' + $bNum + '"')
  $appUpdateNull = $rowLine -match '"appUpdate":null'

  # Supporting output only (must not decide the two PASS/FAILs above): the same row from the database.
  $rowQuery = "select app_version, app_version_code, update_requested_code, update_requested_at from devices where id = '$deviceId'"
  "query: $rowQuery"
  $rowResult = docker exec screentime-db-1 psql -U screentime -d screentime -t -c $rowQuery
  $rowResult
  $appUpdateQuery = "select case when update_requested_code is not null and (app_version_code is null or app_version_code < update_requested_code) then 'appUpdate NOT null' else 'appUpdate null' end from devices where id = '$deviceId'"
  "query: $appUpdateQuery"
  $appUpdateResult = (docker exec screentime-db-1 psql -U screentime -d screentime -t -c $appUpdateQuery).Trim()
  "appUpdate decision: $appUpdateResult"

  $installedB = $versionMatched
  if ($installedB) { "installed version B: PASS" } else { "installed version B: FAIL" }
  if ($appVersionB) { "appVersion B in row: PASS" } else { "appVersion B in row: FAIL" }
  if ($appUpdateNull) { "appUpdate null: PASS" } else { "appUpdate null: FAIL" }
} finally {
  Pop-Location
}

"--- 10. tamper events for this PC (criterion 19)"
Push-Location $root
try {
  $tamperQuery = "select kind from events where device_id = '$deviceId' and kind like 'tamper.%'"
  "query: $tamperQuery"
  $tamperEvents = (docker exec screentime-db-1 psql -U screentime -d screentime -t -c $tamperQuery | Select-String 'tamper\.\w+')
  if ($tamperEvents) {
    "tamper events:"
    $tamperEvents | ForEach-Object { "  $($_.Matches[0].Value)" }
  } else {
    "none"
  }
  if (-not $tamperEvents) { "no tamper events: PASS" } else { "tamper events found: FAIL" }
} finally {
  Pop-Location
}

"--- 11. stop the Sandbox"
} finally {
  Stop-SandboxIfRunning
}
"=== done"
if ($guestFailed -or -not $installedB -or -not $appVersionB -or -not $appUpdateNull -or $tamperEvents) { exit 1 }
