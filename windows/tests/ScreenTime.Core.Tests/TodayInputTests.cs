using ScreenTime.Core.Store;
using ScreenTime.Core.Sync;
using ScreenTime.Core.Time;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047: the engine input for today (docs/SPEC.md §7.1, §8.2). Copied verbatim from the card.</summary>
public class TodayInputTests
{
    /// <summary>Monday 26 October 2026, 10:00 in Sydney (UTC+11).</summary>
    private static readonly long Now = Ms("2026-10-25T23:00:00Z");

    [Fact]
    public void TheFamilyDayAndThePoolPickTheAllowance()
    {
        var phone = TodayInput.For(State(pool: "phone"), [], Now);
        var screens = TodayInput.For(State(pool: "screens"), [], Now);

        Assert.Equal(new DateOnly(2026, 10, 26), phone.Date);
        Assert.Equal(60, phone.Day.AllowanceMin);
        Assert.Equal(120, screens.Day.AllowanceMin);
        Assert.Equal("07:00", phone.Day.Wake);
        Assert.Equal("20:30", phone.Day.Bedtime);
        Assert.Equal(Now, phone.Now.ToUnixTimeMilliseconds());
    }

    [Fact]
    public void OwnSegmentsReplaceTheServerCopiesAndOthersStay()
    {
        const string segments = """
            {"id":"mine","deviceId":"d1","startedAt":"2026-10-26T09:00:00+11:00","endedAt":"2026-10-26T09:10:00+11:00"},
            {"id":"tablet","deviceId":"d2","startedAt":"2026-10-26T09:30:00+11:00","endedAt":"2026-10-26T09:40:00+11:00"}
            """;
        const string grants = """{"id":"g1","minutes":15,"createdAt":"2026-10-26T08:00:00+11:00","byName":"Dad"}""";
        // The server has 10 minutes of "mine"; the PC knows it went on to 09:20 and is in use again since 09:50.
        LocalSegment[] own =
        [
            new("mine", Alex, Ms("2026-10-25T22:00:00Z"), Ms("2026-10-25T22:20:00Z"), Ms("2026-10-25T22:20:00Z"), false),
            new("open", Alex, Ms("2026-10-25T22:50:00Z"), null, Ms("2026-10-25T22:59:00Z"), false),
        ];

        var input = TodayInput.For(State(pool: "phone", grants: grants, segments: segments), own, Now);
        var result = Engine.Evaluate(input);

        Assert.Equal(3, input.Segments.Count);
        Assert.Single(input.Grants);
        // Used: 20 (mine) + 10 (tablet) + 10 (open, until now) = 40 min of 60 + 15.
        Assert.Equal(40 * 60L, result.UsedSec);
        Assert.Equal(35 * 60L, result.RemainingSec);
        Assert.False(result.Locked);
    }

    [Fact]
    public void ASnapshotFromYesterdayStartsTheDayEmpty()
    {
        const string segments = """{"id":"tablet","deviceId":"d2","startedAt":"2026-10-25T09:30:00+11:00","endedAt":null}""";
        const string grants = """{"id":"g1","minutes":30,"createdAt":"2026-10-25T08:00:00+11:00","byName":"Dad"}""";
        LocalSegment[] own = [new("open", Alex, Ms("2026-10-25T22:50:00Z"), null, Ms("2026-10-25T22:59:00Z"), false)];

        var input = TodayInput.For(State(pool: "phone", date: "2026-10-25", grants: grants, segments: segments), own, Now);

        Assert.Empty(input.Grants);
        Assert.Single(input.Segments);
        Assert.Equal(50 * 60L, Engine.Evaluate(input).RemainingSec);
    }

    [Fact]
    public void TheDayStartsAtMidnightInTheFamilyZone()
    {
        Assert.Equal(Ms("2026-10-25T13:00:00Z"), TodayInput.DayStartMs(State(), Now));
    }

    [Fact]
    public void SundayIsWeekdaySeven()
    {
        // Sunday 1 November 2026, 10:00 in Sydney.
        var input = TodayInput.For(State(), [], Ms("2026-10-31T23:00:00Z"));
        Assert.Equal(DayOfWeek.Sunday, input.Date.DayOfWeek);
        Assert.Equal(120, input.Day.AllowanceMin);
    }
}
