# CARD-047: Windows: recorder, trusted clock and sync

| Field | Value |
|---|---|
| Card | CARD-047 |
| Title | Windows: recorder, trusted clock and sync |
| Size | M |
| Depends on | CARD-045, CARD-046, CARD-046b merged to `main` |
| Spec sections | docs/SPEC.md §8.2 to §8.5 (sync, offline, trusted time), §12.2 (Windows), Q19 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-047-cs-sync` |
| PR title | `CARD-047: Windows: recorder, trusted clock and sync` |

## 1. Project context

Read `AGENTS.md` first. Rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command** and lists every workaround.

The Android kid app already has the logic the Windows service needs. This card **ports four Kotlin files to C#** in `ScreenTime.Core`, so the service (CARD-047b) only has to wire Windows events to them:

| Kotlin (read it first) | C# (write it) |
|---|---|
| `android/app-kid/src/main/kotlin/au/screentime/kid/sync/TrustedClock.kt` | `windows/src/ScreenTime.Core/Sync/TrustedClock.cs` |
| `android/app-kid/src/main/kotlin/au/screentime/kid/usage/Recorder.kt` (class `Recorder`) | `windows/src/ScreenTime.Core/Sync/Recorder.cs` |
| `android/app-kid/src/main/kotlin/au/screentime/kid/usage/TodayInput.kt` | `windows/src/ScreenTime.Core/Sync/TodayInput.cs` |
| `android/app-kid/src/main/kotlin/au/screentime/kid/sync/Syncer.kt` | `windows/src/ScreenTime.Core/Sync/Syncer.cs` |

Port them **step by step**. Same logic, same order, same comments where they still fit. The only differences are the ones listed in section 6: C# names, the `LocalStore` from CARD-046b instead of Room, the C# `ApiClient` from CARD-046 instead of Ktor, and one Windows account (SID) per `Recorder` and `Syncer`.

You **copy** the five test files in section 5 exactly, and **write** the four files above. The tests are the contract; never change them.

## 2. Goal

`dotnet build` and `dotnet test` pass in `windows/`, including the 24 new tests. CI **Windows / build and test** is green.

## 3. Out of scope

- No Windows service code: no session events, no WebSocket, no enrolment command, no DPAPI, no timers (CARD-047b).
- No change to `LocalStore`, the generated API files, any csproj, or any Kotlin file.
- No NuGet package.

## 4. Tech

.NET 10, nullable on, warnings are errors, `ScreenTime.Core` is `IsAotCompatible`. Everything is synchronous except `Syncer.SyncAsync`. All times inside are epoch milliseconds (`long`), as in Kotlin.

## 5. Files to copy

Copy all five exactly into `windows/tests/ScreenTime.Core.Tests/`. Check them with the fingerprint command in 8.1, **once**.

### 5.1 `windows/tests/ScreenTime.Core.Tests/SyncTestData.cs`

```csharp
using System.Text.Json;
using ScreenTime.Core.Api;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047: shared test data for the sync tests. Copied verbatim from the card.</summary>
internal static class SyncTestData
{
    public const string Alex = "S-1-5-21-1-1001";

    /// <summary>A whole DeviceState as the server sends it. Every weekday has 120 min of Screens and 60 of Phone.</summary>
    public static string StateJson(
        string pool = "screens",
        string date = "2026-10-26",
        string grants = "",
        string segments = "",
        string serverTime = "2026-10-25T23:00:00.000Z")
    {
        var days = string.Join(",", Enumerable.Range(1, 7).Select(d =>
            $$"""{"weekday":{{d}},"screensMin":120,"phoneMin":60,"wake":"07:00","bedtime":"20:30"}"""));
        return $$"""
            {"serverTime":"{{serverTime}}","stateVersion":"v1",
             "device":{"id":"d1","name":"Alex's PC","form":"pc","pool":"{{pool}}","hasCellular":false},
             "kid":{"id":"k1","name":"Alex"},
             "family":{"timezone":"Australia/Sydney","emergencyNumber":"000","parentCodeSecret":"not-a-real-secret"},
             "parents":[],"contacts":[],"messagePresets":[],
             "schedule":{"version":1,"warn1Min":15,"warn2Min":5,"days":[{{days}}]},
             "today":{"date":"{{date}}","grants":[{{grants}}],"poolSegments":[{{segments}}]},
             "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"activeSos":null}
            """;
    }

    public static DeviceState State(string pool = "screens", string date = "2026-10-26", string grants = "", string segments = "") =>
        JsonSerializer.Deserialize(StateJson(pool, date, grants, segments), ApiJsonContext.Default.DeviceState)!;

    public static long Ms(string text) => DateTimeOffset.Parse(text, System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();

    /// <summary>A store on a new temp file; delete the folder with <see cref="Delete"/>.</summary>
    public static string NewDbPath() => Path.Combine(Path.GetTempPath(), "st-sync-" + Guid.NewGuid().ToString("N"), "state.db");

    public static void Delete(string dbPath)
    {
        var folder = Path.GetDirectoryName(dbPath)!;
        if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
    }

    /// <summary>A clock store in memory.</summary>
    public sealed class MemoryClockStore : ScreenTime.Core.Sync.IClockStore
    {
        public ScreenTime.Core.Sync.ClockAnchor? Anchor { get; set; }
        public long LastTrustedMs { get; set; }
    }
}
```

### 5.2 `windows/tests/ScreenTime.Core.Tests/TrustedClockTests.cs`

```csharp
using ScreenTime.Core.Sync;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047: time the kid cannot change (docs/SPEC.md §8.5). Copied verbatim from the card.</summary>
public class TrustedClockTests
{
    private readonly SyncTestData.MemoryClockStore _store = new();
    private long _elapsed;
    private long _wall;
    private long _boot = 1;
    private readonly TrustedClock _clock;

    public TrustedClockTests() => _clock = new TrustedClock(_store, () => _elapsed, () => _wall, () => _boot);

    [Fact]
    public void BeforeTheServerAnswersItIsTheWallClockButNeverGoesBack()
    {
        _wall = 50_000;
        Assert.Equal(50_000, _clock.NowMs());

        _wall = 20_000;
        Assert.Equal(50_000, _clock.NowMs());
        Assert.False(_clock.IsAnchored);
    }

    [Fact]
    public void AfterTheServerAnswersChangingTheWallClockDoesNothing()
    {
        _elapsed = 1_000;
        _clock.OnServerTime(10_000_000);

        _elapsed = 61_000;
        _wall = 999_999_999;

        Assert.Equal(10_060_000, _clock.NowMs());
        Assert.True(_clock.IsAnchored);
    }

    [Fact]
    public void AfterARebootItIsTheWallClockButNotBeforeTheLastTrustedTime()
    {
        _elapsed = 1_000;
        _clock.OnServerTime(10_000_000);
        _elapsed = 61_000;
        _clock.NowMs();

        _boot = 2;
        _elapsed = 5_000;
        _wall = 9_000_000;

        Assert.False(_clock.IsAnchored);
        Assert.Equal(10_060_000, _clock.NowMs());
    }

    [Fact]
    public void TheServerWinsEvenWhenThePcClockWasAhead()
    {
        _wall = 90_000_000;
        Assert.Equal(90_000_000, _clock.NowMs());

        _clock.OnServerTime(10_000_000);

        Assert.Equal(10_000_000, _clock.NowMs());
        Assert.Equal(10_000_000, _store.LastTrustedMs);
        Assert.Equal(new ClockAnchor(10_000_000, 0, 1), _store.Anchor);
    }
}
```

### 5.3 `windows/tests/ScreenTime.Core.Tests/RecorderTests.cs`

```csharp
using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047: sessions become segments (docs/SPEC.md §12.2, Q19). Copied verbatim from the card.</summary>
public sealed class RecorderTests : IDisposable
{
    private const string Alex = SyncTestData.Alex;
    private readonly string _path = SyncTestData.NewDbPath();
    private readonly LocalStore _store;
    private readonly Recorder _recorder;
    private int _next;

    public RecorderTests()
    {
        _store = LocalStore.Open(_path);
        _recorder = new Recorder(_store, Alex, () => "s" + ++_next);
    }

    public void Dispose()
    {
        _store.Dispose();
        SyncTestData.Delete(_path);
    }

    private IReadOnlyList<LocalSegment> All() => _store.SegmentsSince(Alex, fromMs: 0);

    private void SendAll()
    {
        foreach (var p in _store.PendingSegments(Alex, limit: 100)) _store.MarkSent(p.Segment.Id, p.Version);
    }

    [Fact]
    public void UnlockThenLockMakesOneClosedSegmentToUpload()
    {
        _recorder.Start(1_000);
        _recorder.Stop(61_000);

        Assert.Equal(new LocalSegment("s1", Alex, 1_000, 61_000, 61_000, false), Assert.Single(All()));
        Assert.Equal("s1", Assert.Single(_store.PendingSegments(Alex, limit: 10)).Segment.Id);
        Assert.Null(_store.OpenSegment(Alex));
    }

    [Fact]
    public void ATickMovesLastSeenButSendsNothing()
    {
        _recorder.Start(1_000);
        SendAll();

        _recorder.Tick(61_000);

        Assert.Equal(61_000, _store.OpenSegment(Alex)!.LastSeenAtMs);
        Assert.Empty(_store.PendingSegments(Alex, limit: 10));
    }

    [Fact]
    public void ASegmentLeftOpenEndsWhereItWasLastSeen()
    {
        _recorder.Start(1_000);
        _recorder.Tick(61_000);

        // The service died without a lock event; the next unlock is much later.
        _recorder.Start(500_000);

        var all = All();
        Assert.Equal(new LocalSegment("s1", Alex, 1_000, 61_000, 61_000, false), all[0]);
        Assert.Equal(new LocalSegment("s2", Alex, 500_000, null, 500_000, false), all[1]);
    }

    [Fact]
    public void CloseOpenAfterARestartUsesLastSeen()
    {
        _recorder.Start(1_000);
        _recorder.Tick(121_000);

        _recorder.CloseOpen();

        Assert.Equal(121_000, Assert.Single(All()).EndedAtMs);
    }

    [Fact]
    public void OfflineStaysOnOnceSet()
    {
        _recorder.Start(1_000);
        _recorder.MarkOffline();
        _recorder.MarkOffline();
        _recorder.Stop(61_000);

        Assert.Equal(new LocalSegment("s1", Alex, 1_000, 61_000, 61_000, true), Assert.Single(All()));
    }

    [Fact]
    public void AFailedSyncMarksOnlyWhatTheServerHasNotGot()
    {
        _recorder.Start(1_000);
        _recorder.Stop(61_000);
        SendAll();
        _recorder.Start(100_000);
        _recorder.Stop(160_000);
        _recorder.Start(170_000);

        _recorder.MarkOffline();

        Assert.Equal(new[] { false, true, true }, All().Select(s => s.RecordedOffline));
    }

    [Fact]
    public void AnEndBeforeTheStartIsTheStart()
    {
        // The trusted clock can step back when the server answers for the first time after a reboot.
        _recorder.Start(100_000);
        _recorder.Stop(40_000);

        Assert.Equal(100_000, Assert.Single(All()).EndedAtMs);
    }

    [Fact]
    public void NothingOpenMeansNothingToDo()
    {
        _recorder.Tick(1_000);
        _recorder.Stop(2_000);
        _recorder.CloseOpen();
        _recorder.MarkOffline();

        Assert.Empty(All());
    }

    [Fact]
    public void EachAccountHasItsOwnSegments()
    {
        var sam = new Recorder(_store, "S-1-5-21-1-1002", () => "sam" + ++_next);
        _recorder.Start(1_000);
        sam.Start(2_000);
        sam.Stop(3_000);

        Assert.Equal("s1", _store.OpenSegment(Alex)!.Id);
        Assert.Null(_store.OpenSegment("S-1-5-21-1-1002"));
    }
}
```

### 5.4 `windows/tests/ScreenTime.Core.Tests/TodayInputTests.cs`

```csharp
using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;
using ScreenTime.Core.Time;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047: the engine input for today (docs/SPEC.md §7.1, §8.2). Copied verbatim from the card.</summary>
public class TodayInputTests
{
    /// <summary>Monday 26 October 2026, 10:00 in Sydney (UTC+11).</summary>
    private static readonly long Now = Ms("2026-10-25T23:00:00Z");

    [Fact]
    public void TheFamilyDayAndThePoolPickTheAllowance()
    {
        var phone = TodayInput.For(State(pool: "phone"), [], Now);
        var screens = TodayInput.For(State(pool: "screens"), [], Now);

        Assert.Equal(new DateOnly(2026, 10, 26), phone.Date);
        Assert.Equal(60, phone.Day.AllowanceMin);
        Assert.Equal(120, screens.Day.AllowanceMin);
        Assert.Equal("07:00", phone.Day.Wake);
        Assert.Equal("20:30", phone.Day.Bedtime);
        Assert.Equal(Now, phone.Now.ToUnixTimeMilliseconds());
    }

    [Fact]
    public void OwnSegmentsReplaceTheServerCopiesAndOthersStay()
    {
        const string segments = """
            {"id":"mine","deviceId":"d1","startedAt":"2026-10-26T09:00:00+11:00","endedAt":"2026-10-26T09:10:00+11:00"},
            {"id":"tablet","deviceId":"d2","startedAt":"2026-10-26T09:30:00+11:00","endedAt":"2026-10-26T09:40:00+11:00"}
            """;
        const string grants = """{"id":"g1","minutes":15,"createdAt":"2026-10-26T08:00:00+11:00","byName":"Dad"}""";
        // The server has 10 minutes of "mine"; the PC knows it went on to 09:20 and is in use again since 09:50.
        LocalSegment[] own =
        [
            new("mine", Alex, Ms("2026-10-25T22:00:00Z"), Ms("2026-10-25T22:20:00Z"), Ms("2026-10-25T22:20:00Z"), false),
            new("open", Alex, Ms("2026-10-25T22:50:00Z"), null, Ms("2026-10-25T22:59:00Z"), false),
        ];

        var input = TodayInput.For(State(pool: "phone", grants: grants, segments: segments), own, Now);
        var result = Engine.Evaluate(input);

        Assert.Equal(3, input.Segments.Count);
        Assert.Single(input.Grants);
        // Used: 20 (mine) + 10 (tablet) + 10 (open, until now) = 40 min of 60 + 15.
        Assert.Equal(40 * 60L, result.UsedSec);
        Assert.Equal(35 * 60L, result.RemainingSec);
        Assert.False(result.Locked);
    }

    [Fact]
    public void ASnapshotFromYesterdayStartsTheDayEmpty()
    {
        const string segments = """{"id":"tablet","deviceId":"d2","startedAt":"2026-10-25T09:30:00+11:00","endedAt":null}""";
        const string grants = """{"id":"g1","minutes":30,"createdAt":"2026-10-25T08:00:00+11:00","byName":"Dad"}""";
        LocalSegment[] own = [new("open", Alex, Ms("2026-10-25T22:50:00Z"), null, Ms("2026-10-25T22:59:00Z"), false)];

        var input = TodayInput.For(State(pool: "phone", date: "2026-10-25", grants: grants, segments: segments), own, Now);

        Assert.Empty(input.Grants);
        Assert.Single(input.Segments);
        Assert.Equal(50 * 60L, Engine.Evaluate(input).RemainingSec);
    }

    [Fact]
    public void TheDayStartsAtMidnightInTheFamilyZone()
    {
        Assert.Equal(Ms("2026-10-25T13:00:00Z"), TodayInput.DayStartMs(State(), Now));
    }

    [Fact]
    public void SundayIsWeekdaySeven()
    {
        // Sunday 1 November 2026, 10:00 in Sydney.
        var input = TodayInput.For(State(), [], Ms("2026-10-31T23:00:00Z"));
        Assert.Equal(DayOfWeek.Sunday, input.Date.DayOfWeek);
        Assert.Equal(120, input.Day.AllowanceMin);
    }
}
```

### 5.5 `windows/tests/ScreenTime.Core.Tests/SyncerTests.cs`

```csharp
using System.Net;
using System.Text;
using ScreenTime.Core.Api;
using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047: one sync, upload then snapshot (docs/SPEC.md §8.2, §8.3). Copied verbatim from the card.</summary>
public sealed class SyncerTests : IDisposable
{
    private const string Id = "11111111-1111-4111-8111-111111111111";

    /// <summary>Answers each request with <c>answer</c>, and keeps every request and its body.</summary>
    private sealed class FakeServer(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string? Body)> Seen { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            Seen.Add((request, body));
            return answer(request);
        }
    }

    private static HttpResponseMessage Json(string json, string? etag = null)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        if (etag is not null) response.Headers.TryAddWithoutValidation("ETag", etag);
        return response;
    }

    private readonly string _path = NewDbPath();
    private readonly LocalStore _store;
    private readonly TrustedClock _clock = new(new MemoryClockStore(), () => 0, () => 0, () => 1);
    private readonly List<string> _log = [];

    public SyncerTests() => _store = LocalStore.Open(_path);

    public void Dispose()
    {
        _store.Dispose();
        Delete(_path);
    }

    private Syncer SyncerFor(FakeServer server) =>
        new(new ApiClient(new HttpClient(server) { BaseAddress = new Uri("https://st.example/") }, () => "device-token"), _store, Alex, _clock, _log.Add);

    [Fact]
    public async Task UploadsTheOutboxThenKeepsTheSnapshotAndTheServerTime()
    {
        _store.PutSegment(new LocalSegment(Id, Alex, Ms("2026-10-25T22:00:00Z"), null, Ms("2026-10-25T22:00:00Z"), false));
        var server = new FakeServer(r => r.RequestUri!.AbsolutePath == "/v1/device/usage"
            ? Json("""{"received":1}""")
            : Json(StateJson(serverTime: "2026-10-25T23:00:00.000Z"), "\"v1\""));

        Assert.True(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        Assert.Equal(2, server.Seen.Count);
        Assert.Equal("/v1/device/usage", server.Seen[0].Request.RequestUri!.AbsolutePath);
        Assert.Equal(
            """{"segments":[{"id":"11111111-1111-4111-8111-111111111111","startedAt":"2026-10-25T22:00:00.000Z","endedAt":null,"recordedOffline":false}]}""",
            server.Seen[0].Body);
        Assert.Equal("Bearer device-token", server.Seen[0].Request.Headers.Authorization!.ToString());
        Assert.False(server.Seen[1].Request.Headers.Contains("If-None-Match"));
        Assert.Empty(_store.PendingSegments(Alex, limit: 10));
        var cached = _store.LoadState(Alex)!;
        Assert.Equal("\"v1\"", cached.ETag);
        Assert.Equal("Alex", cached.State.Kid.Name);
        Assert.Equal(Ms("2026-10-25T23:00:00Z"), _clock.NowMs());
    }

    [Fact]
    public async Task AKnownSnapshotIsAskedWithIfNoneMatchAnd304UsesTheDateHeader()
    {
        await SyncerFor(new FakeServer(_ => Json(StateJson(), "\"v1\""))).SyncAsync(TestContext.Current.CancellationToken);
        var server = new FakeServer(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.NotModified);
            response.Headers.TryAddWithoutValidation("Date", "Mon, 26 Oct 2026 01:02:03 GMT");
            return response;
        });

        Assert.True(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        var (request, _) = Assert.Single(server.Seen);
        Assert.Equal("\"v1\"", request.Headers.GetValues("If-None-Match").Single());
        Assert.Equal("\"v1\"", _store.LoadState(Alex)!.ETag);
        Assert.Equal(Ms("2026-10-26T01:02:03Z"), _clock.NowMs());
    }

    [Fact]
    public async Task AFailedUploadKeepsTheSegmentsForNextTime()
    {
        _store.PutSegment(new LocalSegment(Id, Alex, 1_000, 61_000, 61_000, false));
        var server = new FakeServer(_ => new HttpResponseMessage(HttpStatusCode.BadGateway));

        Assert.False(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        Assert.Single(server.Seen);
        Assert.Single(_store.PendingSegments(Alex, limit: 10));
        Assert.Null(_store.LoadState(Alex));
        Assert.False(_clock.IsAnchored);
        Assert.Contains("502", Assert.Single(_log));
    }

    [Fact]
    public async Task AChangeDuringTheUploadIsSentAgain()
    {
        _store.PutSegment(new LocalSegment(Id, Alex, 1_000, null, 1_000, false));
        var server = new FakeServer(r =>
        {
            if (r.RequestUri!.AbsolutePath != "/v1/device/usage") return Json(StateJson(), "\"v1\"");
            // The PC locks while the open segment is on its way.
            _store.PutSegment(new LocalSegment(Id, Alex, 1_000, 61_000, 61_000, false));
            return Json("""{"received":1}""");
        });

        Assert.True(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        Assert.Equal(61_000, Assert.Single(_store.PendingSegments(Alex, limit: 10)).Segment.EndedAtMs);
    }

    [Fact]
    public async Task UploadsGoInBatchesOf500()
    {
        for (var i = 0; i < 501; i++) _store.PutSegment(new LocalSegment($"s{i:D4}", Alex, 1_000 + i, 1_001 + i, 1_001 + i, false));
        var server = new FakeServer(r => r.RequestUri!.AbsolutePath == "/v1/device/usage"
            ? Json("""{"received":1}""")
            : Json(StateJson(), "\"v1\""));

        Assert.True(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        Assert.Equal(new[] { "/v1/device/usage", "/v1/device/usage", "/v1/device/state" }, server.Seen.Select(s => s.Request.RequestUri!.AbsolutePath));
        Assert.Empty(_store.PendingSegments(Alex, limit: 10));
    }

    [Fact]
    public async Task ACancelledSyncThrowsInsteadOfReturningFalse()
    {
        using var cancel = new CancellationTokenSource();
        var server = new FakeServer(_ =>
        {
            cancel.Cancel();
            throw new OperationCanceledException(cancel.Token);
        });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => SyncerFor(server).SyncAsync(cancel.Token));
        Assert.Empty(_log);
    }
}
```

## 6. What to write

Namespace `ScreenTime.Core.Sync` for all four files. Give each public type and member a one-line `///` summary. Use exactly these names and shapes; the tests use them.

### 6.1 `TrustedClock.cs`

```csharp
public sealed record ClockAnchor(long ServerMs, long ElapsedMs, long BootId);

public interface IClockStore
{
    ClockAnchor? Anchor { get; set; }
    long LastTrustedMs { get; set; }
}

public sealed class TrustedClock(IClockStore store, Func<long> elapsed, Func<long> wall, Func<long> bootId)
{
    public bool IsAnchored { get; }
    public long NowMs();
    public void OnServerTime(long serverMs);
}
```

- This is `TrustedClock.kt` line for line. `bootCount` becomes `bootId`, a `long`. CARD-047b decides where it comes from on Windows.
- `@Synchronized` becomes a `lock` on one private object, around `IsAnchored`, `NowMs` and `OnServerTime`.

### 6.2 `Recorder.cs`

```csharp
public sealed class Recorder(LocalStore store, string sid, Func<string> newId)
{
    public void Start(long atMs);
    public void Tick(long atMs);
    public void Stop(long atMs);
    public void CloseOpen();
    public void MarkOffline();
}
```

- This is the `Recorder` class in `Recorder.kt`, line for line. On Windows, "unlocked" means a logon or unlock of the account, and "screen off" means a lock, logoff, disconnect, sleep or shutdown (SPEC §12.2).
- Every call works only on `sid`'s rows. `store.open()` becomes `store.OpenSegment(sid)`, and `store.put` becomes `store.PutSegment`. New segments get `Sid = sid`.
- `Start`, as in Kotlin, first calls `CloseOpen()`, then `PutSegment(new LocalSegment(newId(), sid, atMs, null, atMs, false))`.
- `Tick` calls `store.Touch` only when `atMs > open.LastSeenAtMs`.
- `Stop` sets `EndedAtMs = Math.Max(atMs, open.StartedAtMs)` and `LastSeenAtMs = Math.Max(end, open.LastSeenAtMs)`.
- `CloseOpen` ends the open segment at its `LastSeenAtMs`.
- `MarkOffline` takes the open segment plus `store.PendingSegments(sid, int.MaxValue)`, distinct by `Id`, and puts each one that is not yet `RecordedOffline` again with `RecordedOffline = true`.

### 6.3 `TodayInput.cs`

```csharp
public static class TodayInput
{
    public static long DayStartMs(DeviceState state, long nowMs);
    public static EngineInput For(DeviceState state, IReadOnlyList<LocalSegment> own, long nowMs);
}
```

`DeviceState` comes from `ScreenTime.Core.Api`. `EngineInput`, `DaySchedule`, `Grant` and `Segment` come from `ScreenTime.Core.Time`. Port `TodayInput.kt` with these C# rules:

- `tz = TimeZoneInfo.FindSystemTimeZoneById(state.Family.Timezone)`. Never use `TimeZoneInfo.Local`.
- `now = DateTimeOffset.FromUnixTimeMilliseconds(nowMs)`. The local date is `DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, tz).DateTime)`.
- `DayStartMs` is `Engine.LocalMs(date, TimeOnly.MinValue, tz)`.
- The weekday is ISO: Monday is 1 and **Sunday is 7** (`date.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)date.DayOfWeek`). Pick the day with `state.Schedule.Days.First(d => d.Weekday == weekday)`.
- The allowance is `PhoneMin` when `state.Device.Pool == ScreenTime.Core.Api.Pool.Phone`, else `ScreensMin`. Write the namespace in full: `ScreenTime.Core.Pool` is a different type.
- `sameDay` is `state.Today.Date == date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)`.
- Parse the server's times with `DateTimeOffset.Parse(text, CultureInfo.InvariantCulture)`.
- The segments are the server's pool segments whose `Id` is not in `own` (only when `sameDay`), **followed by** `own` in the order given.

### 6.4 `Syncer.cs`

```csharp
public sealed class Syncer(ApiClient api, LocalStore store, string sid, TrustedClock clock, Action<string>? log = null)
{
    public Task<bool> SyncAsync(CancellationToken cancellationToken);
}
```

Port `Syncer.kt`:

1. **Upload**: loop. Take `store.PendingSegments(sid, 500)`. Stop when it is empty. Send `api.PostDeviceUsageAsync(new UsageUpload(batch.Select(ToUpload).ToList()), cancellationToken)`, then `store.MarkSent(p.Segment.Id, p.Version)` for each one. Stop when the batch had fewer than 500.
2. **Fetch**: `var cached = store.LoadState(sid)`, then `api.GetDeviceStateAsync(cached?.ETag, cancellationToken)`.
   - With a value: `store.SaveState(sid, new CachedState(answer.ETag, value))`, then `clock.OnServerTime(DateTimeOffset.Parse(value.ServerTime, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds())`.
   - On a `304` (no value): if `answer.Date` is not null, `clock.OnServerTime(DateTimeOffset.ParseExact(answer.Date, "r", CultureInfo.InvariantCulture).ToUnixTimeMilliseconds())`. The cached state stays as it is.
3. Both steps worked: return `true`.
4. `catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)` rethrows (`throw;`) and logs nothing.
5. Any other `Exception`: call `log?.Invoke($"sync failed: {e.Message}")` and return `false`. Nothing is lost, because the segments stay pending.

`ToUpload(LocalSegment s)` is a private static method that returns `new UsageSegmentIn(s.Id, Iso(s.StartedAtMs), s.EndedAtMs is { } end ? Iso(end) : null, s.RecordedOffline)`, where:

```csharp
private static string Iso(long ms) =>
    DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
```

(Kotlin leaves out `.000`; we always send milliseconds, and the server takes both.)

### 6.5 Files

1. The five test files from section 5, copied into `windows/tests/ScreenTime.Core.Tests/`.
2. `windows/src/ScreenTime.Core/Sync/TrustedClock.cs`, `Recorder.cs`, `TodayInput.cs` and `Syncer.cs`, written from 6.1 to 6.4.

## 7. Steps

1. `git checkout main`, `git pull`, `git checkout -b bob/card-047-cs-sync`. Check that `docs/cards/CARD-047-cs-sync.md` exists.
2. Copy the five files in section 5. Run the fingerprints (8.1) **once**.
3. Write the four files, reading each Kotlin file first.
4. From `windows`: `dotnet build ScreenTime.slnx -c Release`, then `dotnet test --solution ScreenTime.slnx -c Release --no-build`, until both pass. Fix your code, never a test. A failing test names its file; compare that step with the Kotlin.
5. Commit `CARD-047: Windows: recorder, trusted clock and sync`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: five hashes, each followed by `True`. A `False`: copy that file again once and re-run. Still `False`: paste it and carry on.
  ```powershell
  function Fp($f, $want) {
    $b = [IO.File]::ReadAllBytes("windows\tests\ScreenTime.Core.Tests\$f") | Where-Object { $_ -ne 13 }
    $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
    "$f $h $($h -eq $want)"
  }
  Fp "SyncTestData.cs" "bc6636082e0f666b582a91caf05bfda8e232ea52548e1fb516c2befd200766a1"
  Fp "TrustedClockTests.cs" "e872be9cea61bd8f00d4ccdbefdc53f0fbc82a37987ddfb1938a62961d76fba9"
  Fp "RecorderTests.cs" "8bf7d33d38da2b942bfef8853d48bff79e827b4245dd81b0c44cc250aff12c52"
  Fp "TodayInputTests.cs" "3cf5903e12ac94672767d3e4a7599fa9dc9b28a5b3b762b7e644c49d9558a55e"
  Fp "SyncerTests.cs" "27b2e342cf89609b8441b72aaa8bab70244ecb55883cf5750ba8a84d30a9ef92"
  ```
- [ ] `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors.
- [ ] `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 85** (61 before + 24). Paste the summary lines.
- [ ] `Select-String -Path windows\src\ScreenTime.Core\Sync\*.cs -Pattern 'DateTime\.Now|UtcNow|TimeZoneInfo\.Local|TickCount'` prints nothing. Every time comes from the caller.

### 8.2 Repo

- [ ] `git status` clean (no `bin\`, `obj\` or `TestResults\`).
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 9 files:
  ```
  windows/src/ScreenTime.Core/Sync/Recorder.cs
  windows/src/ScreenTime.Core/Sync/Syncer.cs
  windows/src/ScreenTime.Core/Sync/TodayInput.cs
  windows/src/ScreenTime.Core/Sync/TrustedClock.cs
  windows/tests/ScreenTime.Core.Tests/RecorderTests.cs
  windows/tests/ScreenTime.Core.Tests/SyncTestData.cs
  windows/tests/ScreenTime.Core.Tests/SyncerTests.cs
  windows/tests/ScreenTime.Core.Tests/TodayInputTests.cs
  windows/tests/ScreenTime.Core.Tests/TrustedClockTests.cs
  ```

## 9. Tests

These are the Kotlin tests ported, plus a few for Windows:

| File | Tests | What it checks |
|---|---|---|
| `TrustedClockTests` | 4 | Wall clock before the server answers, never going back; ignoring the PC clock after the server answers; a reboot; the server winning. |
| `RecorderTests` | 9 | Unlock then lock; tick; a segment left open by a crash; restart; offline marks only what the server has not got; an end before the start; nothing open; accounts kept apart. |
| `TodayInputTests` | 5 | Family day and pool allowance; own segments replace the server's copies; a snapshot from yesterday; midnight in the family zone; Sunday is weekday 7. |
| `SyncerTests` | 6 | Upload, then the snapshot and the server time; `If-None-Match` and a `304` using `Date`; a failed upload keeps everything; a change during upload is sent again; batches of 500; cancel throws. |

`SyncTestData` holds the shared test data.

## 10. Git and pull request

Push `bob/card-047-cs-sync` and open the PR with `gh pr create --base main --title "CARD-047: Windows: recorder, trusted clock and sync" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body says what the card asked for, lists the 9 files, and gives the test summary lines. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". Never change a test.

- **A copied test does not compile, or an analyzer rule (an `xUnit…` or `CA…` code) fails it**, and the error is in the test file itself, not a missing type or member your code should give: paste the full error and stop. The card may be wrong, and Claude fixes it.
- **A `TodayInputTests` number is off** (for example 36 minutes instead of 35): check which segments you keep. The server's copy of `mine` must be dropped, because `own` replaces it.
- **`AFailedUploadKeepsTheSegmentsForNextTime` finds no log line**: `log` must be called once, with `e.Message`, which holds the status (`The server answered 502.`).

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
Claude, here is Bob's handback for CARD-047. Please review and merge if it is good.

CARD: CARD-047 Windows: recorder, trusted clock and sync
PR: <full PR URL>
Branch: bob/card-047-cs-sync
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
