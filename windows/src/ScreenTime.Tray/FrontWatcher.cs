using System.Runtime.InteropServices;
using System.Text;
using ScreenTime.Core.Programs;
using ScreenTime.Core.Service;

namespace ScreenTime.Tray;

/// <summary>
/// Watches the window in front and sends <see cref="PipeMessage.Front"/> to the service (docs/SPEC.md §12.9).
/// The <c>EVENT_SYSTEM_FOREGROUND</c> hook runs on a thread of its own with a message loop (an out-of-context hook only
/// calls back on a thread that pumps messages), and a 5 s timer checks as well, because some changes raise no event.
/// The first check after <see cref="Start"/> is always sent, "nothing" too, so the service never keeps a program from
/// before a reconnection.
/// </summary>
internal sealed class FrontWatcher
{
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint WINEVENT_OUTOFCONTEXT = 0;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint WM_QUIT = 0x0012;

    private readonly Action<PipeMessage> _send;
    private readonly Action<string> _log;
    // Keyed by process id; the path is checked again before the cached version info is used, as ids are reused.
    private readonly Dictionary<uint, (string Exe, string? Desc, string? Product)> _cache = new();
    private readonly System.Threading.Lock _gate = new();
    // Kept in a field: the hook holds only a native pointer to it, so a local delegate could be collected.
    private readonly WinEventProc _onWinEvent;
    private bool _sentOnce;
    private string? _lastId;
    private string? _lastLabel;
    private Thread? _hookThread;
    private uint _hookThreadId;
    private System.Threading.Timer? _timer;

    public FrontWatcher(Action<PipeMessage> send, Action<string> log)
    {
        _send = send;
        _log = log;
        _onWinEvent = (_, _, _, _, _, _, _) => Check();
    }

    private delegate void WinEventProc(nint hWinEventHook, uint ev, nint hwnd, int idObject, int idChild, uint dwEventThread, uint dwEventTime);

    private delegate bool EnumWindowsProc(nint hwnd, nint lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct Msg
    {
        public nint Hwnd;
        public uint Message;
        public nint WParam;
        public nint LParam;
        public uint Time;
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    private static extern nint SetWinEventHook(uint eventMin, uint eventMax, nint hmodWinEventProc, WinEventProc proc, uint idProcess, uint idThread, uint flags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(nint hook);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out Msg msg, nint hwnd, uint min, uint max);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref Msg msg);

    [DllImport("user32.dll")]
    private static extern nint DispatchMessage(ref Msg msg);

    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(uint threadId, uint msg, nint wParam, nint lParam);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(nint hwnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(nint parent, EnumWindowsProc proc, nint lParam);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nint OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(nint process, uint flags, StringBuilder name, ref uint size);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(nint handle);

    public void Start()
    {
        var started = new ManualResetEventSlim();
        _hookThread = new Thread(() =>
        {
            _hookThreadId = GetCurrentThreadId();
            var hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nint.Zero, _onWinEvent, 0, 0, WINEVENT_OUTOFCONTEXT);
            if (hook == nint.Zero) _log("front: the foreground hook could not be set; the 5 s check still runs");
            started.Set();
            while (GetMessage(out var msg, nint.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
            if (hook != nint.Zero) UnhookWinEvent(hook);
        })
        { IsBackground = true, Name = "FrontWatcher hook" };
        _hookThread.Start();
        started.Wait(TimeSpan.FromSeconds(5));
        Check();
        _timer = new System.Threading.Timer(_ => Check(), null, 5_000, 5_000);
    }

    public void Stop()
    {
        _timer?.Dispose();
        _timer = null;
        if (_hookThreadId != 0) PostThreadMessage(_hookThreadId, WM_QUIT, nint.Zero, nint.Zero);
        _hookThreadId = 0;
    }

    private void Check()
    {
        try
        {
            lock (_gate)
            {
                var (id, label) = NameFront();
                if (_sentOnce && id == _lastId && label == _lastLabel) return;
                _sentOnce = true;
                _lastId = id;
                _lastLabel = label;
                _send(PipeMessage.Front(id, label));
                _log(id is null ? "front: nothing" : $"front: {id} {label}");
            }
        }
        catch (Exception e)
        {
            _log($"front: check failed ({e.Message})");
        }
    }

    /// <summary>The program in front as (id, label), or (null, null) for nothing to count.</summary>
    private (string? Id, string? Label) NameFront()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == nint.Zero) return (null, null);
        GetWindowThreadProcessId(hwnd, out var windowPid);
        if (windowPid == 0) return (null, null);
        var windowExe = ExePath(windowPid);
        if (windowExe is null) return (null, null);

        var cls = new StringBuilder(256);
        GetClassName(hwnd, cls, cls.Capacity);
        if (ProgramNames.Ignored(Path.GetFileName(windowExe), cls.ToString())) return (null, null);

        var pid = ProgramNames.RealProcess(Path.GetFileName(windowExe), windowPid, ChildPids(hwnd));
        if (pid is not { } realPid) return (null, null);
        var exe = realPid == windowPid ? windowExe : ExePath(realPid);
        if (exe is null) return (null, null);
        if (realPid != windowPid && ProgramNames.Ignored(Path.GetFileName(exe), null)) return (null, null);

        if (!_cache.TryGetValue(realPid, out var info) || !string.Equals(info.Exe, exe, StringComparison.OrdinalIgnoreCase))
        {
            var (desc, product) = VersionInfo(exe);
            info = (exe, desc, product);
            _cache[realPid] = info;
            if (_cache.Count > 200) _cache.Clear();
        }
        return (ProgramNames.Id(exe), ProgramNames.Label(exe, info.Desc, info.Product));
    }

    /// <summary>The process ids of a window's child windows, in order.</summary>
    private static List<uint> ChildPids(nint hwnd)
    {
        var pids = new List<uint>();
        EnumChildWindows(hwnd, (child, _) =>
        {
            GetWindowThreadProcessId(child, out var pid);
            pids.Add(pid);
            return true;
        }, nint.Zero);
        return pids;
    }

    /// <summary>A process's exe path with only the limited query right (it works for Store apps too), or null.</summary>
    private static string? ExePath(uint pid)
    {
        var handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (handle == nint.Zero) return null;
        try
        {
            var name = new StringBuilder(1024);
            var size = (uint)name.Capacity;
            return QueryFullProcessImageName(handle, 0, name, ref size) ? name.ToString(0, (int)size) : null;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static (string? Desc, string? Product) VersionInfo(string path)
    {
        try
        {
            var info = System.Diagnostics.FileVersionInfo.GetVersionInfo(path);
            return (info.FileDescription, info.ProductName);
        }
        catch
        {
            return (null, null);
        }
    }
}
