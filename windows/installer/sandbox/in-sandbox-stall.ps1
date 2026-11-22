# Runs inside Windows Sandbox at the one logon (as WDAGUtilityAccount), for Test-Stall.ps1 (CARD-073). It
# installs the MSI, enrols as Sam (1 minute of Screens time today), waits for the tray and freezes it with
# NtSuspendProcess, then proves the service still locks when the minute is used up and still syncs; then it
# stalls the 1-second lock loop with the test-only --stall-test-file switch and proves the watchdog restarts
# the service and the restarted service locks; then exactly one tray and no tamper, then a normal run with a
# healthy tray. Everything goes to C:\out. Windows PowerShell 5.1: ASCII only in every printed string.
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results "$(Get-Date -Format HH:mm:ss) $text" }
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
$flag = "C:\ProgramData\ScreenTime\stall-test.flag"
$trayLog = Join-Path $env:LOCALAPPDATA "ScreenTime\tray.log"
$session = (Get-Process -Id $PID).SessionId
$frozen = $false
$connected = $false
$frozenPid = 0
$trayLinesAtFreeze = 0
$tFlag = Get-Date

function Trays { @(Get-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session }) }
# The service's own lines are not under the "ScreenTime" source (that source only carries ServiceBase's
# "Service started successfully." lines), so read the Application log by time and match the message.
function LogSince([datetime]$since) {
    try { @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; StartTime = $since } -ErrorAction SilentlyContinue) } catch { @() }
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

# Suspend/resume a process from ntdll (the frozen tray of criterion 6).
Add-Type -Namespace W -Name Nt -MemberDefinition '[System.Runtime.InteropServices.DllImport("ntdll.dll")] public static extern uint NtSuspendProcess(IntPtr processHandle); [System.Runtime.InteropServices.DllImport("ntdll.dll")] public static extern uint NtResumeProcess(IntPtr processHandle);'
# What Windows says about this session's lock, which is what Win.SessionUnlocked reads: WTSSessionInfoEx (25)
# SessionFlags (offset 16) is 1 when unlocked, and WTSConnectState (8) is 0 when active.
Add-Type -Namespace W -Name Ts -MemberDefinition '[System.Runtime.InteropServices.DllImport("wtsapi32.dll", SetLastError=true)] public static extern bool WTSQuerySessionInformation(IntPtr server, uint session, int infoClass, out IntPtr buffer, out int bytes); [System.Runtime.InteropServices.DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr buffer);'
function SaySessionLock {
    $buf = [IntPtr]::Zero
    $len = 0
    if ([W.Ts]::WTSQuerySessionInformation([IntPtr]::Zero, [uint32]$session, 25, [ref]$buf, [ref]$len)) {
        $flags = [System.Runtime.InteropServices.Marshal]::ReadInt32($buf, 16)
        [W.Ts]::WTSFreeMemory($buf)
        Say "  WTS SessionFlags: $flags (1 = unlocked, which is what Win.SessionUnlocked reads)"
    } else {
        Say "  WTS SessionFlags: query failed"
    }
    $buf = [IntPtr]::Zero
    if ([W.Ts]::WTSQuerySessionInformation([IntPtr]::Zero, [uint32]$session, 8, [ref]$buf, [ref]$len)) {
        $state = [System.Runtime.InteropServices.Marshal]::ReadInt32($buf, 0)
        [W.Ts]::WTSFreeMemory($buf)
        Say "  WTSConnectState: $state (0 = active, 4 = disconnected)"
    } else {
        Say "  WTSConnectState: query failed"
    }
}

Set-Content $results "sandbox run at $(Get-Date -Format o) as $(whoami), session $session"

Say "=== 1. install the MSI (the recovery actions must be registered)"
$install = Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru
Say "msiexec install exit $($install.ExitCode); version $((Get-Item $exe).VersionInfo.ProductVersion)"
$qfail = @(sc.exe qfailure ScreenTime | Select-String "RESET_PERIOD|RESTART")
if ($qfail.Count -eq 0) {
    Say "  FAIL: sc.exe qfailure shows no RESET_PERIOD or RESTART line"
} else {
    Say "  sc.exe qfailure ScreenTime (RESET_PERIOD and RESTART lines):"
    $qfail | ForEach-Object { Say "  $($_.Line.Trim())" }
}

Say "=== 2. gateway and enrol as Sam"
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop
$server = "http://${gateway}:8080"
$enrol = & $exe enrol --server $server --code (Get-Content C:\in\code.txt).Trim() --user $env:USERNAME 2>&1
Say "  enrol: $enrol"
Say "  server: $server"

Say "=== 3. the service in this session, with the stall switch on the ImagePath"
Remove-Item $trayLog -Force -ErrorAction SilentlyContinue
Say "  tray.log cleared (the next pipe: connected line must come from this service run's tray)"
# The state comes from the server. sync-once fetches it into state.db while no service holds it, so the service knows
# the 1-minute allowance from its first second (otherwise the first 60 s sync arrives just as the minute runs out).
$syncOnce = & $exe sync-once 2>&1
Say "  sync-once: $syncOnce"
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime" ImagePath "`"$exe`" --session $session --dry-lock --stall-test-file $flag"
SayImagepath
Restart-Service ScreenTime
$t0 = Get-Date
Say "  service restarted at $(T $t0)"

Say "=== 4. wait for the tray, then freeze it"
SaySessionLock
$tray = $null
$waited = 0
while ($waited -lt 90 -and -not $tray) {
    $t = Trays
    if ($t.Count -gt 0) { $tray = $t[0] }
    if (-not $tray) { Start-Sleep 2; $waited += 2 }
}
if (-not $tray) {
    Say "  FAIL: no ScreenTime.Tray in session $session within 90 s"
} else {
    Say "  tray pid $($tray.Id) at $(Get-Date -Format HH:mm:ss), after $waited s"
    $c = WaitTrayLine "pipe: connected" 60
    if ($c -ge 0) {
        $connected = $true
        Say "  tray.log shows pipe: connected after $c s"
    } else {
        Say "  FAIL: tray.log never showed pipe: connected within 60 s"
    }
    $tNow = Trays
    if ($tNow.Count -eq 1 -and $tNow[0].Id -ne $tray.Id) {
        Say "  the tray changed: pid $($tray.Id) was the leftover closed at the restart, freezing pid $($tNow[0].Id) instead"
        $tray = $tNow[0]
    }
    $pids = ($tNow | ForEach-Object { $_.Id }) -join " "
    if ($tNow.Count -eq 1) {
        $freezeOk = $false
        try { $null = [W.Nt]::NtSuspendProcess($tray.Handle); $freezeOk = $true } catch { }
        if ($freezeOk) {
            $frozen = $true
            $trayLinesAtFreeze = 0
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
    $frozenPid = $tray.Id
}

Say "=== 5. criterion 5: the 1-minute allowance counts, then is used up"
$tCounting = $null
$tUsed = $null
$kid = ""
$counting = WaitLog $t0 "counting \(session" 90
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

Say "=== 6. criterion 6: the frozen tray must not stop the lock"
$tLock = $null
$tDisc = $null
if (-not $tUsed) {
    Say "criterion 6 locked within 15 s of the minute being used up: FAIL (the minute was never used up)"
} else {
    $lockLine = WaitLog $tUsed "locking session" 20
    if ($lockLine) {
        $tLock = $lockLine.TimeCreated
        Say "  locking session at $(T $tLock): $(OneLine $lockLine)"
    } else {
        Say "  FAIL: no locking session line within 20 s of the minute being used up"
    }
    $discLine = WaitLog $tUsed "would disconnect session|tray did not lock, disconnecting session" 20
    if ($discLine) {
        $tDisc = $discLine.TimeCreated
        Say "  disconnect step at $(T $tDisc): $(OneLine $discLine)"
    } else {
        Say "  FAIL: no disconnect line within 20 s of the minute being used up"
    }
    Say "  from used up to locking session: $(Gap $tUsed $tLock) s; to the disconnect step: $(Gap $tUsed $tDisc) s"
    $givenUp = @(LogSince $tUsed | Where-Object { "$($_.Message)" -match "pipe write given up" })
    Say "  pipe write given up lines since the minute was used up: $($givenUp.Count)"
    $givenUp | Select-Object -First 3 | ForEach-Object { Say "  $(T $_.TimeCreated): $(OneLine $_)" }
    $lockInLog = 0
    if (Test-Path $trayLog) { $lockInLog = @((Get-Content $trayLog) -match "lock: ").Count }
    $linesNow = 0
    if (Test-Path $trayLog) { $linesNow = @(Get-Content $trayLog).Count }
    Say "  tray.log lines at the freeze: $trayLinesAtFreeze; now: $linesNow (a frozen tray cannot write, so these must be equal)"
    Say "  lock lines in tray.log: $lockInLog"
    SayTrayTail
    $gap6 = Gap $tUsed $tLock
    if ($frozen -and $connected -and $tLock -and $gap6 -le 15 -and $linesNow -eq $trayLinesAtFreeze) {
        Say "criterion 6 locked within 15 s of the minute being used up: PASS (used up at $(T $tUsed), locking session at $(T $tLock), $gap6 s, disconnect at $(T $tDisc), tray.log unchanged)"
    } else {
        Say "criterion 6 locked within 15 s of the minute being used up: FAIL (frozen: $frozen, connected: $connected, used up at $(T $tUsed), locking session at $(T $tLock), $gap6 s, disconnect at $(T $tDisc), tray.log lines $trayLinesAtFreeze -> $linesNow)"
    }
}

Say "=== 7. criterion 7: still syncing while the tray is frozen (the host checks)"
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

Say "=== 8. criterion 8: stall the lock loop, the watchdog must restart the service"
$svc = Get-Process -Name ScreenTime.Service -ErrorAction SilentlyContinue | Select-Object -First 1
$svcPidBefore = 0
if ($svc) {
    $svcPidBefore = $svc.Id
    Say "  service pid before: $svcPidBefore at $(Get-Date -Format HH:mm:ss)"
} else {
    Say "  FAIL: no ScreenTime.Service process found"
}
Set-Content $flag "1"
$tFlag = Get-Date
Say "  stall flag created ($flag) at $(T $tFlag)"
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
$relockTime = $null
$secondPid = 0
if ($wdTime -and $newPid -gt 0) {
    # The card times the relock from the new process id, and gives 90 s for the watchdog and the restart together.
    $waited = 0
    while ($waited -lt 90) {
        $relock = LogSince $newTime | Where-Object { "$($_.Message)" -match "tray \d+: locked|would disconnect session|tray did not lock, disconnecting session" } | Select-Object -First 1
        if ($relock) {
            $relockTime = $relock.TimeCreated
            Say "  the restarted service locked at $(T $relockTime): $(OneLine $relock)"
            Say "  from the watchdog line to the lock: $(Gap $wdTime $relockTime) s; from the watchdog line to the new pid: $(Gap $wdTime $newTime) s; new pid to lock: $(Gap $newTime $relockTime) s"
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
    if (-not $relockTime) { Say "  FAIL: no disconnect line within 90 s of the new pid" }
}
$gap8 = -1
if ($relockTime) { $gap8 = Gap $newTime $relockTime }
if ($wdLine -and $newPid -gt 0 -and $relockTime -and $gap8 -le 15 -and $secondPid -eq 0) {
    Say "criterion 8 the watchdog restarted the service and it locked the session: PASS (watchdog at $(T $wdTime), pid $svcPidBefore to $newPid, locked $(Gap $wdTime $relockTime) s after the watchdog line and $gap8 s after the new pid)"
} else {
    Say "criterion 8 the watchdog restarted the service and it locked the session: FAIL (watchdog at $(T $wdTime), pid $svcPidBefore to $newPid at $(T $newTime), further pid changes: $secondPid, lock at $(T $relockTime), $gap8 s after the new pid)"
}

Say "=== 9. criterion 9: exactly one tray after the restart"
$t = Trays
$waited = 0
while ($waited -lt 20 -and (($t.Count -ne 1) -or ($frozenPid -gt 0 -and ($t | Where-Object { $_.Id -eq $frozenPid })))) {
    Start-Sleep 1
    $waited += 1
    $t = Trays
}
$pids = ($t | ForEach-Object { $_.Id }) -join " "
Say "  tray processes in session ${session}: $($t.Count) ($pids) after $waited s"
$frozenGone = $true
if ($frozenPid -gt 0) { $frozenGone = -not (Get-Process -Id $frozenPid -ErrorAction SilentlyContinue) }
Say "  suspended tray pid $frozenPid gone: $frozenGone"
$closing = @(LogSince $tFlag | Where-Object { "$($_.Message)" -match "closing the tray left by the previous service run" })
Say "  closing-the-leftover-tray lines: $($closing.Count)"
$closing | ForEach-Object { Say "  $(T $_.TimeCreated): $(OneLine $_)" }
if ($t.Count -eq 1 -and $frozenGone) {
    Say "criterion 9 exactly one tray after the restart: PASS (1 tray, pid $($t[0].Id), suspended pid $frozenPid gone)"
} else {
    Say "criterion 9 exactly one tray after the restart: FAIL ($($t.Count) tray processes, suspended pid $frozenPid gone: $frozenGone)"
}

Say "=== 10. criterion 9: the host checks for tamper events"
Set-Content C:\out\c9.txt "1"
Say "  c9.txt written; waiting for the host's tamper query (go9.txt)"
if (WaitFile C:\out\go9.txt 300) {
    $v9 = (Get-Content C:\out\go9.txt -Raw).Trim()
    Say "  host verdict: $v9"
    Say "criterion 9 no tamper event for this PC: $v9"
} else {
    Say "  FAIL: no go9.txt within 300 s"
    Say "criterion 9 no tamper event for this PC: FAIL: no host verdict within 300 s"
}

Say "=== 11. criterion 10: a normal run with a healthy tray"
$preStop = Trays
$preStopPid = 0
if ($preStop.Count -gt 0) { $preStopPid = $preStop[0].Id }
Stop-Service ScreenTime
Say "  service stopped at $(Get-Date -Format HH:mm:ss) (tray pid before: $preStopPid)"
$removed = $false
$tries = 0
foreach ($i in 1..5) {
    $tries = $i
    try {
        Remove-Item C:\ProgramData\ScreenTime -Recurse -Force -ErrorAction Stop
        $removed = $true
        break
    } catch {
        Start-Sleep 1
    }
}
if ($removed) {
    Say "  C:\ProgramData\ScreenTime removed on attempt $tries"
} else {
    Say "  FAIL: C:\ProgramData\ScreenTime still locked after 5 attempts"
}
Set-Content C:\out\c10.txt "1"
Say "  c10.txt written; waiting for the host to clear usage and write a new code (go10.txt)"
$newCode = ""
if (WaitFile C:\out\go10.txt 300) {
    $newCode = (Get-Content C:\out\go10.txt -Raw).Trim()
    Say "  new enrolment code: $newCode"
    $enrol10 = & $exe enrol --server $server --code $newCode --user $env:USERNAME 2>&1
    Say "  enrol: $enrol10"
} else {
    Say "  FAIL: no go10.txt within 300 s"
}
if ($newCode -match "^\d{6}$") {
    Remove-Item $trayLog -Force -ErrorAction SilentlyContinue
    Say "  tray.log cleared (a fresh tray must write the next pipe: connected line)"
    $syncOnce10 = & $exe sync-once 2>&1
    Say "  sync-once: $syncOnce10"
    Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime" ImagePath "`"$exe`" --session $session --dry-lock"
    SayImagepath
    Start-Service ScreenTime
    $t10 = Get-Date
    Say "  service started at $(T $t10)"
    SaySessionLock
    $tray10 = $null
    $waited = 0
    while ($waited -lt 90 -and -not $tray10) {
        $t = Trays
        if ($t.Count -eq 1 -and $t[0].Id -ne $preStopPid) { $tray10 = $t[0] }
        if (-not $tray10) { Start-Sleep 2; $waited += 2 }
    }
    if ($tray10) {
        Say "  tray pid $($tray10.Id) at $(Get-Date -Format HH:mm:ss), after $waited s"
    } else {
        Say "  FAIL: no new tray within 90 s of the start"
    }
    $c = WaitTrayLine "pipe: connected" 60
    if ($c -ge 0) {
        Say "  tray.log shows pipe: connected after $c s"
    } else {
        Say "  FAIL: tray.log never showed pipe: connected within 60 s"
    }
    $tCounting10 = $null
    $counting10 = WaitLog ($t10.AddSeconds(-15)) "counting \(session" 90
    if ($counting10) {
        $tCounting10 = $counting10.TimeCreated
        Say "  counting at $(T $tCounting10): $(OneLine $counting10)"
    } else {
        Say "  FAIL: no counting line within 90 s of the start"
    }
    $tUsed10 = $null
    if ($tCounting10) {
        $used10 = WaitLog $tCounting10 "out of time, the engine says locked" 120
        if ($used10) {
            $tUsed10 = $used10.TimeCreated
            Say "  used up at $(T $tUsed10): $(OneLine $used10)"
        } else {
            Say "  FAIL: no out-of-time line within 120 s of the counting line"
        }
    }
    $tLocked10 = $null
    if ($tUsed10) {
        $locked10 = WaitLog $tUsed10 "tray \d+: locked" 15
        if ($locked10) {
            $tLocked10 = $locked10.TimeCreated
            Say "  tray confirmed the lock at $(T $tLocked10): $(OneLine $locked10)"
        } else {
            Say "  FAIL: no tray-confirmed lock line within 15 s of being used up"
        }
    }
    SayTrayTail
    if ($tUsed10 -and $tLocked10) {
        $g10 = Gap $tUsed10 $tLocked10
        if ($g10 -le 5) {
            Say "criterion 10 a normal run locked within 5 s of being used up: PASS (used up at $(T $tUsed10), locked at $(T $tLocked10), $g10 s)"
        } else {
            Say "criterion 10 a normal run locked within 5 s of being used up: FAIL (used up at $(T $tUsed10), locked at $(T $tLocked10), $g10 s)"
        }
    } else {
        Say "criterion 10 a normal run locked within 5 s of being used up: FAIL (used up at $(T $tUsed10), locked at $(T $tLocked10))"
    }
} else {
    Say "criterion 10 a normal run locked within 5 s of being used up: FAIL (no valid enrolment code from the host)"
}

Say "=== 12. diagnostics"
Say "  every ScreenTime.Service line from the stall flag at $(T $tFlag) on:"
foreach ($e in @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; ProviderName = "ScreenTime.Service"; StartTime = $tFlag } -ErrorAction SilentlyContinue) | Sort-Object TimeCreated) {
    Say "  $($e.TimeCreated.ToString('HH:mm:ss')) $((OneLine $e))"
}
Say "  the service control manager from the stall flag on (start, stop and restart of the service):"
foreach ($e in @(Get-WinEvent -FilterHashtable @{ LogName = "System"; ProviderName = "Service Control Manager"; StartTime = $tFlag } -ErrorAction SilentlyContinue) | Sort-Object TimeCreated) {
    Say "  $($e.TimeCreated.ToString('HH:mm:ss')) id $($e.Id) $((OneLine $e))"
}
if (Test-Path $flag) { Say "  stall flag still present: $flag" } else { Say "  stall flag gone: $flag" }
SayImagepath
Say "  service status: $((Get-Service ScreenTime).Status)"
$svcEnd = Get-Process -Name ScreenTime.Service -ErrorAction SilentlyContinue | Select-Object -First 1
if ($svcEnd) { Say "  service pid: $($svcEnd.Id)" } else { Say "  service pid: none" }
$tEnd = Trays
$pids = ($tEnd | ForEach-Object { $_.Id }) -join " "
Say "  tray processes in session ${session}: $($tEnd.Count) ($pids)"
Say "done"
Stop-Computer -Force
