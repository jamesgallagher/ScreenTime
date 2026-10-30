using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32;
using System.Security.Cryptography;

namespace ScreenTime.Service;

/// <summary>
/// Every Windows call of the service, in one place: the P/Invoke (via <c>LibraryImport</c>, no reflection) and the
/// small helpers around it.
/// </summary>
internal static partial class Win
{
    [LibraryImport("kernel32.dll")]
    internal static partial uint WTSGetActiveConsoleSessionId();

    [LibraryImport("wtsapi32.dll", EntryPoint = "WTSQuerySessionInformationW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool WTSQuerySessionInformation(IntPtr server, uint sessionId, int infoClass, out IntPtr buffer, out uint bytes);

    [LibraryImport("wtsapi32.dll")]
    internal static partial void WTSFreeMemory(IntPtr memory);

    /// <summary>The Windows SID of the account signed in on a session, or null when it cannot be read.</summary>
    internal static string? SessionSid(uint sessionId)
    {
        try
        {
            var user = QueryString(sessionId, 5);
            if (string.IsNullOrEmpty(user)) return null;
            var domain = QueryString(sessionId, 7);
            return new NTAccount(domain, user).Translate(typeof(SecurityIdentifier)).Value;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Whether the account on a session is unlocked (screen on).</summary>
    internal static bool SessionUnlocked(uint sessionId)
    {
        try
        {
            if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, 25, out var buffer, out _))
            {
                return false;
            }
            try
            {
                return Marshal.ReadInt32(buffer, 16) == 1;
            }
            finally
            {
                WTSFreeMemory(buffer);
            }
        }
        catch
        {
            return false;
        }
    }

    /// <summary>The Windows SID of a user account name. Exceptions go up.</summary>
    internal static string AccountSid(string userName)
    {
        return new NTAccount(userName).Translate(typeof(SecurityIdentifier)).Value;
    }

    /// <summary>The boot counter, one higher on every boot; 0 when it is missing.</summary>
    internal static long BootId() =>
        ReadValue(@"SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters", "BootId") is int value
            ? (uint)value
            : 0;

    /// <summary>The PC's model, or "PC" when it is missing.</summary>
    internal static string Model() =>
        ReadValue(@"HARDWARE\DESCRIPTION\System\BIOS", "SystemProductName") is string model && !string.IsNullOrWhiteSpace(model)
            ? model.Trim()
            : "PC";

    /// <summary>The PC's machine GUID, or "unknown" when it is missing.</summary>
    internal static string MachineId() =>
        ReadValue(@"SOFTWARE\Microsoft\Cryptography", "MachineGuid") is string guid && !string.IsNullOrWhiteSpace(guid)
            ? guid
            : "unknown";

    /// <summary>One value under HKEY_LOCAL_MACHINE, or null when the key or value is missing.</summary>
    private static object? ReadValue(string subKey, string name)
    {
        using var key = Registry.LocalMachine.OpenSubKey(subKey);
        return key?.GetValue(name);
    }

    /// <summary>Protects a value with DPAPI for the local machine, so the service (SYSTEM) can read what enrol wrote.</summary>
    internal static byte[] Protect(byte[] plain) => ProtectedData.Protect(plain, null, DataProtectionScope.LocalMachine);

    /// <summary>Unprotects a value written by <see cref="Protect"/>.</summary>
    internal static byte[] Unprotect(byte[] data) => ProtectedData.Unprotect(data, null, DataProtectionScope.LocalMachine);

    /// <summary>The default data folder, under the common application data.</summary>
    internal static string DefaultDataFolder() => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ScreenTime");

    /// <summary>
    /// Creates the data folder if it is missing. When secure, it is created with full control, inherited by subfolders
    /// and files, only for LocalSystem and the builtin administrators.
    /// </summary>
    internal static void EnsureDataFolder(string folder, bool secure)
    {
        if (Directory.Exists(folder)) return;
        if (secure)
        {
            var security = new DirectorySecurity();
            // Not inheriting from ProgramData, and keeping none of its rules: only SYSTEM and Administrators.
            security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
            security.AddAccessRule(Rule(WellKnownSidType.LocalSystemSid));
            security.AddAccessRule(Rule(WellKnownSidType.BuiltinAdministratorsSid));
            new DirectoryInfo(folder).Create(security);
        }
        else
        {
            Directory.CreateDirectory(folder);
        }
    }

    /// <summary>Full control for a well-known account, inherited by subfolders and files.</summary>
    private static FileSystemAccessRule Rule(WellKnownSidType type) =>
        new(
            new SecurityIdentifier(type, domainSid: null),
            FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow);

    private static string QueryString(uint sessionId, int infoClass)
    {
        if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, infoClass, out var buffer, out _))
        {
            return "";
        }
        try
        {
            return Marshal.PtrToStringUni(buffer) ?? "";
        }
        finally
        {
            WTSFreeMemory(buffer);
        }
    }
}
