# CARD-047b: Windows: the service, enrolment and sync

| Field | Value |
|---|---|
| Card | CARD-047b |
| Title | Windows: the service, enrolment and sync |
| Size | M |
| Depends on | CARD-047 merged to `main` |
| Spec sections | docs/SPEC.md §8.3 (when devices sync), §8.5 (trusted time), §11.2 and §11.3 (device token, enrolment), §12.2 (Windows) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-047b-service` |
| PR title | `CARD-047b: Windows: the service, enrolment and sync` |

## 1. Project context

Read `AGENTS.md` first. Rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command and every run step** and lists every workaround.

`ScreenTime.Core` now has the time engine (CARD-045), the API client (046), the SQLite store (046b), and the recorder, trusted clock and syncer (047). This card makes `ScreenTime.Service` use them:
- **Enrolment**: a command-line `enrol` command enrols one kid Windows account.
- **Session tracking**: unlock and lock of a kid account on the PC's screen become usage segments.
- **Sync**: every 60 s, and after every lock, the service uploads usage and fetches the state.

Locking the PC is **not** in this card (CARD-048).

The work has two halves:
1. **`ScreenTime.Core.Service`** (section 6.1 to 6.3): plain C# with no Windows calls, tested by the three test files in section 5.
2. **`ScreenTime.Service`** (section 6.4 to 6.8): the Windows parts, such as session events, DPAPI and the registry. CI only builds them, so section 8.3 has a **real run** on James's PC against the local server. That run uses a temp folder and needs **no admin rights**, and it does **not** install the service.

You **copy** the three test files in section 5 exactly, and **write** everything in section 6. The tests are the contract; never change them.

## 2. Goal

- `dotnet build` and `dotnet test` pass in `windows/`, including the 21 new tests. CI **Windows / build and test** is green.
- The run in 8.3 enrols James's own Windows account as the dev kid **Sam** against the local server, syncs, and uploads a 2-minute demo segment that shows up in the database.

## 3. Out of scope

- Locking the PC, the tray, the named pipe and the WebSocket (CARD-048). Tamper events (CARD-051). The installer and installing the service (CARD-052).
- No change to `LocalStore`, `Recorder`, `TrustedClock`, `Syncer`, `TodayInput`, the generated API files, the test csproj, any workflow, or the server.
- **Do not install or start the Windows service** on James's PC (`sc.exe create` and `New-Service` are not allowed). The run in 8.3 uses the commands from 6.8 only.

## 4. Tech

- .NET 10, nullable on, warnings are errors. `ScreenTime.Core` is `IsAotCompatible`, and `ScreenTime.Service` has `PublishAot`. So use no reflection: JSON goes through source-generated contexts only, and P/Invoke uses `[LibraryImport]`, not `[DllImport]`.
- New package, in `ScreenTime.Service` only: `System.Security.Cryptography.ProtectedData` **10.0.13** (DPAPI).
- `ScreenTime.Service` gets `<AllowUnsafeBlocks>true</AllowUnsafeBlocks>`, because `LibraryImport` needs it.
- `NTAccount`, `SecurityIdentifier`, `Microsoft.Win32.Registry`, `DirectorySecurity` and `System.ServiceProcess` are already in `net10.0-windows` and `Microsoft.Extensions.Hosting.WindowsServices`.

## 5. Files to copy

Copy all three exactly into `windows/tests/ScreenTime.Core.Tests/`. They use `SyncTestData` from CARD-047. Check them with the fingerprint command in 8.1, **once**.

### 5.1 `windows/tests/ScreenTime.Core.Tests/SessionTrackerTests.cs`

```csharp
using ScreenTime.Core.Service;
using ScreenTime.Core.Store;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047b: Windows session changes become segments (docs/SPEC.md §12.2, Q19). Copied verbatim from the card.</summary>
public sealed class SessionTrackerTests : IDisposable
{
    private const string Sam = "S-1-5-21-1-1002";
    private const string Dad = "S-1-5-21-1-500";

    private readonly string _path = NewDbPath();
    private readonly LocalStore _store;
    private readonly SessionTracker _tracker;
    private int _next;

    public SessionTrackerTests()
    {
        _store = LocalStore.Open(_path);
        // Alex and Sam are enrolled kid accounts; Dad's admin account is not.
        _store.PutDevice(new StoredDevice(Alex, "d-alex", [1], "Alex", "Australia/Sydney"));
        _store.PutDevice(new StoredDevice(Sam, "d-sam", [2], "Sam", "Australia/Sydney"));
        _tracker = new SessionTracker(_store, () => "s" + ++_next);
    }

    public void Dispose()
    {
        _store.Dispose();
        Delete(_path);
    }

    [Fact]
    public void UnlockOnTheConsoleStartsAndLockEndsAndAsksForASync()
    {
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, Alex, isConsole: true, atMs: 1_000));
        Assert.Equal("s1", _store.OpenSegment(Alex)!.Id);

        Assert.Equal(new[] { Alex }, _tracker.OnChange(SessionChange.Lock, Alex, isConsole: true, atMs: 61_000));
        Assert.Null(_store.OpenSegment(Alex));
        Assert.Equal(61_000, Assert.Single(_store.SegmentsSince(Alex, 0)).EndedAtMs);
    }

    [Fact]
    public void LogonCountsLikeUnlockAndLogoffAndDisconnectEnd()
    {
        _tracker.OnChange(SessionChange.Logon, Alex, isConsole: true, atMs: 1_000);
        Assert.Equal(new[] { Alex }, _tracker.OnChange(SessionChange.Logoff, Alex, isConsole: true, atMs: 2_000));

        _tracker.OnChange(SessionChange.Logon, Alex, isConsole: true, atMs: 3_000);
        Assert.Equal(new[] { Alex }, _tracker.OnChange(SessionChange.Disconnect, Alex, isConsole: false, atMs: 4_000));

        Assert.Equal(new long?[] { 2_000, 4_000 }, _store.SegmentsSince(Alex, 0).Select(s => s.EndedAtMs));
    }

    [Fact]
    public void ARemoteSessionOrAnAccountThatIsNotEnrolledIsNotCounted()
    {
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, Alex, isConsole: false, atMs: 1_000));
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, Dad, isConsole: true, atMs: 1_000));
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, null, isConsole: true, atMs: 1_000));
        Assert.Empty(_tracker.OnChange(SessionChange.Lock, Dad, isConsole: true, atMs: 2_000));

        Assert.Null(_store.OpenSegment(Alex));
        Assert.Empty(_store.SegmentsSince(Dad, 0));
    }

    [Fact]
    public void AnEndWithNothingOpenAsksForNothing()
    {
        Assert.Empty(_tracker.OnChange(SessionChange.Lock, Alex, isConsole: true, atMs: 1_000));
        Assert.Empty(_store.SegmentsSince(Alex, 0));
    }

    [Fact]
    public void SleepAndShutdownEndEveryOpenSegment()
    {
        // Fast user switching: Alex is still signed in (and counting, in a broken case) when Sam unlocks.
        _tracker.OnChange(SessionChange.Unlock, Alex, isConsole: true, atMs: 1_000);
        _tracker.OnChange(SessionChange.Unlock, Sam, isConsole: true, atMs: 2_000);

        var ended = _tracker.OnChange(SessionChange.Suspend, null, isConsole: false, atMs: 9_000);

        Assert.Equal(new[] { Alex, Sam }, ended.Order(StringComparer.Ordinal));
        Assert.Null(_store.OpenSegment(Alex));
        Assert.Null(_store.OpenSegment(Sam));
        Assert.Empty(_tracker.OnChange(SessionChange.Shutdown, null, isConsole: false, atMs: 10_000));
    }

    [Fact]
    public void StartingTheServiceClosesWhatWasLeftOpenAndCountsAnUnlockedConsole()
    {
        _store.PutSegment(new LocalSegment("old", Alex, 1_000, null, 30_000, false));

        _tracker.OnServiceStart(consoleSid: Alex, consoleUnlocked: true, atMs: 100_000);

        var all = _store.SegmentsSince(Alex, 0);
        Assert.Equal(30_000, all[0].EndedAtMs);
        Assert.Equal("s1", all[1].Id);
        Assert.Equal(100_000, all[1].StartedAtMs);
        Assert.Null(all[1].EndedAtMs);
    }

    [Fact]
    public void StartingWithALockedConsoleOrNoKidStartsNothing()
    {
        _tracker.OnServiceStart(consoleSid: Alex, consoleUnlocked: false, atMs: 100_000);
        _tracker.OnServiceStart(consoleSid: Dad, consoleUnlocked: true, atMs: 100_000);
        _tracker.OnServiceStart(consoleSid: null, consoleUnlocked: true, atMs: 100_000);

        Assert.Null(_store.OpenSegment(Alex));
        Assert.Empty(_store.SegmentsSince(Dad, 0));
    }

    [Fact]
    public void TickAndMarkOfflineReachTheRightAccount()
    {
        _tracker.OnChange(SessionChange.Unlock, Alex, isConsole: true, atMs: 1_000);

        _tracker.Tick(61_000);
        _tracker.MarkOffline(Alex);
        _tracker.MarkOffline(Sam);

        var open = _store.OpenSegment(Alex)!;
        Assert.Equal(61_000, open.LastSeenAtMs);
        Assert.True(open.RecordedOffline);
        Assert.Empty(_store.SegmentsSince(Sam, 0));
    }

    [Fact]
    public void ADeviceEnrolledLaterIsPickedUp()
    {
        const string Kim = "S-1-5-21-1-1003";
        Assert.Empty(_tracker.OnChange(SessionChange.Unlock, Kim, isConsole: true, atMs: 1_000));

        _store.PutDevice(new StoredDevice(Kim, "d-kim", [3], "Kim", "Australia/Sydney"));
        _tracker.OnChange(SessionChange.Unlock, Kim, isConsole: true, atMs: 2_000);

        Assert.Equal(2_000, _store.OpenSegment(Kim)!.StartedAtMs);
    }
}
```

### 5.2 `windows/tests/ScreenTime.Core.Tests/EnrollerTests.cs`

```csharp
using System.Net;
using System.Text;
using System.Text.Json;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Store;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047b: enrolling one Windows account (docs/SPEC.md §11.3). Copied verbatim from the card.</summary>
public sealed class EnrollerTests : IDisposable
{
    private sealed class FakeServer(HttpStatusCode status, string json) : HttpMessageHandler
    {
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        }
    }

    private const string Enrolled = """
        {"deviceId":"d-1","deviceToken":"tok-123","kid":{"id":"k-1","name":"Sam"},"family":{"name":"Gallaghers","timezone":"Australia/Sydney"}}
        """;

    private static readonly EnrolInput Input = new(
        Code: "123456", Sid: Alex, UserName: "sam", Model: "Dell XPS", OsVersion: "Microsoft Windows NT 10.0.26100.0",
        AppVersion: "0.1.0", MachineId: "machine-guid");

    private readonly string _path = NewDbPath();
    private readonly LocalStore _store;

    public EnrollerTests() => _store = LocalStore.Open(_path);

    public void Dispose()
    {
        _store.Dispose();
        Delete(_path);
    }

    private static ApiClient Client(FakeServer server) => new(new HttpClient(server) { BaseAddress = new Uri("https://st.example/") }, () => null);

    /// <summary>A stand-in for DPAPI: reverses the bytes, so the test can see it was called.</summary>
    private static byte[] Protect(byte[] plain) => Enumerable.Reverse(plain).ToArray();

    [Fact]
    public async Task SendsTheWindowsFactsAndStoresTheProtectedToken()
    {
        var server = new FakeServer(HttpStatusCode.Created, Enrolled);

        var device = await Enroller.EnrolAsync(Client(server), _store, Input, Protect, TestContext.Current.CancellationToken);

        using var sent = JsonDocument.Parse(server.Body!);
        var root = sent.RootElement;
        Assert.Equal("123456", root.GetProperty("code").GetString());
        Assert.Equal("windows", root.GetProperty("platform").GetString());
        Assert.False(root.GetProperty("hasCellular").GetBoolean());
        Assert.Equal("Dell XPS", root.GetProperty("model").GetString());
        Assert.Equal("machine-guid", root.GetProperty("machineId").GetString());
        Assert.Equal(Alex, root.GetProperty("windowsUserSid").GetString());
        Assert.Equal("sam", root.GetProperty("windowsUserName").GetString());

        Assert.Equal(new StoredDevice(Alex, "d-1", device.Token, "Sam", "Australia/Sydney"), device);
        Assert.Equal(Protect(Encoding.UTF8.GetBytes("tok-123")), device.Token);
        var stored = _store.GetDevice(Alex)!;
        Assert.Equal("d-1", stored.DeviceId);
        Assert.Equal(device.Token, stored.Token);
    }

    [Fact]
    public async Task EnrollingTheAccountAgainForgetsTheOldDevicesData()
    {
        _store.PutDevice(new StoredDevice(Alex, "d-old", [9], "Sam", "Australia/Sydney"));
        _store.PutSegment(new LocalSegment("old-seg", Alex, 1_000, 2_000, 2_000, false));
        _store.Enqueue(Alex, "event", "{}", 1_000);

        await Enroller.EnrolAsync(Client(new FakeServer(HttpStatusCode.Created, Enrolled)), _store, Input, Protect, TestContext.Current.CancellationToken);

        Assert.Equal("d-1", _store.GetDevice(Alex)!.DeviceId);
        Assert.Empty(_store.SegmentsSince(Alex, 0));
        Assert.Empty(_store.PeekOutbox(Alex, 10));
    }

    [Fact]
    public async Task AWrongCodeThrowsAndKeepsTheOldDevice()
    {
        _store.PutDevice(new StoredDevice(Alex, "d-old", [9], "Sam", "Australia/Sydney"));
        var server = new FakeServer(HttpStatusCode.Unauthorized, """{"error":{"code":"unauthorized","message":"That code didn't work."}}""");

        var e = await Assert.ThrowsAsync<ApiException>(() => Enroller.EnrolAsync(Client(server), _store, Input, Protect, TestContext.Current.CancellationToken));

        Assert.Equal(401, e.Status);
        Assert.Equal("d-old", _store.GetDevice(Alex)!.DeviceId);
    }
}
```

### 5.3 `windows/tests/ScreenTime.Core.Tests/ServiceFilesTests.cs`

```csharp
using ScreenTime.Core.Service;
using ScreenTime.Core.Sync;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047b: the service's small files next to state.db. Copied verbatim from the card.</summary>
public sealed class ServiceFilesTests : IDisposable
{
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "st-files-" + Guid.NewGuid().ToString("N"));

    public ServiceFilesTests() => Directory.CreateDirectory(_folder);

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    private string File(string name) => Path.Combine(_folder, name);

    [Fact]
    public void TheConfigRoundTripsAndAMissingOrBrokenFileIsNone()
    {
        Assert.Null(ServiceFiles.LoadConfig(File("config.json")));

        ServiceFiles.SaveConfig(File("config.json"), new ServiceConfig("https://screentime.example/"));
        Assert.Equal(new ServiceConfig("https://screentime.example/"), ServiceFiles.LoadConfig(File("config.json")));
        Assert.Contains("\"serverUrl\"", System.IO.File.ReadAllText(File("config.json")));

        System.IO.File.WriteAllText(File("config.json"), "{oops");
        Assert.Null(ServiceFiles.LoadConfig(File("config.json")));
    }

    [Theory]
    [InlineData("https://screentime.gallagherhome.au", "https://screentime.gallagherhome.au/")]
    [InlineData(" http://localhost:8080/ ", "http://localhost:8080/")]
    [InlineData("screentime.gallagherhome.au", "https://screentime.gallagherhome.au/")]
    public void ServerUrlsEndWithASlash(string given, string expected)
    {
        Assert.Equal(expected, ServiceFiles.NormaliseServerUrl(given));
    }

    [Theory]
    [InlineData("")]
    [InlineData("ftp://example.com")]
    [InlineData("https://")]
    public void ABadServerUrlThrows(string given)
    {
        Assert.Throws<ArgumentException>(() => ServiceFiles.NormaliseServerUrl(given));
    }

    [Fact]
    public void TheClockStoreKeepsItsValuesAcrossRestarts()
    {
        var first = new FileClockStore(File("clock.json"));
        Assert.Null(first.Anchor);
        Assert.Equal(0, first.LastTrustedMs);

        first.Anchor = new ClockAnchor(10_000_000, 1_000, 42);
        first.LastTrustedMs = 10_060_000;

        var second = new FileClockStore(File("clock.json"));
        Assert.Equal(new ClockAnchor(10_000_000, 1_000, 42), second.Anchor);
        Assert.Equal(10_060_000, second.LastTrustedMs);
        Assert.False(System.IO.File.Exists(File("clock.json.tmp")));
    }

    [Fact]
    public void ABrokenClockFileStartsEmpty()
    {
        System.IO.File.WriteAllText(File("clock.json"), "not json");
        var store = new FileClockStore(File("clock.json"));
        Assert.Null(store.Anchor);
        Assert.Equal(0, store.LastTrustedMs);
    }
}
```

## 6. What to write

### 6.1 `windows/src/ScreenTime.Core/Service/SessionTracker.cs` (namespace `ScreenTime.Core.Service`)

```csharp
public enum SessionChange { Logon, Unlock, Lock, Logoff, Disconnect, Suspend, Shutdown }

public sealed class SessionTracker(LocalStore store, Func<string> newId)
{
    public IReadOnlyList<string> OnChange(SessionChange change, string? sid, bool isConsole, long atMs);
    public void OnServiceStart(string? consoleSid, bool consoleUnlocked, long atMs);
    public void Tick(long atMs);
    public void MarkOffline(string sid);
}
```

It keeps one `Recorder` (CARD-047) per SID in a dictionary, made the first time it is needed, as `new Recorder(store, sid, newId)`. A SID **is a kid account** when `store.GetDevice(sid)` is not null. Check this on every call and never cache it, because an account enrolled while the service runs must work at once.

`OnChange` returns the SIDs whose open segment it ended, so the caller syncs them now:
- `Logon` and `Unlock`: when `sid` is a kid account **and** `isConsole`, call `Start(atMs)`. Return empty.
- `Lock`, `Logoff` and `Disconnect`: when `sid` is a kid account with an open segment (`store.OpenSegment(sid)` is not null), call `Stop(atMs)`. Return `[sid]`, else empty. `isConsole` does not matter here.
- `Suspend` and `Shutdown`: for **every** device in `store.Devices()` with an open segment, call `Stop(atMs)`, and return all those SIDs. `sid` is ignored.
- A null `sid`, or one that is not a kid account, does nothing and returns empty.

The other methods:
- `OnServiceStart`: for every device, `CloseOpen()`. A segment left open by a crash ends where it was last seen. Then, when `consoleSid` is a kid account and `consoleUnlocked`, call `Start(atMs)` for it.
- `Tick`: for every device, `Tick(atMs)`.
- `MarkOffline(sid)`: calls `MarkOffline()` on that SID's recorder, only when it is a kid account.

### 6.2 `windows/src/ScreenTime.Core/Service/Enroller.cs` (namespace `ScreenTime.Core.Service`)

```csharp
public sealed record EnrolInput(string Code, string Sid, string UserName, string Model, string OsVersion, string AppVersion, string MachineId);

public static class Enroller
{
    public static async Task<StoredDevice> EnrolAsync(ApiClient api, LocalStore store, EnrolInput input, Func<byte[], byte[]> protect, CancellationToken cancellationToken);
}
```

1. `api.PostEnrolAsync(new EnrolRequest(Code: input.Code, Platform: Platform.Windows, HasCellular: false, Model: input.Model, OsVersion: input.OsVersion, AppVersion: input.AppVersion, MachineId: input.MachineId, WindowsUserSid: input.Sid, WindowsUserName: input.UserName), cancellationToken)`. An `ApiException` goes up to the caller, and nothing in the store changes.
2. `var device = new StoredDevice(input.Sid, r.DeviceId, protect(Encoding.UTF8.GetBytes(r.DeviceToken)), r.Kid.Name, r.Family.Timezone)`.
3. `store.RemoveDevice(input.Sid)`. Enrolling an account again forgets the old device's segments, state and outbox: the server has revoked that device (SPEC §11.3). Then `store.PutDevice(device)` and return `device`.

The token is **never** written in plain text, logged or printed.

### 6.3 `windows/src/ScreenTime.Core/Service/ServiceFiles.cs` (namespace `ScreenTime.Core.Service`)

```csharp
public sealed record ServiceConfig(string ServerUrl);

public static class ServiceFiles
{
    public static ServiceConfig? LoadConfig(string path);
    public static void SaveConfig(string path, ServiceConfig config);
    public static string NormaliseServerUrl(string url);
}

public sealed class FileClockStore(string path) : IClockStore   // IClockStore and ClockAnchor from ScreenTime.Core.Sync
{
    public ClockAnchor? Anchor { get; set; }
    public long LastTrustedMs { get; set; }
}
```

- **JSON**: one `internal sealed partial class ServiceJsonContext : JsonSerializerContext` in this file, with `[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, WriteIndented = true)]`, `[JsonSerializable(typeof(ServiceConfig))]` and `[JsonSerializable(typeof(ClockFile))]`. `internal sealed record ClockFile(ClockAnchor? Anchor, long LastTrustedMs);`.
- **Writing a file**: always write `path + ".tmp"`, then `File.Move(tmp, path, overwrite: true)`. A power cut never leaves half a file.
- `LoadConfig` returns null when the file is missing, or when reading it throws `JsonException` or gives null.
- `NormaliseServerUrl`:
  1. trim it;
  2. when it has no `://`, put `https://` in front;
  3. it must parse with `Uri.TryCreate(text, UriKind.Absolute, out var uri)`, with scheme `http` or `https` and a non-empty `Host`, else throw `ArgumentException("Server must be like https://screentime.example.com")`;
  4. return `uri.GetLeftPart(UriPartial.Authority) + "/"`, so it always ends with one `/`, which `HttpClient.BaseAddress` needs.
- `FileClockStore`: the constructor reads the file once. A missing or broken file (`JsonException`) gives `Anchor = null` and `LastTrustedMs = 0`. Every `set` of either property writes the whole file at once with both values.

### 6.4 `windows/src/ScreenTime.Service/ScreenTime.Service.csproj`

In the existing `PropertyGroup`, add `<AllowUnsafeBlocks>true</AllowUnsafeBlocks>`. In the existing package `ItemGroup`, add `<PackageReference Include="System.Security.Cryptography.ProtectedData" Version="10.0.13" />`. Change nothing else.

### 6.5 `windows/src/ScreenTime.Service/Windows.cs` (namespace `ScreenTime.Service`)

One `internal static partial class Win` holds every Windows call:

```csharp
[LibraryImport("kernel32.dll")]
internal static partial uint WTSGetActiveConsoleSessionId();

[LibraryImport("wtsapi32.dll", EntryPoint = "WTSQuerySessionInformationW", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool WTSQuerySessionInformation(IntPtr server, uint sessionId, int infoClass, out IntPtr buffer, out uint bytes);

[LibraryImport("wtsapi32.dll")]
internal static partial void WTSFreeMemory(IntPtr memory);
```

and these helpers:
- `string? SessionSid(uint sessionId)`: query info class `5` (WTSUserName) and `7` (WTSDomainName) with `IntPtr.Zero` as the server. Read each with `Marshal.PtrToStringUni(buffer)`, and always `WTSFreeMemory(buffer)`. An empty user name gives null. Otherwise return `new NTAccount(domain, user).Translate(typeof(SecurityIdentifier)).Value`. Any exception gives null.
- `bool SessionUnlocked(uint sessionId)`: query info class `25` (WTSSessionInfoEx). The lock flags are `Marshal.ReadInt32(buffer, 16)`, after the 4-byte level and padding to 8, then the session id and state. `1` means unlocked. Any failure gives `false`.
- `string AccountSid(string userName)`: `new NTAccount(userName).Translate(typeof(SecurityIdentifier)).Value`. Here exceptions go up.
- `long BootId()`: the DWORD `BootId` in `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters`. Windows adds one to it on every boot. When it is missing, use `0`.
- `string Model()`: `SystemProductName` in `HKLM\HARDWARE\DESCRIPTION\System\BIOS`, trimmed, else `"PC"`.
- `string MachineId()`: `MachineGuid` in `HKLM\SOFTWARE\Microsoft\Cryptography`, else `"unknown"`.
- `byte[] Protect(byte[] plain)` and `byte[] Unprotect(byte[] data)`: `ProtectedData.Protect` and `ProtectedData.Unprotect` with no entropy and `DataProtectionScope.LocalMachine`, so the service (SYSTEM) can read what `enrol` wrote.
- `string DefaultDataFolder()`: `Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ScreenTime")`.
- `void EnsureDataFolder(string folder, bool secure)`: when the folder exists, do nothing. When `secure`, create it with a `DirectorySecurity` that has its inheritance turned off (`SetAccessRuleProtection(true, false)`) and gives full control, inherited by subfolders and files, only to `LocalSystem` and `BuiltinAdministrators` (`WellKnownSidType`), using `new DirectoryInfo(folder).Create(security)`. Otherwise use plain `Directory.CreateDirectory(folder)`.

### 6.6 `windows/src/ScreenTime.Service/SessionLifetime.cs` (namespace `ScreenTime.Service`)

```csharp
public sealed record SessionEvent(SessionChange Change, uint SessionId);

public sealed class SessionEvents
{
    public Channel<SessionEvent> Channel { get; } = System.Threading.Channels.Channel.CreateUnbounded<SessionEvent>();
}

public sealed class SessionLifetime : WindowsServiceLifetime
```

- `SessionLifetime`'s constructor takes `WindowsServiceLifetime`'s five parameters (`IHostEnvironment`, `IHostApplicationLifetime`, `ILoggerFactory`, `IOptions<HostOptions>`, `IOptions<WindowsServiceLifetimeOptions>`) plus `SessionEvents`. It passes the five to `base` and sets `CanHandleSessionChangeEvent`, `CanHandlePowerEvent` and `CanShutdown` to `true`.
- `OnSessionChange(SessionChangeDescription d)` writes a `SessionEvent` with `TryWrite` for these reasons only, and ignores the rest:

  | Reason | Change |
  |---|---|
  | `SessionLogon` | `Logon` |
  | `SessionUnlock` | `Unlock` |
  | `SessionLock` | `Lock` |
  | `SessionLogoff` | `Logoff` |
  | `ConsoleDisconnect`, `RemoteDisconnect` | `Disconnect` |

- `OnPowerEvent`: on `PowerBroadcastStatus.Suspend` it writes `Suspend` with session id `0`, and it always returns `true`.
- `OnShutdown`: writes `Shutdown`, waits up to 3 s for the worker to say the shutdown work is done (a `TaskCompletionSource` on `SessionEvents` that the worker completes), then calls `base.OnShutdown()`.

### 6.7 `windows/src/ScreenTime.Service/Worker.cs` (replaces the placeholder)

`public sealed class Worker(SessionEvents events, ServiceOptions options, ILogger<Worker> logger) : BackgroundService`. `ServiceOptions` is `public sealed record ServiceOptions(string DataFolder, bool SecureFolder);`, which `Program.cs` registers.

**Start** (`ExecuteAsync`):
1. `Win.EnsureDataFolder`. Open `LocalStore` at `state.db`, the `FileClockStore` at `clock.json`, and the config at `config.json`, all in the data folder.
2. `clock = new TrustedClock(clockStore, () => Environment.TickCount64, () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Win.BootId)`. `bootId` is read once at start and kept in a field. Windows does not change it while running.
3. `tracker = new SessionTracker(store, () => Guid.NewGuid().ToString())`. The server only takes UUID ids.
4. When there is no config or no device, log `Not enrolled yet: run ScreenTime.Service.exe enrol.` Keep running, because session events still arrive and are ignored.
5. `var console = Win.WTSGetActiveConsoleSessionId()`, then `tracker.OnServiceStart(Win.SessionSid(console), Win.SessionUnlocked(console), clock.NowMs())`.
6. Run two loops until `stoppingToken` is cancelled. One `SemaphoreSlim(1, 1)` lets only one of them touch the tracker or sync at a time:
   - **Events**: `await foreach` over the channel. The SID is `Win.SessionSid(e.SessionId)`. When that is null (Windows has already cleared the user at logoff), use the SID this session had last, from a `Dictionary<uint, string>` filled at every event where the SID was found. `isConsole` is `e.SessionId == Win.WTSGetActiveConsoleSessionId()`. Call `tracker.OnChange(...)` with `clock.NowMs()`, then `SyncAccount` for each SID it returns. For `Shutdown`, complete the shutdown `TaskCompletionSource` afterwards.
   - **Timer**: `PeriodicTimer(TimeSpan.FromSeconds(60))`. On each tick: `tracker.Tick(clock.NowMs())`, then `SyncAccount` for every device.
7. When stopping, call `tracker.OnChange(SessionChange.Shutdown, null, false, clock.NowMs())` once, so a service stop ends the open segments. `OnServiceStart` starts them again at the next start.

**`SyncAccount(sid)`**:
1. Load the device and config. Build, once per SID, and keep: an `ApiClient` on `new HttpClient { BaseAddress = new Uri(config.ServerUrl), Timeout = TimeSpan.FromSeconds(30) }`, with `token = () => Encoding.UTF8.GetString(Win.Unprotect(device.Token))`, and a `Syncer(api, store, sid, clock, m => logger.LogWarning("{Sid}: {Message}", sid, m))`.
2. `if (!await syncer.SyncAsync(ct)) tracker.MarkOffline(sid)`.
3. When `store.LoadState(sid)` has a state, log `"{Kid}: {Minutes} min left, locked {Locked}"` at Information. The values come from `Engine.Evaluate(TodayInput.For(state, store.SegmentsSince(sid, TodayInput.DayStartMs(state, now)), now))`, where `Minutes = RemainingSec / 60`.

Never log the token, the code or the parent code secret.

### 6.8 `windows/src/ScreenTime.Service/Program.cs` (replaces the placeholder)

The first argument chooses what runs. `--data <folder>` (optional, any command) chooses the data folder. It defaults to `Win.DefaultDataFolder()`, and only the default folder is made secure (`SecureFolder = true`).

| Command | What it does |
|---|---|
| *(none)* | The service host: `Host.CreateApplicationBuilder(args)`, `AddWindowsService(o => o.ServiceName = "ScreenTime")`, then `AddSingleton<SessionEvents>()`, `AddSingleton(new ServiceOptions(...))`, and `AddSingleton<IHostLifetime, SessionLifetime>()` **only when** `WindowsServiceHelpers.IsWindowsService()`, then `AddHostedService<Worker>()`. |
| `enrol --server <url> --code <6 digits> --user <account> [--data <folder>]` | `EnsureDataFolder`. `SaveConfig(config.json, new ServiceConfig(NormaliseServerUrl(server)))`. Open the store. Call `Enroller.EnrolAsync` with an `ApiClient` on that URL (`token = () => null`) and `EnrolInput(code, Win.AccountSid(user), user, Win.Model(), Environment.OSVersion.VersionString, "0.1.0", Win.MachineId())`, and `Win.Protect`. Print `Enrolled <user> as <kid name> (device <deviceId>).` and exit `0`. On `ApiException`, print `Enrolment failed: <status> <error code> <message>` and exit `1`. On a bad URL or an unknown account, print the exception message and exit `1`. |
| `sync-once [--data <folder>]` | For every device: the same `SyncAccount` as the worker, printing one line per account to the console: `<kid>: synced <True/False>, <minutes> min left`. Exit `0`. |
| `demo-usage --user <account> --minutes <n> [--data <folder>]` | **Development only.** For that account's SID, with the clock and store as in the worker: `new Recorder(store, sid, () => Guid.NewGuid().ToString())`, `Start(now − n minutes)`, `Stop(now)`, then sync as in `sync-once`, and print the same line. |

Parse the arguments by hand, with a small loop over `args`. No package. A missing value prints a usage line and exits `2`.

### 6.9 Files

1. `windows/tests/ScreenTime.Core.Tests/SessionTrackerTests.cs`, `EnrollerTests.cs` and `ServiceFilesTests.cs`: copy them from section 5.
2. `windows/src/ScreenTime.Core/Service/SessionTracker.cs`, `Enroller.cs` and `ServiceFiles.cs`: write them from 6.1 to 6.3.
3. `windows/src/ScreenTime.Service/ScreenTime.Service.csproj`: the change in 6.4.
4. `windows/src/ScreenTime.Service/Windows.cs` and `SessionLifetime.cs`: new.
5. `windows/src/ScreenTime.Service/Worker.cs` and `Program.cs`: replaced.

## 7. Steps

1. `git checkout main`, `git pull`, `git checkout -b bob/card-047b-service`. Check that `docs/cards/CARD-047b-service.md` exists.
2. Copy the three files in section 5. Run the fingerprints (8.1) **once**.
3. Write 6.1 to 6.3. Build and run the tests until they pass.
4. Write 6.4 to 6.8. Build until it passes with 0 errors.
5. Do the run in 8.3, pasting every output.
6. Commit `CARD-047b: Windows: the service, enrolment and sync`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: three hashes, each followed by `True`.
  ```powershell
  function Fp($f, $want) {
    $b = [IO.File]::ReadAllBytes("windows\tests\ScreenTime.Core.Tests\$f") | Where-Object { $_ -ne 13 }
    $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
    "$f $h $($h -eq $want)"
  }
  Fp "SessionTrackerTests.cs" "11df3fbfcf3151258ab68fecddc2ae82424be03b4e29233a942e8f0d300762f0"
  Fp "EnrollerTests.cs" "727bf0a08a808ca2aedfaf11ee808e14fb3cc287e488f9f55fdb16ab63eda253"
  Fp "ServiceFilesTests.cs" "875541c01ac6e4f2dff1abaa91d53789431a2725ca8b109895134d81b7337606"
  ```
- [ ] `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors.
- [ ] `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 106** (85 before + 21). Paste the summary lines.
- [ ] `Select-String -Path windows\src\ScreenTime.Core\Service\*.cs -Pattern 'DateTime\.Now|UtcNow|TickCount|DllImport'` prints nothing.
- [ ] `Select-String -Path windows\src\ScreenTime.Service\*.cs -Pattern 'DllImport'` prints nothing.

### 8.2 Repo

- [ ] `git status` clean. No `bin\`, `obj\`, `state.db`, `config.json` or `clock.json` in the repo.
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 11 files:
  ```
  windows/src/ScreenTime.Core/Service/Enroller.cs
  windows/src/ScreenTime.Core/Service/ServiceFiles.cs
  windows/src/ScreenTime.Core/Service/SessionTracker.cs
  windows/src/ScreenTime.Service/Program.cs
  windows/src/ScreenTime.Service/ScreenTime.Service.csproj
  windows/src/ScreenTime.Service/SessionLifetime.cs
  windows/src/ScreenTime.Service/Windows.cs
  windows/src/ScreenTime.Service/Worker.cs
  windows/tests/ScreenTime.Core.Tests/EnrollerTests.cs
  windows/tests/ScreenTime.Core.Tests/ServiceFilesTests.cs
  windows/tests/ScreenTime.Core.Tests/SessionTrackerTests.cs
  ```

### 8.3 The run on James's PC (no admin, no service install)

Paste the **real output of every line**. A step without output counts as NOT RUN. Docker Desktop must be running. Use one PowerShell window, from the repo root, and keep the environment variables set.

1. The local server and the dev family. This is CARD-042 §8.2 setup 3 without the Firebase line:
   ```powershell
   Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
   $env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
   pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
   function Db([string]$sql) { docker compose -f deploy\docker-compose.yml --env-file deploy\.env exec db psql -U screentime -d screentime -At -c $sql }
   $t = "C:\Users\james\OpenCode\Testing\temp\c47b"
   $svc = "windows\src\ScreenTime.Service"
   ```
2. A PC code for Sam, then enrol **your own account** as Sam into the temp folder:
   ```powershell
   $code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
   $code.Length
   dotnet run --project $svc -c Release -- enrol --server http://localhost:8080 --code $code --user $env:USERNAME --data $t
   Get-ChildItem $t | Select-Object -ExpandProperty Name
   Db "select platform, form, windows_user_sid is not null, revoked_at is null from devices where kid_id = (select id from kids where name = 'Sam')"
   ```
   Expect `6`, then `Enrolled <you> as Sam (device …).`, then the files `clock.json`, `config.json` and `state.db` (plus `state.db-wal` and `state.db-shm` if they are still there), then `windows|pc|t|t`. Never print `$code` itself.
3. The same code again must fail, with no change:
   ```powershell
   dotnet run --project $svc -c Release -- enrol --server http://localhost:8080 --code $code --user $env:USERNAME --data $t
   $LASTEXITCODE
   ```
   Expect `Enrolment failed: 401 unauthorized …`, then `1`.
4. Sync, then a demo segment of 2 minutes:
   ```powershell
   dotnet run --project $svc -c Release -- sync-once --data $t
   dotnet run --project $svc -c Release -- demo-usage --user $env:USERNAME --minutes 2 --data $t
   Db "select count(*), round(sum(extract(epoch from ended_at - started_at))) from usage_segments where kid_id = (select id from kids where name = 'Sam')"
   dotnet run --project $svc -c Release -- sync-once --data $t
   ```
   Expect `Sam: synced True, N min left`, where N is today's Screens time for Sam. Then `demo-usage` prints `Sam: synced True, N−2 min left`, the database prints `1|120`, and the last line shows N−2 again. At bedtime or before wake, every line says `0 min left`: that is right, so say so in the handback.
5. Clean up:
   ```powershell
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
   ```
   Then delete the `c47b` temp folder.

## 9. Tests

| File | Tests | What it checks |
|---|---|---|
| `SessionTrackerTests` | 9 | Unlock and lock on the console; logon, logoff and disconnect; remote sessions and accounts that are not enrolled ignored; nothing open; sleep and shutdown end everything; service start; tick and offline; an account enrolled later. |
| `EnrollerTests` | 3 | The Windows facts sent and the token stored protected; enrolling again forgets the old data; a wrong code changes nothing. |
| `ServiceFilesTests` | 3 facts + 6 cases | Config round trip and broken files; server URL rules; the clock store across restarts and a broken clock file. |

## 10. Git and pull request

Push `bob/card-047b-service` and open the PR with `gh pr create --base main --title "CARD-047b: Windows: the service, enrolment and sync" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body says what the card asked for, lists the files, and gives the test summary and the 8.3 results. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". Never change a test.

- **A copied test does not compile, or an analyzer rule fails it**, and the error is in the test file itself: paste the full error and stop. The card may be wrong.
- **An AOT or trim warning (`IL…`) in `ScreenTime.Service`**: paste it and stop. No `NoWarn`, no `#pragma`.
- **`enrol` prints `401`** on the first try: the code expired (10 minutes). Make a new one with the step 2 command, once.
- **`enrol` cannot reach the server**: paste `docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps` and stop.
- **Step 4 shows `0|` in the database**: paste the `demo-usage` output and the last 30 lines of `docker compose ... logs api`, then stop.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- For an emulator or device run, paste the real output of **every** step (every `Screen-Text`, helper and script line). "The screenshots are the evidence" or "from earlier in the session" is not accepted: a step without its pasted output counts as `NOT RUN`, and Claude sends the PR back.
- Every workaround (force-stop, app restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-047b. Please review and merge if it is good.

CARD: CARD-047b Windows: the service, enrolment and sync
PR: <full PR URL>
Branch: bob/card-047b-service
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
