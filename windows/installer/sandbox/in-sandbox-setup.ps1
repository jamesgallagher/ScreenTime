# Runs inside Windows Sandbox at logon (as its administrator, WDAGUtilityAccount). Makes two kid accounts (alex and
# sam, standard) and a parent account (parent, administrator), installs the MSI from C:\in, opens "Screen Time Setup"
# the way the Start menu does and drives it through UI Automation: a wrong address, the server, the accounts before
# sign-in, "Have a code instead?" with a wrong code and Alex's code, then a parent's sign-in (a wrong emailed code, then
# the real one, which the host reads from the dev server's log and drops in C:\out\otp.txt) and Sam picked for sam,
# Finish, and the window again. Then it uninstalls and shuts the Sandbox down. Everything it sees goes to
# C:\out\results.txt.
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results $text -Encoding UTF8 }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
function Window { $A::RootElement.FindFirst("Children", (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, "Screen Time setup"))) }
function El([string]$id) {
  $w = Window
  if (-not $w) { return $null }
  $w.FindFirst("Descendants", (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, $id)))
}
function Text([string]$id) { $e = El $id; if ($e) { $e.Current.Name } else { "(none)" } }
function SetText([string]$id, [string]$value) { (El $id).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($value); Start-Sleep -Milliseconds 500 }
function Press([string]$id) { (El $id).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
# Opens the picker, selects the item with that name, and closes it again.
function Pick([string]$id, [string]$item) {
  $box = El $id
  $box.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
  Start-Sleep -Milliseconds 800
  $found = (Window).FindFirst("Descendants", (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $item)))
  $found.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
  Start-Sleep -Milliseconds 300
  try { $box.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Collapse() } catch { }
  Start-Sleep -Milliseconds 500
}
# Waits until the element's text passes the test (at most $seconds), and returns that text.
function WaitText([string]$id, [scriptblock]$done, [int]$seconds = 60) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    $t = Text $id
    if (& $done $t) { return $t }
    Start-Sleep -Milliseconds 500
  }
  "(timed out) $t"
}
function Rows {
  foreach ($e in (Window).FindAll("Descendants", [System.Windows.Automation.Condition]::TrueCondition)) {
    $id = $e.Current.AutomationId
    if ($id -like "State_*") { Say "  $($id.Substring(6)): $($e.Current.Name)" }
    if ($id -like "Code_*") { Say "  $($id.Substring(5)): a code box" }
    if ($id -like "Kid_*") {
      $picked = $e.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern).Current.GetSelection() | ForEach-Object { $_.Current.Name }
      Say "  $($id.Substring(4)): a kid picker on '$picked'"
    }
    if ($id -like "Change_*") { Say "  $($id.Substring(7)): a '$($e.Current.Name)' link" }
  }
}

Set-Content $results "sandbox run at $(Get-Date -Format o) as $(whoami)" -Encoding UTF8
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop

Say "=== 1. three accounts, and the install"
foreach ($line in @(net user sam "Kid-pass-52b!" /add 2>&1) + @(net user alex "Kid-pass-52c!" /add 2>&1) + @(net user parent "Parent-52b!" /add 2>&1) + @(net localgroup Administrators parent /add 2>&1)) { if ("$line".Trim()) { Say "  net: $line" } }
Say "  administrators: $((net localgroup Administrators | Select-Object -Skip 6 | Where-Object { $_ -and $_ -notlike 'The command*' }) -join ', ')"
$code = (Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru).ExitCode
Say "  msiexec install exit $code"
$lnk = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Screen Time Setup.lnk"
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
Say "  shortcut: $(Test-Path $lnk), $($shortcut.TargetPath) $($shortcut.Arguments)"

Say "=== 2. open Screen Time Setup"
Start-Process $shortcut.TargetPath -ArgumentList $shortcut.Arguments
for ($i = 0; $i -lt 60 -and -not (Window); $i++) { Start-Sleep 1 }
Say "  window: $(if (Window) { 'open' } else { 'never opened' })"
Say "  server box: '$((El 'ServerBox').GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value)'"
Say "  Finish enabled: $((El 'FinishButton').Current.IsEnabled)"

Say "=== 3. a wrong address, then the server"
SetText "ServerBox" "http://${gateway}:9"
Press "CheckButton"
Say "  :9 -> $(WaitText 'ServerStatus' { param($t) $t -notlike 'Checking*' -and $t -notlike 'The address*' })"
SetText "ServerBox" "http://${gateway}:8080"
Press "CheckButton"
Say "  :8080 -> $(WaitText 'ServerStatus' { param($t) $t -notlike 'Checking*' -and $t -notlike 'Press Check*' })"

Say "=== 4. the accounts, before anyone signs in"
Start-Sleep 2
Rows
Say "  sign-in: $(Text 'SignInStatus')"

Say "=== 5. Have a code instead? A wrong code, then Alex's code"
Press "CodeModeLink"
Start-Sleep 1
Say "  sign-in: $(Text 'SignInStatus')"
SetText "Code_alex" "000000"
Press "Connect_alex"
Say "  000000 -> $(WaitText 'Error_alex' { param($t) $t -ne '' -and $t -ne '(none)' })"
SetText "Code_alex" ((Get-Content C:\in\code.txt).Trim())
Press "Connect_alex"
Say "  Alex's code -> $(WaitText 'State_alex' { param($t) $t -ne '(none)' })"
Press "CodeModeLink"
Start-Sleep 1

Say "=== 6. sign in as a parent: a wrong code, then the emailed one"
SetText "EmailBox" "dad@example.com"
Press "SendCodeButton"
Say "  email -> $(WaitText 'SignInStatus' { param($t) $t -notlike 'Sending*' -and $t -notlike 'Use the email*' })"
Set-Content C:\out\otp-wanted.txt "dad@example.com" -Encoding UTF8
SetText "SignInCodeBox" "000000"
Press "SignInButton"
Say "  000000 -> $(WaitText 'SignInStatus' { param($t) $t -notlike 'Signing in*' -and $t -notlike 'We emailed*' })"
for ($i = 0; $i -lt 60 -and -not (Test-Path C:\out\otp.txt); $i++) { Start-Sleep 1 }
SetText "SignInCodeBox" ((Get-Content C:\out\otp.txt).Trim())
Press "SignInButton"
Say "  emailed code -> $(WaitText 'SignInStatus' { param($t) $t -notlike 'Signing in*' -and $t -notlike 'That code*' })"
Start-Sleep 1
Rows

Say "=== 7. pick Sam for sam"
Pick "Kid_sam" "Sam"
Press "Connect_sam"
Say "  Sam -> $(WaitText 'State_sam' { param($t) $t -ne '(none)' })"
Say "  Finish enabled: $((El 'FinishButton').Current.IsEnabled)"

Say "=== 8. Finish"
$before = (Get-CimInstance Win32_Service -Filter "Name = 'ScreenTime'").ProcessId
Press "FinishButton"
Say "  $(WaitText 'FinishStatus' { param($t) $t -notlike 'Starting*' -and $t -notlike 'The limits*' })"
$after = (Get-CimInstance Win32_Service -Filter "Name = 'ScreenTime'")
Say "  service: $($after.State), restarted: $($after.ProcessId -ne $before)"
Say "  config.json: $((Get-Content C:\ProgramData\ScreenTime\config.json -Raw).Trim())"
Say "  sign-in: $(Text 'SignInStatus')"
Say "  button: $((El 'FinishButton').Current.Name)"
Press "FinishButton"
for ($i = 0; $i -lt 20 -and (Window); $i++) { Start-Sleep 1 }
Say "  window closed: $(-not (Window))"

Say "=== 9. open it again"
Start-Process $shortcut.TargetPath -ArgumentList $shortcut.Arguments
for ($i = 0; $i -lt 60 -and -not (Window); $i++) { Start-Sleep 1 }
Say "  server box: '$((El 'ServerBox').GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value)'"
Say "  $(WaitText 'ServerStatus' { param($t) $t -notlike 'Checking*' -and $t -notlike 'The address*' })"
Start-Sleep 2
Rows
(Window).GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
Start-Sleep 2
Say "  window closed: $(-not (Window))"
foreach ($e in (Get-WinEvent -FilterHashtable @{ LogName = "Application"; Level = 1, 2 } -MaxEvents 5 -ErrorAction SilentlyContinue)) {
  $text = $e.Message -replace '\s+', ' '
  if ($e.ProviderName -ne "Microsoft-Windows-Security-SPP") { Say "  error event: $($e.ProviderName): $($text.Substring(0, [Math]::Min(300, $text.Length)))" }
}

Say "=== 10. uninstall"
$code = (Start-Process msiexec.exe -ArgumentList @("/x", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\uninstall.log") -Wait -PassThru).ExitCode
Say "  msiexec uninstall exit $code"
Say "  shortcut still there: $(Test-Path $lnk)"
Say "  files still there: $(Test-Path 'C:\Program Files\ScreenTime')"
Say "done"
Stop-Computer -Force
