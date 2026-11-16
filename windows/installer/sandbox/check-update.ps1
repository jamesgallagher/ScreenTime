# CARD-061: checks the update result inside Windows Sandbox. Appends to C:\out\results.txt.
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results $text }
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
$updatesFolder = "C:\ProgramData\ScreenTime\updates"

Say ""
Say "=== 5. msiexec exit code and PendingFileRenameOperations"
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

Say "=== 6. service version and trays after update"
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime"
Set-ItemProperty $serviceKey ImagePath "`"$exe`" --session 1 --dry-lock --update-anytime"
Restart-Service ScreenTime
Start-Sleep 30
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'")) {
  $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner
  Say "  tray pid $($p.ProcessId), session $($p.SessionId), user $($owner.User)"
}
Say "  tray count: $((Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'")).Count"

Say "=== 7. task check and updates folder"
foreach ($line in (schtasks.exe /Query /TN ScreenTimeUpdate 2>&1)) { Say "  schtasks: $($_.Trim())" }
if (Test-Path $updatesFolder) {
  foreach ($f in (Get-ChildItem $updatesFolder -ErrorAction SilentlyContinue)) {
    Say "  updates: $($f.Name) $($f.Length) bytes"
  }
} else {
  Say "  updates folder does not exist"
}

Say "=== 8. update: lines from the service log"
try {
  $events = Get-EventLog -LogName Application -Source "ScreenTime" -Newest 50 -ErrorAction Stop
  foreach ($e in $events) {
    if ($e.Message -match 'update:') { Say "  $($e.Message)" }
  }
  if (-not ($events | Where-Object { $_.Message -match 'update:' })) { Say "  no update: lines in the Application log" }
} catch {
  Say "  could not read the Application log ($($_.Exception.Message))"
}

Say "=== 9. pending update in the store"
$storeDb = "C:\ProgramData\ScreenTime\state.db"
if (Test-Path $storeDb) {
  try {
    $bytes = [IO.File]::ReadAllBytes($storeDb)
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    $match = [regex]::Match($text, '\{"versionCode":\d+,\s*"versionName":"[^"]+",\s*"startedAtMs":\d+,\s*"failures":\d+\}')
    if ($match.Success) { Say "  pending update: $($match.Value)" } else { Say "  pending update: none" }
  } catch {
    Say "  pending update: could not read state.db ($($_.Exception.Message))"
  }
} else {
  Say "  state.db not found"
}

Say "done"
