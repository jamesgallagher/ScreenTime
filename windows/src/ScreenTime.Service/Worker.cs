using System.Text;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;
using ScreenTime.Core.Time;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ScreenTime.Service;

/// <summary>The service's options: the data folder and whether it is the secure default.</summary>
public sealed record ServiceOptions(string DataFolder, bool SecureFolder);

/// <summary>
/// The service's worker: it opens the store, the clock and the config, starts the tracker, and runs two loops (session
/// events and the 60 s timer) that sync every enrolled account.
/// </summary>
public sealed class Worker(SessionEvents events, ServiceOptions options, ILogger<Worker> logger) : BackgroundService
{
    private readonly Dictionary<string, Syncer> _syncers = new();
    private LocalStore _store = null!;
    private TrustedClock _clock = null!;
    private SessionTracker _tracker = null!;
    private string _configPath = null!;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Win.EnsureDataFolder(options.DataFolder, options.SecureFolder);
        var store = LocalStore.Open(Path.Combine(options.DataFolder, "state.db"));
        _store = store;
        var clockStore = new FileClockStore(Path.Combine(options.DataFolder, "clock.json"));
        _configPath = Path.Combine(options.DataFolder, "config.json");
        var config = ServiceFiles.LoadConfig(_configPath);

        var bootId = Win.BootId();
        var clock = new TrustedClock(clockStore, () => Environment.TickCount64, () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), () => bootId);
        _clock = clock;

        var tracker = new SessionTracker(store, () => Guid.NewGuid().ToString());
        _tracker = tracker;

        if (config is null || store.Devices().Count == 0)
        {
            logger.LogWarning("Not enrolled yet: run ScreenTime.Service.exe enrol.");
        }

        var console = Win.WTSGetActiveConsoleSessionId();
        tracker.OnServiceStart(Win.SessionSid(console), Win.SessionUnlocked(console), clock.NowMs());

        var sem = new SemaphoreSlim(1, 1);
        var lastSid = new Dictionary<uint, string>();

        var eventsTask = Task.Run(async () =>
        {
            try
            {
                await foreach (var e in events.Channel.Reader.ReadAllAsync(stoppingToken))
                {
                    var sid = Win.SessionSid(e.SessionId);
                    if (sid is null)
                    {
                        if (!lastSid.TryGetValue(e.SessionId, out sid)) continue;
                    }
                    else
                    {
                        lastSid[e.SessionId] = sid;
                    }
                    var isConsole = e.SessionId == Win.WTSGetActiveConsoleSessionId();
                    await sem.WaitAsync(stoppingToken);
                    try
                    {
                        var ended = tracker.OnChange(e.Change, sid, isConsole, clock.NowMs());
                        foreach (var s in ended) await SyncAccount(s, stoppingToken);
                        if (e.Change == SessionChange.Shutdown) events.Shutdown.TrySetResult();
                    }
                    finally
                    {
                        sem.Release();
                    }
                }
            }
            catch (OperationCanceledException) { }
        });

        var timerTask = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(60));
            try
            {
                while (await timer.WaitForNextTickAsync(stoppingToken))
                {
                    await sem.WaitAsync(stoppingToken);
                    try
                    {
                        tracker.Tick(clock.NowMs());
                        foreach (var device in store.Devices()) await SyncAccount(device.Sid, stoppingToken);
                    }
                    finally
                    {
                        sem.Release();
                    }
                }
            }
            catch (OperationCanceledException) { }
        });

        await Task.WhenAll(eventsTask, timerTask);

        tracker.OnChange(SessionChange.Shutdown, null, false, clock.NowMs());
        store.Dispose();
    }

    private async Task SyncAccount(string sid, CancellationToken ct)
    {
        var device = _store.GetDevice(sid);
        var config = ServiceFiles.LoadConfig(_configPath);
        if (device is null || config is null) return;
        if (!_syncers.TryGetValue(sid, out var syncer))
        {
            var api = new ApiClient(new HttpClient { BaseAddress = new Uri(config.ServerUrl), Timeout = TimeSpan.FromSeconds(30) }, () => Encoding.UTF8.GetString(Win.Unprotect(device.Token)));
            syncer = new Syncer(api, _store, sid, _clock, m => logger.LogWarning("{Sid}: {Message}", sid, m));
            _syncers[sid] = syncer;
        }
        if (!await syncer.SyncAsync(ct)) _tracker.MarkOffline(sid);
        var cached = _store.LoadState(sid);
        if (cached is { } c)
        {
            var now = _clock.NowMs();
            var result = Engine.Evaluate(TodayInput.For(c.State, _store.SegmentsSince(sid, TodayInput.DayStartMs(c.State, now)), now));
            logger.LogInformation("{Kid}: {Minutes} min left, locked {Locked}", device.KidName, result.RemainingSec / 60, result.Locked);
        }
    }
}
