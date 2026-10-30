using ScreenTime.Core.Service;
using ScreenTime.Core.Tray;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-050b: a "yes" shows "Dad said yes!", not also "Dad added …" (docs/SPEC.md §16.2). Copied verbatim from the card.</summary>
public class AnswerGrantTests
{
    private const string Yes = """{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"requestId":"r1","approved":true,"minutes":30,"byName":"Dad","grant":{"id":"g9","minutes":30,"createdAt":"2026-10-26T01:00:00.000Z","byName":"Dad"}}}""";

    private static string G(string id, int minutes) =>
        $$"""{"id":"{{id}}","minutes":{{minutes}},"createdAt":"2026-10-26T01:00:00.000Z","byName":"Dad"}""";

    [Fact]
    public void AYesNamesItsGrant() => Assert.Equal("g9", Live.AnswerGrantId(Yes));

    [Theory]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"requestId":"r1","approved":false,"minutes":0,"byName":"Dad","grant":null}}""")]
    [InlineData("""{"v":1,"type":"grant_added","at":"2026-10-26T01:00:00Z","data":{"grant":{"id":"g9"}}}""")]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"grant":{"minutes":30}}}""")]
    [InlineData("not json")]
    public void OtherFramesNameNoGrant(string frame) => Assert.Null(Live.AnswerGrantId(frame));

    [Fact]
    public void ASkippedGrantIsNotToastedButOthersAre()
    {
        var t = new GrantToasts();
        t.Check(State());
        t.Skip("g9");
        Assert.Equal(["Dad added 15 minutes"], t.Check(State(grants: G("g9", 30) + "," + G("g10", 15))));
        Assert.Empty(t.Check(State(grants: G("g9", 30) + "," + G("g10", 15))));
    }
}
