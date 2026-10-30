using ScreenTime.Core.Service;
using ScreenTime.Core.Store;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047b: Windows session changes become segments (docs/SPEC.md §12.2, Q19). Copied verbatim from the card.</summary>
public sealed class SessionTrackerTests : IDisposable
{
    private const string Sam = "S-1-5-21-1-1002";
    private const string Dad = "S-1-5-21-1-500";

    private readonly string _path = NewDbPath();
    private readonly LocalStore _store;
    private readonly SessionTracker _tracker;
    private int _next;

    public SessionTrackerTests()
    {
        _store = LocalStore.Open(_path);
        // Alex and Sam are enrolled kid accounts; Dad's admin account is not.
        _store.PutDevice(new StoredDevice(Alex, "d-alex", [1], "Alex", "Australia/Sydney"));
        _store.PutDevice(new StoredDevice(Sam, "d-sam", [2], "Sam", "Australia/Sydney"));
        _tracker = new SessionTracker(_store, () => "s" + ++_next);
    }

    public void Dispose()
    {
        _store.Dispose();
        Delete(_path);
    }

    [Fact]
    public void UnlockOnTheConsoleStartsAndLockEndsAndAsksForASync()
    {
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, Alex, isConsole: true, atMs: 1_000));
        Assert.Equal("s1", _store.OpenSegment(Alex)!.Id);

        Assert.Equal(new[] { Alex }, _tracker.OnChange(SessionChange.Lock, Alex, isConsole: true, atMs: 61_000));
        Assert.Null(_store.OpenSegment(Alex));
        Assert.Equal(61_000, Assert.Single(_store.SegmentsSince(Alex, 0)).EndedAtMs);
    }

    [Fact]
    public void LogonCountsLikeUnlockAndLogoffAndDisconnectEnd()
    {
        _tracker.OnChange(SessionChange.Logon, Alex, isConsole: true, atMs: 1_000);
        Assert.Equal(new[] { Alex }, _tracker.OnChange(SessionChange.Logoff, Alex, isConsole: true, atMs: 2_000));

        _tracker.OnChange(SessionChange.Logon, Alex, isConsole: true, atMs: 3_000);
        Assert.Equal(new[] { Alex }, _tracker.OnChange(SessionChange.Disconnect, Alex, isConsole: false, atMs: 4_000));

        Assert.Equal(new long?[] { 2_000, 4_000 }, _store.SegmentsSince(Alex, 0).Select(s => s.EndedAtMs));
    }

    [Fact]
    public void ARemoteSessionOrAnAccountThatIsNotEnrolledIsNotCounted()
    {
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, Alex, isConsole: false, atMs: 1_000));
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, Dad, isConsole: true, atMs: 1_000));
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, null, isConsole: true, atMs: 1_000));
        Assert.Empty(_tracker.OnChange(SessionChange.Lock, Dad, isConsole: true, atMs: 2_000));

        Assert.Null(_store.OpenSegment(Alex));
        Assert.Empty(_store.SegmentsSince(Dad, 0));
    }

    [Fact]
    public void AnEndWithNothingOpenAsksForNothing()
    {
        Assert.Empty(_tracker.OnChange(SessionChange.Lock, Alex, isConsole: true, atMs: 1_000));
        Assert.Empty(_store.SegmentsSince(Alex, 0));
    }

    [Fact]
    public void SleepAndShutdownEndEveryOpenSegment()
    {
        // Fast user switching: Alex is still signed in (and counting, in a broken case) when Sam unlocks.
        _tracker.OnChange(SessionChange.Unlock, Alex, isConsole: true, atMs: 1_000);
        _tracker.OnChange(SessionChange.Unlock, Sam, isConsole: true, atMs: 2_000);

        var ended = _tracker.OnChange(SessionChange.Suspend, null, isConsole: false, atMs: 9_000);

        Assert.Equal(new[] { Alex, Sam }, ended.Order(StringComparer.Ordinal));
        Assert.Null(_store.OpenSegment(Alex));
        Assert.Null(_store.OpenSegment(Sam));
        Assert.Empty(_tracker.OnChange(SessionChange.Shutdown, null, isConsole: false, atMs: 10_000));
    }

    [Fact]
    public void StartingTheServiceClosesWhatWasLeftOpenAndCountsAnUnlockedConsole()
    {
        _store.PutSegment(new LocalSegment("old", Alex, 1_000, null, 30_000, false));

        _tracker.OnServiceStart(consoleSid: Alex, consoleUnlocked: true, atMs: 100_000);

        var all = _store.SegmentsSince(Alex, 0);
        Assert.Equal(30_000, all[0].EndedAtMs);
        Assert.Equal("s1", all[1].Id);
        Assert.Equal(100_000, all[1].StartedAtMs);
        Assert.Null(all[1].EndedAtMs);
    }

    [Fact]
    public void StartingWithALockedConsoleOrNoKidStartsNothing()
    {
        _tracker.OnServiceStart(consoleSid: Alex, consoleUnlocked: false, atMs: 100_000);
        _tracker.OnServiceStart(consoleSid: Dad, consoleUnlocked: true, atMs: 100_000);
        _tracker.OnServiceStart(consoleSid: null, consoleUnlocked: true, atMs: 100_000);

        Assert.Null(_store.OpenSegment(Alex));
        Assert.Empty(_store.SegmentsSince(Dad, 0));
    }

    [Fact]
    public void TickAndMarkOfflineReachTheRightAccount()
    {
        _tracker.OnChange(SessionChange.Unlock, Alex, isConsole: true, atMs: 1_000);

        _tracker.Tick(61_000);
        _tracker.MarkOffline(Alex);
        _tracker.MarkOffline(Sam);

        var open = _store.OpenSegment(Alex)!;
        Assert.Equal(61_000, open.LastSeenAtMs);
        Assert.True(open.RecordedOffline);
        Assert.Empty(_store.SegmentsSince(Sam, 0));
    }

    [Fact]
    public void ADeviceEnrolledLaterIsPickedUp()
    {
        const string Kim = "S-1-5-21-1-1003";
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, Kim, isConsole: true, atMs: 1_000));

        _store.PutDevice(new StoredDevice(Kim, "d-kim", [3], "Kim", "Australia/Sydney"));
        _tracker.OnChange(SessionChange.Unlock, Kim, isConsole: true, atMs: 2_000);

        Assert.Equal(2_000, _store.OpenSegment(Kim)!.StartedAtMs);
    }
}
