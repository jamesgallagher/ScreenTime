namespace ScreenTime.Core.Update;

/// <summary>What the PC does about a parent's remote "Update now" (docs/SPEC.md §12.11).</summary>
public static class RemoteUpdate
{
    /// <summary>
    /// The request should be acted on when it is for a version above the running one and its requestedAt is not the
    /// one this PC already acted on. Acting sets Asked, so CARD-061 installs even while a kid session is in use and
    /// even after three failures. A null request (nothing asked) changes nothing.
    /// </summary>
    public static (bool Act, bool Asked) Decide(int? versionCode, string? requestedAt, int runningVersionCode, string? handledAt, bool asked)
    {
        if (versionCode is not { } code || requestedAt is null) return (false, asked);
        if (code <= runningVersionCode) return (false, asked);
        if (handledAt == requestedAt) return (false, asked);
        return (true, true);
    }
}
