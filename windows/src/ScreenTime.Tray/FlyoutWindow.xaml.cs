using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using ScreenTime.Core.Tray;
using Windows.Graphics;

namespace ScreenTime.Tray;

/// <summary>
/// The flyout (docs/SPEC.md §16.3): opens above the tray on a left click, hides when it loses focus, and counts down
/// every second while it is open. Ask, Message and I'm the parent stay disabled until their dialogs (CARD-050).
/// </summary>
public sealed partial class FlyoutWindow : Window
{
    private const int WidthDip = 360, HeightDip = 440, MarginDip = 12;

    private readonly TrayModel _model;
    private readonly DispatcherQueueTimer _timer;
    private long _hiddenAt;

    internal FlyoutWindow(TrayModel model)
    {
        _model = model;
        InitializeComponent();
        SystemBackdrop = new MicaBackdrop();

        var presenter = OverlappedPresenter.Create();
        presenter.IsResizable = false;
        presenter.IsMaximizable = false;
        presenter.IsMinimizable = false;
        presenter.IsAlwaysOnTop = true;
        presenter.SetBorderAndTitleBar(true, false);
        AppWindow.SetPresenter(presenter);
        AppWindow.IsShownInSwitchers = false;
        AppWindow.Closing += (_, e) =>
        {
            e.Cancel = true;
            Hide();
        };
        Activated += (_, e) =>
        {
            if (e.WindowActivationState == WindowActivationState.Deactivated) Hide();
        };

        // Counts down every second, only while the flyout is open.
        _timer = DispatcherQueue.CreateTimer();
        _timer.Interval = TimeSpan.FromSeconds(1);
        _timer.Tick += (_, _) => Render();
        _model.Changed += Render;
        Render();
    }

    public bool IsOpen => AppWindow.IsVisible;

    /// <summary>Opens the flyout above the point the tray gave (physical pixels), or closes it when it is open.</summary>
    public void Toggle(int x, int y)
    {
        // A click on the icon first takes the focus away, which hides the flyout; that click must not reopen it.
        if (IsOpen || Environment.TickCount64 - _hiddenAt < 300)
        {
            Hide();
            return;
        }
        ShowAt(x, y);
    }

    public void ShowAt(int x, int y)
    {
        var area = DisplayArea.GetFromPoint(new PointInt32(x, y), DisplayAreaFallback.Nearest).WorkArea;
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        // Move to the right screen first, so the size uses that screen's scale.
        AppWindow.Move(new PointInt32(area.X, area.Y));
        var scale = GetDpiForWindow(hwnd) / 96.0;
        var w = (int)Math.Round(WidthDip * scale);
        var h = (int)Math.Round(HeightDip * scale);
        var m = (int)Math.Round(MarginDip * scale);
        AppWindow.Resize(new SizeInt32(w, h));
        var left = Math.Clamp(x - w / 2, area.X + m, area.X + area.Width - w - m);
        // The taskbar is usually at the bottom; when the click is above the work area's middle it is at the top.
        var top = y < area.Y + area.Height / 2 ? area.Y + m : area.Y + area.Height - h - m;
        AppWindow.Move(new PointInt32(left, top));
        Render();
        AppWindow.Show();
        Activate();
        SetForegroundWindow(hwnd);
        _timer.Start();
    }

    public void Hide()
    {
        if (!AppWindow.IsVisible) return;
        _timer.Stop();
        AppWindow.Hide();
        _hiddenAt = Environment.TickCount64;
    }

    private void Render()
    {
        if (_model.Status is not { } s) return;
        var left = _model.LeftSecNow();
        TitleText.Text = s.Title;
        BigText.Text = s.BigText(left);
        CaptionText.Text = s.Caption();
        Bar.Value = s.Progress(left);
        Bar.Foreground = LevelBrush(s.Level(left));
        var subline = s.Subline();
        SublineText.Text = subline ?? "";
        SublineText.Visibility = subline is null ? Visibility.Collapsed : Visibility.Visible;
        MessageButton.Content = $"Message {s.ParentsOr}";
        SyncedText.Text = s.SyncedText(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static Brush LevelBrush(TrayLevel level) => (Brush)Application.Current.Resources[level switch
    {
        TrayLevel.Plenty => "StPlentyBrush",
        TrayLevel.Low => "StLowBrush",
        TrayLevel.Critical or TrayLevel.Locked => "StCriticalBrush",
        _ => "StMutedBrush",
    }];

    [LibraryImport("user32.dll")]
    private static partial uint GetDpiForWindow(nint hwnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetForegroundWindow(nint hwnd);
}
