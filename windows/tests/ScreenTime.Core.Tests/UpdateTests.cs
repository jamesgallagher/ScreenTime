using ScreenTime.Core.Service;
using ScreenTime.Core.Update;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-061: the Windows self-update decision (docs/SPEC.md §12.2), with fake times and offers.</summary>
public class UpdateTests
{
    private static readonly long T = DateTimeOffset.Parse("2026-11-16T05:00:00Z").ToUnixTimeMilliseconds();

    [Fact]
    public void TheHighestOfferAcrossAccountsWins()
    {
        var low = new Offer(5, "0.1.5", "a", 100);
        var high = new Offer(7, "0.1.7", "b", 200);
        var same = new Offer(4, "0.1.4", "c", 100);
        var best = UpdateOffer.Best([low, high, same], runningVersionCode: 3);
        Assert.Equal(7, best!.VersionCode);
    }

    [Fact]
    public void AnOfferNotHigherThanTheRunningVersionIsIgnored()
    {
        var same = new Offer(4, "0.1.4", "a", 100);
        var lower = new Offer(3, "0.1.3", "b", 100);
        Assert.Null(UpdateOffer.Best([same, lower], runningVersionCode: 4));
        Assert.Null(UpdateOffer.Best([lower], runningVersionCode: 4));
    }

    [Fact]
    public void ACheckIsDueAtTheFirstSyncAndThenEverySixHours()
    {
        Assert.True(UpdateCheck.IsDue(null, T));
        Assert.False(UpdateCheck.IsDue(T, T + 3_600_000));
        Assert.False(UpdateCheck.IsDue(T, T + 5 * 3_600_000 + 999_999));
        Assert.True(UpdateCheck.IsDue(T, T + 6 * 3_600_000));
        Assert.True(UpdateCheck.IsDue(T, T + 7 * 3_600_000));
    }

    [Fact]
    public void ADownloadIsKeptOnlyWhenSizeAndSha256BothMatch()
    {
        Assert.True(UpdateVerify.Matches(100, "abc", 100, "abc"));
        Assert.False(UpdateVerify.Matches(100, "ABC", 100, "abc"));
        Assert.False(UpdateVerify.Matches(100, "abc", 101, "abc"));
        Assert.False(UpdateVerify.Matches(100, "abc", 100, "abd"));
    }

    [Fact]
    public void InstallIsDecidedOnlyWhenNoSessionIsUsingThePc()
    {
        Assert.False(UpdateInstall.IsDue(anyoneUsing: true, verifiedAtMs: T, nowMs: T + 1_000, anytime: false));
        Assert.True(UpdateInstall.IsDue(anyoneUsing: false, verifiedAtMs: T, nowMs: T + 1_000, anytime: false));
    }

    [Fact]
    public void InstallIsDecidedTwentyFourHoursAfterTheVerifiedDownload()
    {
        Assert.False(UpdateInstall.IsDue(anyoneUsing: true, verifiedAtMs: T, nowMs: T + 23 * 3_600_000 + 999_999, anytime: false));
        Assert.True(UpdateInstall.IsDue(anyoneUsing: true, verifiedAtMs: T, nowMs: T + 24 * 3_600_000, anytime: false));
    }

    [Fact]
    public void UpdateAnytimeSkipsTheWait()
    {
        Assert.True(UpdateInstall.IsDue(anyoneUsing: true, verifiedAtMs: T, nowMs: T + 1_000, anytime: true));
    }

    [Fact]
    public void SuccessIsWorkedOutAtStartFromTheStoredPendingUpdate()
    {
        var pending = new PendingUpdate(7, "0.1.7", T - 60_000);
        var (succeeded, failed) = UpdateAttempt.Result(pending, runningVersionCode: 7, nowMs: T);
        Assert.True(succeeded);
        Assert.False(failed);
        var (s2, f2) = UpdateAttempt.Result(pending, runningVersionCode: 8, nowMs: T);
        Assert.True(s2);
        Assert.False(f2);
    }

    [Fact]
    public void AStillRunningServiceTenMinutesAfterStartingTheInstallerIsAFailure()
    {
        var pending = new PendingUpdate(7, "0.1.7", T);
        var (s, f) = UpdateAttempt.Result(pending, runningVersionCode: 6, nowMs: T + 9 * 60_000 + 999);
        Assert.False(s);
        Assert.False(f);
        var (s2, f2) = UpdateAttempt.Result(pending, runningVersionCode: 6, nowMs: T + 10 * 60_000);
        Assert.False(s2);
        Assert.True(f2);
    }

    [Fact]
    public void AfterThreeFailuresAVersionIsNotTriedAgainUntilAHigherOneIsOffered()
    {
        Assert.False(UpdateAttempt.GiveUp(0));
        Assert.False(UpdateAttempt.GiveUp(1));
        Assert.False(UpdateAttempt.GiveUp(2));
        Assert.True(UpdateAttempt.GiveUp(3));
        // Only the latest version tried is counted: a higher one starts again at 0.
        var stored = UpdateFailures.After(UpdateFailures.After(UpdateFailures.After(null, 7), 7), 7);
        Assert.Equal(3, UpdateFailures.For(stored, 7));
        Assert.Equal(0, UpdateFailures.For(stored, 8));
        Assert.Equal(new UpdateFailures(8, 1), UpdateFailures.After(stored, 8));
        Assert.Equal(stored, UpdateFailures.Decode(UpdateFailures.Encode(stored)));
        Assert.Null(UpdateFailures.Decode("not json"));
    }

    [Fact]
    public void TheQuitPipeLineEncodesAsExactlyQuitAndDecodesBack()
    {
        Assert.Equal("""{"type":"quit"}""", PipeMessage.Encode(PipeMessage.Quit()));
        var back = PipeMessage.Decode("""{"type":"quit"}""");
        Assert.NotNull(back);
        Assert.Equal("quit", back!.Type);
    }


    private static readonly Offer Seven = new(7, "0.1.7", "sha", 200);

    /// <summary>A tick's facts: nothing pending, checked a minute ago, offered 0.1.7 while running 0.1.6, nothing downloaded.</summary>
    private static UpdateState State(PendingUpdate? pending = null, long? lastCheckMs = -1, Offer? offer = null, bool noOffer = false,
        int? verifiedCode = null, long? verifiedAtMs = null, int failures = 0, bool anyoneUsing = false, bool anytime = false, int running = 6, long now = 0) =>
        new(pending, lastCheckMs == -1 ? T - 60_000 : lastCheckMs, noOffer ? null : offer ?? Seven, verifiedCode, verifiedAtMs, failures, anyoneUsing, anytime, running, now == 0 ? T : now);

    [Fact]
    public void TheFirstTickChecksAndThenEverySixHours()
    {
        Assert.Equal(UpdateAction.Check, UpdateDecision.Decide(State(lastCheckMs: null, noOffer: true)));
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.Decide(State(lastCheckMs: T - 5 * 3_600_000, noOffer: true)));
        Assert.Equal(UpdateAction.Check, UpdateDecision.Decide(State(lastCheckMs: T - 6 * 3_600_000, noOffer: true)));
    }

    [Fact]
    public void AnOfferJustReceivedIsDownloadedAtOnceNotSixHoursLater()
    {
        // The bug in round 2: checking set "last checked", and the offer was then only acted on when a check was due again.
        Assert.Equal(UpdateAction.Download, UpdateDecision.Decide(State(lastCheckMs: T)));
    }

    [Fact]
    public void AVerifiedDownloadIsInstalledWhenThePcIsFreeOrWithUpdateAnytime()
    {
        Assert.Equal(UpdateAction.Install, UpdateDecision.Decide(State(verifiedCode: 7, verifiedAtMs: T - 1_000)));
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.Decide(State(verifiedCode: 7, verifiedAtMs: T - 1_000, anyoneUsing: true)));
        Assert.Equal(UpdateAction.Install, UpdateDecision.Decide(State(verifiedCode: 7, verifiedAtMs: T - 1_000, anyoneUsing: true, anytime: true)));
    }

    [Fact]
    public void AnOfferWaitingForThePcIsLookedAtEveryTickUntilTheTwentyFourHourFallback()
    {
        // Every tick in between asks again, so the PC becoming free is noticed at once.
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.Decide(State(verifiedCode: 7, verifiedAtMs: T - 23 * 3_600_000, anyoneUsing: true)));
        Assert.Equal(UpdateAction.Install, UpdateDecision.Decide(State(verifiedCode: 7, verifiedAtMs: T - 23 * 3_600_000, anyoneUsing: false)));
        Assert.Equal(UpdateAction.Install, UpdateDecision.Decide(State(verifiedCode: 7, verifiedAtMs: T - 24 * 3_600_000, anyoneUsing: true)));
    }

    [Fact]
    public void ADownloadOfAnOlderOfferIsReplacedByTheNewOne()
    {
        Assert.Equal(UpdateAction.Download, UpdateDecision.Decide(State(offer: new Offer(8, "0.1.8", "sha", 200), verifiedCode: 7, verifiedAtMs: T - 1_000)));
    }

    [Fact]
    public void NothingWithoutAnOffer()
    {
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.Decide(State(noOffer: true, verifiedCode: 7, verifiedAtMs: T - 1_000)));
    }

    [Fact]
    public void APendingUpdateIsWorkedOutBeforeAnythingElse()
    {
        var pending = new PendingUpdate(7, "0.1.7", T - 60_000);
        // Still going: nothing, even with a check due and an offer.
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.Decide(State(pending: pending, lastCheckMs: null)));
        // The new service runs 0.1.7: success, even with no offer (the server offers nothing after an update).
        Assert.Equal(UpdateAction.RecordSuccess, UpdateDecision.Decide(State(pending: pending, noOffer: true, running: 7)));
        // Still 0.1.6 ten minutes after the installer started: failure.
        Assert.Equal(UpdateAction.RecordFailure, UpdateDecision.Decide(State(pending: pending with { StartedAtMs = T - 10 * 60_000 })));
    }

    [Fact]
    public void ThreeStoredFailuresStopTheVersionUntilAHigherOneIsOffered()
    {
        Assert.Equal(UpdateAction.Download, UpdateDecision.Decide(State(failures: 2)));
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.Decide(State(failures: 3)));
        // The service counts failures per version (UpdateFailures.For): for 0.1.8 the count is 0 again.
        var stored = new UpdateFailures(7, 3);
        Assert.Equal(UpdateAction.Download, UpdateDecision.Decide(State(offer: new Offer(8, "0.1.8", "sha", 200), failures: UpdateFailures.For(stored, 8))));
    }
}
