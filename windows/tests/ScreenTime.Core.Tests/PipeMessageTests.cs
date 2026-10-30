using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-048: the JSON lines between the service and the tray (docs/SPEC.md §12.2). Copied verbatim from the card.</summary>
public class PipeMessageTests
{
    [Fact]
    public void MessagesAreOneCompactLineWithoutNulls()
    {
        Assert.Equal("""{"type":"lock","id":"l1"}""", PipeMessage.Encode(PipeMessage.Lock("l1")));
        Assert.Equal("""{"type":"locked","id":"l1"}""", PipeMessage.Encode(PipeMessage.Locked("l1")));
        Assert.Equal("""{"type":"toast","text":"Out of Screens time. Ask Mum or Dad."}""", PipeMessage.Encode(PipeMessage.Toast("Out of Screens time. Ask Mum or Dad.")));
        Assert.Equal("""{"type":"hello","pid":4242}""", PipeMessage.Encode(PipeMessage.Hello(4242)));
        Assert.Equal(
            """{"type":"status","kidName":"Alex","remainingSec":4320,"locked":false,"offline":true}""",
            PipeMessage.Encode(PipeMessage.Status("Alex", 4320, locked: false, offline: true)));
    }

    [Fact]
    public void ALineDecodesBackToTheSameMessage()
    {
        var status = PipeMessage.Status("Alex", 4320, locked: true, offline: false);
        Assert.Equal(status, PipeMessage.Decode(PipeMessage.Encode(status)));
        Assert.Equal(PipeMessage.Lock("l1"), PipeMessage.Decode("""{"id":"l1","type":"lock"}"""));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("null")]
    [InlineData("[1]")]
    [InlineData("""{"id":"l1"}""")]
    [InlineData("""{"type":null}""")]
    public void ABrokenLineIsNull(string line) => Assert.Null(PipeMessage.Decode(line));
}
