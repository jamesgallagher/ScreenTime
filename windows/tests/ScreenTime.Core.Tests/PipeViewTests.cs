using ScreenTime.Core.Service;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-049: the <c>view</c> line from the service to the tray (docs/SPEC.md §12.2, §16.3). Copied verbatim from the card.</summary>
public class PipeViewTests
{
    private static readonly TrayStatus Open = new(
        "Alex", "Screens", null, 4_320, 3_000, 1_761_440_400_000, "8:30 pm", null, 15, 5, true, 1_761_436_000_000, false, null, ["Mum", "Dad"]);

    [Fact]
    public void AViewIsOneLineAndKeepsItsNulls() => Assert.Equal(
        """{"type":"view","view":{"kidName":"Alex","poolName":"Screens","lockReason":null,"leftSec":4320,"usedSec":3000,"lockAtMs":1761440400000,"bedtime":"8:30 pm","backAt":null,"warn1Min":15,"warn2Min":5,"online":true,"syncedAtMs":1761436000000,"parentMode":false,"parentModeEnds":null,"parentNames":["Mum","Dad"]}}""",
        PipeMessage.Encode(PipeMessage.ViewOf(Open)));

    [Fact]
    public void TheLockReasonIsItsName()
    {
        var locked = Open with { LockReason = LockReason.BeforeWake, LockAtMs = null, LeftSec = 0 };
        Assert.Contains("\"lockReason\":\"BeforeWake\"", PipeMessage.Encode(PipeMessage.ViewOf(locked)));
    }

    [Fact]
    public void AViewDecodesBackToTheSameStatus()
    {
        var locked = Open with { LockReason = LockReason.Bedtime, LockAtMs = null, BackAt = "7:00 am", SyncedAtMs = null };
        var decoded = PipeMessage.Decode(PipeMessage.Encode(PipeMessage.ViewOf(locked)));
        Assert.NotNull(decoded);
        Assert.Equal("view", decoded.Type);
        Assert.Equivalent(locked, decoded.View, strict: true);
    }

    [Fact]
    public void OtherMessagesHaveNoView()
    {
        Assert.Null(PipeMessage.Decode(PipeMessage.Encode(PipeMessage.Lock("l1")))!.View);
        Assert.Equal("""{"type":"lock","id":"l1"}""", PipeMessage.Encode(PipeMessage.Lock("l1")));
    }
}
