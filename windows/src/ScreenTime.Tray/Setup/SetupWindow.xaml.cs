using System.Runtime.InteropServices;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using ScreenTime.Core.Setup;
using Windows.Graphics;
using Windows.System;

namespace ScreenTime.Tray.Setup;

/// <summary>
/// The setup window (docs/SPEC.md §12.2), from the Start menu's "Screen Time Setup". Step 1 checks the server address.
/// Step 2 signs a parent in once (their email, then the emailed code); the sign-in stays in the backend's memory.
/// Step 3 lists the PC's accounts: a standard account gets a picker of the family's kids plus "Not limited" and
/// Connect (the backend makes a PC code as the parent and enrols with it: the parent never sees a code), an enrolled
/// one shows its kid and "Change", an administrator is a parent and is never limited. "Have a code instead?" swaps the
/// pickers for 6-digit code boxes from the parent app, for a parent who can't get the email on this PC. Finish restarts
/// the service through the backend so the limits start, and signs the parent out. Closing with an enrolment not
/// finished asks first.
/// </summary>
public sealed partial class SetupWindow : Window
{
    private const int WidthDip = 600, HeightDip = 800;

    private readonly ISetupBackend _backend;
    private readonly HashSet<string> _changing = [];
    private List<SetupAccount> _accounts = [];
    /// <summary>The family's kids once a parent signed in; null while nobody is signed in.</summary>
    private List<SetupKid>? _kids;
    private string? _server, _signedInEmail;
    private bool _busy, _codeMode, _unfinished, _done, _closeAnyway;

    public SetupWindow(ISetupBackend backend)
    {
        _backend = backend;
        InitializeComponent();
        SystemBackdrop = new MicaBackdrop();
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "tray-dark-plenty.ico"));
        var presenter = OverlappedPresenter.Create();
        presenter.IsMaximizable = false;
        presenter.PreferredMinimumWidth = 480;
        presenter.PreferredMinimumHeight = 600;
        AppWindow.SetPresenter(presenter);
        AppWindow.Closing += OnClosing;
        EmailBox.InputScope = new InputScope { Names = { new InputScopeName(InputScopeNameValue.EmailSmtpAddress) } };
        SignInCodeBox.InputScope = new InputScope { Names = { new InputScopeName(InputScopeNameValue.Number) } };
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

    // ---- 1. The server

    private void OnServerChanged(object sender, TextChangedEventArgs e)
    {
        if (_server is null || ServerBox.Text.Trim() == _server) return;
        // A different address: the sign-in and the accounts wait for it to be checked (a sign-in is for one server).
        _server = null;
        SetStatus(ServerStatus, "Press Check to try the new address.", "StMutedBrush");
        _ = ForgetSignInAsync(null);
        _accounts = [];
        AccountsList.Children.Clear();
        UpdateSections();
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
                _accounts = [];
                AccountsList.Children.Clear();
                return;
            }
            _server = address;
            SetStatus(ServerStatus, $"✓ Screen Time answers at {address}.", "StPlentyBrush");
            _accounts = (await _backend.AccountsAsync()).ToList();
            RenderAccounts();
            if (_kids is null && !_codeMode) EmailBox.Focus(FocusState.Programmatic);
        }
        finally
        {
            SetBusy(false, ServerRing);
        }
    }

    // ---- 2. Sign in as a parent

    private void OnEmailChanged(object sender, TextChangedEventArgs e)
    {
        // A different email needs its own code.
        if (SignInCodeRow.Visibility == Visibility.Visible)
        {
            SignInCodeRow.Visibility = Visibility.Collapsed;
            SignInCodeBox.Text = "";
            SendCodeButton.Content = "Email me a code";
            SetStatus(SignInStatus, "Use the email you sign in to the parent app with. We'll email you a code.", "StMutedBrush");
        }
    }

    private async void OnEmailKey(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter) return;
        e.Handled = true;
        await SendCodeAsync();
    }

    private async void OnSendCode(object sender, RoutedEventArgs e) => await SendCodeAsync();

    private async Task SendCodeAsync()
    {
        if (_busy || _server is null) return;
        var email = EmailBox.Text.Trim();
        if (!SetupRules.IsEmail(email))
        {
            SetStatus(SignInStatus, SetupRules.NotAnEmail, "StCriticalBrush");
            return;
        }
        SetBusy(true, SignInRing);
        SetStatus(SignInStatus, "Sending…", "StMutedBrush");
        try
        {
            var error = await _backend.RequestSignInCodeAsync(_server, email);
            if (error is not null)
            {
                SetStatus(SignInStatus, error, "StCriticalBrush");
                return;
            }
            SignInCodeRow.Visibility = Visibility.Visible;
            SendCodeButton.Content = "Send again";
            SetStatus(SignInStatus, $"We emailed a code to {email}. It works for 10 minutes.", "StMutedBrush");
        }
        finally
        {
            SetBusy(false, SignInRing);
        }
        SignInCodeBox.Focus(FocusState.Programmatic);
    }

    private void OnSignInCodeChanged(object sender, TextChangedEventArgs e) => SignInButton.IsEnabled = !_busy && SetupRules.IsSixDigits(SignInCodeBox.Text);

    private async void OnSignInCodeKey(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter) return;
        e.Handled = true;
        await SignInAsync();
    }

    private async void OnSignIn(object sender, RoutedEventArgs e) => await SignInAsync();

    private async Task SignInAsync()
    {
        if (_busy || _server is null || !SetupRules.IsSixDigits(SignInCodeBox.Text)) return;
        var email = EmailBox.Text.Trim();
        SetBusy(true, SignInRing);
        SetStatus(SignInStatus, "Signing in…", "StMutedBrush");
        try
        {
            var error = await _backend.SignInAsync(_server, email, SignInCodeBox.Text.Trim());
            if (error is not null)
            {
                SetStatus(SignInStatus, error, "StCriticalBrush");
                return;
            }
            var kids = await _backend.KidsAsync();
            if (kids.Value is not { } list)
            {
                await _backend.SignOutAsync();
                SetStatus(SignInStatus, kids.Error ?? SetupRules.ServerProblem, "StCriticalBrush");
                return;
            }
            if (list.Count == 0)
            {
                await _backend.SignOutAsync();
                SetStatus(SignInStatus, SetupRules.NoKids, "StCriticalBrush");
                return;
            }
            _kids = list.ToList();
            _signedInEmail = email;
            _changing.Clear();
            SignInCodeBox.Text = "";
            ShowSignIn();
            RenderAccounts();
        }
        finally
        {
            SetBusy(false, SignInRing);
        }
    }

    private async void OnSignOut(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        SetBusy(true, SignInRing);
        try
        {
            await ForgetSignInAsync("You're signed out.");
        }
        finally
        {
            SetBusy(false, SignInRing);
        }
    }

    private void OnCodeMode(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        _codeMode = !_codeMode;
        _changing.Clear();
        ShowSignIn();
        RenderAccounts();
    }

    /// <summary>Ends the parent's sign-in (on the server too, best effort) and shows the email box again with <paramref name="status"/>.</summary>
    private async Task ForgetSignInAsync(string? status, bool isError = false)
    {
        var wasSignedIn = _kids is not null;
        _kids = null;
        _signedInEmail = null;
        _changing.Clear();
        ShowSignIn(status, isError);
        RenderAccounts();
        if (wasSignedIn) await _backend.SignOutAsync();
    }

    /// <summary>Step 2 as it is now: signed in, typing codes instead, or the email form (with an optional status line).</summary>
    private void ShowSignIn(string? status = null, bool isError = false)
    {
        var signedIn = _kids is not null;
        SignInForm.Visibility = signedIn || _codeMode ? Visibility.Collapsed : Visibility.Visible;
        SignOutLink.Visibility = signedIn ? Visibility.Visible : Visibility.Collapsed;
        CodeModeLink.Visibility = signedIn ? Visibility.Collapsed : Visibility.Visible;
        CodeModeLink.Content = _codeMode ? "Sign in instead" : "Have a code instead?";
        if (signedIn)
        {
            SetStatus(SignInStatus, $"✓ Signed in as {_signedInEmail}.", "StPlentyBrush");
        }
        else if (_codeMode)
        {
            SetStatus(SignInStatus, "No email on this PC? Type a code from the parent app for each kid's account below.", "StMutedBrush");
        }
        else
        {
            SignInCodeRow.Visibility = Visibility.Collapsed;
            SignInCodeBox.Text = "";
            SendCodeButton.Content = "Email me a code";
            SetStatus(SignInStatus, status ?? "Use the email you sign in to the parent app with. We'll email you a code.", isError ? "StCriticalBrush" : "StMutedBrush");
        }
        AccountsHelp.Text = signedIn
            ? "Pick the kid who uses each account, then Connect. An account left Not limited is never limited."
            : _codeMode
                ? "For each kid: in the parent app, open the kid, choose Add device, then PC, and type the 6 digits here. A code works once, for 10 minutes."
                : "Sign in above, then pick the kid who uses each account.";
        UpdateSections();
    }

    // ---- 3. The accounts

    private void RenderAccounts()
    {
        AccountsList.Children.Clear();
        if (_server is not null && !_accounts.Any(a => !a.IsAdmin))
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
        UpdateSections();
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
        else if (a.KidName is { } kid && !_changing.Contains(a.UserName))
        {
            action = EnrolledAction(a, kid);
        }
        else if (_kids is not null)
        {
            action = PickerAction(a, name, error);
        }
        else if (_codeMode)
        {
            action = CodeAction(a, name, error);
        }
        else
        {
            // Nobody signed in yet: the picker comes after step 2.
            action = Id(new TextBlock { Text = "Not limited", FontSize = 13, Foreground = Brush("StMutedBrush") }, $"State_{a.UserName}");
        }
        action.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(action, 2);
        row.Children.Add(action);
        return row;
    }

    /// <summary>"✓ Limited as Sam" and a link to pick another kid (or type a new code).</summary>
    private StackPanel EnrolledAction(SetupAccount a, string kid)
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
        if (_kids is not null || _codeMode)
        {
            var change = Id(new HyperlinkButton
            {
                Content = _kids is not null ? "Change" : "Use a new code",
                FontSize = 12,
                Padding = new Thickness(0, 2, 0, 0),
                HorizontalAlignment = HorizontalAlignment.Right,
            }, $"Change_{a.UserName}");
            change.Click += (_, _) =>
            {
                if (_busy) return;
                _changing.Add(a.UserName);
                RenderAccounts();
            };
            panel.Children.Add(change);
        }
        return panel;
    }

    /// <summary>The family's kids (plus "Not limited" for an account not enrolled yet) and Connect.</summary>
    private StackPanel PickerAction(SetupAccount a, string name, TextBlock error)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var ring = new ProgressRing { Width = 16, Height = 16, IsActive = false, Visibility = Visibility.Collapsed };
        var picker = Id(new ComboBox { MinWidth = 150, MaxWidth = 190 }, $"Kid_{a.UserName}");
        AutomationProperties.SetName(picker, $"Kid for {name}");
        // An enrolled account changes to another kid; the service has no "stop limiting" yet, so no Not limited for it.
        if (a.KidName is null) picker.Items.Add(new ComboBoxItem { Content = "Not limited", Tag = null });
        foreach (var kid in _kids!) picker.Items.Add(new ComboBoxItem { Content = kid.Name, Tag = kid.Id });
        if (a.KidName is null) picker.SelectedIndex = 0;
        else picker.PlaceholderText = "Pick a kid";
        var connect = Id(new Button { Content = "Connect", MinWidth = 88, IsEnabled = false }, $"Connect_{a.UserName}");
        string? PickedId() => (picker.SelectedItem as ComboBoxItem)?.Tag as string;
        picker.SelectionChanged += (_, _) =>
        {
            connect.IsEnabled = !_busy && PickedId() is not null;
            error.Visibility = Visibility.Collapsed;
        };
        connect.Click += async (_, _) =>
        {
            if (_busy || _server is null || PickedId() is not { } kidId) return;
            await ConnectAsync(a, error, ring, () => _backend.ConnectAsync(_server, a.UserName, kidId), () => connect.IsEnabled = PickedId() is not null);
        };
        panel.Children.Add(ring);
        panel.Children.Add(picker);
        panel.Children.Add(connect);
        if (a.KidName is not null) panel.Children.Add(CancelLink(a));
        return panel;
    }

    /// <summary>"Have a code instead?": a 6-digit code from the parent app and Connect.</summary>
    private StackPanel CodeAction(SetupAccount a, string name, TextBlock error)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var ring = new ProgressRing { Width = 16, Height = 16, IsActive = false, Visibility = Visibility.Collapsed };
        var box = Id(new TextBox { Width = 116, MaxLength = 6, PlaceholderText = "6-digit code", FontFamily = new FontFamily("Consolas"), IsSpellCheckEnabled = false }, $"Code_{a.UserName}");
        AutomationProperties.SetName(box, $"Code for {name}");
        box.InputScope = new InputScope { Names = { new InputScopeName(InputScopeNameValue.Number) } };
        var connect = Id(new Button { Content = "Connect", MinWidth = 88, IsEnabled = false }, $"Connect_{a.UserName}");
        box.TextChanged += (_, _) => connect.IsEnabled = SetupRules.IsSixDigits(box.Text);
        async Task go()
        {
            if (_busy || !SetupRules.IsSixDigits(box.Text) || _server is null) return;
            var code = box.Text.Trim();
            await ConnectAsync(a, error, ring, () => _backend.EnrolAsync(_server, a.UserName, code), () => connect.IsEnabled = SetupRules.IsSixDigits(box.Text));
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
        if (a.KidName is not null) panel.Children.Add(CancelLink(a));
        return panel;
    }

    private HyperlinkButton CancelLink(SetupAccount a)
    {
        var cancel = Id(new HyperlinkButton { Content = "Cancel", FontSize = 12, Padding = new Thickness(0, 2, 0, 2), VerticalAlignment = VerticalAlignment.Center }, $"Cancel_{a.UserName}");
        cancel.Click += (_, _) =>
        {
            if (_busy) return;
            _changing.Remove(a.UserName);
            RenderAccounts();
        };
        return cancel;
    }

    /// <summary>Runs one enrolment for the row: on success the row shows its kid, else the error under it.</summary>
    private async Task ConnectAsync(SetupAccount a, TextBlock error, ProgressRing ring, Func<Task<EnrolAnswer>> enrol, Action afterwards)
    {
        error.Visibility = Visibility.Collapsed;
        SetBusy(true, ring);
        try
        {
            var answer = await enrol();
            if (answer.KidName is { } enrolledAs)
            {
                _changing.Remove(a.UserName);
                _accounts = _accounts.Select(x => x.UserName == a.UserName ? x with { KidName = enrolledAs } : x).ToList();
                _unfinished = true;
                _done = false;
                RenderAccounts();
                return;
            }
            if (answer.SignInAgain)
            {
                await ForgetSignInAsync(answer.Error ?? SetupRules.SignInAgain, isError: true);
                return;
            }
            error.Text = answer.Error ?? "That didn't work. Try again.";
            error.Visibility = Visibility.Visible;
        }
        finally
        {
            SetBusy(false, ring);
            afterwards();
        }
    }

    // ---- Finish

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
            // The parent is done here: their sign-in ends with the setup.
            await ForgetSignInAsync(null);
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
        if (_closeAnyway || !_unfinished && _kids is null) return;
        e.Cancel = true;
        if (_busy) return;
        if (_unfinished)
        {
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
            if (!(choice == ContentDialogResult.Primary && await FinishAsync() || choice == ContentDialogResult.Secondary)) return;
        }
        _closeAnyway = true;
        // Signed in but closing: end the sign-in on the server too (the backend gives up after a few seconds).
        if (_kids is not null) await ForgetSignInAsync(null);
        Close();
    }

    // ---- Shared

    private void UpdateFinish()
    {
        var anyKid = _accounts.Any(a => a.KidName is not null && !a.IsAdmin);
        FinishButton.IsEnabled = !_busy && (_done && !_unfinished || _server is not null && anyKid);
        FinishButton.Content = _done && !_unfinished ? "Close" : "Finish";
        if (!_done && !_busy && FinishStatus.Text.StartsWith('✓')) SetStatus(FinishStatus, "The limits start when you press Finish.", "StMutedBrush");
    }

    /// <summary>Dims what is not ready: step 2 until the server answers, step 3 until a parent signs in (or types codes).</summary>
    private void UpdateSections()
    {
        var signInReady = _server is not null;
        SignInSection.Opacity = signInReady ? 1 : 0.45;
        SignInSection.IsHitTestVisible = signInReady && !_busy;
        var accountsReady = signInReady && (_kids is not null || _codeMode);
        AccountsSection.Opacity = accountsReady ? 1 : 0.45;
        AccountsSection.IsHitTestVisible = accountsReady && !_busy;
        UpdateFinish();
    }

    private void SetBusy(bool busy, ProgressRing ring)
    {
        _busy = busy;
        ring.IsActive = busy;
        ring.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        ServerBox.IsEnabled = !busy;
        CheckButton.IsEnabled = !busy;
        EmailBox.IsEnabled = !busy;
        SendCodeButton.IsEnabled = !busy;
        SignInCodeBox.IsEnabled = !busy;
        SignInButton.IsEnabled = !busy && SetupRules.IsSixDigits(SignInCodeBox.Text);
        UpdateSections();
    }

    private static void SetStatus(TextBlock text, string value, string brush)
    {
        text.Text = value;
        text.Foreground = Brush(brush);
    }

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
