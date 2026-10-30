namespace ScreenTime.Tray;

/// <summary>
/// Windows toasts (docs/SPEC.md §16.3): "15 minutes of Screens left", "Dad added 15 minutes" and the relock toast. They
/// are the tray icon's notifications, which Windows 11 shows as toasts: unlike app notifications they need no
/// registration, which an unpackaged, self-contained app cannot do reliably.
/// </summary>
internal sealed class Toasts(TrayIcon icon)
{
    public void Show(string text)
    {
        TrayLog.Write($"toast: {text}");
        icon.Notify(text);
    }
}
