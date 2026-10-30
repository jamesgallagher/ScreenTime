namespace ScreenTime.Core.Tray;

/// <summary>
/// The two warning toasts before a lock (docs/SPEC.md §16.3, Q7): the Windows twin of Android's <c>WarningTracker</c>.
/// One per kid session; the service calls <see cref="Check"/> every second while the session is in use.
/// </summary>
public sealed class WarningTracker
{
    private long _lastLeftSec = long.MaxValue;

    /// <summary>
    /// The warning to show now, or null: each shows once when the time left falls to its threshold, and it can show
    /// again when a parent adds time and the time left goes back above it.
    /// </summary>
    public string? Check(TrayStatus status)
    {
        var left = status.LockAtMs is null || status.Locked || status.ParentMode ? long.MaxValue : status.LeftSec;
        var before = _lastLeftSec;
        _lastLeftSec = left;
        if (left <= 0) return null;
        var warn1 = status.Warn1Min * 60L;
        var warn2 = status.Warn2Min * 60L;
        if (left <= warn2 && before > warn2) return $"{status.Warn2Min} {(status.Warn2Min == 1 ? "minute" : "minutes")} left. Save your work.";
        if (left <= warn1 && before > warn1) return $"{status.Warn1Min} minutes of {status.PoolName} left";
        return null;
    }
}
