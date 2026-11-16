using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using ScreenTime.Core.Games;

namespace ScreenTime.Tray;

/// <summary>
/// Games on the kid's desktop (docs/SPEC.md §12.6). <see cref="Apply"/> makes the desktop's "Play …" shortcuts match
/// what the service sent; each shortcut runs this exe with <c>--play &lt;id&gt;</c>, and <see cref="Play"/> starts the
/// game without asking for an administrator. The list of what was made is kept in
/// <c>%LOCALAPPDATA%\ScreenTime\games.json</c>.
/// </summary>
internal static partial class GameDesk
{
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    private static string ListPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenTime", "games.json");

    [LibraryImport("user32.dll", EntryPoint = "MessageBoxW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int MessageBox(IntPtr owner, string text, string caption, uint type);

    /// <summary>Writes and deletes shortcuts so the desktop matches <paramref name="wanted"/>. Never throws.</summary>
    public static void Apply(IReadOnlyList<GameShortcut> wanted, Action<string> log)
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var had = DeskJson.Decode(ReadOrNull(ListPath));
            var plan = Shortcuts.Plan(wanted, had, file => File.Exists(Path.Combine(desktop, file)));
            foreach (var file in plan.Delete)
            {
                File.Delete(Path.Combine(desktop, file));
                log($"games: removed {file}");
            }
            foreach (var game in plan.Write)
            {
                ShellLink.Create(
                    Path.Combine(desktop, game.File),
                    target: Environment.ProcessPath!,
                    arguments: $"--play {game.Id}",
                    icon: game.ExePath,
                    description: $"Start {game.Label} without asking for an administrator",
                    workingDirectory: Path.GetDirectoryName(Environment.ProcessPath!)!);
                log($"games: wrote {game.File}");
            }
            if (plan.Write.Count == 0 && plan.Delete.Count == 0 && plan.Result.SequenceEqual(had)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(ListPath)!);
            File.WriteAllText(ListPath, DeskJson.Encode(plan.Result), Utf8);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or COMException)
        {
            log($"games: could not update the desktop ({e.Message})");
        }
    }

    /// <summary>
    /// Starts the game a shortcut names. A known game's <c>config.ini</c> is fixed first when it needs it. When the
    /// game cannot be started, a small message says so.
    /// </summary>
    public static void Play(string id, Action<string> log)
    {
        var game = DeskJson.Decode(ReadOrNull(ListPath)).FirstOrDefault(g => g.Id == id);
        if (game is null)
        {
            log($"play: no game {id}");
            Sorry("That game is not set up on this PC any more.");
            return;
        }
        var plan = GameLaunch.Plan(new GameShortcut(game.Id, game.Label, game.ExePath), ReadOrNull);
        if (plan.ConfigPath is not null && plan.ConfigText is not null)
        {
            try
            {
                File.WriteAllText(plan.ConfigPath, plan.ConfigText, Utf8);
                log($"play: set the official channel in {plan.ConfigPath}");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // The game may still start; if it does not, the kid sees the game's own message.
                log($"play: could not write {plan.ConfigPath} ({e.Message})");
            }
        }
        try
        {
            var start = new ProcessStartInfo(plan.Exe) { UseShellExecute = false, WorkingDirectory = plan.WorkingFolder };
            start.Environment[GameLaunch.CompatVariable] = GameLaunch.CompatValue;
            using var process = Process.Start(start);
            log($"play: started {game.Label} pid {process?.Id}");
        }
        catch (Exception e) when (e is Win32Exception or IOException or InvalidOperationException)
        {
            log($"play: could not start {plan.Exe} ({e.Message})");
            Sorry($"Screen Time could not start {game.Label}. It may have moved or need an update. Ask Mum or Dad.");
        }
    }

    private static void Sorry(string text) => MessageBox(IntPtr.Zero, text, "Screen Time", 0x40);

    private static string? ReadOrNull(string path)
    {
        try
        {
            return File.Exists(path) ? File.ReadAllText(path) : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
internal class CShellLink;

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
internal interface IShellLinkW
{
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int max, IntPtr findData, uint flags);
    void GetIDList(out IntPtr idList);
    void SetIDList(IntPtr idList);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int max);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int max);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int max);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
    void GetHotkey(out short hotkey);
    void SetHotkey(short hotkey);
    void GetShowCmd(out int showCmd);
    void SetShowCmd(int showCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int max, out int icon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int icon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string rel, uint reserved);
    void Resolve(IntPtr hwnd, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
internal interface IPersistFile
{
    void GetClassID(out Guid classId);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
}

/// <summary>Writes a Windows shortcut (.lnk) through the shell's own <c>IShellLinkW</c>.</summary>
internal static class ShellLink
{
    public static void Create(string file, string target, string arguments, string icon, string description, string workingDirectory)
    {
        var link = (IShellLinkW)new CShellLink();
        try
        {
            link.SetPath(target);
            link.SetArguments(arguments);
            link.SetIconLocation(icon, 0);
            link.SetDescription(description);
            link.SetWorkingDirectory(workingDirectory);
            ((IPersistFile)link).Save(file, true);
        }
        finally
        {
            Marshal.FinalReleaseComObject(link);
        }
    }
}
