using System.Globalization;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Time;

namespace ScreenTime.Core.Tray;

/// <summary>
/// The tray's status from the cached state and the engine (docs/SPEC.md §16.3): the Windows twin of the Android kid
/// app's <c>KidStatus</c>.
/// </summary>
public static class TrayStatusBuilder
{
    /// <summary>What the tray shows now, from the state and the engine's answer for the kid's pool.</summary>
    public static TrayStatus From(DeviceState state, EngineResult result, long nowMs, bool online, long? syncedAtMs)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(state.Family.Timezone);
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(nowMs), tz);
        var date = DateOnly.FromDateTime(local.DateTime);

        ScheduleDay Day(DateOnly d) =>
            state.Schedule.Days.First(x => x.Weekday == ((int)d.DayOfWeek + 6) % 7 + 1);

        static string ClockText(string hhmm)
        {
            var t = TimeOnly.ParseExact(hhmm, "HH:mm", CultureInfo.InvariantCulture);
            return TrayText.Clock(t.Hour, t.Minute);
        }

        var today = Day(date);
        var parentMode = LockKeeper.ParentModeOn(state, nowMs);
        var locked = result.Locked && !parentMode;
        var lockReason = locked ? result.LockReason : null;
        var lockAtMs = parentMode ? null : result.NextLockAt?.ToUnixTimeMilliseconds();

        long leftSec;
        if (locked) leftSec = 0;
        else if (lockAtMs is { } at) leftSec = Math.Max(0, (at - nowMs) / 1000);
        else leftSec = result.RemainingSec;

        string? bedtime = null;
        if (today.Bedtime != "24:00")
        {
            var bed = TimeOnly.ParseExact(today.Bedtime, "HH:mm", CultureInfo.InvariantCulture);
            if (TimeOnly.FromTimeSpan(local.TimeOfDay) < bed) bedtime = TrayText.Clock(bed.Hour, bed.Minute);
        }

        string? backAt = lockReason switch
        {
            LockReason.BeforeWake => ClockText(today.Wake),
            LockReason.Bedtime => ClockText(Day(date.AddDays(1)).Wake),
            _ => null,
        };

        string? parentModeEnds = null;
        if (parentMode && state.ParentMode.EndsAt is { } endsAt)
        {
            var ends = TimeZoneInfo.ConvertTime(DateTimeOffset.Parse(endsAt, CultureInfo.InvariantCulture), tz);
            parentModeEnds = TrayText.Clock(ends.Hour, ends.Minute);
        }

        var poolName = state.Device.Pool == Api.Pool.Phone ? "Phone" : "Screens";
        var parentNames = state.Parents.Select(p => p.DisplayName).ToList();

        return new TrayStatus(state.Kid.Name, poolName, lockReason, leftSec, result.UsedSec, lockAtMs, bedtime, backAt,
            state.Schedule.Warn1Min, state.Schedule.Warn2Min, online, syncedAtMs, parentMode, parentModeEnds, parentNames,
            state.MessagePresets.Select(p => new TrayPreset(p.Id, p.Text)).ToList(), state.PendingRequest?.Minutes);
    }
}
