# Runs inside Windows Sandbox at each logon (as WDAGUtilityAccount), for Test-TrayExit.ps1. First logon: install,
# enrol as Sam, close the tray three times by hand (a tamper attempt), then restart the Sandbox, which closes the tray
# as a shutdown does. Second logon: let the service send what it has, then shut down. Everything goes to C:\out.
$results = "C:\out\results.txt"
$stage = "C:\out\stage.txt"
function Say([string]$text) { Add-Content $results "$(Get-Date -Format HH:mm:ss) $text" }
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
function Trays { @(Get-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue) }
function Tampers { foreach ($e in (Get-WinEvent -FilterHashtable @{ LogName = "Application" } -MaxEvents 300 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match "tamper" })) { Say "  event log $($e.TimeCreated.ToString('HH:mm:ss')): $(($e.Message -replace '\s+', ' ').Substring(0, [Math]::Min(160, ($e.Message -replace '\s+', ' ').Length)))" } }

if (-not (Test-Path $stage)) {
  Set-Content $results "sandbox run at $(Get-Date -Format o) as $(whoami), session $((Get-Process -Id $PID).SessionId)"
  Say "=== 1. install and enrol as Sam"
  $code = (Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru).ExitCode
  Say "msiexec install exit $code; version $((Get-Item $exe).VersionInfo.ProductVersion)"
  $gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop
  $out = & $exe enrol --server "http://${gateway}:8080" --code (Get-Content C:\in\code.txt).Trim() --user $env:USERNAME 2>&1
  Say "  enrol: $out"
  # No console session in the Sandbox: the service is pointed at this one (as Test-Installer.ps1 does).
  $session = (Get-Process -Id $PID).SessionId
  Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime" ImagePath "`"$exe`" --session $session --dry-lock"
  Restart-Service ScreenTime
  $waited = 0
  while ((Trays).Count -eq 0 -and $waited -lt 60) { Start-Sleep 2; $waited += 2 }
  Say "  tray running: $((Trays).Count) (after $waited s)"
  Start-Sleep 15

  Say "=== 2. the tray closed by hand three times: one attempt"
  foreach ($i in 1..3) {
    $old = (Trays | Select-Object -First 1).Id
    Stop-Process -Name ScreenTime.Tray -Force -ErrorAction SilentlyContinue
    $waited = 0
    while (-not (Trays | Where-Object Id -ne $old) -and $waited -lt 30) { Start-Sleep 1; $waited += 1 }
    Say "  closed $i (pid $old), back as pid $((Trays | Select-Object -First 1).Id) after $waited s"
  }
  Say "  waiting 50 s: an exit is judged 30 s after it"
  Start-Sleep 50
  Tampers

  Say "=== 3. restart: Windows closes the tray as at a shutdown"
  Set-Content $stage "restarted"
  # Not -Force: a normal restart, as from Start, asks each app to close first.
  shutdown.exe /r /t 0
  exit
}

Say "=== 4. after the restart"
$waited = 0
while ((Trays).Count -eq 0 -and $waited -lt 120) { Start-Sleep 2; $waited += 2 }
Say "  tray running: $((Trays).Count) (after $waited s); waiting 90 s for the service to sync and send"
Start-Sleep 90
Tampers
Say "done"
Stop-Computer -Force
