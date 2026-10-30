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
