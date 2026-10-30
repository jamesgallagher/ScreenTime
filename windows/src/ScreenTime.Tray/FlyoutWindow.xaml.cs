using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using ScreenTime.Core.Tray;
using Windows.Graphics;

namespace ScreenTime.Tray;

/// <summary>
/// The flyout (docs/SPEC.md §16.3): opens above the tray on a left click, hides when it loses focus, and counts down
/// every second while it is open. Ask for more time and Message open as panels in the same window, with the same
/// options as Android (§16.2), and send through <see cref="TrayModel.Sender"/>. I'm the parent stays disabled until
/// parent mode (CARD-050c).
/// </summary>
public sealed partial class FlyoutWindow : Window
{
    private const int WidthDip = 360, HeightDip = 440, MarginDip = 12;
    private const int MaxChars = 160;

    private readonly TrayModel _model;
    private readonly DispatcherQueueTimer _timer;
    private readonly DispatcherQueueTimer _answerTimer;
    private long _hiddenAt;
    private int _askMinutes = 15;
    private TrayPreset? _preset;

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
        // An answer shows for 4 s (§16.2).
        _answerTimer = DispatcherQueue.CreateTimer();
        _answerTimer.Interval = TimeSpan.FromSeconds(4);
        _answerTimer.IsRepeating = false;
        _answerTimer.Tick += (_, _) => AnswerCard.Visibility = Visibility.Collapsed;
        _model.Changed += Render;
        _model.AnswerReceived += ShowAnswer;
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

    /// <summary>Opens the flyout above (x, y) on the main panel, or on "ask" or "message" (for the demo's screenshots).</summary>
    public void ShowAt(int x, int y, string panel = "main")
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
        switch (panel)
        {
            case "ask": OpenAsk(); break;
            case "message": OpenMessage(); break;
            default: ShowPanel(MainPanel); break;
        }
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
        Bar.Foreground = Brush(LevelBrushKey(s.Level(left)));
        var subline = s.Subline();
        SublineText.Text = subline ?? "";
        SublineText.Visibility = subline is null ? Visibility.Collapsed : Visibility.Visible;
        SyncedText.Text = s.SyncedText(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

        var waiting = s.WaitingText();
        WaitingText.Text = waiting ?? "";
        if (waiting is null && WaitingRow.Visibility == Visibility.Visible)
        {
            WaitingRow.Visibility = Visibility.Collapsed;
            Pulse.Stop();
        }
        else if (waiting is not null && WaitingRow.Visibility == Visibility.Collapsed)
        {
            WaitingRow.Visibility = Visibility.Visible;
            Pulse.Begin();
        }

        var canSend = _model.Sender is not null;
        AskButton.IsEnabled = canSend && waiting is null;
        MessageButton.IsEnabled = canSend;
        MessageButton.Content = $"Message {s.ParentsOr}";
    }

    private void ShowPanel(FrameworkElement panel)
    {
        MainPanel.Visibility = panel == MainPanel ? Visibility.Visible : Visibility.Collapsed;
        AskPanel.Visibility = panel == AskPanel ? Visibility.Visible : Visibility.Collapsed;
        MessagePanel.Visibility = panel == MessagePanel ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnBack(object sender, RoutedEventArgs e) => ShowPanel(MainPanel);

    private void OnAsk(object sender, RoutedEventArgs e) => OpenAsk();

    private void OnMessage(object sender, RoutedEventArgs e) => OpenMessage();

    // ---- Ask for more time: 15 min, 30 min or 1 hour (15 chosen), an optional reason, Send. ----

    private void OpenAsk()
    {
        _askMinutes = 15;
        foreach (var chip in new[] { Chip15, Chip30, Chip60 }) chip.IsChecked = chip == Chip15;
        ReasonBox.Text = "";
        AskError.Visibility = Visibility.Collapsed;
        AskSend.IsEnabled = true;
        AskSend.Content = "Send";
        ShowPanel(AskPanel);
    }

    private void OnChip(object sender, RoutedEventArgs e)
    {
        var picked = (ToggleButton)sender;
        foreach (var chip in new[] { Chip15, Chip30, Chip60 }) chip.IsChecked = chip == picked;
        _askMinutes = int.Parse((string)picked.Tag, System.Globalization.CultureInfo.InvariantCulture);
    }

    private void OnReasonChanged(object sender, TextChangedEventArgs e) => ReasonCount.Text = $"{ReasonBox.Text.Length}/{MaxChars}";

    private async void OnAskSend(object sender, RoutedEventArgs e)
    {
        if (_model.Sender is not { } send) return;
        AskSend.IsEnabled = false;
        AskSend.Content = "Sending…";
        AskError.Visibility = Visibility.Collapsed;
        var reason = ReasonBox.Text.Trim();
        var result = await Safely(() => send.AskAsync(_askMinutes, reason.Length == 0 ? null : reason));
        if (result is SendResult.Sent or SendResult.AlreadyAsked)
        {
            ShowPanel(MainPanel);
            return;
        }
        AskError.Text = CantReach();
        AskError.Visibility = Visibility.Visible;
        AskSend.Content = "Send";
        AskSend.IsEnabled = true;
    }

    // ---- Message: a preset, or the kid's own words; Send; "Sent ✓" for 1.5 s. ----

    private void OpenMessage()
    {
        var s = _model.Status;
        MessageTitle.Text = $"Message {s?.ParentsAnd ?? "your parents"}";
        PresetList.Children.Clear();
        foreach (var preset in s?.Presets ?? [])
        {
            var chip = new ToggleButton
            {
                Content = new TextBlock { Text = preset.Text, TextWrapping = TextWrapping.Wrap },
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left,
                MinHeight = 40,
                CornerRadius = new CornerRadius(20),
                Padding = new Thickness(16, 8, 16, 8),
                Tag = preset,
            };
            chip.Click += OnPreset;
            PresetList.Children.Add(chip);
        }
        _preset = null;
        OwnBox.Text = "";
        MessageError.Visibility = Visibility.Collapsed;
        MessageSend.Content = "Send";
        MessageSend.IsEnabled = false;
        ShowPanel(MessagePanel);
    }

    private void OnPreset(object sender, RoutedEventArgs e)
    {
        var picked = (ToggleButton)sender;
        foreach (var chip in PresetList.Children.OfType<ToggleButton>()) chip.IsChecked = chip == picked && picked.IsChecked == true;
        _preset = picked.IsChecked == true ? (TrayPreset)picked.Tag : null;
        if (_preset is not null) OwnBox.Text = "";
        MessageSend.IsEnabled = _preset is not null || OwnBox.Text.Trim().Length > 0;
    }

    private void OnOwnChanged(object sender, TextChangedEventArgs e)
    {
        OwnCount.Text = $"{OwnBox.Text.Length}/{MaxChars}";
        if (OwnBox.Text.Length > 0 && _preset is not null)
        {
            _preset = null;
            foreach (var chip in PresetList.Children.OfType<ToggleButton>()) chip.IsChecked = false;
        }
        MessageSend.IsEnabled = _preset is not null || OwnBox.Text.Trim().Length > 0;
    }

    private async void OnMessageSend(object sender, RoutedEventArgs e)
    {
        if (_model.Sender is not { } send) return;
        var text = _preset?.Text ?? OwnBox.Text.Trim();
        if (text.Length == 0) return;
        MessageSend.IsEnabled = false;
        MessageSend.Content = "Sending…";
        MessageError.Visibility = Visibility.Collapsed;
        var result = await Safely(() => send.MessageAsync(_preset?.Id, text));
        if (result is SendResult.Offline)
        {
            MessageError.Text = CantReach();
            MessageError.Visibility = Visibility.Visible;
            MessageSend.Content = "Send";
            MessageSend.IsEnabled = true;
            return;
        }
        MessageSend.Content = "Sent ✓";
        await Task.Delay(1_500);
        if (MessagePanel.Visibility == Visibility.Visible) ShowPanel(MainPanel);
    }

    // ---- Answers ----

    private void ShowAnswer(string text, bool approved)
    {
        AnswerText.Text = text;
        AnswerCard.Background = Brush(approved ? "StPlentyBrush" : "StSurfaceVariantBrush");
        AnswerText.Foreground = Brush(approved ? "StOnPrimaryBrush" : "StOnSurfaceBrush");
        AnswerCard.Visibility = Visibility.Visible;
        _answerTimer.Stop();
        _answerTimer.Start();
    }

    private string CantReach() => $"Can't reach {_model.Status?.ParentsOr ?? "your parents"} right now. Check the internet and try again.";

    /// <summary>A send that throws counts as offline: the kid just taps Send again.</summary>
    private static async Task<SendResult> Safely(Func<Task<SendResult>> send)
    {
        try
        {
            return await send();
        }
        catch (Exception e)
        {
            TrayLog.Write($"send: {e.Message}");
            return SendResult.Offline;
        }
    }

    private static string LevelBrushKey(TrayLevel level) => level switch
    {
        TrayLevel.Plenty => "StPlentyBrush",
        TrayLevel.Low => "StLowBrush",
        TrayLevel.Critical or TrayLevel.Locked => "StCriticalBrush",
        _ => "StMutedBrush",
    };

    private static Brush Brush(string key) => (Brush)Application.Current.Resources[key];

    [LibraryImport("user32.dll")]
    private static partial uint GetDpiForWindow(nint hwnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetForegroundWindow(nint hwnd);
}
