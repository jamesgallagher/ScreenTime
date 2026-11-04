# CARD-052: tries the MSI in Windows Sandbox (docs/BUILD-PLAN.md: admin-level runs never happen on James's PC).
# Run from the repo root, with Docker Desktop running and Windows Sandbox turned on:
#   windows\installer\sandbox\Test-Installer.ps1 -Msi <path to ScreenTime.msi>
# It resets the local dev server, makes Sam's enrolment code, starts the Sandbox (which runs in-sandbox.ps1 at
# logon), runs Sam out of time when the Sandbox says it is ready, and prints what the Sandbox saw.
param([Parameter(Mandatory)][string]$Msi)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null
Copy-Item $Msi (Join-Path $in "ScreenTime.msi")
Copy-Item (Join-Path $here "in-sandbox.ps1") $in

"--- the dev server"
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v 2>&1 | Out-Null
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait 2>&1 | Select-Object -Last 1
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
# Bedtime 2 hours from now with 25 minutes to use, so the PC starts unlocked whatever the time of day.
pnpm --silent --filter @screentime/server exec tsx scripts/dev-bedtime.ts Sam 120 25
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
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox.ps1</Command></LogonCommand>
</Configuration>
"@
"--- the Sandbox (a window opens and closes by itself; do not use it)"
Start-Process $wsb
$results = Join-Path $out "results.txt"
$waited = 0
while (-not (Test-Path (Join-Path $out "ready.txt")) -and $waited -lt 600) { Start-Sleep 5; $waited += 5 }
if (-not (Test-Path (Join-Path $out "ready.txt"))) { "the Sandbox never got ready"; Get-Content $results -ErrorAction SilentlyContinue; exit 1 }
pnpm --silent --filter @screentime/server exec tsx scripts/dev-grant.ts Sam screens -900
Set-Content (Join-Path $in "granted.txt") "granted"
$waited = 0
while (-not ((Test-Path $results) -and (Select-String -Path $results -Pattern "^done" -Quiet)) -and $waited -lt 300) { Start-Sleep 5; $waited += 5 }
"--- what the Sandbox saw"
Get-Content $results
"--- (full logs in $out)"
