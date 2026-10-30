using System.Runtime.InteropServices;

namespace ScreenTime.Service;

/// <summary>
/// CARD-048: the Windows calls for the tray and the lock (docs/SPEC.md §12.2). Copied verbatim from the card. Only a
/// service running as LocalSystem may call <see cref="StartInSession"/>.
/// </summary>
internal static partial class Win
{
    // The structs are filled in by Windows or only partly by us, so some fields are never assigned in C#.
#pragma warning disable CS0649
    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        public int Cb;
        public nint Reserved;
        public nint Desktop;
        public nint Title;
        public int X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public short ShowWindow, CbReserved2;
        public nint Reserved2, StdInput, StdOutput, StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public nint Process;
        public nint Thread;
        public int ProcessId;
        public int ThreadId;
    }
#pragma warning restore CS0649

    private const uint MaximumAllowed = 0x02000000;
    private const int SecurityImpersonation = 2;
    private const int TokenPrimary = 1;
    private const uint CreateUnicodeEnvironment = 0x00000400;

    [LibraryImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool WTSQueryUserToken(uint sessionId, out nint token);

    [LibraryImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool DuplicateTokenEx(nint existing, uint desiredAccess, nint attributes, int impersonationLevel, int tokenType, out nint newToken);

    [LibraryImport("userenv.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CreateEnvironmentBlock(out nint environment, nint token, [MarshalAs(UnmanagedType.Bool)] bool inherit);

    [LibraryImport("userenv.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool DestroyEnvironmentBlock(nint environment);

    [LibraryImport("advapi32.dll", EntryPoint = "CreateProcessAsUserW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CreateProcessAsUser(nint token, nint applicationName, nint commandLine, nint processAttributes, nint threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, nint environment, nint currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CloseHandle(nint handle);

    [LibraryImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool WTSDisconnectSession(nint server, uint sessionId, [MarshalAs(UnmanagedType.Bool)] bool wait);

    /// <summary>Starts <c>exe</c> with <c>arguments</c> on the desktop of session <c>sessionId</c>, as that session's user. Returns the process id.</summary>
    internal static int StartInSession(uint sessionId, string exe, string arguments)
    {
        if (!WTSQueryUserToken(sessionId, out var userToken)) throw new InvalidOperationException($"WTSQueryUserToken failed: {Marshal.GetLastPInvokeError()}");
        nint primary = 0, environment = 0, desktop = 0, commandLine = 0;
        try
        {
            if (!DuplicateTokenEx(userToken, MaximumAllowed, 0, SecurityImpersonation, TokenPrimary, out primary)) throw new InvalidOperationException($"DuplicateTokenEx failed: {Marshal.GetLastPInvokeError()}");
            if (!CreateEnvironmentBlock(out environment, primary, inherit: false)) throw new InvalidOperationException($"CreateEnvironmentBlock failed: {Marshal.GetLastPInvokeError()}");
            desktop = Marshal.StringToHGlobalUni(@"winsta0\default");
            commandLine = Marshal.StringToHGlobalUni($"\"{exe}\" {arguments}");
            var startup = new StartupInfo { Cb = Marshal.SizeOf<StartupInfo>(), Desktop = desktop };
            if (!CreateProcessAsUser(primary, 0, commandLine, 0, 0, false, CreateUnicodeEnvironment, environment, 0, ref startup, out var info))
            {
                throw new InvalidOperationException($"CreateProcessAsUser failed: {Marshal.GetLastPInvokeError()}");
            }
            CloseHandle(info.Thread);
            CloseHandle(info.Process);
            return info.ProcessId;
        }
        finally
        {
            if (commandLine != 0) Marshal.FreeHGlobal(commandLine);
            if (desktop != 0) Marshal.FreeHGlobal(desktop);
            if (environment != 0) DestroyEnvironmentBlock(environment);
            if (primary != 0) CloseHandle(primary);
            CloseHandle(userToken);
        }
    }

    /// <summary>Disconnects session <c>sessionId</c>, which shows the lock screen and never signs the user out.</summary>
    internal static bool Disconnect(uint sessionId) => WTSDisconnectSession(0, sessionId, wait: false);
}
