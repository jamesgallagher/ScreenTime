using System.Text;
using System.Text.RegularExpressions;

namespace ScreenTime.Core.Programs;

/// <summary>
/// The name of a program from its window (docs/SPEC.md §12.9). The <see cref="Id"/> is the exe's file name in lower
/// case; the <see cref="Label"/> is its <c>FileDescription</c> with a trailing <c>.exe</c> taken off, else its
/// <c>ProductName</c>, else the file name without <c>.exe</c>; at most 80 characters.
/// </summary>
public static class ProgramNames
{
    /// <summary>The id of a program: the file name of its path in lower case (<c>C:\X\Notepad.exe</c> → <c>notepad.exe</c>).</summary>
    public static string Id(string exePath)
    {
        var cut = exePath.LastIndexOf('\\');
        var name = cut >= 0 ? exePath[(cut + 1)..] : exePath;
        return name.ToLowerInvariant();
    }

    private static readonly Regex ExeSuffix = new(@"\.exe$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// The label of a program: the trimmed <paramref name="fileDescription"/> with a trailing <c>.exe</c> (any case)
    /// removed; if that is empty, the trimmed <paramref name="productName"/>; if that is empty, the file name without
    /// <c>.exe</c>. Cut to 80 characters.
    /// </summary>
    public static string Label(string exePath, string? fileDescription, string? productName)
    {
        var fromDescription = ExeSuffix.Replace(fileDescription?.Trim() ?? "", "").Trim();
        var text = fromDescription.Length > 0
            ? fromDescription
            : (productName?.Trim() ?? "").Trim();
        if (text.Length == 0)
        {
            var cut = exePath.LastIndexOf('\\');
            var name = cut >= 0 ? exePath[(cut + 1)..] : exePath;
            text = ExeSuffix.Replace(name, "").Trim();
        }
        return text.Length > 80 ? text[..80] : text;
    }

    private static readonly HashSet<string> ExplorerClasses = new(StringComparer.OrdinalIgnoreCase)
    {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
    };

    private static readonly HashSet<string> IgnoredProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "LockApp.exe", "StartMenuExperienceHost.exe", "SearchHost.exe", "ShellExperienceHost.exe", "ShellHost.exe",
        "ScreenTime.Tray.exe", "ScreenTime.Service.exe",
    };

    /// <summary>
    /// The process whose program is in front (docs/SPEC.md §12.9). A Store app's window belongs to
    /// <c>ApplicationFrameHost.exe</c>; the real program is the first child window whose process differs from the
    /// frame's. Null when there is none yet (the app is starting or suspended): then nothing counts. Any other window's
    /// own process is the program.
    /// </summary>
    public static uint? RealProcess(string exeFileName, uint windowPid, IEnumerable<uint> childWindowPids)
    {
        if (!string.Equals(exeFileName, "ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase)) return windowPid;
        foreach (var pid in childWindowPids)
        {
            if (pid != 0 && pid != windowPid) return pid;
        }
        return null;
    }

    /// <summary>
    /// True when the window is not a program to count (docs/SPEC.md §12.9): the desktop and taskbars of
    /// <c>explorer.exe</c>, and the named processes whatever their window class. File Explorer's own windows
    /// (<c>CabinetWClass</c>) do count.
    /// </summary>
    public static bool Ignored(string exeFileName, string? windowClass)
    {
        var name = exeFileName.ToLowerInvariant();
        if (name == "explorer.exe" && windowClass is { } cls && ExplorerClasses.Contains(cls)) return true;
        return IgnoredProcesses.Contains(name);
    }
}
