using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
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

    /// <summary>What the PC is called in "‹account› on ‹PC›" (<see cref="ScreenTime.Core.Service.DeviceLabel"/>).</summary>
    internal static string DeviceLabel() =>
        ScreenTime.Core.Service.DeviceLabel.Pick(HostName(), ReadValue(@"HARDWARE\DESCRIPTION\System\BIOS", "SystemProductName") as string);

    /// <summary>This build's version as the MSI has it (0.1.‹CI run›), and the run number as the version code.</summary>
    internal static (int Code, string Name) AppVersion()
    {
        var v = typeof(Win).Assembly.GetName().Version ?? new Version(0, 1, 0);
        return (Math.Max(1, v.Build), $"{v.Major}.{v.Minor}.{Math.Max(0, v.Build)}");
    }

    /// <summary>The computer's name as it was typed (not the upper-case NetBIOS name), or null.</summary>
    private static string? HostName()
    {
        try
        {
            return System.Net.Dns.GetHostName();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Whether a session exists and is connected (WTSActive), locked or not. False once it signs out.</summary>
    internal static bool SessionActive(uint sessionId)
    {
        try
        {
            if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, 8, out var buffer, out _)) return false;
            try
            {
                return Marshal.ReadInt32(buffer) == 0;
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

    // The DNS Client's operational log (docs/SPEC.md §12.10): the lookups, with the account and the process, are
    // read by a subscription; the log is turned on at service start.
    internal const string DnsChannel = "Microsoft-Windows-DNS-Client/Operational";

    [LibraryImport("kernel32.dll", SetLastError = true)]
    internal static partial nint OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint pid);

    [LibraryImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool QueryFullProcessImageName(nint process, uint flags, nint name, ref uint size);

    /// <summary>The program id (file name) of a process, or "unknown" when it is gone or cannot be opened
    /// (docs/SPEC.md §12.10).</summary>
    internal static string ProcessImageName(uint pid)
    {
        try
        {
            var handle = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
            if (handle == nint.Zero) return "unknown";
            unsafe
            {
                try
                {
                    var buf = (char*)Marshal.AllocHGlobal(1024 * sizeof(char));
                    try
                    {
                        var size = (uint)1024;
                        if (!QueryFullProcessImageName(handle, 0, (nint)buf, ref size)) return "unknown";
                        var path = new string(buf, 0, (int)size);
                        return ScreenTime.Core.Programs.ProgramNames.Id(path);
                    }
                    finally
                    {
                        Marshal.FreeHGlobal((nint)buf);
                    }
                }
                finally
                {
                    CloseHandle(handle);
                }
            }
        }
        catch
        {
            return "unknown";
        }
    }

    /// <summary>Turns on the DNS Client's operational log (docs/SPEC.md §12.10). True when wevtutil's exit code is 0.</summary>
    internal static bool EnableDnsLog()
    {
        try
        {
            var systemDir = ReadValue(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "SystemDirectory") as string;
            var wevtutil = systemDir is not null ? Path.Combine(systemDir, "wevtutil.exe") : @"C:\Windows\System32\wevtutil.exe";
            var psi = new ProcessStartInfo(wevtutil, "sl " + DnsChannel + " /e:true")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var p = Process.Start(psi);
            if (p is null) return false;
            p.WaitForExit();
            return p.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }


    /// <summary>wevtapi!EvtSubscribe, the real 8-parameter signature. Returns a subscription handle (0 on
    /// failure, with the error in GetLastError). Flags 1 is EvtSubscribeToFutureEvents (2 start at the oldest
    /// record, 3 start after a bookmark).</summary>
    [LibraryImport("wevtapi.dll", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
    internal static unsafe partial nint EvtSubscribe(nint session, nint signalEvent, string channelPath, string query, nint bookmark, nint context, delegate* unmanaged[Stdcall]<uint, nint, nint, uint> callback, uint flags);

    [LibraryImport("wevtapi.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool EvtClose(nint handle);

    [LibraryImport("wevtapi.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool EvtRender(nint context, nint fragment, uint flags, int bufferSize, nint buffer, out int bufferUsed, out int propertyCount);

    /// <summary>The event's XML (an event 3008), or null when it cannot be rendered (docs/SPEC.md §12.10).</summary>
    internal static string? RenderEventXml(nint hEvent)
    {
        // EvtRender(Context, Fragment, Flags, BufferSize, Buffer, BufferUsed, PropertyCount): the first call with no
        // buffer fails with ERROR_INSUFFICIENT_BUFFER and gives the size in BYTES; the XML is a UTF-16 string with
        // its terminating null. Flags 1 is EvtRenderEventXml (0 values, 2 bookmark).
        const uint EvtRenderEventXml = 1;
        try
        {
            EvtRender(nint.Zero, hEvent, EvtRenderEventXml, 0, nint.Zero, out var needed, out _);
            if (needed <= 0) return null;
            var buffer = Marshal.AllocHGlobal(needed);
            try
            {
                if (!EvtRender(nint.Zero, hEvent, EvtRenderEventXml, needed, buffer, out var used, out _)) return null;
                return Marshal.PtrToStringUni(buffer, Math.Max(0, used / 2 - 1));
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        catch
        {
            return null;
        }
    }
}
