using System.Globalization;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using ScreenTime.Core.Service;

namespace ScreenTime.Tray;

/// <summary>
/// The tray's end of the pipe to the service (docs/SPEC.md §12.2): says hello, locks the PC when asked and confirms it,
/// passes toasts to the <see cref="TrayModel"/> and logs status lines. Reconnects for ever.
/// </summary>
internal sealed partial class TrayPipe(string pipeName, bool dryLock, TrayModel model, Action<string> log)
{
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool LockWorkStation();

    public async Task RunAsync()
    {
        while (true)
        {
            try
            {
                using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
                await pipe.ConnectAsync(5_000);
                log("pipe: connected");
                using var reader = new StreamReader(pipe, Utf8, detectEncodingFromByteOrderMarks: false, bufferSize: 1024, leaveOpen: true);
                using var writer = new StreamWriter(pipe, Utf8, bufferSize: 1024, leaveOpen: true);
                await SendAsync(writer, PipeMessage.Hello(Environment.ProcessId));
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
                            await SendAsync(writer, PipeMessage.Locked(message.Id ?? ""));
                            break;
                        case "toast":
                            model.Toast(message.Text ?? "");
                            break;
                        case "status":
                            log($"status: {message.RemainingSec / 60} min left, locked {message.IsLocked}, offline {message.Offline}");
                            break;
                    }
                }
                log("pipe: closed");
            }
            catch (TimeoutException) { }
            catch (IOException)
            {
                log("pipe: closed");
            }
            await Task.Delay(1_000);
        }
    }

    private static async Task SendAsync(StreamWriter writer, PipeMessage message)
    {
        await writer.WriteAsync(PipeMessage.Encode(message) + "\n");
        await writer.FlushAsync();
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
