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
