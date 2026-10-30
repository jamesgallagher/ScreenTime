using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using ScreenTime.Core.Tray;

namespace ScreenTime.Tray;

/// <summary>
/// The tray (docs/SPEC.md §16.3): the icon, the flyout and the toasts, fed by the pipe to the service. The service
/// starts it with <c>--pipe ScreenTime.&lt;sessionId&gt; [--dry-lock]</c>. <c>--demo [state]</c> shows fake statuses
/// without the service; <c>--open [ask|message|parent]</c> also opens the flyout at once, on that panel, and keeps it open
/// (for screenshots and test runs).
/// </summary>
public partial class App : Application
{
    private TrayModel? _model;
    private TrayIcon? _icon;
    private FlyoutWindow? _flyout;
    private TrayPipe? _pipe;

    public App()
    {
        InitializeComponent();
        DispatcherShutdownMode = DispatcherShutdownMode.OnExplicitShutdown;
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var argv = Environment.GetCommandLineArgs();
        var pipeAt = Array.IndexOf(argv, "--pipe");
        var demoAt = Array.IndexOf(argv, "--demo");
        var hasPipe = pipeAt >= 0 && pipeAt + 1 < argv.Length;
        if (!hasPipe && demoAt < 0)
        {
            TrayLog.Write("no --pipe: exiting");
            Exit();
            return;
        }

        var ui = DispatcherQueue.GetForCurrentThread();
        var model = new TrayModel(ui);
        var icon = new TrayIcon();
        var flyout = new FlyoutWindow(model);
        var toasts = new Toasts(icon);
        _model = model;
        _icon = icon;
        _flyout = flyout;

        icon.Clicked += flyout.Toggle;
        icon.NotificationClicked += () => ShowFlyoutNearTray(flyout);
        model.Changed += UpdateIcon;
        model.ToastRequested += toasts.Show;
        model.AnswerReceived += (text, _) => toasts.Show(text);
        model.QuitRequested += () =>
        {
            TrayLog.Write("tray: exiting");
            icon.Dispose();
            Exit();
        };
        // The icon's dot and tooltip count down too, a little less often than the flyout.
        var iconTimer = ui.CreateTimer();
        iconTimer.Interval = TimeSpan.FromSeconds(15);
        iconTimer.Tick += (_, _) => UpdateIcon();
        iconTimer.Start();

        if (demoAt >= 0)
        {
            var state = demoAt + 1 < argv.Length && DemoStatus.Names.Contains(argv[demoAt + 1]) ? argv[demoAt + 1] : null;
            DemoStatus.Run(model, ui, state);
        }
        else
        {
            var dryLock = Array.IndexOf(argv, "--dry-lock") >= 0;
            _pipe = new TrayPipe(argv[pipeAt + 1], dryLock, model, TrayLog.Write);
            _ = _pipe.RunAsync();
        }
        var openAt = Array.IndexOf(argv, "--open");
        // Queued behind the demo's first status, which also arrives through the queue. Pinned: it stays open when it
        // loses focus, so a test run can press its buttons through UI Automation.
        if (openAt >= 0)
        {
            flyout.Pinned = true;
            ui.TryEnqueue(() => ShowFlyoutNearTray(flyout, openAt + 1 < argv.Length ? argv[openAt + 1] : "main"));
        }
    }

    private void UpdateIcon()
    {
        if (_model?.Status is not { } s || _icon is null) return;
        var left = _model.LeftSecNow();
        _icon.Set(s.Level(left), s.Tooltip(left));
    }

    /// <summary>Opens the flyout in the bottom-right corner, where the tray usually is (a toast click, or --open).</summary>
    private static void ShowFlyoutNearTray(FlyoutWindow flyout, string panel = "main")
    {
        var area = Microsoft.UI.Windowing.DisplayArea.Primary.WorkArea;
        flyout.ShowAt(area.X + area.Width, area.Y + area.Height, panel);
    }
}
