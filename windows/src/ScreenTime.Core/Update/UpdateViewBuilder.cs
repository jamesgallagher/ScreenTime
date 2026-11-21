namespace ScreenTime.Core.Update;

/// <summary>What the last update check looks like from the tray's point of view.</summary>
public enum LastCheckState
{
    /// <summary>No check has completed yet.</summary>
    Never,
    /// <summary>A check is running right now.</summary>
    Running,
    /// <summary>The last check succeeded.</summary>
    Ok,
    /// <summary>The last check failed.</summary>
    Failed,
}

/// <summary>
/// The pure facts needed to build an <see cref="UpdateView"/>, without any Windows or service state.
/// </summary>
public sealed record UpdateViewFacts(
    string RunningVersionName,
    int RunningVersionCode,
    Offer? Offer,
    bool Downloaded,
    bool Downloading,
    PendingUpdate? Pending,
    bool LastAttemptFailed,
    LastCheckState LastCheck);

/// <summary>
/// Builds the tray's <see cref="UpdateView"/> from pure facts (docs/SPEC.md §12.11). The precedence of the nine
/// states matches the design in CARD-071.
/// </summary>
public static class UpdateViewBuilder
{
    public static UpdateView Build(UpdateViewFacts f)
    {
        if (f.Pending is { } pending)
        {
            return new UpdateView(f.RunningVersionName, UpdateStates.Installing, pending.VersionName, null);
        }

        if (f.LastCheck == LastCheckState.Running)
        {
            return new UpdateView(f.RunningVersionName, UpdateStates.Checking, null, null);
        }

        if (f.LastCheck == LastCheckState.Failed)
        {
            return new UpdateView(f.RunningVersionName, UpdateStates.CheckFailed, null, null);
        }

        if (f.Offer is not { } offer)
        {
            return new UpdateView(
                f.RunningVersionName,
                f.LastCheck == LastCheckState.Ok ? UpdateStates.UpToDate : UpdateStates.Unknown,
                null,
                null);
        }

        if (offer.VersionCode <= f.RunningVersionCode)
        {
            return new UpdateView(f.RunningVersionName, UpdateStates.UpToDate, null, null);
        }

        if (f.Downloading)
        {
            return new UpdateView(f.RunningVersionName, UpdateStates.Downloading, offer.VersionName, offer.SizeBytes);
        }

        if (f.Downloaded)
        {
            return new UpdateView(f.RunningVersionName, UpdateStates.Ready, offer.VersionName, offer.SizeBytes);
        }

        if (f.LastAttemptFailed)
        {
            return new UpdateView(f.RunningVersionName, UpdateStates.Failed, offer.VersionName, offer.SizeBytes);
        }

        return new UpdateView(f.RunningVersionName, UpdateStates.Available, offer.VersionName, offer.SizeBytes);
    }
}
