# Runs inside Windows Sandbox at each logon (as WDAGUtilityAccount), for Test-Programs.ps1. Installs the MSI,
# enrols as Sam, opens Character Map and About Windows, waits for the tray to see them and the service to sync,
# then closes both. Everything goes to C:\out.
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
Check ($code -eq 0) "msiexec install exit $code"
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop
$out = & $exe enrol --server "http://${gateway}:8080" --code (Get-Content C:\in\code.txt).Trim() --user $env:USERNAME 2>&1
Say "  enrol: $out"
# No console session in the Sandbox: the service is pointed at this one (as Test-Installer.ps1 does).
$session = (Get-Process -Id $PID).SessionId
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime" ImagePath "`"$exe`" --session $session --dry-lock"
Restart-Service ScreenTime
$waited = 0
while (-not (Get-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue) -and $waited -lt 60) { Start-Sleep 2; $waited += 2 }
Check ((Get-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue) -ne $null) "tray running"

Say "=== 2. start Character Map and keep it in front 90 s"
$charmap = Start-Process charmap.exe -PassThru
Start-Sleep 3
BringToFront $charmap.Id | Out-Null
Start-Sleep 2
$front = Get-Front
Check (($front -and ($front.Pid -eq $charmap.Id -or ($front.Exe -and $front.Exe -like "*charmap*")))) "Character Map in front"
Say "  keeping Character Map in front 90 s"
Start-Sleep 90

Say "=== 3. close Character Map, start About Windows and keep it in front 60 s"
Stop-Process -Id $charmap.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 3
$winver = Start-Process winver.exe -PassThru
Start-Sleep 3
BringToFront $winver.Id | Out-Null
Start-Sleep 2
$front = Get-Front
Check (($front -and ($front.Pid -eq $winver.Id -or ($front.Exe -and $front.Exe -like "*winver*")))) "About Windows in front"
Say "  keeping About Windows in front 60 s"
Start-Sleep 60

Say "=== 4. close About Windows"
Stop-Process -Id $winver.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 5
$front = Get-Front
if ($front -eq $null) {
    Check $true "nothing in front (desktop)"
} else {
    Check ($front.Exe -eq $null -or $front.Exe -like "*explorer*") "nothing in front (got: $($front.Pid) $($front.Class) $($front.Exe))"
}

Say "=== 5. keep the Sandbox up 150 s so the service can sync"
Start-Sleep 150

Say "=== done: $failed failed"
Stop-Computer -Force
