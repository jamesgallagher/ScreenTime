using System.Text.Json.Serialization;
using ScreenTime.Core.Time;

namespace ScreenTime.Core.Tray;

/// <summary>The tray icon's dot and the flyout's progress colour (docs/SPEC.md §16.3).</summary>
public enum TrayLevel { Plenty, Low, Critical, Offline, Locked }

/// <summary>
/// What the tray shows for one kid session (docs/SPEC.md §16.3): the service works it out after every sync and sends
/// it to the tray, which counts down from it between updates. Instants are epoch milliseconds of the trusted clock.
/// Its nulls are always written, so it can be read back where missing constructor parameters are an error.
/// The same rules as the Android kid app's <c>KidStatus</c>.
/// </summary>
/// <param name="KidName">"Alex".</param>
/// <param name="PoolName">"Screens" (a PC always uses the Screens pool).</param>
/// <param name="LockReason">Null while the PC may be used.</param>
/// <param name="LeftSec">Seconds until the PC locks, 0 when locked.</param>
/// <param name="UsedSec">Seconds of the pool used today, on all its devices.</param>
/// <param name="LockAtMs">When the PC locks; null when locked, in parent mode, or when it does not lock today.</param>
/// <param name="Bedtime">Today's bedtime while it is still to come, "8:30 pm".</param>
/// <param name="BackAt">At bedtime or before wake: when the PC can be used again, "7:00 am".</param>
/// <param name="Warn1Min">The first warning, minutes before the lock (default 15).</param>
/// <param name="Warn2Min">The second warning (default 5).</param>
/// <param name="Online">False when the last sync failed: the PC still counts (docs/SPEC.md §8.4).</param>
/// <param name="SyncedAtMs">When the last sync worked; null before the first one.</param>
/// <param name="ParentMode">Parent mode is on (docs/SPEC.md §12.3): not locked, and nothing counts.</param>
/// <param name="ParentModeEnds">When parent mode ends, "4:15 pm"; null while off or until a parent ends it.</param>
/// <param name="ParentNames">The family's parents, oldest first: "Mum", "Dad".</param>
/// <param name="Presets">The family's message presets, for the Message panel; null when none were sent.</param>
/// <param name="PendingMinutes">Minutes of an "Ask for more time" no parent has answered yet; null when there is none.</param>
public sealed record TrayStatus(
    string KidName,
    string PoolName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] LockReason? LockReason,
    long LeftSec,
    long UsedSec,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] long? LockAtMs,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Bedtime,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? BackAt,
    int Warn1Min,
    int Warn2Min,
    bool Online,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] long? SyncedAtMs,
    bool ParentMode,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? ParentModeEnds,
    IReadOnlyList<string> ParentNames,
    IReadOnlyList<TrayPreset>? Presets = null,
    int? PendingMinutes = null)
{
    [JsonIgnore]
    public bool Locked => LockReason is not null;

    /// <summary><see cref="LeftSec"/> after <paramref name="elapsedMs"/> more of use, never below 0.</summary>
    public long LeftSecAfter(long elapsedMs) =>
        LockAtMs is null ? LeftSec : Math.Max(0, LeftSec - Math.Max(0, elapsedMs) / 1000);

    /// <summary>The dot: grey when offline, amber at <see cref="Warn1Min"/> or less, orange at <see cref="Warn2Min"/> or less.</summary>
    public TrayLevel Level(long left)
    {
        if (Locked) return TrayLevel.Locked;
        if (ParentMode) return TrayLevel.Plenty;
        if (!Online) return TrayLevel.Offline;
        if (LockAtMs is null) return TrayLevel.Plenty;
        if (left <= Warn2Min * 60L) return TrayLevel.Critical;
        if (left <= Warn1Min * 60L) return TrayLevel.Low;
        return TrayLevel.Plenty;
    }

    /// <summary>The flyout's first line: "Alex · Screens".</summary>
    [JsonIgnore]
    public string Title => $"{KidName} · {PoolName}";

    /// <summary>The icon's tooltip: "Screens · 1h 12m left", the lock headline, or the parent mode line.</summary>
    public string Tooltip(long left) =>
        Locked ? Headline() : ParentMode ? ParentModeText() : $"{PoolName} · {DurationFormat.Format(left)} left";

    /// <summary>The big number: "1h 12m", "&lt;1m" in the last minute, "0m" when locked.</summary>
    public string BigText(long left) => Locked ? "0m" : left < 60 ? "<1m" : DurationFormat.Format(left);

    /// <summary>The line under the big number: "left today", the lock headline, or the parent mode line.</summary>
    public string Caption() => Locked ? Headline() : ParentMode ? ParentModeText() : "left today";

    /// <summary>"Bedtime 8:30 pm"; "New time tomorrow" or "Screens are back at 7:00 am" when locked; null for none.</summary>
    public string? Subline()
    {
        if (ParentMode) return "Time isn't counting";
        return LockReason switch
        {
            null => Bedtime is null ? null : $"Bedtime {Bedtime}",
            Time.LockReason.OutOfTime => "New time tomorrow",
            _ => BackAt is null ? null : $"{PoolName} are back at {BackAt}",
        };
    }

    /// <summary>How full the progress bar is: the part of today's time that is still left.</summary>
    public double Progress(long left)
    {
        if (Locked) return 0;
        if (left + UsedSec <= 0) return 1;
        return (double)left / (left + UsedSec);
    }

    /// <summary>The footer: "Synced just now", "Synced 5 min ago", or "Offline · still counting".</summary>
    public string SyncedText(long nowMs)
    {
        if (!Online) return "Offline · still counting";
        if (SyncedAtMs is not { } at) return "Not synced yet";
        var minutes = Math.Max(0, nowMs - at) / 60_000;
        return minutes switch
        {
            < 1 => "Synced just now",
            < 60 => $"Synced {minutes} min ago",
            _ => "Synced over an hour ago",
        };
    }

    /// <summary>"Out of Screens time", "It's bedtime" or "Not yet, it's early".</summary>
    public string Headline() => LockReason switch
    {
        Time.LockReason.OutOfTime => $"Out of {PoolName} time",
        Time.LockReason.Bedtime => "It's bedtime",
        Time.LockReason.BeforeWake => "Not yet, it's early",
        _ => "",
    };

    /// <summary>"Parent mode · ends 4:15 pm", or "Parent mode · until you end it".</summary>
    public string ParentModeText() => "Parent mode · " + (ParentModeEnds is null ? "until you end it" : $"ends {ParentModeEnds}");

    /// <summary>"Mum or Dad", for "Message Mum or Dad"; "your parents" when there are none.</summary>
    [JsonIgnore]
    public string ParentsOr => TrayText.Parents(ParentNames, "or");

    /// <summary>"Mum and Dad", for "Message Mum and Dad"; "your parents" when there are none.</summary>
    [JsonIgnore]
    public string ParentsAnd => TrayText.Parents(ParentNames, "and");

    /// <summary>"Waiting for Mum or Dad…" while a request waits for an answer, otherwise null.</summary>
    public string? WaitingText() => PendingMinutes is null ? null : $"Waiting for {ParentsOr}…";
}

/// <summary>Words and times the en-AU way (docs/SPEC.md §16.1).</summary>
public static class TrayText
{
    /// <summary>A time of day: "8:30 pm", "12:05 am".</summary>
    public static string Clock(int hour, int minute)
    {
        var h = hour % 12 == 0 ? 12 : hour % 12;
        return $"{h}:{minute:00} {(hour < 12 ? "am" : "pm")}";
    }

    /// <summary>
    /// The caught line after a tamper attempt (docs/SPEC.md §14), cheesy on purpose; <paramref name="turn"/> picks one
    /// of the three, in order, round and round.
    /// </summary>
    public static string Caught(string kidName, int turn) => (((turn % 3) + 3) % 3) switch
    {
        0 => $"Nice try, Agent {kidName}! 🕵️ Mum and Dad have been told.",
        1 => "Busted! 🚨 The Time Police have filed a report.",
        _ => "Whoa there, hacker! 💻 This attempt has been sent to HQ (Mum and Dad).",
    };

    /// <summary>"Dad", "Mum or Dad", "Mum, Dad or Nan" with <paramref name="word"/> "or"; "your parents" when there are none.</summary>
    public static string Parents(IReadOnlyList<string> names, string word) => names.Count switch
    {
        0 => "your parents",
        1 => names[0],
        _ => string.Join(", ", names.Take(names.Count - 1)) + $" {word} " + names[^1],
    };
}

/// <summary>A ready-made message the kid can send with one tap (docs/SPEC.md §16.2, "Message sheet").</summary>
public sealed record TrayPreset(string Id, string Text);

/// <summary>How sending an ask or a message went, as the tray shows it.</summary>
public enum SendResult
{
    /// <summary>The server has it.</summary>
    Sent,

    /// <summary>An ask is already waiting (HTTP 409): the panel closes as if it were sent.</summary>
    AlreadyAsked,

    /// <summary>No answer from the server: "Can't reach Mum or Dad right now. Check the internet and try again."</summary>
    Offline,
}
