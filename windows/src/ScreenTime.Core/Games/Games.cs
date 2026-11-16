using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace ScreenTime.Core.Games;

/// <summary>
/// A game Screen Time can find on a PC (docs/SPEC.md §12.6). <c>ExeName</c> is the file it looks for.
/// <c>FixSubChannels</c> are the <c>sub_channel</c> values in the game's <c>config.ini</c> that stop it starting without
/// its launcher (3 is the Epic Games build, 6 the Google Play Games build); they are set to the official channel
/// before each start.
/// </summary>
public sealed record KnownGame(string Id, string Label, string ExeName, IReadOnlyList<string> FixSubChannels);

/// <summary>The games Screen Time knows. Only what was tried: see docs/SPEC.md §12.6.</summary>
public static class KnownGames
{
    public static readonly IReadOnlyList<KnownGame> All =
    [
        new("genshin", "Genshin Impact", "GenshinImpact.exe", ["6"]),
        new("starrail", "Honkai: Star Rail", "StarRail.exe", ["3"]),
    ];

    /// <summary>The known game with this id, or null for a program a parent added.</summary>
    public static KnownGame? ById(string id) => All.FirstOrDefault(g => g.Id == id);
}

/// <summary>A game with its shortcut on, as the snapshot and the pipe carry it.</summary>
public sealed record GameShortcut(string Id, string Label, string ExePath);

/// <summary>Looks for the known games in folders, nearest the drive's root first.</summary>
public static class GameFinder
{
    /// <summary>How many folders below a root it looks: <c>C:\Program Files\Epic Games\X\games\X game</c> is 5.</summary>
    public const int MaxDepth = 6;

    /// <summary>It gives up after this many folders, so a huge disk cannot keep it busy.</summary>
    public const int MaxFolders = 200_000;

    private static readonly HashSet<string> Skipped = new(StringComparer.OrdinalIgnoreCase)
    {
        "Windows", "ProgramData", "Users", "Documents and Settings", "$Recycle.Bin", "System Volume Information", "Recovery", "PerfLogs",
        "$WinREAgent", "WindowsApps", "node_modules", ".git",
    };

    /// <summary>
    /// The known games under <paramref name="roots"/>, in <see cref="KnownGames.All"/>'s order. <paramref name="folders"/>
    /// gives a folder's subfolders as full paths (nothing when it cannot be read); <paramref name="fileExists"/> says
    /// whether a file is there. A game in two places is reported where it is nearest a root.
    /// </summary>
    public static IReadOnlyList<GameShortcut> Find(IEnumerable<string> roots, Func<string, IEnumerable<string>> folders, Func<string, bool> fileExists)
    {
        var found = new Dictionary<string, GameShortcut>();
        var queue = new Queue<(string Path, int Depth)>();
        foreach (var root in roots) queue.Enqueue((root, 0));
        var seen = 0;
        while (queue.Count > 0 && found.Count < KnownGames.All.Count && seen < MaxFolders)
        {
            var (folder, depth) = queue.Dequeue();
            seen++;
            foreach (var game in KnownGames.All)
            {
                if (found.ContainsKey(game.Id)) continue;
                var exe = Join(folder, game.ExeName);
                if (fileExists(exe)) found[game.Id] = new GameShortcut(game.Id, game.Label, exe);
            }
            if (found.Count == KnownGames.All.Count) break;
            if (depth >= MaxDepth) continue;
            foreach (var child in folders(folder))
            {
                if (!Skipped.Contains(NameOf(child))) queue.Enqueue((child, depth + 1));
            }
        }
        return KnownGames.All.Where(g => found.ContainsKey(g.Id)).Select(g => found[g.Id]).ToList();
    }

    private static string Join(string folder, string name) => folder.TrimEnd('\\') + "\\" + name;

    private static string NameOf(string folder)
    {
        var trimmed = folder.TrimEnd('\\');
        return trimmed[(trimmed.LastIndexOf('\\') + 1)..];
    }
}

/// <summary>The official channel in a HoYoverse game's <c>config.ini</c> (docs/SPEC.md §12.6).</summary>
public static partial class ChannelFix
{
    [GeneratedRegex(@"^sub_channel=([^\r\n]*)", RegexOptions.Multiline)]
    private static partial Regex SubChannel();

    [GeneratedRegex(@"^cps=[^\r\n]*", RegexOptions.Multiline)]
    private static partial Regex Cps();

    /// <summary>
    /// <paramref name="config"/> with <c>sub_channel=0</c> and <c>cps=hoyoverse</c> when its <c>sub_channel</c> is one of
    /// <paramref name="fromSubChannels"/>; otherwise the same text. Every other line and the line endings are kept.
    /// </summary>
    public static string Apply(string config, IReadOnlyList<string> fromSubChannels)
    {
        var match = SubChannel().Match(config);
        if (!match.Success || !fromSubChannels.Contains(match.Groups[1].Value.Trim())) return config;
        return Cps().Replace(SubChannel().Replace(config, "sub_channel=0", 1), "cps=hoyoverse", 1);
    }
}

/// <summary>
/// How to start a game without an administrator: the exe, its folder, and, when <c>ConfigText</c> is not null, the
/// <c>config.ini</c> to write first.
/// </summary>
public sealed record LaunchPlan(string Exe, string WorkingFolder, string? ConfigPath, string? ConfigText);

public static class GameLaunch
{
    /// <summary>The environment variable that makes Windows start a program without asking for an administrator.</summary>
    public const string CompatVariable = "__COMPAT_LAYER";

    public const string CompatValue = "RunAsInvoker";

    /// <summary>
    /// The plan for <paramref name="game"/>. <paramref name="readText"/> gives a file's text, or null when it is not
    /// there. Only a known game's <c>config.ini</c> is ever changed, and only when it needs it.
    /// </summary>
    public static LaunchPlan Plan(GameShortcut game, Func<string, string?> readText)
    {
        var cut = game.ExePath.LastIndexOf('\\');
        var folder = cut <= 2 ? game.ExePath[..(cut + 1)] : game.ExePath[..cut];
        if (KnownGames.ById(game.Id) is not { FixSubChannels.Count: > 0 } known) return new LaunchPlan(game.ExePath, folder, null, null);
        var configPath = folder.TrimEnd('\\') + "\\config.ini";
        var before = readText(configPath);
        if (before is null) return new LaunchPlan(game.ExePath, folder, null, null);
        var after = ChannelFix.Apply(before, known.FixSubChannels);
        return after == before ? new LaunchPlan(game.ExePath, folder, null, null) : new LaunchPlan(game.ExePath, folder, configPath, after);
    }
}

/// <summary>A shortcut the tray made: the game and the shortcut's file name on the desktop.</summary>
public sealed record DeskGame(string Id, string Label, string ExePath, string File);

/// <summary>
/// What to do on the desktop: shortcuts to write, file names to delete, and what is there afterwards (saved for
/// next time and for <c>--play</c>).
/// </summary>
public sealed record ShortcutPlan(IReadOnlyList<DeskGame> Write, IReadOnlyList<string> Delete, IReadOnlyList<DeskGame> Result);

public static class Shortcuts
{
    private const string Invalid = "\\/:*?\"<>|";

    /// <summary>
    /// "Play Genshin Impact.lnk". The game's own launcher usually has a shortcut with the plain name, which asks for an
    /// administrator; this name never clashes with it.
    /// </summary>
    public static string FileName(string label)
    {
        var clean = new string(label.Where(c => !char.IsControl(c) && !Invalid.Contains(c)).ToArray());
        clean = string.Join(' ', clean.Split(' ', StringSplitOptions.RemoveEmptyEntries)).TrimEnd('.', ' ');
        return $"Play {(clean.Length == 0 ? "game" : clean)}.lnk";
    }

    /// <summary>
    /// The plan that makes the desktop match <paramref name="wanted"/>. <paramref name="had"/> is what the tray made
    /// before; <paramref name="exists"/> says whether a shortcut file is still on the desktop. A shortcut is written
    /// when it is new, changed, or was deleted by the kid; shortcuts of games no longer wanted are deleted. Files the
    /// tray did not make are never deleted.
    /// </summary>
    public static ShortcutPlan Plan(IReadOnlyList<GameShortcut> wanted, IReadOnlyList<DeskGame> had, Func<string, bool> exists)
    {
        var result = new List<DeskGame>();
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var game in wanted)
        {
            var file = FileName(game.Label);
            for (var n = 2; !taken.Add(file); n++) file = $"{FileName(game.Label)[..^4]} ({n}).lnk";
            result.Add(new DeskGame(game.Id, game.Label, game.ExePath, file));
        }
        var write = result.Where(g => !had.Contains(g) || !exists(g.File)).ToList();
        var delete = had.Select(g => g.File).Where(f => !taken.Contains(f)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return new ShortcutPlan(write, delete, result);
    }
}

/// <summary>The tray's list of the shortcuts it made, as JSON in <c>%LOCALAPPDATA%\ScreenTime\games.json</c>.</summary>
public static class DeskJson
{
    public static string Encode(IReadOnlyList<DeskGame> games) => JsonSerializer.Serialize(new DeskFile(games), DeskJsonContext.Default.DeskFile);

    /// <summary>The list back from its JSON; empty when it is null, not JSON, or has no games.</summary>
    public static IReadOnlyList<DeskGame> Decode(string? json)
    {
        if (json is null) return [];
        try
        {
            return JsonSerializer.Deserialize(json, DeskJsonContext.Default.DeskFile)?.Games ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}

internal sealed record DeskFile(IReadOnlyList<DeskGame>? Games);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(DeskFile))]
internal sealed partial class DeskJsonContext : JsonSerializerContext;
