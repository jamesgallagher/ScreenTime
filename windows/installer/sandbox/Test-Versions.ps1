# CARD-071: proves criteria 19-22 in Windows Sandbox. Two CI builds A and B of this branch;
# A is installed first, B is published for the Sandbox PC only after parent mode is on.
# Run from the repo root, with Docker Desktop running and Windows Sandbox turned on:
#   pwsh -File windows\installer\sandbox\Test-Versions.ps1
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path (Split-Path (Split-Path $here))
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-versions-$(Get-Date -Format yyyyMMdd-HHmmss)"
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
  git push -u origin bob/card-071-version-updates 2>&1 | Out-Null
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
  gh workflow run windows.yml --repo jamesgallagher/ScreenTime --ref bob/card-071-version-updates 2>&1 | Out-Null
  $aId = $null
  $waited = 0
  while ($waited -lt 180) {
    Start-Sleep 5
    $waited += 5
    $listed = gh run list --repo jamesgallagher/ScreenTime --branch bob/card-071-version-updates --workflow windows.yml --limit 1 --json databaseId,number 2>$null
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
  gh workflow run windows.yml --repo jamesgallagher/ScreenTime --ref bob/card-071-version-updates 2>&1 | Out-Null
  $bId = $null
  $waited = 0
  while ($waited -lt 180) {
    Start-Sleep 5
    $waited += 5
    $listed = gh run list --repo jamesgallagher/ScreenTime --branch bob/card-071-version-updates --workflow windows.yml --limit 5 --json databaseId,number 2>$null
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
Copy-Item (Join-Path $here "in-sandbox-versions.ps1") $in
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
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox-versions.ps1</Command>
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

"--- 4. wait for the guest to ask for parent mode, then approve it"
$waited = 0
while (-not (Test-Path (Join-Path $out "parent-mode-asked.txt")) -and $waited -lt 600) { Start-Sleep 5; $waited += 5 }
if (-not (Test-Path (Join-Path $out "parent-mode-asked.txt"))) { "NOT RUN: the guest never asked for parent mode"; exit 1 }
"--- guest asked for parent mode; approving"
Push-Location $root
try {
  $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
  $env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
  $approve = pnpm --silent --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Sam yes 15 2>&1
  $approve | ForEach-Object { "  $_" }
  Set-Content (Join-Path $in "parent-mode-approved.txt") "ok"
} finally {
  Pop-Location
}
"--- checkpoint: guest results so far (after parent-mode approved)"
if (Test-Path (Join-Path $out "results.txt")) {
  Get-Content (Join-Path $out "results.txt")
} else {
  "  (no results.txt yet)"
}

"--- 5. wait for step 20 done or failed, then publish B for the Sandbox PC only"
$waited = 0
$step20Failed = $false
while ($waited -lt 600) {
  if (Test-Path (Join-Path $out "step20-done.txt")) { break }
  if (Test-Path (Join-Path $out "step20-failed.txt")) { $step20Failed = $true; break }
  Start-Sleep 5; $waited += 5
}
if ($step20Failed) {
  "--- step 20 failed in the guest (criterion 20 did not pass); stopping"
  Show-SandboxDiagnostics
  Stop-SandboxIfRunning
  exit 1
}
if (-not (Test-Path (Join-Path $out "step20-done.txt"))) { "NOT RUN: the guest never finished step 20"; Show-SandboxDiagnostics; Stop-SandboxIfRunning; exit 1 }
Push-Location $root
try {
  $deviceId = (docker exec screentime-db-1 psql -U screentime -d screentime -t -c "select id from devices where platform = 'windows' limit 1" | Select-String '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | ForEach-Object { $_.Matches[0].Value })
  "Sandbox PC device id: $deviceId"
  pwsh -File deploy\publish-downloads.ps1 -Windows -RunId $bId -DeviceId $deviceId -To deploy\releases
  Get-Content deploy\releases\windows.json
  Set-Content (Join-Path $in "b.txt") $bId
} finally {
  Pop-Location
}

"--- 6. wait for the guest to finish (up to 5 minutes)"
$waited = 0
$guestFailed = $false
while ($waited -lt 300) {
  if (Test-Path (Join-Path $out "done.txt")) {
    $doneContent = (Get-Content (Join-Path $out "done.txt") -Raw).Trim()
    if ($doneContent -eq "failed") { $guestFailed = $true }
    break
  }
  Start-Sleep 5; $waited += 5
}
if (-not (Test-Path (Join-Path $out "done.txt"))) { "NOT RUN: the guest never wrote done.txt" }
if ($guestFailed) { "--- guest reported failure (step20-failed or tray did not settle)" }

"--- 7. what the Sandbox saw (every line the guest printed)"
if (Test-Path (Join-Path $out "results.txt")) {
  Get-Content (Join-Path $out "results.txt")
} else {
  "NOT RUN: no results.txt"
}

"--- 8. tamper events for this PC (criterion 22)"
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
} finally {
  Pop-Location
}

"--- 9. stop the Sandbox"
} finally {
  Stop-SandboxIfRunning
}
"=== done"
