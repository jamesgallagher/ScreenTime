# CARD-061: runs inside Windows Sandbox (as its administrator, WDAGUtilityAccount). Installs the old MSI from C:\in,
# enrols this account as Sam, sets the service's ImagePath to --session --dry-lock --update-anytime, and waits for the
# service to update itself. Then checks the result. Everything it sees goes to C:\out\results.txt.
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results $text }
function Run([string]$exe, [string[]]$arguments) {
  $p = Start-Process $exe -ArgumentList $arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput C:\out\cmd.txt -RedirectStandardError C:\out\cmd-err.txt
  foreach ($line in (Get-Content C:\out\cmd.txt, C:\out\cmd-err.txt -ErrorAction SilentlyContinue)) { if ($line.Trim()) { Say "  $($line.Trim())" } }
  $p.ExitCode
}
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
$trayLog = Join-Path $env:LOCALAPPDATA "ScreenTime\tray.log"
$updatesFolder = "C:\ProgramData\ScreenTime\updates"

Set-Content $results "sandbox update run at $(Get-Date -Format o) as $(whoami), session $((Get-Process -Id $PID).SessionId)"

Say "=== 1. install the old MSI"
$code = (Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru).ExitCode
Say "msiexec install exit $code"
Say "files: $(Test-Path $exe) service, $(Test-Path 'C:\Program Files\ScreenTime\Tray\ScreenTime.Tray.exe') tray"

Say "=== 2. the service"
foreach ($line in (sc.exe qc ScreenTime | Select-String "START_TYPE|SERVICE_START_NAME|BINARY_PATH_NAME")) { Say "  $($line.Line.Trim())" }
foreach ($line in (sc.exe query ScreenTime | Select-String "STATE")) { Say "  $($line.Line.Trim())" }

Say "=== 3. enrol this account as Sam"
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop
$enrolCode = (Get-Content C:\in\code.txt).Trim()
$exit = Run $exe @("enrol", "--server", "http://${gateway}:8080", "--code", $enrolCode, "--user", $env:USERNAME)
Say "  enrol exit $exit"
Add-Type -Namespace W -Name Ts -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();'
$session = (Get-Process -Id $PID).SessionId
Say "  this session: $session"
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime"
Set-ItemProperty $serviceKey ImagePath "`"$exe`" --session $session --dry-lock --update-anytime"
Say "  service command: $((Get-ItemProperty $serviceKey).ImagePath)"
Restart-Service ScreenTime
Start-Sleep 30

Say "=== 4. the tray, started by the service"
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'")) {
  $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner
  Say "  tray pid $($p.ProcessId), session $($p.SessionId), user $($owner.User)"
}
foreach ($line in (Get-Content $trayLog -ErrorAction SilentlyContinue | Select-String "pipe: connected|view:" | Select-Object -First 3)) { Say "  $($line.Line)" }

Say "=== 5. wait for the update"
$waited = 0
$foundUpdate = $false
while ($waited -lt 600) {
  Start-Sleep 10
  $waited += 10
  if (Test-Path $updatesFolder) {
    foreach ($f in (Get-ChildItem $updatesFolder -ErrorAction SilentlyContinue)) {
      Say "  updates: $($f.Name) $($f.Length) bytes"
    }
    if (Test-Path (Join-Path $updatesFolder "install.log")) { $foundUpdate = $true; break }
  }
  $svc = (Get-Service ScreenTime -ErrorAction SilentlyContinue)
  if ($svc -and $svc.Status -eq 'Running') {
    $ver = (sc.exe qc ScreenTime | Select-String "BINARY_PATH_NAME").Line
    if ($ver -match '0\.1\.\d+') {
      $m = [regex]::Match($ver, '0\.1\.(\d+)')
      Say "  service version: 0.1.$($m.Groups[1].Value)"
      if ([int]$m.Groups[1].Value -gt [int](Get-Content C:\in\old-version.txt).Trim()) { $foundUpdate = $true; break }
    }
  }
}
Say "  waited $waited s"

Say "=== 6. msiexec exit code and PendingFileRenameOperations"
if (Test-Path (Join-Path $updatesFolder "install.log")) {
  $log = Get-Content (Join-Path $updatesFolder "install.log") -ErrorAction SilentlyContinue
  foreach ($line in ($log | Select-String "Exit code|Return value")) { Say "  install.log: $($line.Line.Trim())" }
  $lastLine = ($log | Select-Object -Last 5)
  foreach ($line in $lastLine) { Say "  install.log: $($line.Trim())" }
} else {
  Say "  install.log not found"
}
$pfr = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\PendingFileRenameOperations" -ErrorAction SilentlyContinue).'(default)'
$screenTimeEntries = $pfr | Where-Object { $_ -like '*ScreenTime*' }
if ($screenTimeEntries) {
  Say "  PendingFileRenameOperations ScreenTime entries:"
  foreach ($e in $screenTimeEntries) { Say "    $e" }
} else {
  Say "  no PendingFileRenameOperations entry containing ScreenTime"
}

Say "=== 7. service version and trays after update"
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime"
Set-ItemProperty $serviceKey ImagePath "`"$exe`" --session $session --dry-lock --update-anytime"
Restart-Service ScreenTime
Start-Sleep 30
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'")) {
  $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner
  Say "  tray pid $($p.ProcessId), session $($p.SessionId), user $($owner.User)"
}
Say "  tray count: $((Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'")).Count"

Say "=== 8. task check and updates folder"
foreach ($line in (schtasks.exe /Query /TN ScreenTimeUpdate 2>&1)) { Say "  schtasks: $($_.Trim())" }
if (Test-Path $updatesFolder) {
  foreach ($f in (Get-ChildItem $updatesFolder -ErrorAction SilentlyContinue)) {
    Say "  updates: $($f.Name) $($f.Length) bytes"
  }
} else {
  Say "  updates folder does not exist"
}

Say "=== 9. update: lines from the service log"
$svcLog = "C:\ProgramData\ScreenTime\service.log"
if (Test-Path $svcLog) {
  foreach ($line in (Get-Content $svcLog | Select-String "update:")) { Say "  $($line.Line)" }
} else {
  Say "  service log not found at $svcLog"
}

Say "=== 10. pending update in the store"
$storeDb = "C:\ProgramData\ScreenTime\state.db"
if (Test-Path $storeDb) {
  $conn = New-Object Microsoft.Data.Sqlite.SqliteConnection("Data Source=$storeDb")
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = "SELECT value FROM kv WHERE sid = 'update' AND key = 'pending'"
  $reader = $cmd.ExecuteReader()
  if ($reader.Read()) { Say "  pending update: $($reader.GetString(0))" } else { Say "  pending update: none" }
  $reader.Close()
  $conn.Close()
} else {
  Say "  state.db not found"
}

Say "=== 11. fake newer version with wrong sha256"
# The host publishes a fake newer version with a wrong sha256. Wait for the next check.
$waited = 0
while ($waited -lt 300) {
  Start-Sleep 10
  $waited += 10
  if (Test-Path $svcLog) {
    $lines = Get-Content $svcLog | Select-String "update:"
    if (($lines | Select-String "does not match|mismatch").Count -gt 0) { break }
  }
}
Say "  waited $waited s for the mismatch"
if (Test-Path $svcLog) {
  foreach ($line in (Get-Content $svcLog | Select-String "update:")) { Say "  $($line.Line)" }
}

Say "done"
Stop-Computer -Force
