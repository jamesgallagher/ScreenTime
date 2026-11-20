using System.Globalization;

namespace ScreenTime.Core.Sites;

/// <summary>
/// The UTC instant the server's <c>at</c> field wants (docs/SPEC.md §12.10): milliseconds since the Unix epoch,
/// formatted as <c>yyyy-MM-ddTHH:mm:ss.fffZ</c> in UTC. It is a string in the upload bodies.
/// </summary>
public static class IsoUtc
{
    /// <summary>The milliseconds since the Unix epoch as a UTC ISO 8601 instant ending in <c>Z</c>.</summary>
    public static string ToIso(long atMs)
    {
        var instant = DateTimeOffset.FromUnixTimeMilliseconds(atMs).ToUniversalTime();
        return instant.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
    }
}
