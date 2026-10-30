using Microsoft.UI.Dispatching;
using ScreenTime.Core.Tray;

namespace ScreenTime.Tray;

/// <summary>
/// The seam between the tray's front end and its pipe (docs/SPEC.md §16.3). The pipe (or the demo) calls
/// <see cref="Update"/> and <see cref="Toast"/> from any thread; the icon, the flyout and the toasts listen on the UI
/// thread. Between updates the UI counts down from the last status itself.
/// </summary>
internal sealed class TrayModel(DispatcherQueue ui)
{
    private long _statusTick;

    /// <summary>The last status from the service; null until the first one arrives.</summary>
    public TrayStatus? Status { get; private set; }

    /// <summary>A new status arrived (UI thread).</summary>
    public event Action? Changed;

    /// <summary>A toast to show (UI thread).</summary>
    public event Action<string>? ToastRequested;

    /// <summary>Called by the pipe on every <c>view</c> message.</summary>
    public void Update(TrayStatus status) => ui.TryEnqueue(() =>
    {
        Status = status;
        _statusTick = Environment.TickCount64;
        Changed?.Invoke();
    });

    /// <summary>Called by the pipe on every <c>toast</c> message.</summary>
    public void Toast(string text) => ui.TryEnqueue(() => ToastRequested?.Invoke(text));

    /// <summary>Seconds left now, counted down from the last status.</summary>
    public long LeftSecNow() => Status?.LeftSecAfter(Environment.TickCount64 - _statusTick) ?? 0;
}
