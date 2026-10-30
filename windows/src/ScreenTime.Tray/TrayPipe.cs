using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using ScreenTime.Core.Service;
using ScreenTime.Core.Tray;

namespace ScreenTime.Tray;

/// <summary>
/// The tray's end of the pipe to the service (docs/SPEC.md §12.2): says hello, locks the PC when asked and confirms it,
/// passes toasts, views and answers to the <see cref="TrayModel"/>, and sends asks and messages for it (<see cref="ITraySender"/>). Reconnects for ever.
/// </summary>
internal sealed partial class TrayPipe(string pipeName, bool dryLock, TrayModel model, Action<string> log) : ITraySender
{
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);
    private readonly SemaphoreSlim _write = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<SendResult>> _waiting = new();
    private StreamWriter? _writer;

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool LockWorkStation();

    public async Task RunAsync()
    {
        model.Sender = this;
        var lastSeen = Environment.TickCount64;
        while (true)
        {
            try
            {
                using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
                await pipe.ConnectAsync(5_000);
                log("pipe: connected");
                lastSeen = Environment.TickCount64;
                using var reader = new StreamReader(pipe, Utf8, detectEncodingFromByteOrderMarks: false, bufferSize: 1024, leaveOpen: true);
                using var writer = new StreamWriter(pipe, Utf8, bufferSize: 1024, leaveOpen: true);
                _writer = writer;
                await SendAsync(PipeMessage.Hello(Environment.ProcessId));
                while (await reader.ReadLineAsync() is { } line)
                {
                    var message = PipeMessage.Decode(line);
                    switch (message?.Type)
                    {
                        case "lock":
                            if (dryLock)
                            {
                                log("lock: dry run");
                            }
                            else if (LockWorkStation())
                            {
                                log("lock: done");
                            }
                            else
                            {
                                log($"lock: failed {Marshal.GetLastPInvokeError()}");
                                break;
                            }
                            await SendAsync(PipeMessage.Locked(message.Id ?? ""));
                            break;
                        case "toast":
                            model.Toast(message.Text ?? "");
                            break;
                        case "view":
                            if (message.View is { } view)
                            {
                                log($"view: {view.Tooltip(view.LeftSec)}");
                                model.Update(view);
                            }
                            break;
                        case "reply":
                            log($"reply: {message.Result}");
                            if (message.Id is { } id && _waiting.TryRemove(id, out var waiting)) waiting.TrySetResult(message.Result ?? SendResult.Offline);
                            break;
                        case "answer":
                            log($"answer: {message.Text}");
                            model.Answer(message.Text ?? "", message.Approved == true);
                            break;
                        case "done":
                            log($"done: {(message.Approved == true ? "yes" : "no")}");
                            if (message.Id is { } doneId && _waiting.TryRemove(doneId, out var done)) done.TrySetResult(message.Approved == true ? SendResult.Sent : SendResult.Offline);
                            break;
                        case "parent-no":
                            log($"parent-no: {message.Text}");
                            model.ParentModeNo(message.Text ?? "");
                            break;
                        case "status":
                            log($"status: {message.RemainingSec / 60} min left, locked {message.IsLocked}, offline {message.Offline}");
                            break;
                    }
                }
                log("pipe: closed");
                lastSeen = Environment.TickCount64;
                Disconnected();
            }
            catch (TimeoutException) { }
            catch (IOException)
            {
                log("pipe: closed");
                lastSeen = Environment.TickCount64;
                Disconnected();
            }
            if (Environment.TickCount64 - lastSeen >= 30_000)
            {
                log("pipe: no service for 30 s, exiting");
                model.Quit();
                return;
            }
            await Task.Delay(1_000);
        }
    }

    /// <summary>"Ask for more time" through the service; Offline when the pipe is down or no reply comes.</summary>
    public Task<SendResult> AskAsync(int minutes, string? reason) => RequestAsync(PipeMessage.Ask(Guid.NewGuid().ToString(), minutes, reason));

    /// <summary>A message to the parents through the service; Offline when the pipe is down or no reply comes.</summary>
    public Task<SendResult> MessageAsync(string? presetId, string text) => RequestAsync(PipeMessage.Message(Guid.NewGuid().ToString(), presetId, text));

    /// <summary>"I'm the parent" through the service; Offline when the pipe is down or no reply comes.</summary>
    public Task<SendResult> RequestParentModeAsync() => RequestAsync(PipeMessage.ParentAsk(Guid.NewGuid().ToString()));

    /// <summary>Whether the service says this is the parent code now; no when the pipe is down.</summary>
    public async Task<bool> CheckParentCodeAsync(string code) =>
        await RequestAsync(PipeMessage.ParentCode(Guid.NewGuid().ToString(), code)) == SendResult.Sent;

    /// <summary>Starts parent mode after a right code; no when the code is too old or the pipe is down.</summary>
    public async Task<bool> StartParentModeAsync(int? minutes) =>
        await RequestAsync(PipeMessage.ParentStart(Guid.NewGuid().ToString(), minutes)) == SendResult.Sent;

    /// <summary>End now; no when the pipe is down.</summary>
    public async Task<bool> EndParentModeAsync() =>
        await RequestAsync(PipeMessage.ParentEnd(Guid.NewGuid().ToString())) == SendResult.Sent;

    private async Task<SendResult> RequestAsync(PipeMessage message)
    {
        var waiting = new TaskCompletionSource<SendResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        _waiting[message.Id!] = waiting;
        if (!await SendAsync(message)) waiting.TrySetResult(SendResult.Offline);
        // The service gives up on the server after 30 s; 40 s here covers that.
        var done = await Task.WhenAny(waiting.Task, Task.Delay(40_000));
        _waiting.TryRemove(message.Id!, out _);
        return done == waiting.Task ? waiting.Task.Result : SendResult.Offline;
    }

    /// <summary>Writes one line to the service; false when the pipe is down. One writer at a time.</summary>
    private async Task<bool> SendAsync(PipeMessage message)
    {
        await _write.WaitAsync();
        try
        {
            if (_writer is not { } writer) return false;
            await writer.WriteAsync(PipeMessage.Encode(message) + "\n");
            await writer.FlushAsync();
            return true;
        }
        catch (IOException)
        {
            return false;
        }
        finally
        {
            _write.Release();
        }
    }

    /// <summary>The pipe closed: nothing can be sent, and every waiting ask or message is Offline.</summary>
    private void Disconnected()
    {
        _writer = null;
        foreach (var id in _waiting.Keys) if (_waiting.TryRemove(id, out var waiting)) waiting.TrySetResult(SendResult.Offline);
    }
}

/// <summary>The tray's log: <c>%LOCALAPPDATA%\ScreenTime\tray.log</c>, one <c>HH:mm:ss line</c> per write.</summary>
internal static class TrayLog
{
    private static readonly Lock Gate = new();

    public static void Write(string line)
    {
        lock (Gate)
        {
            try
            {
                var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenTime");
                Directory.CreateDirectory(folder);
                File.AppendAllText(Path.Combine(folder, "tray.log"), DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + " " + line + Environment.NewLine);
            }
            catch (IOException) { }
        }
    }
}
