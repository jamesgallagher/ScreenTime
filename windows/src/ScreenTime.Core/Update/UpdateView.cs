using System.Globalization;

namespace ScreenTime.Core.Update;

/// <summary>
/// Where the PC's own update stands, as the tray shows it (docs/SPEC.md §12.11). The service sends it as the pipe's
/// <c>update</c> line on <c>hello</c> and whenever it changes. <see cref="State"/> is one of <see cref="UpdateStates"/>;
/// <see cref="Offered"/> and <see cref="SizeBytes"/> are set for the states that talk about a newer version.
/// </summary>
public sealed record UpdateView(string Version, string State, string? Offered = null, long? SizeBytes = null);

/// <summary>The nine states of the Updates panel, as written on the pipe (the same states as on Android).</summary>
public static class UpdateStates
{
    public const string Unknown = "unknown";
    public const string Checking = "checking";
    public const string UpToDate = "up-to-date";
    public const string CheckFailed = "check-failed";
    public const string Available = "available";
    public const string Downloading = "downloading";
    public const string Ready = "ready";
    public const string Installing = "installing";
    public const string Failed = "failed";
}

/// <summary>
/// The words of the Updates panel (docs/SPEC.md §12.11). <c>test-vectors/update-words.json</c> holds the table, and the
/// Kotlin and C# tests both read it, so the three apps cannot drift apart.
/// </summary>
public static class UpdateWords
{
    /// <summary>The line under <b>Update now</b> in the tray.</summary>
    public const string WhatWillHappen = "Screen Time closes for about a minute, then opens again. Parent mode stays on.";

    /// <summary>A check that finished less than this long ago is not repeated when the panel opens.</summary>
    public const long RecentCheckSeconds = 60;

    /// <summary>"Version 0.1.130".</summary>
    public static string VersionLabel(UpdateView view) => $"Version {view.Version}";

    /// <summary>"34 MB" (whole megabytes, at least 1).</summary>
    public static string Megabytes(long bytes) =>
        $"{Math.Max(1, (long)Math.Round(bytes / 1_000_000.0, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture)} MB";

    /// <summary>The status line under the version, or null for none.</summary>
    public static string? Status(UpdateView view) => view.State switch
    {
        UpdateStates.Checking => "Checking for updates…",
        UpdateStates.UpToDate => "You're up to date",
        UpdateStates.CheckFailed => "Couldn't check. Check the internet and try again.",
        UpdateStates.Available => $"{view.Offered} is out ({Megabytes(view.SizeBytes ?? 0)}). Update now?",
        UpdateStates.Downloading => $"Getting {view.Offered}…",
        UpdateStates.Ready => $"{view.Offered} is ready. Update now?",
        UpdateStates.Installing => "Updating…",
        UpdateStates.Failed => $"{view.Offered} didn't install.",
        _ => null,
    };

    /// <summary>The main button's words, or null when a spinner is shown instead.</summary>
    public static string? MainButton(UpdateView view) => view.State switch
    {
        UpdateStates.Checking or UpdateStates.Downloading or UpdateStates.Installing => null,
        UpdateStates.Available or UpdateStates.Ready => "Update now",
        UpdateStates.Failed => "Try again",
        _ => "Check for updates",
    };

    /// <summary>Whether the main button applies an update (rather than checking for one); <b>Later</b> shows then too.</summary>
    public static bool MainButtonUpdates(UpdateView view) =>
        view.State is UpdateStates.Available or UpdateStates.Ready or UpdateStates.Failed;

    /// <summary>
    /// Whether opening Updates checks at once: not while something is under way (checking, getting, ready, updating, or a
    /// failed try waiting for <b>Try again</b>), and not when a check finished in the last minute.
    /// </summary>
    public static bool CheckOnOpen(UpdateView view, long? secondsSinceLastCheck) => view.State switch
    {
        UpdateStates.Checking or UpdateStates.Downloading or UpdateStates.Ready or UpdateStates.Installing or UpdateStates.Failed => false,
        _ => secondsSinceLastCheck is null || secondsSinceLastCheck >= RecentCheckSeconds,
    };
}
