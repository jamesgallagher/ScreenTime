using Microsoft.UI.Xaml;

namespace ScreenTime.Tray;

/// <summary>
/// CARD-048: the tray has no window yet (the flyout comes in CARD-049). It only keeps the pipe to the service, which
/// starts it with <c>--pipe ScreenTime.&lt;sessionId&gt; [--dry-lock]</c>. Copied verbatim from the card.
/// </summary>
public partial class App : Application
{
    private TrayPipe? _pipe;

    public App()
    {
        InitializeComponent();
        DispatcherShutdownMode = DispatcherShutdownMode.OnExplicitShutdown;
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var argv = Environment.GetCommandLineArgs();
        var at = Array.IndexOf(argv, "--pipe");
        if (at < 0 || at + 1 >= argv.Length)
        {
            TrayLog.Write("no --pipe: exiting");
            Exit();
            return;
        }
        var dryLock = Array.IndexOf(argv, "--dry-lock") >= 0;
        _pipe = new TrayPipe(argv[at + 1], dryLock, TrayLog.Write);
        _ = _pipe.RunAsync();
    }
}
