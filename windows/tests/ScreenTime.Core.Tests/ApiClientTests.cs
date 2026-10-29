using System.Net;
using System.Text;
using System.Text.Json;
using ScreenTime.Core.Api;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-046: the generated C# API client against a fake server. Copied verbatim from the card.</summary>
public class ApiClientTests
{
    /// <summary>Answers every request with one canned response, and keeps the request it got.</summary>
    private sealed class FakeServer(HttpStatusCode status, string? json, params (string Name, string Value)[] headers) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            var response = new HttpResponseMessage(status);
            if (json is not null) response.Content = new StringContent(json, Encoding.UTF8, "application/json");
            foreach (var (name, value) in headers) response.Headers.TryAddWithoutValidation(name, value);
            return response;
        }
    }

    private static ApiClient ClientFor(FakeServer server, string? token = "device-token") =>
        new(new HttpClient(server) { BaseAddress = new Uri("https://st.example/") }, () => token);

    private const string Enrolled = """
        {"deviceId":"d-1","deviceToken":"secret","kid":{"id":"k-1","name":"Alex"},"family":{"name":"Gallaghers","timezone":"Australia/Sydney"},"extra":"ignored"}
        """;

    [Fact]
    public async Task EnrolPostsTheRequestInTheApiWords()
    {
        var server = new FakeServer(HttpStatusCode.Created, Enrolled);
        var client = ClientFor(server, token: null);

        var enrolled = await client.PostEnrolAsync(new EnrolRequest(
            Code: "123456",
            Platform: Platform.Windows,
            HasCellular: false,
            Model: "Dell XPS",
            OsVersion: "Windows 11 Pro 24H2",
            AppVersion: "0.1.0",
            WindowsUserName: "Alex"));

        Assert.Equal(HttpMethod.Post, server.Request!.Method);
        Assert.Equal("https://st.example/v1/enrol", server.Request.RequestUri!.ToString());
        Assert.Null(server.Request.Headers.Authorization);
        using var sent = JsonDocument.Parse(server.Body!);
        var root = sent.RootElement;
        Assert.Equal("123456", root.GetProperty("code").GetString());
        Assert.Equal("windows", root.GetProperty("platform").GetString());
        Assert.False(root.GetProperty("hasCellular").GetBoolean());
        Assert.Equal("Alex", root.GetProperty("windowsUserName").GetString());
        // Optional fields left out are not sent at all.
        Assert.False(root.TryGetProperty("machineId", out _));
        Assert.False(root.TryGetProperty("windowsUserSid", out _));

        Assert.Equal("d-1", enrolled.DeviceId);
        Assert.Equal("secret", enrolled.DeviceToken);
        Assert.Equal("Alex", enrolled.Kid.Name);
        Assert.Equal("Australia/Sydney", enrolled.Family.Timezone);
    }

    [Fact]
    public async Task ARequiredNullIsSentAsNull()
    {
        // endedAt is required and nullable: an open segment sends "endedAt": null, never leaves it out.
        var server = new FakeServer(HttpStatusCode.OK, """{"received":1}""");
        var receipt = await ClientFor(server).PostDeviceUsageAsync(new UsageUpload([
            new UsageSegmentIn(Id: "s-1", StartedAt: "2026-10-29T08:00:00.000Z", EndedAt: null, RecordedOffline: false),
        ]));

        Assert.Equal("Bearer device-token", server.Request!.Headers.Authorization!.ToString());
        Assert.Equal("https://st.example/v1/device/usage", server.Request.RequestUri!.ToString());
        using var sent = JsonDocument.Parse(server.Body!);
        var segment = sent.RootElement.GetProperty("segments")[0];
        Assert.Equal(JsonValueKind.Null, segment.GetProperty("endedAt").ValueKind);
        Assert.False(segment.GetProperty("recordedOffline").GetBoolean());
        Assert.Equal(1, receipt.Received);
    }

    [Fact]
    public async Task AnOptionalNullIsLeftOut()
    {
        const string json = """
            {"id":"r-1","kidId":"k-1","kidName":"Alex","deviceId":"d-1","deviceName":"Alex's PC","pool":"screens","minutes":30,"reason":null,"status":"pending","createdAt":"2026-10-29T08:00:00.000Z","resolvedAt":null,"resolvedByName":null,"grantId":null,"grantedMinutes":null}
            """;
        var server = new FakeServer(HttpStatusCode.Created, json);
        var request = await ClientFor(server).PostDeviceTimeRequestsAsync(new TimeRequestCreate(Id: "r-1", Minutes: 30));

        using var sent = JsonDocument.Parse(server.Body!);
        Assert.Equal(30, sent.RootElement.GetProperty("minutes").GetInt32());
        Assert.False(sent.RootElement.TryGetProperty("reason", out _));
        Assert.Equal(TimeRequestStatus.Pending, request.Status);
        Assert.Null(request.GrantedMinutes);
    }

    [Fact]
    public async Task StateSendsIfNoneMatchAndANotModifiedHasNoValue()
    {
        var server = new FakeServer(HttpStatusCode.NotModified, null, ("ETag", "\"v7\""), ("Date", "Thu, 29 Oct 2026 08:00:00 GMT"));
        var state = await ClientFor(server).GetDeviceStateAsync(ifNoneMatch: "\"v7\"");

        Assert.Equal(HttpMethod.Get, server.Request!.Method);
        Assert.Equal("\"v7\"", server.Request.Headers.GetValues("If-None-Match").Single());
        Assert.Null(state.Value);
        Assert.Equal("\"v7\"", state.ETag);
        Assert.Equal("Thu, 29 Oct 2026 08:00:00 GMT", state.Date);
    }

    [Fact]
    public async Task StateReadsANewVersion()
    {
        const string json = """
            {"serverTime":"2026-10-29T08:00:00.000Z","stateVersion":"v8",
             "device":{"id":"d-1","name":"Alex's PC","form":"pc","pool":"screens","hasCellular":false},
             "kid":{"id":"k-1","name":"Alex"},
             "family":{"timezone":"Australia/Sydney","emergencyNumber":"000","parentCodeSecret":"not-a-real-secret"},
             "parents":[{"id":"p-1","displayName":"Dad","phoneE164":null}],"contacts":[],"messagePresets":[],
             "schedule":{"version":3,"warn1Min":15,"warn2Min":5,"days":[{"weekday":4,"screensMin":120,"phoneMin":60,"wake":"07:00","bedtime":"21:00"}]},
             "today":{"date":"2026-10-29","grants":[],"poolSegments":[{"id":"s-1","deviceId":"d-1","startedAt":"2026-10-29T07:00:00.000Z","endedAt":null}]},
             "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"activeSos":null}
            """;
        var server = new FakeServer(HttpStatusCode.OK, json, ("ETag", "\"v8\""));
        var state = await ClientFor(server).GetDeviceStateAsync();

        Assert.False(server.Request!.Headers.Contains("If-None-Match"));
        Assert.NotNull(state.Value);
        Assert.Equal("v8", state.Value.StateVersion);
        Assert.Equal(DeviceForm.Pc, state.Value.Device.Form);
        Assert.Equal(ScreenTime.Core.Api.Pool.Screens, state.Value.Device.Pool);
        Assert.Equal(120, state.Value.Schedule.Days[0].ScreensMin);
        Assert.Null(state.Value.Today.PoolSegments[0].EndedAt);
        Assert.Null(state.Value.Parents[0].PhoneE164);
        Assert.Null(state.Value.PendingRequest);
        Assert.Equal("\"v8\"", state.ETag);
    }

    [Fact]
    public async Task AnErrorBecomesAnApiExceptionWithTheServersCode()
    {
        const string json = """{"error":{"code":"conflict","message":"That code was already used."}}""";
        var server = new FakeServer(HttpStatusCode.Conflict, json);

        var e = await Assert.ThrowsAsync<ApiException>(() => ClientFor(server).PostEnrolAsync(new EnrolRequest(
            Code: "123456", Platform: Platform.Windows, HasCellular: false, Model: "m", OsVersion: "o", AppVersion: "a")));

        Assert.Equal(409, e.Status);
        Assert.NotNull(e.Error);
        Assert.Equal(ErrorCode.Conflict, e.Error.Code);
        Assert.Equal("That code was already used.", e.Error.Message);
    }

    [Fact]
    public async Task AMissingRequiredFieldIsAnError()
    {
        // The JSON context respects required fields, so a broken answer fails here, not later with a null.
        var server = new FakeServer(HttpStatusCode.OK, "{}");
        await Assert.ThrowsAsync<JsonException>(() => ClientFor(server).PostDeviceUsageAsync(new UsageUpload([
            new UsageSegmentIn(Id: "s-1", StartedAt: "2026-10-29T08:00:00.000Z", EndedAt: "2026-10-29T08:05:00.000Z", RecordedOffline: true),
        ])));
    }

    [Fact]
    public async Task AnErrorWithoutJsonStillHasItsStatus()
    {
        var server = new FakeServer(HttpStatusCode.BadGateway, null);
        var e = await Assert.ThrowsAsync<ApiException>(() => ClientFor(server).GetDeviceMeAsync());
        Assert.Equal(502, e.Status);
        Assert.Null(e.Error);
    }

    [Fact]
    public async Task PathIdsAreEscapedAndNoContentCallsReturnNothing()
    {
        var server = new FakeServer(HttpStatusCode.NoContent, null);
        await ClientFor(server).PostDeviceSosEndAsync("a b/c");
        Assert.Equal("/v1/device/sos/a%20b%2Fc/end", server.Request!.RequestUri!.AbsolutePath);
        Assert.Null(server.Body);
    }

    [Fact]
    public void EnumsUseTheApiText()
    {
        Assert.Equal("\"tamper.tray_killed\"", JsonSerializer.Serialize(DeviceEventKind.TamperTrayKilled, ApiJsonContext.Default.DeviceEventKind));
        Assert.Equal(ErrorCode.ValidationFailed, JsonSerializer.Deserialize("\"validation_failed\"", ApiJsonContext.Default.ErrorCode));
    }
}
