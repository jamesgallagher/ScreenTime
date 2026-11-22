using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using ScreenTime.Core.Service;
using Microsoft.Extensions.Logging;

namespace ScreenTime.Service;

/// <summary>
/// The tray of one kid session (docs/SPEC.md §12.2): the named pipe <c>ScreenTime.&lt;sessionId&gt;</c> with JSON lines,
/// and, when <c>trayExe</c> is set, a loop that starts the tray in the session and starts it again when it exits.
/// </summary>
public sealed class TrayHost(uint sessionId, string kidSid, string? trayExe, bool dryLock, bool asService, Func<PipeMessage, Task> onMessage, ILogger logger, string? trayOpen = null, Action? onTrayExit = null, Func<bool>? shuttingDown = null, Func<bool>? sessionActive = null, Func<bool>? updateInProgress = null)
{
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);
    private volatile int _trayPid;

    /// <summary>One connection to the tray's pipe: writes go through it, and a write given up drops the whole link.</summary>
    private sealed class Link
    {
        public Stream? Stream;                 // the connected pipe; null once it is dropped
        public readonly SemaphoreSlim Gate = new(1, 1);
        public volatile bool Dropped;          // a write was given up: this link is never used again
    }

    private volatile Link? _link;
    private volatile NamedPipeServerStream? _server;

    /// <summary>The PID of the tray this host started, or 0 when none is running.</summary>
    public int TrayPid => _trayPid;

    public Task RunAsync(CancellationToken ct)
    {
        var pipe = PipeLoopAsync(ct);
        return trayExe is null ? pipe : Task.WhenAll(pipe, TrayLoopAsync(trayExe, ct));
    }

    /// <summary>True while an update is starting: the restart loop and exit judging are off for this session.</summary>
    private bool UpdateInProgress() => updateInProgress?.Invoke() ?? false;

    /// <summary>
    /// Sends one message to the tray. Never throws. The write is bounded at 3 s and the pipe is dropped, so a tray
    /// that is alive but not reading can no longer hold the service (docs/SPEC.md §12.2 "Stall guard"): this returns,
    /// the tray reconnects as it does after any pipe loss, and a later message goes to the reconnected tray.
    /// </summary>
    public async Task SendAsync(PipeMessage message)
    {
        try
        {
            var link = _link;
            if (link is null || link.Dropped) return;
            var stream = link.Stream;
            if (stream is null) return;
            if (!await link.Gate.WaitAsync(BoundedWrite.GiveUpMs))
            {
                Drop(link, "a write before it has not finished");
                return;
            }
            try
            {
                var outcome = await BoundedWrite.LineAsync(stream, Encoding.UTF8.GetBytes(PipeMessage.Encode(message) + "\n"));
                if (outcome != WriteOutcome.Written) Drop(link, outcome == WriteOutcome.GivenUp ? "3 s without the tray reading it" : "the pipe write failed");
            }
            finally
            {
                // The gate is released only when the link was not dropped: a dropped link is never used again.
                if (!link.Dropped) link.Gate.Release();
            }
        }
        catch (Exception) { }
    }

    /// <summary>
    /// Drops <paramref name="link"/>: it is never used again, and the pipe is disconnected so the tray reconnects
    /// as it does after any pipe loss.
    /// </summary>
    private void Drop(Link link, string why)
    {
        link.Dropped = true;
        if (ReferenceEquals(_link, link)) _link = null;
        logger.LogWarning("tray {Session}: pipe write given up ({Why}), disconnecting the pipe", sessionId, why);
        try
        {
            var server = _server;
            if (server is not null && server.IsConnected) server.Disconnect();
        }
        catch (IOException) { }
        catch (InvalidOperationException) { }
    }

    private async Task PipeLoopAsync(CancellationToken ct)
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(kidSid), PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize, AccessControlType.Allow));
        using var server = NamedPipeServerStreamAcl.Create($"ScreenTime.{sessionId}", PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, security);
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await server.WaitForConnectionAsync(ct);
                logger.LogInformation("tray {Session}: pipe connected", sessionId);
                var reader = new StreamReader(server, Utf8, detectEncodingFromByteOrderMarks: false, bufferSize: 1024, leaveOpen: true);
                // The bytes are written straight to the stream, never through a StreamWriter, so BoundedWrite sees the real pipe write.
                _server = server;
                _link = new Link { Stream = server };
                try
                {
                    while (await reader.ReadLineAsync(ct) is { } line)
                    {
                        if (PipeMessage.Decode(line) is { } message) await onMessage(message);
                    }
                }
                catch (IOException) { }
                logger.LogInformation("tray {Session}: pipe closed", sessionId);
                _link = null;
                _server = null;
                reader.Dispose();
                if (server.IsConnected) server.Disconnect();
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            _link = null;
            _server = null;
        }
    }

    private async Task TrayLoopAsync(string exe, CancellationToken ct)
    {
        var arguments = $"--pipe ScreenTime.{sessionId}" + (dryLock ? " --dry-lock" : "") + (trayOpen is null ? "" : $" --open {trayOpen}");
        // Before this host starts its own tray: a restarted service must not leave two trays in a session (CARD-049b).
        CloseOtherTrays();
        try
        {
            while (!ct.IsCancellationRequested)
            {
                int pid;
                try
                {
                    pid = asService
                        ? Win.StartInSession(sessionId, exe, arguments)
                        : Process.Start(new ProcessStartInfo(exe, arguments) { UseShellExecute = false })!.Id;
                }
                catch (Exception e)
                {
                    logger.LogWarning("tray {Session}: could not start ({Message})", sessionId, e.Message);
                    await Task.Delay(TimeSpan.FromSeconds(5), ct);
                    continue;
                }
                _trayPid = pid;
                logger.LogInformation("tray {Session}: started pid {Pid}", sessionId, pid);
                try
                {
                    using var process = Process.GetProcessById(pid);
                    await process.WaitForExitAsync(ct);
                }
                catch (ArgumentException) { }
                _trayPid = 0;
                logger.LogInformation("tray {Session}: exited", sessionId);
                // Off while an update is starting: the tray is not restarted and its exit is not judged (docs/SPEC.md §12.2).
                if (!UpdateInProgress())
                {
                    _ = JudgeExitAsync(ct);
                }
                await Task.Delay(TimeSpan.FromSeconds(1), ct);
                // Not into a session that is ending or a PC that is shutting down: it would only be closed again.
                // While an update is in progress, wait (not start the tray) until it is over.
                while (!InUse() || UpdateInProgress())
                {
                    if (UpdateInProgress())
                    {
                        logger.LogInformation("tray {Session}: update in progress, waiting", sessionId);
                    }
                    else
                    {
                        logger.LogInformation("tray {Session}: session not in use, waiting to start the tray", sessionId);
                    }
                    await Task.Delay(TimeSpan.FromSeconds(5), ct);
                }
                logger.LogInformation("tray {Session}: starting again", sessionId);
            }
        }
        catch (OperationCanceledException) { }
    }

    /// <summary>
    /// Closes any ScreenTime.Tray left in this session by the previous service run, before this host starts its own
    /// (CARD-049b: a restarted service must not leave two trays in a session). Processes in other sessions are left alone.
    /// </summary>
    private void CloseOtherTrays()
    {
        try
        {
            foreach (var p in Process.GetProcessesByName("ScreenTime.Tray"))
            {
                using (p)
                {
                    if (p.Id == _trayPid || p.SessionId != (int)sessionId) continue;
                    logger.LogInformation("tray {Session}: closing the tray left by the previous service run (pid {Pid})", sessionId, p.Id);
                    try
                    {
                        p.Kill();
                    }
                    catch (InvalidOperationException) { }
                    catch (System.ComponentModel.Win32Exception) { }
                    catch (NotSupportedException) { }
                }
            }
        }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException)
        {
            logger.LogWarning("tray {Session}: could not look for trays left by the previous run ({Message})", sessionId, e.Message);
        }
    }

    /// <summary>True while the session is in use and the PC is not shutting down.</summary>
    private bool InUse() => !(shuttingDown?.Invoke() ?? false) && (sessionActive?.Invoke() ?? true);

    /// <summary>
    /// Counts an exit toward a tamper attempt only if, <see cref="TrayExit.DelayMs"/> later, the session is still going
    /// and in use and the PC is not shutting down (docs/SPEC.md §14). A sign-out cancels <paramref name="ct"/>.
    /// </summary>
    private async Task JudgeExitAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(TrayExit.DelayMs, ct);
        }
        catch (OperationCanceledException) { }
        var counts = TrayExit.Counts(ct.IsCancellationRequested, shuttingDown?.Invoke() ?? false, sessionActive?.Invoke() ?? true);
        logger.LogInformation("tray {Session}: exit {Verdict}", sessionId, counts ? "counted" : "not counted (session or PC ending)");
        if (counts) onTrayExit?.Invoke();
    }
}
