using System.Text.Json;
using ScreenTime.Core.Time;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-045: every case in test-vectors/engine/ (docs/SPEC.md §7.4). Copied verbatim from the card.</summary>
public class EngineVectorsTests
{
    private static readonly string Folder = Path.Combine(AppContext.BaseDirectory, "vectors");

    public static TheoryData<string> Files()
    {
        var data = new TheoryData<string>();
        foreach (var f in Directory.GetFiles(Folder, "*.json").Order(StringComparer.Ordinal)) data.Add(Path.GetFileName(f));
        return data;
    }

    [Fact]
    public void FindsTheVectorFiles()
    {
        Assert.True(Directory.GetFiles(Folder, "*.json").Length >= 26, "fewer than 26 vector files");
    }

    [Theory]
    [MemberData(nameof(Files))]
    public void Vector(string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(Folder, file)));
        var c = doc.RootElement;
        var day = c.GetProperty("day");
        var input = new EngineInput(
            TimeZoneInfo.FindSystemTimeZoneById(c.GetProperty("tz").GetString()!),
            DateOnly.Parse(c.GetProperty("date").GetString()!),
            Instant(c.GetProperty("now")),
            new DaySchedule(day.GetProperty("allowanceMin").GetInt32(), day.GetProperty("wake").GetString()!, day.GetProperty("bedtime").GetString()!),
            c.GetProperty("grants").EnumerateArray().Select(g => new Grant(g.GetProperty("minutes").GetInt32(), Instant(g.GetProperty("createdAt")))).ToList(),
            c.GetProperty("segments").EnumerateArray().Select(s => new Segment(Instant(s.GetProperty("start")), InstantOrNull(s.GetProperty("end")))).ToList());

        var r = Engine.Evaluate(input);
        var e = c.GetProperty("expect");
        Assert.Equal(e.GetProperty("locked").GetBoolean(), r.Locked);
        Assert.Equal(StringOrNull(e.GetProperty("lockReason")), r.LockReason?.ToApiValue());
        Assert.Equal(e.GetProperty("remainingSec").GetInt64(), r.RemainingSec);
        // DateTimeOffset equality compares instants, so the vectors' +11:00 offsets do not matter.
        Assert.Equal(InstantOrNull(e.GetProperty("nextLockAt")), r.NextLockAt);
        Assert.Equal(Instant(e.GetProperty("reevaluateAt")), r.ReevaluateAt);
        Assert.Equal(e.GetProperty("usedSec").GetInt64(), r.UsedSec);
        Assert.Equal(e.GetProperty("overspendSec").GetInt64(), r.OverspendSec);
    }

    [Fact]
    public void LockReasonsUseTheApiWords()
    {
        Assert.Equal("out_of_time", LockReason.OutOfTime.ToApiValue());
        Assert.Equal("bedtime", LockReason.Bedtime.ToApiValue());
        Assert.Equal("before_wake", LockReason.BeforeWake.ToApiValue());
    }

    [Fact]
    public void SkippedAndRepeatedLocalTimes()
    {
        var sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");
        // 4 Oct 2026: 02:00 jumps to 03:00, so 02:30 does not exist and moves forward to 03:30 (+11:00).
        Assert.Equal(DateTimeOffset.Parse("2026-10-04T03:30:00+11:00").ToUnixTimeMilliseconds(),
            Engine.LocalMs(new DateOnly(2026, 10, 4), new TimeOnly(2, 30), sydney));
        // 5 Apr 2026: 03:00 goes back to 02:00, so 02:30 happens twice; the earlier one (+11:00) counts.
        Assert.Equal(DateTimeOffset.Parse("2026-04-05T02:30:00+11:00").ToUnixTimeMilliseconds(),
            Engine.LocalMs(new DateOnly(2026, 4, 5), new TimeOnly(2, 30), sydney));
        Assert.Equal(DateTimeOffset.Parse("2026-10-22T07:00:00+11:00").ToUnixTimeMilliseconds(),
            Engine.LocalMs(new DateOnly(2026, 10, 22), new TimeOnly(7, 0), sydney));
    }

    private static DateTimeOffset Instant(JsonElement e) => DateTimeOffset.Parse(e.GetString()!, System.Globalization.CultureInfo.InvariantCulture);

    private static DateTimeOffset? InstantOrNull(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : Instant(e);

    private static string? StringOrNull(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetString();
}
