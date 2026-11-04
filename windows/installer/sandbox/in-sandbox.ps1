# CARD-052: runs inside Windows Sandbox at logon (as its administrator, WDAGUtilityAccount). Installs the MSI from C:\in,
# checks what it did, enrols this account as the kid, watches the real service (as LocalSystem) start the tray in this
# session and ask it to lock (a dry run: the Sandbox has no console session, see step 5),
# uninstalls, checks it is all gone, and shuts the Sandbox down. Everything it sees goes to C:\out\results.txt.
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results $text }
function Run([string]$exe, [string[]]$arguments) {
  $p = Start-Process $exe -ArgumentList $arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput C:\out\cmd.txt -RedirectStandardError C:\out\cmd-err.txt
  foreach ($line in (Get-Content C:\out\cmd.txt, C:\out\cmd-err.txt -ErrorAction SilentlyContinue)) { if ($line.Trim()) { Say "  $($line.Trim())" } }
  $p.ExitCode
}
function TimeZoneRight { secedit /export /cfg C:\out\secpol.inf /areas USER_RIGHTS | Out-Null; (Get-Content C:\out\secpol.inf | Select-String "SeTimeZonePrivilege").Line }
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
$trayLog = Join-Path $env:LOCALAPPDATA "ScreenTime\tray.log"

Set-Content $results "sandbox run at $(Get-Date -Format o) as $(whoami), session $((Get-Process -Id $PID).SessionId)"
Say "before: $(TimeZoneRight)"

Say "=== 1. install"
$code = (Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru).ExitCode
Say "msiexec install exit $code"
Say "files: $(Test-Path $exe) service, $(Test-Path 'C:\Program Files\ScreenTime\Tray\ScreenTime.Tray.exe') tray"

Say "=== 2. the service"
foreach ($line in (sc.exe qc ScreenTime | Select-String "START_TYPE|SERVICE_START_NAME|BINARY_PATH_NAME")) { Say "  $($line.Line.Trim())" }
foreach ($line in (sc.exe query ScreenTime | Select-String "STATE")) { Say "  $($line.Line.Trim())" }
foreach ($line in (sc.exe qfailure ScreenTime | Select-String "RESET_PERIOD|RESTART")) { Say "  $($line.Line.Trim())" }

Say "=== 3. Safe Mode"
foreach ($mode in "Minimal", "Network") {
  $value = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\$mode\ScreenTime" -ErrorAction SilentlyContinue).'(default)'
  Say "  $mode = $value"
}

Say "=== 4. the time zone right"
Say "  $(TimeZoneRight)"
$null = Run $exe @("harden-check")

Say "=== 5. enrol this account as Sam"
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop
$enrolCode = (Get-Content C:\in\code.txt).Trim()
$exit = Run $exe @("enrol", "--server", "http://${gateway}:8080", "--code", $enrolCode, "--user", $env:USERNAME)
Say "  enrol exit $exit"
# The Sandbox has no console session (its desktop is a remote session), and the service only enforces the console.
# For this test the installed service gets --session <this session> --dry-lock, as the console runs do.
Add-Type -Namespace W -Name Ts -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();'
$session = (Get-Process -Id $PID).SessionId
Say "  console session: $([W.Ts]::WTSGetActiveConsoleSessionId()) (4294967295 = none); this session: $session"
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime"
Set-ItemProperty $serviceKey ImagePath "`"$exe`" --session $session --dry-lock"
Say "  service command: $((Get-ItemProperty $serviceKey).ImagePath)"
Restart-Service ScreenTime
Start-Sleep 30

Say "=== 6. the tray, started by the service"
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'")) {
  $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)"
  Say "  tray pid $($p.ProcessId), session $($p.SessionId), user $($owner.User), parent $($parent.Name), args: $($p.CommandLine -replace '^.*ScreenTime\.Tray\.exe""?\s*', '')"
}
foreach ($line in (Get-Content $trayLog -ErrorAction SilentlyContinue | Select-String "pipe: connected|view:" | Select-Object -First 3)) { Say "  $($line.Line)" }
Say "  pipes: $(([IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { $_ -like '*ScreenTime*' }) -join ', ')"
# A tray that crashes at start shows up here (CARD-052 found one: its .pri file was missing from the publish).
foreach ($e in (Get-WinEvent -FilterHashtable @{ LogName = "Application"; Level = 1, 2 } -MaxEvents 3 -ErrorAction SilentlyContinue)) {
  $text = $e.Message -replace '\s+', ' '
  Say "  error event: $($e.ProviderName): $($text.Substring(0, [Math]::Min(300, $text.Length)))"
}
Set-Content C:\out\ready.txt "ready"

Say "=== 7. out of time: the service asks the tray to lock (dry run in the Sandbox)"
$waited = 0
while (-not (Test-Path C:\in\granted.txt) -and $waited -lt 180) { Start-Sleep 2; $waited += 2 }
Say "  the host ran Sam out of time (waited $waited s)"
Start-Sleep 20
foreach ($line in (Get-Content $trayLog -ErrorAction SilentlyContinue | Select-String "view:|lock:" | Select-Object -Last 3)) { Say "  $($line.Line)" }

Copy-Item $trayLog C:out	ray.log -ErrorAction SilentlyContinue
Say "=== 8. uninstall"
Stop-Service ScreenTime -ErrorAction SilentlyContinue
Stop-Process -Name ScreenTime.Tray -Force -ErrorAction SilentlyContinue
$code = (Start-Process msiexec.exe -ArgumentList @("/x", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\uninstall.log") -Wait -PassThru).ExitCode
Say "msiexec uninstall exit $code"
Say "  service still there: $([bool](Get-Service ScreenTime -ErrorAction SilentlyContinue))"
Say "  Safe Mode keys still there: $(Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\Minimal\ScreenTime') $(Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\Network\ScreenTime')"
Say "  files still there: $(Test-Path 'C:\Program Files\ScreenTime')"
Say "  $(TimeZoneRight)"
Say "done"
Stop-Computer -Force
