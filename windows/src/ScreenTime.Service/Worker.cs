using System.Collections.Concurrent;
using System.Text;
using System.Threading.Channels;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ScreenTime.Service;

/// <summary>
/// The service's options: the data folder, whether it is the secure default, the tray exe (null: no tray), dry-lock
/// (log instead of locking or disconnecting) and whether it runs as a Windows service. <c>Session</c> and <c>TrayOpen</c>
/// are for test runs (<c>--session</c>, <c>--tray-open</c>).
/// </summary>
public sealed record ServiceOptions(string DataFolder, bool SecureFolder, string? TrayExe, bool DryLock, bool AsService, uint? Session = null, string? TrayOpen = null);

/// <summary>
/// The service's worker: it opens the store, the clock and the config, starts the tracker, and runs four loops (session
/// events, the 60 s timer, the 1 s lock loop and the sync requests from the live channels). Each kid session has a
/// <see cref="LockKeeper"/> and a <see cref="TrayHost"/>.
/// </summary>
public sealed class Worker(SessionEvents events, ServiceOptions options, ILogger<Worker> logger) : BackgroundService
{
    private const string OutOfTimeToast = "Out of Screens time. Ask Mum or Dad.";

    private readonly Dictionary<string, Syncer> _syncers = new();
    private readonly Dictionary<uint, KidSession> _sessions = new();
    private readonly Dictionary<string, Task> _live = new();
    private readonly Channel<string> _syncRequests = Channel.CreateUnbounded<string>();
    private readonly SemaphoreSlim _sem = new(1, 1);
    private readonly Dictionary<string, (bool Online, long? SyncedAtMs)> _lastSync = new();
    private readonly Dictionary<string, GrantToasts> _grantToasts = new();
    private readonly Dictionary<string, ApiClient> _apis = new();
    private readonly ConcurrentQueue<(string Sid, string GrantId)> _skipGrants = new();
    private LocalStore _store = null!;
    private TrustedClock _clock = null!;
    private SessionTracker _tracker = null!;
    private string _configPath = null!;
    private CancellationToken _stopping;

    private sealed class KidSession(uint sessionId, string sid, TrayHost tray, CancellationTokenSource cts)
    {
        public uint SessionId { get; } = sessionId;
        public string Sid { get; } = sid;
        public LockKeeper Keeper { get; } = new();
        public TrayHost Tray { get; } = tray;
        public CancellationTokenSource Cts { get; } = cts;
        public bool Unlocked { get; set; }
        public WarningTracker Warnings { get; } = new();
        public bool? SentLocked { get; set; }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _stopping = stoppingToken;
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

        var sem = _sem;
        var lastSid = new Dictionary<uint, string>();

        await sem.WaitAsync(stoppingToken);
        try
        {
            // Only closes what a crash left open: counting starts with the keeper's StartCounting.
            tracker.OnServiceStart(null, false, clock.NowMs());
            var console = ConsoleSession();
            if (Win.SessionSid(console) is { } consoleSid)
            {
                lastSid[console] = consoleSid;
                if (EnsureSession(console, consoleSid) is { } s && Win.SessionUnlocked(console)) Unlock(s);
            }
            StartLiveChannels();
        }
        finally
        {
            sem.Release();
        }

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
                    var isConsole = e.SessionId == ConsoleSession();
                    await sem.WaitAsync(stoppingToken);
                    try
                    {
                        await OnSessionEvent(e, sid, isConsole, stoppingToken);
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
                        StartLiveChannels();
                    }
                    finally
                    {
                        sem.Release();
                    }
                }
            }
            catch (OperationCanceledException) { }
        });

        var lockTask = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
            try
            {
                while (await timer.WaitForNextTickAsync(stoppingToken))
                {
                    await sem.WaitAsync(stoppingToken);
                    try
                    {
                        var now = clock.NowMs();
                        foreach (var s in _sessions.Values.Where(s => s.Unlocked).ToList())
                        {
                            await Apply(s, s.Keeper.Check(OutOfTime(s.Sid, now), now), now);
                            if (View(s.Sid, now) is not { } view) continue;
                            if (s.Warnings.Check(view) is { } warning) await SendToast(s, warning);
                            if (s.SentLocked != view.Locked) await SendView(s, view);
                        }
                    }
                    finally
                    {
                        sem.Release();
                    }
                }
            }
            catch (OperationCanceledException) { }
        });

        var syncTask = Task.Run(async () =>
        {
            try
            {
                await foreach (var sid in _syncRequests.Reader.ReadAllAsync(stoppingToken))
                {
                    await sem.WaitAsync(stoppingToken);
                    try
                    {
                        await SyncAccount(sid, stoppingToken);
                    }
                    finally
                    {
                        sem.Release();
                    }
                }
            }
            catch (OperationCanceledException) { }
        });

        await Task.WhenAll(eventsTask, timerTask, lockTask, syncTask);

        foreach (var s in _sessions.Values) s.Cts.Cancel();
        tracker.OnChange(SessionChange.Shutdown, null, false, clock.NowMs());
        store.Dispose();
    }

    private async Task OnSessionEvent(SessionEvent e, string sid, bool isConsole, CancellationToken ct)
    {
        var now = _clock.NowMs();
        switch (e.Change)
        {
            case SessionChange.Logon:
            case SessionChange.Unlock:
                // The tracker is not called here: StartCounting does it, so the 10 s before a relock are not counted.
                if (isConsole && EnsureSession(e.SessionId, sid) is { } unlocked) Unlock(unlocked);
                return;
            case SessionChange.Lock:
            case SessionChange.Disconnect:
            case SessionChange.Logoff:
                if (_sessions.TryGetValue(e.SessionId, out var s))
                {
                    s.Unlocked = false;
                    s.Keeper.OnLocked();
                    if (e.Change == SessionChange.Logoff)
                    {
                        s.Cts.Cancel();
                        _sessions.Remove(e.SessionId);
                    }
                }
                break;
            case SessionChange.Suspend:
            case SessionChange.Shutdown:
                foreach (var each in _sessions.Values)
                {
                    each.Unlocked = false;
                    each.Keeper.OnLocked();
                }
                break;
        }
        var ended = _tracker.OnChange(e.Change, sid, isConsole, now);
        foreach (var endedSid in ended) await SyncAccount(endedSid, ct);
        if (e.Change == SessionChange.Shutdown) events.Shutdown.TrySetResult();
    }

    /// <summary>The kid session for <c>sessionId</c>, made (with its tray) when the SID is enrolled. Null for any other account.</summary>
    private KidSession? EnsureSession(uint sessionId, string sid)
    {
        if (_sessions.TryGetValue(sessionId, out var existing)) return existing;
        if (_store.GetDevice(sid) is null) return null;
        var cts = CancellationTokenSource.CreateLinkedTokenSource(_stopping);
        var tray = new TrayHost(sessionId, sid, options.TrayExe, options.DryLock, options.AsService, m => OnTrayMessage(sessionId, m), logger, options.TrayOpen);
        var s = new KidSession(sessionId, sid, tray, cts);
        _sessions[sessionId] = s;
        _ = tray.RunAsync(cts.Token);
        return s;
    }

    private void Unlock(KidSession s)
    {
        var now = _clock.NowMs();
        s.Unlocked = true;
        // Only StartCounting or Toast: neither waits on the pipe for long.
        _ = Apply(s, s.Keeper.OnUnlock(OutOfTime(s.Sid, now), now), now);
    }

    private bool OutOfTime(string sid, long now)
    {
        if (_store.LoadState(sid) is not { } c) return false;
        var result = Engine.Evaluate(TodayInput.For(c.State, _store.SegmentsSince(sid, TodayInput.DayStartMs(c.State, now)), now));
        return LockKeeper.OutOfTime(result, c.State, now);
    }

    private async Task Apply(KidSession s, IReadOnlyList<LockStep> steps, long now)
    {
        foreach (var step in steps)
        {
            switch (step)
            {
                case LockStep.StartCounting:
                    _tracker.OnChange(SessionChange.Unlock, s.Sid, true, now);
                    break;
                case LockStep.Lock:
                    logger.LogInformation("{Kid}: locking session {Session}", KidName(s.Sid), s.SessionId);
                    await s.Tray.SendAsync(PipeMessage.Lock(Guid.NewGuid().ToString()));
                    break;
                case LockStep.Disconnect:
                    if (options.DryLock)
                    {
                        logger.LogWarning("dry run: would disconnect session {Session}", s.SessionId);
                    }
                    else
                    {
                        logger.LogWarning("{Kid}: tray did not lock, disconnecting session {Session}", KidName(s.Sid), s.SessionId);
                        Win.Disconnect(s.SessionId);
                    }
                    break;
                case LockStep.Toast:
                    await SendToast(s, OutOfTimeToast);
                    break;
            }
        }
    }

    private async Task OnTrayMessage(uint sessionId, PipeMessage m)
    {
        await _sem.WaitAsync();
        try
        {
            if (!_sessions.TryGetValue(sessionId, out var s)) return;
            switch (m.Type)
            {
                case "hello":
                    logger.LogInformation("tray {Session}: hello pid {Pid}", sessionId, m.Pid);
                    if (View(s.Sid, _clock.NowMs()) is { } view) await SendView(s, view);
                    break;
                case "ask" or "message" when m.Id is not null && Api(s.Sid) is { } api:
                    // The server call can take up to 30 s: it must not hold up the pipe or the lock loop.
                    _ = Task.Run(() => SendForTray(s, api, m));
                    break;
                case "locked":
                    s.Keeper.OnLockConfirmed();
                    logger.LogInformation("tray {Session}: locked", sessionId);
                    break;
            }
        }
        finally
        {
            _sem.Release();
        }
    }

    /// <summary>Sends the tray's ask or message to the server and replies with how it went.</summary>
    private async Task SendForTray(KidSession s, ApiClient api, PipeMessage m)
    {
        SendResult result;
        try
        {
            if (m.Type == "ask") await api.PostDeviceTimeRequestsAsync(new TimeRequestCreate(m.Id!, m.Minutes ?? 15, m.Reason), _stopping);
            else await api.PostDeviceMessagesAsync(new KidMessageCreate(m.Id!, m.Text ?? "", m.PresetId), _stopping);
            result = SendResult.Sent;
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
        {
            return;
        }
        catch (Exception e)
        {
            result = SendResults.Of(e);
        }
        logger.LogInformation("{Kid}: {Type} sent, {Result}", KidName(s.Sid), m.Type, result);
        await s.Tray.SendAsync(PipeMessage.Reply(m.Id!, result));
        // The new pendingRequest ("Waiting for Dad…") comes with the next sync.
        if (result != SendResult.Offline) _syncRequests.Writer.TryWrite(s.Sid);
    }

    private void StartLiveChannels()
    {
        var config = ServiceFiles.LoadConfig(_configPath);
        if (config is null) return;
        foreach (var device in _store.Devices())
        {
            var sid = device.Sid;
            if (_live.TryGetValue(sid, out var running) && !running.IsCompleted) continue;
            var channel = new LiveChannel(Live.Url(config.ServerUrl), () => Encoding.UTF8.GetString(Win.Unprotect(device.Token)), () => _syncRequests.Writer.TryWrite(sid), logger, device.KidName, frame => OnFrame(sid, frame));
            _live[sid] = Task.Run(() => channel.RunAsync(_stopping));
        }
    }

    /// <summary>Every live frame: a parent's answer goes to the trays of that SID, and its grant is not toasted again.</summary>
    private void OnFrame(string sid, string frame)
    {
        if (Live.AnswerGrantId(frame) is { } grantId) _skipGrants.Enqueue((sid, grantId));
        if (Live.Answer(frame) is { } answer) _ = Task.Run(() => SendAnswer(sid, answer));
    }

    /// <summary>Logs the answer and sends it to every tray of the SID.</summary>
    private async Task SendAnswer(string sid, RequestAnswer answer)
    {
        await _sem.WaitAsync();
        try
        {
            var text = answer.Text();
            logger.LogInformation("{Kid}: answer {Text}", KidName(sid), text);
            foreach (var s in _sessions.Values.Where(s => s.Sid == sid).ToList()) await s.Tray.SendAsync(PipeMessage.Answer(text, answer.Approved));
        }
        finally
        {
            _sem.Release();
        }
    }

    /// <summary>The session that counts as the console: <c>--session</c> in a test run, otherwise the real console.</summary>
    private uint ConsoleSession() => options.Session ?? Win.WTSGetActiveConsoleSessionId();

    private string KidName(string sid) => _store.GetDevice(sid)?.KidName ?? sid;

    /// <summary>What the tray shows for the SID now, or null when nothing is cached for it.</summary>
    private TrayStatus? View(string sid, long now)
    {
        if (_store.LoadState(sid) is not { } c) return null;
        var result = Engine.Evaluate(TodayInput.For(c.State, _store.SegmentsSince(sid, TodayInput.DayStartMs(c.State, now)), now));
        var last = _lastSync.GetValueOrDefault(sid, (true, null));
        return TrayStatusBuilder.From(c.State, result, now, last.Online, last.SyncedAtMs);
    }

    /// <summary>Sends <paramref name="view"/> to the session's tray and remembers whether it said locked.</summary>
    private async Task SendView(KidSession s, TrayStatus view)
    {
        s.SentLocked = view.Locked;
        await s.Tray.SendAsync(PipeMessage.ViewOf(view));
    }

    /// <summary>Logs and sends a toast to the session's tray.</summary>
    private async Task SendToast(KidSession s, string text)
    {
        logger.LogInformation("{Kid}: toast {Text}", KidName(s.Sid), text);
        await s.Tray.SendAsync(PipeMessage.Toast(text));
    }

    /// <summary>The API client for the SID, made once; null when it is not enrolled.</summary>
    private ApiClient? Api(string sid)
    {
        if (_apis.TryGetValue(sid, out var api)) return api;
        var device = _store.GetDevice(sid);
        var config = ServiceFiles.LoadConfig(_configPath);
        if (device is null || config is null) return null;
        api = new ApiClient(new HttpClient { BaseAddress = new Uri(config.ServerUrl), Timeout = TimeSpan.FromSeconds(30) }, () => Encoding.UTF8.GetString(Win.Unprotect(device.Token)));
        _apis[sid] = api;
        return api;
    }

    private async Task SyncAccount(string sid, CancellationToken ct)
    {
        var device = _store.GetDevice(sid);
        var config = ServiceFiles.LoadConfig(_configPath);
        if (device is null || config is null || Api(sid) is not { } api) return;
        if (!_syncers.TryGetValue(sid, out var syncer))
        {
            syncer = new Syncer(api, _store, sid, _clock, m => logger.LogWarning("{Sid}: {Message}", sid, m));
            _syncers[sid] = syncer;
        }
        var synced = await syncer.SyncAsync(ct);
        if (!synced) _tracker.MarkOffline(sid);
        var previous = _lastSync.GetValueOrDefault(sid, (true, null));
        _lastSync[sid] = (synced, synced ? _clock.NowMs() : previous.SyncedAtMs);
        var cached = _store.LoadState(sid);
        if (cached is { } c)
        {
            var now = _clock.NowMs();
            var result = Engine.Evaluate(TodayInput.For(c.State, _store.SegmentsSince(sid, TodayInput.DayStartMs(c.State, now)), now));
            logger.LogInformation("{Kid}: {Minutes} min left, locked {Locked}", device.KidName, result.RemainingSec / 60, result.Locked);
            while (_skipGrants.TryDequeue(out var skip))
            {
                if (!_grantToasts.TryGetValue(skip.Sid, out var skipper)) _grantToasts[skip.Sid] = skipper = new GrantToasts();
                skipper.Skip(skip.GrantId);
            }
            if (!_grantToasts.TryGetValue(sid, out var grants)) _grantToasts[sid] = grants = new GrantToasts();
            var toasts = synced ? grants.Check(c.State) : [];
            var view = View(sid, now)!;
            foreach (var s in _sessions.Values.Where(s => s.Sid == sid).ToList())
            {
                await SendView(s, view);
                foreach (var text in toasts) await SendToast(s, text);
            }
        }
    }
}
