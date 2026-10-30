using ScreenTime.Core.Api;

namespace ScreenTime.Core.Tray;

/// <summary>How a failed send shows in the tray (docs/SPEC.md §16.3).</summary>
public static class SendResults
{
    /// <summary>An ask is already waiting (HTTP 409) means <see cref="SendResult.AlreadyAsked"/>; anything else means <see cref="SendResult.Offline"/>.</summary>
    public static SendResult Of(Exception e) =>
        e is ApiException { Status: 409 } ? SendResult.AlreadyAsked : SendResult.Offline;
}
