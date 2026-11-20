using System.Runtime.InteropServices;
using ScreenTime.Core.Programs;
using ScreenTime.Core.Service;

namespace ScreenTime.Tray;

/// <summary>
/// Watches the window in front and sends <see cref="PipeMessage.Front"/> to the service (docs/SPEC.md §12.9).
/// A 5 s timer and the <c>EVENT_SYSTEM_FOREGROUND</c> hook both trigger a check; the check is off the UI thread.
/// </summary>
internal sealed class FrontWatcher
{
    private const int EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint WINEVENT_OUTOFCONTEXT = 0;

    private readonly Action<PipeMessage> _send;
    private readonly Action<string> _log;
    private readonly Dictionary<int, (string Exe, string? Desc, string? Product)> _cache = new();
    private string? _lastId;
    private string? _lastLabel;
    private nint _hook;
    private System.Threading.Timer? _timer;
    private readonly System.Threading.Lock _gate = new();

    public FrontWatcher(Action<PipeMessage> send, Action<string> log)
    {
        _send = send;
        _log = log;
    }

    [DllImport("user32.dll")]
    private static extern nint SetWinEventHook(int eventMin, int eventMax, nint hmodWinEventProc, WinEventProc proc, uint idWin, uint idWin2, uint flags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(nint hook);

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern int GetWindowThreadProcessId(nint hwnd, out uint pid);

    [DllImport("user32.dll")]
    private static extern int GetClassName(nint hwnd, System.Text.StringBuilder lpClassName, int nMaxCount);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void WinEventProc(nint hWinEventHook, uint ev, nint hwnd, int idObject, int idChild, uint dwEventThread, uint dwEventTime);

    public void Start()
    {
        _hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nint.Zero, OnWinEvent, 0, 0, WINEVENT_OUTOFCONTEXT);
        _timer = new System.Threading.Timer(_ => Check(), null, 5_000, 5_000);
    }

    public void Stop()
    {
        _timer?.Dispose();
        if (_hook != nint.Zero) UnhookWinEvent(_hook);
    }

    private void OnWinEvent(nint hWinEventHook, uint @event, nint hwnd, int idObject, int idChild, uint dwEventThread, uint dwEventTime)
    {
        Check();
    }

    private void Check()
    {
        lock (_gate)
        {
            var (id, label) = NameFront();
            if (id != _lastId || label != _lastLabel)
            {
                _lastId = id;
                _lastLabel = label;
                _send(PipeMessage.Front(id, label));
                _log(id is null ? "front: nothing" : $"front: {id} {label}");
            }
        }
    }

    private (string? Id, string? Label) NameFront()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == nint.Zero) return (null, null);

        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0) return (null, null);

        string? exe = null;
        try
        {
            using var proc = System.Diagnostics.Process.GetProcessById((int)pid);
            exe = proc.MainModule?.FileName;
        }
        catch { }

        if (exe is null) return (null, null);

        var className = new System.Text.StringBuilder(256);
        GetClassName(hwnd, className, 256);
        var cls = className.ToString();

        var fileName = Path.GetFileName(exe);
        if (ProgramNames.Ignored(fileName, cls)) return (null, null);

        if (_cache.TryGetValue((int)pid, out var cached))
        {
            return (ProgramNames.Id(exe), ProgramNames.Label(exe, cached.Desc, cached.Product));
        }

        var (desc, product) = FileVersionInfo(exe);
        _cache[(int)pid] = (exe, desc, product);
        return (ProgramNames.Id(exe), ProgramNames.Label(exe, desc, product));
    }

    private static (string? Desc, string? Product) FileVersionInfo(string path)
    {
        try
        {
            var vfi = System.Diagnostics.FileVersionInfo.GetVersionInfo(path);
            return (vfi.FileDescription, vfi.ProductName);
        }
        catch
        {
            return (null, null);
        }
    }
}
