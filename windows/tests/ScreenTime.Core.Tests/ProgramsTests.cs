using ScreenTime.Core.Api;
using ScreenTime.Core.Programs;
using Xunit;
using static ScreenTime.Core.Tests.ProgramsTests;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-067: naming programs, counting their time, and the upload (docs/SPEC.md §12.9).</summary>
public sealed class ProgramsTests
{
    private static long Local(string date, string time, string zoneId)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        var local = DateOnly.Parse(date).ToDateTime(TimeOnly.Parse(time), DateTimeKind.Unspecified);
        var offset = tz.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUnixTimeMilliseconds();
    }

    // Criterion 9: Id.
    [Fact]
    public void IdIsTheFileNameInLowerCase()
    {
        Assert.Equal("calculatorapp.exe", ProgramNames.Id(@"C:\Program Files\WindowsApps\Microsoft.WindowsCalculator_11.2607.0.0_x64__8wekyb3d8bbwe\CalculatorApp.exe"));
        Assert.Equal("notepad.exe", ProgramNames.Id(@"C:\X\Notepad.exe"));
    }

    // Criterion 10: Label.
    [Fact]
    public void LabelIsTheFileDescriptionWithoutTheExeSuffix()
    {
        Assert.Equal("Notepad", ProgramNames.Label(@"C:\Windows\System32\Notepad.exe", "Notepad.exe", "Microsoft Notepad"));
        Assert.Equal("Calculator", ProgramNames.Label(@"C:\Program Files\WindowsApps\Microsoft.WindowsCalculator_11.2607.0.0_x64__8wekyb3d8bbwe\CalculatorApp.exe", "Calculator", "Microsoft Calculator"));
        Assert.Equal("Some Product", ProgramNames.Label(@"C:\X\x.exe", "", "Some Product"));
        Assert.Equal("GenshinImpact", ProgramNames.Label(@"C:\Games\GenshinImpact.exe", null, null));
        var longDesc = new string('a', 100);
        Assert.Equal(longDesc[..80], ProgramNames.Label(@"C:\X\a.exe", longDesc, null));
    }

    // Criterion 11: Ignored.
    [Theory]
    [InlineData("explorer.exe", "Progman", true)]
    [InlineData("Explorer.EXE", "Shell_TrayWnd", true)]
    [InlineData("SearchHost.exe", "Windows.UI.Core.CoreWindow", true)]
    [InlineData("screentime.tray.exe", "SomeClass", true)]
    [InlineData("explorer.exe", "CabinetWClass", false)]
    [InlineData("notepad.exe", "Notepad", false)]
    public void IgnoredIsTheDesktopTaskbarsAndNamedProcesses(string exe, string cls, bool expected)
    {
        Assert.Equal(expected, ProgramNames.Ignored(exe, cls));
    }

    // Criterion 12: ProgramClock across a local midnight.
    [Fact]
    public void TimeIsSplitAtTheLocalMidnight()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");
        var clock = new ProgramClock(zone);
        var at = (string d, string t) => Local(d, t, "Australia/Sydney");

        var a = at("2026-11-10", "09:00");
        var b = at("2026-11-10", "09:10");
        var f1 = at("2026-11-10", "23:50");
        var f2 = at("2026-11-11", "00:20");

        clock.Counting(true, a);
        var p1 = clock.Front("a.exe", "A", a);
        var p2 = clock.Front("b.exe", "B", b);
        var p3 = clock.Flush(f1);
        var p4 = clock.Flush(f2);

        Assert.Empty(p1);
        Assert.Single(p2);
        Assert.Equal("2026-11-10", p2[0].Day);
        Assert.Equal("a.exe", p2[0].Id);
        Assert.Equal(600_000, p2[0].Ms);
        Assert.Single(p3);
        Assert.Equal("2026-11-10", p3[0].Day);
        Assert.Equal("b.exe", p3[0].Id);
        Assert.Equal(52_800_000, p3[0].Ms);
        Assert.Equal(2, p4.Count);
        Assert.Equal("2026-11-10", p4[0].Day);
        Assert.Equal("b.exe", p4[0].Id);
        Assert.Equal(600_000, p4[0].Ms);
        Assert.Equal("2026-11-11", p4[1].Day);
        Assert.Equal("b.exe", p4[1].Id);
        Assert.Equal(1_200_000, p4[1].Ms);
    }

    // Criterion 13: counting off, nothing in front, and a clock that steps back.
    [Fact]
    public void NothingCountsWhileCountingIsOffOrNothingIsInFront()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");
        var clock = new ProgramClock(zone);
        var at = (string d, string t) => Local(d, t, "Australia/Sydney");
        var a = at("2026-11-10", "09:00");
        var off = at("2026-11-10", "09:05");
        var on = at("2026-11-10", "09:08");
        var b = at("2026-11-10", "09:10");
        var c = at("2026-11-10", "09:20");
        var f = at("2026-11-10", "09:30");

        clock.Counting(true, a);
        var p1 = clock.Front("a.exe", "A", a);
        var p2 = clock.Counting(false, off);
        var p3 = clock.Counting(true, on);
        var p4 = clock.Flush(b);
        Assert.Equal(120_000, p4[0].Ms);
        Assert.Equal("a.exe", p4[0].Id);

        // Nothing in front from 09:10 to 09:20: a flush adds nothing.
        var p5 = clock.Front(null, null, b);
        var p6 = clock.Flush(c);
        Assert.Empty(p6);

        // A clock that steps back adds nothing.
        var p7 = clock.Front("a.exe", "A", c);
        var p8 = clock.Flush(f);
        Assert.Equal(600_000, p8[0].Ms);
        var p9 = clock.Flush(at("2026-11-10", "09:25"));
        Assert.Empty(p9);
        var p10 = clock.Flush(at("2026-11-10", "09:26"));
        Assert.Equal(60_000, p10[0].Ms);
    }

    // Criterion 14: daylight saving (25-hour day).
    [Fact]
    public void ADaylightSavingDayIs25HoursLong()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");
        var clock = new ProgramClock(zone);
        var at = (string d, string t) => Local(d, t, "Australia/Sydney");
        var from = at("2026-04-05", "00:00");
        var to = at("2026-04-06", "01:00");

        clock.Counting(true, from);
        var p1 = clock.Front("a.exe", "A", from);
        var p2 = clock.Flush(to);
        Assert.Equal("2026-04-05", p2[0].Day);
        Assert.Equal(90_000_000, p2[0].Ms);
        Assert.Equal("2026-04-06", p2[1].Day);
        Assert.Equal(3_600_000, p2[1].Ms);
    }

    // Criterion 15: ProgramUpload.
    [Fact]
    public void TheUploadIsTheEightLocalDaysEndingToday()
    {
        var rows = new List<ProgramUpload.ProgramDay>();
        // 9 days before today: left out.
        rows.Add(new ProgramUpload.ProgramDay("2026-11-12", "old.exe", "Old", 60_000));
        // The 8 days, oldest first: 2026-11-13 to 2026-11-20.
        for (var d = 13; d <= 20; d++)
        {
            rows.Add(new ProgramUpload.ProgramDay($"2026-11-{d:D2}", "ok.exe", "Ok", 60_000));
        }
        // 999 ms is left out (less than 1 second).
        rows.Add(new ProgramUpload.ProgramDay("2026-11-20", "tiny.exe", "Tiny", 999));
        // 90,000,000 ms becomes 86,400 seconds.
        rows.Add(new ProgramUpload.ProgramDay("2026-11-20", "big.exe", "Big", 90_000_000));
        // 600 programs on one day become the 500 with the most seconds.
        for (var i = 0; i < 600; i++)
        {
            rows.Add(new ProgramUpload.ProgramDay("2026-11-19", $"p{i:D3}.exe", $"P{i}", (1000 - i) * 1000));
        }

        var body = ProgramUpload.Build(rows, "UTC", Local("2026-11-20", "12:00", "UTC"))!;
        Assert.Equal(8, body.Days.Count);
        Assert.Equal("2026-11-13", body.Days[0].Day);
        Assert.Equal("2026-11-20", body.Days[7].Day);
        Assert.DoesNotContain(body.Days.SelectMany(d => d.Apps.Select(a => a.Package)), p => p == "old.exe");
        var day20 = body.Days[7];
        Assert.DoesNotContain(day20.Apps.Select(a => a.Package), p => p == "tiny.exe");
        Assert.Equal(86_400, day20.Apps.First(a => a.Package == "big.exe").Seconds);
        var day19 = body.Days[6];
        Assert.Equal(500, day19.Apps.Count);
        Assert.Equal(1000, day19.Apps[0].Seconds);
        Assert.Equal(501, day19.Apps[499].Seconds);

        Assert.Null(ProgramUpload.Build([], "UTC", Local("2026-11-20", "12:00", "UTC")));
    }
}
