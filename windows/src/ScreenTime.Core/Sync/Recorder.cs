using ScreenTime.Core.Store;

namespace ScreenTime.Core.Sync;

/// <summary>
/// Turns "unlocked" and "screen off" into segments. Timestamps only, no ticking timers: <c>Tick</c> once a minute only
/// moves the last-seen time. Every call takes the trusted time from the caller and works only on the account's rows.
/// </summary>
public sealed class Recorder(LocalStore store, string sid, Func<string> newId)
{
    /// <summary>The kid unlocked the device: a new segment starts. One left open is closed where it was last seen.</summary>
    public void Start(long atMs)
    {
        CloseOpen();
        store.PutSegment(new LocalSegment(newId(), sid, atMs, null, atMs, false));
    }

    /// <summary>Still in use at <c>atMs</c>.</summary>
    public void Tick(long atMs)
    {
        var open = store.OpenSegment(sid);
        if (open is null) return;
        if (atMs > open.LastSeenAtMs) store.Touch(open.Id, atMs);
    }

    /// <summary>The screen went off (or the device locked): the open segment ends at <c>atMs</c>.</summary>
    public void Stop(long atMs)
    {
        var open = store.OpenSegment(sid);
        if (open is null) return;
        var end = Math.Max(atMs, open.StartedAtMs);
        store.PutSegment(open with { EndedAtMs = end, LastSeenAtMs = Math.Max(end, open.LastSeenAtMs) });
    }

    /// <summary>After a crash, a reboot or an app update: the open segment ends where it was last seen.</summary>
    public void CloseOpen()
    {
        var open = store.OpenSegment(sid);
        if (open is null) return;
        store.PutSegment(open with { EndedAtMs = open.LastSeenAtMs });
    }

    /// <summary>
    /// The server could not be reached: the open segment and every segment the server has not got yet count as recorded
    /// offline. That includes the one that ended at a screen off whose sync failed, even when the next unlock opened a new
    /// segment before the failure was known. A segment the server already has is left as it is. Once offline, always offline.
    /// </summary>
    public void MarkOffline()
    {
        var targets = new List<LocalSegment>();
        var open = store.OpenSegment(sid);
        if (open is not null) targets.Add(open);
        foreach (var p in store.PendingSegments(sid, int.MaxValue)) targets.Add(p.Segment);
        foreach (var segment in targets.DistinctBy(s => s.Id))
        {
            if (!segment.RecordedOffline) store.PutSegment(segment with { RecordedOffline = true });
        }
    }
}
