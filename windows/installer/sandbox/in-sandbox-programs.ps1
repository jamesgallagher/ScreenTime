# Runs inside Windows Sandbox at each logon (as WDAGUtilityAccount), for Test-Programs.ps1. Installs the MSI,
# enrols as Sam, opens Notepad and Character Map, waits for the tray to see them and the service to sync, then
# prints the service's front lines and the programs line. Everything goes to C:\out.
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results "$(Get-Date -Format HH:mm:ss) $text" }
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
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string lpszClass, string lpszWindow);
}
"@

function Get-Front {
    $hwnd = [Win32]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    $pid32 = 0
    [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid32) | Out-Null
    $cls = New-Object System.Text.StringBuilder(256)
    [Win32]::GetClassName($hwnd, $cls, 256) | Out-Null
    $exePath = $null
    try { $exePath = (Get-Process -Id $pid32 -ErrorAction Stop).Path } catch {}
    @{ Hwnd = $hwnd; Pid = $pid32; Class = $cls.ToString(); Exe = $exePath }
}

function BringToFront([uint32]$procId) {
    # Find the main window of the process
    $hwnd = [IntPtr]::Zero
    while (($hwnd = [Win32]::FindWindowEx([IntPtr]::Zero, $hwnd, $null, $null)) -ne [IntPtr]::Zero) {
        $wPid = 0
        [Win32]::GetWindowThreadProcessId($hwnd, [ref]$wPid) | Out-Null
        if ($wPid -eq $procId) {
            [Win32]::SetForegroundWindow($hwnd) | Out-Null
            return $true
        }
    }
    $false
}

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
while (-not (Get-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue) -and $waited -lt 60) { Start-Sleep 2; $waited += 2 }
Say "ok: tray running"

Say "=== 2. start Notepad and keep it in front 90 s"
$notepad = Start-Process notepad.exe -PassThru
Start-Sleep 3
BringToFront $notepad.Id | Out-Null
Start-Sleep 2
$front = Get-Front
if ($front -and ($front.Pid -eq $notepad.Id -or ($front.Exe -and $front.Exe -like "*notepad*"))) {
    Say "ok: Notepad in front"
} else {
    Say "  front is pid $($front.Pid) class $($front.Class) exe $($front.Exe) (notepad pid $($notepad.Id))"
}
Say "  keeping Notepad in front 90 s"
Start-Sleep 90

Say "=== 3. start Character Map and keep it in front 60 s"
$charmap = Start-Process charmap.exe -PassThru
Start-Sleep 3
BringToFront $charmap.Id | Out-Null
Start-Sleep 2
$front = Get-Front
if ($front -and ($front.Pid -eq $charmap.Id -or ($front.Exe -and $front.Exe -like "*charmap*"))) {
    Say "ok: Character Map in front"
} else {
    Say "  front is pid $($front.Pid) class $($front.Class) exe $($front.Exe) (charmap pid $($charmap.Id))"
}
Say "  keeping Character Map in front 60 s"
Start-Sleep 60

Say "=== 4. minimise everything and wait 60 s"
(New-Object -ComObject Shell.Application).MinimizeAll()
Start-Sleep 5
$front = Get-Front
if ($front -eq $null) {
    Say "ok: nothing in front (desktop)"
} else {
    Say "  front is pid $($front.Pid) class $($front.Class) exe $($front.Exe)"
}
Say "  waiting 60 s with nothing in front"
Start-Sleep 60

Say "=== 5. the service's front lines from the Application event log"
$fronts = Get-WinEvent -FilterHashtable @{ LogName = "Application" } -MaxEvents 500 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match "^front: " }
foreach ($e in $fronts) {
    Say "  log $($e.TimeCreated.ToString('HH:mm:ss')): $($e.Message)"
}

Say "=== 6. wait for the service to sync and send programs"
$waited = 0
$found = $false
while (-not $found -and $waited -lt 180) {
    Start-Sleep 10
    $waited += 10
    $lines = Get-WinEvent -FilterHashtable @{ LogName = "Application" } -MaxEvents 200 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match "programs: sent" }
    if ($lines) {
        $found = $true
        foreach ($e in $lines) {
            Say "  log $($e.TimeCreated.ToString('HH:mm:ss')): $($e.Message)"
        }
    }
}
if (-not $found) { Say "FAILED: no 'programs: sent' line after 180 s" }

Say "done"
Stop-Computer -Force
