# Runs inside Windows Sandbox at one logon (as WDAGUtilityAccount), for Test-Stall.ps1 (CARD-073). One file,
# three stages: the host starts a fresh VM per stage and the .wsb LogonCommand passes -Stage, because a real
# lock or disconnect ends that VM's usefulness (after one the Sandbox never comes back to a logon).
#   stage 1 (criteria 5, 6, 7): install the MSI, enrol as Sam with 1 minute of Screens time, freeze the tray
#     with NtSuspendProcess, prove the out-of-time lock decision and the disconnect decision still happen
#     within 15 s of the minute being used up, and the service still syncs while the tray is frozen;
#   stage 2 (criteria 8, 9): stall the 1-second lock loop with the service's test-only --stall-test-file
#     switch, prove the watchdog logs and the service restarts with a new process id and re-locks the
#     out-of-time session, and exactly one tray is left after the restart;
#   stage 3 (criterion 10): a normal run with a healthy tray, the lock decision within 5 s of the minute
#     being used up.
# Every stage ends with Stop-Computer -Force after writing C:\out\stage<stage>.done.
#
# THE LOCKS BELOW ARE REAL. A real lock needs the service pointed at session 1 (--session 1), because the
# Sandbox has no console session (WTSGetActiveConsoleSessionId = 4294967295), and Program.cs refuses --session
# and --stall-test-file without a guard key: --dry-lock (which simulates every lock) or --real-lock-test
# (CARD-073, which changes nothing else). Every ImagePath below carries --real-lock-test, so the tray calls
# LockWorkStation and the service calls WTSDisconnectSession for real, and each stage prints the WTS state
# before and after its lock (SessionFlags 1 = unlocked, 0 = locked; WTSConnectState 4 = disconnected).
# Everything goes to C:\out. Windows PowerShell 5.1: ASCII only in every printed string.
param([int]$Stage = 0)
if (($Stage -lt 1 -or $Stage -gt 3) -and (Test-Path C:\in\stage.txt)) {
    $txt = (Get-Content C:\in\stage.txt -Raw).Trim()
    $Stage = [int]$txt
}
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results "$(Get-Date -Format HH:mm:ss) $text" }
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
$flag = "C:\ProgramData\ScreenTime\stall-test.flag"
$trayLog = Join-Path $env:LOCALAPPDATA "ScreenTime\tray.log"
$session = (Get-Process -Id $PID).SessionId
if ($Stage -lt 1 -or $Stage -gt 3) {
    Say "FAIL: -Stage must be 1, 2 or 3 (got '$Stage'); nothing ran"
    exit 1
}

# Suspend/resume a process from ntdll (the frozen tray of criterion 6).
Add-Type -Namespace W -Name Nt -MemberDefinition '[System.Runtime.InteropServices.DllImport("ntdll.dll")] public static extern uint NtSuspendProcess(IntPtr processHandle); [System.Runtime.InteropServices.DllImport("ntdll.dll")] public static extern uint NtResumeProcess(IntPtr processHandle);'
# What Windows says about this session's lock, which is what Win.SessionUnlocked reads: WTSSessionInfoEx (25)
# SessionFlags (offset 16) is 1 when unlocked, WTSConnectState (8) is 0 when active, and the Sandbox has no
# console session (WTSGetActiveConsoleSessionId says 4294967295), which is why the service needs --session.
Add-Type -Namespace W -Name Ts -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId(); [System.Runtime.InteropServices.DllImport("wtsapi32.dll", SetLastError=true)] public static extern bool WTSQuerySessionInformation(IntPtr server, uint session, int infoClass, out IntPtr buffer, out int bytes); [System.Runtime.InteropServices.DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr buffer);'

function Trays { @(Get-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session }) }
# The service's own lines are in the Application event log under the provider ScreenTime.Service (Warning and
# above, and since this branch the worker's Information lines too). The message carries the prefix
# "Category: ScreenTime.Service.Worker EventId: 0" before the text, so every match below is a substring.
function LogSince([datetime]$since) {
    try { @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; ProviderName = "ScreenTime.Service"; StartTime = $since } -ErrorAction SilentlyContinue) } catch { @() }
}
function WaitLog([datetime]$since, [string]$pattern, [int]$timeoutSec) {
    $waited = 0
    while ($waited -lt $timeoutSec) {
        $hit = LogSince $since | Where-Object { "$($_.Message)" -match $pattern } | Select-Object -First 1
        if ($hit) { return $hit }
        Start-Sleep 1
        $waited += 1
    }
    return $null
}
function WaitFile([string]$path, [int]$timeoutSec) {
    $waited = 0
    while (-not (Test-Path $path) -and $waited -lt $timeoutSec) { Start-Sleep 1; $waited += 1 }
    return (Test-Path $path)
}
function WaitTrayLine([string]$pattern, [int]$timeoutSec) {
    $waited = 0
    while ($waited -lt $timeoutSec) {
        if ((Test-Path $trayLog) -and (@(Get-Content $trayLog -ErrorAction SilentlyContinue) -match $pattern)) { return $waited }
        Start-Sleep 1
        $waited += 1
    }
    return -1
}
function SayTrayTail {
    if (Test-Path $trayLog) {
        Get-Content $trayLog | Select-Object -Last 5 | ForEach-Object { Say "  tray.log: $_" }
    } else {
        Say "  tray.log: not present"
    }
}
function T($d) { if ($d) { $d.ToString("HH:mm:ss") } else { "never" } }
function Gap($a, $b) { if ($a -and $b) { [int](($b - $a).TotalSeconds) } else { -1 } }
function OneLine($e) {
    $m = "$($e.Message)" -replace '\s+', ' '
    $m.Substring(0, [Math]::Min(160, $m.Length))
}
function SayImagepath {
    $bin = (sc.exe qc ScreenTime | Select-String "BINARY_PATH_NAME") | Select-Object -First 1
    if ($bin) { Say "  $($bin.Line.Trim())" } else { Say "  FAIL: no BINARY_PATH_NAME in sc.exe qc ScreenTime" }
}
function SessionFlags {
    $buf = [IntPtr]::Zero
    $len = 0
    if ([W.Ts]::WTSQuerySessionInformation([IntPtr]::Zero, [uint32]$session, 25, [ref]$buf, [ref]$len)) {
        $flags = [System.Runtime.InteropServices.Marshal]::ReadInt32($buf, 16)
        [W.Ts]::WTSFreeMemory($buf)
        return $flags
    }
    return -1
}
function ConnectState {
    $buf = [IntPtr]::Zero
    $len = 0
    if ([W.Ts]::WTSQuerySessionInformation([IntPtr]::Zero, [uint32]$session, 8, [ref]$buf, [ref]$len)) {
        $state = [System.Runtime.InteropServices.Marshal]::ReadInt32($buf, 0)
        [W.Ts]::WTSFreeMemory($buf)
        return $state
    }
    return -1
}
function SaySessionLock([string]$note) {
    Say "  WTS SessionFlags: $(SessionFlags) (1 = unlocked, 0 = locked; Win.SessionUnlocked reads this)$note"
    Say "  WTSConnectState: $(ConnectState) (0 = active, 4 = disconnected)"
}
# LockWorkStation, and WTSDisconnectSession with wait=false, take a moment to show in the session state, so a
# single immediate read can still say unlocked: poll for up to timeoutSec and report how long it took.
function WaitRealLock([int]$timeoutSec) {
    $steps = $timeoutSec * 2
    $i = 0
    while ($i -le $steps) {
        $f = SessionFlags
        $s = ConnectState
        if ($f -eq 0 -or $s -eq 4) {
            return @{ Real = $true; Flags = $f; State = $s; Seconds = [math]::Round($i / 2, 1) }
        }
        Start-Sleep -Milliseconds 500
        $i += 1
    }
    return @{ Real = $false; Flags = (SessionFlags); State = (ConnectState); Seconds = $timeoutSec }
}
function SayServiceSince([datetime]$since, [string]$label) {
    Say "  $label"
    $lines = @(LogSince $since) | Sort-Object TimeCreated
    if ($lines.Count -eq 0) {
        Say "    (no ScreenTime.Service lines)"
        return
    }
    foreach ($e in $lines) { Say "    $($e.TimeCreated.ToString('HH:mm:ss')) $(OneLine $e)" }
}
function InstallService([int]$stage) {
    Say "install the MSI (the recovery actions must be registered)"
    $install = Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install-$stage.log") -Wait -PassThru
    Say "  msiexec install exit $($install.ExitCode); version $((Get-Item $exe).VersionInfo.ProductVersion)"
    $qfail = @(sc.exe qfailure ScreenTime | Select-String "RESET_PERIOD|RESTART")
    if ($qfail.Count -eq 0) {
        Say "  FAIL: sc.exe qfailure shows no RESET_PERIOD or RESTART line"
    } else {
        Say "  sc.exe qfailure ScreenTime (RESET_PERIOD and RESTART lines):"
        $qfail | ForEach-Object { Say "  $($_.Line.Trim())" }
    }
}
function EnrolSam {
    $gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop
    $server = "http://${gateway}:8080"
    $enrol = & $exe enrol --server $server --code (Get-Content C:\in\code.txt).Trim() --user $env:USERNAME 2>&1
    Say "  enrol: $enrol"
    Say "  server: $server"
}
# The state comes from the server. sync-once fetches it into state.db while no service holds it, so the service
# knows the 1-minute allowance from its first second (otherwise the first 60 s sync arrives just as the minute
# runs out).
function SyncOnce {
    $syncOnce = & $exe sync-once 2>&1
    Say "  sync-once: $syncOnce"
}
function SetImagePath([string]$extra) {
    Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime" ImagePath "`"$exe`" --session $session --real-lock-test$extra"
    SayImagepath
    Restart-Service ScreenTime
    $t0 = Get-Date
    Say "  service restarted at $(T $t0)"
    return $t0
}
function SayDryNote([string]$what) {
    Say "  NOTE: the ImagePath carries --real-lock-test, not --dry-lock, so every lock in this stage is REAL."
    Say "  It is needed because the Sandbox has no console session (WTSGetActiveConsoleSessionId = 4294967295), so the"
    Say "  service must be pointed at session $session with --session, and Program.cs refuses $what without a guard key:"
    Say "  --dry-lock (which would simulate every lock) or --real-lock-test (which changes nothing but allows the real one)."
}
# Returns @{ Tray = the tray process (or $null); Connected = whether tray.log showed pipe: connected }.
function WaitTrayConnected([int]$trayTimeoutSec, [int]$connectedTimeoutSec) {
    $tray = $null
    $waited = 0
    while ($waited -lt $trayTimeoutSec -and -not $tray) {
        $t = Trays
        if ($t.Count -gt 0) { $tray = $t[0] }
        if (-not $tray) { Start-Sleep 2; $waited += 2 }
    }
    if (-not $tray) {
        Say "  FAIL: no ScreenTime.Tray in session $session within $trayTimeoutSec s"
        return @{ Tray = $null; Connected = $false }
    }
    Say "  tray pid $($tray.Id) at $(Get-Date -Format HH:mm:ss), after $waited s"
    $ok = $false
    $c = WaitTrayLine "pipe: connected" $connectedTimeoutSec
    if ($c -ge 0) {
        $ok = $true
        Say "  tray.log shows pipe: connected after $c s"
    } else {
        Say "  FAIL: tray.log never showed pipe: connected within $connectedTimeoutSec s"
    }
    # A leftover tray from before the restart may still be closing: use the one that is there now.
    $tNow = Trays
    if ($tNow.Count -eq 1 -and $tNow[0].Id -ne $tray.Id) {
        Say "  the tray changed: pid $($tray.Id) was the leftover closed at the restart, using pid $($tNow[0].Id) instead"
        $tray = $tNow[0]
    }
    return @{ Tray = $tray; Connected = $ok }
}

Say "=== stage $Stage"
Say "  sandbox: $(whoami), session $session, console session $([W.Ts]::WTSGetActiveConsoleSessionId()) (4294967295 = none: the Sandbox has no console session, so the service must be pointed with --session)"

if ($Stage -eq 1) {
    Say "stage 1: criteria 5, 6 and 7 (a frozen tray must not stop the lock)"
    InstallService $Stage
    Say "gateway and enrol as Sam (1 minute of Screens time today)"
    EnrolSam
    $connected = $false
    $frozen = $false
    $frozenPid = 0
    $trayLinesAtFreeze = 0
    Remove-Item $trayLog -Force -ErrorAction SilentlyContinue
    Say "  tray.log cleared (the next pipe: connected line must come from this service run's tray)"
    SyncOnce
    Say "the service in this session (no stall switch)"
    $t0 = SetImagePath ""
    SayDryNote "--session"
    $got = WaitTrayConnected 90 60
    $tray = $got.Tray
    $connected = $got.Connected
    SaySessionLock " (before the freeze)"
    if ($tray) {
        $tNow = Trays
        $pids = ($tNow | ForEach-Object { $_.Id }) -join " "
        if ($tNow.Count -eq 1) {
            $freezeOk = $false
            try { $null = [W.Nt]::NtSuspendProcess($tray.Handle); $freezeOk = $true } catch { }
            if ($freezeOk) {
                $frozen = $true
                $frozenPid = $tray.Id
                if (Test-Path $trayLog) { $trayLinesAtFreeze = @(Get-Content $trayLog).Count }
                Say "  NtSuspendProcess called on tray pid $($tray.Id) at $(Get-Date -Format HH:mm:ss); tray.log has $trayLinesAtFreeze lines"
                $susp = @($tray.Threads | Where-Object { "$($_.WaitReason)" -eq "Suspended" }).Count
                Say "  threads reporting WaitReason Suspended: $susp of $($tray.Threads.Count)"
            } else {
                Say "  FAIL: NtSuspendProcess failed on tray pid $($tray.Id)"
            }
        } else {
            Say "  FAIL: $($tNow.Count) tray processes at freeze time ($pids)"
        }
        SayTrayTail
    }
    Say "criterion 5: the 1-minute allowance counts, then is used up"
    $tCounting = $null
    $tUsed = $null
    $kid = ""
    $counting = WaitLog ($t0.AddSeconds(-15)) "counting \(session" 90   # the line can be written just before Restart-Service returns
    if ($counting) {
        $tCounting = $counting.TimeCreated
        Say "  counting at $(T $tCounting): $(OneLine $counting)"
        if ("$(OneLine $counting)" -match "(?:^|\s)(\w+): counting \(session") { $kid = $Matches[1] }
    } else {
        Say "  FAIL: no counting line within 90 s of the restart"
    }
    if ($tCounting) {
        $used = WaitLog $tCounting "out of time, the engine says locked" 120
        if ($used) {
            $tUsed = $used.TimeCreated
            Say "  used up at $(T $tUsed): $(OneLine $used)"
            Say "  the minute lasted $(Gap $tCounting $tUsed) s from counting to used up (about 60 s expected)"
        } else {
            Say "  FAIL: no out-of-time line within 120 s of the counting line"
        }
    }
    if ($tCounting -and $tUsed) {
        Say "criterion 5: kid $kid, 1-minute allowance, counting at $(T $tCounting), used up at $(T $tUsed): PASS"
    } else {
        Say "criterion 5: kid $kid, 1-minute allowance, counting at $(T $tCounting), used up at $(T $tUsed): FAIL"
    }
    Say "criterion 6: the frozen tray must not stop the lock"
    $tLock = $null
    $tDisc = $null
    if (-not $tUsed) {
        Say "criterion 6 the frozen tray did not stop the lock: FAIL (the minute was never used up)"
    } else {
        # The service logs the Lock step just before the view that says out of time, in the same pass, so look a
        # few seconds before the used-up line (the gap printed below is then 0 or -1, which still means "at once").
        $lockLine = WaitLog ($tUsed.AddSeconds(-5)) "locking session" 20
        if ($lockLine) {
            $tLock = $lockLine.TimeCreated
            Say "  locking session at $(T $tLock): $(OneLine $lockLine)"
        } else {
            Say "  FAIL: no locking session line within 20 s of the minute being used up"
        }
        # Under --dry-lock the disconnect step logs 'dry run: would disconnect session'; the card's real wording
        # 'tray did not lock, disconnecting session' appears only without --dry-lock. Both are matched, so the
        # same script works unchanged the day Program.cs allows the real run; which one was seen is printed.
        $discLine = WaitLog $tUsed "tray did not lock, disconnecting session|dry run: would disconnect session" 20
        if ($discLine) {
            $tDisc = $discLine.TimeCreated
            Say "  disconnect step at $(T $tDisc): $(OneLine $discLine)"
            if ("$(OneLine $discLine)" -match "dry run") { Say "  (the dry-run wording, not the card's real one: Program.cs forced --dry-lock)" }
        } else {
            Say "  FAIL: no disconnect line within 20 s of the minute being used up"
        }
        Say "  from used up to locking session: $(Gap $tUsed $tLock) s; to the disconnect step: $(Gap $tUsed $tDisc) s"
        $givenUp = @(LogSince $tUsed | Where-Object { "$($_.Message)" -match "pipe write given up" })
        Say "  pipe write given up lines since the minute was used up: $($givenUp.Count)"
        $givenUp | Select-Object -First 3 | ForEach-Object { Say "  $(T $_.TimeCreated): $(OneLine $_)" }
        $linesNow = 0
        if (Test-Path $trayLog) { $linesNow = @(Get-Content $trayLog).Count }
        Say "  tray.log lines at the freeze: $trayLinesAtFreeze; now: $linesNow (a frozen tray cannot write, so these must be equal)"
        SayTrayTail
        $lock6 = WaitRealLock 15
        $flags6 = $lock6.Flags
        $state6 = $lock6.State
        Say "  the session state became locked or disconnected $($lock6.Seconds) s after the disconnect step"
        SaySessionLock " (after the disconnect step)"
        $gap6 = Gap $tUsed $tLock
        $gap6d = Gap $tUsed $tDisc
        if ($frozen -and $connected -and $tLock -and $tDisc -and $gap6 -le 15 -and $gap6d -le 15 -and $linesNow -eq $trayLinesAtFreeze -and ($lock6.Real -or $state6 -eq 4) -and ("$(OneLine $discLine)" -notmatch "dry run")) {
            Say "criterion 6 the frozen tray did not stop the lock: PASS (REAL: used up at $(T $tUsed), locking session at $(T $tLock), $gap6 s, disconnect at $(T $tDisc), $gap6d s, tray.log unchanged, WTS SessionFlags $flags6 / WTSConnectState $state6)"
        } else {
            Say "criterion 6 the frozen tray did not stop the lock: FAIL (frozen: $frozen, connected: $connected, used up at $(T $tUsed), locking session at $(T $tLock), $gap6 s, disconnect at $(T $tDisc), $gap6d s, tray.log lines $trayLinesAtFreeze -> $linesNow, WTS SessionFlags $flags6 / WTSConnectState $state6)"
        }
    }
    Say "criterion 7: still syncing while the tray is frozen (the host checks)"
    Set-Content C:\out\c7.txt "1"
    Say "  c7.txt written; waiting for the host's last_seen_at check (go7.txt)"
    if (WaitFile C:\out\go7.txt 300) {
        $v7 = (Get-Content C:\out\go7.txt -Raw).Trim()
        Say "  host verdict: $v7"
        Say "criterion 7 the service kept syncing while the tray was frozen: $v7"
    } else {
        Say "  FAIL: no go7.txt within 300 s"
        Say "criterion 7 the service kept syncing while the tray was frozen: FAIL: no host verdict within 300 s"
    }
    SayServiceSince $t0 "every ScreenTime.Service line since the restart at $(T $t0):"
    Say "stage $Stage done"
    Set-Content "C:\out\stage$Stage.done" "1"
    Start-Sleep 3
    Stop-Computer -Force
}
elseif ($Stage -eq 2) {
    Say "stage 2: criteria 8 and 9 (the watchdog restart)"
    InstallService $Stage
    Say "gateway and enrol as Sam (1 minute of Screens time today)"
    EnrolSam
    Remove-Item $trayLog -Force -ErrorAction SilentlyContinue
    Say "  tray.log cleared (the next pipe: connected line must come from this service run's tray)"
    SyncOnce
    Say "the service in this session, with the stall switch on the ImagePath"
    $t0 = SetImagePath " --stall-test-file $flag"
    SayDryNote "--stall-test-file (and --session)"
    $got = WaitTrayConnected 90 60
    $tray = $got.Tray
    $trayPidBefore = 0
    if ($tray) { $trayPidBefore = $tray.Id }
    $counting = WaitLog ($t0.AddSeconds(-15)) "counting \(session" 90   # the line can be written just before Restart-Service returns
    if ($counting) {
        Say "  counting at $(T $counting.TimeCreated): $(OneLine $counting)"
    } else {
        Say "  FAIL: no counting line within 90 s of the restart"
    }
    SaySessionLock " (unlocked while the stall is not on yet)"
    $svcPidBefore = 0
    $svc = Get-Process -Name ScreenTime.Service -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc) {
        $svcPidBefore = $svc.Id
        Say "  service pid before the stall: $svcPidBefore at $(Get-Date -Format HH:mm:ss)"
    } else {
        Say "  FAIL: no ScreenTime.Service process found"
    }
    # The stall flag goes on before the minute is used up, so the watchdog is tested on a live session.
    try { Set-Content $flag "1" } catch { Say "  FAIL: could not create the stall flag ($flag): $($_.Exception.Message)" }
    $tFlag = Get-Date
    Say "  stall flag created ($flag) at $(T $tFlag), before the minute is used up"
    $wdLine = $null
    $wdTime = $null
    $newPid = 0
    $newTime = $null
    $waited = 0
    while ($waited -lt 120) {
        if (-not $wdLine) {
            $wdLine = LogSince $tFlag | Where-Object { "$($_.Message)" -match "made no pass .* restarting the service" } | Select-Object -First 1
            if ($wdLine) {
                $wdTime = $wdLine.TimeCreated
                Say "  watchdog line at $(T $wdTime): $(OneLine $wdLine)"
            }
        }
        if ($newPid -eq 0 -and $svcPidBefore -gt 0) {
            $svcNow = Get-Process -Name ScreenTime.Service -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($svcNow -and $svcNow.Id -ne $svcPidBefore) {
                $newPid = $svcNow.Id
                $newTime = Get-Date
                Say "  new service pid $newPid at $(T $newTime) (was $svcPidBefore)"
                Remove-Item $flag -Force -ErrorAction SilentlyContinue
                Say "  stall flag deleted at $(Get-Date -Format HH:mm:ss)"
            }
        }
        if ($wdLine -and $newPid -gt 0) { break }
        Start-Sleep 1
        $waited += 1
    }
    if (-not $wdLine) { Say "  FAIL: no watchdog line within 120 s of the stall flag" }
    if ($newPid -eq 0) { Say "  FAIL: no new service pid within 120 s of the stall flag" }
    Say "  from the stall flag to the watchdog line: $(Gap $tFlag $wdTime) s; to the new pid: $(Gap $tFlag $newTime) s (the card allows 90 for both)"
    Say "  Service Control Manager events since the stall flag (the 7031 line is the recovery restart the installer registers):"
    $scm7031 = 0
    foreach ($e in @(Get-WinEvent -FilterHashtable @{ LogName = "System"; ProviderName = "Service Control Manager"; StartTime = $tFlag } -ErrorAction SilentlyContinue) | Sort-Object TimeCreated) {
        if ($e.Id -eq 7031) { $scm7031 += 1 }
        Say "    $($e.TimeCreated.ToString('HH:mm:ss')) id $($e.Id): $(OneLine $e)"
    }
    Say "    SCM 7031 events: $scm7031"
    Say "criterion 8: the restarted service must re-lock the out-of-time session"
    $relockTime = $null
    $secondPid = 0
    if ($newPid -gt 0) {
        $waited = 0
        while ($waited -lt 20) {
            # Polled for 20 s but the card allows 15: the gap printed below and used for the verdict is the evidence.
            $relock = LogSince $newTime | Where-Object { "$($_.Message)" -match "tray \d+: locked|tray did not lock, disconnecting session|dry run: would disconnect session" } | Select-Object -First 1
            if ($relock) {
                $relockTime = $relock.TimeCreated
                Say "  the restarted service's relock at $(T $relockTime): $(OneLine $relock)"
                break
            }
            $p = Get-Process -Name ScreenTime.Service -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($p -and $p.Id -ne $newPid -and $secondPid -eq 0) {
                $secondPid = $p.Id
                Say "  the service changed pid again, to $secondPid at $(Get-Date -Format HH:mm:ss) (a crash loop would look like this)"
            }
            Start-Sleep 1
            $waited += 1
        }
        if (-not $relockTime) { Say "  FAIL: no relock line within 20 s of the new pid (the card allows 15)" }
        Say "  from the watchdog line to the relock: $(Gap $wdTime $relockTime) s; from the new pid to the relock: $(Gap $newTime $relockTime) s (the card allows 15)"
        $lock8 = WaitRealLock 15
        $flags8 = $lock8.Flags
        $state8 = $lock8.State
        Say "  the session state became locked $($lock8.Seconds) s after the relock line"
        SaySessionLock " (after the relock)"
    } else {
        Say "  NOT RUN: no new service pid, so the relock was not waited for"
    }
    $gapFlagPid = Gap $tFlag $newTime
    $gapPidRelock = Gap $newTime $relockTime
    if ($wdLine -and $newPid -gt 0 -and $relockTime -and $gapPidRelock -le 15 -and $gapFlagPid -le 90 -and $lock8.Real) {
        Say "criterion 8 the watchdog restarted the service and it locked the session: PASS (REAL: watchdog at $(T $wdTime), pid $svcPidBefore to $newPid $gapFlagPid s after the flag, relock $gapPidRelock s after the new pid, WTS SessionFlags $flags8)"
    } else {
        Say "criterion 8 the watchdog restarted the service and it locked the session: FAIL (watchdog at $(T $wdTime), pid $svcPidBefore to $newPid at $(T $newTime), $gapFlagPid s after the flag, relock at $(T $relockTime), $gapPidRelock s after the new pid, further pid changes: $secondPid)"
    }
    Say "criterion 9: exactly one tray after the restart"
    $t = Trays
    $waited = 0
    while ($waited -lt 20 -and (($t.Count -ne 1) -or ($trayPidBefore -gt 0 -and @($t | Where-Object { $_.Id -eq $trayPidBefore }).Count -gt 0))) {
        Start-Sleep 1
        $waited += 1
        $t = Trays
    }
    $pids = ($t | ForEach-Object { $_.Id }) -join " "
    Say "  tray processes in session ${session}: $($t.Count) ($pids) after $waited s"
    $oldGone = $true
    if ($trayPidBefore -gt 0) { $oldGone = -not (Get-Process -Id $trayPidBefore -ErrorAction SilentlyContinue) }
    Say "  the tray from before the restart (pid $trayPidBefore) is gone: $oldGone"
    $closing = @(LogSince $tFlag | Where-Object { "$($_.Message)" -match "closing the tray left by the previous service run" })
    Say "  closing-the-leftover-tray lines: $($closing.Count)"
    $closing | ForEach-Object { Say "  $(T $_.TimeCreated): $(OneLine $_)" }
    if ($t.Count -eq 1 -and $oldGone) {
        Say "criterion 9 exactly one tray after the restart: PASS (1 tray, pid $($t[0].Id), the tray from before the restart is gone)"
    } else {
        Say "criterion 9 exactly one tray after the restart: FAIL ($($t.Count) tray processes ($pids), the old tray gone: $oldGone)"
    }
    SayServiceSince $tFlag "every ScreenTime.Service line from the stall flag at $(T $tFlag) on:"
    if (Test-Path $flag) { Say "  stall flag still present: $flag" } else { Say "  stall flag gone: $flag" }
    SayImagepath
    Say "  service status: $((Get-Service ScreenTime).Status)"
    Say "stage $Stage done"
    Set-Content "C:\out\stage$Stage.done" "1"
    Start-Sleep 3
    Stop-Computer -Force
}
else {
    Say "stage 3: criterion 10 (a normal run with a healthy tray)"
    InstallService $Stage
    Say "gateway and enrol as Sam (1 minute of Screens time today)"
    EnrolSam
    Remove-Item $trayLog -Force -ErrorAction SilentlyContinue
    Say "  tray.log cleared (a fresh tray must write the next pipe: connected line)"
    SyncOnce
    Say "the service in this session (no stall switch)"
    $t0 = SetImagePath ""
    SayDryNote "--session"
    $got = WaitTrayConnected 90 60
    SaySessionLock " (before the minute is used up)"
    Say "criterion 10: a normal run locks within 5 s of being used up"
    $tCounting = $null
    $tUsed = $null
    $tLocked = $null
    $counting = WaitLog ($t0.AddSeconds(-15)) "counting \(session" 90
    if ($counting) {
        $tCounting = $counting.TimeCreated
        Say "  counting at $(T $tCounting): $(OneLine $counting)"
    } else {
        Say "  FAIL: no counting line within 90 s of the start"
    }
    if ($tCounting) {
        $used = WaitLog $tCounting "out of time, the engine says locked" 120
        if ($used) {
            $tUsed = $used.TimeCreated
            Say "  used up at $(T $tUsed): $(OneLine $used)"
        } else {
            Say "  FAIL: no out-of-time line within 120 s of the counting line"
        }
    }
    if ($tUsed) {
        $locked = WaitLog $tUsed "tray \d+: locked|tray did not lock, disconnecting session|dry run: would disconnect session" 15
        if ($locked) {
            $tLocked = $locked.TimeCreated
            Say "  the lock at $(T $tLocked): $(OneLine $locked)"
        } else {
            Say "  FAIL: no lock line within 15 s of being used up"
        }
    }
    SayTrayTail
    $lock10 = WaitRealLock 5
    $flags10 = $lock10.Flags
    $state10 = $lock10.State
    Say "  the session state became locked $($lock10.Seconds) s after the lock line"
    SaySessionLock " (after the lock)"
    $g10 = Gap $tUsed $tLocked
    if ($tUsed -and $tLocked -and $g10 -le 5 -and $lock10.Real) {
        Say "criterion 10 a normal run locked within 5 s of being used up: PASS (REAL: used up at $(T $tUsed), locked at $(T $tLocked), $g10 s, WTS SessionFlags $flags10)"
    } else {
        Say "criterion 10 a normal run locked within 5 s of being used up: FAIL (used up at $(T $tUsed), locked at $(T $tLocked), $g10 s, WTS SessionFlags $flags10)"
    }
    SayServiceSince $t0 "every ScreenTime.Service line since the restart at $(T $t0):"
    Say "stage $Stage done"
    Set-Content "C:\out\stage$Stage.done" "1"
    Start-Sleep 3
    Stop-Computer -Force
}
