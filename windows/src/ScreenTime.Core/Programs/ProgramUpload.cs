using System.Globalization;
using ScreenTime.Core.Api;

namespace ScreenTime.Core.Programs;

/// <summary>
/// The <see cref="DeviceAppUsageUpload"/> body of the stored program time (docs/SPEC.md §12.9): the 8 local days
/// ending today, oldest first, per day seconds = ms / 1000 rounded down, capped at 86,400; only programs with at
/// least 1 second; at most 500 per day, most seconds first; days with none left out. Null when no day has anything.
/// </summary>
public static class ProgramUpload
{
    /// <summary>The stored rows of one account: the local day, the program id and its label, and its milliseconds.</summary>
    public sealed record ProgramDay(string Day, string Id, string Label, long Ms);

    public static DeviceAppUsageUpload? Build(IReadOnlyList<ProgramDay> rows, string timezone, long nowMs)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(timezone);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(nowMs), tz).DateTime);
        var days = new List<DeviceAppUsageUploadDaysItem>();
        for (var i = 7; i >= 0; i--)
        {
            var date = today.AddDays(-i);
            var dateText = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var byProgram = rows
                .Where(r => r.Day == dateText)
                .GroupBy(r => r.Id)
                .Select(g => (Id: g.Key, Label: g.First().Label, Sec: g.Sum(r => r.Ms) / 1000))
                .Where(p => p.Sec > 0)
                .OrderByDescending(p => p.Sec)
                .ThenBy(p => p.Label, StringComparer.Ordinal)
                .ThenBy(p => p.Id, StringComparer.Ordinal)
                .Take(500)
                .ToList();
            if (byProgram.Count == 0) continue;
            var apps = new List<DeviceAppUsageUploadDaysItemAppsItem>();
            foreach (var p in byProgram)
            {
                apps.Add(new DeviceAppUsageUploadDaysItemAppsItem(p.Id, (int)Math.Min(p.Sec, 86400), p.Label));
            }
            days.Add(new DeviceAppUsageUploadDaysItem(dateText, apps));
        }
        return days.Count == 0 ? null : new DeviceAppUsageUpload(days);
    }
}
