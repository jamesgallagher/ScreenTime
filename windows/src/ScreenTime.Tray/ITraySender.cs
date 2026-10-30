using ScreenTime.Core.Tray;

namespace ScreenTime.Tray;

/// <summary>
/// How the flyout's panels reach the parents (docs/SPEC.md §16.3): the pipe sends them to the service, which calls the
/// server. The demo has a fake one. Each call returns when the service answers. The parent mode calls have "not wired
/// yet" bodies (offline, or no) until the pipe implements them (CARD-050d).
/// </summary>
internal interface ITraySender
{
    /// <summary>"Ask for more time": 15, 30 or 60 minutes, with an optional reason (at most 160 characters).</summary>
    Task<SendResult> AskAsync(int minutes, string? reason);

    /// <summary>A message to the parents: a preset (its id and text) or the kid's own words (at most 160 characters).</summary>
    Task<SendResult> MessageAsync(string? presetId, string text);

    /// <summary>"I'm the parent": asks every parent to approve parent mode (docs/SPEC.md §12.3).</summary>
    Task<SendResult> RequestParentModeAsync() => Task.FromResult(SendResult.Offline);

    /// <summary>Whether <paramref name="code"/> is the parent code now. The service checks it: the tray never sees the secret.</summary>
    Task<bool> CheckParentCodeAsync(string code) => Task.FromResult(false);

    /// <summary>Starts parent mode after a right code: 2, 5, 15 or 60 minutes, or null for "Until I end it".</summary>
    Task<bool> StartParentModeAsync(int? minutes) => Task.FromResult(false);

    /// <summary>"End now": parent mode stops at once.</summary>
    Task<bool> EndParentModeAsync() => Task.FromResult(false);
}
