using Microsoft.UI.Dispatching;
using ScreenTime.Core.Tray;

namespace ScreenTime.Tray;

/// <summary>
/// The seam between the tray's front end and its pipe (docs/SPEC.md §16.3). The pipe (or the demo) calls
/// <see cref="Update"/>, <see cref="Toast"/>, <see cref="Answer"/> and <see cref="Quit"/> from any thread, and sets
/// <see cref="Sender"/> for the flyout's Ask and Message panels; the icon, the flyout and the
/// toasts listen on the UI thread. Between updates the UI counts down from the last status itself.
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

    /// <summary>The tray should close: it removes its icon and exits (UI thread).</summary>
    public event Action? QuitRequested;

    /// <summary>A parent answered the kid's ask: the text, and whether it was a yes (UI thread).</summary>
    public event Action<string, bool>? AnswerReceived;

    /// <summary>Sends asks and messages; set by the pipe (or the demo) before the flyout opens.</summary>
    public ITraySender? Sender { get; set; }

    /// <summary>Called by the pipe on every <c>answer</c> message: "Dad said yes! +30 min 🎉" or "Dad said not this time".</summary>
    public void Answer(string text, bool approved) => ui.TryEnqueue(() => AnswerReceived?.Invoke(text, approved));

    /// <summary>Called by the pipe on every <c>view</c> message.</summary>
    public void Update(TrayStatus status) => ui.TryEnqueue(() =>
    {
        Status = status;
        _statusTick = Environment.TickCount64;
        Changed?.Invoke();
    });

    /// <summary>Called by the pipe on every <c>toast</c> message.</summary>
    public void Toast(string text) => ui.TryEnqueue(() => ToastRequested?.Invoke(text));

    /// <summary>Called by the pipe when the service has been gone too long: a new service starts a new tray.</summary>
    public void Quit() => ui.TryEnqueue(() => QuitRequested?.Invoke());

    /// <summary>Seconds left now, counted down from the last status.</summary>
    public long LeftSecNow() => Status?.LeftSecAfter(Environment.TickCount64 - _statusTick) ?? 0;
}
