using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-050: the logic behind the tray's Ask and Message panels (docs/SPEC.md §16.2, §16.3). Copied verbatim from the card.</summary>
public class AskAndMessageTests
{
    private static readonly long Noon = Ms("2026-10-26T01:00:00Z");

    private static EngineResult Open(long left) =>
        new(false, null, left, DateTimeOffset.FromUnixTimeMilliseconds(Noon + left * 1000), DateTimeOffset.FromUnixTimeMilliseconds(Noon + 60_000), 0, 0);

    [Fact]
    public void TheStatusCarriesThePresetsInOrder()
    {
        var state = State() with
        {
            MessagePresets = [new DeviceStateMessagePresetsItem("p1", "Can I have 5 more minutes?"), new DeviceStateMessagePresetsItem("p2", "I'm hungry")],
        };
        var s = TrayStatusBuilder.From(state, Open(600), Noon, true, Noon);
        Assert.Equal([new TrayPreset("p1", "Can I have 5 more minutes?"), new TrayPreset("p2", "I'm hungry")], s.Presets!);
        Assert.Null(s.PendingMinutes);
    }

    [Fact]
    public void TheStatusSaysWhenAnAskIsWaiting()
    {
        var state = State() with { PendingRequest = new DeviceStatePendingRequest("r1", 30, "2026-10-26T00:55:00.000Z") };
        var s = TrayStatusBuilder.From(state, Open(600), Noon, true, Noon);
        Assert.Equal(30, s.PendingMinutes);
        Assert.Empty(s.Presets!);
    }

    [Theory]
    [InlineData(true, 15, "Dad", "Dad said yes! +15 min 🎉")]
    [InlineData(true, 60, "Mum", "Mum said yes! +1h 🎉")]
    [InlineData(true, 90, "Dad", "Dad said yes! +1h 30m 🎉")]
    [InlineData(false, 0, "Dad", "Dad said not this time")]
    public void AnAnswerReadsLikeAndroid(bool approved, int minutes, string byName, string expected)
    {
        var frame = $$$"""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"requestId":"r1","approved":{{{(approved ? "true" : "false")}}},"minutes":{{{minutes}}},"byName":"{{{byName}}}","grant":null}}""";
        var answer = Live.Answer(frame);
        Assert.NotNull(answer);
        Assert.Equal(new RequestAnswer(approved, minutes, byName), answer);
        Assert.Equal(expected, answer.Text());
    }

    [Theory]
    [InlineData("""{"v":1,"type":"grant_added","at":"2026-10-26T01:00:00Z","data":{}}""")]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"approved":true}}""")]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z"}""")]
    [InlineData("not json")]
    [InlineData("[1]")]
    public void OtherFramesAreNoAnswer(string frame) => Assert.Null(Live.Answer(frame));

    [Fact]
    public void AnAnswerStillAsksForASync() =>
        Assert.True(Live.AsksForSync("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"requestId":"r1","approved":true,"minutes":15,"byName":"Dad","grant":null}}"""));

    [Fact]
    public void TheNewPipeLinesAreCompact()
    {
        Assert.Equal("""{"type":"ask","id":"a1","minutes":30,"reason":"Homework"}""", PipeMessage.Encode(PipeMessage.Ask("a1", 30, "Homework")));
        Assert.Equal("""{"type":"ask","id":"a1","minutes":15}""", PipeMessage.Encode(PipeMessage.Ask("a1", 15, null)));
        Assert.Equal("""{"type":"message","id":"m1","text":"Hungry","presetId":"p2"}""", PipeMessage.Encode(PipeMessage.Message("m1", "p2", "Hungry")));
        Assert.Equal("""{"type":"message","id":"m1","text":"Hi"}""", PipeMessage.Encode(PipeMessage.Message("m1", null, "Hi")));
        Assert.Equal("""{"type":"reply","id":"a1","result":"AlreadyAsked"}""", PipeMessage.Encode(PipeMessage.Reply("a1", SendResult.AlreadyAsked)));
        Assert.Equal("""{"type":"answer","text":"Dad said not this time","approved":false}""", PipeMessage.Encode(PipeMessage.Answer("Dad said not this time", false)));
    }

    [Fact]
    public void TheNewPipeLinesReadBack()
    {
        foreach (var m in new[]
        {
            PipeMessage.Ask("a1", 60, "Please"),
            PipeMessage.Message("m1", "p1", "Can I have 5 more minutes?"),
            PipeMessage.Reply("m1", SendResult.Offline),
            PipeMessage.Answer("Mum said yes! +1h 🎉", true),
        })
        {
            Assert.Equal(m, PipeMessage.Decode(PipeMessage.Encode(m)));
        }
    }

    [Fact]
    public void ThereIsAlreadyAnAskIsNotAFailure()
    {
        Assert.Equal(SendResult.AlreadyAsked, SendResults.Of(new ApiException(409, null)));
        Assert.Equal(SendResult.Offline, SendResults.Of(new ApiException(500, null)));
        Assert.Equal(SendResult.Offline, SendResults.Of(new ApiException(400, null)));
        Assert.Equal(SendResult.Offline, SendResults.Of(new HttpRequestException("no route")));
        Assert.Equal(SendResult.Offline, SendResults.Of(new TaskCanceledException()));
    }
}
