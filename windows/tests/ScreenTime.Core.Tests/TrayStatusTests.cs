using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-049 front end: what the tray icon and flyout show (docs/SPEC.md §16.3).</summary>
public class TrayStatusTests
{
    private const long Now = 1_000_000_000;

    private static TrayStatus Open(long left = 4_320, bool online = true) => new(
        "Alex", "Screens", null, left, 3_000, Now + left * 1000, "8:30 pm", null, 15, 5, online, Now - 20_000, false, null, ["Mum", "Dad"]);

    [Fact]
    public void ItShowsTheTimeLeftToday()
    {
        var s = Open();
        Assert.Equal("Alex · Screens", s.Title);
        Assert.Equal("1h 12m", s.BigText(s.LeftSec));
        Assert.Equal("left today", s.Caption());
        Assert.Equal("Bedtime 8:30 pm", s.Subline());
        Assert.Equal("Screens · 1h 12m left", s.Tooltip(s.LeftSec));
        Assert.Equal("Synced just now", s.SyncedText(Now));
        Assert.Equal("Mum or Dad", s.ParentsOr);
    }

    [Theory]
    [InlineData(4_320, TrayLevel.Plenty)]
    [InlineData(901, TrayLevel.Plenty)]
    [InlineData(900, TrayLevel.Low)]
    [InlineData(301, TrayLevel.Low)]
    [InlineData(300, TrayLevel.Critical)]
    [InlineData(1, TrayLevel.Critical)]
    public void TheDotFollowsTheWarnings(long left, TrayLevel expected) => Assert.Equal(expected, Open(left).Level(left));

    [Fact]
    public void OfflineIsGreyAndStillCounts()
    {
        var s = Open(online: false);
        Assert.Equal(TrayLevel.Offline, s.Level(200));
        Assert.Equal("Offline · still counting", s.SyncedText(Now));
        Assert.Equal(4_310, s.LeftSecAfter(10_500));
    }

    [Fact]
    public void ItCountsDownButNeverBelowZero()
    {
        var s = Open(left: 30);
        Assert.Equal(30, s.LeftSecAfter(-5_000));
        Assert.Equal(20, s.LeftSecAfter(10_000));
        Assert.Equal(0, s.LeftSecAfter(60_000));
        Assert.Equal("<1m", s.BigText(20));
        var noLock = s with { LockAtMs = null };
        Assert.Equal(30, noLock.LeftSecAfter(60_000));
    }

    [Fact]
    public void LockedShowsTheReasonAndWhenItIsBack()
    {
        var outOfTime = Open() with { LockReason = LockReason.OutOfTime, LeftSec = 0, LockAtMs = null };
        Assert.Equal(TrayLevel.Locked, outOfTime.Level(0));
        Assert.Equal("0m", outOfTime.BigText(0));
        Assert.Equal("Out of Screens time", outOfTime.Caption());
        Assert.Equal("Out of Screens time", outOfTime.Tooltip(0));
        Assert.Equal("New time tomorrow", outOfTime.Subline());
        Assert.Equal(0, outOfTime.Progress(0));

        var bedtime = outOfTime with { LockReason = LockReason.Bedtime, Bedtime = null, BackAt = "7:00 am" };
        Assert.Equal("It's bedtime", bedtime.Caption());
        Assert.Equal("Screens are back at 7:00 am", bedtime.Subline());

        var early = bedtime with { LockReason = LockReason.BeforeWake };
        Assert.Equal("Not yet, it's early", early.Headline());
    }

    [Fact]
    public void ParentModeSaysWhenItEnds()
    {
        var s = Open() with { ParentMode = true, LockAtMs = null, ParentModeEnds = "4:15 pm" };
        Assert.Equal(TrayLevel.Plenty, s.Level(10));
        Assert.Equal("Parent mode · ends 4:15 pm", s.Caption());
        Assert.Equal("Parent mode · ends 4:15 pm", s.Tooltip(10));
        Assert.Equal("Time isn't counting", s.Subline());
        Assert.Equal("Parent mode · until you end it", (s with { ParentModeEnds = null }).ParentModeText());
    }

    [Theory]
    [InlineData(0, 3_000, 0.0)]
    [InlineData(3_000, 3_000, 0.5)]
    [InlineData(0, 0, 1.0)]
    public void TheBarIsThePartOfTodayThatIsLeft(long left, long used, double expected) =>
        Assert.Equal(expected, (Open() with { UsedSec = used }).Progress(left), 3);

    [Theory]
    [InlineData(59_999, "Synced just now")]
    [InlineData(300_000, "Synced 5 min ago")]
    [InlineData(3_600_000, "Synced over an hour ago")]
    public void TheFooterSaysWhenItLastSynced(long age, string expected) =>
        Assert.Equal(expected, (Open() with { SyncedAtMs = Now - age }).SyncedText(Now));

    [Fact]
    public void BeforeTheFirstSyncItSaysSo() => Assert.Equal("Not synced yet", (Open() with { SyncedAtMs = null }).SyncedText(Now));

    [Theory]
    [InlineData(0, 5, "12:05 am")]
    [InlineData(7, 0, "7:00 am")]
    [InlineData(12, 0, "12:00 pm")]
    [InlineData(20, 30, "8:30 pm")]
    public void TimesAreTwelveHour(int hour, int minute, string expected) => Assert.Equal(expected, TrayText.Clock(hour, minute));

    [Fact]
    public void ParentsAreJoinedTheKidsWay()
    {
        Assert.Equal("your parents", TrayText.Parents([], "or"));
        Assert.Equal("Dad", TrayText.Parents(["Dad"], "or"));
        Assert.Equal("Mum, Dad or Nan", TrayText.Parents(["Mum", "Dad", "Nan"], "or"));
    }
}
