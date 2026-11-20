using System.Threading.Channels;
using ScreenTime.Core.Sites;

namespace ScreenTime.Service;

/// <summary>
/// Subscribes to the DNS Client's operational log (event 3008, docs/SPEC.md §12.10) and pushes the parsed lookups to
/// a channel. The push callback runs on a Windows thread pool thread: it only renders the XML and hands the lookup to
/// the channel; the worker takes the lock, checks the account and parent mode and writes state.db. The callback
/// delegate is kept in a field: the subscription holds only a native pointer to it, so a local could be collected.
/// </summary>
internal sealed class DnsLogSubscriber : IDisposable
{
    private readonly Win.EvtRecordHandler _handler;
    private readonly Action<DnsLookup, string> _push;
    private nint _handle;

    public DnsLogSubscriber(Action<DnsLookup, string> push)
    {
        _push = push;
        _handler = Handler;
    }

    private int Handler(nint pEventRecord, nint eventContext, nint evtCallbackContext)
    {
        try
        {
            var lookup = DnsEvents.Parse(Win.RenderEventXml(pEventRecord) ?? "");
            if (lookup is not null) _push(lookup, Win.ProcessImageName(lookup.ProcessId));
        }
        catch
        {
            // A lookup that cannot be read is dropped, as one whose event is not 3008.
        }
        return 0;
    }

    /// <summary>Subscribes to future event 3008s on the DNS log. Returns the subscription handle.</summary>
    public nint Subscribe()
    {
        _handle = Win.EvtSubscribe(
            nint.Zero,
            Win.DnsChannel,
            "*[System[EventID=3008]]",
            nint.Zero,
            _handler,
            4 /* EvtSubscribeToFutureEvents */,
            nint.Zero);
        return _handle;
    }

    public void Dispose()
    {
        if (_handle != nint.Zero)
        {
            Win.EvtClose(_handle);
            _handle = nint.Zero;
        }
    }
}
