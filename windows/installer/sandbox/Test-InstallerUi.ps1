# Tries the MSI's pages in Windows Sandbox (admin-level runs never happen on James's PC). No server needed.
# Run from the repo root in PowerShell 7 (pwsh), with Windows Sandbox turned on:
#   pwsh -File windows\installer\sandbox\Test-InstallerUi.ps1 -Msi <new ScreenTime.msi> -OldMsi <an older ScreenTime.msi>
# The Sandbox runs in-sandbox-ui.ps1 at logon: a new install, an update over the older MSI, removing it, and a failed
# install, each clicked through with UI Automation. It prints what the Sandbox saw; the pictures are in the out folder.
param([Parameter(Mandatory)][string]$Msi, [Parameter(Mandatory)][string]$OldMsi)
$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -lt 7) { throw "Run this with pwsh (PowerShell 7), not Windows PowerShell 5.1." }
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-ui-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null
Copy-Item $Msi (Join-Path $in "ScreenTime.msi")
Copy-Item $OldMsi (Join-Path $in "ScreenTime-old.msi")
Copy-Item (Join-Path $PSScriptRoot "in-sandbox-ui.ps1") $in

$wsb = Join-Path $work "run.wsb"
Set-Content $wsb @"
<Configuration>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\in\in-sandbox-ui.ps1</Command></LogonCommand>
</Configuration>
"@
"--- the Sandbox (a window opens and closes by itself; do not use it)"
Start-Process $wsb
# Waits for done.txt, not by reading results.txt: a host holding that file open stops the Sandbox writing to it.
# msiexec takes about 2 minutes to show each install's first page in the Sandbox, so the whole run takes 15 to 25.
$results = Join-Path $out "results.txt"
$waited = 0
while (-not (Test-Path (Join-Path $out "done.txt")) -and $waited -lt 2400) { Start-Sleep 10; $waited += 10 }
"--- what the Sandbox saw"
Get-Content $results
"--- (pictures and logs in $out)"
