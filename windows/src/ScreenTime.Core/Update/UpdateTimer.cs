namespace ScreenTime.Core.Update;

/// <summary>
/// The real timer the service uses for automatic update checks (docs/SPEC.md §12.2). A manual check never moves it,
/// and a check that reached nobody is not counted as a successful check.
/// </summary>
public sealed class UpdateTimer
{
    /// <summary>When the last successful automatic check happened, in ms since boot.</summary>
    public long? LastCheckMs { get; private set; }

    /// <summary>True when an automatic check is due: the first since start, or 6 hours after the last.</summary>
    public bool IsDue(long nowMs) => UpdateCheck.IsDue(LastCheckMs, nowMs);

    /// <summary>
    /// Records the result of a check. Only an answered, non-manual check moves the timer; a manual or unanswered
    /// check leaves it where it was.
    /// </summary>
    public void AfterCheck(long nowMs, bool manual, bool answered)
    {
        if (!answered || manual) return;
        LastCheckMs = nowMs;
    }

    /// <summary>Clears the timer, so the next check is due immediately.</summary>
    public void Reset() => LastCheckMs = null;
}
