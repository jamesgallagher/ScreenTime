# CARD-050d: Windows: wire parent mode to the service

| Field | Value |
|---|---|
| Card | CARD-050d |
| Title | Windows: wire parent mode to the service |
| Size | M |
| Depends on | CARD-050c (PR #138), merged to `main` |
| Spec sections | docs/SPEC.md §12.3 (parent mode), §16.3 (Windows tray), §12.2 (pipe) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-050d-parent-wiring` |
| PR title | `CARD-050d: Windows: wire parent mode to the service` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

`AGENTS.md` rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command and every run step** and lists every workaround. Rule 10: never change Claude's front-end files.

What is on `main`:

- **Claude's front end** (PR #136): the tray's parent mode panel and **End now**. The flyout calls `ITraySender.RequestParentModeAsync`, `CheckParentCodeAsync`, `StartParentModeAsync` and `EndParentModeAsync` (today they have "not wired yet" bodies), and shows "Dad said no." through `TrayModel.ParentModeNo(text)`.
- **CARD-050c** (PR #138), in `ScreenTime.Core.Service`: `Totp.Ok`, `CodeSession`, `LocalParentMode`, `ParentModes.Now`, `ParentModes.Effective` (the snapshot with parent mode as it is now), `ParentModes.NoText`, `Live.ParentModeAnswer`, and the pipe lines `parent-ask`, `parent-code`, `parent-start`, `parent-end`, `done` and `parent-no`.

This card **connects parent mode end to end**. Two files change:

1. **`ScreenTime.Service/Worker.cs`**
   - keeps this PC's `LocalParentMode` per account, and uses the **effective** snapshot everywhere, so `LockKeeper` stops locking and the tray shows "Parent mode · ends 4:15 pm";
   - **stops counting** while parent mode is on (it ends the segment, as at a lock) and counts or locks again when it ends;
   - answers the tray's four parent lines: asks the parents through the server, **checks the parent code itself** (the family secret never goes to the tray, which runs as the kid), starts a code session within 2 minutes of a right code, and records End now;
   - **reports** a code session and End now to the server before each sync until the server has them;
   - sends "Dad said no." to the tray when a parent refuses this PC's request.
2. **`ScreenTime.Tray/TrayPipe.cs`**: implements the four parent calls of `ITraySender`, and passes `done` and `parent-no` on.

Claude has already run this exact change on James's PC over Remote Desktop: section 8.3 shows what to expect.

## 2. Goal

- `dotnet build` and `dotnet test` pass in `windows/`: **total 236** (no new tests: the logic is CARD-050c's, tested there). CI **Windows / build and test** is green.
- The run in 8.3 shows: a parent's no reaches the tray; the parent code starts parent mode, which is reported to the server, stops counting and stops locking; End now is reported and locking comes back; a parent's yes from the app and their end work too.

## 3. Out of scope

- Any other file. In particular do not touch Claude's front-end files (`App.xaml(.cs)`, `FlyoutWindow.*`, `ITraySender.cs`, `TrayModel.cs`, `TrayIcon.cs`, `Toasts.cs`, `DemoStatus.cs`, `Assets/*`, `Core/Tray/TrayStatus.cs`), nor anything in `ScreenTime.Core`.
- Keeping a code session across a service restart. In this card `LocalParentMode` lives in memory: a code session not yet reported is lost if the service stops. Hardening (CARD-051) stores it.
- Tamper events (CARD-051). Installing the service (CARD-052).
- **Do not install or start the Windows service** (`sc.exe create` and `New-Service` are not allowed). **Never run the service without `--dry-lock`** on James's PC.

## 4. Tech

- .NET 10, nullable on, warnings are errors. `ScreenTime.Service` has `PublishAot`: no reflection.
- **Server calls never hold up the pipe or the lock loop**: "I'm the parent" goes through `Task.Run`, as asks and messages do (CARD-050b). The code check, start and end are local and answer at once; reporting to the server happens in `SyncAccount`, before the sync.
- The run works at the PC **and** over Remote Desktop (`--session`, as in CARD-050b).

## 5. Files to copy

None.

## 6. What to write

Make exactly these changes. The code blocks are the code to write.

### 6.1 `windows/src/ScreenTime.Service/Worker.cs` (changed)

**a. `KidSession`** gets three more properties, after `SentLocked`:

```csharp
        public bool? SentParentMode { get; set; }
        public bool InParentMode { get; set; }
        public long? CodeOkAt { get; set; }
```

`InParentMode` means the session is in use during parent mode: not counting, not locking. `CodeOkAt` is when the tray last sent a right parent code.

**b. Two fields**, after `_skipGrants`:

```csharp
    private readonly Dictionary<string, LocalParentMode> _parentLocal = new();
    private readonly Dictionary<string, string> _parentAsks = new();
```

`_parentLocal` is what this PC did about parent mode, per SID; `_parentAsks` is the id of the latest "I'm the parent" request, per SID.

**c. The lock loop.** It now visits sessions in parent mode too. Replace the `foreach` over `_sessions.Values.Where(s => s.Unlocked)` and its body with:

```csharp
                        foreach (var s in _sessions.Values.Where(s => s.Unlocked || s.InParentMode).ToList())
                        {
                            var parentMode = ParentModeOn(s.Sid, now);
                            if (s.Unlocked && parentMode) EnterParentMode(s, now);
                            else if (s.InParentMode && !parentMode) LeaveParentMode(s);
                            if (s.Unlocked) await Apply(s, s.Keeper.Check(OutOfTime(s.Sid, now), now), now);
                            if (View(s.Sid, now) is not { } view) continue;
                            if (s.Warnings.Check(view) is { } warning) await SendToast(s, warning);
                            if (s.SentLocked != view.Locked || s.SentParentMode != view.ParentMode) await SendView(s, view);
                        }
```

**d. Session events.** Where `Lock`, `Disconnect` and `Logoff` set `s.Unlocked = false;`, and where `Suspend` and `Shutdown` set `each.Unlocked = false;`, also set `InParentMode = false` on the same session.

**e. `Unlock`, and entering and leaving parent mode.** Replace `Unlock` and `OutOfTime` with:

```csharp
    private void Unlock(KidSession s)
    {
        var now = _clock.NowMs();
        // Unlocked during parent mode: nothing counts and nothing locks until it ends (§12.3).
        if (ParentModeOn(s.Sid, now))
        {
            s.InParentMode = true;
            return;
        }
        s.Unlocked = true;
        // Only StartCounting or Toast: neither waits on the pipe for long.
        _ = Apply(s, s.Keeper.OnUnlock(OutOfTime(s.Sid, now), now), now);
    }

    /// <summary>Parent mode started while the session is in use: stop counting, as at a lock, and stop locking.</summary>
    private void EnterParentMode(KidSession s, long now)
    {
        s.Unlocked = false;
        s.InParentMode = true;
        s.Keeper.OnLocked();
        logger.LogInformation("{Kid}: parent mode on, not counting", KidName(s.Sid));
        foreach (var sid in _tracker.OnChange(SessionChange.Lock, s.Sid, true, now)) _syncRequests.Writer.TryWrite(sid);
    }

    /// <summary>Parent mode ended: the session counts (or locks) again as if it had just been unlocked.</summary>
    private void LeaveParentMode(KidSession s)
    {
        s.InParentMode = false;
        logger.LogInformation("{Kid}: parent mode over", KidName(s.Sid));
        if (Win.SessionUnlocked(s.SessionId)) Unlock(s);
    }

    /// <summary>The cached snapshot with parent mode as it is now (this PC's code session and End now included).</summary>
    private DeviceState? StateNow(string sid, long now) =>
        _store.LoadState(sid) is { } c ? ParentModes.Effective(c.State, Local(sid), now) : null;

    /// <summary>What this PC did about parent mode for the SID; nothing yet when it did nothing.</summary>
    private LocalParentMode Local(string sid) => _parentLocal.GetValueOrDefault(sid) ?? new LocalParentMode();

    /// <summary>Whether parent mode is on for the SID now.</summary>
    private bool ParentModeOn(string sid, long now) => StateNow(sid, now) is { } state && LockKeeper.ParentModeOn(state, now);

    private bool OutOfTime(string sid, long now)
    {
        if (StateNow(sid, now) is not { } state) return false;
        var result = Engine.Evaluate(TodayInput.For(state, _store.SegmentsSince(sid, TodayInput.DayStartMs(state, now)), now));
        return LockKeeper.OutOfTime(result, state, now);
    }
```

**f. `View` and `SendView`.** In `View`, use the effective snapshot: replace its first three lines (`LoadState`, `Engine.Evaluate`, and the `TrayStatusBuilder.From` call's `c.State`) so the method reads:

```csharp
    private TrayStatus? View(string sid, long now)
    {
        if (StateNow(sid, now) is not { } state) return null;
        var result = Engine.Evaluate(TodayInput.For(state, _store.SegmentsSince(sid, TodayInput.DayStartMs(state, now)), now));
        var last = _lastSync.GetValueOrDefault(sid, (true, null));
        return TrayStatusBuilder.From(state, result, now, last.Online, last.SyncedAtMs);
    }
```

In `SendView`, also remember parent mode: add `s.SentParentMode = view.ParentMode;` after `s.SentLocked = view.Locked;`, and make its summary end "…remembers whether it said locked or parent mode."

**g. The tray's parent lines.** In `OnTrayMessage`, add these cases after the `"ask" or "message"` case:

```csharp
                case "parent-ask" when m.Id is not null && Api(s.Sid) is { } api:
                    _parentAsks[s.Sid] = m.Id;
                    _ = Task.Run(() => AskParents(s, api, m.Id));
                    break;
                case "parent-code" when m.Id is not null:
                    {
                        // The service checks the code: the family secret never goes to the tray (the kid's process).
                        var now = _clock.NowMs();
                        var right = _store.LoadState(s.Sid) is { } c && Totp.Ok(c.State.Family.ParentCodeSecret, m.Text ?? "", now);
                        s.CodeOkAt = right ? now : null;
                        logger.LogInformation("{Kid}: parent code {Right}", KidName(s.Sid), right ? "right" : "wrong");
                        await s.Tray.SendAsync(PipeMessage.Done(m.Id, right));
                        break;
                    }
                case "parent-start" when m.Id is not null:
                    {
                        // Only within 2 minutes of a right code: "How long?" comes straight after it.
                        var now = _clock.NowMs();
                        var ok = s.CodeOkAt is { } at && now - at <= 120_000;
                        if (ok)
                        {
                            s.CodeOkAt = null;
                            _parentLocal[s.Sid] = Local(s.Sid) with { Code = new CodeSession(Guid.NewGuid().ToString(), m.Minutes, now) };
                            logger.LogInformation("{Kid}: parent mode on by code, {Minutes} min", KidName(s.Sid), m.Minutes?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "until ended");
                            _syncRequests.Writer.TryWrite(s.Sid);
                        }
                        await s.Tray.SendAsync(PipeMessage.Done(m.Id, ok));
                        break;
                    }
                case "parent-end" when m.Id is not null:
                    _parentLocal[s.Sid] = Local(s.Sid) with { EndedAtMs = _clock.NowMs(), EndReported = false };
                    logger.LogInformation("{Kid}: parent mode ended on this PC", KidName(s.Sid));
                    await s.Tray.SendAsync(PipeMessage.Done(m.Id, true));
                    _syncRequests.Writer.TryWrite(s.Sid);
                    break;
```

**h. A parent's no from the live channel.** In `OnFrame`, add as its last line:

```csharp
        if (Live.ParentModeAnswer(frame) is { Active: false, RequestId: { } requestId } no) _ = Task.Run(() => SendParentNo(sid, requestId, no.ByName));
```

**i. New methods**, after `OnFrame`:

```csharp
    /// <summary>"I'm the parent": asks every parent through the server and replies with how it went.</summary>
    private async Task AskParents(KidSession s, ApiClient api, string id)
    {
        SendResult result;
        try
        {
            await api.PostDeviceParentModeRequestsAsync(new ParentModeRequestCreate(id), _stopping);
            result = SendResult.Sent;
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
        {
            return;
        }
        catch (Exception e)
        {
            // A 409 means parent mode is already on, which is what the kid wanted.
            result = SendResults.Of(e);
        }
        logger.LogInformation("{Kid}: parent ask sent, {Result}", KidName(s.Sid), result);
        await s.Tray.SendAsync(PipeMessage.Reply(id, result));
    }

    /// <summary>A parent said no to this PC's latest "I'm the parent": "Dad said no." to its trays.</summary>
    private async Task SendParentNo(string sid, string requestId, string? byName)
    {
        await _sem.WaitAsync();
        try
        {
            if (!_parentAsks.TryGetValue(sid, out var asked) || asked != requestId) return;
            var names = _store.LoadState(sid)?.State.Parents.Select(p => p.DisplayName).ToList() ?? [];
            var text = ParentModes.NoText(byName, names);
            logger.LogInformation("{Kid}: parent mode {Text}", KidName(sid), text);
            foreach (var s in _sessions.Values.Where(s => s.Sid == sid).ToList()) await s.Tray.SendAsync(PipeMessage.ParentNo(text));
        }
        finally
        {
            _sem.Release();
        }
    }

    /// <summary>
    /// Sends what the server does not have yet, before each sync: a code session, then an End now (§12.3). Any answer
    /// from the server counts as sent; without a connection it stays for the next sync.
    /// </summary>
    private async Task ReportParentMode(string sid, ApiClient api, CancellationToken ct)
    {
        var local = Local(sid);
        if (!local.Pending) return;
        if (local.Code is { ReportedAtMs: null } code
            && await Delivered(() => api.PostDeviceParentModeAsync(new ParentModeByCode(code.Id, code.DurationMin, Iso(code.StartedAtMs)), ct), ct))
        {
            local = local with { Code = code with { ReportedAtMs = _clock.NowMs() } };
            logger.LogInformation("{Kid}: parent mode reported", KidName(sid));
        }
        if (!local.EndReported && await Delivered(() => api.PostDeviceParentModeEndAsync(ct), ct))
        {
            local = local with { EndReported = true };
            logger.LogInformation("{Kid}: End now reported", KidName(sid));
        }
        _parentLocal[sid] = local;
    }

    /// <summary>True when the server answered (even with an error: sending again would get the same answer).</summary>
    private static async Task<bool> Delivered(Func<Task> send, CancellationToken ct)
    {
        try
        {
            await send();
            return true;
        }
        catch (ApiException)
        {
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>An instant as the API writes it: UTC, milliseconds, Z.</summary>
    private static string Iso(long ms) =>
        DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
```

**j. Report before syncing.** In `SyncAccount`, add right before `var synced = await syncer.SyncAsync(ct);`:

```csharp
        await ReportParentMode(sid, api, ct);
```

Nothing else in `Worker.cs` changes.

### 6.2 `windows/src/ScreenTime.Tray/TrayPipe.cs` (changed)

**a.** Two new cases in the `switch`, after `case "answer":` and its `break;`:

```csharp
                        case "done":
                            log($"done: {(message.Approved == true ? "yes" : "no")}");
                            if (message.Id is { } doneId && _waiting.TryRemove(doneId, out var done)) done.TrySetResult(message.Approved == true ? SendResult.Sent : SendResult.Offline);
                            break;
                        case "parent-no":
                            log($"parent-no: {message.Text}");
                            model.ParentModeNo(message.Text ?? "");
                            break;
```

**b.** After `MessageAsync`, the four parent calls (they replace the "not wired yet" bodies in `ITraySender`):

```csharp
    /// <summary>"I'm the parent" through the service; Offline when the pipe is down or no reply comes.</summary>
    public Task<SendResult> RequestParentModeAsync() => RequestAsync(PipeMessage.ParentAsk(Guid.NewGuid().ToString()));

    /// <summary>Whether the service says this is the parent code now; no when the pipe is down.</summary>
    public async Task<bool> CheckParentCodeAsync(string code) =>
        await RequestAsync(PipeMessage.ParentCode(Guid.NewGuid().ToString(), code)) == SendResult.Sent;

    /// <summary>Starts parent mode after a right code; no when the code is too old or the pipe is down.</summary>
    public async Task<bool> StartParentModeAsync(int? minutes) =>
        await RequestAsync(PipeMessage.ParentStart(Guid.NewGuid().ToString(), minutes)) == SendResult.Sent;

    /// <summary>End now; no when the pipe is down.</summary>
    public async Task<bool> EndParentModeAsync() =>
        await RequestAsync(PipeMessage.ParentEnd(Guid.NewGuid().ToString())) == SendResult.Sent;
```

Nothing else in `TrayPipe.cs` changes.

## 7. Steps

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-050d-parent-wiring`. Check that `windows/src/ScreenTime.Core/Service/ParentMode.cs` exists. If not, stop.
2. Make the changes in 6.1 and 6.2.
3. From `windows\`: build until it passes with 0 errors and 0 warnings; when an error is not clear to you after one try, paste it in the handback and stop. Then run the tests.
4. Do the run in 8.3, pasting every output.
5. Commit `CARD-050d: Windows: wire parent mode to the service`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From `windows\`: `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] From `windows\`: `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 236**. Paste the summary lines.
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Service\*.cs,windows\src\ScreenTime.Tray\*.cs -Pattern 'DllImport|Log\w*\(.*([Tt]oken|[Ss]ecret)'` prints nothing (the family secret and tokens are never logged).

### 8.2 Repo

- [ ] `git status` clean. No `bin\`, `obj\`, `state.db`, `config.json`, `clock.json` or `*.log` in the repo.
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 2 files:
  ```
  windows/src/ScreenTime.Service/Worker.cs
  windows/src/ScreenTime.Tray/TrayPipe.cs
  ```

### 8.3 The run on James's PC (console or Remote Desktop, dry-lock, no admin, no service install)

Paste the **real output of every line**. A step without output counts as NOT RUN. Docker Desktop must be running. Use one PowerShell window, from the repo root, and keep the variables set. It works at any time of day: step 4 runs Sam out of time, and after 8:30 pm Sydney time Sam is locked by bedtime anyway (the tray then says "It's bedtime" instead of "Out of Screens time"). Toasts pop up during the run: that is expected. Do not click the flyout yourself.

1. The local server, the dev family, the paths and the helpers:
   ```powershell
   query user
   Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
   $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
   $env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
   pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
   $tmp = "C:\Users\james\OpenCode\Testing\temp"
   $t = "$tmp\c50d"
   $log = "$tmp\c50d-service.log"
   $trayLog = "$env:LOCALAPPDATA\ScreenTime\tray.log"
   $svcExe = (Resolve-Path "windows\src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe").Path
   $trayExe = (Resolve-Path "windows\src\ScreenTime.Tray\bin\Release\net10.0-windows10.0.26100.0\win-x64\ScreenTime.Tray.exe").Path
   $session = (Get-Process -Id $PID).SessionId
   Remove-Item $trayLog -ErrorAction SilentlyContinue
   function Grant([int]$minutes) { pnpm --silent --filter @screentime/server exec tsx scripts/dev-grant.ts Sam screens $minutes }
   function Parent([string]$what) { pnpm --silent --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Sam $what }
   function Svc([string[]]$more) { Start-Process $svcExe -ArgumentList (@("--data", $t, "--dry-lock", "--session", $session) + $more) -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru }
   function Locks { (Select-String $log -Pattern "locking session").Count }
   Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
   function TrayWindow {
     $tray = Get-Process ScreenTime.Tray -ErrorAction SilentlyContinue | Select-Object -First 1
     if (-not $tray) { return $null }
     $byPid = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::ProcessIdProperty), $tray.Id
     [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, $byPid)
   }
   function Press([string]$name) {
     $window = TrayWindow
     $byName = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::NameProperty), $name
     $el = if ($window) { $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $byName) }
     if (-not $el) { "press ${name}: not found"; return }
     $pattern = $null
     if ($el.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
     elseif ($el.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle() }
     "pressed $name"
   }
   function TypeCode([string]$code) {
     $window = TrayWindow
     $isEdit = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::ControlTypeProperty), ([Windows.Automation.ControlType]::Edit)
     $box = if ($window) { $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $isEdit) }
     $pattern = $null
     if ($box -and $box.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { $pattern.SetValue($code); "typed the code" } else { "type: no code box" }
   }
   ```
   Copy these helpers exactly (including `InvokePattern` and `ValuePattern`). `TypeCode` puts the parent code in the flyout's code box through UI Automation and prints only "typed the code": never print the code itself.
2. Enrol your own account as Sam:
   ```powershell
   $code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
   & $svcExe enrol --server http://localhost:8080 --code $code --user $env:USERNAME --data $t
   ```
3. Start the service; the tray opens on its main panel:
   ```powershell
   $p = Svc @("--tray", $trayExe, "--tray-open", "main"); Start-Sleep 15
   Select-String $log -Pattern "live Sam|tray .*: (started|hello)|min left" | ForEach-Object Line
   ```
4. Out of time, so the PC locks (dry run):
   ```powershell
   Grant -900; Start-Sleep 6
   "locks: $(Locks)"
   Get-Content $trayLog | Select-String "view:" | Select-Object -Last 1
   ```
   Expect `locks:` above 0, and `view: Out of Screens time` (or `view: It's bedtime` after 8:30 pm).
5. "I'm the parent", and Dad says no:
   ```powershell
   Press "I'm the parent"; Start-Sleep 4
   Parent no; Start-Sleep 4
   Select-String $log -Pattern "parent ask|parent mode Dad" | ForEach-Object Line
   Get-Content $trayLog | Select-String "reply:|parent-no:" | Select-Object -Last 2
   ```
6. The parent code, 15 minutes:
   ```powershell
   Press "Enter parent code instead"; Start-Sleep 1
   $parentCode = (Parent code | Select-String '\d{6}').Matches[0].Value
   TypeCode $parentCode; Press "Check"; Start-Sleep 2
   Press "15 min"; Start-Sleep 6
   Select-String $log -Pattern "parent code|parent mode on|parent mode reported" | ForEach-Object Line
   Get-Content $trayLog | Select-String "done:|view:" | Select-Object -Last 3
   $a = Locks; Start-Sleep 12; $b = Locks; "locks while in parent mode: $a $b"
   ```
   Expect `parent code right`, `parent mode on by code, 15 min`, `parent mode reported`, `parent mode on, not counting`, `view: Parent mode · ends …`, and **two equal numbers** (no lock during parent mode).
7. End now:
   ```powershell
   Press "End now"; Start-Sleep 14
   Select-String $log -Pattern "ended on this PC|End now reported|parent mode over" | ForEach-Object Line
   "locks after End now: $b $(Locks)"
   ```
   Expect the three lines and a **higher** second number (the PC is out of time again: a toast, then a relock 10 s later).
8. A parent's yes from the app, then the parent ends it:
   ```powershell
   Press "I'm the parent"; Start-Sleep 3
   Parent yes; Start-Sleep 6
   Parent end; Start-Sleep 6
   Select-String $log -Pattern "parent mode on, not counting|parent mode over" | ForEach-Object Line
   Get-Content $trayLog | Select-String "view:" | Select-Object -Last 3
   ```
   Expect a second `parent mode on, not counting` and `parent mode over` pair, and views going to `Parent mode · ends …` and back.
9. Clean up:
   ```powershell
   Stop-Process -Id $p.Id; Start-Sleep 2; Stop-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue
   Get-Content "$log.err"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item -Recurse $t, $log, "$log.err", $trayLog
   ```
   Paste `$log.err` (it should be empty).

What Claude saw on the same run, over Remote Desktop after 8:30 pm (times, pids and the lock counts differ):

```
=== step 3
      tray 1: started pid 15064
      live Sam: connected
      Sam: 0 min left, locked True
      tray 1: hello pid 15064
=== step 4
Removed 900 min of screens for Sam today, as Dad.
locks: 3
20:49:21 view: It's bedtime
=== step 5
pressed I'm the parent
Dad said no to Sam's "I'm the parent".
      Sam: parent ask sent, Sent
      Sam: parent mode Dad said no.
20:49:27 reply: Sent
20:49:32 parent-no: Dad said no.
=== step 6
pressed Enter parent code instead
typed the code
pressed Check
pressed 15 min
      Sam: parent code right
      Sam: parent mode on by code, 15 min
      Sam: parent mode reported
      Sam: parent mode on, not counting
20:49:40 done: yes
20:49:40 view: Parent mode · ends 9:04 pm
20:49:41 view: Parent mode · ends 9:04 pm
locks while in parent mode: 4 4
=== step 7
pressed End now
      Sam: parent mode ended on this PC
      Sam: End now reported
      Sam: parent mode over
locks after End now: 4 5
=== step 8
pressed I'm the parent
Dad turned parent mode on for Sam for 15 min.
Dad ended parent mode on Sam's device.
      Sam: parent mode on, not counting
      Sam: parent mode over
      Sam: parent mode on, not counting
      Sam: parent mode over
20:50:05 view: It's bedtime
20:50:16 view: Parent mode · ends 9:05 pm
20:50:24 view: It's bedtime
```

## 9. Tests

No new tests: the logic is CARD-050c's, tested there. The 236 existing tests must still pass. The run in 8.3 is the check.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-050d-parent-wiring
   ```
2. Commit with the message `CARD-050d: Windows: wire parent mode to the service`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-050d-parent-wiring`
5. Write the PR body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` and open the PR with `gh pr create --base main --title "CARD-050d: Windows: wire parent mode to the service" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body:
   ```markdown
   ## Card
   docs/cards/CARD-050d-parent-wiring.md

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

- **`Press` or `TypeCode` says `not found` / `no code box`**: you changed a helper. Copy section 8.3 step 1 again, then redo the **whole** run from step 1, and list it as a deviation. Do not click the flyout by hand.
- **Step 6 says `parent code wrong`**: the code changes every 30 s. Run the step's lines again once, from `Press "Enter parent code instead"`, and list it as a deviation. If it is wrong again, paste both logs and stop.
- **Step 6's two numbers differ** (a lock during parent mode), or **step 7's do not grow**: paste both logs in full and stop.
- **An AOT or trim warning (`IL…`)**: paste it and stop. No `NoWarn`, no `#pragma`.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own review, so write only what you actually saw. Paste the **whole** report: Claude needs every section, not just the end.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- Paste the real output of **every** run step. A step without its pasted output counts as `NOT RUN`, and Claude sends the PR back.
- Every workaround (restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-050d. Please review and merge if it is good.

CARD: CARD-050d Windows: wire parent mode to the service
PR: <full PR URL>
Branch: bob/card-050d-parent-wiring
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
<step 1 … step 9>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
