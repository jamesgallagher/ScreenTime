namespace ScreenTime.Core;

/// <summary>
/// Formats a duration for people, as in docs/SPEC.md §16.1:
/// "1h 12m", "45m", "2h", or "less than a minute".
/// Seconds are rounded down to whole minutes. Zero or negative gives "less than a minute".
/// </summary>
public static class DurationFormat
{
    public static string Format(long seconds)
    {
        var totalMinutes = seconds / 60;
        if (totalMinutes < 1)
        {
            return "less than a minute";
        }

        var hours = totalMinutes / 60;
        var minutes = totalMinutes % 60;
        if (hours == 0)
        {
            return $"{minutes}m";
        }

        return minutes == 0 ? $"{hours}h" : $"{hours}h {minutes}m";
    }
}
