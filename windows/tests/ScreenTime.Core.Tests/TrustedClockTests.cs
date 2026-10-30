using ScreenTime.Core.Sync;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047: time the kid cannot change (docs/SPEC.md §8.5). Copied verbatim from the card.</summary>
public class TrustedClockTests
{
    private readonly SyncTestData.MemoryClockStore _store = new();
    private long _elapsed;
    private long _wall;
    private long _boot = 1;
    private readonly TrustedClock _clock;

    public TrustedClockTests() => _clock = new TrustedClock(_store, () => _elapsed, () => _wall, () => _boot);

    [Fact]
    public void BeforeTheServerAnswersItIsTheWallClockButNeverGoesBack()
    {
        _wall = 50_000;
        Assert.Equal(50_000, _clock.NowMs());

        _wall = 20_000;
        Assert.Equal(50_000, _clock.NowMs());
        Assert.False(_clock.IsAnchored);
    }

    [Fact]
    public void AfterTheServerAnswersChangingTheWallClockDoesNothing()
    {
        _elapsed = 1_000;
        _clock.OnServerTime(10_000_000);

        _elapsed = 61_000;
        _wall = 999_999_999;

        Assert.Equal(10_060_000, _clock.NowMs());
        Assert.True(_clock.IsAnchored);
    }

    [Fact]
    public void AfterARebootItIsTheWallClockButNotBeforeTheLastTrustedTime()
    {
        _elapsed = 1_000;
        _clock.OnServerTime(10_000_000);
        _elapsed = 61_000;
        _clock.NowMs();

        _boot = 2;
        _elapsed = 5_000;
        _wall = 9_000_000;

        Assert.False(_clock.IsAnchored);
        Assert.Equal(10_060_000, _clock.NowMs());
    }

    [Fact]
    public void TheServerWinsEvenWhenThePcClockWasAhead()
    {
        _wall = 90_000_000;
        Assert.Equal(90_000_000, _clock.NowMs());

        _clock.OnServerTime(10_000_000);

        Assert.Equal(10_000_000, _clock.NowMs());
        Assert.Equal(10_000_000, _store.LastTrustedMs);
        Assert.Equal(new ClockAnchor(10_000_000, 0, 1), _store.Anchor);
    }
}
