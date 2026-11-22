using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-073: when the lock loop makes a degraded pass without the service lock.</summary>
public class DegradedLockTests
{
    private const long T = 1_000_000;

    [Fact]
    public void NotAgainBeforeTenSeconds()
    {
        Assert.False(DegradedLock.Due(T, T + 9_000));
    }

    [Fact]
    public void AgainAtTenSeconds()
    {
        Assert.True(DegradedLock.Due(T, T + 10_000));
    }

    [Fact]
    public void ANormalPassMakesItImmediateAgain()
    {
        Assert.True(DegradedLock.Due(null, T));
    }

    [Fact]
    public void AClockThatWentBackwardsIsNotDue()
    {
        Assert.False(DegradedLock.Due(T, T - 5_000));
    }
}
