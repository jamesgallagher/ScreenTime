# CARD-048: Windows: locking, the live channel and the tray pipe

| Field | Value |
|---|---|
| Card | CARD-048 |
| Title | Windows: locking, the live channel and the tray pipe |
| Size | M |
| Depends on | CARD-047b merged to `main` |
| Spec sections | docs/SPEC.md §8.3 (when devices sync), §10 (WebSocket), §12.2 (Windows: tray, pipe, lock) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-048-lock` |
| PR title | `CARD-048: Windows: locking, the live channel and the tray pipe` |

## 1. Project context

Read `AGENTS.md` first. Rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command and every run step** and lists every workaround.

CARD-047b made `ScreenTime.Service` enrol, track sessions and sync every 60 s. This card makes it **enforce**:
- **Live channel**: one WebSocket per enrolled account to `GET /v1/device/ws`, so a parent's grant reaches the PC in about a second.
- **Tray**: the service starts `ScreenTime.Tray.exe` in each kid session, starts it again within 2 s when it exits, and talks to it over a named pipe with JSON lines.
- **Lock**: at zero, bedtime or before wake, the service tells the tray to lock the PC. No answer in 2 s means the service disconnects the session (the lock screen; the kid is never signed out). Unlocking while still out of time gives a toast and a new lock 10 s later, and those 10 s are not counted.

The work has three parts:
1. **`ScreenTime.Core.Service`** (6.1 to 6.3): plain C# rules with no Windows calls, tested by the three test files in section 5.
2. **`ScreenTime.Service`** (6.4 to 6.7): the socket, the pipe server, the tray launcher and the worker. CI only builds them.
3. **`ScreenTime.Tray`** (6.8 to 6.10): no window yet, only the pipe client and the lock call.

The Windows calls for starting the tray in another session and for disconnecting a session are **already on `main`** in `windows/src/ScreenTime.Service/WinTray.cs` (`Win.StartInSession` and `Win.Disconnect`). Use them; do not change that file.

Section 8.3 is a **real run** on James's PC with the service in a console window, in **dry-lock** mode: the tray writes `lock: dry run` instead of locking, and the service writes `dry run: would disconnect` instead of disconnecting. James's PC is never locked, and no admin rights are needed.

You **copy** the files in section 5 exactly, and **write** everything in section 6. The tests are the contract; never change them.

## 2. Goal

- `dotnet build` and `dotnet test` pass in `windows/`, including the 37 new test cases. CI **Windows / build and test** is green.
- The run in 8.3 shows: the socket connects, the tray starts and says hello, a grant of −600 min makes the service lock (dry run) within seconds, a grant of +900 stops it, a killed tray comes back within 2 s, and with no tray the service falls back to the (dry-run) disconnect.

## 3. Out of scope

- The tray icon, flyout and real toasts (CARD-049: in this card the tray only writes a toast to its log). Ask, message and parent mode dialogs (CARD-050). Tamper events and hardening (CARD-051). The installer and installing the service (CARD-052).
- Not counting time during parent mode on Windows (CARD-050). The 10 s poll while locked and the socket is down (the 60 s sync stays).
- No change to `LocalStore`, `Recorder`, `TrustedClock`, `Syncer`, `TodayInput`, `SessionTracker`, `Enroller`, `ServiceFiles`, `Windows.cs`, `WinTray.cs`, `SessionLifetime.cs`, the generated API files, the test csproj, any workflow, or the server.
- **Do not install or start the Windows service** (`sc.exe create` and `New-Service` are not allowed). **Never run the service without `--dry-lock`** on James's PC.

## 4. Tech

- .NET 10, nullable on, warnings are errors. `ScreenTime.Core` is `IsAotCompatible` and `ScreenTime.Service` has `PublishAot`: no reflection, JSON through source-generated contexts only, P/Invoke with `[LibraryImport]` only.
- No new packages. `ClientWebSocket` (`System.Net.WebSockets`), `NamedPipeServerStreamAcl`, `PipeSecurity` and `PipeAccessRule` (`System.IO.Pipes`), `JsonDocument` and `Process` are all in .NET 10.
- `ScreenTime.Tray` gets `<AllowUnsafeBlocks>true</AllowUnsafeBlocks>`, because `LibraryImport` needs it.

## 5. Files to copy

Copy each file exactly, byte for byte. 8.1 checks the fingerprints.

### 5.1 `windows/tests/ScreenTime.Core.Tests/LiveTests.cs`

```csharp
using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-048: the live channel's rules (docs/SPEC.md §8.3, §10). Copied verbatim from the card.</summary>
public class LiveTests
{
    [Theory]
    [InlineData("https://screentime.example.com/", "wss://screentime.example.com/v1/device/ws")]
    [InlineData("http://localhost:8080/", "ws://localhost:8080/v1/device/ws")]
    [InlineData("http://localhost:8080", "ws://localhost:8080/v1/device/ws")]
    public void TheSocketAddressComesFromTheServerAddress(string server, string expected) =>
        Assert.Equal(expected, Live.Url(server));

    [Fact]
    public void OnlyHttpAddressesHaveASocket() =>
        Assert.Throws<ArgumentException>(() => Live.Url("ftp://example.com/"));

    [Theory]
    [InlineData(0, 1.0, 1_000)]
    [InlineData(1, 1.0, 2_000)]
    [InlineData(5, 1.0, 32_000)]
    [InlineData(6, 1.0, 60_000)]
    [InlineData(30, 1.0, 60_000)]
    [InlineData(-1, 1.0, 1_000)]
    [InlineData(0, 0.8, 800)]
    [InlineData(2, 1.2, 4_800)]
    public void BackoffDoublesUpToAMinute(int attempt, double jitter, long expected) =>
        Assert.Equal(expected, Live.BackoffMs(attempt, jitter));

    [Theory]
    [InlineData("""{"v":1,"type":"grant_added","at":"2026-10-26T09:00:00Z","data":{}}""", true)]
    [InlineData("""{"v":1,"type":"state_changed","at":"2026-10-26T09:00:00Z","data":{}}""", true)]
    [InlineData("""{"v":1,"type":"pong","at":"2026-10-26T09:00:00Z","data":{}}""", false)]
    [InlineData("not json", false)]
    [InlineData("[1,2]", false)]
    [InlineData("""{"type":7}""", false)]
    [InlineData("""{"data":{}}""", false)]
    public void EveryEnvelopeButPongAsksForASync(string frame, bool expected) =>
        Assert.Equal(expected, Live.AsksForSync(frame));

    [Fact]
    public void ThePingIsTheSpecsPing() => Assert.Equal("""{"type":"ping"}""", Live.Ping);
}
```

### 5.2 `windows/tests/ScreenTime.Core.Tests/LockKeeperTests.cs`

```csharp
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Time;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-048: locking and relocking one kid session (docs/SPEC.md §12.2, Q7). Copied verbatim from the card.</summary>
public class LockKeeperTests
{
    private const long T = 1_000_000;

    private static LockStep[] Steps(params LockStep[] steps) => steps;

    [Fact]
    public void UnlockingWithTimeLeftStartsCounting()
    {
        var keeper = new LockKeeper();
        Assert.Equal(Steps(LockStep.StartCounting), keeper.OnUnlock(outOfTime: false, T));
        Assert.Empty(keeper.Check(outOfTime: false, T + 1_000));
    }

    [Fact]
    public void RunningOutWhileInUseLocksAtOnce()
    {
        var keeper = new LockKeeper();
        keeper.OnUnlock(outOfTime: false, T);
        Assert.Equal(Steps(LockStep.Lock), keeper.Check(outOfTime: true, T + 1_000));
        Assert.Empty(keeper.Check(outOfTime: true, T + 1_500));
    }

    [Fact]
    public void NoConfirmationInTwoSecondsDisconnectsOnce()
    {
        var keeper = new LockKeeper();
        keeper.OnUnlock(outOfTime: false, T);
        Assert.Equal(Steps(LockStep.Lock), keeper.Check(outOfTime: true, T));
        Assert.Empty(keeper.Check(outOfTime: true, T + 1_999));
        Assert.Equal(Steps(LockStep.Disconnect), keeper.Check(outOfTime: true, T + 2_000));
        Assert.Empty(keeper.Check(outOfTime: true, T + 3_000));
    }

    [Fact]
    public void AConfirmedLockNeverDisconnectsButIsTriedAgainAfterTenSeconds()
    {
        var keeper = new LockKeeper();
        keeper.OnUnlock(outOfTime: false, T);
        Assert.Equal(Steps(LockStep.Lock), keeper.Check(outOfTime: true, T));
        keeper.OnLockConfirmed();
        Assert.Empty(keeper.Check(outOfTime: true, T + 5_000));
        Assert.Equal(Steps(LockStep.Lock), keeper.Check(outOfTime: true, T + 10_000));
        Assert.Empty(keeper.Check(outOfTime: true, T + 11_000));
        Assert.Equal(Steps(LockStep.Disconnect), keeper.Check(outOfTime: true, T + 12_000));
    }

    [Fact]
    public void UnlockingWhileOutOfTimeToastsAndRelocksAfterTenSeconds()
    {
        var keeper = new LockKeeper();
        Assert.Equal(Steps(LockStep.Toast), keeper.OnUnlock(outOfTime: true, T));
        Assert.Empty(keeper.Check(outOfTime: true, T + 9_999));
        Assert.Equal(Steps(LockStep.Lock), keeper.Check(outOfTime: true, T + 10_000));
    }

    [Fact]
    public void TimeGrantedDuringTheTenSecondsStartsCounting()
    {
        var keeper = new LockKeeper();
        keeper.OnUnlock(outOfTime: true, T);
        Assert.Equal(Steps(LockStep.StartCounting), keeper.Check(outOfTime: false, T + 4_000));
        Assert.Empty(keeper.Check(outOfTime: false, T + 4_500));
        Assert.Equal(Steps(LockStep.Lock), keeper.Check(outOfTime: true, T + 5_000));
    }

    [Fact]
    public void BackInTimeStopsTheLocking()
    {
        var keeper = new LockKeeper();
        keeper.OnUnlock(outOfTime: false, T);
        Assert.Equal(Steps(LockStep.Lock), keeper.Check(outOfTime: true, T));
        Assert.Empty(keeper.Check(outOfTime: false, T + 500));
        Assert.Empty(keeper.Check(outOfTime: false, T + 2_500));
    }

    [Fact]
    public void ALockedSessionAsksForNothing()
    {
        var keeper = new LockKeeper();
        Assert.Empty(keeper.Check(outOfTime: true, T));
        keeper.OnUnlock(outOfTime: false, T);
        keeper.OnLocked();
        Assert.Empty(keeper.Check(outOfTime: true, T + 1_000));
        Assert.Empty(keeper.Check(outOfTime: false, T + 2_000));
    }

    [Fact]
    public void ParentModeStopsTheLockUntilItEnds()
    {
        var now = Ms("2026-10-25T23:00:00Z");
        var locked = new EngineResult(true, LockReason.Bedtime, 0, null, DateTimeOffset.FromUnixTimeMilliseconds(now), 0, 0);
        var open = locked with { Locked = false, LockReason = null, RemainingSec = 600 };
        var off = State();
        var untilEnded = off with { ParentMode = new DeviceStateParentMode(true, null, "Dad") };
        var tenMore = off with { ParentMode = new DeviceStateParentMode(true, "2026-10-25T23:10:00.000Z", "Dad") };
        var ended = off with { ParentMode = new DeviceStateParentMode(true, "2026-10-25T23:00:00.000Z", "Dad") };

        Assert.True(LockKeeper.OutOfTime(locked, off, now));
        Assert.False(LockKeeper.OutOfTime(open, off, now));
        Assert.False(LockKeeper.OutOfTime(locked, untilEnded, now));
        Assert.False(LockKeeper.OutOfTime(locked, tenMore, now));
        Assert.True(LockKeeper.OutOfTime(locked, ended, now));
    }
}
```

### 5.3 `windows/tests/ScreenTime.Core.Tests/PipeMessageTests.cs`

```csharp
using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-048: the JSON lines between the service and the tray (docs/SPEC.md §12.2). Copied verbatim from the card.</summary>
public class PipeMessageTests
{
    [Fact]
    public void MessagesAreOneCompactLineWithoutNulls()
    {
        Assert.Equal("""{"type":"lock","id":"l1"}""", PipeMessage.Encode(PipeMessage.Lock("l1")));
        Assert.Equal("""{"type":"locked","id":"l1"}""", PipeMessage.Encode(PipeMessage.Locked("l1")));
        Assert.Equal("""{"type":"toast","text":"Out of Screens time. Ask Mum or Dad."}""", PipeMessage.Encode(PipeMessage.Toast("Out of Screens time. Ask Mum or Dad.")));
        Assert.Equal("""{"type":"hello","pid":4242}""", PipeMessage.Encode(PipeMessage.Hello(4242)));
        Assert.Equal(
            """{"type":"status","kidName":"Alex","remainingSec":4320,"locked":false,"offline":true}""",
            PipeMessage.Encode(PipeMessage.Status("Alex", 4320, locked: false, offline: true)));
    }

    [Fact]
    public void ALineDecodesBackToTheSameMessage()
    {
        var status = PipeMessage.Status("Alex", 4320, locked: true, offline: false);
        Assert.Equal(status, PipeMessage.Decode(PipeMessage.Encode(status)));
        Assert.Equal(PipeMessage.Lock("l1"), PipeMessage.Decode("""{"id":"l1","type":"lock"}"""));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("null")]
    [InlineData("[1]")]
    [InlineData("""{"id":"l1"}""")]
    [InlineData("""{"type":null}""")]
    public void ABrokenLineIsNull(string line) => Assert.Null(PipeMessage.Decode(line));
}
```

### 5.4 `windows/src/ScreenTime.Tray/App.xaml.cs`

```csharp
using Microsoft.UI.Xaml;

namespace ScreenTime.Tray;

/// <summary>
/// CARD-048: the tray has no window yet (the flyout comes in CARD-049). It only keeps the pipe to the service, which
/// starts it with <c>--pipe ScreenTime.&lt;sessionId&gt; [--dry-lock]</c>. Copied verbatim from the card.
/// </summary>
public partial class App : Application
{
    private TrayPipe? _pipe;

    public App()
    {
        InitializeComponent();
        DispatcherShutdownMode = DispatcherShutdownMode.OnExplicitShutdown;
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var argv = Environment.GetCommandLineArgs();
        var at = Array.IndexOf(argv, "--pipe");
        if (at < 0 || at + 1 >= argv.Length)
        {
            TrayLog.Write("no --pipe: exiting");
            Exit();
            return;
        }
        var dryLock = Array.IndexOf(argv, "--dry-lock") >= 0;
        _pipe = new TrayPipe(argv[at + 1], dryLock, TrayLog.Write);
        _ = _pipe.RunAsync();
    }
}
```

## 6. What to write

### 6.1 `windows/src/ScreenTime.Core/Service/Live.cs` (namespace `ScreenTime.Core.Service`)

`public static class Live`, the same rules as the Android kid app's `live/Live.kt`:
- `public const string Ping = """{"type":"ping"}""";`
- `public static string Url(string serverUrl)`: trim trailing `/`, then `https://` becomes `wss://` and `http://` becomes `ws://`; anything else throws `ArgumentException`. Append `/v1/device/ws`.
- `public static long BackoffMs(int attempt, double jitter)`: `Math.Min(1_000L << Math.Clamp(attempt, 0, 6), 60_000L)`, times `jitter`, cast to `long`. The caller passes a jitter between 0.8 and 1.2.
- `public static bool AsksForSync(string frame)`: parse with `JsonDocument.Parse`. True when the root is an object whose `type` is a string other than `pong`. Invalid JSON (`JsonException`) or anything else gives false.

### 6.2 `windows/src/ScreenTime.Core/Service/LockKeeper.cs` (namespace `ScreenTime.Core.Service`)

```csharp
public enum LockStep { StartCounting, Lock, Disconnect, Toast }
public sealed class LockKeeper
```

One `LockKeeper` per kid session. The service calls it; it only decides. Its state: `unlocked` (bool), `counting` (bool), `relockAt` (long?), `lockSentAt` (long?), `confirmed` (bool), `disconnectSent` (bool).

| Method | What it does |
|---|---|
| `IReadOnlyList<LockStep> OnUnlock(bool outOfTime, long nowMs)` | The session was unlocked or logged on. `unlocked = true`, clear `lockSentAt`, `confirmed`, `disconnectSent`. Out of time: `relockAt = nowMs + 10_000`, `counting = false`, return `[Toast]`. Otherwise `relockAt = null`, `counting = true`, return `[StartCounting]`. |
| `void OnLocked()` | The session was locked, logged off, disconnected, or the PC sleeps. Everything back to the start: `unlocked = false`, `counting = false`, and the four lock fields cleared. |
| `void OnLockConfirmed()` | The tray says `LockWorkStation` worked: `confirmed = true`. |
| `IReadOnlyList<LockStep> Check(bool outOfTime, long nowMs)` | Called every second. See the rules below. |
| `static bool ParentModeOn(DeviceState state, long nowMs)` | `state.ParentMode.Active` and (`EndsAt` is null, or `EndsAt` parsed with `DateTimeOffset.Parse(…, CultureInfo.InvariantCulture)` is **after** `nowMs`). |
| `static bool OutOfTime(EngineResult result, DeviceState state, long nowMs)` | `result.Locked && !ParentModeOn(state, nowMs)`. |

`Check` rules, in this order:
1. Not `unlocked`: return `[]`.
2. Not `outOfTime`: clear `relockAt`, `lockSentAt`, `confirmed`, `disconnectSent`. When not `counting`: `counting = true`, return `[StartCounting]`. Otherwise `[]`.
3. `relockAt` is set and `nowMs < relockAt`: return `[]`.
4. `lockSentAt` is set:
   - `nowMs >= lockSentAt + 10_000` (still unlocked 10 s after asking): go to 5.
   - not `confirmed`, not `disconnectSent`, and `nowMs >= lockSentAt + 2_000`: `disconnectSent = true`, return `[Disconnect]`.
   - otherwise return `[]`.
5. Lock: `lockSentAt = nowMs`, `relockAt = null`, `confirmed = false`, `disconnectSent = false`, return `[Lock]`.

### 6.3 `windows/src/ScreenTime.Core/Service/PipeMessage.cs` (namespace `ScreenTime.Core.Service`)

```csharp
public sealed record PipeMessage(string Type, string? Id = null, string? Text = null, int? Pid = null,
    string? KidName = null, long? RemainingSec = null, [property: JsonPropertyName("locked")] bool? IsLocked = null, bool? Offline = null)
```

The parameters stay in this order: it is the JSON order. The record parameter is called `IsLocked`, not `Locked`, because `Locked` would clash with the static factory `Locked(string id)` (error CS0102); `[property: JsonPropertyName("locked")]` keeps the JSON field `locked`. Factories (static): `Lock(string id)`, `Locked(string id)`, `Toast(string text)`, `Hello(int pid)`, `Status(string kidName, long remainingSec, bool locked, bool offline)`, with the types `lock`, `locked`, `toast`, `hello` and `status`.

- `public static string Encode(PipeMessage message)`: one line, no newline at the end.
- `public static PipeMessage? Decode(string line)`: null when the line is not a JSON object with a string `type` (catch `JsonException` only).

JSON goes through `[JsonSerializable(typeof(PipeMessage))] internal sealed partial class PipeJsonContext : JsonSerializerContext` with `[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, RespectNullableAnnotations = true, RespectRequiredConstructorParameters = true)]`, so a missing or null `type` throws inside `Decode`.

Who sends what:

| From | Type | Meaning |
|---|---|---|
| tray | `hello` | Connected; `pid` is the tray's process id. |
| tray | `locked` | `LockWorkStation` worked for the `lock` with this `id`. |
| service | `lock` | Lock the PC now. |
| service | `toast` | Show `text` (CARD-049 shows it; this card only logs it). |
| service | `status` | After every sync of that account; the flyout uses it in CARD-049. |

### 6.4 `windows/src/ScreenTime.Service/LiveChannel.cs` (namespace `ScreenTime.Service`)

`public sealed class LiveChannel(string url, Func<string> token, Action requestSync, ILogger logger, string kidName)` with `Task RunAsync(CancellationToken ct)`, which loops until `ct` is cancelled:

1. `using var ws = new ClientWebSocket();` `ws.Options.SetRequestHeader("Authorization", "Bearer " + token());`
2. `ConnectAsync(new Uri(url), …)` with a 15 s timeout (a linked `CancellationTokenSource` with `CancelAfter`). On success: log Information `live {Kid}: connected`, set `attempt = 0`, call `requestSync()` (a message may have been missed while down).
3. While open, two tasks:
   - **Ping**: every 30 s send `Live.Ping` as one text message.
   - **Receive**: read whole text messages (4 KB buffer into a `MemoryStream` until `EndOfMessage`). Each receive has its own 75 s timeout; when it runs out, log `live {Kid}: silent for 75 s` and abort. A message for which `Live.AsksForSync` is true calls `requestSync()`. A close message: log `live {Kid}: closed {Code}` (the close status number) and stop.
4. Any `WebSocketException`, timeout or close: log Warning `live {Kid}: down ({Message})` once, then wait `Live.BackoffMs(attempt, 0.8 + Random.Shared.NextDouble() * 0.4)` and `attempt++`. A revoked device (close 4401 or HTTP 401) also just waits and tries again.

The socket only asks for syncs. It never syncs itself and never touches the store. **Never log the token or the request headers.**

### 6.5 `windows/src/ScreenTime.Service/TrayHost.cs` (namespace `ScreenTime.Service`)

`public sealed class TrayHost(uint sessionId, string kidSid, string? trayExe, bool dryLock, bool asService, Func<PipeMessage, Task> onMessage, ILogger logger)`

- `Task RunAsync(CancellationToken ct)`: runs the pipe loop and, when `trayExe` is not null, the tray loop, until `ct` is cancelled.
- `Task SendAsync(PipeMessage message)`: when a tray is connected, writes `PipeMessage.Encode(message)` and `\n`, under a `SemaphoreSlim(1, 1)`, and flushes. When none is connected, or the write throws `IOException`, it does nothing.

**Pipe loop.** Name `ScreenTime.{sessionId}`. Security: a new `PipeSecurity` with two allow rules: `PipeAccessRights.FullControl` for `new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null)`, and `PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize` for `new SecurityIdentifier(kidSid)`. Create it with `NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, security)`. Then loop: `WaitForConnectionAsync(ct)`, log `tray {Session}: pipe connected`, read lines with a `StreamReader` (UTF-8, no BOM, and a `StreamWriter` with the same encoding for `SendAsync`), and pass every line that `PipeMessage.Decode` turns into a message to `onMessage`. When the line is null or an `IOException` comes: log `tray {Session}: pipe closed`, `Disconnect()`, and wait for the next connection on the same stream.

**Tray loop.** Arguments: `--pipe ScreenTime.{sessionId}`, plus ` --dry-lock` when `dryLock`. Loop:
1. Start it: when `asService`, `Win.StartInSession(sessionId, trayExe, arguments)`; otherwise `Process.Start(new ProcessStartInfo(trayExe, arguments) { UseShellExecute = false })!.Id`. Log `tray {Session}: started pid {Pid}`. When starting throws, log the message as a Warning, wait 5 s and try again.
2. Wait for it to exit: `Process.GetProcessById(pid)` then `WaitForExitAsync(ct)`. When `GetProcessById` throws `ArgumentException`, it has already exited.
3. Log `tray {Session}: exited, starting again`, wait 1 s, and go back to 1.

### 6.6 `windows/src/ScreenTime.Service/Worker.cs` (changed)

`ServiceOptions` becomes `public sealed record ServiceOptions(string DataFolder, bool SecureFolder, string? TrayExe, bool DryLock, bool AsService);`.

Keep everything from CARD-047b (the store, clock, tracker, the semaphore, the SID fallback dictionary, `SyncAccount`, the 60 s timer, the shutdown at the end) and change or add this:

**Kid sessions.** A `Dictionary<uint, KidSession>`, where `KidSession` is a private class with `uint SessionId`, `string Sid`, `LockKeeper Keeper`, `TrayHost Tray`, `CancellationTokenSource Cts` and `bool Unlocked`. `EnsureSession(sessionId, sid)` adds one when there is none and `store.GetDevice(sid)` is not null: it makes the `TrayHost` (with `onMessage = m => OnTrayMessage(sessionId, m)`, which looks the session up in the dictionary) and starts `Tray.RunAsync(Cts.Token)` without awaiting it.

**`bool OutOfTime(string sid, long now)`**: no cached state gives false. Otherwise `LockKeeper.OutOfTime(Engine.Evaluate(TodayInput.For(state, store.SegmentsSince(sid, TodayInput.DayStartMs(state, now)), now)), state, now)`.

**`Apply(KidSession s, IReadOnlyList<LockStep> steps)`**, for each step:
- `StartCounting`: `tracker.OnChange(SessionChange.Unlock, s.Sid, true, now)`.
- `Lock`: log `{Kid}: locking session {Session}`, then `s.Tray.SendAsync(PipeMessage.Lock(Guid.NewGuid().ToString()))`.
- `Disconnect`: with `DryLock`, log Warning `dry run: would disconnect session {Session}`. Otherwise log Warning `{Kid}: tray did not lock, disconnecting session {Session}` and call `Win.Disconnect(s.SessionId)`.
- `Toast`: `s.Tray.SendAsync(PipeMessage.Toast("Out of Screens time. Ask Mum or Dad."))`.

**Start** (replaces 047b's step 5): `tracker.OnServiceStart(null, false, now)` only closes what a crash left open. Then, for the console session: when its SID is a kid account, `EnsureSession`, and when `Win.SessionUnlocked(console)`, `Unlock(s)`. `Unlock(s)` is `s.Unlocked = true; Apply(s, s.Keeper.OnUnlock(OutOfTime(s.Sid, now), now))`.

**Session events** (replaces the direct `tracker.OnChange` call):
- `Logon`, `Unlock` on the console session of a kid account: `EnsureSession`, then `Unlock(s)`. The tracker is **not** called here: `StartCounting` does it, so the 10 s before a relock are not counted. Any other session: ignore.
- `Lock`, `Disconnect`: when the session is in the dictionary, `s.Unlocked = false` and `s.Keeper.OnLocked()`. Then `tracker.OnChange(...)` and sync what it returns, as in 047b.
- `Logoff`: the same, then cancel `s.Cts` and remove the session.
- `Suspend`, `Shutdown`: every session gets `Unlocked = false` and `OnLocked()`; then the tracker as in 047b.

**`OnTrayMessage(uint sessionId, PipeMessage m)`**, under the semaphore, for the session found (none: ignore): `hello` logs `tray {Session}: hello pid {Pid}` and sends a `status` at once (as after a sync). `locked` calls `s.Keeper.OnLockConfirmed()` and logs `tray {Session}: locked`. Others are ignored.

**Lock loop** (new, third loop): `PeriodicTimer(TimeSpan.FromSeconds(1))`; each tick, under the semaphore, `Apply(s, s.Keeper.Check(OutOfTime(s.Sid, now), now))` for every session with `Unlocked`.

**Live channels** (new): a `Dictionary<string, Task>` of running `LiveChannel`s by SID. At start, and on each 60 s tick, start one for every device that has none: `new LiveChannel(Live.Url(config.ServerUrl), token, () => syncRequests.Writer.TryWrite(sid), logger, device.KidName)`, with the same `token` as the `ApiClient`. `syncRequests` is an unbounded `Channel<string>`; a **sync loop** (fourth loop) reads it and, under the semaphore, runs `SyncAccount(sid)`.

**Status**: at the end of `SyncAccount`, when the state is cached, send `PipeMessage.Status(device.KidName, result.RemainingSec, OutOfTime(sid, now), offline: !synced)` to every session of that SID. Keep 047b's `{Kid}: {Minutes} min left, locked {Locked}` log line.

All four loops stop on `stoppingToken`; then cancel every session's `Cts` and do 047b's shutdown.

### 6.7 `windows/src/ScreenTime.Service/Program.cs` (changed)

Only the service host (no command) changes. Two new options, before or after `--data`:
- `--tray <path>`: the tray exe. Without it: `Path.Combine(AppContext.BaseDirectory, "ScreenTime.Tray.exe")` when `WindowsServiceHelpers.IsWindowsService()`, otherwise **null** (no tray in a console run).
- `--dry-lock`: a flag **without a value**. The argument loop must handle it before the generic `--key value` case.

Register `new ServiceOptions(dataFolder, secure, trayExe, dryLock, WindowsServiceHelpers.IsWindowsService())`. `enrol`, `sync-once` and `demo-usage` are unchanged.

### 6.8 `windows/src/ScreenTime.Tray/TrayPipe.cs` (namespace `ScreenTime.Tray`)

`internal sealed partial class TrayPipe(string pipeName, bool dryLock, Action<string> log)` with `Task RunAsync()`, which loops for ever:
1. `new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous)`, `ConnectAsync(5_000)`. On `TimeoutException` or `IOException`, wait 1 s and try again.
2. Log `pipe: connected`. Send `PipeMessage.Encode(PipeMessage.Hello(Environment.ProcessId))` and `\n` (UTF-8 without BOM, flush after each line).
3. Read lines. `PipeMessage.Decode`, then by type:
   - `lock`: with `dryLock`, log `lock: dry run`; otherwise call `LockWorkStation()` and log `lock: done`, or `lock: failed {Marshal.GetLastPInvokeError()}` and send nothing. Unless it failed, send `PipeMessage.Locked(id)`.
   - `toast`: log `toast: {text}`.
   - `status`: log `status: {remainingSec / 60} min left, locked {locked}, offline {offline}`.
   - anything else: ignore.
4. End of stream or `IOException`: log `pipe: closed`, wait 1 s, go back to 1.

```csharp
[LibraryImport("user32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
private static partial bool LockWorkStation();
```

In the same file, `internal static class TrayLog` with `public static void Write(string line)`: append `HH:mm:ss line` (local time, `CultureInfo.InvariantCulture`) and a newline to `%LOCALAPPDATA%\ScreenTime\tray.log` (`Environment.SpecialFolder.LocalApplicationData`), creating the folder. Swallow `IOException`. Two writes can come from different threads, so use a `lock`.

### 6.9 `windows/src/ScreenTime.Tray/ScreenTime.Tray.csproj`

In the existing `PropertyGroup`, add `<AllowUnsafeBlocks>true</AllowUnsafeBlocks>`. Change nothing else.

### 6.10 Files

1. Copy from section 5: `LiveTests.cs`, `LockKeeperTests.cs`, `PipeMessageTests.cs` and `windows/src/ScreenTime.Tray/App.xaml.cs` (this replaces the placeholder).
2. New in `windows/src/ScreenTime.Core/Service/`: `Live.cs`, `LockKeeper.cs`, `PipeMessage.cs` (6.1 to 6.3).
3. New in `windows/src/ScreenTime.Service/`: `LiveChannel.cs`, `TrayHost.cs`. Changed: `Worker.cs`, `Program.cs` (6.4 to 6.7).
4. New `windows/src/ScreenTime.Tray/TrayPipe.cs`; changed `ScreenTime.Tray.csproj` (6.8, 6.9).

## 7. Steps

1. `git checkout main`, `git pull`, `git checkout -b bob/card-048-lock`. Check that `docs/cards/CARD-048-lock.md` and `windows/src/ScreenTime.Service/WinTray.cs` exist.
2. Copy the four files in section 5. Run the fingerprints (8.1) **once**.
3. Write 6.1 to 6.3. Build and run the tests until they pass.
4. Write 6.4 to 6.9. Build the solution until it passes with 0 errors **once per change**; when an error is not clear to you after one try, paste it in the handback and stop.
5. Do the run in 8.3, pasting every output.
6. Commit `CARD-048: Windows: locking, the live channel and the tray pipe`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: four lines, each ending in `True`.
  ```powershell
  function Fp($f, $want) {
    $b = [IO.File]::ReadAllBytes("windows\$f") | Where-Object { $_ -ne 13 }
    $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
    "$f $h $($h -eq $want)"
  }
  Fp "tests\ScreenTime.Core.Tests\LiveTests.cs" "8fe5b76b8f09f76601da1082ec5fada6e417693934e5080e0f627063f975524e"
  Fp "tests\ScreenTime.Core.Tests\LockKeeperTests.cs" "8e90294a9002dd3e273ad72517f73f31da1b338b15ac8b98b26623e21613e228"
  Fp "tests\ScreenTime.Core.Tests\PipeMessageTests.cs" "58af0a8c9ec7bffb525253ed2aae98ad3e8e919f0752c2bb0e9e75e5932ee817"
  Fp "src\ScreenTime.Tray\App.xaml.cs" "c85070e48a2247e08ff2ca29981ef6f06a99fba8961e4cd34201267e72b0ca69"
  ```
- [ ] `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors.
- [ ] `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 143** (106 before + 37). Paste the summary lines.
- [ ] `Select-String -Path windows\src\ScreenTime.Core\Service\*.cs -Pattern 'DateTime\.Now|UtcNow|TickCount|DllImport'` prints nothing.
- [ ] `Select-String -Path windows\src\ScreenTime.Service\*.cs,windows\src\ScreenTime.Tray\*.cs -Pattern 'DllImport|Log\w*\(.*[Tt]oken'` prints nothing.

### 8.2 Repo

- [ ] `git status` clean. No `bin\`, `obj\`, `state.db`, `config.json`, `clock.json` or `*.log` in the repo.
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 13 files:
  ```
  windows/src/ScreenTime.Core/Service/Live.cs
  windows/src/ScreenTime.Core/Service/LockKeeper.cs
  windows/src/ScreenTime.Core/Service/PipeMessage.cs
  windows/src/ScreenTime.Service/LiveChannel.cs
  windows/src/ScreenTime.Service/Program.cs
  windows/src/ScreenTime.Service/TrayHost.cs
  windows/src/ScreenTime.Service/Worker.cs
  windows/src/ScreenTime.Tray/App.xaml.cs
  windows/src/ScreenTime.Tray/ScreenTime.Tray.csproj
  windows/src/ScreenTime.Tray/TrayPipe.cs
  windows/tests/ScreenTime.Core.Tests/LiveTests.cs
  windows/tests/ScreenTime.Core.Tests/LockKeeperTests.cs
  windows/tests/ScreenTime.Core.Tests/PipeMessageTests.cs
  ```

### 8.3 The run on James's PC (console, dry-lock, no admin, no service install)

Paste the **real output of every line**. A step without output counts as NOT RUN. Docker Desktop must be running. Use one PowerShell window, from the repo root, and keep the variables set.

1. The local server, the dev family and the paths (as CARD-047b 8.3 step 1, plus `JWT_SECRET` for `dev-grant.ts`):
   ```powershell
   Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
   $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
   $env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
   pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
   $tmp = "C:\Users\james\OpenCode\Testing\temp"
   $t = "$tmp\c48"
   $log = "$tmp\c48-service.log"
   $trayLog = "$env:LOCALAPPDATA\ScreenTime\tray.log"
   $svcExe = (Resolve-Path "windows\src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe").Path
   $trayExe = (Resolve-Path "windows\src\ScreenTime.Tray\bin\Release\net10.0-windows10.0.26100.0\win-x64\ScreenTime.Tray.exe").Path
   Remove-Item $trayLog -ErrorAction SilentlyContinue
   function Grant([int]$minutes) { pnpm --silent --filter @screentime/server exec tsx scripts/dev-grant.ts Sam screens $minutes }
   function Svc([string[]]$more) { Start-Process $svcExe -ArgumentList (@("--data", $t, "--dry-lock") + $more) -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru }
   ```
   If either `Resolve-Path` fails, run `dotnet build ScreenTime.slnx -c Release` (from `windows\`) and paste the path it built to.
2. Enrol your own account as Sam:
   ```powershell
   $code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
   & $svcExe enrol --server http://localhost:8080 --code $code --user $env:USERNAME --data $t
   ```
   Expect `Enrolled <you> as Sam (device …).` Never print `$code`.
3. Start the service with the tray, wait, look:
   ```powershell
   $p = Svc @("--tray", $trayExe); Start-Sleep 15
   Select-String $log -Pattern "live Sam|tray |min left" | ForEach-Object Line
   Get-Content $trayLog
   [IO.Directory]::GetFiles("\\.\pipe\") | Where-Object { $_ -like "*ScreenTime*" }
   ```
   Expect `live Sam: connected`, `tray N: started pid …`, `tray N: pipe connected`, `tray N: hello pid …` and a `Sam: … min left, locked False` line (N is your session id). The tray log has `pipe: connected` and a `status:` line. The pipe list shows `\\.\pipe\ScreenTime.N`. **At bedtime or before wake** it says `locked True` and the lock lines of step 4 already appear: say so in the handback and carry on.
4. Out of time:
   ```powershell
   Grant -600; Start-Sleep 14
   Select-String $log -Pattern "locking|tray .*: locked|would disconnect" | ForEach-Object Line
   Get-Content $trayLog | Select-String "lock:"
   ```
   Expect at least two `Sam: locking session N` lines (the first within about 2 s of the grant, then one every 10 s), as many `tray N: locked`, the tray's `lock: dry run` lines, and **no** `would disconnect`.
5. Back in time:
   ```powershell
   Grant 900; Start-Sleep 5
   $a = (Select-String $log -Pattern "locking").Count; Start-Sleep 12
   $b = (Select-String $log -Pattern "locking").Count; "$a $b"
   Select-String $log -Pattern "min left" | Select-Object -Last 1 | ForEach-Object Line
   ```
   Expect two equal numbers, and `locked False` in the last line.
6. A killed tray comes back:
   ```powershell
   Stop-Process -Name ScreenTime.Tray; Start-Sleep 4
   Select-String $log -Pattern "tray .*: (started|exited)" | ForEach-Object Line
   ```
   Expect `started`, `exited, starting again`, `started` (a new pid).
7. No tray: the disconnect fallback (dry run):
   ```powershell
   Stop-Process -Id $p.Id; Start-Sleep 2; Stop-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue
   $p = Svc @(); Start-Sleep 8
   Grant -900; Start-Sleep 8
   Select-String $log -Pattern "live Sam|locking|would disconnect" | ForEach-Object Line
   Stop-Process -Id $p.Id
   ```
   Expect `live Sam: connected`, then `Sam: locking session N`, then `dry run: would disconnect session N` about 2 s later.
8. Clean up:
   ```powershell
   Get-Content "$log.err"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item -Recurse $t, $log, "$log.err", $trayLog
   ```
   Paste `$log.err` (it should be empty).

## 9. Tests

| File | Tests | What it checks |
|---|---|---|
| `LiveTests` | 20 cases | Socket address from the server address; backoff 1 s to 60 s with jitter; which frames ask for a sync; the ping. |
| `LockKeeperTests` | 9 | Counting on unlock; lock at zero; 2 s disconnect fallback, once; a confirmed lock tried again after 10 s; toast and relock 10 s after an unlock while out of time; a grant in those 10 s; back in time; a locked session; parent mode. |
| `PipeMessageTests` | 2 facts + 6 cases | The exact JSON lines; round trip in any key order; broken lines. |

## 10. Git and pull request

Push `bob/card-048-lock` and open the PR with `gh pr create --base main --title "CARD-048: Windows: locking, the live channel and the tray pipe" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body says what the card asked for, lists the files, and gives the test summary and the 8.3 results. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". Never change a test or a copied file.

- **A copied file does not compile, or an analyzer rule fails it**, and the error is in that file: paste the full error and stop. The card may be wrong.
- **An AOT or trim warning (`IL…`)**: paste it and stop. No `NoWarn`, no `#pragma`.
- **A Windows API or .NET type you are not sure exists**: do not guess a name. Use only what this card names; when that is not enough, paste the error and stop.
- **Step 3 has no `live Sam: connected`**: paste the whole `$log` and `$log.err` and stop.
- **Step 3 has no `pipe connected`**: paste the whole `$log` and `$trayLog` and stop.
- **`enrol` prints `401`**: the code expired (10 minutes). Make a new one with the step 2 command, once.

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
Claude, here is Bob's handback for CARD-048. Please review and merge if it is good.

CARD: CARD-048 Windows: locking, the live channel and the tray pipe
PR: <full PR URL>
Branch: bob/card-048-lock
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
