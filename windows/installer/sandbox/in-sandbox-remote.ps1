# CARD-072: runs inside Windows Sandbox at logon (as its administrator, WDAGUtilityAccount).
# Proves criteria 18-19: install A, enrol, no parent mode, no --update-anytime;
# then wait for host to publish B and call dev-remote-update.ts, then verify B installs
# within 5 minutes, exactly one tray in session 1, and report diagnostics.
# Runs under Windows PowerShell 5.1 inside the Sandbox (no ?? or pwsh-only syntax).
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results "$(Get-Date -Format HH:mm:ss) $text" -Encoding UTF8 }

$aVersion = (Get-Content C:\in\a-version.txt).Trim()
$bVersion = (Get-Content C:\in\b-version.txt).Trim()
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
$trayExe = "C:\Program Files\ScreenTime\Tray\ScreenTime.Tray.exe"
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime"

Set-Content $results "sandbox remote run at $(Get-Date -Format o) as $(whoami), session $((Get-Process -Id $PID).SessionId), A=$aVersion B=$bVersion" -Encoding UTF8

function Run([string]$path, [string[]]$arguments) {
  $p = Start-Process $path -ArgumentList $arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput C:\out\cmd.txt -RedirectStandardError C:\out\cmd-err.txt
  foreach ($line in (Get-Content C:\out\cmd.txt, C:\out\cmd-err.txt -ErrorAction SilentlyContinue)) { if ($line.Trim()) { Say "  $($line.Trim())" } }
  $p.ExitCode
}

function ReadInstalledVersion {
  $keys = @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")
  foreach ($k in $keys) {
    if (-not (Test-Path $k)) { continue }
    foreach ($sub in (Get-ChildItem $k -ErrorAction SilentlyContinue)) {
      $props = Get-ItemProperty $sub.PSPath -ErrorAction SilentlyContinue
      if ($props.DisplayName -eq "Screen Time") { return $props.DisplayVersion }
    }
  }
  "(not installed)"
}

Say "=== 1. install A"
$code = (Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru).ExitCode
Say "msiexec install exit $code"
Say "files: $(Test-Path $exe) service, $(Test-Path $trayExe) tray"

Say "=== 2. gateway health and enrol"
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop
Say "gateway: $gateway"
try {
  $health = Invoke-WebRequest "http://${gateway}:8080/health" -UseBasicParsing -TimeoutSec 5
  Say "server health: $($health.StatusCode) $($health.Content)"
} catch {
  Say "server health: FAILED ($($_.Exception.Message))"
}
$enrolCode = (Get-Content C:\in\code.txt).Trim()
$exit = Run $exe @("enrol", "--server", "http://${gateway}:8080", "--code", $enrolCode, "--user", $env:USERNAME)
Say "enrol exit $exit"

Say "=== 3. set service flags (session 1, dry-lock only; NO parent mode, NO --update-anytime)"
Set-ItemProperty $serviceKey ImagePath "`"$exe`" --session 1 --dry-lock"
Say "service ImagePath: $((Get-ItemProperty $serviceKey).ImagePath)"
Say "sc.exe qc ScreenTime:"
foreach ($line in (sc.exe qc ScreenTime | Select-String "BINARY_PATH_NAME|START_TYPE")) { Say "  $($line.Line.Trim())" }
Restart-Service ScreenTime
Say "Restart-Service ScreenTime completed"

# Poll up to 120 s for service Running and exactly one tray in session 1
$serviceOk = $false
$trayOk = $false
for ($i = 0; $i -lt 24; $i++) {
  $svc = Get-Service ScreenTime -ErrorAction SilentlyContinue
  $svcState = if ($svc) { $svc.Status.ToString() } else { "(no service)" }
  $trays = @(Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'" | Where-Object { $_.SessionId -eq 1 })
  $trayCount = $trays.Count
  $pids = ($trays | ForEach-Object { $_.ProcessId }) -join ","
  $owners = ""
  foreach ($p in $trays) {
    $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner
    $owners += "$($owner.User),"
  }
  Say "  poll $($i+1)/24: service=$svcState, tray count=$trayCount, pids=$pids, owners=$owners"
  if ($svcState -eq "Running" -and $trayCount -eq 1) {
    $serviceOk = $true
    $trayOk = $true
    break
  }
  Start-Sleep 5
}
$installedA = ReadInstalledVersion
Say "version A installed: $installedA"

Say "=== 4. signal ready, then wait for host go signal"
Set-Content C:\out\ready.txt "ready"
Say "ready.txt written"

$goSeen = $false
for ($i = 0; $i -lt 120; $i++) {
  if (Test-Path C:\in\go.txt) {
    $goSeen = $true
    $goContent = (Get-Content C:\in\go.txt).Trim()
    Say "go.txt seen (content: $goContent) after $($i * 5) s"
    break
  }
  if ($i % 1 -eq 0) { Say "  poll $($i+1)/120: no go.txt yet" }
  Start-Sleep 5
}
if (-not $goSeen) {
  Say "criterion 19: FAIL (host never said go within 600 s)"
  Set-Content C:\out\done.txt "failed"
  Say "done"
  exit 0
}

Say "=== 5. criterion 19: poll installed version for B (up to 300 s)"
$installed = ReadInstalledVersion
$installSeconds = $null
for ($i = 0; $i -lt 60; $i++) {
  $elapsed = $i * 5
  Say "  poll $($i+1)/60 installed: $installed (elapsed: $elapsed s)"
  if ($installed -eq $bVersion) {
    $installSeconds = $elapsed
    Say "  installed after $installSeconds s"
    break
  }
  Start-Sleep 5
  $installed = ReadInstalledVersion
}

Say "final installed version: $installed"
if ($null -ne $installSeconds -and $installSeconds -le 300) {
  Say "criterion 19 installed B within 5 min: PASS (installed after $installSeconds s)"
} else {
  Say "criterion 19 installed B within 5 min: FAIL (not installed within 300 s)"
}
if ($installed -eq $bVersion) { Say "criterion 19 installed eventually: PASS" } else { Say "criterion 19 installed eventually: FAIL (got '$installed', expected '$bVersion')" }

Say "=== 6. set the flags again after the MSI install; restart only if the MSI-started service has no tray"
# Let msiexec finish starting the new service before touching it.
Start-Sleep 10
try { Set-ItemProperty $serviceKey ImagePath "`"$exe`" --session 1 --dry-lock" } catch { Say "  Set-ItemProperty failed: $($_.Exception.Message)" }
Say "service ImagePath: $((Get-ItemProperty $serviceKey).ImagePath)"
Say "sc.exe qc ScreenTime:"
foreach ($line in (sc.exe qc ScreenTime | Select-String "BINARY_PATH_NAME|START_TYPE")) { Say "  $($line.Line.Trim())" }

# First settle: the service the MSI started (do not restart it: an old tray would stay and a second would start).
$multiTray = $false
$settled = $false
for ($i = 0; $i -lt 18; $i++) {
  $svc = Get-Service ScreenTime -ErrorAction SilentlyContinue
  $svcState = if ($svc) { $svc.Status.ToString() } else { "(no service)" }
  $trays = @(Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'" | Where-Object { $_.SessionId -eq 1 })
  $trayCount = $trays.Count
  Say "  settle poll $($i+1)/18: service=$svcState, tray count in session 1 = $trayCount"
  if ($trayCount -gt 1) {
    $multiTray = $true
    break
  }
  if ($svcState -eq "Running" -and $trayCount -eq 1) {
    $settled = $true
    break
  }
  Start-Sleep 5
}
if (-not $multiTray -and -not $settled) {
  Say "no tray from the MSI-started service; restarting once with the flags set"
  try { Restart-Service ScreenTime -ErrorAction Stop; Say "Restart-Service ScreenTime completed" } catch { Say "Restart-Service failed: $($_.Exception.Message)" }
  for ($i = 0; $i -lt 12; $i++) {
    $svc = Get-Service ScreenTime -ErrorAction SilentlyContinue
    $svcState = if ($svc) { $svc.Status.ToString() } else { "(no service)" }
    $trays = @(Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'" | Where-Object { $_.SessionId -eq 1 })
    $trayCount = $trays.Count
    Say "  restart poll $($i+1)/12: service=$svcState, tray count in session 1 = $trayCount"
    if ($trayCount -gt 1) {
      $multiTray = $true
      break
    }
    if ($svcState -eq "Running" -and $trayCount -eq 1) { break }
    Start-Sleep 5
  }
}

Say "tray processes in session 1:"
$finalCount = 0
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'")) {
  if ($p.SessionId -ne 1) { continue }
  $finalCount++
  $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner
  Say "  pid=$($p.ProcessId) session=$($p.SessionId) user=$($owner.User) command=$($p.CommandLine)"
}
Say "service processes:"
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Service.exe'")) {
  Say "  pid=$($p.ProcessId) command=$($p.CommandLine)"
}

if ($multiTray) {
  Say "criterion 19 exactly one tray in session 1: FAIL (more than one tray)"
  Set-Content C:\out\done.txt "failed"
  Say "done"
  exit 0
}
if ($finalCount -eq 1) { Say "criterion 19 exactly one tray in session 1: PASS" } else { Say "criterion 19 exactly one tray in session 1: FAIL (count=$finalCount)" }

Say "=== 7. diagnostics"
$updatesLog = "C:\ProgramData\ScreenTime\updates\install.log"
if (Test-Path $updatesLog) {
  Say "last 40 lines of ${updatesLog}:"
  Get-Content $updatesLog | Select-Object -Last 40 | ForEach-Object { Say "  $_" }
} else {
  Say "${updatesLog} not found"
}

try {
  Say "EventLog Application source ScreenTime (last 40, update:/error):"
  $events = Get-EventLog -LogName Application -Source ScreenTime -Newest 40 -ErrorAction Stop
  $filtered = $events | Where-Object { $_.Message -match "update:|error" }
  if ($filtered) {
    $filtered | ForEach-Object { Say "  $($_.TimeGenerated.ToString('HH:mm:ss')) $($_.EntryType): $($_.Message.Substring(0, [Math]::Min(200, $_.Message.Length)))" }
  } else {
    Say "  (no matching events)"
  }
} catch {
  Say "  EventLog query failed: $($_.Exception.Message)"
}

Say "sc.exe query ScreenTime:"
foreach ($line in (sc.exe query ScreenTime | Select-String "STATE")) { Say "  $($line.Line.Trim())" }
Say "service command line:"
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Service.exe'")) {
  Say "  pid=$($p.ProcessId) command=$($p.CommandLine)"
}

$parentApproved = Test-Path C:\in\parent-mode-approved.txt
Say "C:\in\parent-mode-approved.txt exists: $parentApproved (must be False)"

Say "=== 8. done"
$anyFail = ($installed -ne $bVersion) -or $multiTray -or ($finalCount -ne 1) -or $parentApproved
if ($anyFail) {
  Set-Content C:\out\done.txt "failed"
} else {
  Set-Content C:\out\done.txt "done"
}
Say "done"
