using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using ScreenTime.Core;

namespace ScreenTime.Tray;

/// <summary>Placeholder tray app: opens one small window. The real tray icon and flyout come later.</summary>
public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new Window
        {
            Title = "Screen Time",
            SystemBackdrop = new MicaBackdrop(),
            Content = new StackPanel
            {
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                Spacing = 8,
                Children =
                {
                    new TextBlock
                    {
                        Text = "Screen Time",
                        Style = (Style)Current.Resources["SubtitleTextBlockStyle"],
                        HorizontalAlignment = HorizontalAlignment.Center,
                    },
                    new TextBlock
                    {
                        Text = $"Tray app. Real flyout comes later. ({DurationFormat.Format(4320)} test)",
                        HorizontalAlignment = HorizontalAlignment.Center,
                    },
                },
            },
        };
        _window.AppWindow.Resize(new Windows.Graphics.SizeInt32(360, 440));
        _window.Activate();
    }
}
