using System.Text;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-050c: parent mode on Windows (docs/SPEC.md §12.3), the same rules as Android's ParentMode.kt. Copied verbatim from the card.</summary>
public class ParentModeTests
{
    /// <summary>The RFC 6238 test key, "12345678901234567890", in base32.</summary>
    private const string RfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    private static readonly DeviceStateParentMode Off = new(false, null, null);

    [Fact]
    public void Base32IsDecodedInAnyCaseWithPadding()
    {
        Assert.Equal(Encoding.ASCII.GetBytes("12345678901234567890"), Totp.Base32Decode(RfcSecret));
        Assert.Equal(Encoding.ASCII.GetBytes("12345678901234567890"), Totp.Base32Decode(RfcSecret.ToLowerInvariant()));
        Assert.Equal(Encoding.ASCII.GetBytes("f"), Totp.Base32Decode("MY======"));
        Assert.Equal(Encoding.ASCII.GetBytes("foobar"), Totp.Base32Decode("MZXW6YTBOI======"));
        Assert.Null(Totp.Base32Decode("MZXW1"));
    }

    [Theory]
    [InlineData(59_000L, "287082")]
    [InlineData(1_111_111_109_000L, "081804")]
    [InlineData(1_111_111_111_000L, "050471")]
    [InlineData(1_234_567_890_000L, "005924")]
    [InlineData(2_000_000_000_000L, "279037")]
    [InlineData(20_000_000_000_000L, "353130")]
    public void TheCodesAreTheRfc6238OnesCutToSixDigits(long timeMs, string expected) =>
        Assert.Equal(expected, Totp.Code(Totp.Base32Decode(RfcSecret)!, timeMs));

    [Fact]
    public void ACodeIsGoodForOneStepEitherSide()
    {
        const long now = 1_111_111_109_000L;
        Assert.True(Totp.Ok(RfcSecret, "081804", now));
        Assert.True(Totp.Ok(RfcSecret, "081804", now + 30_000L));
        Assert.True(Totp.Ok(RfcSecret, "081804", now - 30_000L));
        Assert.False(Totp.Ok(RfcSecret, "081804", now + 60_000L));
        Assert.False(Totp.Ok(RfcSecret, "081805", now));
        Assert.False(Totp.Ok(RfcSecret, "81804", now));
        Assert.False(Totp.Ok(RfcSecret, "08180a", now));
        Assert.False(Totp.Ok("not base32!", "081804", now));
        Assert.False(Totp.Ok("", "081804", now));
    }

    [Fact]
    public void TheSnapshotSaysWhenAParentTurnedItOn()
    {
        var now = Ms("2026-10-27T05:00:00Z");
        var on = new DeviceStateParentMode(true, "2026-10-27T05:15:00.000Z", "Dad");
        Assert.Equal(new ParentModeOn(Ms("2026-10-27T05:15:00Z"), "Dad"), ParentModes.Now(on, now - 1_000, new LocalParentMode(), now));
        Assert.Null(ParentModes.Now(on, now - 1_000, new LocalParentMode(), Ms("2026-10-27T05:15:00Z")));
        var forever = new DeviceStateParentMode(true, null, "Mum");
        Assert.Equal(new ParentModeOn(null, "Mum"), ParentModes.Now(forever, now, new LocalParentMode(), now + 86_400_000L));
        Assert.Null(ParentModes.Now(Off, now, new LocalParentMode(), now));
    }

    [Fact]
    public void ACodeSessionCountsUntilTheSnapshotHasIt()
    {
        var start = Ms("2026-10-27T05:00:00Z");
        var code = new CodeSession("c1", 15, start);
        var local = new LocalParentMode(code);
        Assert.Equal(new ParentModeOn(start + 15 * 60_000L, null), ParentModes.Now(Off, start - 60_000L, local, start + 60_000L));
        Assert.Null(ParentModes.Now(Off, start - 60_000L, local, start + 15 * 60_000L));
        var sent = new LocalParentMode(code with { ReportedAtMs = start + 60_000L });
        Assert.Equal(new ParentModeOn(start + 15 * 60_000L, null), ParentModes.Now(Off, start, sent, start + 120_000L));
        Assert.Null(ParentModes.Now(Off, start + 90_000L, sent, start + 120_000L));
        var forever = new LocalParentMode(new CodeSession("c2", null, start));
        Assert.Equal(new ParentModeOn(null, null), ParentModes.Now(Off, start, forever, start + 86_400_000L));
        Assert.True(local.Pending);
        Assert.False(sent.Pending);
    }

    [Fact]
    public void EndNowBeatsOlderSnapshotsAndCodeSessions()
    {
        var now = Ms("2026-10-27T05:00:00Z");
        var on = new DeviceStateParentMode(true, null, "Dad");
        var ended = new LocalParentMode(EndedAtMs: now, EndReported: false);
        Assert.Null(ParentModes.Now(on, now - 1_000, ended, now + 1_000));
        Assert.Equal(new ParentModeOn(null, "Dad"), ParentModes.Now(on, now + 5_000, ended, now + 6_000));
        var before = ended with { Code = new CodeSession("c1", null, now - 60_000L) };
        Assert.Null(ParentModes.Now(Off, now - 120_000L, before, now + 1_000));
        var after = ended with { Code = new CodeSession("c2", 5, now + 1_000) };
        Assert.Equal(new ParentModeOn(now + 1_000 + 5 * 60_000L, null), ParentModes.Now(Off, now - 120_000L, after, now + 2_000));
        Assert.True(ended.Pending);
    }

    [Fact]
    public void TheEffectiveStateCarriesParentModeForEveryoneElse()
    {
        // The snapshot was made at 2026-10-25T23:00:00Z (SyncTestData), with parent mode off.
        var state = State();
        var start = Ms("2026-10-25T23:01:00Z");
        var local = new LocalParentMode(new CodeSession("c1", 15, start));
        var on = ParentModes.Effective(state, local, start + 1_000);
        Assert.Equal(new DeviceStateParentMode(true, "2026-10-25T23:16:00.000Z", null), on.ParentMode);
        Assert.True(LockKeeper.ParentModeOn(on, start + 1_000));
        Assert.Equal(state with { ParentMode = on.ParentMode }, on);

        var over = ParentModes.Effective(state, local, start + 15 * 60_000L);
        Assert.Equal(new DeviceStateParentMode(false, null, null), over.ParentMode);
        Assert.Same(state.Today, over.Today);
    }

    [Theory]
    [InlineData("""{"v":1,"type":"parent_mode","at":"2026-10-27T05:00:00Z","data":{"active":false,"endsAt":null,"byName":"Dad","requestId":"r1"}}""", false, "Dad", "r1")]
    [InlineData("""{"v":1,"type":"parent_mode","at":"2026-10-27T05:00:00Z","data":{"active":true,"endsAt":"2026-10-27T05:15:00.000Z","byName":"Mum","requestId":null}}""", true, "Mum", null)]
    public void AParentsAnswerIsRead(string frame, bool active, string byName, string? requestId)
    {
        var answer = Live.ParentModeAnswer(frame);
        Assert.NotNull(answer);
        Assert.Equal(active, answer.Active);
        Assert.Equal(byName, answer.ByName);
        Assert.Equal(requestId, answer.RequestId);
    }

    [Theory]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-27T05:00:00Z","data":{"active":false}}""")]
    [InlineData("""{"v":1,"type":"parent_mode","at":"2026-10-27T05:00:00Z"}""")]
    [InlineData("""{"v":1,"type":"parent_mode","at":"2026-10-27T05:00:00Z","data":{"endsAt":null}}""")]
    [InlineData("not json")]
    public void OtherFramesAreNoParentModeAnswer(string frame) => Assert.Null(Live.ParentModeAnswer(frame));

    [Fact]
    public void ANoNamesWhoSaidIt()
    {
        Assert.Equal("Dad said no.", ParentModes.NoText("Dad", ["Mum", "Dad"]));
        Assert.Equal("Mum or Dad said no.", ParentModes.NoText(null, ["Mum", "Dad"]));
    }

    [Fact]
    public void TheParentPipeLinesAreCompact()
    {
        Assert.Equal("""{"type":"parent-ask","id":"p1"}""", PipeMessage.Encode(PipeMessage.ParentAsk("p1")));
        Assert.Equal("""{"type":"parent-code","id":"p2","text":"081804"}""", PipeMessage.Encode(PipeMessage.ParentCode("p2", "081804")));
        Assert.Equal("""{"type":"parent-start","id":"p3","minutes":15}""", PipeMessage.Encode(PipeMessage.ParentStart("p3", 15)));
        Assert.Equal("""{"type":"parent-start","id":"p3"}""", PipeMessage.Encode(PipeMessage.ParentStart("p3", null)));
        Assert.Equal("""{"type":"parent-end","id":"p4"}""", PipeMessage.Encode(PipeMessage.ParentEnd("p4")));
        Assert.Equal("""{"type":"done","id":"p2","approved":false}""", PipeMessage.Encode(PipeMessage.Done("p2", false)));
        Assert.Equal("""{"type":"parent-no","text":"Dad said no."}""", PipeMessage.Encode(PipeMessage.ParentNo("Dad said no.")));
        foreach (var m in new[] { PipeMessage.ParentStart("p3", null), PipeMessage.Done("p2", true), PipeMessage.ParentCode("p2", "000000") })
        {
            Assert.Equal(m, PipeMessage.Decode(PipeMessage.Encode(m)));
        }
    }
}
