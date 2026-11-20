namespace ScreenTime.Core.Programs;

/// <summary>One piece of program time: <paramref name="ms"/> of <paramref name="id"/> on the local day <paramref name="day"/>.</summary>
public sealed record ProgramPiece(string Day, string Id, string Label, long Ms);

/// <summary>
/// What is in front and what to add, for one account (docs/SPEC.md §12.9). Time is added only while counting is on
/// and something is in front, split at every local midnight of the family time zone in between. A clock that steps
/// backwards adds nothing. All calls take the trusted time from the caller.
/// </summary>
public sealed class ProgramClock(TimeZoneInfo zone)
{
    private readonly TimeZoneInfo _tz = zone;
    private string? _id;
    private string _label = "";
    private long _last;
    private bool _counting;

    /// <summary>The program <paramref name="id"/> is in front from <paramref name="atMs"/> (null: nothing).</summary>
    public IReadOnlyList<ProgramPiece> Front(string? id, string? label, long atMs)
    {
        var pieces = Close(atMs);
        _id = id;
        _label = label ?? "";
        _last = atMs;
        return pieces;
    }

    /// <summary>Counting turns <paramref name="on"/> from <paramref name="atMs"/>: the time so far closes.</summary>
    public IReadOnlyList<ProgramPiece> Counting(bool on, long atMs)
    {
        var pieces = Close(atMs);
        _counting = on;
        _last = atMs;
        return pieces;
    }

    /// <summary>Closes the time so far without changing anything.</summary>
    public IReadOnlyList<ProgramPiece> Flush(long atMs) => Close(atMs);

    private IReadOnlyList<ProgramPiece> Close(long atMs)
    {
        if (_id is null || !_counting || atMs <= _last)
        {
            _last = atMs;
            return [];
        }
        var pieces = Split(_tz, _id, _label, _last, atMs);
        _last = atMs;
        return pieces;
    }

    private static IReadOnlyList<ProgramPiece> Split(TimeZoneInfo tz, string id, string label, long fromMs, long toMs)
    {
        var outList = new List<ProgramPiece>();
        var cur = fromMs;
        var midnight = NextMidnight(tz, cur, toMs);
        while (midnight is { } m)
        {
            outList.Add(new ProgramPiece(LocalDate(tz, cur), id, label, m - cur));
            cur = m;
            midnight = NextMidnight(tz, cur, toMs);
        }
        if (toMs > cur) outList.Add(new ProgramPiece(LocalDate(tz, cur), id, label, toMs - cur));
        return outList;
    }

    /// <summary>The next local midnight strictly after <paramref name="fromMs"/> and not after <paramref name="toMs"/>, or null.</summary>
    private static long? NextMidnight(TimeZoneInfo tz, long fromMs, long toMs)
    {
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(fromMs), tz).DateTime);
        var midnight = LocalMs(tz, date.AddDays(1), TimeOnly.MinValue);
        return midnight <= toMs ? midnight : null;
    }

    private static long LocalMs(TimeZoneInfo tz, DateOnly date, TimeOnly time)
    {
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);
        TimeSpan offset;
        if (tz.IsAmbiguousTime(local))
        {
            // The clock went back, so the time happens twice; the largest offset is the earlier instant.
            offset = tz.GetAmbiguousTimeOffsets(local).Max();
        }
        else if (tz.IsInvalidTime(local))
        {
            // The clock jumped forward, so the time never happens; use the offset from before the jump.
            offset = tz.GetUtcOffset(local.AddHours(-2));
        }
        else
        {
            offset = tz.GetUtcOffset(local);
        }
        return new DateTimeOffset(local, offset).ToUnixTimeMilliseconds();
    }

    private static string LocalDate(TimeZoneInfo tz, long ms)
    {
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(ms), tz).DateTime);
        return date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
    }
}
