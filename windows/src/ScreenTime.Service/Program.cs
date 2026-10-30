using System.Text;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;
using ScreenTime.Core.Time;
using ScreenTime.Service;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;

// The first argument chooses what runs. --data <folder> is optional for any command. It defaults to the secure
// default folder, and only the default folder is made secure.
var dataFolder = Win.DefaultDataFolder();
var secure = true;
var command = "";
var dryLock = false;
var flags = new Dictionary<string, string>();
var i = 0;
while (i < args.Length)
{
    var arg = args[i];
    if (arg == "--data")
    {
        if (i + 1 >= args.Length) { Console.Error.WriteLine("Usage: --data <folder>"); return 2; }
        dataFolder = args[i + 1];
        secure = dataFolder == Win.DefaultDataFolder();
        i += 2;
    }
    else if (arg == "--dry-lock")
    {
        dryLock = true;
        i++;
    }
    else if (arg.StartsWith("--"))
    {
        var key = arg[2..];
        if (i + 1 >= args.Length) { Console.Error.WriteLine($"Usage: {arg} <value>"); return 2; }
        flags[key] = args[i + 1];
        i += 2;
    }
    else
    {
        if (command == "") command = arg;
        i++;
    }
}

switch (command)
{
    case "":
        {
            var builder = Host.CreateApplicationBuilder(args);
            builder.Services.AddWindowsService(o => o.ServiceName = "ScreenTime");
            builder.Services.AddSingleton<SessionEvents>();
            // --tray <path>: the tray exe. Without it, the one next to the service when it runs as a service; none in a console run.
            var trayExe = flags.TryGetValue("tray", out var tray) ? tray
                : WindowsServiceHelpers.IsWindowsService() ? Path.Combine(AppContext.BaseDirectory, "ScreenTime.Tray.exe") : null;
            // Dev only, for runs over Remote Desktop: --session <id> treats that session as the console, and
            // --tray-open <main|ask|message> opens the tray's flyout at once. Both need --dry-lock.
            uint? session = null;
            if (flags.TryGetValue("session", out var sessionText))
            {
                if (!uint.TryParse(sessionText, out var id)) { Console.Error.WriteLine("Usage: --session <session id>"); return 2; }
                session = id;
            }
            flags.TryGetValue("tray-open", out var trayOpen);
            if ((session is not null || trayOpen is not null) && !dryLock)
            {
                Console.Error.WriteLine("--session and --tray-open are for testing and need --dry-lock.");
                return 2;
            }
            builder.Services.AddSingleton(new ServiceOptions(dataFolder, secure, trayExe, dryLock, WindowsServiceHelpers.IsWindowsService(), session, trayOpen));
            if (WindowsServiceHelpers.IsWindowsService())
            {
                builder.Services.AddSingleton<IHostLifetime, SessionLifetime>();
            }
            builder.Services.AddHostedService<Worker>();
            builder.Build().Run();
            return 0;
        }
    case "enrol":
        {
            if (!flags.TryGetValue("server", out var server) || !flags.TryGetValue("code", out var code) || !flags.TryGetValue("user", out var user))
            {
                Console.Error.WriteLine("Usage: enrol --server <url> --code <6 digits> --user <account> [--data <folder>]");
                return 2;
            }
            Win.EnsureDataFolder(dataFolder, secure);
            var configPath = Path.Combine(dataFolder, "config.json");
            try
            {
                ServiceFiles.SaveConfig(configPath, new ServiceConfig(ServiceFiles.NormaliseServerUrl(server)));
            }
            catch (ArgumentException e)
            {
                Console.Error.WriteLine(e.Message);
                return 1;
            }
            using var store = LocalStore.Open(Path.Combine(dataFolder, "state.db"));
            try
            {
                var api = new ApiClient(new HttpClient { BaseAddress = new Uri(ServiceFiles.NormaliseServerUrl(server)), Timeout = TimeSpan.FromSeconds(30) }, () => null);
                var input = new EnrolInput(code, Win.AccountSid(user), user, Win.Model(), Environment.OSVersion.VersionString, "0.1.0", Win.MachineId());
                var device = await Enroller.EnrolAsync(api, store, input, Win.Protect, CancellationToken.None);
                Console.WriteLine($"Enrolled {user} as {device.KidName} (device {device.DeviceId}).");
                return 0;
            }
            catch (ApiException e)
            {
                Console.WriteLine($"Enrolment failed: {e.Status} {e.Error?.Code} {e.Error?.Message}");
                return 1;
            }
            catch (Exception e)
            {
                Console.Error.WriteLine(e.Message);
                return 1;
            }
        }
    case "sync-once":
        {
            Win.EnsureDataFolder(dataFolder, secure);
            var configPath = Path.Combine(dataFolder, "config.json");
            using var store = LocalStore.Open(Path.Combine(dataFolder, "state.db"));
            var config = ServiceFiles.LoadConfig(configPath);
            if (config is null) return 0;
            var clockStore = new FileClockStore(Path.Combine(dataFolder, "clock.json"));
            var bootId = Win.BootId();
            var clock = new TrustedClock(clockStore, () => Environment.TickCount64, () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), () => bootId);
            foreach (var device in store.Devices())
            {
                var sid = device.Sid;
                var api = new ApiClient(new HttpClient { BaseAddress = new Uri(config.ServerUrl), Timeout = TimeSpan.FromSeconds(30) }, () => Encoding.UTF8.GetString(Win.Unprotect(device.Token)));
                var syncer = new Syncer(api, store, sid, clock, m => Console.WriteLine(m));
                var ok = await syncer.SyncAsync(CancellationToken.None);
                var cached = store.LoadState(sid);
                var minutes = 0;
                if (cached is { } c)
                {
                    var now = clock.NowMs();
                    var result = Engine.Evaluate(TodayInput.For(c.State, store.SegmentsSince(sid, TodayInput.DayStartMs(c.State, now)), now));
                    minutes = (int)(result.RemainingSec / 60);
                }
                Console.WriteLine($"{device.KidName}: synced {ok}, {minutes} min left");
            }
            return 0;
        }
    case "demo-usage":
        {
            if (!flags.TryGetValue("user", out var user) || !flags.TryGetValue("minutes", out var minutesStr))
            {
                Console.Error.WriteLine("Usage: demo-usage --user <account> --minutes <n> [--data <folder>]");
                return 2;
            }
            if (!int.TryParse(minutesStr, out var minutes))
            {
                Console.Error.WriteLine("Usage: demo-usage --user <account> --minutes <n> [--data <folder>]");
                return 2;
            }
            Win.EnsureDataFolder(dataFolder, secure);
            var configPath = Path.Combine(dataFolder, "config.json");
            using var store = LocalStore.Open(Path.Combine(dataFolder, "state.db"));
            var config = ServiceFiles.LoadConfig(configPath);
            var clockStore = new FileClockStore(Path.Combine(dataFolder, "clock.json"));
            var bootId = Win.BootId();
            var clock = new TrustedClock(clockStore, () => Environment.TickCount64, () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), () => bootId);
            var sid = Win.AccountSid(user);
            var device = store.GetDevice(sid);
            if (device is null || config is null)
            {
                Console.Error.WriteLine("Not enrolled.");
                return 1;
            }
            var now = clock.NowMs();
            var recorder = new Recorder(store, sid, () => Guid.NewGuid().ToString());
            recorder.Start(now - minutes * 60_000);
            recorder.Stop(now);
            var api = new ApiClient(new HttpClient { BaseAddress = new Uri(config.ServerUrl), Timeout = TimeSpan.FromSeconds(30) }, () => Encoding.UTF8.GetString(Win.Unprotect(device.Token)));
            var syncer = new Syncer(api, store, sid, clock, m => Console.WriteLine(m));
            var ok = await syncer.SyncAsync(CancellationToken.None);
            var cached = store.LoadState(sid);
            var mins = 0;
            if (cached is { } c)
            {
                var result = Engine.Evaluate(TodayInput.For(c.State, store.SegmentsSince(sid, TodayInput.DayStartMs(c.State, now)), now));
                mins = (int)(result.RemainingSec / 60);
            }
            Console.WriteLine($"{device.KidName}: synced {ok}, {mins} min left");
            return 0;
        }
    default:
        Console.Error.WriteLine($"Unknown command: {command}");
        return 2;
}
