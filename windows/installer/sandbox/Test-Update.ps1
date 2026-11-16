# CARD-061: tries the Windows self-update in Windows Sandbox (docs/BUILD-PLAN.md: admin-level runs never happen on James's PC).
# Run from the repo root, with Docker Desktop running and Windows Sandbox turned on:
#   windows\installer\sandbox\Test-Update.ps1
# It pushes the branch, gets two CI builds (A and B), resets the dev stack, starts the Sandbox,
# publishes B for the Sandbox PC only, waits for the update, and checks the result.
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path (Split-Path (Split-Path $here))
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-update-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null

"--- 1. two CI builds of this branch"
Push-Location $root
try {
  git push -u origin bob/card-061-windows-updates 2>&1 | Out-Null
  gh workflow run windows.yml --repo jamesgallagher/ScreenTime --ref bob/card-061-windows-updates 2>&1 | Out-Null
  $waited = 0
  while ($waited -lt 900) {
    Start-Sleep 30
    $waited += 30
    $runs = gh run list --repo jamesgallagher/ScreenTime --branch bob/card-061-windows-updates --workflow windows.yml --status success --json databaseId,number --limit 2 --jq '[.[] | "\(.databaseId) \(.number)"] | join(" ")'
    if ($runs -match '\d+ \d+ \d+ \d+') { break }
  }
  if (-not ($runs -match '\d+ \d+ \d+ \d+')) { "NOT RUN: CI did not produce two successful runs in 15 minutes"; exit 1 }
  $aId, $aNum, $bId, $bNum = $runs -split ' '
  "A = run $aId (#$aNum), B = run $bId (#$bNum)"
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
  pnpm --silent --filter @screentime/server exec tsx scripts/dev-bedtime.ts Sam 120 25
  $code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
  Set-Content (Join-Path $in "code.txt") $code
  if (Test-Path (Join-Path $root "deploy\releases\windows.json")) { Remove-Item (Join-Path $root "deploy\releases\windows.json") -Force }
  if (Test-Path (Join-Path $root "deploy\releases\ScreenTime-*.msi")) { Remove-Item (Join-Path $root "deploy\releases\ScreenTime-*.msi") -Force }
} finally {
  Pop-Location
}

"--- 3. download A's MSI and start the Sandbox"
$dirA = Join-Path $work "msi-$aNum"
New-Item -ItemType Directory -Force $dirA | Out-Null
gh run download $aId --repo jamesgallagher/ScreenTime --name ScreenTime-msi --dir $dirA
Copy-Item (Join-Path $dirA "ScreenTime.msi") (Join-Path $in "ScreenTime.msi")
Copy-Item (Join-Path $here "in-sandbox-update.ps1") $in
Copy-Item (Join-Path $here "check-update.ps1") $in
Set-Content (Join-Path $in "old-version.txt") $aNum

$wsb = Join-Path $work "run.wsb"
Set-Content $wsb @"
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
</Configuration>
"@
"--- starting the Sandbox (a window opens and closes by itself; do not use it)"
Start-Process $wsb
$waited = 0
while ($waited -lt 180) {
  Start-Sleep 5
  $waited += 5
  $wsbId = (wsb list 2>&1 | Select-Object -First 1).Trim()
  if ($wsbId) { break }
}
if (-not $wsbId) { "NOT RUN: could not get the Sandbox id"; exit 1 }
"Sandbox id: $wsbId"

"--- 4. install A, enrol, and set the service flags"
$installCmd = "cmd.exe /c powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox-update.ps1"
wsb exec --id $wsbId -c $installCmd -r ExistingLogin 2>&1 | Out-Null
$waited = 0
while (-not (Test-Path (Join-Path $out "results.txt")) -and $waited -lt 600) { Start-Sleep 5; $waited += 5 }
if (-not (Test-Path (Join-Path $out "results.txt"))) { "NOT RUN: the Sandbox never wrote results.txt"; exit 1 }
"--- what the Sandbox saw (step 1-11)"
Get-Content (Join-Path $out "results.txt")

"--- 5. find the Sandbox PC's device id and publish B for it"
Push-Location $root
try {
  $deviceId = (docker exec screentime-db-1 psql -U screentime -d screentime -t -c "select id from devices where platform = 'windows' limit 1" | Select-String '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | ForEach-Object { $_.Matches[0].Value })
  "Sandbox PC device id: $deviceId"
  pwsh -File deploy\publish-downloads.ps1 -Windows -RunId $bId -DeviceId $deviceId -To deploy\releases
  Get-Content deploy\releases\windows.json
} finally {
  Pop-Location
}

"--- 6. wait for the update (up to 10 minutes), then check the result in the Sandbox"
$waited = 0
while ($waited -lt 600) {
  Start-Sleep 10
  $waited += 10
  $appVersion = (docker exec screentime-db-1 psql -U screentime -d screentime -t -c "select app_version from devices where platform = 'windows' limit 1" | Select-String '0\.1\.\d+' | ForEach-Object { $_.Matches[0].Value })
  if ($appVersion -eq "0.1.$bNum") { break }
}
"--- what the Sandbox saw (steps 1-4)"
Get-Content (Join-Path $out "results.txt")
# Run a second check inside the Sandbox for the update result.
$checkCmd = "cmd.exe /c powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\check-update.ps1"
wsb exec --id $wsbId -c $checkCmd -r ExistingLogin 2>&1 | Out-Null
Start-Sleep 10
"--- what the Sandbox saw (steps 5-11)"
Get-Content (Join-Path $out "results.txt")

"--- 7. check the dev database"
Push-Location $root
try {
  $appVersion = (docker exec screentime-db-1 psql -U screentime -d screentime -t -c "select app_version from devices where platform = 'windows' limit 1" | Select-String '0\.1\.\d+' | ForEach-Object { $_.Matches[0].Value })
  "device app_version: $appVersion"
  $tamperEvents = (docker exec screentime-db-1 psql -U screentime -d screentime -t -c "select kind from events where device_id = '$deviceId' and kind like 'tamper.%'" | Select-String 'tamper\.\w+')
  if ($tamperEvents) {
    "tamper events:"
    $tamperEvents | ForEach-Object { "  $($_.Matches[0].Value)" }
  } else {
    "no tamper events"
  }
} finally {
  Pop-Location
}

"--- 8. publish a fake newer version with a wrong sha256 (criterion 19)"
Push-Location $root
try {
  # Write a windows.json with a versionCode above B's, pointing at A's file with a wrong sha256.
  $fakeVersionCode = [int]$bNum + 1
  $fakeVersionName = "0.1.$fakeVersionCode"
  $msiFile = "ScreenTime-$fakeVersionName.msi"
  # Copy A's MSI as the fake file.
  Copy-Item (Join-Path $dirA "ScreenTime.msi") (Join-Path $root "deploy\releases\$msiFile") -Force
  $sizeBytes = (Get-Item (Join-Path $root "deploy\releases\$msiFile")).Length
  $wrongSha = "0000000000000000000000000000000000000000000000000000000000000000"
  $windowsJson = @"
{"versionName":"$fakeVersionName","versionCode":$fakeVersionCode,"sha256":"$wrongSha","sizeBytes":$sizeBytes,"file":"$msiFile","deviceIds":["$deviceId"]}
"@
  Set-Content (Join-Path $root "deploy\releases\windows.json") $windowsJson
  "fake windows.json:"
  Get-Content (Join-Path $root "deploy\releases\windows.json")
  # Restart the service in the Sandbox to make it check now.
  $restartCmd = "cmd.exe /c powershell.exe -NoProfile -ExecutionPolicy Bypass -Command Restart-Service ScreenTime"
  wsb exec --id $wsbId -c $restartCmd -r ExistingLogin 2>&1 | Out-Null
  # Wait for the mismatch log line.
  $waited = 0
  while ($waited -lt 120) {
    Start-Sleep 10
    $waited += 10
    if (Test-Path (Join-Path $out "results.txt")) {
      $content = Get-Content (Join-Path $out "results.txt") -Raw
      if ($content -match 'does not match|mismatch') { break }
    }
  }
  "--- what the Sandbox saw (step 11: mismatch)"
  Get-Content (Join-Path $out "results.txt")
} finally {
  Pop-Location
}

"--- 9. stop the Sandbox"
wsb stop --id $wsbId 2>&1
"=== done"
