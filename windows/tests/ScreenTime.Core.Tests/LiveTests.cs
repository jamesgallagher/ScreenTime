using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-048: the live channel's rules (docs/SPEC.md §8.3, §10). Copied verbatim from the card.</summary>
public class LiveTests
{
    [Theory]
    [InlineData("https://screentime.example.com/", "wss://screentime.example.com/v1/device/ws")]
    [InlineData("http://localhost:8080/", "ws://localhost:8080/v1/device/ws")]
    [InlineData("http://localhost:8080", "ws://localhost:8080/v1/device/ws")]
    public void TheSocketAddressComesFromTheServerAddress(string server, string expected) =>
        Assert.Equal(expected, Live.Url(server));

    [Fact]
    public void OnlyHttpAddressesHaveASocket() =>
        Assert.Throws<ArgumentException>(() => Live.Url("ftp://example.com/"));

    [Theory]
    [InlineData(0, 1.0, 1_000)]
    [InlineData(1, 1.0, 2_000)]
    [InlineData(5, 1.0, 32_000)]
    [InlineData(6, 1.0, 60_000)]
    [InlineData(30, 1.0, 60_000)]
    [InlineData(-1, 1.0, 1_000)]
    [InlineData(0, 0.8, 800)]
    [InlineData(2, 1.2, 4_800)]
    public void BackoffDoublesUpToAMinute(int attempt, double jitter, long expected) =>
        Assert.Equal(expected, Live.BackoffMs(attempt, jitter));

    [Theory]
    [InlineData("""{"v":1,"type":"grant_added","at":"2026-10-26T09:00:00Z","data":{}}""", true)]
    [InlineData("""{"v":1,"type":"state_changed","at":"2026-10-26T09:00:00Z","data":{}}""", true)]
    [InlineData("""{"v":1,"type":"pong","at":"2026-10-26T09:00:00Z","data":{}}""", false)]
    [InlineData("not json", false)]
    [InlineData("[1,2]", false)]
    [InlineData("""{"type":7}""", false)]
    [InlineData("""{"data":{}}""", false)]
    public void EveryEnvelopeButPongAsksForASync(string frame, bool expected) =>
        Assert.Equal(expected, Live.AsksForSync(frame));

    [Fact]
    public void ThePingIsTheSpecsPing() => Assert.Equal("""{"type":"ping"}""", Live.Ping);
}
