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
Say "  gateway: $gateway"
try {
  $health = Invoke-WebRequest "http://${gateway}:8080/health" -UseBasicParsing -TimeoutSec 5
  Say "  server health: $($health.StatusCode) $($health.Content)"
} catch {
  Say "  server health: FAILED ($($_.Exception.Message))"
}
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

Say "=== 5. (the host publishes the newer version and waits for the update)"
Say "done"
