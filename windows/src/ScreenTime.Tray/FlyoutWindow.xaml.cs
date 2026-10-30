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
/// options as Android (§16.2), and send through <see cref="TrayModel.Sender"/>. I'm the parent opens the parent mode
/// panel (§12.3): ask the parents, or the parent code (checked by the service), then how long; while parent mode is
/// on, End now replaces the kid's buttons.
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
            if (e.WindowActivationState == WindowActivationState.Deactivated && !Pinned) Hide();
        };

        // Counts down every second, only while the flyout is open.
        _timer = DispatcherQueue.CreateTimer();
        _timer.Interval = TimeSpan.FromSeconds(1);
        _timer.Tick += (_, _) => Render();
        // An answer shows for 4 s (§16.2), a caught card for 8 s (§14).
        _answerTimer = DispatcherQueue.CreateTimer();
        _answerTimer.Interval = TimeSpan.FromSeconds(4);
        _answerTimer.IsRepeating = false;
        _answerTimer.Tick += (_, _) => AnswerCard.Visibility = Visibility.Collapsed;
        _model.Changed += Render;
        _model.AnswerReceived += ShowAnswer;
        _model.ParentModeRefused += ShowParentNo;
        _model.CaughtReceived += ShowCaught;
        Render();
    }

    public bool IsOpen => AppWindow.IsVisible;

    /// <summary>Stays open when it loses focus: only for <c>--open</c>, so a test run can press its buttons.</summary>
    public bool Pinned { get; set; }

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

    /// <summary>Opens the flyout above (x, y) on the main panel, or on "ask", "message" or "parent" (for screenshots and test runs).</summary>
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
            case "parent": OpenParent(); break;
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
        ParentButton.IsEnabled = canSend;
        // Parent mode: End now in place of the kid's buttons (§12.3, as on Android).
        var kidButtons = s.ParentMode ? Visibility.Collapsed : Visibility.Visible;
        AskButton.Visibility = kidButtons;
        MessageButton.Visibility = kidButtons;
        ParentButton.Visibility = kidButtons;
        EndNowButton.Visibility = s.ParentMode ? Visibility.Visible : Visibility.Collapsed;
        EndNowButton.IsEnabled = canSend;
        // A parent said yes, or the code started it: the parent panel has done its job.
        if (s.ParentMode && ParentPanel.Visibility == Visibility.Visible) ShowPanel(MainPanel);
    }

    private void ShowPanel(FrameworkElement panel)
    {
        MainPanel.Visibility = panel == MainPanel ? Visibility.Visible : Visibility.Collapsed;
        AskPanel.Visibility = panel == AskPanel ? Visibility.Visible : Visibility.Collapsed;
        MessagePanel.Visibility = panel == MessagePanel ? Visibility.Visible : Visibility.Collapsed;
        ParentPanel.Visibility = panel == ParentPanel ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnParent(object sender, RoutedEventArgs e) => OpenParent();

    // ---- I'm the parent: ask every parent at once; or the parent code; then how long. ----

    private async void OpenParent()
    {
        ParentTitle.Text = "Hand to a parent";
        ParentWaitPart.Visibility = Visibility.Visible;
        ParentCodePart.Visibility = Visibility.Collapsed;
        ParentDurationPart.Visibility = Visibility.Collapsed;
        ParentSpinner.IsActive = true;
        ParentSpinner.Visibility = Visibility.Visible;
        var parents = _model.Status?.ParentsAnd ?? "your parents";
        ParentWaitText.Text = $"Asking {parents}…";
        ShowPanel(ParentPanel);
        if (_model.Sender is not { } send) return;
        var asked = await Safely(send.RequestParentModeAsync);
        if (ParentPanel.Visibility != Visibility.Visible || ParentWaitPart.Visibility != Visibility.Visible) return;
        if (asked == SendResult.Offline)
        {
            ParentSpinner.IsActive = false;
            ParentSpinner.Visibility = Visibility.Collapsed;
            ParentWaitText.Text = $"Can't reach {parents} right now. A parent can use the parent code.";
            return;
        }
        ParentWaitText.Text = $"We've asked {parents} to approve.";
    }

    private void ShowParentNo(string text)
    {
        if (ParentPanel.Visibility != Visibility.Visible || ParentWaitPart.Visibility != Visibility.Visible) return;
        ParentSpinner.IsActive = false;
        ParentSpinner.Visibility = Visibility.Collapsed;
        ParentWaitText.Text = text;
    }

    private void OnCodeInstead(object sender, RoutedEventArgs e)
    {
        ParentTitle.Text = "Parent code";
        ParentWaitPart.Visibility = Visibility.Collapsed;
        ParentCodePart.Visibility = Visibility.Visible;
        CodeBox.Text = "";
        CodeError.Visibility = Visibility.Collapsed;
        CodeCheck.Content = "Check";
        CodeBox.Focus(FocusState.Programmatic);
    }

    private void OnCodeChanged(object sender, TextChangedEventArgs e)
    {
        var digits = new string(CodeBox.Text.Where(char.IsAsciiDigit).ToArray());
        if (digits != CodeBox.Text)
        {
            CodeBox.Text = digits;
            CodeBox.SelectionStart = digits.Length;
        }
        // The error stays until the kid types again (clearing the box after a wrong code also lands here, later).
        if (digits.Length > 0) CodeError.Visibility = Visibility.Collapsed;
        CodeCheck.IsEnabled = digits.Length == 6;
    }

    private async void OnCodeCheck(object sender, RoutedEventArgs e)
    {
        if (_model.Sender is not { } send) return;
        CodeCheck.IsEnabled = false;
        CodeCheck.Content = "Checking…";
        var right = await Safely(() => send.CheckParentCodeAsync(CodeBox.Text));
        CodeCheck.Content = "Check";
        if (!right)
        {
            CodeBox.Text = "";
            CodeError.Visibility = Visibility.Visible;
            return;
        }
        ParentTitle.Text = "How long?";
        ParentCodePart.Visibility = Visibility.Collapsed;
        ParentDurationPart.Visibility = Visibility.Visible;
    }

    private async void OnDuration(object sender, RoutedEventArgs e)
    {
        if (_model.Sender is not { } send) return;
        var tag = (string)((Button)sender).Tag;
        int? minutes = tag.Length == 0 ? null : int.Parse(tag, System.Globalization.CultureInfo.InvariantCulture);
        ParentDurationPart.IsHitTestVisible = false;
        var started = await Safely(() => send.StartParentModeAsync(minutes));
        ParentDurationPart.IsHitTestVisible = true;
        // Started: the next view says parent mode is on and Render closes this panel. Not started (the code got too
        // old): back to the code.
        if (!started) OnCodeInstead(sender, e);
    }

    private async void OnEndNow(object sender, RoutedEventArgs e)
    {
        if (_model.Sender is not { } send) return;
        EndNowButton.IsEnabled = false;
        await Safely(send.EndParentModeAsync);
        EndNowButton.IsEnabled = true;
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

    private void ShowAnswer(string text, bool approved) =>
        ShowCard(text, approved ? "StPlentyBrush" : "StSurfaceVariantBrush", approved ? "StOnPrimaryBrush" : "StOnSurfaceBrush", 4);

    /// <summary>The caught card (docs/SPEC.md §14): orange, on the main panel, for 8 s.</summary>
    private void ShowCaught(string text)
    {
        ShowPanel(MainPanel);
        ShowCard(text, "StCriticalBrush", "StOnCriticalBrush", 8);
    }

    private void ShowCard(string text, string background, string foreground, int seconds)
    {
        AnswerText.Text = text;
        AnswerCard.Background = Brush(background);
        AnswerText.Foreground = Brush(foreground);
        AnswerCard.Visibility = Visibility.Visible;
        _answerTimer.Stop();
        _answerTimer.Interval = TimeSpan.FromSeconds(seconds);
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

    /// <summary>A yes-or-no call that throws counts as no.</summary>
    private static async Task<bool> Safely(Func<Task<bool>> send)
    {
        try
        {
            return await send();
        }
        catch (Exception e)
        {
            TrayLog.Write($"send: {e.Message}");
            return false;
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
