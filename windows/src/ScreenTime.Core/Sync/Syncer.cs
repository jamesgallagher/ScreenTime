using System.Globalization;
using ScreenTime.Core.Api;
using ScreenTime.Core.Store;

namespace ScreenTime.Core.Sync;

/// <summary>
/// One sync (docs/SPEC.md §8.2, §8.3): upload every changed segment, then fetch the snapshot with <c>If-None-Match</c>.
/// Every answer from the server sets the trusted clock.
/// </summary>
public sealed class Syncer(ApiClient api, LocalStore store, string sid, TrustedClock clock, Action<string>? log = null)
{
    private const int Batch = 500;

    /// <summary>True when both steps worked. On false nothing is lost: the segments stay in the outbox.</summary>
    public async Task<bool> SyncAsync(CancellationToken cancellationToken)
    {
        try
        {
            await UploadAsync(cancellationToken);
            await FetchStateAsync(cancellationToken);
            return true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception e)
        {
            log?.Invoke($"sync failed: {e.Message}");
            return false;
        }
    }

    private async Task UploadAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            var batch = store.PendingSegments(sid, Batch);
            if (batch.Count == 0) return;
            await api.PostDeviceUsageAsync(new UsageUpload(batch.Select(p => ToUpload(p.Segment)).ToList()), cancellationToken);
            foreach (var p in batch) store.MarkSent(p.Segment.Id, p.Version);
            if (batch.Count < Batch) return;
        }
    }

    private async Task FetchStateAsync(CancellationToken cancellationToken)
    {
        var cached = store.LoadState(sid);
        var answer = await api.GetDeviceStateAsync(cached?.ETag, cancellationToken);
        if (answer.Value is { } value)
        {
            store.SaveState(sid, new CachedState(answer.ETag, value));
            clock.OnServerTime(DateTimeOffset.Parse(value.ServerTime, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds());
        }
        else
        {
            // 304 Not Modified: no body, so the server time is the Date header.
            if (answer.Date is { } date)
            {
                clock.OnServerTime(DateTimeOffset.ParseExact(date, "r", CultureInfo.InvariantCulture).ToUnixTimeMilliseconds());
            }
        }
    }

    private static UsageSegmentIn ToUpload(LocalSegment s) =>
        new(s.Id, Iso(s.StartedAtMs), s.EndedAtMs is { } end ? Iso(end) : null, s.RecordedOffline);

    private static string Iso(long ms) =>
        DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
