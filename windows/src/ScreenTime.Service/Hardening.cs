using System.Runtime.InteropServices;
using System.Security.Principal;

namespace ScreenTime.Service;

/// <summary>
/// Hardening at install (docs/SPEC.md Â§12.2): kids must not change the PC's time zone. Windows gives the "Change the
/// time zone" right (<c>SeTimeZonePrivilege</c>) to the Users group, so it is taken from Users; parents keep it as
/// Administrators. Needs administrator rights (the installer runs it). Uninstalling gives it back.
/// </summary>
internal static unsafe partial class Hardening
{
    private const string TimeZoneRight = "SeTimeZonePrivilege";
    private const uint PolicyLookupNames = 0x00000800, PolicyCreateAccount = 0x00000010;
    private const uint StatusObjectNameNotFound = 0xC0000034;

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaUnicodeString
    {
        public ushort Length;
        public ushort MaximumLength;
        public nint Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaObjectAttributes
    {
        public uint Length;
        public nint RootDirectory;
        public nint ObjectName;
        public uint Attributes;
        public nint SecurityDescriptor;
        public nint SecurityQualityOfService;
    }

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaOpenPolicy(nint systemName, LsaObjectAttributes* attributes, uint access, out nint handle);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaRemoveAccountRights(nint handle, byte* sid, [MarshalAs(UnmanagedType.U1)] bool allRights, LsaUnicodeString* rights, uint count);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaAddAccountRights(nint handle, byte* sid, LsaUnicodeString* rights, uint count);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaEnumerateAccountRights(nint handle, byte* sid, out LsaUnicodeString* rights, out uint count);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaFreeMemory(void* buffer);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaClose(nint handle);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaNtStatusToWinError(uint status);

    /// <summary>Takes the time zone right from the Users group. Throws when Windows says no (for example, not elevated).</summary>
    public static void TakeTimeZoneRight() => WithUsers((policy, sid) =>
    {
        var status = Change(policy, sid, add: false);
        if (status != 0 && status != StatusObjectNameNotFound) Fail("LsaRemoveAccountRights", status);
    });

    /// <summary>Gives the time zone right back to the Users group (uninstall).</summary>
    public static void GiveTimeZoneRight() => WithUsers((policy, sid) =>
    {
        var status = Change(policy, sid, add: true);
        if (status != 0) Fail("LsaAddAccountRights", status);
    });

    /// <summary>Whether the Users group holds the time zone right now.</summary>
    public static bool UsersHaveTimeZoneRight()
    {
        var held = false;
        WithUsers((policy, sid) =>
        {
            var status = LsaEnumerateAccountRights(policy, sid, out var rights, out var count);
            if (status == StatusObjectNameNotFound) return;
            if (status != 0) Fail("LsaEnumerateAccountRights", status);
            try
            {
                for (var i = 0; i < count; i++)
                {
                    var name = new string((char*)rights[i].Buffer, 0, rights[i].Length / 2);
                    if (name == TimeZoneRight) held = true;
                }
            }
            finally
            {
                LsaFreeMemory(rights);
            }
        });
        return held;
    }

    private static uint Change(nint policy, byte* sid, bool add)
    {
        var text = Marshal.StringToHGlobalUni(TimeZoneRight);
        try
        {
            var right = new LsaUnicodeString { Length = (ushort)(TimeZoneRight.Length * 2), MaximumLength = (ushort)(TimeZoneRight.Length * 2 + 2), Buffer = text };
            return add ? LsaAddAccountRights(policy, sid, &right, 1) : LsaRemoveAccountRights(policy, sid, false, &right, 1);
        }
        finally
        {
            Marshal.FreeHGlobal(text);
        }
    }

    private delegate void PolicyAction(nint policy, byte* sid);

    private static void WithUsers(PolicyAction action)
    {
        var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
        var sid = new byte[users.BinaryLength];
        users.GetBinaryForm(sid, 0);
        var attributes = new LsaObjectAttributes { Length = (uint)sizeof(LsaObjectAttributes) };
        var status = LsaOpenPolicy(0, &attributes, PolicyLookupNames | PolicyCreateAccount, out var policy);
        if (status != 0) Fail("LsaOpenPolicy", status);
        try
        {
            fixed (byte* p = sid) action(policy, p);
        }
        finally
        {
            LsaClose(policy);
        }
    }

    private static void Fail(string call, uint status) =>
        throw new InvalidOperationException($"{call} failed: Windows error {LsaNtStatusToWinError(status)}");
}
