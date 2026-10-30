using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;

namespace ScreenTime.Core.Service;

/// <summary>A Windows session change (docs/SPEC.md §12.2).</summary>
public enum SessionChange { Logon, Unlock, Lock, Logoff, Disconnect, Suspend, Shutdown }

/// <summary>
/// Turns Windows session changes into segments (docs/SPEC.md §12.2, Q19). One <see cref="Recorder"/> per SID, made
/// the first time it is needed. A SID is a kid account when <c>store.GetDevice(sid)</c> is not null; that is checked on
/// every call and never cached, so an account enrolled while the service runs works at once.
/// </summary>
public sealed class SessionTracker(LocalStore store, Func<string> newId)
{
    private readonly Dictionary<string, Recorder> _recorders = new();

    private Recorder RecorderFor(string sid)
    {
        if (!_recorders.TryGetValue(sid, out var recorder))
        {
            recorder = new Recorder(store, sid, newId);
            _recorders[sid] = recorder;
        }
        return recorder;
    }

    /// <summary>Handles a session change and returns the SIDs whose open segment it ended, so the caller syncs them now.</summary>
    public IReadOnlyList<string> OnChange(SessionChange change, string? sid, bool isConsole, long atMs)
    {
        switch (change)
        {
            case SessionChange.Logon:
            case SessionChange.Unlock:
                if (sid is not null && store.GetDevice(sid) is not null && isConsole)
                {
                    RecorderFor(sid).Start(atMs);
                }
                return [];
            case SessionChange.Lock:
            case SessionChange.Logoff:
            case SessionChange.Disconnect:
                if (sid is not null && store.GetDevice(sid) is not null && store.OpenSegment(sid) is not null)
                {
                    RecorderFor(sid).Stop(atMs);
                    return [sid];
                }
                return [];
            case SessionChange.Suspend:
            case SessionChange.Shutdown:
                var ended = new List<string>();
                foreach (var device in store.Devices())
                {
                    if (store.OpenSegment(device.Sid) is not null)
                    {
                        RecorderFor(device.Sid).Stop(atMs);
                        ended.Add(device.Sid);
                    }
                }
                return ended;
            default:
                return [];
        }
    }

    /// <summary>At service start: close what a crash left open, and start a segment for an unlocked kid console.</summary>
    public void OnServiceStart(string? consoleSid, bool consoleUnlocked, long atMs)
    {
        foreach (var device in store.Devices())
        {
            RecorderFor(device.Sid).CloseOpen();
        }
        if (consoleSid is not null && store.GetDevice(consoleSid) is not null && consoleUnlocked)
        {
            RecorderFor(consoleSid).Start(atMs);
        }
    }

    /// <summary>Still in use at <c>atMs</c>, for every enrolled account.</summary>
    public void Tick(long atMs)
    {
        foreach (var device in store.Devices())
        {
            RecorderFor(device.Sid).Tick(atMs);
        }
    }

    /// <summary>The server could not be reached: mark that account's open segments as recorded offline.</summary>
    public void MarkOffline(string sid)
    {
        if (store.GetDevice(sid) is not null)
        {
            RecorderFor(sid).MarkOffline();
        }
    }
}
