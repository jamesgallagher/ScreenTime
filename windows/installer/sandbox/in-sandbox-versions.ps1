# CARD-071: runs inside Windows Sandbox at logon (as its administrator, WDAGUtilityAccount).
# Proves criteria 19-22 via the tray flyout's UI Automation ids.
# Runs under Windows PowerShell 5.1 inside the Sandbox (no ?? or pwsh-only syntax).
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results "$(Get-Date -Format HH:mm:ss) $text" -Encoding UTF8 }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace W -Name T -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr FindWindow(string c, string w);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessageW(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);
'@
$A = [System.Windows.Automation.AutomationElement]

$aVersion = (Get-Content C:\in\a-version.txt).Trim()
$bVersion = (Get-Content C:\in\b-version.txt).Trim()
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
$trayExe = "C:\Program Files\ScreenTime\Tray\ScreenTime.Tray.exe"
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime"

Set-Content $results "sandbox versions run at $(Get-Date -Format o) as $(whoami), session $((Get-Process -Id $PID).SessionId), A=$aVersion B=$bVersion" -Encoding UTF8

function Run([string]$path, [string[]]$arguments) {
  $p = Start-Process $path -ArgumentList $arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput C:\out\cmd.txt -RedirectStandardError C:\out\cmd-err.txt
  foreach ($line in (Get-Content C:\out\cmd.txt, C:\out\cmd-err.txt -ErrorAction SilentlyContinue)) { if ($line.Trim()) { Say "  $($line.Trim())" } }
  $p.ExitCode
}

# Find the tray flyout: top-level window whose ProcessId is the ScreenTime.Tray.exe pid and Name "Screen Time".
function TrayPid {
  foreach ($p in (Get-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue)) { return $p.Id }
  0
}
function Flyout {
  $trayProcId = TrayPid
  if (-not $trayProcId) { return $null }
  foreach ($w in $A::RootElement.FindAll("Children", [System.Windows.Automation.Condition]::TrueCondition)) {
    try {
      if ($w.Current.Name -eq "Screen Time" -and $w.Current.ProcessId -eq $trayProcId -and -not $w.Current.IsOffscreen) { return $w }
    } catch { }
  }
  $null
}
# Open/toggle the flyout by posting to the tray icon's hidden callback window.
function OpenFlyout {
  $hwnd = [W.T]::FindWindow("ScreenTime.TrayIcon", "ScreenTime.TrayIcon")
  if ($hwnd -eq [IntPtr]::Zero) { Say "    FindWindow returned 0 (HWND not found)"; return $false }
  Say "    FindWindow returned HWND=$hwnd"
  [W.T]::PostMessageW($hwnd, 0x8001, [IntPtr]1, [IntPtr]0x400) | Out-Null
  $true
}
# Make sure the flyout is open: if absent, post the message and retry up to 5 times.
function EnsureFlyout {
  for ($i = 0; $i -lt 5; $i++) {
    $w = Flyout
    if ($w) { return $w }
    $posted = OpenFlyout
    Say "    (flyout absent; posted=$posted; retry $($i+1)/5)"
    Start-Sleep 1
  }
  $null
}

function El($window, [string]$id) {
  if (-not $window) { return $null }
  try { return $window.FindFirst("Descendants", (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, $id))) } catch { return $null }
}
function Text([string]$id) {
  $w = Flyout
  $e = El $w $id
  if ($e) { $e.Current.Name } else { "(none)" }
}
function Describe([string]$id) {
  $w = Flyout
  $e = El $w $id
  if (-not $e) { "found=no" }
  else {
    $hasInvoke = $false
    try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) | Out-Null; $hasInvoke = $true } catch { }
    "found=yes Name='$($e.Current.Name)' IsOffscreen=$($e.Current.IsOffscreen) InvokePattern=$hasInvoke"
  }
}
function IsVisible([string]$id) {
  $w = Flyout
  $e = El $w $id
  if (-not $e) { return $false }
  if ($e.Current.IsOffscreen) { return $false }
  $true
}
function Press([string]$id) {
  $w = Flyout
  $e = El $w $id
  if (-not $e) { Say "  Press($id): not found"; return $false }
  try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return $true } catch { Say "  Press($id): invoke failed: $($_.Exception.Message)"; return $false }
}
function WaitText([string]$id, [scriptblock]$done, [int]$seconds) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    $t = Text $id
    if (& $done $t) { return $t }
    Start-Sleep -Milliseconds 500
  }
  "(timed out) $t"
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

Say "=== 1. install A, enrol, set service flags"
$code = (Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru).ExitCode
Say "msiexec install exit $code"
Say "files: $(Test-Path $exe) service, $(Test-Path $trayExe) tray"

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

Set-ItemProperty $serviceKey ImagePath "`"$exe`" --session 1 --dry-lock"
Say "service ImagePath: $((Get-ItemProperty $serviceKey).ImagePath)"
Restart-Service ScreenTime
Start-Sleep 30
Say "tray processes after restart:"
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'")) {
  $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner
  Say "  pid=$($p.ProcessId) session=$($p.SessionId) user=$($owner.User)"
}

Say "=== 2. criterion 19: not in parent mode, VersionLink must not be visible"
$w = EnsureFlyout
if (-not $w) {
  Say "flyout: never opened"
  Say "criterion 19: FAIL (flyout never opened)"
} else {
  Say "flyout: open"
  Say "VersionLink: $(Describe 'VersionLink')"
  $vl19 = IsVisible 'VersionLink'
  if ($vl19) { Say "criterion 19: FAIL (VersionLink visible outside parent mode)" } else { Say "criterion 19: PASS (VersionLink not visible)" }
}
# Poll for "I'm the parent" button to become enabled (up to 30 s)
$parentBtn = $null
$parentEnabled = $false
for ($i = 1; $i -le 30; $i++) {
  $w = EnsureFlyout
  if ($w) {
    try {
      $candidate = $w.FindFirst("Descendants", (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, "I'm the parent")))
      if ($candidate) {
        $parentBtn = $candidate
        $isEnabled = $candidate.Current.IsEnabled
        if ($isEnabled) {
          $parentEnabled = $true
          Say "  poll $i/30: I'm the parent found and enabled"
          break
        } else {
          Say "  poll $i/30: I'm the parent found but disabled"
        }
      } else {
        Say "  poll $i/30: I'm the parent not found"
      }
    } catch {
      Say "  poll $i/30: error finding I'm the parent: $($_.Exception.Message)"
    }
  } else {
    Say "  poll $i/30: flyout not open"
  }
  Start-Sleep 1
}

if (-not $parentEnabled) {
  Say "criterion 20: FAIL (I'm the parent never enabled)"
  Say "criterion 21: FAIL (skipped - parent button not enabled)"
  Say "criterion 22: FAIL (skipped - parent button not enabled)"
  Set-Content C:\out\step20-failed.txt "parent button never enabled"
  Set-Content C:\out\done.txt "failed"
  Say "done"
  exit 0
}

Say "I'm the parent button: enabled"

Say "=== 3. start parent mode"
$parentPressed = $false
try { $parentBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Say "pressed I'm the parent"; $parentPressed = $true } catch { Say "I'm the parent invoke failed: $($_.Exception.Message)" }

if ($parentPressed) {
  Start-Sleep 1
  Set-Content C:\out\parent-mode-asked.txt "asked"
  $waited = 0
  while (-not (Test-Path C:\in\parent-mode-approved.txt) -and $waited -lt 120) { Start-Sleep 2; $waited += 2 }
  if (-not (Test-Path C:\in\parent-mode-approved.txt)) {
    Say "parent mode approval: FAIL (timed out after 120 s)"
    Say "criterion 20: FAIL (parent mode not approved)"
    Say "criterion 21: FAIL (skipped - parent mode not approved)"
    Say "criterion 22: FAIL (skipped - parent mode not approved)"
    Set-Content C:\out\step20-failed.txt "parent mode not approved"
    Set-Content C:\out\done.txt "failed"
    Say "done"
    exit 0
  }
  Say "parent mode approval: received"
} else {
  Say "criterion 20: FAIL (skipped - I'm the parent not pressed)"
  Say "criterion 21: FAIL (skipped - I'm the parent not pressed)"
  Say "criterion 22: FAIL (skipped - I'm the parent not pressed)"
  Set-Content C:\out\step20-failed.txt "parent button not found"
  Set-Content C:\out\done.txt "failed"
  Say "done"
  exit 0
}

# Capture the parent mode caption (e.g. "Parent mode · ends 4:15 pm") - poll up to 60 s.
$endText = ""
$capturedCaption = ""
for ($i = 0; $i -lt 60; $i++) {
  $w = Flyout
  if (-not $w) { Start-Sleep 1; $w = EnsureFlyout }
  if (-not $w) { Start-Sleep 1; continue }
  $captionText = ""
  try {
    foreach ($e in $w.FindAll("Descendants", [System.Windows.Automation.Condition]::TrueCondition)) {
      $n = $e.Current.Name
      if ($n -and $n.StartsWith("Parent mode")) { $captionText = $n; break }
    }
  } catch { }
  if ($captionText) {
    $capturedCaption = $captionText
    if ($captionText -match 'ends\s+(.+)$') { $endText = $Matches[1].Trim() }
    Say "parent mode caption: $captionText"
    break
  }
  Start-Sleep 1
}
if (-not $capturedCaption) { Say "parent mode caption: (not seen within 60 s)" }

# Criterion 20: VersionLink must now be visible and read "Version <A>".
$w = EnsureFlyout
Say "VersionLink after parent mode: $(Describe 'VersionLink')"
$vl20Name = Text 'VersionLink'
$expected20 = "Version $aVersion"
$vl20Pass = ($vl20Name -eq $expected20 -and (IsVisible 'VersionLink'))
if ($vl20Pass) { Say "criterion 20 VersionLink text: PASS ('$vl20Name')" } else { Say "criterion 20 VersionLink text: FAIL (got '$vl20Name', expected '$expected20')" }
$pressed = Press 'VersionLink'
Say "VersionLink invoke: $pressed"
if (-not $pressed) { Say "criterion 20: FAIL (VersionLink could not be invoked)" }
$ups20 = WaitText 'UpdatesStatus' { param($t) $t -eq "You're up to date" } 30
Say "UpdatesStatus: $ups20"
$ups20Pass = ($ups20 -eq "You're up to date")
if ($ups20Pass) { Say "criterion 20 UpdatesStatus: PASS" } else { Say "criterion 20 UpdatesStatus: FAIL (got '$ups20')" }

if ($vl20Pass -and $pressed -and $ups20Pass) {
  Set-Content C:\out\step20-done.txt "done"
} else {
  Say "criterion 20: FAIL (not all checks passed)"
  Say "criterion 21: FAIL (skipped - criterion 20 failed)"
  Say "criterion 22: FAIL (skipped - criterion 20 failed)"
  Set-Content C:\out\step20-failed.txt "criterion 20 failed"
  Set-Content C:\out\done.txt "failed"
  Say "done"
  exit 0
}

Say "=== 4. criterion 21: wait for host to publish B, then Check for updates"
$waited = 0
while (-not (Test-Path C:\in\b.txt) -and $waited -lt 180) { Start-Sleep 3; $waited += 3 }
if (-not (Test-Path C:\in\b.txt)) { Say "b.txt: not seen within 180 s" } else { Say "b.txt: seen" }

# Reopen Updates panel: invoke VersionLink if present; otherwise the panel is still open.
$w = EnsureFlyout
$vlNow = El $w 'VersionLink'
if ($vlNow) { Press 'VersionLink'; Start-Sleep 1 }
Say "UpdatesStatus before Check: $(Text 'UpdatesStatus')"

$pressedMain = Press 'UpdatesMain'
Say "UpdatesMain invoke: $pressedMain"
$expected21a = "$bVersion is ready. Update now?"
$expected21b = "$bVersion is out"
$ups21 = WaitText 'UpdatesStatus' { param($t) ($t -eq $expected21a) -or ($t -like "$bVersion is out*") } 120
Say "UpdatesStatus: $ups21"
if (($ups21 -eq $expected21a) -or ($ups21 -like "$bVersion is out*")) { Say "criterion 21: PASS ('$ups21')" } else { Say "criterion 21: FAIL (got '$ups21')" }

Say "=== 5. criterion 22: invoke Update now"
$pressTime = Get-Date
$pressedMain2 = Press 'UpdatesMain'
Say "UpdatesMain (Update now) invoke: $pressedMain2"
if ($pressedMain2) { Say "Update now pressed at $($pressTime.ToString('HH:mm:ss'))" } else { Say "Update now pressed: FAIL" }

Say "=== 6. wait for installed version to become B (up to 6 minutes)"
$installed = ReadInstalledVersion
$installSeconds = $null
$at3minVersion = $null
for ($i = 0; $i -lt 72; $i++) {
  $elapsed = ((Get-Date) - $pressTime).TotalSeconds
  Say "  poll $i/72 installed: $installed (elapsed: $([Math]::Round($elapsed, 1)) s)"
  
  # Record version at 3 minutes
  if ($elapsed -ge 180 -and $null -eq $at3minVersion) {
    $at3minVersion = $installed
    Say "  version at 3 min: $at3minVersion"
  }
  
  if ($installed -eq $bVersion) {
    $installSeconds = [Math]::Round(((Get-Date) - $pressTime).TotalSeconds, 1)
    Say "  installed after $installSeconds s"
    break
  }
  
  Start-Sleep 5
  $installed = ReadInstalledVersion
}

Say "final installed version: $installed"

# Criterion 22: installed within 3 min
if ($null -ne $installSeconds -and $installSeconds -le 180) {
  Say "criterion 22 installed within 3 min: PASS (installed after $installSeconds s)"
} elseif ($null -ne $installSeconds) {
  $at3minText = if ($null -ne $at3minVersion) { $at3minVersion } else { "not yet" }
  Say "criterion 22 installed within 3 min: FAIL (installed after $installSeconds s; at 3 min: $at3minText)"
} else {
  $at3minText = if ($null -ne $at3minVersion) { $at3minVersion } else { "not yet" }
  Say "criterion 22 installed within 3 min: FAIL (not installed within 6 min; at 3 min: $at3minText)"
}

if ($installed -eq $bVersion) { Say "criterion 22 installed eventually: PASS" } else { Say "criterion 22 installed eventually: FAIL (got '$installed', expected '$bVersion')" }

Say "=== 6a. diagnostics"
Say "sc.exe qc ScreenTime:"
foreach ($line in (sc.exe qc ScreenTime | Select-String "BINARY_PATH_NAME|START_TYPE")) { Say "  $($line.Line.Trim())" }
Say "sc.exe query ScreenTime:"
foreach ($line in (sc.exe query ScreenTime | Select-String "STATE")) { Say "  $($line.Line.Trim())" }
$svc = Get-Service ScreenTime -ErrorAction SilentlyContinue
if ($svc) { Say "Get-Service ScreenTime: $($svc.Status)" } else { Say "Get-Service ScreenTime: (no service)" }

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

$trayLog = Join-Path $env:LOCALAPPDATA "ScreenTime\tray.log"
if (Test-Path $trayLog) {
  Say "last 30 lines of ${trayLog}:"
  Get-Content $trayLog | Select-Object -Last 30 | ForEach-Object { Say "  $_" }
} else {
  Say "${trayLog} not found"
}

Say "C:\ProgramData\ScreenTime\updates contents:"
$updatesDir = "C:\ProgramData\ScreenTime\updates"
if (Test-Path $updatesDir) {
  Get-ChildItem $updatesDir | ForEach-Object { Say "  $($_.Name) $($_.Length) bytes" }
} else {
  Say "  $updatesDir not found"
}

Say "=== 7. restore service flags and restart only if no tray started"
Set-ItemProperty $serviceKey ImagePath "`"$exe`" --session 1 --dry-lock"
Say "service ImagePath: $((Get-ItemProperty $serviceKey).ImagePath)"
Say "flags restored; will restart service only if MSI did not start a tray"

# Poll for service Running and exactly one tray in session 1 (the MSI started it).
$serviceOk = $false
$trayOk = $false
$needsRestart = $false
$multiTray = $false

# Phase 1: Wait up to 90 seconds for service Running and tray count
for ($i = 0; $i -lt 3; $i++) {
  $svc = Get-Service ScreenTime -ErrorAction SilentlyContinue
  $svcState = if ($svc) { $svc.Status.ToString() } else { "(no service)" }
  $trays = @(Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'" | Where-Object { $_.SessionId -eq 1 })
  $trayCount = $trays.Count
  Say "  poll phase1 $($i+1)/3: service=$svcState, tray count in session 1 = $trayCount ($([int]((Get-Date) - $pressTime).TotalSeconds) s after Update now)"
  
  if ($trayCount -gt 1) {
    $multiTray = $true
    break
  }
  
  if ($svcState -eq "Running" -and $trayCount -eq 1) {
    $serviceOk = $true
    $trayOk = $true
    break
  }
  
  if ($svcState -eq "Running" -and $trayCount -eq 0) {
    $needsRestart = $true
  }
  
  Start-Sleep 5
}

# Phase 2: If we need a restart, do it once
if ($needsRestart -and -not $multiTray -and -not $trayOk) {
  Say "no tray from the MSI-started service; restarting once with the flags set"
  Restart-Service ScreenTime
  Say "Restart-Service completed"
  
  # Wait up to 60 seconds for exactly one tray
  for ($i = 0; $i -lt 12; $i++) {
    $svc = Get-Service ScreenTime -ErrorAction SilentlyContinue
    $svcState = if ($svc) { $svc.Status.ToString() } else { "(no service)" }
    $trays = @(Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'" | Where-Object { $_.SessionId -eq 1 })
    $trayCount = $trays.Count
    Say "  poll phase2 $($i+1)/12: service=$svcState, tray count in session 1 = $trayCount ($([int]((Get-Date) - $pressTime).TotalSeconds) s after Update now)"
    
    if ($trayCount -gt 1) {
      $multiTray = $true
      break
    }
    
    if ($svcState -eq "Running" -and $trayCount -eq 1) {
      $serviceOk = $true
      $trayOk = $true
      break
    }
    
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
Say "service command line:"
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Service.exe'")) {
  Say "  pid=$($p.ProcessId) command=$($p.CommandLine)"
}

Say "time from Update now to one tray: $([int]((Get-Date) - $pressTime).TotalSeconds) s"
if ($multiTray) {
  Say "criterion 22: FAIL (more than one tray; known CARD-061 gap)"
  Set-Content C:\out\done.txt "failed"
  Say "done"
  exit 0
}

if ($finalCount -eq 1) { Say "exactly one tray in session 1: PASS" } else { Say "exactly one tray in session 1: FAIL (count=$finalCount)" }

if (-not $serviceOk -or -not $trayOk) {
  if ($needsRestart) {
    Say "criterion 22: FAIL (no tray after restart with flags set)"
  } else {
    Say "criterion 22: FAIL (service/tray did not settle within 90 s)"
  }
  Set-Content C:\out\done.txt "failed"
  Say "done"
  exit 0
}

Say "=== 8. post-update flyout (poll until tray has received its first status/update lines)"
$expectedPost = "Version $bVersion"
$lastVl = ""
$lastCaption = ""
$settled = $false
for ($i = 1; $i -le 60; $i++) {
  $w = EnsureFlyout
  if (-not $w) {
    Say "  poll $i/60: no flyout"
    Start-Sleep 1
    continue
  }
  $vlName = Text 'VersionLink'
  $lastVl = $vlName
  $captionNow = ""
  try {
    foreach ($e in $w.FindAll("Descendants", [System.Windows.Automation.Condition]::TrueCondition)) {
      $n = $e.Current.Name
      if ($n -and -not $e.Current.IsOffscreen -and $n.StartsWith("Parent mode")) { $captionNow = $n; break }
    }
  } catch { }
  $lastCaption = $captionNow
  $vlOk = ($vlName -eq $expectedPost)
  $pmOk = ($captionNow -ne "")
  Say "  poll $i/60: VersionLink='$vlName', parentMode='$captionNow', settled=$($vlOk -and $pmOk)"
  if ($vlOk -and $pmOk) { $settled = $true; break }
  Start-Sleep 1
}
if (-not $settled) {
  Say "criterion 22: FAIL (tray never settled within 60 s; last VersionLink='$lastVl', last parentMode='$lastCaption')"
  Set-Content C:\out\done.txt "failed"
  Say "done"
  exit 0
}

$vlPost = $lastVl
if ($vlPost -eq $expectedPost) { Say "criterion 22 VersionLink after update: PASS ('$vlPost')" } else { Say "criterion 22 VersionLink after update: FAIL (got '$vlPost', expected '$expectedPost')" }

# Capture parent-mode caption and sublines post-update.
$capturedPost = ""
$endPost = ""
$w = Flyout
if ($w) {
  try {
    foreach ($e in $w.FindAll("Descendants", [System.Windows.Automation.Condition]::TrueCondition)) {
      $n = $e.Current.Name
      if (-not $n) { continue }
      if ($e.Current.IsOffscreen) { continue }
      $aid = $e.Current.AutomationId
      $show = $false
      if ($n -eq "Time isn't counting") { $show = $true; $tag = "footer" }
      elseif ($n -eq "Not synced yet" -or $n -eq "Synced") { $show = $true; $tag = "sync" }
      elseif ($n.StartsWith("Parent mode")) { $show = $true; $tag = "caption" }
      elseif ($n.StartsWith("Version ")) { $show = $true; $tag = "version" }
      if ($show) {
        Say "  $tag`: $n (id=$aid)"
        if ($tag -eq "caption") {
          $capturedPost = $n
          if ($n -match 'ends\s+(.+)$') { $endPost = $Matches[1].Trim() }
        }
      }
    }
  } catch { Say "  caption walk failed: $($_.Exception.Message)" }
}
if ($capturedPost -and $endText -and ($endPost -eq $endText)) { Say "criterion 22 parent mode end time preserved: PASS ('$endText')" }
elseif ($capturedPost) { Say "criterion 22 parent mode end time preserved: FAIL (was '$endText', now '$endPost')" }
else { Say "criterion 22 parent mode still on: FAIL (no caption seen)" }

Set-Content C:\out\done.txt "done"
Say "done"
