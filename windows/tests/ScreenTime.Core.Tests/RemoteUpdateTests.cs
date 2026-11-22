using ScreenTime.Core.Update;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-072: remote "Update now" rule (docs/SPEC.md §12.11), same table as the kid app's criterion 9.</summary>
public class RemoteUpdateTests
{
    private const string T1 = "2026-11-21T10:00:00Z";
    private const string T2 = "2026-11-21T10:30:00Z";

    [Fact]
    public void RequestAboveRunningWithNoneHandledActsAndSetsAsked()
    {
        var (act, asked) = RemoteUpdate.Decide(versionCode: 901, requestedAt: T1,
            runningVersionCode: 900, handledAt: null, asked: false);
        Assert.True(act);
        Assert.True(asked);
    }

    [Fact]
    public void AlreadyHandledDoesNotActAndAskedUnchanged()
    {
        var (act, asked) = RemoteUpdate.Decide(versionCode: 901, requestedAt: T1,
            runningVersionCode: 900, handledAt: T1, asked: false);
        Assert.False(act);
        Assert.False(asked);
    }

    [Fact]
    public void RequestNotAboveRunningDoesNotAct()
    {
        var (act, asked) = RemoteUpdate.Decide(versionCode: 901, requestedAt: T1,
            runningVersionCode: 901, handledAt: null, asked: false);
        Assert.False(act);
        Assert.False(asked);
    }

    [Fact]
    public void NullRequestDoesNothingAndAskedUnchanged()
    {
        var (act, asked) = RemoteUpdate.Decide(versionCode: null, requestedAt: null,
            runningVersionCode: 900, handledAt: null, asked: false);
        Assert.False(act);
        Assert.False(asked);

        // Asked stays true when it was already true.
        var (act2, asked2) = RemoteUpdate.Decide(versionCode: null, requestedAt: null,
            runningVersionCode: 900, handledAt: null, asked: true);
        Assert.False(act2);
        Assert.True(asked2);
    }

    [Fact]
    public void NewRequestedAtAfterHandlingActsAgain()
    {
        var (act, asked) = RemoteUpdate.Decide(versionCode: 901, requestedAt: T2,
            runningVersionCode: 900, handledAt: T1, asked: false);
        Assert.True(act);
        Assert.True(asked);
    }

    [Fact]
    public void AlreadyAskedWithHandledRequestDoesNotActAndAskedStaysTrue()
    {
        var (act, asked) = RemoteUpdate.Decide(versionCode: 901, requestedAt: T1,
            runningVersionCode: 900, handledAt: T1, asked: true);
        Assert.False(act);
        Assert.True(asked);
    }
}
