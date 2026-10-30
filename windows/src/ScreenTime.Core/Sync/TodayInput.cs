using System.Globalization;
using ScreenTime.Core.Api;
using ScreenTime.Core.Store;
using ScreenTime.Core.Time;

namespace ScreenTime.Core.Sync;

/// <summary>The engine input for this device's pool today (docs/SPEC.md §7.1, §8.2).</summary>
public static class TodayInput
{
    /// <summary>Start of the family's day that contains <c>nowMs</c>. The device's own time zone is never used (docs/SPEC.md §8.5).</summary>
    public static long DayStartMs(DeviceState state, long nowMs)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(state.Family.Timezone);
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(nowMs), tz).DateTime);
        return Engine.LocalMs(date, TimeOnly.MinValue, tz);
    }

    /// <summary>
    /// The engine input for this device's pool today (docs/SPEC.md §7.1, §8.2): the schedule, grants and pool segments of
    /// the cached snapshot, with this device's own segments from <c>own</c> in place of the server's copies of them. When
    /// the snapshot is from an earlier day, its grants and segments are left out: a new day starts empty.
    /// </summary>
    public static EngineInput For(DeviceState state, IReadOnlyList<LocalSegment> own, long nowMs)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(state.Family.Timezone);
        var now = DateTimeOffset.FromUnixTimeMilliseconds(nowMs);
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, tz).DateTime);
        var weekday = date.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)date.DayOfWeek;
        var day = state.Schedule.Days.First(d => d.Weekday == weekday);
        var allowance = state.Device.Pool == ScreenTime.Core.Api.Pool.Phone ? day.PhoneMin : day.ScreensMin;
        var sameDay = state.Today.Date == date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        var grants = sameDay
            ? state.Today.Grants.Select(g => new Grant(g.Minutes, DateTimeOffset.Parse(g.CreatedAt, CultureInfo.InvariantCulture))).ToList()
            : new List<Grant>();
        var ownIds = own.Select(s => s.Id).ToHashSet();
        var others = sameDay
            ? state.Today.PoolSegments.Where(s => !ownIds.Contains(s.Id))
                .Select(s => new Segment(DateTimeOffset.Parse(s.StartedAt, CultureInfo.InvariantCulture), s.EndedAt is { } e ? DateTimeOffset.Parse(e, CultureInfo.InvariantCulture) : null))
                .ToList()
            : new List<Segment>();
        var mine = own.Select(s => new Segment(DateTimeOffset.FromUnixTimeMilliseconds(s.StartedAtMs), s.EndedAtMs is { } e ? DateTimeOffset.FromUnixTimeMilliseconds(e) : null)).ToList();

        return new EngineInput(tz, date, now, new DaySchedule(allowance, day.Wake, day.Bedtime), grants, others.Concat(mine).ToList());
    }
}
