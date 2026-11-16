using ScreenTime.Core.Games;
using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-060: games on a kid's PC (docs/SPEC.md §12.6). Copied verbatim from the card.</summary>
public class GamesTests
{
    private const string GenshinExe = @"C:\Program Files\Epic Games\GenshinImpact\games\Genshin Impact game\GenshinImpact.exe";
    private const string StarRailExe = @"D:\Star Rail Games\StarRail.exe";
    private static readonly GameShortcut Genshin = new("genshin", "Genshin Impact", GenshinExe);
    private static readonly GameShortcut StarRail = new("starrail", "Honkai: Star Rail", StarRailExe);

    /// <summary>A fake disk: the files, and every folder above them.</summary>
    private sealed class Disk(params string[] files)
    {
        private readonly HashSet<string> _files = new(files, StringComparer.OrdinalIgnoreCase);
        public int Listed { get; private set; }

        public bool Exists(string file) => _files.Contains(file);

        public IEnumerable<string> Folders(string folder)
        {
            Listed++;
            var prefix = folder.TrimEnd('\\') + "\\";
            return _files
                .Where(f => f.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                .Select(f => f[prefix.Length..])
                .Where(rest => rest.Contains('\\'))
                .Select(rest => prefix + rest[..rest.IndexOf('\\')])
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
    }

    [Fact]
    public void FindsTheKnownGamesOnEveryDriveInTheCatalogsOrder()
    {
        var disk = new Disk(StarRailExe, GenshinExe, @"C:\Games\Other\Other.exe");
        var found = GameFinder.Find([@"C:\", @"D:\"], disk.Folders, disk.Exists);
        Assert.Equal([Genshin, StarRail], found);
    }

    [Fact]
    public void FindsNothingOnAPcWithoutThem()
    {
        var disk = new Disk(@"C:\Games\Other\Other.exe");
        Assert.Empty(GameFinder.Find([@"C:\"], disk.Folders, disk.Exists));
        Assert.Empty(GameFinder.Find([], disk.Folders, disk.Exists));
    }

    [Fact]
    public void TakesTheCopyNearestARootAndStopsWhenAllAreFound()
    {
        var disk = new Disk(@"C:\a\b\c\GenshinImpact.exe", @"C:\Games\GenshinImpact.exe", @"C:\Games\StarRail.exe", @"C:\x\1\f.txt", @"C:\x\2\f.txt");
        var found = GameFinder.Find([@"C:\"], disk.Folders, disk.Exists);
        Assert.Equal(@"C:\Games\GenshinImpact.exe", found[0].ExePath);
        Assert.Equal(@"C:\Games\StarRail.exe", found[1].ExePath);
        // The root and a are opened; both games are in Games, so Games and x never are.
        Assert.Equal(2, disk.Listed);
    }

    [Fact]
    public void LooksSixFoldersDeepAndNoDeeper()
    {
        var six = new Disk(@"C:\1\2\3\4\5\6\GenshinImpact.exe");
        Assert.Single(GameFinder.Find([@"C:\"], six.Folders, six.Exists));
        var seven = new Disk(@"C:\1\2\3\4\5\6\7\GenshinImpact.exe");
        Assert.Empty(GameFinder.Find([@"C:\"], seven.Folders, seven.Exists));
    }

    [Theory]
    [InlineData(@"C:\Windows\GenshinImpact.exe")]
    [InlineData(@"C:\Users\ciara\Games\GenshinImpact.exe")]
    [InlineData(@"C:\ProgramData\x\GenshinImpact.exe")]
    [InlineData(@"C:\$Recycle.Bin\S-1-5\GenshinImpact.exe")]
    [InlineData(@"D:\Games\windowsapps\GenshinImpact.exe")]
    public void SkipsSystemFolders(string exe)
    {
        var disk = new Disk(exe);
        Assert.Empty(GameFinder.Find([@"C:\", @"D:\"], disk.Folders, disk.Exists));
    }

    [Fact]
    public void AFolderThatCannotBeReadIsJustEmpty()
    {
        var disk = new Disk(GenshinExe);
        var found = GameFinder.Find([@"C:\", @"E:\"], f => f.StartsWith(@"E:\", StringComparison.Ordinal) ? [] : disk.Folders(f), disk.Exists);
        Assert.Equal([Genshin], found);
    }

    private const string EpicConfig = "[General]\r\ngame_version=4.7.0\r\nchannel=1\r\nsub_channel=3\r\ncps=psseaepic\r\nuapc={\"hkrpg_global\":{\"uapc\":\"\"}}\r\n";

    [Fact]
    public void TheChannelFixRewritesOnlyTheTwoLines()
    {
        Assert.Equal(
            "[General]\r\ngame_version=4.7.0\r\nchannel=1\r\nsub_channel=0\r\ncps=hoyoverse\r\nuapc={\"hkrpg_global\":{\"uapc\":\"\"}}\r\n",
            ChannelFix.Apply(EpicConfig, ["3"]));
        Assert.Equal("[General]\nchannel=1\nsub_channel=0\ncps=hoyoverse\n", ChannelFix.Apply("[General]\nchannel=1\nsub_channel=6\ncps=pcgoogle2\n", ["6"]));
        Assert.Equal("sub_channel=0", ChannelFix.Apply("sub_channel=6", ["3", "6"]));
    }

    [Fact]
    public void TheChannelFixLeavesOtherChannelsAndOtherFilesAlone()
    {
        Assert.Same(EpicConfig, ChannelFix.Apply(EpicConfig, ["6"]));
        Assert.Same(EpicConfig, ChannelFix.Apply(EpicConfig, []));
        var official = "[General]\r\nchannel=1\r\nsub_channel=0\r\ncps=hoyoverse\r\n";
        Assert.Same(official, ChannelFix.Apply(official, ["3", "6"]));
        Assert.Equal("", ChannelFix.Apply("", ["3"]));
        Assert.Equal("nothing=here\r\n", ChannelFix.Apply("nothing=here\r\n", ["3"]));
        // Only a whole line: my_sub_channel is something else.
        Assert.Equal("my_sub_channel=3\r\n", ChannelFix.Apply("my_sub_channel=3\r\n", ["3"]));
    }

    [Fact]
    public void AStarRailStartFixesItsEpicConfigFirst()
    {
        var plan = GameLaunch.Plan(StarRail, path => path == @"D:\Star Rail Games\config.ini" ? EpicConfig : null);
        Assert.Equal(StarRailExe, plan.Exe);
        Assert.Equal(@"D:\Star Rail Games", plan.WorkingFolder);
        Assert.Equal(@"D:\Star Rail Games\config.ini", plan.ConfigPath);
        Assert.Contains("sub_channel=0\r\ncps=hoyoverse", plan.ConfigText);
    }

    [Fact]
    public void AStartWritesNothingWhenThereIsNothingToFix()
    {
        // Genshin's Epic build starts as it is: only its Google Play build (6) is fixed.
        var epic = GameLaunch.Plan(Genshin, _ => EpicConfig);
        Assert.Null(epic.ConfigPath);
        Assert.Null(epic.ConfigText);
        var google = GameLaunch.Plan(Genshin, _ => "sub_channel=6\r\ncps=pcgoogle2\r\n");
        Assert.Equal(@"C:\Program Files\Epic Games\GenshinImpact\games\Genshin Impact game\config.ini", google.ConfigPath);
        Assert.Equal("sub_channel=0\r\ncps=hoyoverse\r\n", google.ConfigText);
        Assert.Null(GameLaunch.Plan(StarRail, _ => null).ConfigText);
        Assert.Null(GameLaunch.Plan(StarRail, _ => EpicConfig.Replace("sub_channel=3", "sub_channel=0")).ConfigText);
    }

    [Fact]
    public void AProgramAParentAddedIsStartedAsItIs()
    {
        var read = 0;
        var plan = GameLaunch.Plan(new GameShortcut("custom-1", "Thing", @"E:\Thing.exe"), _ => { read++; return EpicConfig; });
        Assert.Equal(new LaunchPlan(@"E:\Thing.exe", @"E:\", null, null), plan);
        Assert.Equal(0, read);
        Assert.Equal("__COMPAT_LAYER", GameLaunch.CompatVariable);
        Assert.Equal("RunAsInvoker", GameLaunch.CompatValue);
    }

    [Theory]
    [InlineData("Genshin Impact", "Play Genshin Impact.lnk")]
    [InlineData("Honkai: Star Rail", "Play Honkai Star Rail.lnk")]
    [InlineData("  A/B\\C  <game>?  ", "Play ABC game.lnk")]
    [InlineData("Ends with dots...", "Play Ends with dots.lnk")]
    [InlineData("???", "Play game.lnk")]
    [InlineData("Tab\there", "Play Tabhere.lnk")]
    public void AShortcutIsNamedPlayAndTheGame(string label, string file) => Assert.Equal(file, Shortcuts.FileName(label));

    private static DeskGame Desk(GameShortcut g, string file) => new(g.Id, g.Label, g.ExePath, file);

    [Fact]
    public void TheFirstPlanWritesEveryWantedShortcut()
    {
        var plan = Shortcuts.Plan([Genshin, StarRail], [], _ => false);
        Assert.Equal([Desk(Genshin, "Play Genshin Impact.lnk"), Desk(StarRail, "Play Honkai Star Rail.lnk")], plan.Write);
        Assert.Empty(plan.Delete);
        Assert.Equal(plan.Write, plan.Result);
    }

    [Fact]
    public void NothingIsWrittenWhenNothingChanged()
    {
        var had = Shortcuts.Plan([Genshin, StarRail], [], _ => false).Result;
        var plan = Shortcuts.Plan([Genshin, StarRail], had, _ => true);
        Assert.Empty(plan.Write);
        Assert.Empty(plan.Delete);
        Assert.Equal(had, plan.Result);
    }

    [Fact]
    public void AShortcutTheKidDeletedComesBack()
    {
        var had = Shortcuts.Plan([Genshin, StarRail], [], _ => false).Result;
        var plan = Shortcuts.Plan([Genshin, StarRail], had, file => file != "Play Genshin Impact.lnk");
        Assert.Equal([Desk(Genshin, "Play Genshin Impact.lnk")], plan.Write);
        Assert.Empty(plan.Delete);
    }

    [Fact]
    public void AGameTurnedOffLosesItsShortcutAndOnlyItsOwn()
    {
        var had = Shortcuts.Plan([Genshin, StarRail], [], _ => false).Result;
        var plan = Shortcuts.Plan([StarRail], had, _ => true);
        Assert.Empty(plan.Write);
        Assert.Equal(["Play Genshin Impact.lnk"], plan.Delete);
        Assert.Equal([Desk(StarRail, "Play Honkai Star Rail.lnk")], plan.Result);
        var none = Shortcuts.Plan([], had, _ => true);
        Assert.Equal(["Play Genshin Impact.lnk", "Play Honkai Star Rail.lnk"], none.Delete);
        Assert.Empty(none.Result);
    }

    [Fact]
    public void AMovedOrRenamedGameIsWrittenAgain()
    {
        var had = Shortcuts.Plan([Genshin], [], _ => false).Result;
        var moved = Shortcuts.Plan([Genshin with { ExePath = @"E:\GenshinImpact.exe" }], had, _ => true);
        Assert.Equal([new DeskGame("genshin", "Genshin Impact", @"E:\GenshinImpact.exe", "Play Genshin Impact.lnk")], moved.Write);
        Assert.Empty(moved.Delete);
        var renamed = Shortcuts.Plan([Genshin with { Label = "Genshin" }], had, _ => true);
        Assert.Equal("Play Genshin.lnk", renamed.Write[0].File);
        Assert.Equal(["Play Genshin Impact.lnk"], renamed.Delete);
    }

    [Fact]
    public void TwoGamesWithOneNameGetTwoFiles()
    {
        var a = new GameShortcut("custom-a", "Thing", @"C:\a\Thing.exe");
        var b = new GameShortcut("custom-b", "thing", @"C:\b\Thing.exe");
        var c = new GameShortcut("custom-c", "Thing?", @"C:\c\Thing.exe");
        var plan = Shortcuts.Plan([a, b, c], [], _ => false);
        Assert.Equal(["Play Thing.lnk", "Play thing (2).lnk", "Play Thing (3).lnk"], plan.Result.Select(g => g.File));
    }

    [Fact]
    public void TheTraysListGoesToJsonAndBack()
    {
        var games = Shortcuts.Plan([Genshin, StarRail], [], _ => false).Result;
        var json = DeskJson.Encode(games);
        Assert.StartsWith("""{"games":[{"id":"genshin","label":"Genshin Impact","exePath":"C:\\Program Files\\Epic Games""", json);
        Assert.Equal(games, DeskJson.Decode(json));
        Assert.Empty(DeskJson.Decode(null));
        Assert.Empty(DeskJson.Decode("not json"));
        Assert.Empty(DeskJson.Decode("null"));
        Assert.Empty(DeskJson.Decode("{}"));
    }

    [Fact]
    public void TheGamesPipeLineCarriesTheList()
    {
        var line = PipeMessage.Encode(PipeMessage.GamesOf([StarRail]));
        Assert.Equal("""{"type":"games","games":[{"id":"starrail","label":"Honkai: Star Rail","exePath":"D:\\Star Rail Games\\StarRail.exe"}]}""", line);
        Assert.Equal([StarRail], PipeMessage.Decode(line)?.Games);
        Assert.Equal("""{"type":"games","games":[]}""", PipeMessage.Encode(PipeMessage.GamesOf([])));
        Assert.Empty(PipeMessage.Decode("""{"type":"games","games":[]}""")!.Games!);
        Assert.Null(PipeMessage.Decode("""{"type":"view"}""")!.Games);
    }
}
