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
    private readonly Dictionary<string, LocalParentMode> _parentLocal = new();
    private readonly Dictionary<string, string> _parentAsks = new();
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
        public bool? SentParentMode { get; set; }
        public bool InParentMode { get; set; }
        public long? CodeOkAt { get; set; }
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
                        foreach (var s in _sessions.Values.Where(s => s.Unlocked || s.InParentMode).ToList())
                        {
                            var parentMode = ParentModeOn(s.Sid, now);
                            if (s.Unlocked && parentMode) EnterParentMode(s, now);
                            else if (s.InParentMode && !parentMode) LeaveParentMode(s);
                            if (s.Unlocked) await Apply(s, s.Keeper.Check(OutOfTime(s.Sid, now), now), now);
                            if (View(s.Sid, now) is not { } view) continue;
                            if (s.Warnings.Check(view) is { } warning) await SendToast(s, warning);
                            if (s.SentLocked != view.Locked || s.SentParentMode != view.ParentMode) await SendView(s, view);
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
                    s.InParentMode = false;
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
                    each.InParentMode = false;
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
        // Unlocked during parent mode: nothing counts and nothing locks until it ends (§12.3).
        if (ParentModeOn(s.Sid, now))
        {
            s.InParentMode = true;
            return;
        }
        s.Unlocked = true;
        // Only StartCounting or Toast: neither waits on the pipe for long.
        _ = Apply(s, s.Keeper.OnUnlock(OutOfTime(s.Sid, now), now), now);
    }

    /// <summary>Parent mode started while the session is in use: stop counting, as at a lock, and stop locking.</summary>
    private void EnterParentMode(KidSession s, long now)
    {
        s.Unlocked = false;
        s.InParentMode = true;
        s.Keeper.OnLocked();
        logger.LogInformation("{Kid}: parent mode on, not counting", KidName(s.Sid));
        foreach (var sid in _tracker.OnChange(SessionChange.Lock, s.Sid, true, now)) _syncRequests.Writer.TryWrite(sid);
    }

    /// <summary>Parent mode ended: the session counts (or locks) again as if it had just been unlocked.</summary>
    private void LeaveParentMode(KidSession s)
    {
        s.InParentMode = false;
        logger.LogInformation("{Kid}: parent mode over", KidName(s.Sid));
        if (Win.SessionUnlocked(s.SessionId)) Unlock(s);
    }

    /// <summary>The cached snapshot with parent mode as it is now (this PC's code session and End now included).</summary>
    private DeviceState? StateNow(string sid, long now) =>
        _store.LoadState(sid) is { } c ? ParentModes.Effective(c.State, Local(sid), now) : null;

    /// <summary>What this PC did about parent mode for the SID; nothing yet when it did nothing.</summary>
    private LocalParentMode Local(string sid) => _parentLocal.GetValueOrDefault(sid) ?? new LocalParentMode();

    /// <summary>Whether parent mode is on for the SID now.</summary>
    private bool ParentModeOn(string sid, long now) => StateNow(sid, now) is { } state && LockKeeper.ParentModeOn(state, now);

    private bool OutOfTime(string sid, long now)
    {
        if (StateNow(sid, now) is not { } state) return false;
        var result = Engine.Evaluate(TodayInput.For(state, _store.SegmentsSince(sid, TodayInput.DayStartMs(state, now)), now));
        return LockKeeper.OutOfTime(result, state, now);
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
                case "parent-ask" when m.Id is not null && Api(s.Sid) is { } api:
                    _parentAsks[s.Sid] = m.Id;
                    _ = Task.Run(() => AskParents(s, api, m.Id));
                    break;
                case "parent-code" when m.Id is not null:
                    {
                        // The service checks the code: the family secret never goes to the tray (the kid's process).
                        var now = _clock.NowMs();
                        var right = _store.LoadState(s.Sid) is { } c && Totp.Ok(c.State.Family.ParentCodeSecret, m.Text ?? "", now);
                        s.CodeOkAt = right ? now : null;
                        logger.LogInformation("{Kid}: parent code {Right}", KidName(s.Sid), right ? "right" : "wrong");
                        await s.Tray.SendAsync(PipeMessage.Done(m.Id, right));
                        break;
                    }
                case "parent-start" when m.Id is not null:
                    {
                        // Only within 2 minutes of a right code: "How long?" comes straight after it.
                        var now = _clock.NowMs();
                        var ok = s.CodeOkAt is { } at && now - at <= 120_000;
                        if (ok)
                        {
                            s.CodeOkAt = null;
                            _parentLocal[s.Sid] = Local(s.Sid) with { Code = new CodeSession(Guid.NewGuid().ToString(), m.Minutes, now) };
                            logger.LogInformation("{Kid}: parent mode on by code, {Minutes} min", KidName(s.Sid), m.Minutes?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "until ended");
                            _syncRequests.Writer.TryWrite(s.Sid);
                        }
                        await s.Tray.SendAsync(PipeMessage.Done(m.Id, ok));
                        break;
                    }
                case "parent-end" when m.Id is not null:
                    _parentLocal[s.Sid] = Local(s.Sid) with { EndedAtMs = _clock.NowMs(), EndReported = false };
                    logger.LogInformation("{Kid}: parent mode ended on this PC", KidName(s.Sid));
                    await s.Tray.SendAsync(PipeMessage.Done(m.Id, true));
                    _syncRequests.Writer.TryWrite(s.Sid);
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
        if (Live.ParentModeAnswer(frame) is { Active: false, RequestId: { } requestId } no) _ = Task.Run(() => SendParentNo(sid, requestId, no.ByName));
    }

    /// <summary>"I'm the parent": asks every parent through the server and replies with how it went.</summary>
    private async Task AskParents(KidSession s, ApiClient api, string id)
    {
        SendResult result;
        try
        {
            await api.PostDeviceParentModeRequestsAsync(new ParentModeRequestCreate(id), _stopping);
            result = SendResult.Sent;
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
        {
            return;
        }
        catch (Exception e)
        {
            // A 409 means parent mode is already on, which is what the kid wanted.
            result = SendResults.Of(e);
        }
        logger.LogInformation("{Kid}: parent ask sent, {Result}", KidName(s.Sid), result);
        await s.Tray.SendAsync(PipeMessage.Reply(id, result));
    }

    /// <summary>A parent said no to this PC's latest "I'm the parent": "Dad said no." to its trays.</summary>
    private async Task SendParentNo(string sid, string requestId, string? byName)
    {
        await _sem.WaitAsync();
        try
        {
            if (!_parentAsks.TryGetValue(sid, out var asked) || asked != requestId) return;
            var names = _store.LoadState(sid)?.State.Parents.Select(p => p.DisplayName).ToList() ?? [];
            var text = ParentModes.NoText(byName, names);
            logger.LogInformation("{Kid}: parent mode {Text}", KidName(sid), text);
            foreach (var s in _sessions.Values.Where(s => s.Sid == sid).ToList()) await s.Tray.SendAsync(PipeMessage.ParentNo(text));
        }
        finally
        {
            _sem.Release();
        }
    }

    /// <summary>
    /// Sends what the server does not have yet, before each sync: a code session, then an End now (§12.3). Any answer
    /// from the server counts as sent; without a connection it stays for the next sync.
    /// </summary>
    private async Task ReportParentMode(string sid, ApiClient api, CancellationToken ct)
    {
        var local = Local(sid);
        if (!local.Pending) return;
        if (local.Code is { ReportedAtMs: null } code
            && await Delivered(() => api.PostDeviceParentModeAsync(new ParentModeByCode(code.Id, code.DurationMin, Iso(code.StartedAtMs)), ct), ct))
        {
            local = local with { Code = code with { ReportedAtMs = _clock.NowMs() } };
            logger.LogInformation("{Kid}: parent mode reported", KidName(sid));
        }
        if (!local.EndReported && await Delivered(() => api.PostDeviceParentModeEndAsync(ct), ct))
        {
            local = local with { EndReported = true };
            logger.LogInformation("{Kid}: End now reported", KidName(sid));
        }
        _parentLocal[sid] = local;
    }

    /// <summary>True when the server answered (even with an error: sending again would get the same answer).</summary>
    private static async Task<bool> Delivered(Func<Task> send, CancellationToken ct)
    {
        try
        {
            await send();
            return true;
        }
        catch (ApiException)
        {
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>An instant as the API writes it: UTC, milliseconds, Z.</summary>
    private static string Iso(long ms) =>
        DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);

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
        if (StateNow(sid, now) is not { } state) return null;
        var result = Engine.Evaluate(TodayInput.For(state, _store.SegmentsSince(sid, TodayInput.DayStartMs(state, now)), now));
        var last = _lastSync.GetValueOrDefault(sid, (true, null));
        return TrayStatusBuilder.From(state, result, now, last.Online, last.SyncedAtMs);
    }

    /// <summary>Sends <paramref name="view"/> to the session's tray and remembers whether it said locked or parent mode.</summary>
    private async Task SendView(KidSession s, TrayStatus view)
    {
        s.SentLocked = view.Locked;
        s.SentParentMode = view.ParentMode;
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
        await ReportParentMode(sid, api, ct);
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
