# CARD-049b: Windows: wire the tray to the service

| Field | Value |
|---|---|
| Card | CARD-049b |
| Title | Windows: wire the tray to the service |
| Size | M |
| Depends on | CARD-049 (PR #126) and the tray's `TrayModel.Quit` (PR #127), both merged to `main` |
| Spec sections | docs/SPEC.md §12.2 (pipe), §16.3 (Windows tray), Q7 (warnings) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-049b-tray-wiring` |
| PR title | `CARD-049b: Windows: wire the tray to the service` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

`AGENTS.md` rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command and every run step** and lists every workaround. Rule 10: never change Claude's front-end files.

What is already on `main`:

- **CARD-048**: `ScreenTime.Service` keeps one `KidSession` per kid session (a `LockKeeper` and a `TrayHost`), a 1 s lock loop, and `SyncAccount`, which syncs one account and today sends the tray a `status` message.
- **Claude's tray front end** (PR #124, #127): the icon, the flyout and the toasts in `ScreenTime.Tray`, and the seam `TrayModel`: the pipe calls `model.Update(TrayStatus)`, `model.Toast(text)` and `model.Quit()`.
- **CARD-049** (PR #126): in `ScreenTime.Core.Tray`, `TrayStatusBuilder.From(...)`, `WarningTracker`, `GrantToasts`, and `PipeMessage.ViewOf(TrayStatus)`, the `view` message.

This card **connects them**. Two files change:

1. **`ScreenTime.Service/Worker.cs`**: send the tray a `view` (instead of `status`) after every sync and on hello, and whenever the session becomes locked or unlocked; send the warning toasts every second and the grant toasts after a sync.
2. **`ScreenTime.Tray/TrayPipe.cs`**: pass `view` messages to the model, and quit the tray when the service has been gone for 30 s (a tray used to stay running after the service stopped).

Claude has already run this exact change on James's PC: section 8.3 shows what to expect.

## 2. Goal

- `dotnet build` and `dotnet test` pass in `windows/` (**total 194**, no new tests: this card is wiring). CI **Windows / build and test** is green.
- The run in 8.3 shows: the tray gets a `view`; the two warning toasts and a grant toast arrive once each; running out of time sends an "Out of Screens time" view and a (dry-run) lock; 30 s after the service stops, the tray exits by itself.

## 3. Out of scope

- Any other file. In particular **do not touch** Claude's front-end files (`App.xaml(.cs)`, `FlyoutWindow.*`, `TrayIcon.cs`, `TrayModel.cs`, `Toasts.cs`, `DemoStatus.cs`, `Assets/*`, `Core/Tray/TrayStatus.cs`), nor anything in `ScreenTime.Core`, nor the tests.
- Do not remove `PipeMessage.Status` or the tray's `case "status":` (CARD-048's tests use the message). The service simply stops sending it.
- The Ask, Message and parent mode dialogs (CARD-050). Tamper events (CARD-051). Installing the service (CARD-052).
- **Do not install or start the Windows service** (`sc.exe create` and `New-Service` are not allowed). **Never run the service without `--dry-lock`** on James's PC.

## 4. Tech

- .NET 10, nullable on, warnings are errors. `ScreenTime.Service` has `PublishAot`: no reflection.
- **The service only enforces the console session** (docs/SPEC.md §12.2). Over Remote Desktop the console session is not yours, so the service starts no tray and 8.3 shows nothing. **Do the run sitting at James's PC**, not over Remote Desktop. `query user` shows it: your line must say `console`, not `rdp-tcp#…`.

## 5. Files to copy

None.

## 6. What to write

### 6.1 `windows/src/ScreenTime.Service/Worker.cs` (changed)

Make exactly these changes. The code blocks are the code to write.

**a. Using.** Add `using ScreenTime.Core.Tray;` after `using ScreenTime.Core.Time;`.

**b. Two fields**, after `_sem`:

```csharp
    private readonly Dictionary<string, (bool Online, long? SyncedAtMs)> _lastSync = new();
    private readonly Dictionary<string, GrantToasts> _grantToasts = new();
```

**c. `KidSession`** gets two more properties, after `Unlocked`:

```csharp
        public WarningTracker Warnings { get; } = new();
        public bool? SentLocked { get; set; }
```

**d. Replace the private method `Status(string sid, bool offline)`** (and its summary) with these three methods:

```csharp
    /// <summary>What the tray shows for the SID now, or null when nothing is cached for it.</summary>
    private TrayStatus? View(string sid, long now)
    {
        if (_store.LoadState(sid) is not { } c) return null;
        var result = Engine.Evaluate(TodayInput.For(c.State, _store.SegmentsSince(sid, TodayInput.DayStartMs(c.State, now)), now));
        var last = _lastSync.GetValueOrDefault(sid, (true, null));
        return TrayStatusBuilder.From(c.State, result, now, last.Online, last.SyncedAtMs);
    }

    /// <summary>Sends <paramref name="view"/> to the session's tray and remembers whether it said locked.</summary>
    private async Task SendView(KidSession s, TrayStatus view)
    {
        s.SentLocked = view.Locked;
        await s.Tray.SendAsync(PipeMessage.ViewOf(view));
    }

    /// <summary>Logs and sends a toast to the session's tray.</summary>
    private async Task SendToast(KidSession s, string text)
    {
        logger.LogInformation("{Kid}: toast {Text}", KidName(s.Sid), text);
        await s.Tray.SendAsync(PipeMessage.Toast(text));
    }
```

**e. `SyncAccount`.** Right after `if (!synced) _tracker.MarkOffline(sid);`, remember the sync:

```csharp
        var previous = _lastSync.GetValueOrDefault(sid, (true, null));
        _lastSync[sid] = (synced, synced ? _clock.NowMs() : previous.SyncedAtMs);
```

Then, inside `if (cached is { } c)`, keep the `{Kid}: {Minutes} min left, locked {Locked}` log line and **replace** the two lines that build and send `PipeMessage.Status(...)` with:

```csharp
            if (!_grantToasts.TryGetValue(sid, out var grants)) _grantToasts[sid] = grants = new GrantToasts();
            var toasts = synced ? grants.Check(c.State) : [];
            var view = View(sid, now)!;
            foreach (var s in _sessions.Values.Where(s => s.Sid == sid).ToList())
            {
                await SendView(s, view);
                foreach (var text in toasts) await SendToast(s, text);
            }
```

**f. `OnTrayMessage`, `hello`.** Replace the line that sends `Status(...)` with:

```csharp
                    if (View(s.Sid, _clock.NowMs()) is { } view) await SendView(s, view);
```

**g. `Apply`, `LockStep.Toast`.** Replace `await s.Tray.SendAsync(PipeMessage.Toast(OutOfTimeToast));` with `await SendToast(s, OutOfTimeToast);`, so every toast is logged.

**h. The lock loop.** Inside the `foreach` over unlocked sessions, after the existing `await Apply(...)` line, add:

```csharp
                            if (View(s.Sid, now) is not { } view) continue;
                            if (s.Warnings.Check(view) is { } warning) await SendToast(s, warning);
                            if (s.SentLocked != view.Locked) await SendView(s, view);
```

The last line sends a fresh view the moment time runs out (or comes back) between syncs.

Nothing else in `Worker.cs` changes.

### 6.2 `windows/src/ScreenTime.Tray/TrayPipe.cs` (changed)

**a. The `view` message.** In the `switch (message?.Type)`, add this case before `case "status":`:

```csharp
                        case "view":
                            if (message.View is { } view)
                            {
                                log($"view: {view.Tooltip(view.LeftSec)}");
                                model.Update(view);
                            }
                            break;
```

**b. Quit when the service is gone.** In `RunAsync`:

1. Before `while (true)`: `var lastSeen = Environment.TickCount64;`
2. Set `lastSeen = Environment.TickCount64;` in three places: right after `log("pipe: connected");`, right after the `log("pipe: closed");` at the end of the `try`, and right after the `log("pipe: closed");` in the `catch (IOException)`.
3. Just before `await Task.Delay(1_000);` at the end of the loop:

```csharp
            if (Environment.TickCount64 - lastSeen >= 30_000)
            {
                log("pipe: no service for 30 s, exiting");
                model.Quit();
                return;
            }
```

`model.Quit()` (Claude's front end) removes the icon, logs `tray: exiting` and exits. When the service comes back, it starts a new tray.

Nothing else in `TrayPipe.cs` changes.

## 7. Steps

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-049b-tray-wiring`. Check that `windows/src/ScreenTime.Core/Tray/GrantToasts.cs` exists and that `windows/src/ScreenTime.Tray/TrayModel.cs` contains `public void Quit()`. If not, stop.
2. Make the changes in 6.1 and 6.2.
3. From `windows\`: build until it passes with 0 errors and 0 warnings; when an error is not clear to you after one try, paste it in the handback and stop. Then run the tests.
4. Sit at James's PC (not Remote Desktop) and do the run in 8.3, pasting every output.
5. Commit `CARD-049b: Windows: wire the tray to the service`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From `windows\`: `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] From `windows\`: `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 194**. Paste the summary lines.
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Service\*.cs,windows\src\ScreenTime.Tray\*.cs -Pattern 'DllImport|Log\w*\(.*[Tt]oken'` prints nothing.
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Service\Worker.cs -Pattern 'PipeMessage\.Status'` prints nothing.

### 8.2 Repo

- [ ] `git status` clean. No `bin\`, `obj\`, `state.db`, `config.json`, `clock.json` or `*.log` in the repo.
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 2 files:
  ```
  windows/src/ScreenTime.Service/Worker.cs
  windows/src/ScreenTime.Tray/TrayPipe.cs
  ```

### 8.3 The run on James's PC (at the PC, console, dry-lock, no admin, no service install)

Paste the **real output of every line**. A step without output counts as NOT RUN. Docker Desktop must be running. Use one PowerShell window, from the repo root, and keep the variables set. The run moves Sam's bedtime to 2 hours from now, so **start it before 9:30 pm** (Sydney time).

1. Check the session, then the local server, the dev family and the paths:
   ```powershell
   query user
   Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
   $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
   $env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
   pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
   $tmp = "C:\Users\james\OpenCode\Testing\temp"
   $t = "$tmp\c49b"
   $log = "$tmp\c49b-service.log"
   $trayLog = "$env:LOCALAPPDATA\ScreenTime\tray.log"
   $svcExe = (Resolve-Path "windows\src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe").Path
   $trayExe = (Resolve-Path "windows\src\ScreenTime.Tray\bin\Release\net10.0-windows10.0.26100.0\win-x64\ScreenTime.Tray.exe").Path
   Remove-Item $trayLog -ErrorAction SilentlyContinue
   function Grant([int]$minutes) { pnpm --silent --filter @screentime/server exec tsx scripts/dev-grant.ts Sam screens $minutes }
   function Bedtime([int]$minutes, [int]$allowance = 720) { pnpm --silent --filter @screentime/server exec tsx scripts/dev-bedtime.ts Sam $minutes $allowance }
   function Svc([string[]]$more) { Start-Process $svcExe -ArgumentList (@("--data", $t, "--dry-lock") + $more) -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru }
   ```
   `query user` must show your line with `console`. If it says `rdp-tcp#…`, stop: you are on Remote Desktop (section 4). If either `Resolve-Path` fails, run `dotnet build ScreenTime.slnx -c Release` from `windows\` first.
2. Enrol your own account as Sam, and give Sam 25 minutes with bedtime in 2 hours:
   ```powershell
   $code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
   & $svcExe enrol --server http://localhost:8080 --code $code --user $env:USERNAME --data $t
   Bedtime 120 25
   ```
   Expect `Enrolled <you> as Sam (device …).` and `Bedtime for Sam today is now … allowance 25 min …`. Never print `$code`.
3. Start the service with the tray:
   ```powershell
   $p = Svc @("--tray", $trayExe); Start-Sleep 15
   Select-String $log -Pattern "live Sam|tray .*: (started|hello)|min left" | ForEach-Object Line
   Get-Content $trayLog
   ```
   Expect `tray N: started pid …`, `live Sam: connected`, `Sam: 25 min left, locked False`, `tray N: hello pid …`, and in the tray log `pipe: connected` and `view: Screens · 25m left` (24m is fine).
4. The warnings and a grant toast:
   ```powershell
   Grant -15; Start-Sleep 8
   Bedtime 4; Grant 15; Start-Sleep 8
   Select-String $log -Pattern "toast" | ForEach-Object Line
   Get-Content $trayLog | Select-String "toast:|view:"
   ```
   `Grant -15` leaves about 9 minutes, under the 15-minute warning. `Bedtime 4` moves bedtime to 4 minutes from now (and the allowance back to 12 hours), and `Grant 15` makes the PC sync at once. Expect, once each, in both logs: `15 minutes of Screens left`, `Dad added 15 minutes` and `5 minutes left. Save your work.`, and tray `view:` lines going from about `25m` to about `9m` to about `4m`. Toasts also pop up on the screen: that is expected.
5. Out of time:
   ```powershell
   Grant -900; Start-Sleep 6
   Select-String $log -Pattern "locking|would disconnect" | ForEach-Object Line
   Get-Content $trayLog | Select-String "view:|lock:" | Select-Object -Last 3
   ```
   Expect `Sam: locking session N`, **no** `would disconnect`, and in the tray log `view: Out of Screens time` and `lock: dry run`.
6. The tray quits when the service is gone:
   ```powershell
   $trayPid = (Get-Process ScreenTime.Tray).Id
   Stop-Process -Id $p.Id; Start-Sleep 40
   "tray still running: $([bool](Get-Process -Id $trayPid -ErrorAction SilentlyContinue))"
   Get-Content $trayLog | Select-Object -Last 3
   ```
   Expect `tray still running: False`, and the tray log ending `pipe: closed`, `pipe: no service for 30 s, exiting`, `tray: exiting`.
7. Clean up:
   ```powershell
   Get-Content "$log.err"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item -Recurse $t, $log, "$log.err", $trayLog
   ```
   Paste `$log.err` (it should be empty).

What Claude saw on the same run (times and pids differ):

```
      tray 1: started pid 20236
      live Sam: connected
      Sam: 25 min left, locked False
      tray 1: hello pid 20236
19:17:40 pipe: connected
19:17:40 view: Screens · 25m left
      Sam: toast 15 minutes of Screens left
      Sam: toast Dad added 15 minutes
      Sam: toast 5 minutes left. Save your work.
19:17:55 view: Screens · 9m left
19:17:56 toast: 15 minutes of Screens left
19:18:06 view: Screens · 4m left
19:18:06 toast: Dad added 15 minutes
19:18:06 toast: 5 minutes left. Save your work.
      Sam: locking session 1
19:18:15 view: Out of Screens time
19:18:16 lock: dry run
tray still running: False
19:18:21 pipe: closed
19:18:51 pipe: no service for 30 s, exiting
19:18:51 tray: exiting
```

## 9. Tests

No new tests: the logic is in CARD-049's tested classes, and this card only wires them. The 194 existing tests must still pass. The run in 8.3 is the check.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-049b-tray-wiring
   ```
2. Commit with the message `CARD-049b: Windows: wire the tray to the service`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-049b-tray-wiring`
5. Write the PR body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` and open the PR with `gh pr create --base main --title "CARD-049b: Windows: wire the tray to the service" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body:
   ```markdown
   ## Card
   docs/cards/CARD-049b-tray-wiring.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] criterion 1 — output: `...`
   - [x] criterion 2 — output: `...`

   ## 8.3 run
   (the real output of every step)

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Never change Claude's front-end files.

- **Step 3 has no `tray N: started`**: run `query user`. If your line is not `console`, you are on Remote Desktop: do the run at the PC. Otherwise paste the whole `$log` and `$log.err` and stop.
- **Step 3 has no `view:` line in the tray log**: paste the whole `$log` and `$trayLog` and stop.
- **A toast is missing or comes twice in step 4**: paste both logs in full and stop. Do not rerun the step to make it pass.
- **`dev-grant` prints its usage line**: the minutes must be a multiple of 15. The card's numbers are; check you typed them as written.
- **`Bedtime` says bedtime after midnight is not supported**: it is after 9:30 pm in Sydney. Do the run earlier in the day.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own review, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- Paste the real output of **every** run step. A step without its pasted output counts as `NOT RUN`, and Claude sends the PR back.
- Every workaround (restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-049b. Please review and merge if it is good.

CARD: CARD-049b Windows: wire the tray to the service
PR: <full PR URL>
Branch: bob/card-049b-tray-wiring
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

8.3 run (every step, real output):
<step 1 … step 7>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
