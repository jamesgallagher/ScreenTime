using ScreenTime.Core.Tray;

namespace ScreenTime.Tray;

/// <summary>
/// How the flyout's Ask and Message panels reach the parents (docs/SPEC.md §16.3): the pipe sends them to the service,
/// which calls the server. The demo has a fake one. Each call returns when the service answers.
/// </summary>
internal interface ITraySender
{
    /// <summary>"Ask for more time": 15, 30 or 60 minutes, with an optional reason (at most 160 characters).</summary>
    Task<SendResult> AskAsync(int minutes, string? reason);

    /// <summary>A message to the parents: a preset (its id and text) or the kid's own words (at most 160 characters).</summary>
    Task<SendResult> MessageAsync(string? presetId, string text);
}
