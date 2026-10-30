using System.Net;
using System.Text;
using ScreenTime.Core.Api;
using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047: one sync, upload then snapshot (docs/SPEC.md §8.2, §8.3). Copied verbatim from the card.</summary>
public sealed class SyncerTests : IDisposable
{
    private const string Id = "11111111-1111-4111-8111-111111111111";

    /// <summary>Answers each request with <c>answer</c>, and keeps every request and its body.</summary>
    private sealed class FakeServer(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string? Body)> Seen { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            Seen.Add((request, body));
            return answer(request);
        }
    }

    private static HttpResponseMessage Json(string json, string? etag = null)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        if (etag is not null) response.Headers.TryAddWithoutValidation("ETag", etag);
        return response;
    }

    private readonly string _path = NewDbPath();
    private readonly LocalStore _store;
    private readonly TrustedClock _clock = new(new MemoryClockStore(), () => 0, () => 0, () => 1);
    private readonly List<string> _log = [];

    public SyncerTests() => _store = LocalStore.Open(_path);

    public void Dispose()
    {
        _store.Dispose();
        Delete(_path);
    }

    private Syncer SyncerFor(FakeServer server) =>
        new(new ApiClient(new HttpClient(server) { BaseAddress = new Uri("https://st.example/") }, () => "device-token"), _store, Alex, _clock, _log.Add);

    [Fact]
    public async Task UploadsTheOutboxThenKeepsTheSnapshotAndTheServerTime()
    {
        _store.PutSegment(new LocalSegment(Id, Alex, Ms("2026-10-25T22:00:00Z"), null, Ms("2026-10-25T22:00:00Z"), false));
        var server = new FakeServer(r => r.RequestUri!.AbsolutePath == "/v1/device/usage"
            ? Json("""{"received":1}""")
            : Json(StateJson(serverTime: "2026-10-25T23:00:00.000Z"), "\"v1\""));

        Assert.True(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        Assert.Equal(2, server.Seen.Count);
        Assert.Equal("/v1/device/usage", server.Seen[0].Request.RequestUri!.AbsolutePath);
        Assert.Equal(
            """{"segments":[{"id":"11111111-1111-4111-8111-111111111111","startedAt":"2026-10-25T22:00:00.000Z","endedAt":null,"recordedOffline":false}]}""",
            server.Seen[0].Body);
        Assert.Equal("Bearer device-token", server.Seen[0].Request.Headers.Authorization!.ToString());
        Assert.False(server.Seen[1].Request.Headers.Contains("If-None-Match"));
        Assert.Empty(_store.PendingSegments(Alex, limit: 10));
        var cached = _store.LoadState(Alex)!;
        Assert.Equal("\"v1\"", cached.ETag);
        Assert.Equal("Alex", cached.State.Kid.Name);
        Assert.Equal(Ms("2026-10-25T23:00:00Z"), _clock.NowMs());
    }

    [Fact]
    public async Task AKnownSnapshotIsAskedWithIfNoneMatchAnd304UsesTheDateHeader()
    {
        await SyncerFor(new FakeServer(_ => Json(StateJson(), "\"v1\""))).SyncAsync(TestContext.Current.CancellationToken);
        var server = new FakeServer(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.NotModified);
            response.Headers.TryAddWithoutValidation("Date", "Mon, 26 Oct 2026 01:02:03 GMT");
            return response;
        });

        Assert.True(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        var (request, _) = Assert.Single(server.Seen);
        Assert.Equal("\"v1\"", request.Headers.GetValues("If-None-Match").Single());
        Assert.Equal("\"v1\"", _store.LoadState(Alex)!.ETag);
        Assert.Equal(Ms("2026-10-26T01:02:03Z"), _clock.NowMs());
    }

    [Fact]
    public async Task AFailedUploadKeepsTheSegmentsForNextTime()
    {
        _store.PutSegment(new LocalSegment(Id, Alex, 1_000, 61_000, 61_000, false));
        var server = new FakeServer(_ => new HttpResponseMessage(HttpStatusCode.BadGateway));

        Assert.False(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        Assert.Single(server.Seen);
        Assert.Single(_store.PendingSegments(Alex, limit: 10));
        Assert.Null(_store.LoadState(Alex));
        Assert.False(_clock.IsAnchored);
        Assert.Contains("502", Assert.Single(_log));
    }

    [Fact]
    public async Task AChangeDuringTheUploadIsSentAgain()
    {
        _store.PutSegment(new LocalSegment(Id, Alex, 1_000, null, 1_000, false));
        var server = new FakeServer(r =>
        {
            if (r.RequestUri!.AbsolutePath != "/v1/device/usage") return Json(StateJson(), "\"v1\"");
            // The PC locks while the open segment is on its way.
            _store.PutSegment(new LocalSegment(Id, Alex, 1_000, 61_000, 61_000, false));
            return Json("""{"received":1}""");
        });

        Assert.True(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        Assert.Equal(61_000, Assert.Single(_store.PendingSegments(Alex, limit: 10)).Segment.EndedAtMs);
    }

    [Fact]
    public async Task UploadsGoInBatchesOf500()
    {
        for (var i = 0; i < 501; i++) _store.PutSegment(new LocalSegment($"s{i:D4}", Alex, 1_000 + i, 1_001 + i, 1_001 + i, false));
        var server = new FakeServer(r => r.RequestUri!.AbsolutePath == "/v1/device/usage"
            ? Json("""{"received":1}""")
            : Json(StateJson(), "\"v1\""));

        Assert.True(await SyncerFor(server).SyncAsync(TestContext.Current.CancellationToken));

        Assert.Equal(new[] { "/v1/device/usage", "/v1/device/usage", "/v1/device/state" }, server.Seen.Select(s => s.Request.RequestUri!.AbsolutePath));
        Assert.Empty(_store.PendingSegments(Alex, limit: 10));
    }

    [Fact]
    public async Task ACancelledSyncThrowsInsteadOfReturningFalse()
    {
        using var cancel = new CancellationTokenSource();
        var server = new FakeServer(_ =>
        {
            cancel.Cancel();
            throw new OperationCanceledException(cancel.Token);
        });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => SyncerFor(server).SyncAsync(cancel.Token));
        Assert.Empty(_log);
    }
}
