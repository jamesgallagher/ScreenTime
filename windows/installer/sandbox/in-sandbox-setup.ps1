# CARD-052b: runs inside Windows Sandbox at logon (as its administrator, WDAGUtilityAccount). Makes a kid account (sam,
# standard) and a parent account (parent, administrator), installs the MSI from C:\in, opens "Screen Time Setup" the
# way the Start menu does and drives it through UI Automation: a wrong address, the server, the accounts, a wrong code,
# Sam's code, Finish, and the window again. Then it uninstalls and shuts the Sandbox down. Everything it sees goes to
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
  }
}

Set-Content $results "sandbox run at $(Get-Date -Format o) as $(whoami)" -Encoding UTF8
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop

Say "=== 1. two accounts, and the install"
foreach ($line in @(net user sam "Kid-pass-52b!" /add 2>&1) + @(net user parent "Parent-52b!" /add 2>&1) + @(net localgroup Administrators parent /add 2>&1)) { if ("$line".Trim()) { Say "  net: $line" } }
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

Say "=== 4. the accounts"
Start-Sleep 2
Rows

Say "=== 5. a wrong code, then Sam's code"
SetText "Code_sam" "000000"
Press "Connect_sam"
Say "  000000 -> $(WaitText 'Error_sam' { param($t) $t -ne '' -and $t -ne '(none)' })"
$enrolCode = (Get-Content C:\in\code.txt).Trim()
SetText "Code_sam" $enrolCode
Press "Connect_sam"
Say "  Sam's code -> $(WaitText 'State_sam' { param($t) $t -ne '(none)' })"
Say "  Finish enabled: $((El 'FinishButton').Current.IsEnabled)"

Say "=== 6. Finish"
$before = (Get-CimInstance Win32_Service -Filter "Name = 'ScreenTime'").ProcessId
Press "FinishButton"
Say "  $(WaitText 'FinishStatus' { param($t) $t -notlike 'Starting*' -and $t -notlike 'The limits*' })"
$after = (Get-CimInstance Win32_Service -Filter "Name = 'ScreenTime'")
Say "  service: $($after.State), restarted: $($after.ProcessId -ne $before)"
Say "  config.json: $((Get-Content C:\ProgramData\ScreenTime\config.json -Raw).Trim())"
Say "  button: $((El 'FinishButton').Current.Name)"
Press "FinishButton"
for ($i = 0; $i -lt 20 -and (Window); $i++) { Start-Sleep 1 }
Say "  window closed: $(-not (Window))"

Say "=== 7. open it again"
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

Say "=== 8. uninstall"
$code = (Start-Process msiexec.exe -ArgumentList @("/x", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\uninstall.log") -Wait -PassThru).ExitCode
Say "  msiexec uninstall exit $code"
Say "  shortcut still there: $(Test-Path $lnk)"
Say "  files still there: $(Test-Path 'C:\Program Files\ScreenTime')"
Say "done"
Stop-Computer -Force
