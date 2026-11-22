using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-073: watchdog decisions for a stalled service (docs/SPEC.md §12.2 "Stall guard").</summary>
public class StallWatchTests
{
    private const long T = 1_000_000;

    [Fact]
    public void LastPassOneSecondAgoIsOk()
    {
        Assert.Equal(StallVerdict.Ok, StallWatch.Check(T, T + 1_000, anyoneUsing: true, alreadyLogged: false));
    }

    [Fact]
    public void LastPassFiftyNineSecondsAgoSomeoneUsingIsNotYet()
    {
        // The card's "not yet": 59 s is past the 30 s log but before the 60 s restart, so it is Ok once logged.
        Assert.Equal(StallVerdict.Ok, StallWatch.Check(T, T + 59_000, anyoneUsing: true, alreadyLogged: true));
        // The 30 s log is the first look past 30 s: a 59 s stall that was never logged would log now.
        Assert.Equal(StallVerdict.Log, StallWatch.Check(T, T + 59_000, anyoneUsing: true, alreadyLogged: false));
    }

    [Fact]
    public void LastPassSixtySecondsAgoSomeoneUsingRestarts()
    {
        Assert.Equal(StallVerdict.Restart, StallWatch.Check(T, T + 60_000, anyoneUsing: true, alreadyLogged: false));
    }

    [Fact]
    public void LastPassSixtySecondsAgoNobodyUsingRestarts()
    {
        Assert.Equal(StallVerdict.Restart, StallWatch.Check(T, T + 60_000, anyoneUsing: false, alreadyLogged: false));
    }

    [Fact]
    public void LastPassThirtySecondsAgoLogsOnce()
    {
        // First call at exactly 30 s logs the stall.
        Assert.Equal(StallVerdict.Log, StallWatch.Check(T, T + 30_000, anyoneUsing: true, alreadyLogged: false));

        // The same stall, 31 s in, is not logged again once already logged.
        Assert.Equal(StallVerdict.Ok, StallWatch.Check(T, T + 31_000, anyoneUsing: true, alreadyLogged: true));

        // If the caller had not yet logged, 31 s is still a log.
        Assert.Equal(StallVerdict.Log, StallWatch.Check(T, T + 31_000, anyoneUsing: true, alreadyLogged: false));
    }

    [Fact]
    public void SituationReturnsDifferentWordsForUsingAndIdle()
    {
        Assert.Equal("a kid is using the PC", StallWatch.Situation(anyoneUsing: true));
        Assert.Equal("nobody is using the PC", StallWatch.Situation(anyoneUsing: false));
    }
}
