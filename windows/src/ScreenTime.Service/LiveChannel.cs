using System.Net.WebSockets;
using System.Text;
using ScreenTime.Core.Service;
using Microsoft.Extensions.Logging;

namespace ScreenTime.Service;

/// <summary>
/// The live channel of one enrolled account (docs/SPEC.md §8.3, §10): a WebSocket to <c>/v1/device/ws</c> that only asks
/// for syncs. It never syncs itself and never touches the store.
/// </summary>
public sealed class LiveChannel(string url, Func<string> token, Action requestSync, ILogger logger, string kidName)
{
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PingEvery = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan SilentAfter = TimeSpan.FromSeconds(75);

    public async Task RunAsync(CancellationToken ct)
    {
        var attempt = 0;
        while (!ct.IsCancellationRequested)
        {
            string? down = null;
            try
            {
                using var ws = new ClientWebSocket();
                ws.Options.SetRequestHeader("Authorization", "Bearer " + token());
                using (var connect = CancellationTokenSource.CreateLinkedTokenSource(ct))
                {
                    connect.CancelAfter(ConnectTimeout);
                    await ws.ConnectAsync(new Uri(url), connect.Token);
                }
                logger.LogInformation("live {Kid}: connected", kidName);
                attempt = 0;
                requestSync();
                down = await RunOpenAsync(ws, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (OperationCanceledException)
            {
                down = "timed out";
            }
            catch (WebSocketException e)
            {
                down = e.Message;
            }
            if (down is not null) logger.LogWarning("live {Kid}: down ({Message})", kidName, down);
            try
            {
                await Task.Delay(TimeSpan.FromMilliseconds(Live.BackoffMs(attempt, 0.8 + Random.Shared.NextDouble() * 0.4)), ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            attempt++;
        }
    }

    /// <summary>Pings and receives until the socket closes or goes silent. Returns why it went down.</summary>
    private async Task<string> RunOpenAsync(ClientWebSocket ws, CancellationToken ct)
    {
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var ping = PingAsync(ws, stop.Token);
        try
        {
            return await ReceiveAsync(ws, stop.Token);
        }
        finally
        {
            stop.Cancel();
            try { await ping; } catch (OperationCanceledException) { } catch (WebSocketException) { }
        }
    }

    private static async Task PingAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var ping = Encoding.UTF8.GetBytes(Live.Ping);
        using var timer = new PeriodicTimer(PingEvery);
        while (await timer.WaitForNextTickAsync(ct))
        {
            await ws.SendAsync(ping, WebSocketMessageType.Text, endOfMessage: true, ct);
        }
    }

    private async Task<string> ReceiveAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[4096];
        using var message = new MemoryStream();
        while (ws.State == WebSocketState.Open)
        {
            message.SetLength(0);
            WebSocketReceiveResult result;
            using (var silent = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                silent.CancelAfter(SilentAfter);
                try
                {
                    do
                    {
                        result = await ws.ReceiveAsync(buffer, silent.Token);
                        message.Write(buffer, 0, result.Count);
                    } while (!result.EndOfMessage);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    logger.LogInformation("live {Kid}: silent for 75 s", kidName);
                    ws.Abort();
                    return "silent";
                }
            }
            if (result.MessageType == WebSocketMessageType.Close)
            {
                logger.LogInformation("live {Kid}: closed {Code}", kidName, (int?)result.CloseStatus);
                return $"closed {(int?)result.CloseStatus}";
            }
            if (result.MessageType == WebSocketMessageType.Text && Live.AsksForSync(Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length)))
            {
                requestSync();
            }
        }
        return "not open";
    }
}
