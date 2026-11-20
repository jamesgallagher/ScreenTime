using Microsoft.Win32;
using System.Runtime.InteropServices;

namespace ScreenTime.Core.Sites;

public enum BrowserPolicyKind
{
    String,
    Dword,
}

/// <summary>One value of a browser policy (docs/SPEC.md §12.10).</summary>
public sealed record BrowserPolicyValue(string KeyPath, string Name, BrowserPolicyKind Kind, string? Text, int? Dword)
{
    /// <summary>The value as it is written to the registry.</summary>
    public string Value => Kind == BrowserPolicyKind.String ? Text ?? "" : (Dword ?? 0).ToString();

    /// <summary>The path as passed to <c>Registry.LocalMachine</c> (relative to the hive): <see cref="KeyPath"/>
    /// without its <c>HKLM\</c> prefix, so it never creates a key literally named "HKLM" under HKLM.</summary>
    public string RegistryPath => BrowserPolicies.RelativePath(KeyPath);
}

/// <summary>
/// The four browsers' policies, written by the service at every start and removed by <c>unharden</c>
/// (docs/SPEC.md §12.10): the browsers use Windows' own DNS client, never DNS over HTTPS, and take no extensions.
/// </summary>
public static class BrowserPolicies
{
    private const string Edge = @"HKLM\SOFTWARE\Policies\Microsoft\Edge";
    private const string Chrome = @"HKLM\SOFTWARE\Policies\Google\Chrome";
    private const string Brave = @"HKLM\SOFTWARE\Policies\BraveSoftware\Brave";
    private const string Firefox = @"HKLM\SOFTWARE\Policies\Mozilla\Firefox";

    /// <summary>A policy path relative to <c>Registry.LocalMachine</c>: the full <c>HKLM\</c> path with the
    /// prefix stripped. Passing the full path would create a key literally named "HKLM" under HKLM, not the
    /// intended subkey.</summary>
    public static string RelativePath(string fullPath) =>
        fullPath.StartsWith("HKLM\\", StringComparison.OrdinalIgnoreCase) ? fullPath[5..] : fullPath;

    /// <summary>The 13 values of SPEC §12.10 "Browser policies".</summary>
    public static readonly IReadOnlyList<BrowserPolicyValue> All =
    [
        new(Edge, "DnsOverHttpsMode", BrowserPolicyKind.String, "off", null),
        new(Edge, "BuiltInDnsClientEnabled", BrowserPolicyKind.Dword, null, 0),
        new(Edge + @"\ExtensionInstallBlocklist", "1", BrowserPolicyKind.String, "*", null),
        new(Chrome, "DnsOverHttpsMode", BrowserPolicyKind.String, "off", null),
        new(Chrome, "BuiltInDnsClientEnabled", BrowserPolicyKind.Dword, null, 0),
        new(Chrome + @"\ExtensionInstallBlocklist", "1", BrowserPolicyKind.String, "*", null),
        new(Brave, "DnsOverHttpsMode", BrowserPolicyKind.String, "off", null),
        new(Brave, "BuiltInDnsClientEnabled", BrowserPolicyKind.Dword, null, 0),
        new(Brave + @"\ExtensionInstallBlocklist", "1", BrowserPolicyKind.String, "*", null),
        new(Brave, "TorDisabled", BrowserPolicyKind.Dword, null, 1),
        new(Firefox + @"\DNSOverHTTPS", "Enabled", BrowserPolicyKind.Dword, null, 0),
        new(Firefox + @"\DNSOverHTTPS", "Locked", BrowserPolicyKind.Dword, null, 1),
        new(Firefox, "ExtensionSettings", BrowserPolicyKind.String, """{"*":{"installation_mode":"blocked"}}""", null),
    ];

    /// <summary>Writes every value; returns the ones that could not be written, each with the error it raised
    /// (the service names them in its log).</summary>
    public static IReadOnlyList<(BrowserPolicyValue Value, string Error)> WriteAll()
    {
        if (!OperatingSystem.IsWindows()) return [];
        var failed = new List<(BrowserPolicyValue, string)>();
        foreach (var value in All)
        {
            try
            {
                using var key = Registry.LocalMachine.CreateSubKey(value.RegistryPath);
                if (value.Kind == BrowserPolicyKind.String) key.SetValue(value.Name, value.Text!, RegistryValueKind.String);
                else key.SetValue(value.Name, value.Dword!, RegistryValueKind.DWord);
            }
            catch (Exception e)
            {
                failed.Add((value, $"{e.GetType().Name}: {e.Message}"));
            }
        }
        return failed;
    }

    /// <summary>
    /// Removes every value this card writes (and the <c>ExtensionInstallBlocklist</c> and <c>DNSOverHTTPS</c> subkeys
    /// when they are then empty); other values a parent set stay. Returns how many values were removed.
    /// </summary>
    public static int RemoveAll()
    {
        if (!OperatingSystem.IsWindows()) return 0;
        var removed = 0;
        foreach (var value in All)
        {
            try
            {
                // Read-write: DeleteValue on a key opened read-only throws, and the catch would hide it.
                using var key = Registry.LocalMachine.OpenSubKey(value.RegistryPath, true);
                if (key is null) continue;
                if (key.GetValue(value.Name) is not null)
                {
                    key.DeleteValue(value.Name);
                    removed++;
                }
            }
            catch
            {
                // A value that cannot be removed is still named by harden-check.
            }
        }
        RemoveSubkeyIfEmpty(@"HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallBlocklist");
        RemoveSubkeyIfEmpty(@"HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist");
        RemoveSubkeyIfEmpty(@"HKLM\SOFTWARE\Policies\BraveSoftware\Brave\ExtensionInstallBlocklist");
        RemoveSubkeyIfEmpty(@"HKLM\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS");
        return removed;
    }

    /// <summary>The values not set now, as "key path name" (for harden-check).</summary>
    public static IReadOnlyList<string> Missing()
    {
        if (!OperatingSystem.IsWindows()) return All.Select(v => $"{v.KeyPath} {v.Name}").ToList();
        var missing = new List<string>();
        foreach (var value in All)
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(value.RegistryPath);
                if (key?.GetValue(value.Name) is null) missing.Add($"{value.KeyPath} {value.Name}");
            }
            catch
            {
                missing.Add($"{value.KeyPath} {value.Name}");
            }
        }
        return missing;
    }

    private static void RemoveSubkeyIfEmpty(string fullPath)
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            var path = RelativePath(fullPath);
            // Read-write: DeleteSubKey on a key opened read-only throws, and the catch would hide it.
            using var parent = Registry.LocalMachine.OpenSubKey(Path.GetDirectoryName(path) ?? "", true);
            var name = Path.GetFileName(path);
            if (parent is null) return;
            using var subkey = parent.OpenSubKey(name);
            if (subkey is not null && subkey.GetValueNames().Length == 0) parent.DeleteSubKey(name);
        }
        catch
        {
        }
    }
}
