using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using ScreenTime.Core.Sites;

namespace ScreenTime.Service;

/// <summary>
/// Subscribes to the DNS Client's operational log (event 3008, docs/SPEC.md §12.10) and pushes the parsed lookups to
/// a channel. The push callback runs on a Windows thread pool thread: it only renders the XML, names the process and
/// hands the lookup on; the worker takes the lock, checks the account and parent mode and writes state.db.
/// The callback is an <c>UnmanagedCallersOnly</c> function (no delegate to keep alive under Native AOT); this
/// instance reaches it through a <see cref="GCHandle"/> passed as the subscription's context.
/// </summary>
internal sealed unsafe class DnsLogSubscriber : IDisposable
{
    private const uint EvtSubscribeActionDeliver = 1;
    private const uint EvtSubscribeToFutureEvents = 1;

    private readonly Action<DnsLookup, string> _push;
    private GCHandle _self;
    private nint _handle;

    public DnsLogSubscriber(Action<DnsLookup, string> push) => _push = push;

    // EVT_SUBSCRIBE_CALLBACK: DWORD (EVT_SUBSCRIBE_NOTIFY_ACTION Action, PVOID UserContext, EVT_HANDLE Event).
    // Action 0 (EvtSubscribeActionError) passes an error code in Event, not an event: nothing to render.
    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static uint OnEvent(uint action, nint userContext, nint hEvent)
    {
        if (action != EvtSubscribeActionDeliver || userContext == nint.Zero) return 0;
        try
        {
            if (GCHandle.FromIntPtr(userContext).Target is not DnsLogSubscriber self) return 0;
            var lookup = DnsEvents.Parse(Win.RenderEventXml(hEvent) ?? "");
            if (lookup is not null) self._push(lookup, Win.ProcessImageName(lookup.ProcessId));
        }
        catch
        {
            // A lookup that cannot be read is dropped, as one whose event is not 3008.
        }
        return 0;
    }

    /// <summary>
    /// Subscribes to future event 3008s on the DNS log. Returns 0 on success, else the Windows error code (the
    /// subscription is then not made).
    /// </summary>
    public int Subscribe()
    {
        if (_handle != nint.Zero) return 0;
        if (!_self.IsAllocated) _self = GCHandle.Alloc(this);
        _handle = Win.EvtSubscribe(
            nint.Zero,
            nint.Zero,
            Win.DnsChannel,
            "*[System[EventID=3008]]",
            nint.Zero,
            GCHandle.ToIntPtr(_self),
            &OnEvent,
            EvtSubscribeToFutureEvents);
        return _handle == nint.Zero ? Marshal.GetLastPInvokeError() : 0;
    }

    public void Dispose()
    {
        if (_handle != nint.Zero)
        {
            Win.EvtClose(_handle);
            _handle = nint.Zero;
        }
        if (_self.IsAllocated) _self.Free();
    }
}
