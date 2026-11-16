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
        Assert.False(UpdateAttempt.Retry(versionCode: 7, offeredVersionCode: 7));
        Assert.True(UpdateAttempt.Retry(versionCode: 7, offeredVersionCode: 8));
    }

    [Fact]
    public void TheQuitPipeLineEncodesAsExactlyQuitAndDecodesBack()
    {
        Assert.Equal("""{"type":"quit"}""", PipeMessage.Encode(PipeMessage.Quit()));
        var back = PipeMessage.Decode("""{"type":"quit"}""");
        Assert.NotNull(back);
        Assert.Equal("quit", back!.Type);
    }

    [Fact]
    public void NoDownloadWhileAPendingUpdateIsStored()
    {
        var pending = new PendingUpdate(7, "0.1.7", T);
        var offer = new Offer(8, "0.1.8", "sha", 200);
        var state = new UpdateState(pending, lastCheckMs: null, lastVerifiedAtMs: null, failuresForVersion: 0, bestOffer: offer, anyoneUsing: false, anytime: false, runningVersionCode: 6, nowMs: T + 1_000);
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.Decide(state));
    }

    [Fact]
    public void APendingUpdateStillGoingIsNothing()
    {
        var pending = new PendingUpdate(7, "0.1.7", T);
        var state = new UpdateState(pending, lastCheckMs: null, lastVerifiedAtMs: null, failuresForVersion: 0, bestOffer: null, anyoneUsing: false, anytime: false, runningVersionCode: 6, nowMs: T + 5 * 60_000);
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.Decide(state));
    }

    [Fact]
    public void APendingUpdateSucceededIsRecordSuccess()
    {
        var pending = new PendingUpdate(7, "0.1.7", T - 60_000);
        var state = new UpdateState(pending, lastCheckMs: null, lastVerifiedAtMs: null, failuresForVersion: 0, bestOffer: null, anyoneUsing: false, anytime: false, runningVersionCode: 7, nowMs: T);
        Assert.Equal(UpdateAction.RecordSuccess, UpdateDecision.Decide(state));
    }

    [Fact]
    public void APendingUpdateFailedIsRecordFailure()
    {
        var pending = new PendingUpdate(7, "0.1.7", T - 11 * 60_000);
        var state = new UpdateState(pending, lastCheckMs: null, lastVerifiedAtMs: null, failuresForVersion: 1, bestOffer: null, anyoneUsing: false, anytime: false, runningVersionCode: 6, nowMs: T);
        Assert.Equal(UpdateAction.RecordFailure, UpdateDecision.Decide(state));
    }

    [Fact]
    public void AnOfferWaitsForThePcToBeFreeThenTheTwentyFourHourFallback()
    {
        var offer = new Offer(7, "0.1.7", "sha", 200);
        // Someone is using the PC, not 24h after verified: nothing.
        var state1 = new UpdateState(null, lastCheckMs: T - 7 * 3_600_000, lastVerifiedAtMs: T - 1 * 3_600_000, failuresForVersion: 0, bestOffer: offer, anyoneUsing: true, anytime: false, runningVersionCode: 6, nowMs: T);
        Assert.Equal(UpdateAction.Download, UpdateDecision.Decide(state1));
        // AfterDownload: someone using, not 24h: nothing.
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.AfterDownload(anyoneUsing: true, verifiedAtMs: T - 1 * 3_600_000, nowMs: T, anytime: false));
        // AfterDownload: someone using, 24h after verified: install.
        Assert.Equal(UpdateAction.Install, UpdateDecision.AfterDownload(anyoneUsing: true, verifiedAtMs: T - 24 * 3_600_000, nowMs: T, anytime: false));
        // AfterDownload: nobody using: install.
        Assert.Equal(UpdateAction.Install, UpdateDecision.AfterDownload(anyoneUsing: false, verifiedAtMs: T - 1 * 3_600_000, nowMs: T, anytime: false));
    }

    [Fact]
    public void ThreeFailuresAcrossServiceRestopsGiveUp()
    {
        var offer = new Offer(7, "0.1.7", "sha", 200);
        // First failure: pending update failed, 1 failure stored.
        var pending1 = new PendingUpdate(7, "0.1.7", T - 11 * 60_000, Failures: 0);
        var state1 = new UpdateState(pending1, lastCheckMs: null, lastVerifiedAtMs: null, failuresForVersion: 0, bestOffer: offer, anyoneUsing: false, anytime: false, runningVersionCode: 6, nowMs: T);
        Assert.Equal(UpdateAction.RecordFailure, UpdateDecision.Decide(state1));
        // Second failure: pending update failed, 1 failure stored (the service restarts and re-reads the pending).
        var pending2 = new PendingUpdate(7, "0.1.7", T - 11 * 60_000, Failures: 1);
        var state2 = new UpdateState(pending2, lastCheckMs: null, lastVerifiedAtMs: null, failuresForVersion: 1, bestOffer: offer, anyoneUsing: false, anytime: false, runningVersionCode: 6, nowMs: T);
        Assert.Equal(UpdateAction.RecordFailure, UpdateDecision.Decide(state2));
        // Third failure: pending update failed, 2 failures stored.
        var pending3 = new PendingUpdate(7, "0.1.7", T - 11 * 60_000, Failures: 2);
        var state3 = new UpdateState(pending3, lastCheckMs: null, lastVerifiedAtMs: null, failuresForVersion: 2, bestOffer: offer, anyoneUsing: false, anytime: false, runningVersionCode: 6, nowMs: T);
        Assert.Equal(UpdateAction.RecordFailure, UpdateDecision.Decide(state3));
        // After 3 failures, the version is not tried again.
        var state4 = new UpdateState(null, lastCheckMs: T - 7 * 3_600_000, lastVerifiedAtMs: null, failuresForVersion: 3, bestOffer: offer, anyoneUsing: false, anytime: false, runningVersionCode: 6, nowMs: T);
        Assert.Equal(UpdateAction.Nothing, UpdateDecision.Decide(state4));
        // A higher version is offered: tried again.
        var higherOffer = new Offer(8, "0.1.8", "sha", 200);
        var state5 = new UpdateState(null, lastCheckMs: T - 7 * 3_600_000, lastVerifiedAtMs: null, failuresForVersion: 0, bestOffer: higherOffer, anyoneUsing: false, anytime: false, runningVersionCode: 6, nowMs: T);
        Assert.Equal(UpdateAction.Download, UpdateDecision.Decide(state5));
    }
}
