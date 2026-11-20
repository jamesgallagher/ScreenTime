# Proves program counting on a PC (docs/SPEC.md §12.9) in Windows Sandbox. Run from the repo root, with
# Docker Desktop running, Windows Sandbox turned on and the PC unlocked:
#   windows\installer\sandbox\Test-Programs.ps1 -Msi <path to ScreenTime.msi>
# Inside, in-sandbox-programs.ps1 installs the MSI, enrols the account as Sam, opens Character Map and About
# Windows, waits for the tray to see them and the service to sync, then closes both. Back on the host, the
# script prints the dev report for Sam and checks the program time.
param([Parameter(Mandatory)][string]$Msi)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-programs-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null
Copy-Item $Msi (Join-Path $in "ScreenTime.msi")
Copy-Item (Join-Path $here "in-sandbox-programs.ps1") $in

"--- the dev server"
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v 2>&1 | Out-Null
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait 2>&1 | Select-Object -Last 1
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
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
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox-programs.ps1</Command></LogonCommand>
</Configuration>
"@
"--- the Sandbox (a window opens and closes by itself; do not use it)"
Start-Process $wsb
$results = Join-Path $out "results.txt"
$waited = 0
while (-not ((Test-Path $results) -and (Select-String -Path $results -Pattern "=== done:" -Quiet)) -and $waited -lt 1500) { Start-Sleep 10; $waited += 10 }
"--- what the Sandbox saw (waited $waited s)"
Get-Content $results -ErrorAction SilentlyContinue
"--- the report for Sam, today"
$report = pnpm --silent --filter @screentime/server exec tsx scripts/dev-report.ts Sam day
$report
"--- (full logs in $out)"
