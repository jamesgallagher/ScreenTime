using System.Runtime.InteropServices;
using Microsoft.Win32;
using ScreenTime.Core.Tray;

namespace ScreenTime.Tray;

/// <summary>
/// The notification-area icon (docs/SPEC.md §16.3): an hourglass with a coloured dot and a tooltip. A hidden window
/// receives its clicks, Explorer restarts (<c>TaskbarCreated</c>) and taskbar theme changes. One per process, on the UI
/// thread.
/// </summary>
internal sealed unsafe partial class TrayIcon : IDisposable
{
    private const uint CallbackMessage = 0x8000 + 1; // WM_APP + 1
    private const uint WmSettingChange = 0x001A;
    private const uint NimAdd = 0, NimModify = 1, NimDelete = 2, NimSetVersion = 4;
    private const uint NifMessage = 0x1, NifIcon = 0x2, NifTip = 0x4, NifInfo = 0x10, NifShowTip = 0x80;
    private const uint NotifyIconVersion4 = 4;
    private const uint NinSelect = 0x400, NinKeySelect = 0x401, NinBalloonUserClick = 0x405;

    private static TrayIcon? s_current;
    private readonly nint _hwnd;
    private readonly uint _taskbarCreated;
    private nint _icon;
    private TrayLevel _level = TrayLevel.Offline;
    private string _tooltip = "Screen Time";
    private bool _added;

    /// <summary>Left click or Enter on the icon, with the point to anchor the flyout to (physical pixels).</summary>
    public event Action<int, int>? Clicked;

    /// <summary>The kid clicked a notification from <see cref="Notify"/>.</summary>
    public event Action? NotificationClicked;

    public TrayIcon()
    {
        s_current = this;
        var module = GetModuleHandleW(null);
        fixed (char* name = "ScreenTime.TrayIcon")
        {
            var wc = new WndClassEx
            {
                Size = (uint)sizeof(WndClassEx),
                WndProc = &WndProc,
                Instance = module,
                ClassName = name,
            };
            RegisterClassExW(&wc);
            // A hidden top-level window: message-only windows miss the TaskbarCreated and WM_SETTINGCHANGE broadcasts.
            _hwnd = CreateWindowExW(0, name, name, 0, 0, 0, 0, 0, 0, 0, module, 0);
        }
        _taskbarCreated = RegisterWindowMessageW("TaskbarCreated");
        Add();
    }

    /// <summary>Shows <paramref name="level"/>'s dot and <paramref name="tooltip"/>.</summary>
    public void Set(TrayLevel level, string tooltip)
    {
        if (level == _level && tooltip == _tooltip && _icon != 0) return;
        var iconChanged = level != _level || _icon == 0;
        _level = level;
        _tooltip = tooltip;
        if (iconChanged) LoadIcon();
        var data = Data(NifIcon | NifTip | NifShowTip);
        Shell_NotifyIconW(NimModify, &data);
    }

    /// <summary>A notification from the icon, which Windows 11 shows as a toast from "Screen Time" (the exe's title).</summary>
    public void Notify(string text)
    {
        var data = Data(NifInfo);
        Copy(text, data.Info, 256);
        Shell_NotifyIconW(NimModify, &data);
    }

    public void Dispose()
    {
        var data = Data(0);
        Shell_NotifyIconW(NimDelete, &data);
        if (_icon != 0) DestroyIcon(_icon);
        DestroyWindow(_hwnd);
        s_current = null;
    }

    private void Add()
    {
        LoadIcon();
        var data = Data(NifMessage | NifIcon | NifTip | NifShowTip);
        _added = Shell_NotifyIconW(NimAdd, &data);
        data.VersionOrTimeout = NotifyIconVersion4;
        Shell_NotifyIconW(NimSetVersion, &data);
        if (!_added) TrayLog.Write("icon: add failed");
    }

    private void LoadIcon()
    {
        var file = Path.Combine(AppContext.BaseDirectory, "Assets", $"tray-{Theme()}-{Dot(_level)}.ico");
        var size = GetSystemMetrics(49); // SM_CXSMICON
        var icon = LoadImageW(0, file, 1, size, size, 0x10); // IMAGE_ICON, LR_LOADFROMFILE
        if (icon == 0)
        {
            TrayLog.Write($"icon: cannot load {file}");
            return;
        }
        if (_icon != 0) DestroyIcon(_icon);
        _icon = icon;
    }

    /// <summary>The locked state has no dot of its own: the session is locked, so it only shows for a moment.</summary>
    private static string Dot(TrayLevel level) => level switch
    {
        TrayLevel.Plenty => "plenty",
        TrayLevel.Low => "low",
        TrayLevel.Critical or TrayLevel.Locked => "critical",
        _ => "offline",
    };

    /// <summary>"light" when the taskbar is light (dark glyph), otherwise "dark".</summary>
    private static string Theme()
    {
        var light = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "SystemUsesLightTheme", 0);
        return light is int and 1 ? "light" : "dark";
    }

    private NotifyIconData Data(uint flags)
    {
        var data = new NotifyIconData
        {
            Size = (uint)sizeof(NotifyIconData),
            Hwnd = _hwnd,
            Id = 1,
            Flags = flags,
            CallbackMessage = CallbackMessage,
            Icon = _icon,
        };
        Copy(_tooltip, data.Tip, 128);
        return data;
    }

    private static void Copy(string text, char* buffer, int length)
    {
        var n = Math.Min(text.Length, length - 1);
        for (var i = 0; i < n; i++) buffer[i] = text[i];
        buffer[n] = '\0';
    }

    [UnmanagedCallersOnly]
    private static nint WndProc(nint hwnd, uint msg, nint wParam, nint lParam)
    {
        var icon = s_current;
        if (icon is not null)
        {
            try
            {
                if (msg == CallbackMessage)
                {
                    var ev = (uint)(lParam & 0xFFFF);
                    if (ev is NinSelect or NinKeySelect)
                    {
                        icon.Clicked?.Invoke((short)(wParam & 0xFFFF), (short)((wParam >> 16) & 0xFFFF));
                    }
                    else if (ev == NinBalloonUserClick)
                    {
                        icon.NotificationClicked?.Invoke();
                    }
                    return 0;
                }
                if (msg == icon._taskbarCreated && msg != 0)
                {
                    icon.Add();
                    return 0;
                }
                if (msg == WmSettingChange)
                {
                    icon.LoadIcon();
                    var data = icon.Data(NifIcon);
                    Shell_NotifyIconW(NimModify, &data);
                }
            }
            catch (Exception e)
            {
                TrayLog.Write($"icon: {e.Message}");
            }
        }
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WndClassEx
    {
        public uint Size;
        public uint Style;
        public delegate* unmanaged<nint, uint, nint, nint, nint> WndProc;
        public int ClassExtra;
        public int WindowExtra;
        public nint Instance;
        public nint Icon;
        public nint Cursor;
        public nint Background;
        public char* MenuName;
        public char* ClassName;
        public nint IconSmall;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NotifyIconData
    {
        public uint Size;
        public nint Hwnd;
        public uint Id;
        public uint Flags;
        public uint CallbackMessage;
        public nint Icon;
        public fixed char Tip[128];
        public uint State;
        public uint StateMask;
        public fixed char Info[256];
        public uint VersionOrTimeout;
        public fixed char InfoTitle[64];
        public uint InfoFlags;
        public Guid Item;
        public nint BalloonIcon;
    }

    [LibraryImport("user32.dll", SetLastError = true)]
    private static partial ushort RegisterClassExW(WndClassEx* wc);

    [LibraryImport("user32.dll", SetLastError = true)]
    private static partial nint CreateWindowExW(uint exStyle, char* className, char* windowName, uint style, int x, int y, int width, int height, nint parent, nint menu, nint instance, nint param);

    [LibraryImport("user32.dll")]
    private static partial nint DefWindowProcW(nint hwnd, uint msg, nint wParam, nint lParam);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool DestroyWindow(nint hwnd);

    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial uint RegisterWindowMessageW(string name);

    [LibraryImport("user32.dll")]
    private static partial int GetSystemMetrics(int index);

    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
    private static partial nint LoadImageW(nint instance, string name, uint type, int cx, int cy, uint load);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool DestroyIcon(nint icon);

    [LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial nint GetModuleHandleW(string? name);

    [LibraryImport("shell32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool Shell_NotifyIconW(uint message, NotifyIconData* data);
}
