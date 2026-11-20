namespace ScreenTime.Core.Sites;

/// <summary>A DNS lookup the service keeps for an account (docs/SPEC.md §12.10).</summary>
public sealed record SiteLookup(string Sid, long AtMs, string Host, string Program);

/// <summary>
/// Which DNS lookups the service keeps (docs/SPEC.md §12.10): failed queries, lookups by unenrolled accounts,
/// lookups in parent mode, our own programs and the repeats of a page (the same host, program and account within
/// 10 s of the last one kept) are dropped. One instance per service; the repeat window is its state.
/// </summary>
public sealed class SiteLookupFilter
{
    private readonly Dictionary<(string Sid, string Host, string Program), long> _lastKept = new();

    /// <summary>The kept lookup, or null.</summary>
    public SiteLookup? Decide(DnsLookup e, string program, bool enrolled, bool parentMode)
    {
        if (e.QueryStatus != 0) return null;
        if (!enrolled) return null;
        if (parentMode) return null;
        var host = SiteHosts.Normalize(e.QueryName);
        if (host is null) return null;
        if (program is "screentime.tray.exe" or "screentime.service.exe") return null;
        var key = (e.UserSid, host, program);
        // A repeat of a page, within 10 s of the last one kept, is dropped; a dropped repeat does not move the
        // window, so only a kept lookup updates it.
        if (_lastKept.TryGetValue(key, out var last) && e.AtMs - last < 10_000) return null;
        _lastKept[key] = e.AtMs;
        return new SiteLookup(e.UserSid, e.AtMs, host, program);
    }
}
