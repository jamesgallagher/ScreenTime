using ScreenTime.Core.Api;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-049: the tray's status from the state and the engine (docs/SPEC.md §16.3). Copied verbatim from the card.</summary>
public class TrayStatusBuilderTests
{
    // Monday 26 October 2026 in Sydney (UTC+11). Every day: 120 min, wake 07:00, bedtime 20:30, warnings 15 and 5.
    private static readonly long Noon = Ms("2026-10-26T01:00:00Z");

    private static EngineResult Open(long nowMs, long remainingSec, long lockAtMs, long usedSec = 3_000) =>
        new(false, null, remainingSec, DateTimeOffset.FromUnixTimeMilliseconds(lockAtMs), DateTimeOffset.FromUnixTimeMilliseconds(nowMs + 60_000), usedSec, 0);

    private static EngineResult Locked(LockReason reason, long nowMs) =>
        new(true, reason, 0, null, DateTimeOffset.FromUnixTimeMilliseconds(nowMs + 60_000), 7_200, 0);

    [Fact]
    public void WhileOpenItCountsToTheLock()
    {
        var s = TrayStatusBuilder.From(State(), Open(Noon, 4_320, Noon + 4_320_000), Noon, online: true, syncedAtMs: Noon - 20_000);
        Assert.Equal("Alex", s.KidName);
        Assert.Equal("Screens", s.PoolName);
        Assert.Null(s.LockReason);
        Assert.Equal(4_320, s.LeftSec);
        Assert.Equal(3_000, s.UsedSec);
        Assert.Equal(Noon + 4_320_000, s.LockAtMs);
        Assert.Equal("8:30 pm", s.Bedtime);
        Assert.Null(s.BackAt);
        Assert.Equal(15, s.Warn1Min);
        Assert.Equal(5, s.Warn2Min);
        Assert.True(s.Online);
        Assert.Equal(Noon - 20_000, s.SyncedAtMs);
        Assert.False(s.ParentMode);
        Assert.Null(s.ParentModeEnds);
        Assert.Empty(s.ParentNames);
    }

    [Fact]
    public void BedtimeBeforeTheTimeRunsOutIsTheLock()
    {
        var sevenPm = Ms("2026-10-26T08:00:00Z");
        var s = TrayStatusBuilder.From(State(), Open(sevenPm, 7_200, Ms("2026-10-26T09:30:00Z")), sevenPm, true, sevenPm);
        Assert.Equal(5_400, s.LeftSec);
        Assert.Equal("8:30 pm", s.Bedtime);
    }

    [Fact]
    public void AtBedtimeItIsBackAtTomorrowsWake()
    {
        var ninePm = Ms("2026-10-26T10:00:00Z");
        var s = TrayStatusBuilder.From(State(), Locked(LockReason.Bedtime, ninePm), ninePm, true, ninePm);
        Assert.Equal(LockReason.Bedtime, s.LockReason);
        Assert.Equal(0, s.LeftSec);
        Assert.Null(s.LockAtMs);
        Assert.Null(s.Bedtime);
        Assert.Equal("7:00 am", s.BackAt);
    }

    [Fact]
    public void BeforeWakeItIsBackAtTodaysWake()
    {
        var sixAm = Ms("2026-10-25T19:00:00Z");
        var s = TrayStatusBuilder.From(State(), Locked(LockReason.BeforeWake, sixAm), sixAm, true, sixAm);
        Assert.Equal(LockReason.BeforeWake, s.LockReason);
        Assert.Equal("7:00 am", s.BackAt);
        Assert.Equal("8:30 pm", s.Bedtime);
    }

    [Fact]
    public void OutOfTimeHasNoBackAt()
    {
        var s = TrayStatusBuilder.From(State(), Locked(LockReason.OutOfTime, Noon), Noon, true, Noon);
        Assert.Equal(LockReason.OutOfTime, s.LockReason);
        Assert.Null(s.BackAt);
        Assert.Equal(7_200, s.UsedSec);
    }

    [Fact]
    public void NoCurfewHasNoBedtime()
    {
        var state = State();
        var lateDays = state.Schedule.Days.Select(d => d with { Bedtime = "24:00" }).ToList();
        var s = TrayStatusBuilder.From(state with { Schedule = state.Schedule with { Days = lateDays } }, Open(Noon, 600, Noon + 600_000), Noon, true, Noon);
        Assert.Null(s.Bedtime);
    }

    [Fact]
    public void ParentModeIsNeverLockedAndSaysWhenItEnds()
    {
        var state = State() with { ParentMode = new DeviceStateParentMode(true, "2026-10-26T05:15:00.000Z", "Dad") };
        var s = TrayStatusBuilder.From(state, Locked(LockReason.OutOfTime, Noon) with { RemainingSec = 0 }, Noon, true, Noon);
        Assert.True(s.ParentMode);
        Assert.Null(s.LockReason);
        Assert.Null(s.LockAtMs);
        Assert.Equal("4:15 pm", s.ParentModeEnds);

        var untilEnded = state with { ParentMode = new DeviceStateParentMode(true, null, "Dad") };
        Assert.Null(TrayStatusBuilder.From(untilEnded, Open(Noon, 600, Noon + 600_000), Noon, true, Noon).ParentModeEnds);

        var ended = state with { ParentMode = new DeviceStateParentMode(true, "2026-10-26T00:59:00.000Z", "Dad") };
        var after = TrayStatusBuilder.From(ended, Locked(LockReason.OutOfTime, Noon), Noon, true, Noon);
        Assert.False(after.ParentMode);
        Assert.Equal(LockReason.OutOfTime, after.LockReason);
    }

    [Fact]
    public void ItNamesTheParentsAndThePool()
    {
        var state = State(pool: "phone") with
        {
            Parents = [new DeviceStateParentsItem("p1", "Mum", null), new DeviceStateParentsItem("p2", "Dad", "+61400000000")],
        };
        var s = TrayStatusBuilder.From(state, Open(Noon, 600, Noon + 600_000), Noon, online: false, syncedAtMs: null);
        Assert.Equal("Phone", s.PoolName);
        Assert.Equal(["Mum", "Dad"], s.ParentNames);
        Assert.False(s.Online);
        Assert.Null(s.SyncedAtMs);
    }
}
