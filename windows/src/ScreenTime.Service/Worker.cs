using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using ScreenTime.Core.Api;
using ScreenTime.Core.Games;
using ScreenTime.Core.Programs;
using ScreenTime.Core.Service;
using ScreenTime.Core.Sites;
using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using ScreenTime.Core.Update;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ScreenTime.Service;

/// <summary>
/// The service's options: the data folder, whether it is the secure default, the tray exe (null: no tray), dry-lock
/// (log instead of locking or disconnecting) and whether it runs as a Windows service. <c>Session</c> and <c>TrayOpen</c>
/// are for test runs (<c>--session</c>, <c>--tray-open</c>). <c>FakeClockFile</c>, <c>FakeTimezoneFile</c> and <c>GamesRoot</c> are for test runs too.
/// <c>UpdateAnytime</c> (<c>--update-anytime</c>) installs the update as soon as it is verified, without waiting for the PC to be free.
/// </summary>
public sealed record ServiceOptions(string DataFolder, bool SecureFolder, string? TrayExe, bool DryLock, bool AsService, uint? Session = null,
    string? TrayOpen = null, string? FakeClockFile = null, string? FakeTimezoneFile = null, string? GamesRoot = null, bool UpdateAnytime = false);

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
    private readonly ClockWatch _clockWatch = new();
    private readonly TimeZoneWatch _zoneWatch = new();
    // Websites (docs/SPEC.md §12.10): the lookups and titles this PC collects and uploads.
    private readonly SiteLookupFilter _siteFilter = new();
    private readonly Channel<(DnsLookup, string)> _dnsChannel = Channel.CreateUnbounded<(DnsLookup, string)>();
    private DnsLogSubscriber _dns = null!;
    private LocalStore _store = null!;
    private TrustedClock _clock = null!;
    private SessionTracker _tracker = null!;
    private string _configPath = null!;
    private CancellationToken _stopping;

    /// <summary>True while an update is starting: the tray restart loop and exit judging are off for all sessions.</summary>
    private volatile bool _updateInProgress;

    /// <summary>Set when Windows says it is shutting down: tray exits from then on are not counted (docs/SPEC.md §14).</summary>
    private volatile bool _shuttingDown;

    /// <summary>The accounts whose app version the server has been told since the service started.</summary>
    private readonly HashSet<string> _versionSent = new();

    /// <summary>The known games on this PC (docs/SPEC.md §12.6); null until the first look has finished.</summary>
    private volatile IReadOnlyList<GameShortcut>? _foundGames;

    /// <summary>What the server was last told this PC has, per account, so it is only told again when that changes.</summary>
    private readonly Dictionary<string, string> _gamesSent = new();

    private sealed class KidSession(uint sessionId, string sid, TrayHost tray, CancellationTokenSource cts, ProgramClock programs, TitleClock titles)
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
        public TrayKillWatch TrayKills { get; } = new();
        public bool CaughtPending { get; set; }
        public ProgramClock Programs { get; } = programs;
        public TitleClock Titles { get; } = titles;
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

        // Websites (docs/SPEC.md §12.10): the browser policies, the DNS log and the subscription to its events.
        StartSites();

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
                        var now = clock.NowMs();
                        foreach (var s in _sessions.Values)
                        {
                            foreach (var p in s.Programs.Flush(now)) _store.AddProgramDay(s.Sid, p.Day, p.Id, p.Label, p.Ms);
                            foreach (var t in s.Titles.Flush(now)) _store.AddTitleSpan(s.Sid, t.AtMs, t.Sec, t.Program, t.Title);
                        }
                        foreach (var device in store.Devices()) await SyncAccount(device.Sid, stoppingToken);
                        StartLiveChannels();
                        await UpdateTick(stoppingToken);
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
                        await CheckTamper(now);
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

        // Looking over the disks takes seconds, so it runs beside the loops and never holds their lock.
        var gamesTask = Task.Run(async () =>
        {
            try
            {
                while (!stoppingToken.IsCancellationRequested)
                {
                    var found = GameFinder.Find(options.GamesRoot is { } root ? [root] : Win.GameRoots(), Win.SubFolders, File.Exists);
                    _foundGames = found;
                    logger.LogInformation("games: found {Count} ({Games})", found.Count, string.Join(", ", found.Select(g => g.ExePath)));
                    await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
                }
            }
            catch (OperationCanceledException) { }
        });

        // The DNS lookups: the callback hands them to a channel (docs/SPEC.md §12.10), and one loop reads it,
        // takes the lock like the other handlers, checks the account and parent mode and writes state.db.
        var dnsTask = Task.Run(async () =>
        {
            try
            {
                await foreach (var (lookup, program) in _dnsChannel.Reader.ReadAllAsync(stoppingToken))
                {
                    await sem.WaitAsync(stoppingToken);
                    try
                    {
                        var now = clock.NowMs();
                        var kept = _siteFilter.Decide(lookup, program, _store.GetDevice(lookup.UserSid) is not null, ParentModeOn(lookup.UserSid, now));
                        if (kept is not null) _store.AddSiteLookup(kept.Sid, kept.AtMs, kept.Host, kept.Program);
                    }
                    finally
                    {
                        sem.Release();
                    }
                }
            }
            catch (OperationCanceledException) { }
        });

        await Task.WhenAll(eventsTask, timerTask, lockTask, syncTask, gamesTask, dnsTask);

        foreach (var s in _sessions.Values) s.Cts.Cancel();
        tracker.OnChange(SessionChange.Shutdown, null, false, clock.NowMs());
        _dns.Dispose();
        store.Dispose();
    }

    /// <summary>
    /// Sets up the websites (docs/SPEC.md §12.10) at service start: writes the four browsers' policies, turns on the
    /// DNS Client's operational log and subscribes to its event 3008.
    /// </summary>
    private void StartSites()
    {
        var failed = BrowserPolicies.WriteAll();
        foreach (var (v, error) in failed) logger.LogWarning("sites: could not set browser policy {KeyPath} {Name} ({Error})", v.KeyPath, v.Name, error);
        if (failed.Count == 0) logger.LogInformation("sites: browser policies set");

        if (Win.EnableDnsLog()) logger.LogInformation("sites: dns log on");
        else logger.LogWarning("sites: could not turn the dns log on; it is tried again at the next start");

        _dns = new DnsLogSubscriber((l, p) => _dnsChannel.Writer.TryWrite((l, p)));
        try
        {
            var error = _dns.Subscribe();
            if (error == 0) logger.LogInformation("sites: dns log subscribed");
            else logger.LogWarning("sites: could not subscribe to the dns log (error {Error}); it is tried again at the next start", error);
        }
        catch (Exception e)
        {
            logger.LogWarning("sites: could not subscribe to the dns log ({Message}); it is tried again at the next start", e.Message);
        }
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
                    foreach (var p in s.Programs.Counting(false, now)) _store.AddProgramDay(s.Sid, p.Day, p.Id, p.Label, p.Ms);
                    foreach (var t in s.Titles.Counting(false, now)) _store.AddTitleSpan(s.Sid, t.AtMs, t.Sec, t.Program, t.Title);
                    if (e.Change == SessionChange.Logoff)
                    {
                        s.Cts.Cancel();
                        _sessions.Remove(e.SessionId);
                    }
                }
                break;
            case SessionChange.Suspend:
            case SessionChange.Shutdown:
                if (e.Change == SessionChange.Shutdown) _shuttingDown = true;
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
        var tray = new TrayHost(sessionId, sid, options.TrayExe, options.DryLock, options.AsService, m => OnTrayMessage(sessionId, m), logger, options.TrayOpen, () => OnTrayExit(sessionId), () => _shuttingDown, options.AsService ? () => Win.SessionActive(sessionId) : null, () => _updateInProgress);
        var programs = new ProgramClock(TimeZoneInfo.FindSystemTimeZoneById(_store.GetDevice(sid)!.Timezone));
        var titles = new TitleClock();
        var s = new KidSession(sessionId, sid, tray, cts, programs, titles);
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
            foreach (var p in s.Programs.Counting(false, now)) _store.AddProgramDay(s.Sid, p.Day, p.Id, p.Label, p.Ms);
            foreach (var t in s.Titles.Counting(false, now)) _store.AddTitleSpan(s.Sid, t.AtMs, t.Sec, t.Program, t.Title);
            return;
        }
        s.Unlocked = true;
        foreach (var p in s.Programs.Counting(true, now)) _store.AddProgramDay(s.Sid, p.Day, p.Id, p.Label, p.Ms);
        foreach (var t in s.Titles.Counting(true, now)) _store.AddTitleSpan(s.Sid, t.AtMs, t.Sec, t.Program, t.Title);
        // Only StartCounting or Toast: neither waits on the pipe for long.
        _ = Apply(s, s.Keeper.OnUnlock(OutOfTime(s.Sid, now), now), now);
    }

    /// <summary>Parent mode started while the session is in use: stop counting, as at a lock, and stop locking.</summary>
    private void EnterParentMode(KidSession s, long now)
    {
        s.Unlocked = false;
        s.InParentMode = true;
        s.Keeper.OnLocked();
        foreach (var p in s.Programs.Counting(false, now)) _store.AddProgramDay(s.Sid, p.Day, p.Id, p.Label, p.Ms);
        foreach (var t in s.Titles.Counting(false, now)) _store.AddTitleSpan(s.Sid, t.AtMs, t.Sec, t.Program, t.Title);
        logger.LogInformation("{Kid}: parent mode on, not counting", KidName(s.Sid));
        foreach (var sid in _tracker.OnChange(SessionChange.Lock, s.Sid, true, now)) _syncRequests.Writer.TryWrite(sid);
    }

    /// <summary>Parent mode ended: the session counts (or locks) again as if it had just been unlocked.</summary>
    private void LeaveParentMode(KidSession s)
    {
        s.InParentMode = false;
        logger.LogInformation("{Kid}: parent mode over", KidName(s.Sid));
        // Unlock turns program counting back on; a session that is locked now keeps it off until it is unlocked.
        if (Win.SessionUnlocked(s.SessionId)) Unlock(s);
    }

    /// <summary>The cached snapshot with parent mode as it is now (this PC's code session and End now included).</summary>
    private DeviceState? StateNow(string sid, long now) =>
        _store.LoadState(sid) is { } c ? ParentModes.Effective(c.State, Local(sid), now) : null;

    /// <summary>What this PC did about parent mode for the SID; after a restart, read back from the store (CARD-051).</summary>
    private LocalParentMode Local(string sid)
    {
        if (!_parentLocal.TryGetValue(sid, out var local))
        {
            local = ParentModeJson.Decode(_store.GetValue(sid, "parent-mode"));
            _parentLocal[sid] = local;
        }
        return local;
    }

    /// <summary>Keeps what this PC did about parent mode, in memory and in the store, so a restart keeps it.</summary>
    private void SetLocal(string sid, LocalParentMode local)
    {
        _parentLocal[sid] = local;
        _store.SetValue(sid, "parent-mode", ParentModeJson.Encode(local));
    }

    /// <summary>The wall clock, moved by <c>--fake-clock-file</c> minutes in a test run.</summary>
    private long WallMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + FakeMinutes(options.FakeClockFile) * 60_000L;

    private static long FakeMinutes(string? file) =>
        file is not null && File.Exists(file) && long.TryParse(File.ReadAllText(file).Trim(), out var minutes) ? minutes : 0;

    /// <summary>The PC's time zone id, or the one in <c>--fake-timezone-file</c> in a test run.</summary>
    private string ZoneId()
    {
        if (options.FakeTimezoneFile is { } file && File.Exists(file)) return File.ReadAllText(file).Trim();
        TimeZoneInfo.ClearCachedData();
        return TimeZoneInfo.Local.Id;
    }

    /// <summary>Every second: the wall clock against trusted time, and the time zone (docs/SPEC.md §14).</summary>
    private async Task CheckTamper(long now)
    {
        if (_clockWatch.Check(WallMs(), now, _clock.IsAnchored, Guid.NewGuid().ToString()) is { } clock) await ReportTamper(clock);
        if (_zoneWatch.Check(ZoneId(), now, Guid.NewGuid().ToString()) is { } zone) await ReportTamper(zone);
    }

    /// <summary>A machine-wide attempt (clock, time zone): queued for every enrolled account, and caught in every tray.</summary>
    private async Task ReportTamper(DeviceEventIn e)
    {
        foreach (var device in _store.Devices()) Queue(device.Sid, e with { Id = Guid.NewGuid().ToString() });
        foreach (var s in _sessions.Values.ToList()) await s.Tray.SendAsync(PipeMessage.Caught());
    }

    /// <summary>The tray of a session exited: three times in 10 minutes is an attempt, caught when the tray is back.</summary>
    private void OnTrayExit(uint sessionId) => _ = Task.Run(async () =>
    {
        await _sem.WaitAsync();
        try
        {
            if (!_sessions.TryGetValue(sessionId, out var s)) return;
            // Without its tray nothing is known to be in front, so the last program stops counting (docs/SPEC.md §12.9);
            // the tray sends what is in front again when it is back.
            foreach (var p in s.Programs.Front(null, null, _clock.NowMs())) _store.AddProgramDay(s.Sid, p.Day, p.Id, p.Label, p.Ms);
            foreach (var t in s.Titles.Front(null, null, _clock.NowMs())) _store.AddTitleSpan(s.Sid, t.AtMs, t.Sec, t.Program, t.Title);
            if (s.TrayKills.OnExit(_clock.NowMs(), Guid.NewGuid().ToString()) is not { } e) return;
            Queue(s.Sid, e);
            s.CaughtPending = true;
        }
        finally
        {
            _sem.Release();
        }
    });

    /// <summary>Puts a tamper event in the account's outbox (sent before the next sync, again until the server has it).</summary>
    private void Queue(string sid, DeviceEventIn e)
    {
        _store.Enqueue(sid, "event", TamperEvents.Encode(e), _clock.NowMs());
        logger.LogWarning("{Kid}: tamper {Kind}", KidName(sid), e.Kind);
        _syncRequests.Writer.TryWrite(sid);
    }

    /// <summary>Sends the account's queued tamper events (docs/SPEC.md §14): any answer from the server counts as sent.</summary>
    private async Task ReportEvents(string sid, ApiClient api, CancellationToken ct)
    {
        var items = _store.PeekOutbox(sid, 50).Where(i => i.Kind == "event").ToList();
        if (items.Count == 0) return;
        var events = items.Select(i => TamperEvents.Decode(i.Body)).OfType<DeviceEventIn>().ToList();
        if (!await Delivered(() => api.PostDeviceEventsAsync(new DeviceEventUpload(events), ct), ct)) return;
        foreach (var item in items) _store.RemoveOutbox(item.Id);
        logger.LogInformation("{Kid}: {Count} tamper events sent", KidName(sid), events.Count);
    }

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
                    await SendGames(s);
                    await PublishUpdate(force: true);
                    // A tray killed three times was dead when it was caught: it hears it now.
                    if (s.CaughtPending)
                    {
                        s.CaughtPending = false;
                        await s.Tray.SendAsync(PipeMessage.Caught());
                    }
                    break;
                case "update-check" or "update-now" when m.Id is not null:
                    {
                        var kind = m.Type == "update-now" ? UpdateRequestKind.Now : UpdateRequestKind.Check;
                        var (allowed, asked) = UpdateControl.Request(kind, s.InParentMode, _asked);
                        if (!allowed)
                        {
                            logger.LogInformation("update: refused, not in parent mode");
                            await s.Tray.SendAsync(PipeMessage.Reply(m.Id, SendResult.Refused));
                            break;
                        }
                        _asked = asked;
                        if (kind == UpdateRequestKind.Check) _forceCheck = true;
                        await s.Tray.SendAsync(PipeMessage.Reply(m.Id, SendResult.Sent));
                        await PublishUpdate(force: true);
                        break;
                    }
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
                            SetLocal(s.Sid, Local(s.Sid) with { Code = new CodeSession(Guid.NewGuid().ToString(), m.Minutes, now) });
                            logger.LogInformation("{Kid}: parent mode on by code, {Minutes} min", KidName(s.Sid), m.Minutes?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "until ended");
                            _syncRequests.Writer.TryWrite(s.Sid);
                        }
                        await s.Tray.SendAsync(PipeMessage.Done(m.Id, ok));
                        break;
                    }
                case "parent-end" when m.Id is not null:
                    SetLocal(s.Sid, Local(s.Sid) with { EndedAtMs = _clock.NowMs(), EndReported = false });
                    logger.LogInformation("{Kid}: parent mode ended on this PC", KidName(s.Sid));
                    await s.Tray.SendAsync(PipeMessage.Done(m.Id, true));
                    _syncRequests.Writer.TryWrite(s.Sid);
                    break;
                case "locked":
                    s.Keeper.OnLockConfirmed();
                    logger.LogInformation("tray {Session}: locked", sessionId);
                    break;
                case "front":
                    {
                        var now = _clock.NowMs();
                        var pieces = s.Programs.Front(m.Program, m.Text, now);
                        foreach (var p in pieces) _store.AddProgramDay(s.Sid, p.Day, p.Id, p.Label, p.Ms);
                        var titleSpans = s.Titles.Front(m.Program, m.Title, now);
                        foreach (var t in titleSpans) _store.AddTitleSpan(s.Sid, t.AtMs, t.Sec, t.Program, t.Title);
                        logger.LogInformation("tray {Session}: front {Program} {Label} {Title}", sessionId, m.Program ?? "nothing", m.Text, m.Title);
                        break;
                    }
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
        SetLocal(sid, local);
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
        await ReportEvents(sid, api, ct);
        await ReportGames(sid, api, ct);
        await ReportPrograms(sid, api, ct);
        await ReportSiteLookups(sid, api, ct);
        await ReportSiteTitles(sid, api, ct);
        var synced = await syncer.SyncAsync(ct);
        if (synced && !_versionSent.Contains(sid)) await ReportVersion(sid, api, ct);
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
                await SendGames(s);
            }
        }
    }

    /// <summary>
    /// Sends the stored program time to the server (docs/SPEC.md §12.9), once per account per sync, and again only
    /// when the body changes. Prunes program_days older than 31 days after sending.
    /// </summary>
    private async Task ReportPrograms(string sid, ApiClient api, CancellationToken ct)
    {
        var device = _store.GetDevice(sid);
        if (device is null) return;
        var rows = _store.ProgramDays(sid).Select(r => new ProgramUpload.ProgramDay(r.Day, r.Id, r.Label, r.Ms)).ToList();
        var body = ProgramUpload.Build(rows, device.Timezone, _clock.NowMs());
        if (body is null) return;
        var key = "program-usage-sent";
        var json = JsonSerializer.Serialize(body, ApiJsonContext.Default.DeviceAppUsageUpload);
        if (_store.GetValue(sid, key) == json) return;
        try
        {
            await api.PostDeviceAppUsageAsync(body, ct);
            _store.SetValue(sid, key, json);
            var days = body.Days.Count;
            var first = body.Days[0].Day;
            var last = body.Days[body.Days.Count - 1].Day;
            logger.LogInformation("{Kid}: programs: sent {Days} days ({First}..{Last})", KidName(sid), days, first, last);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception e)
        {
            logger.LogWarning("{Kid}: could not report programs ({Message})", KidName(sid), e.Message);
        }
        // Prune program_days older than 31 days.
        var tz = TimeZoneInfo.FindSystemTimeZoneById(device.Timezone);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(_clock.NowMs()), tz).DateTime);
        var before = today.AddDays(-31).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        _store.PruneProgramDays(sid, before);
    }

    /// <summary>
    /// Sends the stored website lookups to the server (docs/SPEC.md §12.10), the oldest 1,000 at a call, at most 10
    /// calls per sync. On a failure the rows stay.
    /// </summary>
    private async Task ReportSiteLookups(string sid, ApiClient api, CancellationToken ct)
    {
        var device = _store.GetDevice(sid);
        if (device is null) return;
        var sent = 0;
        var received = 0;
        for (var call = 0; call < 10; call++)
        {
            var rows = _store.PeekSiteLookups(sid, 1000);
            if (rows.Count == 0) break;
            try
            {
                var body = new SiteLookupsUpload(rows.Select(r => new SiteLookupIn(IsoUtc.ToIso(r.AtMs), r.Host, r.Program)).ToList());
                var res = await api.PostDeviceSiteLookupsAsync(body, ct);
                _store.RemoveSiteLookups(rows.Select(r => r.Id).ToArray());
                sent += rows.Count;
                received += res.Received;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception e)
            {
                logger.LogWarning("{Kid}: could not send site lookups ({Message})", KidName(sid), e.Message);
                break;
            }
        }
        if (sent > 0) logger.LogInformation("{Kid}: sites: sent {Sent} ({Received} new)", KidName(sid), sent, received);
    }

    /// <summary>
    /// Sends the stored browser title spans to the server (docs/SPEC.md §12.10), the oldest 500 at a call, at most 10
    /// calls per sync. On a failure the rows stay.
    /// </summary>
    private async Task ReportSiteTitles(string sid, ApiClient api, CancellationToken ct)
    {
        var device = _store.GetDevice(sid);
        if (device is null) return;
        var sent = 0;
        var received = 0;
        for (var call = 0; call < 10; call++)
        {
            var rows = _store.PeekTitleSpans(sid, 500);
            if (rows.Count == 0) break;
            try
            {
                var body = new SiteTitlesUpload(rows.Select(r => new SiteTitleIn(IsoUtc.ToIso(r.AtMs), r.Sec, r.Program, r.Title)).ToList());
                var res = await api.PostDeviceSiteTitlesAsync(body, ct);
                _store.RemoveTitleSpans(rows.Select(r => r.Id).ToArray());
                sent += rows.Count;
                received += res.Received;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }

            catch (Exception e)
            {
                logger.LogWarning("{Kid}: could not send site titles ({Message})", KidName(sid), e.Message);
                break;
            }
        }
        if (sent > 0) logger.LogInformation("{Kid}: sites: titles sent {Sent} ({Received} new)", KidName(sid), sent, received);
    }

    /// <summary>
    /// Tells the server which known games this PC has (docs/SPEC.md §12.6), once per account, and again only when the
    /// list changes. Nothing is sent before the first look has finished.
    /// </summary>
    private async Task ReportGames(string sid, ApiClient api, CancellationToken ct)
    {
        if (_foundGames is not { } found) return;
        var key = string.Join("|", found.Select(g => g.Id + "=" + g.ExePath));
        if (_gamesSent.GetValueOrDefault(sid) == key) return;
        try
        {
            await api.PutDeviceGamesAsync(new DeviceGamesPut(found.Select(g => new FoundGameIn(g.Id, g.Label, g.ExePath)).ToList()), ct);
            _gamesSent[sid] = key;
            logger.LogInformation("{Kid}: told the server {Count} games", KidName(sid), found.Count);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception e)
        {
            logger.LogWarning("{Kid}: could not report the games ({Message})", KidName(sid), e.Message);
        }
    }

    /// <summary>Sends the session's tray the games that get a desktop shortcut, from the saved snapshot; none before the first sync.</summary>
    private async Task SendGames(KidSession s)
    {
        var games = _store.LoadState(s.Sid)?.State.Games ?? [];
        await s.Tray.SendAsync(PipeMessage.GamesOf(games.Select(g => new GameShortcut(g.Id, g.Label, g.ExePath)).ToList()));
    }

    /// <summary>
    /// Tells the server this PC's app version once per account and start, for the parents' Devices panel. Before this
    /// the server only had the version from enrolment, which was always 0.1.0 (Conor's PC on 0.1.81, 13 Nov 2026).
    /// </summary>
    private async Task ReportVersion(string sid, ApiClient api, CancellationToken ct)
    {
        try
        {
            var (code, name) = Win.AppVersion();
            await api.PostDeviceAppUpdateCheckAsync(new AppUpdateCheck(code, name), ct);
            _versionSent.Add(sid);
            logger.LogInformation("{Kid}: told the server version {Version}", KidName(sid), name);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception e)
        {
            logger.LogWarning("{Kid}: could not report the version ({Message})", KidName(sid), e.Message);
        }
    }

    // The Windows self-update (docs/SPEC.md §12.2): check, download, verify and install, all from the service. The
    // rules are in ScreenTime.Core.Update (UpdateDecision); this carries out what they decide.

    private const string UpdateKey = "update";

    /// <summary>The latest offer each account got, by SID: the download uses the token of the account it came from.</summary>
    private readonly Dictionary<string, Offer> _offers = new();
    private long? _lastUpdateCheckMs;
    private VerifiedDownload? _verified;
    private int? _verifiedVersionCode;
    private PendingUpdate? _pending;
    private bool _pendingLoaded;

    // CARD-071: manual update trigger state (tap not yet acted on, not persisted).
    private bool _asked;
    private bool _forceCheck;
    private bool _downloading;
    private LastCheckState _lastCheck = LastCheckState.Never;
    private UpdateView? _sentUpdate;

    /// <summary>Builds the current <see cref="UpdateView"/> from the live service state (pure facts only).</summary>
    private UpdateView CurrentUpdateView()
    {
        var (code, name) = Win.AppVersion();
        var best = BestOffer(code);
        var downloaded = best is not null && _verifiedVersionCode == best.Value.Offer.VersionCode && _verified is not null;
        var failures = best is { } b ? UpdateFailures.For(UpdateFailures.Decode(_store.GetValue(UpdateKey, "failures")), b.Offer.VersionCode) : 0;
        var lastAttemptFailed = best is not null && failures > 0;
        var facts = new UpdateViewFacts(name, code, best?.Offer, downloaded, _downloading, _pending, lastAttemptFailed, _lastCheck);
        return UpdateViewBuilder.Build(facts);
    }

    /// <summary>Sends the current update view to every tray when it has changed (or <paramref name="force"/> is true).</summary>
    private async Task PublishUpdate(bool force = false)
    {
        var view = CurrentUpdateView();
        if (!force && view == _sentUpdate) return;
        _sentUpdate = view;
        foreach (var s in _sessions.Values.ToList()) await s.Tray.SendAsync(PipeMessage.UpdateOf(view));
    }

    /// <summary>
    /// One tick of the update loop, from the 60 s timer (under the worker's lock). Steps follow each other at once, so a
    /// check, a download and an install can happen on one tick; at most six steps, so a mistake cannot spin.
    /// </summary>
    private async Task UpdateTick(CancellationToken ct)
    {
        if (!_pendingLoaded)
        {
            _pending = PendingUpdateJson.Decode(_store.GetValue(UpdateKey, "pending"));
            _pendingLoaded = true;
        }
        // A manual "Check for updates": one extra check at the next tick, without moving the 6-hour timer.
        if (_forceCheck && _pending is null)
        {
            _forceCheck = false;
            _lastCheck = LastCheckState.Running;
            await PublishUpdate();
            await CheckForUpdate(ct, moveTimer: false);
        }
        for (var step = 0; step < 6; step++)
        {
            var now = _clock.NowMs();
            var (runningCode, _) = Win.AppVersion();
            var best = BestOffer(runningCode);
            var failures = best is { } b ? UpdateFailures.For(UpdateFailures.Decode(_store.GetValue(UpdateKey, "failures")), b.Offer.VersionCode) : 0;
            var action = UpdateDecision.Decide(new UpdateState(
                _pending, _lastUpdateCheckMs, best?.Offer, _verifiedVersionCode, _verified?.VerifiedAtMs, failures,
                AnySessionUsing(), options.UpdateAnytime, runningCode, now, _asked));
            switch (action)
            {
                case UpdateAction.Nothing:
                    if (best is null && _pending is null) DropDownload();
                    await PublishUpdate();
                    return;
                case UpdateAction.Check:
                    await CheckForUpdate(ct, moveTimer: true);
                    await PublishUpdate();
                    if (_lastUpdateCheckMs is null) return;
                    break;
                case UpdateAction.Download:
                    var offered = best!.Value;
                    logger.LogInformation("update: offered {Version} ({Code})", offered.Offer.VersionName, offered.Offer.VersionCode);
                    _downloading = true;
                    await PublishUpdate();
                    var ok = await DownloadAndVerify(offered.Sid, offered.Offer, ct);
                    _downloading = false;
                    if (!ok)
                    {
                        // Tried again at the next check (6 hours), not every minute: a bad file would be downloaded over and over.
                        _offers.Remove(offered.Sid);
                        _asked = false;
                        await PublishUpdate();
                        return;
                    }
                    await PublishUpdate();
                    break;
                case UpdateAction.Install:
                    _asked = false;
                    if (!options.AsService)
                    {
                        logger.LogInformation("update: would install {Version} (not a service)", best!.Value.Offer.VersionName);
                        await PublishUpdate();
                        return;
                    }
                    await Install(best!.Value.Offer, ct);
                    return;
                case UpdateAction.RecordSuccess:
                    logger.LogInformation("update: now {Version}", _pending!.VersionName);
                    DeleteUpdateTask();
                    DropDownload();
                    DeleteUpdateFile(_pending.VersionName);
                    _store.SetValue(UpdateKey, "pending", null);
                    _store.SetValue(UpdateKey, "failures", null);
                    _pending = null;
                    _asked = false;
                    await PublishUpdate();
                    break;
                case UpdateAction.RecordFailure:
                    logger.LogWarning("update: {Version} failed to install", _pending!.VersionName);
                    CountFailure(_pending.VersionCode);
                    DeleteUpdateTask();
                    _store.SetValue(UpdateKey, "pending", null);
                    _pending = null;
                    _asked = false;
                    // The trays may start again.
                    _updateInProgress = false;
                    await PublishUpdate();
                    break;
            }
        }
    }

    /// <summary>Asks the server for a newer version for every enrolled account, and keeps what each was offered.
    /// <paramref name="moveTimer"/> true: the 6-hour timer's last-check time moves; false: a manual check does not move it.</summary>
    private async Task CheckForUpdate(CancellationToken ct, bool moveTimer)
    {
        _lastCheck = LastCheckState.Running;
        await PublishUpdate();
        var (code, name) = Win.AppVersion();
        var answered = false;
        foreach (var device in _store.Devices())
        {
            if (Api(device.Sid) is not { } api) continue;
            try
            {
                var answer = await api.PostDeviceAppUpdateCheckAsync(new AppUpdateCheck(code, name), ct);
                answered = true;
                if (answer.Offer is { } o) _offers[device.Sid] = new Offer(o.VersionCode, o.VersionName, o.Sha256, o.SizeBytes);
                else _offers.Remove(device.Sid);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception e)
            {
                logger.LogWarning("update: could not check for {Kid} ({Message})", KidName(device.Sid), e.Message);
            }
        }
        _lastCheck = answered ? LastCheckState.Ok : LastCheckState.Failed;
        // A check that reached nobody is tried again at the next tick; a successful check moves the 6-hour timer.
        if (moveTimer && answered)
        {
            _lastUpdateCheckMs = _clock.NowMs();
        }
        if (answered) logger.LogInformation("update: checked, {Count} offer(s)", _offers.Count);
        await PublishUpdate();
    }

    /// <summary>The highest offer above the running version, with the SID of the account that got it; null when none.</summary>
    private (string Sid, Offer Offer)? BestOffer(int runningCode)
    {
        if (UpdateOffer.Best(_offers.Values.ToList(), runningCode) is not { } best) return null;
        var sid = _offers.First(o => o.Value.VersionCode == best.VersionCode).Key;
        return (sid, best);
    }

    /// <summary>Adds one failed attempt at <paramref name="versionCode"/> to the stored count.</summary>
    private void CountFailure(int versionCode)
    {
        var after = UpdateFailures.After(UpdateFailures.Decode(_store.GetValue(UpdateKey, "failures")), versionCode);
        _store.SetValue(UpdateKey, "failures", UpdateFailures.Encode(after));
        if (UpdateAttempt.GiveUp(after.Count)) logger.LogWarning("update: version {Code} failed {Count} times, not trying it again", versionCode, after.Count);
    }

    /// <summary>True when any enrolled account's session is unlocked or in parent mode.</summary>
    private bool AnySessionUsing() => _sessions.Values.Any(s => s.Unlocked || s.InParentMode);

    /// <summary>
    /// Downloads the offer's MSI with the token of the account that was offered it, into a <c>.part</c> file, and keeps it
    /// only when its size and SHA-256 match. A verified file already there is kept, with the time it was first verified.
    /// </summary>
    private async Task<bool> DownloadAndVerify(string sid, Offer offer, CancellationToken ct)
    {
        var partPath = UpdateFile.PartPath(options.DataFolder, offer.VersionName);
        var finalPath = UpdateFile.Path(options.DataFolder, offer.VersionName);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);
            if (File.Exists(finalPath) && UpdateVerify.Matches(new FileInfo(finalPath).Length, await Sha256HexAsync(finalPath), offer.SizeBytes, offer.Sha256))
            {
                var firstVerified = _verifiedVersionCode == offer.VersionCode && _verified is { } v ? v.VerifiedAtMs : _clock.NowMs();
                Verified(offer, finalPath, firstVerified);
                return true;
            }
            var config = ServiceFiles.LoadConfig(_configPath);
            var device = _store.GetDevice(sid);
            if (config is null || device is null) return false;
            using var http = new HttpClient { BaseAddress = new Uri(config.ServerUrl), Timeout = TimeSpan.FromMinutes(10) };
            using var request = new HttpRequestMessage(HttpMethod.Get, "v1/device/app-update/msi");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Encoding.UTF8.GetString(Win.Unprotect(device.Token)));
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("update: download said {Status}", (int)response.StatusCode);
                return false;
            }
            await using (var stream = await response.Content.ReadAsStreamAsync(ct))
            await using (var part = File.Open(partPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                await stream.CopyToAsync(part, ct);
            }
            var size = new FileInfo(partPath).Length;
            var sha = await Sha256HexAsync(partPath);
            if (!UpdateVerify.Matches(size, sha, offer.SizeBytes, offer.Sha256))
            {
                File.Delete(partPath);
                logger.LogWarning("update: the file does not match the offer ({Size} bytes, sha256 {Sha}), deleted", size, sha);
                return false;
            }
            File.Move(partPath, finalPath, overwrite: true);
            logger.LogInformation("update: downloaded {Version}", offer.VersionName);
            Verified(offer, finalPath, _clock.NowMs());
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception e)
        {
            logger.LogWarning("update: download failed ({Message})", e.Message);
            try { File.Delete(partPath); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            return false;
        }
    }

    private void Verified(Offer offer, string path, long at)
    {
        _verified = new VerifiedDownload(path, at);
        _verifiedVersionCode = offer.VersionCode;
    }

    /// <summary>
    /// Closes the trays and starts the installer from a one-time SYSTEM task. The trays stay closed until the attempt is
    /// over: the MSI stops this service, or the attempt is counted as failed 10 minutes later.
    /// </summary>
    private async Task Install(Offer offer, CancellationToken ct)
    {
        if (_verified is not { } verified) return;
        _updateInProgress = true;
        foreach (var s in _sessions.Values.ToList()) await s.Tray.SendAsync(PipeMessage.Quit());
        await WaitTraysExit(10_000, ct);
        var log = Path.Combine(options.DataFolder, "updates", "install.log");
        var command = $"msiexec.exe /i \\\"{verified.Path}\\\" /qn /norestart /l*v \\\"{log}\\\"";
        if (!RunSchtasks($"/Create /TN ScreenTimeUpdate /TR \"{command}\" /SC ONCE /ST 00:00 /RU SYSTEM /RL HIGHEST /F", "create")
            || !RunSchtasks("/Run /TN ScreenTimeUpdate", "run"))
        {
            CountFailure(offer.VersionCode);
            DeleteUpdateTask();
            _updateInProgress = false;
            return;
        }
        _pending = new PendingUpdate(offer.VersionCode, offer.VersionName, _clock.NowMs());
        _store.SetValue(UpdateKey, "pending", PendingUpdateJson.Encode(_pending));
        logger.LogInformation("update: installing {Version}", offer.VersionName);
    }

    /// <summary>Runs <c>schtasks.exe</c> and waits for it; false (logged) when it fails.</summary>
    private bool RunSchtasks(string arguments, string what)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("schtasks.exe", arguments)
                { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true });
            if (p is null) return false;
            var output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
            if (!p.WaitForExit(30_000)) return false;
            if (p.ExitCode == 0) return true;
            logger.LogWarning("update: could not {What} the task (exit {Code}: {Output})", what, p.ExitCode, output.Trim());
            return false;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            logger.LogWarning("update: could not {What} the task ({Message})", what, e.Message);
            return false;
        }
    }

    /// <summary>Waits up to <paramref name="timeoutMs"/> for the trays this service started to exit, then kills the rest.</summary>
    private async Task WaitTraysExit(int timeoutMs, CancellationToken ct)
    {
        var pids = _sessions.Values.Select(s => s.Tray.TrayPid).Where(p => p > 0).ToList();
        var deadline = Environment.TickCount64 + timeoutMs;
        while (pids.Any(Running) && Environment.TickCount64 < deadline) await Task.Delay(250, ct);
        foreach (var pid in pids.Where(Running))
        {
            try
            {
                using var p = Process.GetProcessById(pid);
                p.Kill();
                logger.LogInformation("update: tray {Pid} did not quit, killed", pid);
            }
            catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        }

        static bool Running(int pid)
        {
            try
            {
                using var p = Process.GetProcessById(pid);
                return !p.HasExited;
            }
            catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                return false;
            }
        }
    }

    /// <summary>Forgets a verified download that is no longer offered, and deletes its file.</summary>
    private void DropDownload()
    {
        if (_verified is { } v)
        {
            try { File.Delete(v.Path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
        _verified = null;
        _verifiedVersionCode = null;
    }

    private void DeleteUpdateFile(string versionName)
    {
        try { File.Delete(UpdateFile.Path(options.DataFolder, versionName)); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    /// <summary>Deletes the ScreenTimeUpdate task when it is there (quietly when it is not).</summary>
    private void DeleteUpdateTask()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("schtasks.exe", "/Delete /TN ScreenTimeUpdate /F")
                { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true });
            p?.WaitForExit(10_000);
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { }
    }

    /// <summary>The SHA-256 of a file, lower-case hex.</summary>
    private static async Task<string> Sha256HexAsync(string path)
    {
        await using var stream = File.OpenRead(path);
        var hash = await System.Security.Cryptography.SHA256.HashDataAsync(stream);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
