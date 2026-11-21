using ScreenTime.Core.Update;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-071: building the tray's <see cref="UpdateView"/> from pure facts.</summary>
public class UpdateViewTests
{
    private const string Running = "0.1.130";
    private const int RunningCode = 130;
    private static readonly Offer Offer131 = new(131, "0.1.131", "sha131", 34_000_000);

    private static UpdateViewFacts Facts(
        Offer? offer = null,
        bool downloaded = false,
        bool downloading = false,
        PendingUpdate? pending = null,
        bool lastAttemptFailed = false,
        LastCheckState lastCheck = LastCheckState.Never) =>
        new(Running, RunningCode, offer, downloaded, downloading, pending, lastAttemptFailed, lastCheck);

    [Fact]
    public void NeverCheckedIsUnknown()
    {
        var view = UpdateViewBuilder.Build(Facts());
        Assert.Equal(Running, view.Version);
        Assert.Equal(UpdateStates.Unknown, view.State);
        Assert.Null(view.Offered);
        Assert.Null(view.SizeBytes);
        Assert.Null(UpdateWords.Status(view));
    }

    [Fact]
    public void CheckRunningIsChecking()
    {
        var view = UpdateViewBuilder.Build(Facts(lastCheck: LastCheckState.Running));
        Assert.Equal(UpdateStates.Checking, view.State);
        Assert.Equal("Checking for updates…", UpdateWords.Status(view));
    }

    [Fact]
    public void LastCheckFailedIsCheckFailed()
    {
        var view = UpdateViewBuilder.Build(Facts(lastCheck: LastCheckState.Failed));
        Assert.Equal(UpdateStates.CheckFailed, view.State);
        Assert.Equal("Couldn't check. Check the internet and try again.", UpdateWords.Status(view));
    }

    [Fact]
    public void OfferNotDownloadedIsAvailable()
    {
        var view = UpdateViewBuilder.Build(Facts(offer: Offer131));
        Assert.Equal(UpdateStates.Available, view.State);
        Assert.Equal("0.1.131", view.Offered);
        Assert.Equal(34_000_000L, view.SizeBytes);
        Assert.Equal("0.1.131 is out (34 MB). Update now?", UpdateWords.Status(view));
    }

    [Fact]
    public void DownloadingIsDownloading()
    {
        var view = UpdateViewBuilder.Build(Facts(offer: Offer131, downloading: true));
        Assert.Equal(UpdateStates.Downloading, view.State);
        Assert.Equal("0.1.131", view.Offered);
        Assert.Equal(34_000_000L, view.SizeBytes);
        Assert.Equal("Getting 0.1.131…", UpdateWords.Status(view));
    }

    [Fact]
    public void VerifiedIsReady()
    {
        var view = UpdateViewBuilder.Build(Facts(offer: Offer131, downloaded: true));
        Assert.Equal(UpdateStates.Ready, view.State);
        Assert.Equal("0.1.131", view.Offered);
        Assert.Equal(34_000_000L, view.SizeBytes);
        Assert.Equal("0.1.131 is ready. Update now?", UpdateWords.Status(view));
    }

    [Fact]
    public void PendingAttemptIsInstalling()
    {
        var pending = new PendingUpdate(131, "0.1.131", DateTimeOffset.Parse("2026-11-21T10:00:00Z").ToUnixTimeMilliseconds());
        var view = UpdateViewBuilder.Build(Facts(pending: pending));
        Assert.Equal(UpdateStates.Installing, view.State);
        Assert.Equal("0.1.131", view.Offered);
        Assert.Null(view.SizeBytes);
        Assert.Equal("Updating…", UpdateWords.Status(view));
    }

    [Fact]
    public void LastAttemptFailedIsFailed()
    {
        var view = UpdateViewBuilder.Build(Facts(offer: Offer131, lastAttemptFailed: true));
        Assert.Equal(UpdateStates.Failed, view.State);
        Assert.Equal("0.1.131", view.Offered);
        Assert.Equal(34_000_000L, view.SizeBytes);
        Assert.Equal("0.1.131 didn't install.", UpdateWords.Status(view));
    }

    [Fact]
    public void FailedAttemptWithTheVerifiedFileIsStillFailed()
    {
        var view = UpdateViewBuilder.Build(Facts(offer: Offer131, downloaded: true, lastAttemptFailed: true));
        Assert.Equal(UpdateStates.Failed, view.State);
        Assert.Equal("0.1.131", view.Offered);
        Assert.Equal(34_000_000L, view.SizeBytes);
        Assert.Equal("0.1.131 didn't install.", UpdateWords.Status(view));
    }

    [Fact]
    public void OfferEqualToRunningIsUpToDate()
    {
        var sameOffer = new Offer(130, "0.1.130", "sha130", 34_000_000);
        var view = UpdateViewBuilder.Build(Facts(offer: sameOffer, lastCheck: LastCheckState.Ok));
        Assert.Equal(UpdateStates.UpToDate, view.State);
        Assert.Null(view.Offered);
        Assert.Null(view.SizeBytes);
        Assert.Equal("You're up to date", UpdateWords.Status(view));
    }

    [Fact]
    public void NoOfferAfterASuccessfulCheckIsUpToDate()
    {
        var view = UpdateViewBuilder.Build(Facts(lastCheck: LastCheckState.Ok));
        Assert.Equal(UpdateStates.UpToDate, view.State);
        Assert.Equal("0.1.130", view.Version);
        Assert.Null(view.Offered);
        Assert.Null(view.SizeBytes);
        Assert.Equal("You're up to date", UpdateWords.Status(view));
    }

    [Fact]
    public void UpdateNowFromNonParentModeIsRefused_AndFromParentModeSetsAsked()
    {
        Assert.Equal((false, false), UpdateControl.Request(UpdateRequestKind.Now, inParentMode: false, asked: false));
        Assert.Equal((true, true), UpdateControl.Request(UpdateRequestKind.Now, inParentMode: true, asked: false));
    }

    [Fact]
    public void CheckFromParentModeIsAllowedWithoutSettingAsked()
    {
        Assert.Equal((true, false), UpdateControl.Request(UpdateRequestKind.Check, inParentMode: true, asked: false));
        Assert.Equal((false, false), UpdateControl.Request(UpdateRequestKind.Check, inParentMode: false, asked: false));
    }
}
