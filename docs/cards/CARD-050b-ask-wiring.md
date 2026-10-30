# CARD-050b: Windows: wire Ask and Message to the service

| Field | Value |
|---|---|
| Card | CARD-050b |
| Title | Windows: wire Ask and Message to the service |
| Size | M |
| Depends on | CARD-050 (PR #132) and the tray's pinned `--open` (PR #133, by Claude), both merged to `main` |
| Spec sections | docs/SPEC.md §16.2 (Ask and Message, as built in CARD-035), §16.3 (Windows tray), §12.2 (pipe) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-050b-ask-wiring` |
| PR title | `CARD-050b: Windows: wire Ask and Message to the service` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

`AGENTS.md` rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command and every run step** and lists every workaround. Rule 10: never change Claude's front-end files.

What is on `main`:

- **Claude's front end** (PR #130, #133): the tray's flyout has **Ask for more time** and **Message** panels. They call `TrayModel.Sender` (an `ITraySender`: `AskAsync`, `MessageAsync`, each returning a `SendResult`) and show answers through `TrayModel.Answer(text, approved)`. With `--open <panel>` the flyout opens at once and stays open, so a test run can press its buttons.
- **CARD-050** (PR #132): `TrayStatus` carries the presets and the waiting ask; `Live.Answer(frame)` and `RequestAnswer.Text()`; the pipe lines `ask`, `message`, `reply` and `answer`; `SendResults.Of(exception)`.
- **CARD-049b**: the service sends the tray `view` lines and toasts; the tray quits 30 s after the service is gone.

This card **connects Ask and Message end to end**, and wraps up two findings from CARD-049b:

1. **Tray → service → server.** The tray's pipe implements `ITraySender`: it sends `ask` or `message` and waits for the `reply`. The service posts it to the server (`POST /v1/device/time-requests` or `/v1/device/messages`) and replies `Sent`, `AlreadyAsked` or `Offline`.
2. **Answers.** The live channel hands every frame to the service. A `request_resolved` frame becomes an `answer` line to the tray ("Dad said yes! +30 min 🎉").
3. **One toast for a yes.** A "yes" also adds a grant, which would toast "Dad added 30 minutes" too. Android shows only the answer, so the service tells `GrantToasts` to skip that grant (two small Core additions, with a copied test).
4. **Runs over Remote Desktop** (CARD-049b finding: Bob's 8.3 run was blocked). Two dev-only service options, both refused without `--dry-lock`: `--session <id>` treats that session as the console, and `--tray-open <panel>` opens the tray's flyout at once.
5. **The run repeats CARD-049b's checks** that could not run then: the warning toast, out of time, and the tray quitting.

Claude has already run this exact change on James's PC over Remote Desktop: section 8.3 shows what to expect.

## 2. Goal

- `dotnet build` and `dotnet test` pass in `windows/`: **total 216** (210 before + 6). CI **Windows / build and test** is green.
- The run in 8.3 shows: an ask is sent and answered with one "Dad said yes!" toast (and no "Dad added"); a message is sent; the warning toast; out of time; the tray quits when the service stops.

## 3. Out of scope

- Any change to Claude's front-end files: `App.xaml(.cs)`, `FlyoutWindow.*`, `TrayIcon.cs`, `TrayModel.cs`, `ITraySender.cs`, `Toasts.cs`, `DemoStatus.cs`, `Assets/*`, `Core/Tray/TrayStatus.cs`.
- Parent mode (CARD-050c). Tamper events (CARD-051). Installing the service (CARD-052).
- No new packages, no change to the generated API files, the tests other than the copied one, any workflow or the server.
- **Do not install or start the Windows service** (`sc.exe create` and `New-Service` are not allowed). **Never run the service without `--dry-lock`** on James's PC.

## 4. Tech

- .NET 10, nullable on, warnings are errors. `ScreenTime.Core` is `IsAotCompatible`; `ScreenTime.Service` has `PublishAot`: no reflection.
- **The server call must never hold up the pipe or the lock loop.** It can take up to 30 s (the `HttpClient` timeout), and the tray's `locked` confirmation must still arrive within 2 s. So the service runs it with `Task.Run`, outside the semaphore (6.4 g).
- The run works at the PC **and** over Remote Desktop, because it passes `--session` with the PowerShell window's own session.

## 5. Files to copy

Copy this file exactly, byte for byte. 8.1 checks the fingerprint. It is the contract: never change it.

### 5.1 `windows/tests/ScreenTime.Core.Tests/AnswerGrantTests.cs`

```csharp
using ScreenTime.Core.Service;
using ScreenTime.Core.Tray;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-050b: a "yes" shows "Dad said yes!", not also "Dad added …" (docs/SPEC.md §16.2). Copied verbatim from the card.</summary>
public class AnswerGrantTests
{
    private const string Yes = """{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"requestId":"r1","approved":true,"minutes":30,"byName":"Dad","grant":{"id":"g9","minutes":30,"createdAt":"2026-10-26T01:00:00.000Z","byName":"Dad"}}}""";

    private static string G(string id, int minutes) =>
        $$"""{"id":"{{id}}","minutes":{{minutes}},"createdAt":"2026-10-26T01:00:00.000Z","byName":"Dad"}""";

    [Fact]
    public void AYesNamesItsGrant() => Assert.Equal("g9", Live.AnswerGrantId(Yes));

    [Theory]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"requestId":"r1","approved":false,"minutes":0,"byName":"Dad","grant":null}}""")]
    [InlineData("""{"v":1,"type":"grant_added","at":"2026-10-26T01:00:00Z","data":{"grant":{"id":"g9"}}}""")]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"grant":{"minutes":30}}}""")]
    [InlineData("not json")]
    public void OtherFramesNameNoGrant(string frame) => Assert.Null(Live.AnswerGrantId(frame));

    [Fact]
    public void ASkippedGrantIsNotToastedButOthersAre()
    {
        var t = new GrantToasts();
        t.Check(State());
        t.Skip("g9");
        Assert.Equal(["Dad added 15 minutes"], t.Check(State(grants: G("g9", 30) + "," + G("g10", 15))));
        Assert.Empty(t.Check(State(grants: G("g9", 30) + "," + G("g10", 15))));
    }
}
```

## 6. What to write

Make exactly these changes. The code blocks are the code to write. Give every new member a one-line `/// <summary>` like the files around it.

### 6.1 `windows/src/ScreenTime.Core/Service/Live.cs` (changed)

Add this method **after** the `Answer` method (from CARD-050), at the end of the class:

```csharp
    /// <summary>The id of the grant a "yes" in a <c>request_resolved</c> frame added; null for anything else.</summary>
    public static string? AnswerGrantId(string frame)
    {
        try
        {
            using var doc = JsonDocument.Parse(frame);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "request_resolved") return null;
            if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) return null;
            if (!data.TryGetProperty("grant", out var grant) || grant.ValueKind != JsonValueKind.Object) return null;
            if (!grant.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String) return null;
            return id.GetString();
        }
        catch (JsonException)
        {
            return null;
        }
    }
```

### 6.2 `windows/src/ScreenTime.Core/Tray/GrantToasts.cs` (changed)

Add this method after `Check`:

```csharp
    /// <summary>Never toasts this grant: the "Dad said yes!" answer already showed it.</summary>
    public void Skip(string grantId) => _seen.Add(grantId);
```

### 6.3 `windows/src/ScreenTime.Service/LiveChannel.cs` (changed)

1. Add a last constructor parameter: `…, ILogger logger, string kidName, Action<string> onFrame)`.
2. In the receive loop, replace the `if` that calls `Live.AsksForSync(...)` and `requestSync()` with:

```csharp
            if (result.MessageType == WebSocketMessageType.Text)
            {
                var text = Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
                onFrame(text);
                if (Live.AsksForSync(text)) requestSync();
            }
```

`onFrame` runs **before** `requestSync`, so a skipped grant is queued before the sync that brings it.

### 6.4 `windows/src/ScreenTime.Service/Worker.cs` (changed)

**a. Using.** Add `using System.Collections.Concurrent;` as the first line.

**b. `ServiceOptions`** gets two last parameters: `…, bool AsService, uint? Session = null, string? TrayOpen = null);`. Add to its summary: "`Session` and `TrayOpen` are for test runs (`--session`, `--tray-open`)."

**c. Two fields**, after `_grantToasts`:

```csharp
    private readonly Dictionary<string, ApiClient> _apis = new();
    private readonly ConcurrentQueue<(string Sid, string GrantId)> _skipGrants = new();
```

**d. The console session.** Replace **both** `Win.WTSGetActiveConsoleSessionId()` calls (at start and in the session events loop) with `ConsoleSession()`, and add:

```csharp
    /// <summary>The session that counts as the console: <c>--session</c> in a test run, otherwise the real console.</summary>
    private uint ConsoleSession() => options.Session ?? Win.WTSGetActiveConsoleSessionId();
```

**e. `EnsureSession`.** Pass `options.TrayOpen` as the last argument of `new TrayHost(...)`.

**f. One API client per account.** Add:

```csharp
    /// <summary>The API client for the SID, made once; null when it is not enrolled.</summary>
    private ApiClient? Api(string sid)
    {
        if (_apis.TryGetValue(sid, out var api)) return api;
        var device = _store.GetDevice(sid);
        var config = ServiceFiles.LoadConfig(_configPath);
        if (device is null || config is null) return null;
        api = new ApiClient(new HttpClient { BaseAddress = new Uri(config.ServerUrl), Timeout = TimeSpan.FromSeconds(30) }, () => Encoding.UTF8.GetString(Win.Unprotect(device.Token)));
        _apis[sid] = api;
        return api;
    }
```

and in `SyncAccount` use it: change `if (device is null || config is null) return;` to `if (device is null || config is null || Api(sid) is not { } api) return;`, and delete the `var api = new ApiClient(...)` line inside `if (!_syncers.TryGetValue(...))`.

**g. Asks and messages from the tray.** In `OnTrayMessage`, add this case after `hello`:

```csharp
                case "ask" or "message" when m.Id is not null && Api(s.Sid) is { } api:
                    // The server call can take up to 30 s: it must not hold up the pipe or the lock loop.
                    _ = Task.Run(() => SendForTray(s, api, m));
                    break;
```

and add:

```csharp
    /// <summary>Sends the tray's ask or message to the server and replies with how it went.</summary>
    private async Task SendForTray(KidSession s, ApiClient api, PipeMessage m)
    {
        SendResult result;
        try
        {
            if (m.Type == "ask") await api.PostDeviceTimeRequestsAsync(new TimeRequestCreate(m.Id!, m.Minutes ?? 15, m.Reason), _stopping);
            else await api.PostDeviceMessagesAsync(new KidMessageCreate(m.Id!, m.Text ?? "", m.PresetId), _stopping);
            result = SendResult.Sent;
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
        {
            return;
        }
        catch (Exception e)
        {
            result = SendResults.Of(e);
        }
        logger.LogInformation("{Kid}: {Type} sent, {Result}", KidName(s.Sid), m.Type, result);
        await s.Tray.SendAsync(PipeMessage.Reply(m.Id!, result));
        // The new pendingRequest ("Waiting for Dad…") comes with the next sync.
        if (result != SendResult.Offline) _syncRequests.Writer.TryWrite(s.Sid);
    }
```

**h. Answers from the live channel.** In `StartLiveChannels`, pass `frame => OnFrame(sid, frame)` as the last argument of `new LiveChannel(...)`, and add:

```csharp
    /// <summary>Every live frame: a parent's answer goes to the trays of that SID, and its grant is not toasted again.</summary>
    private void OnFrame(string sid, string frame)
    {
        if (Live.AnswerGrantId(frame) is { } grantId) _skipGrants.Enqueue((sid, grantId));
        if (Live.Answer(frame) is { } answer) _ = Task.Run(() => SendAnswer(sid, answer));
    }

    /// <summary>Logs the answer and sends it to every tray of the SID.</summary>
    private async Task SendAnswer(string sid, RequestAnswer answer)
    {
        await _sem.WaitAsync();
        try
        {
            var text = answer.Text();
            logger.LogInformation("{Kid}: answer {Text}", KidName(sid), text);
            foreach (var s in _sessions.Values.Where(s => s.Sid == sid).ToList()) await s.Tray.SendAsync(PipeMessage.Answer(text, answer.Approved));
        }
        finally
        {
            _sem.Release();
        }
    }
```

**i. Skip before toasting.** In `SyncAccount`, right before `if (!_grantToasts.TryGetValue(sid, out var grants)) …`, add:

```csharp
            while (_skipGrants.TryDequeue(out var skip))
            {
                if (!_grantToasts.TryGetValue(skip.Sid, out var skipper)) _grantToasts[skip.Sid] = skipper = new GrantToasts();
                skipper.Skip(skip.GrantId);
            }
```

Nothing else in `Worker.cs` changes.

### 6.5 `windows/src/ScreenTime.Service/TrayHost.cs` (changed)

1. Add a last constructor parameter `string? trayOpen = null`.
2. In `TrayLoopAsync`, the arguments become:
   ```csharp
           var arguments = $"--pipe ScreenTime.{sessionId}" + (dryLock ? " --dry-lock" : "") + (trayOpen is null ? "" : $" --open {trayOpen}");
   ```

### 6.6 `windows/src/ScreenTime.Service/Program.cs` (changed)

Replace the `builder.Services.AddSingleton(new ServiceOptions(...));` line with:

```csharp
            // Dev only, for runs over Remote Desktop: --session <id> treats that session as the console, and
            // --tray-open <main|ask|message> opens the tray's flyout at once. Both need --dry-lock.
            uint? session = null;
            if (flags.TryGetValue("session", out var sessionText))
            {
                if (!uint.TryParse(sessionText, out var id)) { Console.Error.WriteLine("Usage: --session <session id>"); return 2; }
                session = id;
            }
            flags.TryGetValue("tray-open", out var trayOpen);
            if ((session is not null || trayOpen is not null) && !dryLock)
            {
                Console.Error.WriteLine("--session and --tray-open are for testing and need --dry-lock.");
                return 2;
            }
            builder.Services.AddSingleton(new ServiceOptions(dataFolder, secure, trayExe, dryLock, WindowsServiceHelpers.IsWindowsService(), session, trayOpen));
```

### 6.7 `windows/src/ScreenTime.Tray/TrayPipe.cs` (changed)

**a.** Add `using System.Collections.Concurrent;` (with the other `System` usings) and `using ScreenTime.Core.Tray;`. The class implements the seam: `internal sealed partial class TrayPipe(…) : ITraySender`. Update its summary: "…passes toasts, views and answers to the <see cref="TrayModel"/>, and sends asks and messages for it (<see cref="ITraySender"/>). Reconnects for ever."

**b. Fields**, after `Utf8`:

```csharp
    private readonly SemaphoreSlim _write = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<SendResult>> _waiting = new();
    private StreamWriter? _writer;
```

**c. In `RunAsync`:**
1. First line: `model.Sender = this;`
2. Right after `using var writer = new StreamWriter(...)`: `_writer = writer;`
3. The two `SendAsync(writer, …)` calls become `SendAsync(…)` (no `writer` argument).
4. After each of the two `lastSeen = Environment.TickCount64;` lines that follow a `log("pipe: closed");`, add `Disconnected();`.
5. Two new cases in the `switch`, before `case "status":`:

```csharp
                        case "reply":
                            log($"reply: {message.Result}");
                            if (message.Id is { } id && _waiting.TryRemove(id, out var waiting)) waiting.TrySetResult(message.Result ?? SendResult.Offline);
                            break;
                        case "answer":
                            log($"answer: {message.Text}");
                            model.Answer(message.Text ?? "", message.Approved == true);
                            break;
```

**d.** Replace the old `private static async Task SendAsync(StreamWriter writer, PipeMessage message)` with:

```csharp
    /// <summary>"Ask for more time" through the service; Offline when the pipe is down or no reply comes.</summary>
    public Task<SendResult> AskAsync(int minutes, string? reason) => RequestAsync(PipeMessage.Ask(Guid.NewGuid().ToString(), minutes, reason));

    /// <summary>A message to the parents through the service; Offline when the pipe is down or no reply comes.</summary>
    public Task<SendResult> MessageAsync(string? presetId, string text) => RequestAsync(PipeMessage.Message(Guid.NewGuid().ToString(), presetId, text));

    private async Task<SendResult> RequestAsync(PipeMessage message)
    {
        var waiting = new TaskCompletionSource<SendResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        _waiting[message.Id!] = waiting;
        if (!await SendAsync(message)) waiting.TrySetResult(SendResult.Offline);
        // The service gives up on the server after 30 s; 40 s here covers that.
        var done = await Task.WhenAny(waiting.Task, Task.Delay(40_000));
        _waiting.TryRemove(message.Id!, out _);
        return done == waiting.Task ? waiting.Task.Result : SendResult.Offline;
    }

    /// <summary>Writes one line to the service; false when the pipe is down. One writer at a time.</summary>
    private async Task<bool> SendAsync(PipeMessage message)
    {
        await _write.WaitAsync();
        try
        {
            if (_writer is not { } writer) return false;
            await writer.WriteAsync(PipeMessage.Encode(message) + "\n");
            await writer.FlushAsync();
            return true;
        }
        catch (IOException)
        {
            return false;
        }
        finally
        {
            _write.Release();
        }
    }

    /// <summary>The pipe closed: nothing can be sent, and every waiting ask or message is Offline.</summary>
    private void Disconnected()
    {
        _writer = null;
        foreach (var id in _waiting.Keys) if (_waiting.TryRemove(id, out var waiting)) waiting.TrySetResult(SendResult.Offline);
    }
```

Nothing else in `TrayPipe.cs` changes.

## 7. Steps

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-050b-ask-wiring`. Check that `windows/src/ScreenTime.Core/Service/RequestAnswer.cs` exists and that `windows/src/ScreenTime.Tray/FlyoutWindow.xaml.cs` contains `public bool Pinned`. If not, stop.
2. Copy the file in section 5. Run the fingerprint (8.1) **once**.
3. Make the changes in 6.1 to 6.7.
4. From `windows\`: build until it passes with 0 errors and 0 warnings; when an error is not clear to you after one try, paste it in the handback and stop. Then run the tests.
5. Do the run in 8.3, pasting every output.
6. Commit `CARD-050b: Windows: wire Ask and Message to the service`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: one line ending in `True`.
  ```powershell
  $root = (Get-Location).Path
  $b = [IO.File]::ReadAllBytes("$root\windows\tests\ScreenTime.Core.Tests\AnswerGrantTests.cs") | Where-Object { $_ -ne 13 }
  $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
  "AnswerGrantTests.cs $h $($h -eq '86b476ed491fb264b1f518d72cf1eecb465c2e9971f0fdfb72fc01266f7c79c8')"
  ```
- [ ] From `windows\`: `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] From `windows\`: `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 216**. Paste the summary lines.
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Service\*.cs,windows\src\ScreenTime.Tray\*.cs -Pattern 'DllImport|Log\w*\(.*[Tt]oken'` prints nothing.
- [ ] From `windows\`: `& src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe --session 1; "exit $LASTEXITCODE"` prints `--session and --tray-open are for testing and need --dry-lock.` and `exit 2`.

### 8.2 Repo

- [ ] `git status` clean. No `bin\`, `obj\`, `state.db`, `config.json`, `clock.json` or `*.log` in the repo.
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 8 files:
  ```
  windows/src/ScreenTime.Core/Service/Live.cs
  windows/src/ScreenTime.Core/Tray/GrantToasts.cs
  windows/src/ScreenTime.Service/LiveChannel.cs
  windows/src/ScreenTime.Service/Program.cs
  windows/src/ScreenTime.Service/TrayHost.cs
  windows/src/ScreenTime.Service/Worker.cs
  windows/src/ScreenTime.Tray/TrayPipe.cs
  windows/tests/ScreenTime.Core.Tests/AnswerGrantTests.cs
  ```

### 8.3 The run on James's PC (console or Remote Desktop, dry-lock, no admin, no service install)

Paste the **real output of every line**. A step without output counts as NOT RUN. Docker Desktop must be running. Use one PowerShell window, from the repo root, and keep the variables set. The run moves Sam's bedtime to 2 hours from now, so **start it before 9:30 pm** (Sydney time). Toasts pop up on the screen during the run: that is expected. Do not click on the flyout while the run goes.

1. The local server, the dev family, the paths and two helpers:
   ```powershell
   query user
   Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
   $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
   $env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
   pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
   $tmp = "C:\Users\james\OpenCode\Testing\temp"
   $t = "$tmp\c50b"
   $log = "$tmp\c50b-service.log"
   $trayLog = "$env:LOCALAPPDATA\ScreenTime\tray.log"
   $svcExe = (Resolve-Path "windows\src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe").Path
   $trayExe = (Resolve-Path "windows\src\ScreenTime.Tray\bin\Release\net10.0-windows10.0.26100.0\win-x64\ScreenTime.Tray.exe").Path
   $session = (Get-Process -Id $PID).SessionId
   Remove-Item $trayLog -ErrorAction SilentlyContinue
   function Grant([int]$minutes) { pnpm --silent --filter @screentime/server exec tsx scripts/dev-grant.ts Sam screens $minutes }
   function Bedtime([int]$minutes, [int]$allowance = 720) { pnpm --silent --filter @screentime/server exec tsx scripts/dev-bedtime.ts Sam $minutes $allowance }
   function Svc([string[]]$more) { Start-Process $svcExe -ArgumentList (@("--data", $t, "--dry-lock", "--session", $session) + $more) -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru }
   Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
   function Press([string]$name) {
     $tray = Get-Process ScreenTime.Tray -ErrorAction SilentlyContinue | Select-Object -First 1
     if (-not $tray) { "press ${name}: no tray"; return }
     $byPid = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::ProcessIdProperty), $tray.Id
     $window = [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, $byPid)
     $byName = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::NameProperty), $name
     $el = if ($window) { $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $byName) }
     if (-not $el) { "press ${name}: not found"; return }
     $pattern = $null
     if ($el.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
     elseif ($el.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle() }
     "pressed $name"
   }
   ```
   `query user` may show `console` or `rdp-tcp#…`: both work, because `--session` uses this window's own session. `Press` presses a button in the tray's flyout through Windows UI Automation (no mouse). If either `Resolve-Path` fails, run `dotnet build ScreenTime.slnx -c Release` from `windows\` first.
2. Enrol your own account as Sam, with 25 minutes and bedtime in 2 hours:
   ```powershell
   $code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
   & $svcExe enrol --server http://localhost:8080 --code $code --user $env:USERNAME --data $t
   Bedtime 120 25
   ```
   Never print `$code`.
3. Start the service; the tray opens on the Ask panel:
   ```powershell
   $p = Svc @("--tray", $trayExe, "--tray-open", "ask"); Start-Sleep 15
   Select-String $log -Pattern "live Sam|tray .*: (started|hello)|min left" | ForEach-Object Line
   Get-Content $trayLog
   ```
4. Ask for 30 minutes:
   ```powershell
   Press "30 min"; Press "Send"; Start-Sleep 6
   Select-String $log -Pattern "ask sent" | ForEach-Object Line
   Get-Content $trayLog | Select-String "reply:"
   ```
5. Dad says yes:
   ```powershell
   pnpm --silent --filter @screentime/server exec tsx scripts/dev-answer.ts Sam yes; Start-Sleep 6
   Select-String $log -Pattern "answer|toast" | ForEach-Object Line
   Get-Content $trayLog | Select-String "answer:|toast:|view:" | Select-Object -Last 4
   ```
   Expect **one** answer line and **no** `toast Dad added 30 minutes` in the service log.
6. A message (Sam's family has one parent, "Dad"):
   ```powershell
   Press "Message Dad"; Start-Sleep 1; Press "Can you call me?"; Press "Send"; Start-Sleep 4
   Select-String $log -Pattern "message sent" | ForEach-Object Line
   Get-Content $trayLog | Select-String "reply:" | Select-Object -Last 1
   ```
7. The CARD-049b checks: the warning, then out of time:
   ```powershell
   Grant -45; Start-Sleep 8
   Select-String $log -Pattern "toast" | ForEach-Object Line
   Grant -900; Start-Sleep 6
   Select-String $log -Pattern "locking|would disconnect" | ForEach-Object Line
   Get-Content $trayLog | Select-String "view:|lock:" | Select-Object -Last 2
   ```
8. The tray quits when the service is gone:
   ```powershell
   $trayPid = (Get-Process ScreenTime.Tray).Id
   Stop-Process -Id $p.Id; Start-Sleep 40
   "tray still running: $([bool](Get-Process -Id $trayPid -ErrorAction SilentlyContinue))"
   Get-Content $trayLog | Select-Object -Last 3
   ```
9. Clean up:
   ```powershell
   Get-Content "$log.err"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item -Recurse $t, $log, "$log.err", $trayLog
   ```
   Paste `$log.err` (it should be empty).

What Claude saw on the same run, over Remote Desktop (times and pids differ):

```
=== step 3
      tray 1: started pid 25384
      live Sam: connected
      Sam: 25 min left, locked False
      tray 1: hello pid 25384
20:05:30 pipe: connected
20:05:30 view: Screens · 25m left
=== step 4
pressed 30 min
pressed Send
      Sam: ask sent, Sent
20:05:44 reply: Sent
=== step 5
Dad said yes to Sam's request for 30 min (no reason) +30 min.
      Sam: answer Dad said yes! +30 min 🎉
20:05:44 view: Screens · 24m left
20:05:51 view: Screens · 54m left
20:05:51 answer: Dad said yes! +30 min 🎉
20:05:51 toast: Dad said yes! +30 min 🎉
=== step 6
pressed Message Dad
pressed Can you call me?
pressed Send
      Sam: message sent, Sent
20:05:58 reply: Sent
=== step 7
Removed 45 min of screens for Sam today, as Dad.
      Sam: toast 15 minutes of Screens left
Removed 900 min of screens for Sam today, as Dad.
      Sam: locking session 1
20:06:13 view: Out of Screens time
20:06:13 lock: dry run
=== step 8
tray still running: False
20:06:19 pipe: closed
20:06:49 pipe: no service for 30 s, exiting
20:06:49 tray: exiting
```

## 9. Tests

| File | Tests | What it checks |
|---|---|---|
| `AnswerGrantTests` | 6 cases | A "yes" names its grant; a "no", another frame type, a grant without an id and invalid JSON name none; a skipped grant is not toasted while another new one is, once. |

The rest is wiring: the 210 existing tests must still pass, and the run in 8.3 is the check.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-050b-ask-wiring
   ```
2. Commit with the message `CARD-050b: Windows: wire Ask and Message to the service`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-050b-ask-wiring`
5. Write the PR body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` and open the PR with `gh pr create --base main --title "CARD-050b: Windows: wire Ask and Message to the service" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body:
   ```markdown
   ## Card
   docs/cards/CARD-050b-ask-wiring.md

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

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Never change the copied test or one of Claude's front-end files.

- **Step 3 has no `tray N: started`**: paste the whole `$log` and `$log.err` and stop.
- **`Press` says `not found`**: the flyout is not open, or a button has another name. Paste the output and the tray log and stop. Do not click it by hand to make the step pass.
- **Step 5 shows `toast Dad added 30 minutes`**: the skip in 6.4 h and i is not working. Paste both logs and stop.
- **`dev-grant` prints its usage line**: the minutes must be a multiple of 15. Use the card's numbers.
- **`Bedtime` says bedtime after midnight is not supported**: it is after 9:30 pm in Sydney. Do the run earlier in the day.
- **An AOT or trim warning (`IL…`)**: paste it and stop. No `NoWarn`, no `#pragma`.

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
Claude, here is Bob's handback for CARD-050b. Please review and merge if it is good.

CARD: CARD-050b Windows: wire Ask and Message to the service
PR: <full PR URL>
Branch: bob/card-050b-ask-wiring
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
