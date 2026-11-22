# CARD-073: The PC service must not stall, and must lock even if it does

| Field | Value |
|---|---|
| Card | CARD-073 |
| Title | The PC service must not stall, and must lock even if it does |
| Size | M |
| Depends on | none (CARD-072 is not needed) |
| Spec sections | docs/SPEC.md §12.2 (read "ScreenTime.Service", "Lock (Q7)" and "Stall guard"), §7 (the engine, for context only; it is correct and does not change) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-073-service-stall-guard` |
| PR title | `CARD-073: The PC service must not stall, and must lock even if it does` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**What happened (the reason for this card).** On Saturday 21 Nov 2026 Conor's gaming PC did not lock when his 180-minute allowance ran out at about 19:08. It ran until the 21:00 bedtime lock, 1 h 52 min over. Claude read the production database and the server's request log:

- Saturday's schedule was 180 minutes, bedtime 21:00; Conor had used about 1 minute before 16:09. The engine is right: it says "locked" once the allowance is gone.
- The PC recorded one unbroken usage segment, 16:09:20 to 21:00:33 (Sydney), 291 minutes. No grants, no parent mode, no events.
- After the session started (16:09:23, when the PC opened its live connection and sent its usage) the PC made **no request to the server at all until 21:00:12**, when it reconnected. While a kid is using a PC the service normally asks `GET /v1/device/state` every minute (Ciara's PC did exactly that during the same hours). The lock, 21:00:33, came about 30 s after the reconnect.

So for 4 h 51 min the service's 1-second lock loop and its 60-second sync loop both did nothing. **The root cause on that PC is not proven.** The likeliest cause is in `windows/src/ScreenTime.Service/`:

- `Worker.cs` runs the lock loop (every 1 s), the sync loop (every 60 s), the session events, the tray messages and the live channels each behind **one** `SemaphoreSlim` (`_sem`). Whatever holds it with no end stops all of them.
- `TrayHost.SendAsync` writes to the tray's named pipe with `WriteAsync` and `FlushAsync` and **no timeout**, and the pipe is made with buffer sizes of 0 (`TrayHost.PipeLoopAsync`), so a write waits until the tray reads it. `SendToast`, `SendView`, the `Lock` step and `SendGames` all call it while holding `_sem`. A tray that is alive but not reading (frozen, suspended, starved) would wedge the whole service, and the `Disconnect` fallback of the lock (§12.2, 2 s) sits behind the same write and never runs.

Claude has not been able to read that PC's Windows Application event log. James may paste it later (service lines between 16:09 and 21:00 on 21 Nov); if it names a different cause, it goes in "Blockers / questions" and the card is fixed to match. Do not wait for it: this card makes the service safe against the whole class of stall, whatever the first cause was.

## 2. Goal

(1) No single slow or stuck call (a pipe write, a server call, a Windows call) can stop the lock loop for more than a few seconds. (2) A kid session that is out of time is locked within 15 s even when the tray is frozen. (3) If the service ever does stop making progress, it notices, says so in its log, and restarts itself, and the restarted service locks an out-of-time session at once (§12.2 already does this on start).

## 3. Out of scope

- Any change to the time engine (`Engine.cs`, `engine.ts`, `Engine.kt`) or `test-vectors/engine/`.
- Any change to what counts as time, to parent mode, to the warnings, to Android, to the server or to the web and parent apps.
- Tray (`windows/src/ScreenTime.Tray/`) UI files. A change to the tray's pipe reading is allowed only if the Sandbox run proves the service-side fix is not enough, and you list it as a deviation.
- A new tamper event or a parent notification for a restart (log lines only).
- Changing the 2 s / 10 s lock timings of §12.2.

## 4. Tech and traps

- `pwsh` 7 only. UTF-8 without BOM. 4-space indent in C#.
- Native AOT: JSON needs the source-generated contexts; do not add reflection.
- Put the logic where it can be unit tested: `windows/src/ScreenTime.Core/Service/` (see `LockKeeper.cs`, which only decides and is tested in `windows/tests/ScreenTime.Core.Tests/`). Keep `Worker.cs` and `TrayHost.cs` thin.
- `Worker.cs` is 1,100+ lines: read `ExecuteAsync` (lines ~95-300), `Apply` (~525), `OnTrayMessage` and `TrayHost.cs` only.
- Windows runs only in Windows Sandbox (never on James's desktop, never `Stop-Process` by name on his PC). Copy `windows/installer/sandbox/Test-TrayExit.ps1` and `in-sandbox-trayexit.ps1` as the pair for your run. A tray that is alive but not reading can be made in the Sandbox by suspending the tray process with `NtSuspendProcess` (P/Invoke from PowerShell) on the process of `ScreenTime.Tray.exe` in session 1.
- The service installs with restart on failure (0 s, 5 s, 30 s, §12.2). A self-restart must use that: the service ends its own process with a non-zero exit code (so Windows counts it as a failure), after logging why. Check how `Program.cs` and the installer register recovery before you rely on it, and print what you found.

## 5. Design (what to build)

Behaviour, not code; you choose the shapes.

1. **Bound every tray write.** A write to a tray's pipe that has not finished in 3 s is given up: the writer is dropped, the pipe is disconnected so the tray reconnects as it does after any pipe loss, and the call returns. A later message goes to the reconnected tray. No exception escapes to the caller.
2. **The lock must not need the tray.** The lock step's order stays (tell the tray; after 2 s with no confirmation, `Disconnect`), but both the 2 s and the disconnect must happen even when the tray write is still stuck or was just given up. So the write is not awaited inline by the lock loop: it is started, and the loop moves on.
3. **No unbounded wait under `_sem`.** List every `await` made while `_sem` is held (`ExecuteAsync`'s loops, `OnSessionEvent`, `OnTrayMessage`, the sync, `SendToast`, `SendView`, `SendGames`). Each either has a bound (3 s for pipe work; the existing 30 s for server calls) or is taken out of the held section. Keep this list in the PR.
4. **The lock loop does not queue behind slow work.** A pass of the 1-second lock loop waits for `_sem` at most 2 s. If it cannot get it, it logs `lock loop: waited for the service lock ({Holder})` (once per stall, with a name for the holder: record which operation took `_sem` last) and goes on with the checks that need no shared state it cannot read: it must still be able to lock an unlocked session that the engine says is out of time (from the data it already has in memory and the store).
5. **A watchdog.** A thread that does not use `_sem` checks every 5 s when the lock loop last finished a pass. No pass for 60 s while any kid session is unlocked (or in parent mode) → log an error naming the last holder and then end the process with a non-zero exit code. No pass for 60 s with nobody using the PC → the same (a stalled service is wrong either way). The watchdog's timing and decision are a pure function in `ScreenTime.Core` (`StallWatch` or similar: "last pass", "now", "someone using", returns Ok / Log / Restart).
6. **After a restart** nothing special is needed: §12.2's service start finds the unlocked session, evaluates, and an out-of-time session gets the toast and the relock after 10 s. The restart must not leave two trays in a session (CARD-049b).

Write the new rule in `docs/SPEC.md` §12.2 only as the "Stall guard" paragraph Claude has added; do not edit other spec text.

## 6. Acceptance criteria

Unit (`windows/tests/ScreenTime.Core.Tests/StallWatchTests.cs`, new, and a test of your bounded-write helper; fixed times in epoch milliseconds, no clock reads):

1. `StallWatch`: last pass 1 s ago → Ok; last pass 59 s ago, someone using → Ok (not yet); 60 s ago, someone using → Restart; 60 s ago, nobody using → Restart; 30 s ago → Log once (a second call 31 s ago still says Log only if you chose repeats: state your choice in the handback and test it).
2. A write that completes in 100 ms returns normally. A write that never completes returns within 3 s plus 200 ms (use a fake stream that never reads and a fake clock or a real 3 s wait: say which) and reports "given up". A write to a stream that throws `IOException` returns without throwing.
3. After "given up", the next message goes out normally when the fake stream reads again.
4. `LockKeeper` tests unchanged and passing (the lock steps and their timings did not change).

Service behaviour, in Windows Sandbox (`windows/installer/sandbox/Test-Stall.ps1` + `in-sandbox-stall.ps1`, from the TrayExit pair; prints `PASS` or `FAIL` and every line it saw):

5. Install the MSI built from your branch, enrol the account as Sam with **1 minute** of Screens time (`dev-bedtime.ts` shows how a schedule is set; use the weekday of the run), unlock the session. Record the time the 1 minute is used up.
6. **Frozen tray.** Before the minute is up, suspend `ScreenTime.Tray.exe` in session 1. The session is locked (`WTSQuerySessionInformation` says locked, or the service log shows `tray did not lock, disconnecting session`) within **15 s** of the minute being used up. Print both the used-up time and the lock time, and the service log lines.
7. **No stall of the loops.** While the tray is suspended, the dev server's request log (or `last_seen_at` of the device, printed twice 70 s apart) shows the service still syncing every minute.
8. **Stall of the lock itself (the watchdog).** Use a test-only switch you add to the service for the run only (for example `--stall-test-file <path>`: while the file exists the lock loop sleeps instead of working; it must do nothing in a normal run, and its name and effect go in the handback). With a session unlocked and out of time, create the file: within **90 s** the service log shows the stall error and the service process has a new process id (print both ids), and within 15 s after that the session is locked.
9. After criterion 8 exactly one `ScreenTime.Tray.exe` runs in session 1, and no `tamper.` event for this PC is in the dev database (print the query).
10. A normal run still works: a 1-minute allowance with a healthy tray locks within 5 s of being used up (print it).

Whole card:

11. Section 8 passes. `git diff --name-only main` lists only `windows/src/ScreenTime.Core/Service/`, `windows/src/ScreenTime.Service/`, `windows/tests/`, `windows/installer/sandbox/`, and (if used and listed as a deviation) one pipe-reading file in `windows/src/ScreenTime.Tray/`. Nothing under `server/`, `android/`, `web/`, `packages/`, `contract/`, `test-vectors/`.

**Break it yourself** (paste each failing test or run; restore with `git checkout -- <file>`):

- Remove the 3 s bound on the tray write (await it inline again) → criteria 2 and 6 fail (6 prints no lock within 15 s).
- Make the watchdog's limit 600 s → criterion 1 fails, and 8 fails.
- Make the lock loop wait for `_sem` with no limit again → criterion 6 or 8 fails.

## 7. Tests you write

One test per unit criterion, named after the behaviour, with the card's fixed numbers. Changing what an existing test checks is a deviation: list it.

## 8. Checks

From the repo root, in `pwsh`. Run each slow command once with its output saved to a file in `C:\Users\james\OpenCode\Testing\temp\`, then search the file (AGENTS.md, "Saving test output").

```powershell
cd windows
dotnet build *> C:\Users\james\OpenCode\Testing\temp\card073-build.txt; "exit $LASTEXITCODE"
dotnet test *> C:\Users\james\OpenCode\Testing\temp\card073-dotnet.txt; "exit $LASTEXITCODE"
cd ..
Select-String -Path C:\Users\james\OpenCode\Testing\temp\card073-*.txt -Pattern 'error|Passed!|Failed!|Build succeeded'
pwsh -File windows\installer\build-msi.ps1
pwsh -File windows\installer\sandbox\Test-Stall.ps1 -Msi <the MSI it printed>
git diff --name-only main
```

## 9. Git and pull request

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-073-service-stall-guard`.
2. Small commits: `CARD-073: <what changed>`.
3. Run section 8 again before pushing.
4. `git push -u origin bob/card-073-service-stall-guard`; open a PR into `main` titled `CARD-073: The PC service must not stall, and must lock even if it does`, body in a file in `C:\Users\james\OpenCode\Testing\temp\` with: Card, What I did, the list of every `await` under `_sem` and what you did to each (design item 3), Acceptance criteria (each with its proof and output), Deviations from the card, Blockers / questions.
5. **Do not merge.** Do not push to `main`.

## 10. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". In particular: if the frozen-tray run (criterion 6) shows the lock **works** with the old code, the pipe is not the cause: say so with the output, keep the other criteria, and do not guess a new design. If the service cannot restart itself (criterion 8), report what `Program.cs` and the installer set for recovery.

## 11. Handback report (required)

Your **last message to James**, inside one fenced code block. Real output only; `NOT RUN` with the reason for anything you did not run. Every Sandbox step's **real printed output**, not a summary. Every workaround is a deviation.

````text
Claude, here is Bob's handback for CARD-073. Please review and merge if it is good.

CARD: CARD-073 The PC service must not stall, and must lock even if it does
PR: <full PR URL>
Branch: bob/card-073-service-stall-guard
Head commit: <git rev-parse HEAD>

Files changed (`git diff --name-only main...HEAD`):
<list>

Tests I wrote (file: test names, copied from the files):
<list>

Every await under the service lock, and what I did to each:
<list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>

Break it yourself (each change, the failing output, restored):
<list>

Windows Sandbox run (every line Test-Stall.ps1 and in-sandbox-stall.ps1 printed):
<paste>

Acceptance criteria:
- 1: <test or step> PASS|FAIL|NOT RUN
- ...
- 11: <test or step> PASS|FAIL|NOT RUN

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
