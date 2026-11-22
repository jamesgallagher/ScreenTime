namespace ScreenTime.Core.Service;

/// <summary>
/// When the lock loop's no-lock ("degraded") pass may disconnect an out-of-time session again (CARD-073). One
/// disconnect is not enough: if the kid unlocks again while the same stall lasts, they must be locked again, so the
/// pass repeats every 10 s per session, the same gap the lock's own retries use (docs/SPEC.md §12.2).
/// </summary>
public static class DegradedLock
{
    /// <summary>How long after a degraded disconnect the same session may be disconnected again.</summary>
    public const int RepeatMs = 10_000;

    /// <summary>
    /// True when a session may be disconnected by the degraded pass now: never disconnected yet
    /// (<paramref name="lastDisconnectMs"/> null, which is also what a normal pass leaves behind), or at least
    /// <see cref="RepeatMs"/> after the last one.
    /// </summary>
    public static bool Due(long? lastDisconnectMs, long nowMs)
    {
        return lastDisconnectMs is not { } last || nowMs - last >= RepeatMs;
    }
}
