# Tries the setup window in Windows Sandbox (docs/BUILD-PLAN.md: admin-level runs never happen on James's PC).
# Run from the repo root in PowerShell 7 (pwsh), with Docker Desktop running and Windows Sandbox turned on:
#   pwsh -File windows\installer\sandbox\Test-Setup.ps1 -Msi <path to ScreenTime.msi>
# It resets the local dev server, makes Alex's enrolment code for a PC (for "Have a code instead?"), starts the Sandbox
# (which runs in-sandbox-setup.ps1 at logon), hands it the parent's emailed sign-in code from the dev server's log when
# it asks (the dev server has no SMTP, so it logs the code), prints what the Sandbox saw, then what the server has.
param([Parameter(Mandatory)][string]$Msi)
$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -lt 7) { throw "Run this with pwsh (PowerShell 7), not Windows PowerShell 5.1." }
$here = $PSScriptRoot
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null
Copy-Item $Msi (Join-Path $in "ScreenTime.msi")
Copy-Item (Join-Path $here "in-sandbox-setup.ps1") $in

"--- the dev server"
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v 2>&1 | Out-Null
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait 2>&1 | Select-Object -Last 1
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
$code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex pc | Select-String '\d{6}').Matches[0].Value
Set-Content (Join-Path $in "code.txt") $code

$wsb = Join-Path $work "run.wsb"
Set-Content $wsb @"
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox-setup.ps1</Command></LogonCommand>
</Configuration>
"@
"--- the Sandbox (a window opens and closes by itself; do not use it)"
Start-Process $wsb
$results = Join-Path $out "results.txt"
$wanted = Join-Path $out "otp-wanted.txt"
$otp = Join-Path $out "otp.txt"
$waited = 0
while (-not ((Test-Path $results) -and (Select-String -Path $results -Pattern "^done" -Quiet)) -and $waited -lt 900) {
  if ((Test-Path $wanted) -and -not (Test-Path $otp)) {
    # The newest sign-in code the dev server logged for that email (it logs instead of emailing).
    $email = (Get-Content $wanted).Trim()
    $line = docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api 2>&1 | Select-String "sign-in code for $([regex]::Escape($email)) is (\d{6})" | Select-Object -Last 1
    if ($line) {
      Set-Content $otp $line.Matches[0].Groups[1].Value
      "  (gave the Sandbox the sign-in code the dev server logged for $email)"
    }
  }
  Start-Sleep 5
  $waited += 5
}
"--- what the Sandbox saw"
Get-Content $results
"--- what the server has: the kids' PCs, and the setup window's parent sign-ins"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U screentime -d screentime -A -t -c "select k.name || ': ' || d.name || ' | ' || d.form || ' | ' || d.windows_user_name || ' | revoked: ' || (d.revoked_at is not null) from devices d join kids k on k.id = d.kid_id order by k.name, d.enrolled_at"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U screentime -d screentime -A -t -c "select s.client || ' | ' || s.client_label || ' | signed out: ' || (s.revoked_at is not null) from parent_sessions s order by s.created_at"
"--- (full logs in $out)"
