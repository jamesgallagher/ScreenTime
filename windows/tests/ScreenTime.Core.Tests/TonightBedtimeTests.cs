using ScreenTime.Core.Api;
using ScreenTime.Core.Sync;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using System.Text.Json;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-063: the Windows device honours an extended bedtime from the snapshot's schedule entry.</summary>
public class TonightBedtimeTests
{
    /// <summary>Monday 26 October 2026, 20:45 in Sydney (UTC+11) = 2026-10-26 09:45 UTC.</summary>
    private static readonly long Now = Ms("2026-10-26T09:45:00Z");

    /// <summary>Build a DeviceState with a specific bedtime for today's weekday (Monday).</summary>
    private static DeviceState StateWithBedtime(string todayBedtime, string pool = "phone", string segments = "")
    {
        // Monday 26 October 2026 is weekday 1.
        var days = string.Join(",", Enumerable.Range(1, 7).Select(d =>
            $"{{\"weekday\":{d},\"screensMin\":120,\"phoneMin\":90,\"wake\":\"07:00\",\"bedtime\":\"{(d == 1 ? todayBedtime : "20:30")}\"}}"));
        var json = """
            {"serverTime":"2026-10-26T00:00:00Z","stateVersion":"v1",
             "device":{"id":"d1","name":"Alex's PC","form":"pc","pool":"
            """ + pool + """
            ","hasCellular":false},
             "kid":{"id":"k1","name":"Alex"},
             "family":{"timezone":"Australia/Sydney","emergencyNumber":"000","parentCodeSecret":"ABC"},
             "parents":[],"contacts":[],"messagePresets":[],
             "schedule":{"version":1,"warn1Min":15,"warn2Min":5,"days":[
            """ + days + """
            ]},
             "today":{"date":"2026-10-26","grants":[],"poolSegments":[
            """ + segments + """
            ],"appUsage":[]},
             "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"activeSos":null,
             "apps":{"newAppApproval":false,"rules":[]}}
            """;
        return JsonSerializer.Deserialize<DeviceState>(json, ApiJsonContext.Default.DeviceState)!;
    }

    [Fact]
    public void WithTimeUsedUpTheDeviceIsLockedOutOfTimeNotBedtime()
    {
        // 90 min of phone use (90 min allowance) = time used up.
        var segments = """
            {"id":"s1","deviceId":"d1","startedAt":"2026-10-26T09:00:00+11:00","endedAt":"2026-10-26T10:30:00+11:00"}
            """;
        var state = StateWithBedtime("21:30", pool: "phone", segments: segments);
        var input = TodayInput.For(state, [], Now);
        var result = Engine.Evaluate(input);

        Assert.True(result.Locked);
        Assert.Equal(LockReason.OutOfTime, result.LockReason);
        // Re-evaluate at the extended bedtime (21:30 Sydney = 10:30 UTC).
        Assert.Equal(Ms("2026-10-26T10:30:00Z"), result.ReevaluateAt.ToUnixTimeMilliseconds());
    }

    [Fact]
    public void WithTimeLeftTheDeviceIsNotLockedAndLocksAtTheExtendedBedtime()
    {
        // 30 min of phone use (90 min allowance) = 60 min left.
        var segments = """
            {"id":"s1","deviceId":"d1","startedAt":"2026-10-26T09:00:00+11:00","endedAt":"2026-10-26T09:30:00+11:00"}
            """;
        var state = StateWithBedtime("21:30", pool: "phone", segments: segments);
        var input = TodayInput.For(state, [], Now);
        var result = Engine.Evaluate(input);

        Assert.False(result.Locked);
        // Locks at the earlier of (now + 60 min) and the extended bedtime (21:30 Sydney = 10:30 UTC).
        // now + 60 min = 20:45 + 60 = 21:45 Sydney = 10:45 UTC.
        // Extended bedtime = 21:30 Sydney = 10:30 UTC.
        // So it locks at 10:30 UTC.
        Assert.Equal(Ms("2026-10-26T10:30:00Z"), result.NextLockAt?.ToUnixTimeMilliseconds());
    }

    [Fact]
    public void TrayStatusBuilderShowsTheExtendedBedtime()
    {
        var state = StateWithBedtime("21:30", pool: "phone");
        var input = TodayInput.For(state, [], Now);
        var result = Engine.Evaluate(input);
        var s = TrayStatusBuilder.From(state, result, Now, online: true, syncedAtMs: Now - 20_000);
        Assert.Equal("9:30 pm", s.Bedtime);
    }

    [Fact]
    public void WithTheUsualBedtimeTheSameMomentIsBedtime()
    {
        var segments = """
            {"id":"s1","deviceId":"d1","startedAt":"2026-10-26T09:00:00+11:00","endedAt":"2026-10-26T09:45:00+11:00"},
            {"id":"s2","deviceId":"d1","startedAt":"2026-10-26T09:45:00+11:00","endedAt":"2026-10-26T10:30:00+11:00"}
            """;
        var state = StateWithBedtime("20:30", pool: "phone", segments: segments);
        var input = TodayInput.For(state, [], Now);
        var result = Engine.Evaluate(input);

        Assert.True(result.Locked);
        Assert.Equal(LockReason.Bedtime, result.LockReason);
    }
}
