using System.Net;
using System.Text;
using System.Text.Json;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Store;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047b: enrolling one Windows account (docs/SPEC.md §11.3). Copied verbatim from the card.</summary>
public sealed class EnrollerTests : IDisposable
{
    private sealed class FakeServer(HttpStatusCode status, string json) : HttpMessageHandler
    {
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        }
    }

    private const string Enrolled = """
        {"deviceId":"d-1","deviceToken":"tok-123","kid":{"id":"k-1","name":"Sam"},"family":{"name":"Gallaghers","timezone":"Australia/Sydney"}}
        """;

    private static readonly EnrolInput Input = new(
        Code: "123456", Sid: Alex, UserName: "sam", Model: "Dell XPS", OsVersion: "Microsoft Windows NT 10.0.26100.0",
        AppVersion: "0.1.0", MachineId: "machine-guid");

    private readonly string _path = NewDbPath();
    private readonly LocalStore _store;

    public EnrollerTests() => _store = LocalStore.Open(_path);

    public void Dispose()
    {
        _store.Dispose();
        Delete(_path);
    }

    private static ApiClient Client(FakeServer server) => new(new HttpClient(server) { BaseAddress = new Uri("https://st.example/") }, () => null);

    /// <summary>A stand-in for DPAPI: reverses the bytes, so the test can see it was called.</summary>
    private static byte[] Protect(byte[] plain) => Enumerable.Reverse(plain).ToArray();

    [Fact]
    public async Task SendsTheWindowsFactsAndStoresTheProtectedToken()
    {
        var server = new FakeServer(HttpStatusCode.Created, Enrolled);

        var device = await Enroller.EnrolAsync(Client(server), _store, Input, Protect, TestContext.Current.CancellationToken);

        using var sent = JsonDocument.Parse(server.Body!);
        var root = sent.RootElement;
        Assert.Equal("123456", root.GetProperty("code").GetString());
        Assert.Equal("windows", root.GetProperty("platform").GetString());
        Assert.False(root.GetProperty("hasCellular").GetBoolean());
        Assert.Equal("Dell XPS", root.GetProperty("model").GetString());
        Assert.Equal("machine-guid", root.GetProperty("machineId").GetString());
        Assert.Equal(Alex, root.GetProperty("windowsUserSid").GetString());
        Assert.Equal("sam", root.GetProperty("windowsUserName").GetString());

        Assert.Equal(new StoredDevice(Alex, "d-1", device.Token, "Sam", "Australia/Sydney"), device);
        Assert.Equal(Protect(Encoding.UTF8.GetBytes("tok-123")), device.Token);
        var stored = _store.GetDevice(Alex)!;
        Assert.Equal("d-1", stored.DeviceId);
        Assert.Equal(device.Token, stored.Token);
    }

    [Fact]
    public async Task EnrollingTheAccountAgainForgetsTheOldDevicesData()
    {
        _store.PutDevice(new StoredDevice(Alex, "d-old", [9], "Sam", "Australia/Sydney"));
        _store.PutSegment(new LocalSegment("old-seg", Alex, 1_000, 2_000, 2_000, false));
        _store.Enqueue(Alex, "event", "{}", 1_000);

        await Enroller.EnrolAsync(Client(new FakeServer(HttpStatusCode.Created, Enrolled)), _store, Input, Protect, TestContext.Current.CancellationToken);

        Assert.Equal("d-1", _store.GetDevice(Alex)!.DeviceId);
        Assert.Empty(_store.SegmentsSince(Alex, 0));
        Assert.Empty(_store.PeekOutbox(Alex, 10));
    }

    [Fact]
    public async Task AWrongCodeThrowsAndKeepsTheOldDevice()
    {
        _store.PutDevice(new StoredDevice(Alex, "d-old", [9], "Sam", "Australia/Sydney"));
        var server = new FakeServer(HttpStatusCode.Unauthorized, """{"error":{"code":"unauthorized","message":"That code didn't work."}}""");

        var e = await Assert.ThrowsAsync<ApiException>(() => Enroller.EnrolAsync(Client(server), _store, Input, Protect, TestContext.Current.CancellationToken));

        Assert.Equal(401, e.Status);
        Assert.Equal("d-old", _store.GetDevice(Alex)!.DeviceId);
    }
}
