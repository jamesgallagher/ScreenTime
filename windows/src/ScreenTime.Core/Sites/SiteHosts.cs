using System.Net;
using System.Text.RegularExpressions;

namespace ScreenTime.Core.Sites;

/// <summary>The website host of a lookup (docs/SPEC.md §12.10): lower case, one trailing dot taken off, not an IP
/// address, not a name of the machine's own network.</summary>
public static class SiteHosts
{
    // The server's host rule (docs/SPEC.md §12.10), at most 253 characters.
    private static readonly Regex HostRule = new(@"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$", RegexOptions.Compiled);

    /// <summary>A host the way the server wants it, or null when it is empty, has no dot, is an IP address, a name
    /// of the machine's own network (<c>.local</c>, <c>.lan</c>, <c>.home.arpa</c>, <c>.arpa</c>), or breaks the host
    /// rule.</summary>
    public static string? Normalize(string raw)
    {
        var host = raw.Trim().ToLowerInvariant();
        if (host.EndsWith('.')) host = host[..^1];
        if (host.Length == 0 || host.Length > 253) return null;
        if (!host.Contains('.')) return null;
        if (host.EndsWith(".local") || host.EndsWith(".lan") || host.EndsWith(".arpa")) return null;
        if (IPAddress.TryParse(host, out _)) return null;
        return HostRule.IsMatch(host) ? host : null;
    }
}
