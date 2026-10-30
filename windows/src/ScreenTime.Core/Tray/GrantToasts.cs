using ScreenTime.Core.Api;

namespace ScreenTime.Core.Tray;

/// <summary>
/// The "Dad added 15 minutes" toasts (docs/SPEC.md §16.3): one per enrolled account; the service calls
/// <see cref="Check"/> after every successful sync.
/// </summary>
public sealed class GrantToasts
{
    private readonly HashSet<string> _seen = new();
    private string? _date;

    /// <summary>One toast text for each new grant of time, in the order of <c>state.Today.Grants</c>.</summary>
    public IReadOnlyList<string> Check(DeviceState state)
    {
        var quiet = false;
        if (state.Today.Date != _date)
        {
            _seen.Clear();
            _date = state.Today.Date;
            quiet = true;
        }
        var toasts = new List<string>();
        foreach (var grant in state.Today.Grants)
        {
            if (_seen.Add(grant.Id) && !quiet && grant.Minutes > 0)
            {
                toasts.Add($"{grant.ByName} added {MinutesText(grant.Minutes)}");
            }
        }
        return toasts;
    }

    /// <summary>How the minutes read: "1 minute", "45 minutes", "1 hour", "1h 30m", "2h".</summary>
    private static string MinutesText(int minutes) => minutes switch
    {
        1 => "1 minute",
        > 1 and < 60 => $"{minutes} minutes",
        60 => "1 hour",
        _ => DurationFormat.Format(minutes * 60L),
    };
}
