using ScreenTime.Core.Tray;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-049: the "Dad added 15 minutes" toast (docs/SPEC.md §16.3). Copied verbatim from the card.</summary>
public class GrantToastsTests
{
    private static string G(string id, int minutes, string by = "Dad") =>
        $$"""{"id":"{{id}}","minutes":{{minutes}},"createdAt":"2026-10-26T01:00:00.000Z","byName":"{{by}}"}""";

    [Fact]
    public void GrantsAlreadyThereAtStartAreNotToasted()
    {
        var t = new GrantToasts();
        Assert.Empty(t.Check(State(grants: G("g1", 15))));
    }

    [Fact]
    public void ANewGrantIsToastedOnce()
    {
        var t = new GrantToasts();
        t.Check(State(grants: G("g1", 15)));
        Assert.Equal(["Dad added 15 minutes"], t.Check(State(grants: G("g1", 15) + "," + G("g2", 15))));
        Assert.Empty(t.Check(State(grants: G("g1", 15) + "," + G("g2", 15))));
    }

    [Fact]
    public void ARemovalIsNotToasted()
    {
        var t = new GrantToasts();
        t.Check(State());
        Assert.Empty(t.Check(State(grants: G("g1", -30))));
    }

    [Theory]
    [InlineData(1, "Dad added 1 minute")]
    [InlineData(45, "Dad added 45 minutes")]
    [InlineData(60, "Dad added 1 hour")]
    [InlineData(90, "Dad added 1h 30m")]
    [InlineData(120, "Dad added 2h")]
    public void TheMinutesReadNaturally(int minutes, string expected)
    {
        var t = new GrantToasts();
        t.Check(State());
        Assert.Equal([expected], t.Check(State(grants: G("g1", minutes))));
    }

    [Fact]
    public void SeveralNewGrantsAreToastedInOrder()
    {
        var t = new GrantToasts();
        t.Check(State());
        Assert.Equal(["Mum added 15 minutes", "Dad added 30 minutes"], t.Check(State(grants: G("g1", 15, "Mum") + "," + G("g2", 30))));
    }

    [Fact]
    public void ANewDayStartsQuietly()
    {
        var t = new GrantToasts();
        t.Check(State(date: "2026-10-26", grants: G("g1", 15)));
        Assert.Empty(t.Check(State(date: "2026-10-27", grants: G("g9", 30))));
        Assert.Equal(["Dad added 15 minutes"], t.Check(State(date: "2026-10-27", grants: G("g9", 30) + "," + G("g10", 15))));
    }
}
