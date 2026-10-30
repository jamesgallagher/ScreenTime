using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-049: the two warning toasts before a lock (docs/SPEC.md §16.3, Q7). Copied verbatim from the card.</summary>
public class WarningTrackerTests
{
    private static TrayStatus Left(long leftSec, int warn1 = 15, int warn2 = 5) =>
        new("Alex", "Screens", null, leftSec, 0, 1_000_000 + leftSec * 1000, "8:30 pm", null, warn1, warn2, true, null, false, null, []);

    [Fact]
    public void EachWarningShowsOnceWhenTheTimeFallsToIt()
    {
        var w = new WarningTracker();
        Assert.Null(w.Check(Left(4_320)));
        Assert.Equal("15 minutes of Screens left", w.Check(Left(900)));
        Assert.Null(w.Check(Left(899)));
        Assert.Null(w.Check(Left(301)));
        Assert.Equal("5 minutes left. Save your work.", w.Check(Left(300)));
        Assert.Null(w.Check(Left(200)));
        Assert.Null(w.Check(Left(0)));
    }

    [Fact]
    public void JumpingPastBothShowsOnlyTheSecond()
    {
        var w = new WarningTracker();
        Assert.Null(w.Check(Left(4_320)));
        Assert.Equal("5 minutes left. Save your work.", w.Check(Left(200)));
    }

    [Fact]
    public void StartingInsideAWarningShowsIt()
    {
        var w = new WarningTracker();
        Assert.Equal("15 minutes of Screens left", w.Check(Left(600)));
    }

    [Fact]
    public void MoreTimeFromAParentLetsThemShowAgain()
    {
        var w = new WarningTracker();
        w.Check(Left(4_320));
        w.Check(Left(200));
        Assert.Null(w.Check(Left(2_000)));
        Assert.Equal("15 minutes of Screens left", w.Check(Left(900)));
    }

    [Fact]
    public void NoLockTodayParentModeOrLockedNeverWarn()
    {
        var w = new WarningTracker();
        Assert.Null(w.Check(Left(200) with { LockAtMs = null }));
        Assert.Null(w.Check(Left(200) with { ParentMode = true, LockAtMs = null }));
        Assert.Null(w.Check(Left(0) with { LockReason = LockReason.OutOfTime, LockAtMs = null }));
    }

    [Fact]
    public void TheMinutesComeFromTheSchedule()
    {
        var w = new WarningTracker();
        Assert.Equal("10 minutes of Screens left", w.Check(Left(600, warn1: 10, warn2: 1)));
        Assert.Equal("1 minute left. Save your work.", w.Check(Left(60, warn1: 10, warn2: 1)));
    }
}
