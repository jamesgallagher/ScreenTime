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
public sealed class TrayHost(uint sessionId, string kidSid, string? trayExe, bool dryLock, bool asService, Func<PipeMessage, Task> onMessage, ILogger logger)
{
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);
    private readonly SemaphoreSlim _write = new(1, 1);
    private StreamWriter? _writer;

    public Task RunAsync(CancellationToken ct)
    {
        var pipe = PipeLoopAsync(ct);
        return trayExe is null ? pipe : Task.WhenAll(pipe, TrayLoopAsync(trayExe, ct));
    }

    public async Task SendAsync(PipeMessage message)
    {
        await _write.WaitAsync();
        try
        {
            if (_writer is null) return;
            await _writer.WriteAsync(PipeMessage.Encode(message) + "\n");
            await _writer.FlushAsync();
        }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
        finally
        {
            _write.Release();
        }
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
                await SetWriterAsync(new StreamWriter(server, Utf8, bufferSize: 1024, leaveOpen: true));
                try
                {
                    while (await reader.ReadLineAsync(ct) is { } line)
                    {
                        if (PipeMessage.Decode(line) is { } message) await onMessage(message);
                    }
                }
                catch (IOException) { }
                logger.LogInformation("tray {Session}: pipe closed", sessionId);
                await SetWriterAsync(null);
                reader.Dispose();
                if (server.IsConnected) server.Disconnect();
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            await SetWriterAsync(null);
        }
    }

    private async Task SetWriterAsync(StreamWriter? writer)
    {
        await _write.WaitAsync();
        try
        {
            _writer?.Dispose();
            _writer = writer;
        }
        catch (IOException) { }
        finally
        {
            _write.Release();
        }
    }

    private async Task TrayLoopAsync(string exe, CancellationToken ct)
    {
        var arguments = $"--pipe ScreenTime.{sessionId}" + (dryLock ? " --dry-lock" : "");
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
                logger.LogInformation("tray {Session}: started pid {Pid}", sessionId, pid);
                try
                {
                    using var process = Process.GetProcessById(pid);
                    await process.WaitForExitAsync(ct);
                }
                catch (ArgumentException) { }
                logger.LogInformation("tray {Session}: exited, starting again", sessionId);
                await Task.Delay(TimeSpan.FromSeconds(1), ct);
            }
        }
        catch (OperationCanceledException) { }
    }
}
