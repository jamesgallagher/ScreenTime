namespace ScreenTime.Core.Service;

/// <summary>A parent's answer to the kid's "Ask for more time" (docs/SPEC.md §16.2).</summary>
public sealed record RequestAnswer(bool Approved, int Minutes, string ByName)
{
    /// <summary>The line the tray shows, the same as Android: "Dad said yes! +15 min 🎉".</summary>
    public string Text() => Approved
        ? Minutes < 60 ? $"{ByName} said yes! +{Minutes} min 🎉" : $"{ByName} said yes! +{DurationFormat.Format(Minutes * 60L)} 🎉"
        : $"{ByName} said not this time";
}
