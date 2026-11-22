namespace ScreenTime.Core.Service;

/// <summary>What the watchdog should do next (docs/SPEC.md §12.2 "Stall guard").</summary>
public enum StallVerdict { Ok, Log, Restart }

/// <summary>
/// Pure decision helper for the service watchdog. The caller passes the timestamp of the last finished
/// lock-loop pass, the current time, whether any kid session is using the PC, and whether this stall has
/// already been logged. <see cref="anyoneUsing"/> does not change the verdict; it only supplies words for
/// the log line via <see cref="Situation"/>.
/// </summary>
public static class StallWatch
{
    /// <summary>First log the stall after 30 s without a pass.</summary>
    public const int LogAfterMs = 30_000;

    /// <summary>Restart the service after 60 s without a pass.</summary>
    public const int RestartAfterMs = 60_000;

    /// <summary>
    /// Decide the next watchdog action. Log once per stall, not on repeats: after the caller has logged,
    /// it passes <paramref name="alreadyLogged"/> as <c>true</c> and the verdict stays <see cref="StallVerdict.Ok"/>
    /// until the stall ends or the restart threshold is reached.
    /// </summary>
    /// <param name="lastPassMs">Epoch milliseconds of the last finished lock-loop pass.</param>
    /// <param name="nowMs">Epoch milliseconds now.</param>
    /// <param name="anyoneUsing">Whether a kid session is currently unlocked on the PC.</param>
    /// <param name="alreadyLogged">Whether the caller has already logged for this stall.</param>
    public static StallVerdict Check(long lastPassMs, long nowMs, bool anyoneUsing, bool alreadyLogged)
    {
        var elapsed = nowMs - lastPassMs;
        if (elapsed < 0) elapsed = 0;

        if (elapsed >= RestartAfterMs) return StallVerdict.Restart;
        if (elapsed >= LogAfterMs && !alreadyLogged) return StallVerdict.Log;
        return StallVerdict.Ok;
    }

    /// <summary>Words for the log line that describe whether a kid is using the PC.</summary>
    /// <param name="anyoneUsing">Whether a kid session is currently unlocked on the PC.</param>
    public static string Situation(bool anyoneUsing)
    {
        return anyoneUsing ? "a kid is using the PC" : "nobody is using the PC";
    }
}
