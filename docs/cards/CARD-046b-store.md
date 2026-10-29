# CARD-046b: Windows: SQLite store

| Field | Value |
|---|---|
| Card | CARD-046b |
| Title | Windows: SQLite store |
| Size | S |
| Depends on | CARD-046 merged to `main` |
| Spec sections | docs/SPEC.md §12.2 (state in SQLite at `C:\ProgramData\ScreenTime\state.db`), §8.4 (offline first) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-046b-store` |
| PR title | `CARD-046b: Windows: SQLite store` |

## 1. Project context

Read `AGENTS.md` first. Rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command** and lists every workaround.

The Windows service (CARD-047 onward) must keep working offline (SPEC §8.4). It keeps everything it needs in one SQLite file. One PC can have several kid **accounts**, and each one is enrolled as its own device (SPEC §12.2, Q10). So every row is keyed by the account's Windows SID.

This card writes `LocalStore`, a small class in `ScreenTime.Core`. It stores:
- the enrolled device for each account;
- the last `DeviceState` from the server and its ETag;
- the usage segments waiting to be uploaded;
- a plain outbox of other requests waiting to be sent.

The segment rules copy the Android kid app exactly. Read `android/app-kid/src/main/kotlin/au/screentime/kid/data/KidDatabase.kt` first: `version` and `sentVersion` work the same way here.

You **copy** the test file in section 5 exactly, and **write** the code from section 6. The test is the contract; never change it.

## 2. Goal

`dotnet build` and `dotnet test` pass in `windows/`, including the 10 new `LocalStoreTests`. CI **Windows / build and test** is green.

## 3. Out of scope

- No service code, timers or uploads (CARD-047). Nothing in `ScreenTime.Service` or `ScreenTime.Tray`.
- No encryption here. `Token` is stored as the bytes it is given. The service will protect it with DPAPI before calling `PutDevice` (CARD-047).
- No migrations beyond creating schema version 1.
- No other NuGet package than the one in 6.1. No Dapper, no EF Core.

## 4. Tech

- .NET 10, nullable on, warnings are errors, `ScreenTime.Core` is `IsAotCompatible`.
- `Microsoft.Data.Sqlite` 10.0.13 (it brings its own SQLite build). Plain `SqliteConnection` / `SqliteCommand` with `$name` parameters. Never build SQL by joining in values.
- Synchronous API: the service calls it from its own background threads.

## 5. File to copy

Copy this exactly. Check it with the fingerprint command in 8.1, **once**.

### 5.1 `windows/tests/ScreenTime.Core.Tests/LocalStoreTests.cs`

```csharp
using Microsoft.Data.Sqlite;
using ScreenTime.Core.Api;
using ScreenTime.Core.Store;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-046b: the service's SQLite store. Copied verbatim from the card.</summary>
public sealed class LocalStoreTests : IDisposable
{
    private const string Alex = "S-1-5-21-1-1001";
    private const string Sam = "S-1-5-21-1-1002";

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "st-store-" + Guid.NewGuid().ToString("N"));
    private string DbPath => Path.Combine(_folder, "sub", "state.db");

    public void Dispose()
    {
        if (Directory.Exists(_folder)) Directory.Delete(_folder, recursive: true);
    }

    private static StoredDevice Device(string sid, string id) =>
        new(sid, id, [1, 2, 3, 250], "Alex", "Australia/Sydney");

    private static LocalSegment Segment(string id, string sid, long start, long? end = null) =>
        new(id, sid, start, end, LastSeenAtMs: end ?? start, RecordedOffline: false);

    [Fact]
    public void OpenMakesTheFolderAndTheFileAndCanOpenItAgain()
    {
        using (var store = LocalStore.Open(DbPath))
        {
            store.PutDevice(Device(Alex, "d-1"));
        }
        Assert.True(File.Exists(DbPath));
        using var again = LocalStore.Open(DbPath);
        Assert.Equal("d-1", again.GetDevice(Alex)!.DeviceId);
    }

    [Fact]
    public void DevicesAreKeptPerAccountAndReplaced()
    {
        using var store = LocalStore.Open(DbPath);
        Assert.Empty(store.Devices());
        Assert.Null(store.GetDevice(Alex));

        store.PutDevice(Device(Alex, "d-1"));
        store.PutDevice(Device(Sam, "d-2"));
        store.PutDevice(Device(Alex, "d-3") with { KidName = "Alexandra" });

        var alex = store.GetDevice(Alex)!;
        Assert.Equal("d-3", alex.DeviceId);
        Assert.Equal("Alexandra", alex.KidName);
        Assert.Equal(new byte[] { 1, 2, 3, 250 }, alex.Token);
        Assert.Equal("Australia/Sydney", alex.Timezone);
        Assert.Equal(new[] { Alex, Sam }, store.Devices().Select(d => d.Sid).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void StateRoundTripsAndABrokenRowReadsAsNone()
    {
        using var store = LocalStore.Open(DbPath);
        Assert.Null(store.LoadState(Alex));

        var state = new DeviceState(
            ServerTime: "2026-10-29T08:00:00.000Z",
            StateVersion: "v8",
            Device: new DeviceStateDevice("d-1", "Alex's PC", DeviceForm.Pc, Api.Pool.Screens, HasCellular: false),
            Kid: new DeviceStateKid("k-1", "Alex"),
            Family: new DeviceStateFamily("Australia/Sydney", "000", "not-a-real-secret"),
            Parents: [new DeviceStateParentsItem("p-1", "Dad", PhoneE164: null)],
            Contacts: [],
            MessagePresets: [],
            Schedule: new Schedule(3, 15, 5, [new ScheduleDay(4, 120, 60, "07:00", "21:00")]),
            Today: new DeviceStateToday("2026-10-29", [], []),
            ParentMode: new DeviceStateParentMode(false, null, null),
            PendingRequest: null,
            ActiveSos: null);
        store.SaveState(Alex, new CachedState("\"v8\"", state));

        var loaded = store.LoadState(Alex)!;
        Assert.Equal("\"v8\"", loaded.ETag);
        Assert.Equal("v8", loaded.State.StateVersion);
        Assert.Equal(120, loaded.State.Schedule.Days[0].ScreensMin);
        Assert.Null(store.LoadState(Sam));

        store.SaveState(Alex, new CachedState(null, state with { StateVersion = "v9" }));
        Assert.Null(store.LoadState(Alex)!.ETag);
        Assert.Equal("v9", store.LoadState(Alex)!.State.StateVersion);

        // A row that is no longer valid JSON (a crash mid-write, a schema change) is treated as no state.
        using (var raw = new SqliteConnection($"Data Source={DbPath};Pooling=False"))
        {
            raw.Open();
            using var command = raw.CreateCommand();
            command.CommandText = "UPDATE state SET json = '{not json' WHERE sid = $sid";
            command.Parameters.AddWithValue("$sid", Alex);
            Assert.Equal(1, command.ExecuteNonQuery());
        }
        Assert.Null(store.LoadState(Alex));
    }

    [Fact]
    public void ASegmentIsPendingUntilItsVersionIsSent()
    {
        using var store = LocalStore.Open(DbPath);
        store.PutSegment(Segment("s-1", Alex, start: 1_000));

        var pending = Assert.Single(store.PendingSegments(Alex, limit: 10));
        Assert.Equal(1, pending.Version);
        Assert.Null(pending.Segment.EndedAtMs);
        Assert.Equal("s-1", store.OpenSegment(Alex)!.Id);

        // Ended while the first upload was on the way: version 2 must still go up.
        store.PutSegment(Segment("s-1", Alex, start: 1_000, end: 61_000));
        store.MarkSent("s-1", version: 1);
        pending = Assert.Single(store.PendingSegments(Alex, limit: 10));
        Assert.Equal(2, pending.Version);
        Assert.Equal(61_000, pending.Segment.EndedAtMs);
        Assert.Null(store.OpenSegment(Alex));

        store.MarkSent("s-1", version: 2);
        Assert.Empty(store.PendingSegments(Alex, limit: 10));
        // An old answer arriving late does not move sentVersion back.
        store.MarkSent("s-1", version: 1);
        Assert.Empty(store.PendingSegments(Alex, limit: 10));
    }

    [Fact]
    public void TouchMovesLastSeenWithoutAnUpload()
    {
        using var store = LocalStore.Open(DbPath);
        store.PutSegment(Segment("s-1", Alex, start: 1_000));
        store.MarkSent("s-1", version: 1);

        store.Touch("s-1", atMs: 31_000);

        Assert.Equal(31_000, store.OpenSegment(Alex)!.LastSeenAtMs);
        Assert.Empty(store.PendingSegments(Alex, limit: 10));
    }

    [Fact]
    public void SegmentsAreKeptApartPerAccountAndComeOldestFirst()
    {
        using var store = LocalStore.Open(DbPath);
        store.PutSegment(Segment("a-2", Alex, start: 5_000, end: 6_000));
        store.PutSegment(Segment("a-1", Alex, start: 1_000, end: 2_000));
        store.PutSegment(Segment("a-3", Alex, start: 9_000));
        store.PutSegment(Segment("b-1", Sam, start: 3_000));

        Assert.Equal(new[] { "a-1", "a-2", "a-3" }, store.PendingSegments(Alex, limit: 10).Select(p => p.Segment.Id));
        Assert.Equal(new[] { "a-1", "a-2" }, store.PendingSegments(Alex, limit: 2).Select(p => p.Segment.Id));
        Assert.Equal("b-1", Assert.Single(store.PendingSegments(Sam, limit: 10)).Segment.Id);
        // Still open, or ended at or after 5 000.
        Assert.Equal(new[] { "a-2", "a-3" }, store.SegmentsSince(Alex, fromMs: 5_000).Select(s => s.Id));
        Assert.Equal("a-3", store.OpenSegment(Alex)!.Id);
        Assert.Equal("b-1", store.OpenSegment(Sam)!.Id);
    }

    [Fact]
    public void PruneForgetsOnlyOldSentSegments()
    {
        using var store = LocalStore.Open(DbPath);
        store.PutSegment(Segment("old-sent", Alex, start: 1_000, end: 2_000));
        store.PutSegment(Segment("old-unsent", Alex, start: 3_000, end: 4_000));
        store.PutSegment(Segment("new-sent", Alex, start: 8_000, end: 9_000));
        store.MarkSent("old-sent", version: 1);
        store.MarkSent("new-sent", version: 1);

        store.Prune(beforeMs: 5_000);

        Assert.Equal(new[] { "old-unsent", "new-sent" }, store.SegmentsSince(Alex, fromMs: 0).Select(s => s.Id));
    }

    [Fact]
    public void TheOutboxKeepsOrderUntilRemoved()
    {
        using var store = LocalStore.Open(DbPath);
        Assert.Empty(store.PeekOutbox(Alex, limit: 10));

        var first = store.Enqueue(Alex, "event", """{"id":"e-1"}""", createdAtMs: 1_000);
        var second = store.Enqueue(Alex, "time_request", """{"id":"r-1"}""", createdAtMs: 2_000);
        store.Enqueue(Sam, "event", """{"id":"e-2"}""", createdAtMs: 1_500);
        Assert.True(second > first);

        var items = store.PeekOutbox(Alex, limit: 10);
        Assert.Equal(new[] { "event", "time_request" }, items.Select(i => i.Kind));
        Assert.Equal("""{"id":"e-1"}""", items[0].Body);
        Assert.Equal(1_000, items[0].CreatedAtMs);
        Assert.Equal(Alex, items[0].Sid);
        Assert.Equal(first, Assert.Single(store.PeekOutbox(Alex, limit: 1)).Id);

        store.RemoveOutbox(first);
        Assert.Equal(second, Assert.Single(store.PeekOutbox(Alex, limit: 10)).Id);
        Assert.Single(store.PeekOutbox(Sam, limit: 10));
    }

    [Fact]
    public void RemovingADeviceForgetsEverythingForThatAccountOnly()
    {
        using var store = LocalStore.Open(DbPath);
        foreach (var sid in new[] { Alex, Sam })
        {
            store.PutDevice(Device(sid, "d-" + sid));
            store.PutSegment(Segment("s-" + sid, sid, start: 1_000));
            store.Enqueue(sid, "event", "{}", createdAtMs: 1_000);
        }

        store.RemoveDevice(Alex);

        Assert.Null(store.GetDevice(Alex));
        Assert.Null(store.OpenSegment(Alex));
        Assert.Empty(store.PendingSegments(Alex, limit: 10));
        Assert.Empty(store.PeekOutbox(Alex, limit: 10));
        Assert.NotNull(store.GetDevice(Sam));
        Assert.NotNull(store.OpenSegment(Sam));
        Assert.Single(store.PeekOutbox(Sam, limit: 10));
    }

    [Fact]
    public void TheSchemaVersionIsOne()
    {
        using var store = LocalStore.Open(DbPath);
        Assert.Equal(1, store.SchemaVersion);
    }
}
```

## 6. What to write

### 6.1 `windows/src/ScreenTime.Core/ScreenTime.Core.csproj`

Add one item group, and change nothing else:

```xml
    <ItemGroup>
        <PackageReference Include="Microsoft.Data.Sqlite" Version="10.0.13" />
    </ItemGroup>
```

### 6.2 `windows/src/ScreenTime.Core/Store/LocalStore.cs` (namespace `ScreenTime.Core.Store`)

One file. Use exactly these names and shapes; the test uses them. Give each public type and member a one-line `///` summary.

```csharp
public sealed record StoredDevice(string Sid, string DeviceId, byte[] Token, string KidName, string Timezone);
public sealed record LocalSegment(string Id, string Sid, long StartedAtMs, long? EndedAtMs, long LastSeenAtMs, bool RecordedOffline);
public sealed record PendingSegment(LocalSegment Segment, int Version);
public sealed record CachedState(string? ETag, DeviceState State);   // DeviceState from ScreenTime.Core.Api
public sealed record OutboxItem(long Id, string Sid, string Kind, string Body, long CreatedAtMs);

public sealed class LocalStore : IDisposable
{
    public static LocalStore Open(string path);
    public int SchemaVersion { get; }

    public void PutDevice(StoredDevice device);
    public StoredDevice? GetDevice(string sid);
    public IReadOnlyList<StoredDevice> Devices();
    public void RemoveDevice(string sid);

    public void SaveState(string sid, CachedState state);
    public CachedState? LoadState(string sid);

    public LocalSegment? OpenSegment(string sid);
    public void PutSegment(LocalSegment segment);
    public void Touch(string id, long atMs);
    public IReadOnlyList<LocalSegment> SegmentsSince(string sid, long fromMs);
    public IReadOnlyList<PendingSegment> PendingSegments(string sid, int limit);
    public void MarkSent(string id, int version);
    public void Prune(long beforeMs);

    public long Enqueue(string sid, string kind, string body, long createdAtMs);
    public IReadOnlyList<OutboxItem> PeekOutbox(string sid, int limit);
    public void RemoveOutbox(long id);

    public void Dispose();
}
```

### 6.3 Opening

- `Open(path)`:
  1. creates the folder of `path` if it is missing (`Directory.CreateDirectory`);
  2. opens **one** `SqliteConnection` with `new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }`, which it keeps until `Dispose`;
  3. runs `PRAGMA journal_mode = WAL;` and `PRAGMA foreign_keys = OFF;`;
  4. reads `PRAGMA user_version`. When it is `0`, it runs the schema below and `PRAGMA user_version = 1;` in **one transaction**. When it is `1`, it does nothing. Any other value throws `InvalidOperationException("state.db has schema version N; this app knows 1.")`.
- `SchemaVersion` is the `user_version` read at open (after creating it, so `1`).
- `Dispose` disposes the connection. With `Pooling = false` that releases the file, which the test needs to delete the folder.
- **Thread safety**: every public method takes a `lock` on one private object for its whole body.

### 6.4 Schema version 1 (exact)

```sql
CREATE TABLE devices (
    sid        TEXT PRIMARY KEY,
    device_id  TEXT NOT NULL,
    token      BLOB NOT NULL,
    kid_name   TEXT NOT NULL,
    timezone   TEXT NOT NULL
);
CREATE TABLE state (
    sid   TEXT PRIMARY KEY,
    etag  TEXT,
    json  TEXT NOT NULL
);
CREATE TABLE segments (
    id               TEXT PRIMARY KEY,
    sid              TEXT NOT NULL,
    started_at_ms    INTEGER NOT NULL,
    ended_at_ms      INTEGER,
    last_seen_at_ms  INTEGER NOT NULL,
    recorded_offline INTEGER NOT NULL,
    version          INTEGER NOT NULL,
    sent_version     INTEGER NOT NULL
);
CREATE INDEX segments_sid_started ON segments (sid, started_at_ms);
CREATE TABLE outbox (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sid            TEXT NOT NULL,
    kind           TEXT NOT NULL,
    body           TEXT NOT NULL,
    created_at_ms  INTEGER NOT NULL
);
CREATE INDEX outbox_sid_id ON outbox (sid, id);
```

### 6.5 The rules

**Devices**
- `PutDevice` is `INSERT ... ON CONFLICT(sid) DO UPDATE SET` every other column. A second put replaces the first.
- `Devices()` comes in `sid` order.
- `RemoveDevice(sid)` deletes the account's rows from **all four** tables in one transaction.

**State**
- `SaveState` upserts the row. `json` is `JsonSerializer.Serialize(state.State, ApiJsonContext.Default.DeviceState)`, and `etag` is `state.ETag` (`NULL` when null).
- `LoadState` returns null when there is no row. It also returns null when `JsonSerializer.Deserialize(json, ApiJsonContext.Default.DeviceState)` throws `JsonException` or gives null. Catch `JsonException` only.

**Segments** (the same as `KidDatabase.kt`)
- `PutSegment` reads the old row by `id`, all in one transaction. It writes every column from the segment, with `version = old.version + 1` (or `1` when new) and `sent_version = old.sent_version` (or `0`).
- `Touch(id, atMs)` sets only `last_seen_at_ms`. It never changes `version`.
- `OpenSegment(sid)` is the newest one (`started_at_ms DESC`) of that account with `ended_at_ms IS NULL`, or null.
- `SegmentsSince(sid, fromMs)` gives that account's segments with `ended_at_ms IS NULL OR ended_at_ms >= fromMs`, in `started_at_ms` order.
- `PendingSegments(sid, limit)` gives that account's segments with `version > sent_version`, in `started_at_ms` order, at most `limit`. Each one comes with its `version`.
- `MarkSent(id, version)` runs `UPDATE segments SET sent_version = $version WHERE id = $id AND sent_version < $version`. An older answer never moves it back.
- `Prune(beforeMs)` deletes segments, for **all** accounts, with `ended_at_ms < beforeMs AND version = sent_version`.

**Outbox**
- `Enqueue` inserts a row and returns its new `id` (`SELECT last_insert_rowid()` in the same lock).
- `PeekOutbox(sid, limit)` gives that account's rows in `id` order, at most `limit`, and does not remove them.
- `RemoveOutbox(id)` deletes that one row.
- `kind` and `body` are opaque to the store. CARD-047 decides their values.

**Reading values**: use `GetString` and `GetInt64`, `IsDBNull` for the nullable columns, `GetInt64(..) != 0` for `recorded_offline` (written as `1` or `0`), and `(byte[])reader.GetValue(..)` for `token`.

### 6.6 Files

1. `windows/tests/ScreenTime.Core.Tests/LocalStoreTests.cs`: copy from 5.1.
2. `windows/src/ScreenTime.Core/ScreenTime.Core.csproj`: the one item group from 6.1.
3. `windows/src/ScreenTime.Core/Store/LocalStore.cs`: write it from 6.2 to 6.5.

## 7. Steps

1. `git checkout main`, `git pull`, `git checkout -b bob/card-046b-store`. Check that `docs/cards/CARD-046b-store.md` exists.
2. Copy 5.1. Run the fingerprint (8.1) **once**.
3. Add the package (6.1) and write `LocalStore.cs`.
4. From `windows`: `dotnet build ScreenTime.slnx -c Release`, then `dotnet test --solution ScreenTime.slnx -c Release --no-build`, until both pass. Fix your code, never the test.
5. Commit `CARD-046b: Windows: SQLite store`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output. It prints the hash and `True`. If it prints `False`, copy 5.1 again once and re-run. Still `False`: paste it and carry on.
  ```powershell
  $p = "windows\tests\ScreenTime.Core.Tests\LocalStoreTests.cs"
  $b = [IO.File]::ReadAllBytes($p) | Where-Object { $_ -ne 13 }
  $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
  $h
  $h -eq "b8865f16077848fd5d2286a5a1c8c8fdeb02707070dea020e96f86c5ed4c6555"
  ```
- [ ] `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors.
- [ ] `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 61** (51 before + 10). Paste the summary lines.
- [ ] `Select-String -Path windows\src\ScreenTime.Core\Store\LocalStore.cs -Pattern '\$"|String\.Format|\+ "'` prints nothing (no SQL built from values). If one of its hits is a harmless string such as the exception text in 6.3, paste the hit and say why it is harmless.

### 8.2 Repo

- [ ] `git status` clean (no `bin\`, `obj\`, `TestResults\`, and no `state.db`).
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 3 files:
  ```
  windows/src/ScreenTime.Core/ScreenTime.Core.csproj
  windows/src/ScreenTime.Core/Store/LocalStore.cs
  windows/tests/ScreenTime.Core.Tests/LocalStoreTests.cs
  ```

## 9. Tests

`LocalStoreTests` (10 tests, each on its own temp file) checks:
- open and reopen;
- devices per account, and that a second put replaces the first;
- the state round trip, and that a broken JSON row reads as none;
- segment versions while an upload is on the way, and that a late answer is ignored;
- `Touch` without an upload;
- accounts kept apart, oldest first, `limit`, `SegmentsSince`;
- `Prune`;
- outbox order and removal;
- `RemoveDevice` clearing only that account;
- schema version 1.

## 10. Git and pull request

Push `bob/card-046b-store` and open the PR with `gh pr create --base main --title "CARD-046b: Windows: SQLite store" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body says what the card asked for, lists the 3 files, and gives the test summary lines. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". Never change the test.

- **The copied test does not compile, or an analyzer rule (an `xUnit` or `CA` code) fails it**, and the error is in the test file itself: paste the full error and stop. The card may be wrong, and Claude fixes it.
- **The package does not restore**: paste the `dotnet restore` output and stop.
- **An IL or AOT warning (`IL2026`, `IL3050`, …) fails the build**: paste it and stop. Do not add `NoWarn` or `#pragma`.
- **`Directory.Delete` fails in a test with "being used by another process"**: the connection is still open. Check `Pooling = false` and `Dispose`.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- For an emulator or device run, paste the real output of **every** step (every `Screen-Text`, helper and script line). "The screenshots are the evidence" or "from earlier in the session" is not accepted: a step without its pasted output counts as `NOT RUN`, and Claude sends the PR back.
- Every workaround (force-stop, app restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-046b. Please review and merge if it is good.

CARD: CARD-046b Windows: SQLite store
PR: <full PR URL>
Branch: bob/card-046b-store
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
