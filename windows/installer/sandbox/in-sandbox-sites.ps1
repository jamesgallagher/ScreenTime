# Runs inside Windows Sandbox at each logon (as WDAGUtilityAccount), for Test-Sites.ps1. Installs the MSI,
# enrols as Sam, checks the browser policies and the DNS log, opens Edge on three pages keeping each in front
# for the card's seconds, then closes Edge and waits for the host's go-ahead. Everything goes to C:\out.
# Every line of results.txt starts with the time (so the host never anchors on the line start).
$results = "C:\out\results.txt"
$failed = 0
function Say([string]$text) { Add-Content $results "$(Get-Date -Format HH:mm:ss) $text" }
function Check([bool]$ok, [string]$msg) {
    if ($ok) { Say "ok: $msg" } else { Say "FAILED: $msg"; $script:failed++ }
}
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"

Set-Content $results "sandbox run at $(Get-Date -Format o) as $(whoami), session $((Get-Process -Id $PID).SessionId)"

# P/Invoke for window management
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string lpszClass, string lpszWindow);
}
"@

# The current front window's title if it is an Edge window (Edge's windows are Chrome_WidgetWin_*); when it
# is not, bring the first Edge window to the front and read it. Null when there is no Edge window.
function Read-EdgeFrontTitle {
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $hwnd = [Win32]::GetForegroundWindow()
        if ($hwnd -ne [IntPtr]::Zero) {
            $cls = New-Object System.Text.StringBuilder(256)
            [Win32]::GetClassName($hwnd, $cls, 256) | Out-Null
            if ($cls.ToString() -like "Chrome_WidgetWin_*") {
                $t = New-Object System.Text.StringBuilder(4096)
                [Win32]::GetWindowText($hwnd, $t, 4096) | Out-Null
                return $t.ToString()
            }
        }
        Start-Sleep 1
    }
    $hwnd = [IntPtr]::Zero
    while (($hwnd = [Win32]::FindWindowEx([IntPtr]::Zero, $hwnd, $null, $null)) -ne [IntPtr]::Zero) {
        $cls = New-Object System.Text.StringBuilder(256)
        [Win32]::GetClassName($hwnd, $cls, 256) | Out-Null
        if ($cls.ToString() -like "Chrome_WidgetWin_*") {
            [Win32]::SetForegroundWindow($hwnd) | Out-Null
            Start-Sleep 1
            $t = New-Object System.Text.StringBuilder(4096)
            [Win32]::GetWindowText($hwnd, $t, 4096) | Out-Null
            return $t.ToString()
        }
    }
    $null
}

# Prints the front window's title; when there is no Edge window in front it names the front window's class and
# pid, so it is clear whether Edge was not in front or the title read failed.
function Say-Front {
    $title = Read-EdgeFrontTitle
    if ($title) { Say "  front: $title"; return }
    $hwnd = [Win32]::GetForegroundWindow()
    $cls = New-Object System.Text.StringBuilder(256)
    [Win32]::GetClassName($hwnd, $cls, 256) | Out-Null
    $pid32 = 0
    [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid32) | Out-Null
    $proc = $null
    try { $proc = (Get-Process -Id $pid32 -ErrorAction Stop).ProcessName } catch {}
    Say "  front: (none) front window class=$($cls) pid=$pid32 proc=$proc"
    if (Get-Process msedge -ErrorAction SilentlyContinue) { Say "  (msedge IS running: $((Get-Process msedge).Count) process(es))" }
    else { Say "  (msedge is NOT running)" }
}

function Value-Exists([string]$key, [string]$name) {
    $k = Get-ItemProperty $key -ErrorAction SilentlyContinue
    if ($k -eq $null) { return $false }
    return ($k.PSObject.Properties[$name] -ne $null)
}

Say "=== 1. install and enrol as Sam"
$code = (Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru).ExitCode
Check ($code -eq 0) "msiexec install exit $code"
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop
$out = & $exe enrol --server "http://${gateway}:8080" --code (Get-Content C:\in\code.txt).Trim() --user $env:USERNAME 2>&1
Say "  enrol: $out"
# No console session in the Sandbox: the service is pointed at this one (as Test-Programs.ps1 does).
$session = (Get-Process -Id $PID).SessionId
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime" ImagePath "`"$exe`" --session $session --dry-lock"
Restart-Service ScreenTime
$waited = 0
while (-not (Get-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue) -and $waited -lt 90) { Start-Sleep 2; $waited += 2 }
Check ((Get-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue) -ne $null) "tray running"

# The service's warnings/errors go to the Application event log (its info lines go nowhere); the event text
# names the error. Give the service a moment, then dump every ScreenTime event to C:\out.
Start-Sleep 10
Say "=== service events (Application log, source ScreenTime)"
$evts = $null
try { $evts = Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='ScreenTime'} -ErrorAction Stop } catch {}
if ($evts) {
    foreach ($e in ($evts | Sort-Object TimeCreated)) { Say "  $($e.TimeCreated.ToString('HH:mm:ss')) [$($e.LevelDisplayName)] $($e.Message)" }
} else { Say "  (no ScreenTime events in the Application log)" }

Say "=== 2. check the browser policies (Get-ItemProperty) and the DNS log"
# A full "HKLM\..." path passed to Registry.LocalMachine would create a key literally named "HKLM" under HKLM;
# confirm there is no such stray key (there should not be, now the paths are relative).
Say "  HKLM:\HKLM stray key present: $(Test-Path 'HKLM:\HKLM')"
$edge = Get-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Edge" -ErrorAction SilentlyContinue
$edgeBlock = Get-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallBlocklist" -ErrorAction SilentlyContinue
Check (($edge -and $edge.DnsOverHttpsMode -eq "off" -and $edge.BuiltInDnsClientEnabled -eq 0 -and ($edgeBlock -and $edgeBlock."1" -eq "*"))) "edge policies"
$chrome = Get-ItemProperty "HKLM:\SOFTWARE\Policies\Google\Chrome" -ErrorAction SilentlyContinue
$chromeBlock = Get-ItemProperty "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist" -ErrorAction SilentlyContinue
Check (($chrome -and $chrome.DnsOverHttpsMode -eq "off" -and $chrome.BuiltInDnsClientEnabled -eq 0 -and ($chromeBlock -and $chromeBlock."1" -eq "*"))) "chrome policies"
$brave = Get-ItemProperty "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave" -ErrorAction SilentlyContinue
$braveBlock = Get-ItemProperty "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave\ExtensionInstallBlocklist" -ErrorAction SilentlyContinue
Check (($brave -and $brave.DnsOverHttpsMode -eq "off" -and $brave.BuiltInDnsClientEnabled -eq 0 -and ($braveBlock -and $braveBlock."1" -eq "*") -and $brave.TorDisabled -eq 1)) "brave policies"
$firefox = Get-ItemProperty "HKLM:\SOFTWARE\Policies\Mozilla\Firefox" -ErrorAction SilentlyContinue
$firefoxDoh = Get-ItemProperty "HKLM:\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS" -ErrorAction SilentlyContinue
Check (($firefox -and $firefoxDoh -and $firefoxDoh.Enabled -eq 0 -and $firefoxDoh.Locked -eq 1 -and $firefox.ExtensionSettings -eq '{"*":{"installation_mode":"blocked"}}')) "firefox policies"
$gl = (wevtutil gl "Microsoft-Windows-DNS-Client/Operational" 2>&1 | Out-String).Trim()
Check ($gl -match '(?i)enabled:\s*true') "dns log on"
Say "  dns log: $(($gl -split "[`r`n]+") | Where-Object { $_ -match '(?i)enabled' } | Select-Object -First 1)"
$harden = (& $exe harden-check 2>&1 | Out-String).Trim()
Say "  harden-check: $harden"

Say "=== 3. Edge: three pages, each kept in front"
# Test-only setup (the service does not set these, and they do not touch DNS), as Claude's spike did.
Set-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Edge" -Name HideFirstRunExperience -Value 1 -Type DWord
Set-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Edge" -Name SyncDisabled -Value 1 -Type DWord
$msedge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$p1 = Start-Process $msedge -ArgumentList @("--no-first-run", "https://www.wikipedia.org/") -PassThru
Start-Sleep 8
Say-Front
Start-Sleep 20
Stop-Process -Id $p1.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 3
$p2 = Start-Process $msedge -ArgumentList @("--inprivate", "https://www.abc.net.au/") -PassThru
Start-Sleep 8
Say-Front
Start-Sleep 30
Stop-Process -Id $p2.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 3
$p3 = Start-Process $msedge -ArgumentList @("--inprivate", "https://www.bing.com/search?q=how+to+draw") -PassThru
Start-Sleep 8
Say-Front
Start-Sleep 20

Say "=== 4. close every Edge process started in this Sandbox"
Get-Process msedge -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep 3
# What the DNS log actually saw (event 3008): the lookups, with the account and the process.
Say "  dns 3008 events (Microsoft-Windows-DNS-Client/Operational)"
$dns = $null
try { $dns = Get-WinEvent -LogName "Microsoft-Windows-DNS-Client/Operational" -ErrorAction Stop } catch {}
if ($dns) {
    $kept = @()
    foreach ($e in $dns) {
        if ($e.Id -eq 3008) {
            # EventLogRecord.Properties have no names, so read the event's XML (as Claude's spike did).
            $xml = [xml]$e.ToXml()
            $user = $xml.Event.System.Security.UserID
            $proc = $xml.Event.System.Execution.ProcessID
            $query = ($xml.Event.EventData.Data | Where-Object { $_.Name -eq 'QueryName' }).'#text'
            $kept += "  $($e.TimeCreated.ToString('HH:mm:ss')) user=$user proc=$proc query=$query"
        }
    }
    if ($kept.Count -eq 0) { Say "  (no 3008 events)" } else { $kept | ForEach-Object { Say $_ } }
} else { Say "  (could not read the dns log)" }
# Bring the service's local store out of the Sandbox (one copy right after Edge is
# closed; a later copy is taken just before the uninstall, in step 6). state.db is in WAL mode, so the -wal and
# -shm side files go too, or the copied db looks empty.
$db = "C:\ProgramData\ScreenTime\state.db"
if (Test-Path $db) {
    Copy-Item $db "C:\out\state4.db"
    Copy-Item "$db-wal" "C:\out\state4.db-wal" -ErrorAction SilentlyContinue
    Copy-Item "$db-shm" "C:\out\state4.db-shm" -ErrorAction SilentlyContinue
}
Say "  state.db copied: $(Test-Path C:\out\state4.db)"
Say "=== 5. waiting for the host"
$waited = 0
while (-not (Test-Path "C:\in\stop.txt") -and $waited -lt 240) { Start-Sleep 5; $waited += 5 }
if (-not (Test-Path "C:\in\stop.txt")) { Check $false "no go-ahead from the host after 240 s" }

Say "=== 6. uninstall and check the policies are gone"
$db = "C:\ProgramData\ScreenTime\state.db"
if (Test-Path $db) {
    Copy-Item $db "C:\out\state6.db"
    Copy-Item "$db-wal" "C:\out\state6.db-wal" -ErrorAction SilentlyContinue
    Copy-Item "$db-shm" "C:\out\state6.db-shm" -ErrorAction SilentlyContinue
}
$code = (Start-Process msiexec.exe -ArgumentList @("/x", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\uninstall.log") -Wait -PassThru).ExitCode
Check ($code -eq 0) "msiexec uninstall exit $code"
$left = @()
if (Value-Exists "HKLM:\SOFTWARE\Policies\Microsoft\Edge" "DnsOverHttpsMode") { $left += "Edge:DnsOverHttpsMode" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\Microsoft\Edge" "BuiltInDnsClientEnabled") { $left += "Edge:BuiltInDnsClientEnabled" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallBlocklist" "1") { $left += "Edge:ExtensionInstallBlocklist\1" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\Google\Chrome" "DnsOverHttpsMode") { $left += "Chrome:DnsOverHttpsMode" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\Google\Chrome" "BuiltInDnsClientEnabled") { $left += "Chrome:BuiltInDnsClientEnabled" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist" "1") { $left += "Chrome:ExtensionInstallBlocklist\1" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave" "DnsOverHttpsMode") { $left += "Brave:DnsOverHttpsMode" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave" "BuiltInDnsClientEnabled") { $left += "Brave:BuiltInDnsClientEnabled" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave\ExtensionInstallBlocklist" "1") { $left += "Brave:ExtensionInstallBlocklist\1" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave" "TorDisabled") { $left += "Brave:TorDisabled" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS" "Enabled") { $left += "Firefox:DNSOverHTTPS\Enabled" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS" "Locked") { $left += "Firefox:DNSOverHTTPS\Locked" }
if (Value-Exists "HKLM:\SOFTWARE\Policies\Mozilla\Firefox" "ExtensionSettings") { $left += "Firefox:ExtensionSettings" }
if ($left.Count -eq 0) { Check $true "policies removed" } else { Check $false "policies left: $($left -join ', ')" }

Say "=== done: $failed failed"
Stop-Computer -Force
