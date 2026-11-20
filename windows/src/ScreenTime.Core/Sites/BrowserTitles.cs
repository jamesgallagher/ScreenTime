using System.Text;

namespace ScreenTime.Core.Sites;

/// <summary>
/// The four browsers the kids use (docs/SPEC.md §12.10): only their windows' titles are read, and a window title
/// is cleaned before it is stored.
/// </summary>
public static class BrowserTitles
{
    /// <summary>Whether the program is one of the four browsers, in any case.</summary>
    public static bool IsBrowser(string programId)
    {
        var id = programId.ToLowerInvariant();
        return id is "msedge.exe" or "chrome.exe" or "brave.exe" or "firefox.exe";
    }

    /// <summary>
    /// A window title with every U+200B, U+200C, U+200D, U+FEFF and control character removed, trimmed, cut to
    /// 300 characters and trimmed again; null when it is empty.
    /// </summary>
    public static string? Clean(string? raw)
    {
        if (raw is null) return null;
        var clean = new StringBuilder(raw.Length);
        foreach (var c in raw)
        {
            if (c is '\u200B' or '\u200C' or '\u200D' or '\uFEFF') continue;
            if (char.IsControl(c)) continue;
            clean.Append(c);
        }
        var title = clean.ToString().Trim();
        if (title.Length > 300) title = title[..300];
        title = title.Trim();
        return title.Length == 0 ? null : title;
    }
}
