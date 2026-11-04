using System.Runtime.InteropServices;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics;
using Windows.System;

namespace ScreenTime.Tray.Setup;

/// <summary>
/// The setup window (docs/SPEC.md §12.2), started with <c>--setup</c> after the MSI. Step 1 checks the server address;
/// step 2 lists the PC's accounts once the server answers: a standard account takes a 6-digit code and Connect, an
/// enrolled one shows its kid and "Use a new code", an administrator is a parent and is never limited. Finish restarts
/// the service through the backend so the limits start. Closing with an enrolment not finished asks first.
/// </summary>
public sealed partial class SetupWindow : Window
{
    private const int WidthDip = 600, HeightDip = 720;

    private readonly ISetupBackend _backend;
    private readonly HashSet<string> _newCode = [];
    private List<SetupAccount> _accounts = [];
    private string? _server;
    private bool _busy, _unfinished, _done, _closeAnyway;

    public SetupWindow(ISetupBackend backend)
    {
        _backend = backend;
        InitializeComponent();
        SystemBackdrop = new MicaBackdrop();
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "tray-dark-plenty.ico"));
        var presenter = OverlappedPresenter.Create();
        presenter.IsMaximizable = false;
        presenter.PreferredMinimumWidth = 480;
        presenter.PreferredMinimumHeight = 560;
        AppWindow.SetPresenter(presenter);
        AppWindow.Closing += OnClosing;
    }

    /// <summary>Sizes and centres the window, shows it, and checks the saved server at once if there is one.</summary>
    public async void Start()
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        var scale = GetDpiForWindow(hwnd) / 96.0;
        var w = Math.Min((int)Math.Round(WidthDip * scale), area.Width);
        var h = Math.Min((int)Math.Round(HeightDip * scale), area.Height);
        AppWindow.MoveAndResize(new RectInt32(area.X + (area.Width - w) / 2, area.Y + (area.Height - h) / 2, w, h));
        Activate();
        if (_backend.SavedServer is { } saved)
        {
            ServerBox.Text = saved;
            await CheckAsync();
        }
        else
        {
            ServerBox.Focus(FocusState.Programmatic);
        }
    }

    private void OnServerChanged(object sender, TextChangedEventArgs e)
    {
        if (_server is null || ServerBox.Text.Trim() == _server) return;
        // A different address: the accounts wait for it to be checked.
        _server = null;
        SetStatus(ServerStatus, "Press Check to try the new address.", "StMutedBrush");
        SetAccountsEnabled(false);
        UpdateFinish();
    }

    private async void OnServerKey(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter) return;
        e.Handled = true;
        await CheckAsync();
    }

    private async void OnCheck(object sender, RoutedEventArgs e) => await CheckAsync();

    private async Task CheckAsync()
    {
        if (_busy) return;
        var address = ServerBox.Text.Trim();
        if (address == "")
        {
            SetStatus(ServerStatus, "Type your server's address first.", "StCriticalBrush");
            return;
        }
        SetBusy(true, ServerRing);
        SetStatus(ServerStatus, "Checking…", "StMutedBrush");
        try
        {
            var error = await _backend.CheckServerAsync(address);
            if (error is not null)
            {
                _server = null;
                SetStatus(ServerStatus, error, "StCriticalBrush");
                SetAccountsEnabled(false);
                return;
            }
            _server = address;
            SetStatus(ServerStatus, $"✓ Screen Time answers at {address}.", "StPlentyBrush");
            _accounts = (await _backend.AccountsAsync()).ToList();
            RenderAccounts();
            SetAccountsEnabled(true);
        }
        finally
        {
            SetBusy(false, ServerRing);
        }
    }

    private void RenderAccounts()
    {
        AccountsList.Children.Clear();
        if (!_accounts.Any(a => !a.IsAdmin))
        {
            AccountsList.Children.Add(new TextBlock
            {
                Margin = new Thickness(16, 14, 16, 14),
                FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                Text = "This PC has no standard accounts. Make one for each kid in Settings, Accounts, Other users, then press Check again.",
            });
        }
        var first = true;
        foreach (var account in _accounts)
        {
            AccountsList.Children.Add(Row(account, first));
            first = false;
        }
        UpdateFinish();
    }

    private Grid Row(SetupAccount a, bool first)
    {
        var row = new Grid
        {
            Padding = new Thickness(16, 12, 16, 12),
            ColumnSpacing = 12,
            BorderThickness = new Thickness(0, first ? 0 : 1, 0, 0),
            BorderBrush = Brush("StOutlineBrush"),
        };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        row.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // The initial in a circle: teal for a kid's account, grey for a parent's.
        var name = a.FullName != "" ? a.FullName : a.UserName;
        var avatar = new Border
        {
            Width = 36,
            Height = 36,
            CornerRadius = new CornerRadius(18),
            Background = Brush(a.IsAdmin ? "StSurfaceVariantBrush" : "StPlentyBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = name[..1].ToUpperInvariant(),
                FontSize = 15,
                FontWeight = FontWeights.SemiBold,
                Foreground = Brush(a.IsAdmin ? "StOnSurfaceBrush" : "StOnPrimaryBrush"),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            },
        };
        row.Children.Add(avatar);

        var kind = a.IsAdmin ? "Administrator" : "Standard account";
        var names = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 1 };
        names.Children.Add(new TextBlock { Text = name, FontSize = 14, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis });
        names.Children.Add(new TextBlock
        {
            Text = a.FullName != "" ? $"{a.UserName} · {kind}" : kind,
            FontSize = 12,
            Foreground = Brush("StMutedBrush"),
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        Grid.SetColumn(names, 1);
        row.Children.Add(names);

        var error = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap, Foreground = Brush("StCriticalBrush"), Visibility = Visibility.Collapsed, Margin = new Thickness(0, 6, 0, 0) };
        AutomationProperties.SetAutomationId(error, $"Error_{a.UserName}");
        Grid.SetRow(error, 1);
        Grid.SetColumn(error, 1);
        Grid.SetColumnSpan(error, 2);
        row.Children.Add(error);

        FrameworkElement action;
        if (a.IsAdmin)
        {
            action = Id(new TextBlock { Text = "A parent: never limited", FontSize = 13, Foreground = Brush("StMutedBrush") }, $"State_{a.UserName}");
        }
        else if (a.KidName is { } kid && !_newCode.Contains(a.UserName))
        {
            var panel = new StackPanel { HorizontalAlignment = HorizontalAlignment.Right };
            panel.Children.Add(Id(new TextBlock
            {
                Text = $"✓ Limited as {kid}",
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                Foreground = Brush("StPlentyBrush"),
                HorizontalAlignment = HorizontalAlignment.Right,
            }, $"State_{a.UserName}"));
            var change = Id(new HyperlinkButton { Content = "Use a new code", FontSize = 12, Padding = new Thickness(0, 2, 0, 0), HorizontalAlignment = HorizontalAlignment.Right }, $"Change_{a.UserName}");
            change.Click += (_, _) =>
            {
                _newCode.Add(a.UserName);
                RenderAccounts();
            };
            panel.Children.Add(change);
            action = panel;
        }
        else
        {
            var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var ring = new ProgressRing { Width = 16, Height = 16, IsActive = false, Visibility = Visibility.Collapsed };
            var box = Id(new TextBox { Width = 116, MaxLength = 6, PlaceholderText = "6-digit code", FontFamily = new FontFamily("Consolas"), IsSpellCheckEnabled = false }, $"Code_{a.UserName}");
            AutomationProperties.SetName(box, $"Code for {name}");
            box.InputScope = new InputScope { Names = { new InputScopeName(InputScopeNameValue.Number) } };
            var connect = Id(new Button { Content = "Connect", MinWidth = 88, IsEnabled = false }, $"Connect_{a.UserName}");
            box.TextChanged += (_, _) => connect.IsEnabled = IsCode(box.Text);
            async Task go()
            {
                if (_busy || !IsCode(box.Text) || _server is null) return;
                error.Visibility = Visibility.Collapsed;
                SetBusy(true, ring);
                try
                {
                    var answer = await _backend.EnrolAsync(_server, a.UserName, box.Text.Trim());
                    if (answer.KidName is { } enrolledAs)
                    {
                        _newCode.Remove(a.UserName);
                        _accounts = _accounts.Select(x => x.UserName == a.UserName ? x with { KidName = enrolledAs } : x).ToList();
                        _unfinished = true;
                        _done = false;
                        RenderAccounts();
                        return;
                    }
                    error.Text = answer.Error ?? "That didn't work. Try again.";
                    error.Visibility = Visibility.Visible;
                }
                finally
                {
                    SetBusy(false, ring);
                    connect.IsEnabled = IsCode(box.Text);
                }
            }
            connect.Click += async (_, _) => await go();
            box.KeyDown += async (_, e) =>
            {
                if (e.Key != VirtualKey.Enter) return;
                e.Handled = true;
                await go();
            };
            panel.Children.Add(ring);
            panel.Children.Add(box);
            panel.Children.Add(connect);
            panel.VerticalAlignment = VerticalAlignment.Center;
            action = panel;
        }
        action.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(action, 2);
        row.Children.Add(action);
        return row;
    }

    private async void OnFinish(object sender, RoutedEventArgs e)
    {
        if (_done && !_unfinished)
        {
            Close();
            return;
        }
        await FinishAsync();
    }

    private async Task<bool> FinishAsync()
    {
        SetBusy(true, FinishRing);
        SetStatus(FinishStatus, "Starting the limits…", "StMutedBrush");
        try
        {
            var error = await _backend.FinishAsync();
            if (error is not null)
            {
                SetStatus(FinishStatus, error, "StCriticalBrush");
                return false;
            }
            _unfinished = false;
            _done = true;
            var kids = _accounts.Where(a => a.KidName is not null && !a.IsAdmin).Select(a => a.KidName!).Distinct().ToList();
            SetStatus(FinishStatus, $"✓ Done. Screen Time limits {JoinNames(kids)} on this PC.", "StPlentyBrush");
            return true;
        }
        finally
        {
            SetBusy(false, FinishRing);
        }
    }

    private async void OnClosing(AppWindow sender, AppWindowClosingEventArgs e)
    {
        if (!_unfinished || _closeAnyway) return;
        e.Cancel = true;
        if (_busy) return;
        var dialog = new ContentDialog
        {
            XamlRoot = Content.XamlRoot,
            Title = "Finish setting up?",
            Content = "The accounts you just connected are only limited after Finish.",
            PrimaryButtonText = "Finish",
            SecondaryButtonText = "Close without finishing",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
        };
        var choice = await dialog.ShowAsync();
        if (choice == ContentDialogResult.Primary && await FinishAsync() || choice == ContentDialogResult.Secondary)
        {
            _closeAnyway = true;
            Close();
        }
    }

    private void UpdateFinish()
    {
        var anyKid = _accounts.Any(a => a.KidName is not null && !a.IsAdmin);
        FinishButton.IsEnabled = !_busy && (_done && !_unfinished || _server is not null && anyKid);
        FinishButton.Content = _done && !_unfinished ? "Close" : "Finish";
        if (!_done && !_busy && FinishStatus.Text.StartsWith('✓')) SetStatus(FinishStatus, "The limits start when you press Finish.", "StMutedBrush");
    }

    private void SetBusy(bool busy, ProgressRing ring)
    {
        _busy = busy;
        ring.IsActive = busy;
        ring.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        ServerBox.IsEnabled = !busy;
        CheckButton.IsEnabled = !busy;
        AccountsList.IsHitTestVisible = !busy;
        UpdateFinish();
    }

    private void SetAccountsEnabled(bool enabled)
    {
        AccountsSection.Opacity = enabled ? 1 : 0.45;
        AccountsSection.IsHitTestVisible = enabled;
        if (!enabled)
        {
            AccountsList.Children.Clear();
            _accounts = [];
        }
    }

    private static void SetStatus(TextBlock text, string value, string brush)
    {
        text.Text = value;
        text.Foreground = Brush(brush);
    }

    private static bool IsCode(string text) => text.Trim() is { Length: 6 } t && t.All(char.IsAsciiDigit);

    /// <summary>"Alex", "Alex and Sam", "Alex, Sam and Kim".</summary>
    private static string JoinNames(IReadOnlyList<string> names) => names.Count switch
    {
        0 => "nobody",
        1 => names[0],
        _ => string.Join(", ", names.Take(names.Count - 1)) + " and " + names[^1],
    };

    private static T Id<T>(T element, string id) where T : FrameworkElement
    {
        AutomationProperties.SetAutomationId(element, id);
        return element;
    }

    private static Brush Brush(string key) => (Brush)Application.Current.Resources[key];

    [LibraryImport("user32.dll")]
    private static partial uint GetDpiForWindow(nint hwnd);
}
