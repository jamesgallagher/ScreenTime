namespace ScreenTime.Core.Service;

/// <summary>
/// What the PC is called in "‹account› on ‹PC›" (docs/SPEC.md §12.2): the computer's name from Settings › System ›
/// About, unless it is one Windows made up (DESKTOP-7GH3K2L); then the model, unless the maker left a placeholder
/// there (Conor's PC said "To Be Filled By O.E.M.", 13 Nov 2026); then "PC".
/// </summary>
public static class DeviceLabel
{
    private static readonly string[] Placeholders =
    [
        "to be filled by o.e.m.", "to be filled by oem", "system product name", "system version", "default string",
        "not applicable", "not specified", "none", "unknown", "all series", "type1productconfigid", "o.e.m.", "oem",
    ];

    /// <summary>The name for a PC with this computer name and BIOS model (either may be missing).</summary>
    public static string Pick(string? hostName, string? model)
    {
        var host = hostName?.Trim();
        if (!string.IsNullOrEmpty(host) && !MadeUp(host)) return host;
        var m = model?.Trim();
        if (!string.IsNullOrEmpty(m) && !IsPlaceholder(m)) return m;
        return string.IsNullOrEmpty(host) ? "PC" : host;
    }

    /// <summary>A model that says nothing: the maker's placeholder.</summary>
    public static bool IsPlaceholder(string model) => Placeholders.Contains(model.Trim().ToLowerInvariant());

    /// <summary>A name Windows gave the PC itself at setup: DESKTOP- or LAPTOP- and 7 letters and digits, or WIN-.</summary>
    private static bool MadeUp(string host) =>
        System.Text.RegularExpressions.Regex.IsMatch(host, "^(DESKTOP|LAPTOP)-[A-Z0-9]{7}$|^WIN-[A-Z0-9]{8,}$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
}
