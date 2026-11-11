# Runs inside Windows Sandbox at logon (as its administrator, WDAGUtilityAccount). Clicks through the MSI's pages the
# way a parent does, with UI Automation, and saves a picture of each page in C:\out:
#   1. a new install: Welcome, Ready, progress, "Screen Time is installed"; Finish with the box ticked opens the setup window
#   2. an update over the older MSI (C:\in\ScreenTime-old.msi, installed silently): the box starts unticked
#   3. removing it from the MSI: Repair or Remove, then "Screen Time is removed"
#   4. a failed install (sc.exe made to fail, so the Recovery custom action fails): the error, then "did not finish"
# Then it shuts the Sandbox down. Everything it sees goes to C:\out\results.txt.
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results $text -Encoding UTF8 }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type -Namespace W -Name U -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr SendMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int GetWindowLong(System.IntPtr h, int i);
'@
[W.U]::SetProcessDPIAware() | Out-Null
$A = [System.Windows.Automation.AutomationElement]
$msi = "C:\in\ScreenTime.msi"
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"

# The installer's top-level windows ("Screen Time Setup") that show a control with this name.
function Page([string]$name) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, "Screen Time Setup")
  foreach ($w in $A::RootElement.FindAll("Children", $cond)) {
    if (Find $w $name) { return $w }
  }
  $null
}
# MSI's controls are plain Win32 windows: UI Automation finds them, but they have no patterns, so the window styles
# say what is visible, disabled or ticked, and BM_CLICK presses a button.
function Style($e) { [W.U]::GetWindowLong([IntPtr]$e.Current.NativeWindowHandle, -16) }
function Visible($e) { (Style $e) -band 0x10000000 }
function Find($win, [string]$name) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $name)
  foreach ($e in $win.FindAll("Descendants", $cond)) { if (Visible $e) { return $e } }
  $null
}
function WaitPage([string]$name, [int]$seconds = 120) {
  for ($i = 0; $i -lt $seconds * 2; $i++) { $w = Page $name; if ($w) { Start-Sleep -Milliseconds 700; return $w }; Start-Sleep -Milliseconds 500 }
  Say "  (no page with '$name' after $seconds s)"
  $null
}
function Shot($win, [string]$file) {
  [W.U]::SetForegroundWindow([IntPtr]$win.Current.NativeWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 400
  $r = $win.Current.BoundingRectangle
  $bmp = New-Object System.Drawing.Bitmap ([int]$r.Width), ([int]$r.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size)
  $bmp.Save("C:\out\$file", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Say "  picture: $file"
}
# Every visible text, button and box on the page, so results.txt says what the picture shows.
function Texts($win) {
  foreach ($e in $win.FindAll("Descendants", [System.Windows.Automation.Condition]::TrueCondition)) {
    $c = $e.Current
    $style = Style $e
    if (-not ($style -band 0x10000000) -or -not $c.Name) { continue }
    if ($c.ClassName -eq "Static" -and ($style -band 0xF) -ne 0xE -and ($style -band 0xF) -ne 0x3) { Say "  text: $($c.Name -replace '\s+', ' ')" }
    elseif ($c.ClassName -eq "Button" -and @(2, 3, 5, 6) -contains ($style -band 0xF)) {
      $checked = [W.U]::SendMessage([IntPtr]$c.NativeWindowHandle, 0xF0, [IntPtr]::Zero, [IntPtr]::Zero)
      Say "  checkbox: $($c.Name) = $(if ($checked -eq 1) { 'ticked' } else { 'not ticked' })"
    }
    elseif ($c.ClassName -eq "Button") { Say "  button: $($c.Name)$(if ($style -band 0x08000000) { ' (disabled)' })" }
  }
}
function Press($win, [string]$name) {
  $b = Find $win $name
  if (-not $b) { Say "  (no '$name' button)"; return }
  [W.U]::PostMessage([IntPtr]$b.Current.NativeWindowHandle, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  Say "  pressed $name"
}
function Msiexec([string[]]$arguments) { Start-Process msiexec.exe -ArgumentList $arguments -PassThru }
function Silent([string[]]$arguments) { (Start-Process msiexec.exe -ArgumentList $arguments -Wait -PassThru).ExitCode }
function Installed {
  $keys = Get-ChildItem HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall, HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall -ErrorAction SilentlyContinue
  $found = @($keys | Get-ItemProperty | Where-Object DisplayName -eq "Screen Time" | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)" })
  if ($found.Count) { $found -join "; " } else { "(none)" }
}
function ServiceState { $s = Get-Service ScreenTime -ErrorAction SilentlyContinue; if ($s) { "$($s.Status), $($s.StartType)" } else { "(no service)" } }
function SetupProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'" | Where-Object CommandLine -like "*--setup*")
}
function TimeZoneRight { secedit /export /cfg C:\out\secpol.inf /areas USER_RIGHTS | Out-Null; (Get-Content C:\out\secpol.inf | Select-String "SeTimeZonePrivilege").Line }

Set-Content $results "sandbox run at $(Get-Date -Format o) as $(whoami)" -Encoding UTF8
Say "MSI: $((Get-Item $msi).Length) bytes; older MSI: $((Get-Item C:\in\ScreenTime-old.msi).Length) bytes"

Say "=== 1. a new install"
$p = Msiexec @("/i", $msi, "/l*v", "C:\out\1-install.log")
$w = WaitPage "Next"; Texts $w; Shot $w "1-welcome.png"; Press $w "Next"
$w = WaitPage "Install"; Texts $w; Shot $w "2-ready.png"; Press $w "Install"
$progressShot = $false
for ($i = 0; $i -lt 240; $i++) {
  if (-not $progressShot) { $w = Page "Installing Screen Time"; if ($w) { Start-Sleep 2; Texts $w; Shot $w "3-progress.png"; $progressShot = $true } }
  if (Page "Finish") { break }
  Start-Sleep -Milliseconds 500
}
$w = WaitPage "Finish"; Texts $w; Shot $w "4-finished.png"
Say "  installed: $(Installed); service: $(ServiceState)"
Press $w "Finish"
$p.WaitForExit(60000) | Out-Null
Say "  msiexec exit $($p.ExitCode)"
$setup = $null
for ($i = 0; $i -lt 60 -and -not $setup; $i++) {
  Start-Sleep 1
  $setup = $A::RootElement.FindFirst("Children", (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, "Screen Time setup")))
}
foreach ($s in SetupProcesses) { Say "  setup process: $($s.CommandLine)" }
if ($setup) { Start-Sleep 3; Shot $setup "5-setup-window.png" } else { Say "  (no setup window after 60 s)" }
Stop-Process -Name ScreenTime.Tray -Force -ErrorAction SilentlyContinue
Say "  Safe Mode keys: $(Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\Minimal\ScreenTime') $(Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\Network\ScreenTime')"
foreach ($line in (sc.exe qfailure ScreenTime | Select-String "RESET_PERIOD|RESTART")) { Say "  $($line.Line.Trim())" }
Say "  $(TimeZoneRight)"
Say "  silent uninstall exit $(Silent @('/x', $msi, '/qn', '/l*v', 'C:\out\1-uninstall.log')); installed: $(Installed)"

Say "=== 2. an update over the older MSI"
Say "  silent install of the older MSI exit $(Silent @('/i', 'C:\in\ScreenTime-old.msi', '/qn', '/l*v', 'C:\out\2-old.log')); installed: $(Installed); service: $(ServiceState)"
$p = Msiexec @("/i", $msi, "/l*v", "C:\out\2-update.log")
$w = WaitPage "Next"; Press $w "Next"
$w = WaitPage "Install"; Press $w "Install"
$w = WaitPage "Finish" 300; Texts $w; Shot $w "6-updated.png"
Press $w "Finish"
$p.WaitForExit(60000) | Out-Null
Say "  msiexec exit $($p.ExitCode); installed: $(Installed); service: $(ServiceState)"
Start-Sleep 10
Say "  setup processes after Finish: $((SetupProcesses).Count)"

Say "=== 3. removing it from the MSI"
$p = Msiexec @("/i", $msi, "/l*v", "C:\out\3-remove.log")
$w = WaitPage "Next"; Texts $w; Press $w "Next"
$w = WaitPage "Repair"; Texts $w; Press $w "Remove"
$w = WaitPage "Ready to remove Screen Time"; Press $w "Remove"
$w = WaitPage "Finish" 300; Texts $w; Shot $w "7-removed.png"
Press $w "Finish"
$p.WaitForExit(60000) | Out-Null
Say "  msiexec exit $($p.ExitCode); installed: $(Installed); service: $(ServiceState); files: $(Test-Path 'C:\Program Files\ScreenTime')"
Say "  $(TimeZoneRight)"

Say "=== 4. a failed install (sc.exe made to fail)"
$ifeo = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\sc.exe"
New-Item $ifeo -Force | Out-Null
Set-ItemProperty $ifeo Debugger "C:\no-such-folder\no-such.exe"
$p = Msiexec @("/i", $msi, "/l*v", "C:\out\4-failed.log")
$w = WaitPage "Next"; Press $w "Next"
$w = WaitPage "Install"; Press $w "Install"
$w = WaitPage "OK" 300; if ($w) { Texts $w; Shot $w "8-error.png"; Press $w "OK" }
$w = WaitPage "Finish" 300; Texts $w; Shot $w "9-did-not-finish.png"
Press $w "Finish"
$p.WaitForExit(60000) | Out-Null
Remove-Item $ifeo -Force
Say "  msiexec exit $($p.ExitCode); installed: $(Installed); service: $(ServiceState); files: $(Test-Path 'C:\Program Files\ScreenTime')"
Say "  Safe Mode keys: $(Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\Minimal\ScreenTime')"
Say "  $(TimeZoneRight)"
foreach ($line in (Select-String -Path C:\out\4-failed.log -Pattern "Error 17\d\d|Return value 3" | Select-Object -First 3)) { Say "  log: $($line.Line.Trim())" }

Say "done"
Stop-Computer -Force
