namespace ScreenTime.Core.Sync;

/// <summary>The server's time at one moment of one boot (docs/SPEC.md §8.5).</summary>
public sealed record ClockAnchor(long ServerMs, long ElapsedMs, long BootId);

/// <summary>Where <see cref="TrustedClock"/> keeps what it learnt, so it survives a restart of the app.</summary>
public interface IClockStore
{
    /// <summary>The anchor, or null before the server has answered in this boot.</summary>
    ClockAnchor? Anchor { get; set; }

    /// <summary>The latest trusted time handed out. After a reboot without the server, time never goes back before it.</summary>
    long LastTrustedMs { get; set; }
}

/// <summary>
/// Time the kid cannot change by changing the PC's clock (docs/SPEC.md §8.5). After the server has answered once in
/// this boot, it is the server's time plus the time since then on <c>elapsed</c>, the clock that counts from boot. After a
/// reboot without the server it is the PC's <c>wall</c> clock, but never earlier than the last trusted time.
/// </summary>
public sealed class TrustedClock(IClockStore store, Func<long> elapsed, Func<long> wall, Func<long> bootId)
{
    private readonly object _lock = new();

    /// <summary>True when the server has answered since this boot.</summary>
    public bool IsAnchored
    {
        get
        {
            lock (_lock)
            {
                return store.Anchor?.BootId == bootId();
            }
        }
    }

    /// <summary>The trusted time now, in epoch milliseconds.</summary>
    public long NowMs()
    {
        lock (_lock)
        {
            var anchor = store.Anchor;
            var now = anchor is { } a && a.BootId == bootId()
                ? a.ServerMs + (elapsed() - a.ElapsedMs)
                : Math.Max(wall(), store.LastTrustedMs);
            if (now > store.LastTrustedMs) store.LastTrustedMs = now;
            return now;
        }
    }

    /// <summary>The server said it is <c>serverMs</c> now. Its time wins over everything before, even if that was later.</summary>
    public void OnServerTime(long serverMs)
    {
        lock (_lock)
        {
            store.Anchor = new ClockAnchor(serverMs, elapsed(), bootId());
            store.LastTrustedMs = serverMs;
        }
    }
}
