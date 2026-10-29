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
