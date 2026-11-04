# CARD-051: Windows: tamper detection, and parent mode across restarts

| Field | Value |
|---|---|
| Card | CARD-051 |
| Title | Windows: tamper detection, and parent mode across restarts |
| Size | L (one whole feature, logic and wiring and run) |
| Depends on | CARD-050d and the tray's caught card (PR #142, by Claude), both merged to `main` |
| Spec sections | docs/SPEC.md §14 (tamper detection, caught screen), §12.3 (parent mode), §12.2 (Windows) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-051-tamper` |
| PR title | `CARD-051: Windows: tamper detection, and parent mode across restarts` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

`AGENTS.md` rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command and every run step** and lists every workaround. Rule 10: never change Claude's front-end files.

This is a **full-size card** (docs/BUILD-PLAN.md, "Rules for sizing"): the logic with its tests, the wiring, and the run, together. Claude has already done all of it once with a throwaway build: the tests pass and section 8.3 shows the run.

**Tamper detection** (docs/SPEC.md §14). On Windows, three attempts are detected:

| Event kind | Detected by | Payload |
|---|---|---|
| `tamper.clock` | The wall clock is more than 2 minutes from trusted time | `{"offsetMin":5}` (minutes ahead; negative when behind) |
| `tamper.timezone` | The PC's time zone changed | `{"from":"AUS Eastern Standard Time","to":"UTC"}` |
| `tamper.tray_killed` | The tray exits 3 times in 10 minutes | `{"exits":3}` |

Each attempt is put in the store's **outbox** (the `outbox` table already exists in `LocalStore`, unused until now), sent with `POST /v1/device/events` before the next sync (again until the server has it; sending again is safe), and shows the **caught** toast and card in the tray. Claude's front end for that is on `main` (PR #142): the tray calls `TrayModel.Caught()` on a `caught` line, which shows a toast and opens the flyout with an orange card ("Nice try, Agent Sam! 🕵️ Mum and Dad have been told.").

**Parent mode across restarts.** CARD-050d keeps this PC's parent mode (`LocalParentMode`) in memory only, so a code session not yet reported to the server is lost if the service restarts. This card keeps it in the store, in a new small key-value table.

**Not in this card, moved to the installer (CARD-052):** removing the "Change the time zone" right from kid accounts and registering for Safe Mode. Both need administrator rights, which the installer has and a dry-lock run does not.

**Testing without touching James's PC.** Changing the real clock or time zone would change James's system settings, so the run never does it. Two new **dev-only** service options, refused without `--dry-lock` like `--session`, let the run pretend: `--fake-clock-file <path>` (the file holds minutes to add to the wall clock) and `--fake-timezone-file <path>` (the file holds a time zone id). Tray kills in the run are real (`Stop-Process`).

## 2. Goal

- `dotnet build` and `dotnet test` pass in `windows/`: **total 246** (237 before + 9). CI **Windows / build and test** is green.
- The run in 8.3 shows: each of the three attempts is logged, sent to the server (three rows in its `events` table, with their payloads) and caught in the tray; and a parent mode started by code while the server is down **survives a service restart** and is reported when the server is back.

## 3. Out of scope

- Any change to Claude's front-end files: `App.xaml(.cs)`, `FlyoutWindow.*`, `ITraySender.cs`, `TrayModel.cs`, `TrayIcon.cs`, `Toasts.cs`, `DemoStatus.cs`, `Assets/*`, `Core/Tray/TrayStatus.cs`.
- Changing the store's schema version: the new table is added without a version bump (6.3), and the existing test `TheSchemaVersionIsOne` must still pass.
- The time zone right and Safe Mode (CARD-052). `tamper.policy` and `tamper.call_blocked` (Android only).
- No new packages, no change to the generated API files, the test csproj, any workflow or the server.
- **Do not install or start the Windows service.** **Never run the service without `--dry-lock`** on James's PC. **Never change the PC's real clock or time zone.**

## 4. Tech

- .NET 10, nullable on, warnings are errors. `ScreenTime.Core` is `IsAotCompatible`; `ScreenTime.Service` has `PublishAot`: no reflection, JSON only through source-generated contexts or `JsonDocument`.
- `DeviceEventIn(Id, Kind, At, Payload)` and `DeviceEventUpload(Events)` are in the generated API files, already in `ApiJsonContext`. `Payload` is a `JsonElement?`: make it from a JSON string with `JsonDocument.Parse(…)`, then `RootElement.Clone()` (the clone outlives the document).
- `DeviceEventIn` writes `kind` as its API name (`"tamper.clock"`); the tests check the exact line.
- Instants in events are UTC `yyyy-MM-dd'T'HH:mm:ss.fff'Z'`, as elsewhere.

## 5. Files to copy

Copy this file exactly, byte for byte. 8.1 checks the fingerprint. It is the contract: never change it.

### 5.1 `windows/tests/ScreenTime.Core.Tests/TamperTests.cs`

```csharp
using Microsoft.Data.Sqlite;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Store;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-051: tamper detection on Windows (docs/SPEC.md §14) and the store's key-value table. Copied verbatim from the card.</summary>
public class TamperTests
{
    private static readonly long T = Ms("2026-10-27T05:00:00Z");

    [Fact]
    public void AClockMoreThanTwoMinutesOffIsReportedOnce()
    {
        var watch = new ClockWatch();
        Assert.Null(watch.Check(T + 600_000, T, anchored: false, "e0"));
        Assert.Null(watch.Check(T + 119_000, T, anchored: true, "e1"));
        var ahead = watch.Check(T + 300_000, T, anchored: true, "e2");
        Assert.NotNull(ahead);
        Assert.Equal("""{"id":"e2","kind":"tamper.clock","at":"2026-10-27T05:00:00.000Z","payload":{"offsetMin":5}}""", TamperEvents.Encode(ahead));
        Assert.Null(watch.Check(T + 301_000, T + 1_000, anchored: true, "e3"));
        Assert.Null(watch.Check(T + 2_000, T + 2_000, anchored: true, "e4"));
        var behind = watch.Check(T - 180_000, T + 3_000, anchored: true, "e5");
        Assert.NotNull(behind);
        Assert.Contains("\"offsetMin\":-3", TamperEvents.Encode(behind));
    }

    [Fact]
    public void ATimeZoneChangeIsReportedWithBothZones()
    {
        var watch = new TimeZoneWatch();
        Assert.Null(watch.Check("AUS Eastern Standard Time", T, "e1"));
        Assert.Null(watch.Check("AUS Eastern Standard Time", T + 1_000, "e2"));
        var changed = watch.Check("UTC", T + 2_000, "e3");
        Assert.NotNull(changed);
        Assert.Equal("""{"id":"e3","kind":"tamper.timezone","at":"2026-10-27T05:00:02.000Z","payload":{"from":"AUS Eastern Standard Time","to":"UTC"}}""", TamperEvents.Encode(changed));
        Assert.Null(watch.Check("UTC", T + 3_000, "e4"));
    }

    [Fact]
    public void ThreeTrayExitsInTenMinutesAreReported()
    {
        var watch = new TrayKillWatch();
        Assert.Null(watch.OnExit(T, "e1"));
        Assert.Null(watch.OnExit(T + 60_000, "e2"));
        var killed = watch.OnExit(T + 120_000, "e3");
        Assert.NotNull(killed);
        Assert.Equal("""{"id":"e3","kind":"tamper.tray_killed","at":"2026-10-27T05:02:00.000Z","payload":{"exits":3}}""", TamperEvents.Encode(killed));
        Assert.Null(watch.OnExit(T + 180_000, "e4"));
    }

    [Fact]
    public void ExitsSpreadOverMoreThanTenMinutesAreNot()
    {
        var watch = new TrayKillWatch();
        Assert.Null(watch.OnExit(T, "e1"));
        Assert.Null(watch.OnExit(T + 360_000, "e2"));
        Assert.Null(watch.OnExit(T + 720_000, "e3"));
        Assert.NotNull(watch.OnExit(T + 780_000, "e4"));
    }

    [Fact]
    public void AnEventReadsBackFromTheOutbox()
    {
        var e = new TimeZoneWatch();
        e.Check("A", T, "x");
        var changed = e.Check("B", T, "e9")!;
        var back = TamperEvents.Decode(TamperEvents.Encode(changed));
        Assert.NotNull(back);
        Assert.Equal("e9", back.Id);
        Assert.Equal(DeviceEventKind.TamperTimezone, back.Kind);
        Assert.Equal(TamperEvents.Encode(changed), TamperEvents.Encode(back));
        Assert.Null(TamperEvents.Decode("not json"));
    }

    [Fact]
    public void TheStoreKeepsValuesPerAccount()
    {
        var path = NewDbPath();
        try
        {
            using (var store = LocalStore.Open(path))
            {
                Assert.Null(store.GetValue(Alex, "parent-mode"));
                store.SetValue(Alex, "parent-mode", "one");
                store.SetValue(Alex, "parent-mode", "two");
                store.SetValue("S-1-5-21-1-1002", "parent-mode", "other");
                Assert.Equal("two", store.GetValue(Alex, "parent-mode"));
            }
            using (var again = LocalStore.Open(path))
            {
                Assert.Equal("two", again.GetValue(Alex, "parent-mode"));
                again.SetValue(Alex, "parent-mode", null);
                Assert.Null(again.GetValue(Alex, "parent-mode"));
                Assert.Equal("other", again.GetValue("S-1-5-21-1-1002", "parent-mode"));
            }
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public void AVersionOneStoreIsUpgradedInPlace()
    {
        var path = NewDbPath();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ConnectionString))
            {
                db.Open();
                using var cmd = db.CreateCommand();
                cmd.CommandText = """
                    CREATE TABLE devices (sid TEXT PRIMARY KEY, device_id TEXT NOT NULL, token BLOB NOT NULL, kid_name TEXT NOT NULL, timezone TEXT NOT NULL);
                    CREATE TABLE state (sid TEXT PRIMARY KEY, etag TEXT, json TEXT NOT NULL);
                    CREATE TABLE segments (id TEXT PRIMARY KEY, sid TEXT NOT NULL, started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER, last_seen_at_ms INTEGER NOT NULL, recorded_offline INTEGER NOT NULL, version INTEGER NOT NULL, sent_version INTEGER NOT NULL);
                    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
                    INSERT INTO devices VALUES ('S-1-5-21-1-1001', 'd1', x'01', 'Alex', 'Australia/Sydney');
                    PRAGMA user_version = 1;
                    """;
                cmd.ExecuteNonQuery();
            }
            using (var store = LocalStore.Open(path))
            {
                Assert.Equal("Alex", store.GetDevice(Alex)!.KidName);
                store.SetValue(Alex, "k", "v");
                Assert.Equal("v", store.GetValue(Alex, "k"));
            }
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public void ParentModeSurvivesARestartAsJson()
    {
        var local = new LocalParentMode(new CodeSession("c1", 15, T), T - 60_000, EndReported: false);
        Assert.Equal(local, ParentModeJson.Decode(ParentModeJson.Encode(local)));
        var forever = new LocalParentMode(new CodeSession("c2", null, T, T + 1_000));
        Assert.Equal(forever, ParentModeJson.Decode(ParentModeJson.Encode(forever)));
        Assert.Equal(new LocalParentMode(), ParentModeJson.Decode(null));
        Assert.Equal(new LocalParentMode(), ParentModeJson.Decode("not json"));
    }

    [Fact]
    public void TheCaughtLineIsJustItsType() =>
        Assert.Equal("""{"type":"caught"}""", PipeMessage.Encode(PipeMessage.Caught()));
}
```

## 6. What to write

Give every public type and member a one-line `/// <summary>` like the files around it.

### 6.1 `windows/src/ScreenTime.Core/Service/Tamper.cs` (new, `namespace ScreenTime.Core.Service`)

| Type | Member | Rule |
|---|---|---|
| `public sealed class ClockWatch` | `DeviceEventIn? Check(long wallMs, long trustedMs, bool anchored, string id)` | Not `anchored` (the trusted clock has no server time yet): `null`, and nothing changes. Otherwise `off` is `|wallMs − trustedMs| > 120_000`. Report only when `off` now and not `off` at the last anchored check (it starts not off); remember `off`. The event: kind `TamperClock`, at `trustedMs`, payload `{"offsetMin":n}` with `n = Math.Round((wallMs − trustedMs) / 60_000.0, MidpointRounding.AwayFromZero)` as a whole number. |
| `public sealed class TimeZoneWatch` | `DeviceEventIn? Check(string zoneId, long nowMs, string id)` | Remember the last id. The first call, or the same id again: `null`. A different id: kind `TamperTimezone`, at `nowMs`, payload `{"from":old,"to":new}` (in that order). |
| `public sealed class TrayKillWatch` | `DeviceEventIn? OnExit(long nowMs, string id)` | Keep the exit times of the last 10 minutes (drop any more than 600 000 ms older than `nowMs`). Once there are 3: clear them and return kind `TamperTrayKilled`, at `nowMs`, payload `{"exits":3}`. Otherwise `null`. |
| `public static class TamperEvents` | `DeviceEventIn Event(string id, DeviceEventKind kind, long atMs, string payloadJson)` | Builds the event (see section 4 for the payload and the time format). |
| | `string Encode(DeviceEventIn e)` | `JsonSerializer.Serialize(e, ApiJsonContext.Default.DeviceEventIn)`. |
| | `DeviceEventIn? Decode(string json)` | The reverse; `null` on `JsonException`. |

The time zone payload has text from Windows in it, so build it with a serializer, not string pasting: for example a `Dictionary<string, string>` with `from` then `to`, serialized through a small source-generated context in the same file (`[JsonSerializable(typeof(Dictionary<string, string>))] internal sealed partial class TamperJsonContext : JsonSerializerContext;`).

### 6.2 `windows/src/ScreenTime.Core/Service/ParentModeJson.cs` (new)

`public static class ParentModeJson` with `string Encode(LocalParentMode local)` and `LocalParentMode Decode(string? json)`: JSON through a source-generated context (`[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)] [JsonSerializable(typeof(LocalParentMode))] internal sealed partial class ParentModeJsonContext : JsonSerializerContext;`). `Decode` gives `new LocalParentMode()` for `null`, for invalid JSON (catch `JsonException`) and for a JSON `null`.

### 6.3 `windows/src/ScreenTime.Core/Store/LocalStore.cs` (changed)

A key-value table per account, **added without a schema version bump** (the version stays 1):

1. A constant with the SQL, next to `SchemaSql`:
   ```sql
   CREATE TABLE IF NOT EXISTS kv (
       sid    TEXT NOT NULL,
       key    TEXT NOT NULL,
       value  TEXT NOT NULL,
       PRIMARY KEY (sid, key)
   );
   ```
2. In the constructor, right before `_schemaVersion = version;`, run it (every open; on a store made before this card it creates the table, on a newer one it does nothing). Add the comment `// Added in CARD-051 without a version bump: an older store gets it on its next open.`
3. Two methods, each taking `_lock` for its whole body like the others: `public string? GetValue(string sid, string key)` (the value or null) and `public void SetValue(string sid, string key, string? value)` (null deletes the row; otherwise insert or replace: `INSERT … ON CONFLICT (sid, key) DO UPDATE SET value = excluded.value`).

### 6.4 `windows/src/ScreenTime.Core/Service/PipeMessage.cs` (changed)

One factory next to the others: `public static PipeMessage Caught() => new("caught");` with the summary "A tamper attempt was caught: the tray shows the caught toast and card (service to tray)."

### 6.5 `windows/src/ScreenTime.Service/Worker.cs` (changed)

Make exactly these changes. The code blocks are the code to write.

**a. `ServiceOptions`** gets two last parameters, on a new line: `…, string? TrayOpen = null,` then `    string? FakeClockFile = null, string? FakeTimezoneFile = null);`. Add to its summary: "`FakeClockFile` and `FakeTimezoneFile` are for test runs too."

**b. `KidSession`** gets two more properties, after `CodeOkAt`:

```csharp
        public TrayKillWatch TrayKills { get; } = new();
        public bool CaughtPending { get; set; }
```

**c. Two fields**, after `_parentAsks`:

```csharp
    private readonly ClockWatch _clockWatch = new();
    private readonly TimeZoneWatch _zoneWatch = new();
```

**d. The lock loop** checks for tamper every second: right after `var now = clock.NowMs();` in the lock loop, add `await CheckTamper(now);`.

**e. `EnsureSession`** passes `() => OnTrayExit(sessionId)` as the last argument of `new TrayHost(...)`.

**f. `OnTrayMessage`, `hello`**: after the line that sends the view, add:

```csharp
                    // A tray killed three times was dead when it was caught: it hears it now.
                    if (s.CaughtPending)
                    {
                        s.CaughtPending = false;
                        await s.Tray.SendAsync(PipeMessage.Caught());
                    }
```

**g. Parent mode in the store.** Replace `Local` with these two methods, and change the three places that assign `_parentLocal[…] = …` (in `parent-start`, in `parent-end`, and at the end of `ReportParentMode`) to call `SetLocal(sid, value)` instead:

```csharp
    /// <summary>What this PC did about parent mode for the SID; after a restart, read back from the store (CARD-051).</summary>
    private LocalParentMode Local(string sid)
    {
        if (!_parentLocal.TryGetValue(sid, out var local))
        {
            local = ParentModeJson.Decode(_store.GetValue(sid, "parent-mode"));
            _parentLocal[sid] = local;
        }
        return local;
    }

    /// <summary>Keeps what this PC did about parent mode, in memory and in the store, so a restart keeps it.</summary>
    private void SetLocal(string sid, LocalParentMode local)
    {
        _parentLocal[sid] = local;
        _store.SetValue(sid, "parent-mode", ParentModeJson.Encode(local));
    }
```

**h. Tamper.** Add, after `SetLocal`:

```csharp
    /// <summary>The wall clock, moved by <c>--fake-clock-file</c> minutes in a test run.</summary>
    private long WallMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + FakeMinutes(options.FakeClockFile) * 60_000L;

    private static long FakeMinutes(string? file) =>
        file is not null && File.Exists(file) && long.TryParse(File.ReadAllText(file).Trim(), out var minutes) ? minutes : 0;

    /// <summary>The PC's time zone id, or the one in <c>--fake-timezone-file</c> in a test run.</summary>
    private string ZoneId()
    {
        if (options.FakeTimezoneFile is { } file && File.Exists(file)) return File.ReadAllText(file).Trim();
        TimeZoneInfo.ClearCachedData();
        return TimeZoneInfo.Local.Id;
    }

    /// <summary>Every second: the wall clock against trusted time, and the time zone (docs/SPEC.md §14).</summary>
    private async Task CheckTamper(long now)
    {
        if (_clockWatch.Check(WallMs(), now, _clock.IsAnchored, Guid.NewGuid().ToString()) is { } clock) await ReportTamper(clock);
        if (_zoneWatch.Check(ZoneId(), now, Guid.NewGuid().ToString()) is { } zone) await ReportTamper(zone);
    }

    /// <summary>A machine-wide attempt (clock, time zone): queued for every enrolled account, and caught in every tray.</summary>
    private async Task ReportTamper(DeviceEventIn e)
    {
        foreach (var device in _store.Devices()) Queue(device.Sid, e with { Id = Guid.NewGuid().ToString() });
        foreach (var s in _sessions.Values.ToList()) await s.Tray.SendAsync(PipeMessage.Caught());
    }

    /// <summary>The tray of a session exited: three times in 10 minutes is an attempt, caught when the tray is back.</summary>
    private void OnTrayExit(uint sessionId) => _ = Task.Run(async () =>
    {
        await _sem.WaitAsync();
        try
        {
            if (!_sessions.TryGetValue(sessionId, out var s)) return;
            if (s.TrayKills.OnExit(_clock.NowMs(), Guid.NewGuid().ToString()) is not { } e) return;
            Queue(s.Sid, e);
            s.CaughtPending = true;
        }
        finally
        {
            _sem.Release();
        }
    });

    /// <summary>Puts a tamper event in the account's outbox (sent before the next sync, again until the server has it).</summary>
    private void Queue(string sid, DeviceEventIn e)
    {
        _store.Enqueue(sid, "event", TamperEvents.Encode(e), _clock.NowMs());
        logger.LogWarning("{Kid}: tamper {Kind}", KidName(sid), e.Kind);
        _syncRequests.Writer.TryWrite(sid);
    }

    /// <summary>Sends the account's queued tamper events (docs/SPEC.md §14): any answer from the server counts as sent.</summary>
    private async Task ReportEvents(string sid, ApiClient api, CancellationToken ct)
    {
        var items = _store.PeekOutbox(sid, 50).Where(i => i.Kind == "event").ToList();
        if (items.Count == 0) return;
        var events = items.Select(i => TamperEvents.Decode(i.Body)).OfType<DeviceEventIn>().ToList();
        if (!await Delivered(() => api.PostDeviceEventsAsync(new DeviceEventUpload(events), ct), ct)) return;
        foreach (var item in items) _store.RemoveOutbox(item.Id);
        logger.LogInformation("{Kid}: {Count} tamper events sent", KidName(sid), events.Count);
    }
```

(`Delivered` is CARD-050d's helper. A clock or time zone attempt gets a new event id per account, because the server keeps one event per id.)

**i. Send them before syncing.** In `SyncAccount`, right after `await ReportParentMode(sid, api, ct);`, add `await ReportEvents(sid, api, ct);`.

Nothing else in `Worker.cs` changes.

### 6.6 `windows/src/ScreenTime.Service/TrayHost.cs` (changed)

1. A last constructor parameter `Action? onTrayExit = null`.
2. In `TrayLoopAsync`, right after `logger.LogInformation("tray {Session}: exited, starting again", sessionId);`, add `onTrayExit?.Invoke();`.

### 6.7 `windows/src/ScreenTime.Service/Program.cs` (changed)

In the service host part:

1. After `flags.TryGetValue("tray-open", out var trayOpen);`, add:
   ```csharp
               flags.TryGetValue("fake-clock-file", out var fakeClock);
               flags.TryGetValue("fake-timezone-file", out var fakeZone);
   ```
2. The `--dry-lock` check covers them too: `if ((session is not null || trayOpen is not null || fakeClock is not null || fakeZone is not null) && !dryLock)`, and its message becomes `--session, --tray-open, --fake-clock-file and --fake-timezone-file are for testing and need --dry-lock.`
3. Pass `fakeClock, fakeZone` as the last two arguments of `new ServiceOptions(...)`.
4. The comment above them becomes:
   ```csharp
               // Dev only, for runs over Remote Desktop: --session <id> treats that session as the console, and
               // --tray-open <panel> opens the tray's flyout at once; --fake-clock-file and --fake-timezone-file read the wall
               // clock's offset (minutes) and the time zone id from a file, to try tamper detection. All need --dry-lock.
   ```

### 6.8 `windows/src/ScreenTime.Tray/TrayPipe.cs` (changed)

One case in the `switch`, before `case "parent-no":`:

```csharp
                        case "caught":
                            log("caught");
                            model.Caught();
                            break;
```

## 7. Steps

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-051-tamper`. Check that `windows/src/ScreenTime.Tray/TrayModel.cs` contains `public void Caught()`. If not, stop.
2. Copy the file in section 5. Run the fingerprint (8.1) **once**.
3. Write 6.1 to 6.4 (Core). Build and test from `windows\` until all pass.
4. Make 6.5 to 6.8 (wiring). Build with 0 errors and 0 warnings. When an error is not clear to you after one try, paste it in the handback and stop.
5. Do the run in 8.3, pasting every output.
6. Commit `CARD-051: Windows: tamper detection, and parent mode across restarts`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: one line ending in `True`.
  ```powershell
  $root = (Get-Location).Path
  $b = [IO.File]::ReadAllBytes("$root\windows\tests\ScreenTime.Core.Tests\TamperTests.cs") | Where-Object { $_ -ne 13 }
  $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
  "TamperTests.cs $h $($h -eq 'ba542f1072b915bfe278558c5893db34a35a226687ac94599320d8bb2e82259d')"
  ```
- [ ] From `windows\`: `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] From `windows\`: `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 246**. Paste the summary lines.
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Core\Service\*.cs,windows\src\ScreenTime.Core\Store\*.cs -Pattern 'DateTime\.Now|UtcNow|TickCount|DllImport'` prints nothing (only the service reads the real clock).
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Service\*.cs,windows\src\ScreenTime.Tray\*.cs -Pattern 'DllImport|Log\w*\(.*([Tt]oken|[Ss]ecret)'` prints nothing.
- [ ] From `windows\`: `& src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe --fake-clock-file x; "exit $LASTEXITCODE"` prints the `…need --dry-lock.` line and `exit 2`.

### 8.2 Repo

- [ ] `git status` clean. No `bin\`, `obj\`, `state.db`, `config.json`, `clock.json` or `*.log` in the repo.
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 9 files:
  ```
  windows/src/ScreenTime.Core/Service/ParentModeJson.cs
  windows/src/ScreenTime.Core/Service/PipeMessage.cs
  windows/src/ScreenTime.Core/Service/Tamper.cs
  windows/src/ScreenTime.Core/Store/LocalStore.cs
  windows/src/ScreenTime.Service/Program.cs
  windows/src/ScreenTime.Service/TrayHost.cs
  windows/src/ScreenTime.Service/Worker.cs
  windows/src/ScreenTime.Tray/TrayPipe.cs
  windows/tests/ScreenTime.Core.Tests/TamperTests.cs
  ```

### 8.3 The run on James's PC (console or Remote Desktop, dry-lock, no admin, no service install)

Paste the **real output of every line**. A step without output counts as NOT RUN. Docker Desktop must be running. It works at any time of day. Toasts pop up during the run: that is expected. Do not click the flyout yourself.

**If your run tool starts a fresh PowerShell for each step**, put step 1's lines in `C:\Users\james\OpenCode\Testing\temp\c51\helpers.ps1` (exactly as written) and dot-source it (`. C:\Users\james\OpenCode\Testing\temp\c51\helpers.ps1`) at the start of each step, and start the service with `Start-Process` as written (it keeps running between steps). Keep `$p` (the service's process) in a file if you need it later: `$p.Id | Set-Content "$tmp\c51-pid.txt"`. List this as a deviation; it is an allowed one.

1. The local server, the dev family, the paths, the fake clock and time zone files, and the helpers:
   ```powershell
   query user
   Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
   $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
   $env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
   pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
   $tmp = "C:\Users\james\OpenCode\Testing\temp"
   $t = "$tmp\c51"
   $log = "$tmp\c51-service.log"
   $clockFile = "$tmp\c51-clock.txt"
   $zoneFile = "$tmp\c51-zone.txt"
   $trayLog = "$env:LOCALAPPDATA\ScreenTime\tray.log"
   $svcExe = (Resolve-Path "windows\src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe").Path
   $trayExe = (Resolve-Path "windows\src\ScreenTime.Tray\bin\Release\net10.0-windows10.0.26100.0\win-x64\ScreenTime.Tray.exe").Path
   $session = (Get-Process -Id $PID).SessionId
   Remove-Item $trayLog -ErrorAction SilentlyContinue
   Set-Content $clockFile "0"
   Set-Content $zoneFile "AUS Eastern Standard Time"
   function Parent([string]$what) { pnpm --silent --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Sam $what }
   function Svc { Start-Process $svcExe -ArgumentList @("--data", $t, "--dry-lock", "--session", $session, "--tray", $trayExe, "--tray-open", "main", "--fake-clock-file", $clockFile, "--fake-timezone-file", $zoneFile) -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru }
   function Compose([string[]]$what) { docker compose -f deploy/docker-compose.yml --env-file deploy/.env @what 2>&1 | Select-Object -Last 1 }
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
2. Enrol your own account as Sam:
   ```powershell
   $code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
   & $svcExe enrol --server http://localhost:8080 --code $code --user $env:USERNAME --data $t
   ```
3. Start the service (with the fake clock and time zone files):
   ```powershell
   $p = Svc; Start-Sleep 15
   Select-String $log -Pattern "live Sam|tray .*: (started|hello)|tamper" | ForEach-Object Line
   ```
   Expect no `tamper` line yet.
4. The clock jumps 5 minutes ahead, then back:
   ```powershell
   Set-Content $clockFile "5"; Start-Sleep 6
   Set-Content $clockFile "0"; Start-Sleep 3
   Select-String $log -Pattern "tamper" | ForEach-Object Line
   Get-Content $trayLog | Select-String "caught|toast: (Nice|Busted|Whoa)"
   ```
   Expect `Sam: tamper TamperClock`, `Sam: 1 tamper events sent`, and in the tray log `caught` and a caught toast.
5. The time zone changes:
   ```powershell
   Set-Content $zoneFile "UTC"; Start-Sleep 6
   Select-String $log -Pattern "tamper" | ForEach-Object Line
   ```
   Expect `Sam: tamper TamperTimezone` and another `1 tamper events sent`.
6. The tray is killed three times:
   ```powershell
   foreach ($i in 1..3) { Stop-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue; Start-Sleep 4 }
   Start-Sleep 4
   Select-String $log -Pattern "tamper|tray .*: exited" | ForEach-Object Line
   Get-Content $trayLog | Select-String "caught" | Select-Object -Last 1
   ```
   Expect three `tray N: exited, starting again`, then `Sam: tamper TamperTrayKilled` and `1 tamper events sent`, and a `caught` from the restarted tray.
7. The server has all three:
   ```powershell
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U screentime -d screentime -t -c "select kind, payload from events where kind like 'tamper.%' order by at"
   ```
   Expect `tamper.clock` with `{"offsetMin": 5}`, `tamper.timezone` with the two zones, and `tamper.tray_killed` with `{"exits": 3}`.
8. Parent mode by code while the server is down, kept across a service restart:
   ```powershell
   Compose @("stop", "api")
   Press "I'm the parent"; Start-Sleep 3
   Press "Enter parent code instead"; Start-Sleep 1
   $parentCode = (Parent code | Select-String '\d{6}').Matches[0].Value
   TypeCode $parentCode; Press "Check"; Start-Sleep 2
   Press "15 min"; Start-Sleep 4
   Select-String $log -Pattern "parent code|parent mode on|parent mode reported" | ForEach-Object Line
   "restarting the service"
   Stop-Process -Id $p.Id; Start-Sleep 2
   $p = Svc; Start-Sleep 10
   Get-Content $trayLog | Select-String "view:" | Select-Object -Last 1
   Compose @("start", "api"); Start-Sleep 75
   Select-String $log -Pattern "parent mode reported|live Sam: connected" | ForEach-Object Line
   ```
   Expect `parent code right` and `parent mode on by code, 15 min` but **no** `parent mode reported` before the restart (the server is down); after the restart the tray's last view is still `Parent mode · ends …`; once the server is back, `live Sam: connected` and `parent mode reported`. (The service log starts again with the second service, so its first lines are from after the restart.)
9. Clean up:
   ```powershell
   Stop-Process -Id $p.Id; Start-Sleep 2; Stop-Process -Name ScreenTime.Tray -ErrorAction SilentlyContinue
   Get-Content "$log.err"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   Remove-Item -Recurse $t, $log, "$log.err", $trayLog, $clockFile, $zoneFile
   ```
   Paste `$log.err` (it should be empty).

What Claude saw on the same run, over Remote Desktop (times and pids differ; the `live Sam: down` lines in step 3 were the server restarting once just after `up`, and are fine):

```
=== step 3
      tray 1: started pid 48752
      live Sam: connected
      tray 1: hello pid 48752
=== step 4
      Sam: tamper TamperClock
      Sam: 1 tamper events sent
21:52:22 caught
21:52:22 toast: Nice try, Agent Sam! 🕵️ Mum and Dad have been told.
=== step 5
      Sam: tamper TamperClock
      Sam: 1 tamper events sent
      Sam: tamper TamperTimezone
      Sam: 1 tamper events sent
=== step 6
      tray 1: exited, starting again
      tray 1: exited, starting again
      tray 1: exited, starting again
      Sam: tamper TamperTrayKilled
      Sam: 1 tamper events sent
21:52:45 caught
=== step 7
 tamper.clock       | {"offsetMin": 5}
 tamper.timezone    | {"to": "UTC", "from": "AUS Eastern Standard Time"}
 tamper.tray_killed | {"exits": 3}
=== step 8
 Container screentime-api-1 Stopped
pressed I'm the parent
pressed Enter parent code instead
typed the code
pressed Check
pressed 15 min
      Sam: parent code right
      Sam: parent mode on by code, 15 min
restarting the service
21:53:10 view: Parent mode · ends 10:08 pm
 Container screentime-api-1 Started
      live Sam: connected
      Sam: parent mode reported
```

## 9. Tests

| File | Tests | What it checks |
|---|---|---|
| `TamperTests` | 9 | The clock: unanchored, under 2 minutes, 5 ahead (the exact event line), not again until back, 3 behind; the time zone: first, same, changed (the exact line), same again; three tray exits in 10 minutes (the exact line), then reset; exits spread over more than 10 minutes; an event read back from the outbox; the store's values per account, kept across reopening and deleted with null; a version 1 store from before this card upgraded in place; parent mode as JSON, and null or invalid giving nothing; the `caught` line. |

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-051-tamper
   ```
2. Commit with the message `CARD-051: Windows: tamper detection, and parent mode across restarts`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-051-tamper`
5. Write the PR body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` and open the PR with `gh pr create --base main --title "CARD-051: Windows: tamper detection, and parent mode across restarts" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body:
   ```markdown
   ## Card
   docs/cards/CARD-051-tamper.md

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

- **The copied test does not compile**, and the error is in the test file: paste the full error and stop. The card may be wrong.
- **`TheSchemaVersionIsOne` fails**: you bumped the schema version. The `kv` table is added without one (6.3).
- **An exact event line test fails**: check the payload and the time format (section 4, 6.1). Read the failing line once; if it is still unclear, paste the output and stop.
- **Step 4, 5 or 6 shows no `tamper` line**: paste the whole service log and stop. Never change the PC's real clock or time zone to make it pass.
- **Step 7 shows fewer than three rows**: wait 60 s (the next sync), run it again once, and list that as a deviation. If still fewer, paste both logs and stop.
- **`Press` or `TypeCode` says `not found` / `no code box`**: you changed a helper. Copy step 1 again and redo the **whole** run from step 1; list it as a deviation.
- **Step 8's parent code is `wrong`**: the code changes every 30 s. Run step 8's lines again once from `Press "Enter parent code instead"`, and list it as a deviation.
- **An AOT or trim warning (`IL…`)**: paste it and stop. No `NoWarn`, no `#pragma`.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Save it as `C:\Users\james\OpenCode\Testing\temp\handback-card-051.txt` too. Claude checks every line of it against the PR, the CI logs and its own review, so write only what you actually saw. Paste the **whole** report.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- Paste the real output of **every** run step. A step without its pasted output counts as `NOT RUN`, and Claude sends the PR back.
- Every workaround (restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-051. Please review and merge if it is good.

CARD: CARD-051 Windows: tamper detection, and parent mode across restarts
PR: <full PR URL>
Branch: bob/card-051-tamper
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
