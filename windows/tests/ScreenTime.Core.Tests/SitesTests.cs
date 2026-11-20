using System.Text.Json;
using ScreenTime.Core.Api;
using ScreenTime.Core.Sites;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-069: the DNS log, browser policies and titles (docs/SPEC.md §12.10).</summary>
public sealed class SitesTests
{
    // Fixture A, a real event from Claude's spike, as it is.
    private const string FixtureA = """
    <Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Microsoft-Windows-DNS-Client' Guid='{1c95126e-7eea-49a9-a3fe-a378b03ddb4d}'/><EventID>3008</EventID><Version>0</Version><Level>4</Level><Task>0</Task><Opcode>0</Opcode><Keywords>0x8000000000000000</Keywords><TimeCreated SystemTime='2026-11-20T08:49:36.4044541Z'/><EventRecordID>485</EventRecordID><Correlation/><Execution ProcessID='8948' ThreadID='9036'/><Channel>Microsoft-Windows-DNS-Client/Operational</Channel><Computer>9e7dba08-41fb-4ec1-941d-c57e67e30d90</Computer><Security UserID='S-1-5-21-2047949552-857980807-821054962-504'/></System><EventData><Data Name='QueryName'>www.abc.net.au</Data><Data Name='QueryType'>1</Data><Data Name='QueryOptions'>722968478755192832</Data><Data Name='QueryStatus'>0</Data><Data Name='QueryResults'>type: 5 www.abc.net.au.edgekey.net;type: 5 e3161.b.akamaiedge.net;23.210.64.132;</Data></EventData></Event>
    """;

    [Fact]
    public void ParseGivesTheLookupOfFixtureA()
    {
        var lookup = DnsEvents.Parse(FixtureA);
        Assert.NotNull(lookup);
        Assert.Equal(1_795_164_576_404, lookup!.AtMs);
        Assert.Equal(8948u, lookup.ProcessId);
        Assert.Equal("S-1-5-21-2047949552-857980807-821054962-504", lookup.UserSid);
        Assert.Equal("www.abc.net.au", lookup.QueryName);
        Assert.Equal(1, lookup.QueryType);
        Assert.Equal(0, lookup.QueryStatus);
    }

    [Fact]
    public void ParseIsNullForAnotherEventIdAMissingSecurityElementOrNotXml()
    {
        Assert.Null(DnsEvents.Parse(FixtureA.Replace("<EventID>3008</EventID>", "<EventID>3006</EventID>")));
        Assert.Null(DnsEvents.Parse(FixtureA.Replace("<Security UserID='S-1-5-21-2047949552-857980807-821054962-504'/>", "")));
        Assert.Null(DnsEvents.Parse("not xml"));
    }

    [Fact]
    public void NormalizeLowerCasesTrimsAndRemovesOneTrailingDot()
    {
        Assert.Equal("www.abc.net.au", SiteHosts.Normalize("WWW.ABC.NET.AU."));
        Assert.Equal("en.wikipedia.org", SiteHosts.Normalize(" en.wikipedia.org "));
    }

    [Theory]
    [InlineData("")]
    [InlineData("wpad")]
    [InlineData("localhost")]
    [InlineData("192.168.0.148")]
    [InlineData("2404:6800:400a:1001::66")]
    [InlineData("printer.local")]
    [InlineData("router.lan")]
    [InlineData("nas.home.arpa")]
    [InlineData("148.0.168.192.in-addr.arpa")]
    [InlineData("_ldap._tcp.example.com")]
    public void NormalizeIsNullForNotAWebsiteHost(string host) => Assert.Null(SiteHosts.Normalize(host));

    [Fact]
    public void NormalizeIsNullForA254CharacterHost()
    {
        Assert.Null(SiteHosts.Normalize(new string('a', 254)));
    }

    private static DnsLookup Lookup(long atMs) =>
        new(atMs, 1234, "S-1-5-21-1-2-3-1001", "www.abc.net.au", 1, 0);

    [Fact]
    public void DecideKeepsAnEnrolledKidLookupNotInParentMode()
    {
        var filter = new SiteLookupFilter();
        var kept = filter.Decide(Lookup(1_000_000), "msedge.exe", enrolled: true, parentMode: false);
        Assert.NotNull(kept);
        Assert.Equal("S-1-5-21-1-2-3-1001", kept!.Sid);
        Assert.Equal(1_000_000, kept.AtMs);
        Assert.Equal("www.abc.net.au", kept.Host);
        Assert.Equal("msedge.exe", kept.Program);
    }

    [Fact]
    public void DecideDropsAFailedQuery()
    {
        var filter = new SiteLookupFilter();
        Assert.Null(filter.Decide(Lookup(1_000_000) with { QueryStatus = 9003 }, "msedge.exe", true, false));
        Assert.Null(filter.Decide(Lookup(1_000_000) with { QueryStatus = 87 }, "msedge.exe", true, false));
    }

    [Fact]
    public void DecideDropsNotEnrolledParentModeOurOwnProgramsAndAHostThatIsNotAWebsite()
    {
        var filter = new SiteLookupFilter();
        Assert.Null(filter.Decide(Lookup(1_000_000), "msedge.exe", enrolled: false, parentMode: false));
        Assert.Null(filter.Decide(Lookup(1_000_000), "msedge.exe", enrolled: true, parentMode: true));
        Assert.Null(filter.Decide(Lookup(1_000_000), "screentime.tray.exe", true, false));
        Assert.Null(filter.Decide(Lookup(1_000_000) with { QueryName = "wpad" }, "msedge.exe", true, false));
    }

    [Fact]
    public void ARepeatWithinTenSecondsOfTheLastKeptIsDroppedAndDoesNotMoveTheWindow()
    {
        var filter = new SiteLookupFilter();
        Assert.NotNull(filter.Decide(Lookup(1_000_000), "msedge.exe", true, false));
        Assert.Null(filter.Decide(Lookup(1_009_999), "msedge.exe", true, false));
        Assert.NotNull(filter.Decide(Lookup(1_010_000), "msedge.exe", true, false));
        Assert.Null(filter.Decide(Lookup(1_015_000), "msedge.exe", true, false));
        Assert.NotNull(filter.Decide(Lookup(1_020_000), "msedge.exe", true, false));
        // The same host by another program, and another account, are not repeats.
        Assert.NotNull(filter.Decide(Lookup(1_009_999), "chrome.exe", true, false));
        Assert.NotNull(filter.Decide(Lookup(1_009_999) with { UserSid = "S-1-5-21-1-2-3-1002" }, "msedge.exe", true, false));
    }

    [Fact]
    public void IsBrowserIsTheFourBrowsersInAnyCase()
    {
        Assert.True(BrowserTitles.IsBrowser("msedge.exe"));
        Assert.True(BrowserTitles.IsBrowser("CHROME.EXE"));
        Assert.True(BrowserTitles.IsBrowser("brave.exe"));
        Assert.True(BrowserTitles.IsBrowser("firefox.exe"));
        Assert.False(BrowserTitles.IsBrowser("msedgewebview2.exe"));
        Assert.False(BrowserTitles.IsBrowser("notepad.exe"));
        Assert.False(BrowserTitles.IsBrowser(""));
    }

    [Fact]
    public void CleanRemovesZeroWidthAndControlCharactersTrimsAndCutsTo300()
    {
        Assert.Equal("Wikipedia - Profile 1 - Microsoft Edge", BrowserTitles.Clean("Wikipedia - Profile 1 - Microsoft\u200B Edge"));
        Assert.Equal("ab", BrowserTitles.Clean("  a\tb\r\n "));
        Assert.Null(BrowserTitles.Clean("\u200B"));
        Assert.Null(BrowserTitles.Clean(null));
        Assert.Equal(new string('x', 300), BrowserTitles.Clean(new string('x', 400)));
    }

    [Fact]
    public void ThePoliciesAreTheThirteenOfSpec12_10()
    {
        var edge = @"HKLM\SOFTWARE\Policies\Microsoft\Edge";
        var chrome = @"HKLM\SOFTWARE\Policies\Google\Chrome";
        var brave = @"HKLM\SOFTWARE\Policies\BraveSoftware\Brave";
        var firefox = @"HKLM\SOFTWARE\Policies\Mozilla\Firefox";
        var expected = new (string Key, string Name, BrowserPolicyKind Kind, string Value)[]
        {
            (edge, "DnsOverHttpsMode", BrowserPolicyKind.String, "off"),
            (edge, "BuiltInDnsClientEnabled", BrowserPolicyKind.Dword, "0"),
            (edge + @"\ExtensionInstallBlocklist", "1", BrowserPolicyKind.String, "*"),
            (chrome, "DnsOverHttpsMode", BrowserPolicyKind.String, "off"),
            (chrome, "BuiltInDnsClientEnabled", BrowserPolicyKind.Dword, "0"),
            (chrome + @"\ExtensionInstallBlocklist", "1", BrowserPolicyKind.String, "*"),
            (brave, "DnsOverHttpsMode", BrowserPolicyKind.String, "off"),
            (brave, "BuiltInDnsClientEnabled", BrowserPolicyKind.Dword, "0"),
            (brave + @"\ExtensionInstallBlocklist", "1", BrowserPolicyKind.String, "*"),
            (brave, "TorDisabled", BrowserPolicyKind.Dword, "1"),
            (firefox + @"\DNSOverHTTPS", "Enabled", BrowserPolicyKind.Dword, "0"),
            (firefox + @"\DNSOverHTTPS", "Locked", BrowserPolicyKind.Dword, "1"),
            (firefox, "ExtensionSettings", BrowserPolicyKind.String, """{"*":{"installation_mode":"blocked"}}"""),
        };
        var actual = BrowserPolicies.All
            .Select(v => (v.KeyPath, v.Name, v.Kind, v.Value))
            .ToArray();
        Assert.Equal(13, actual.Length);
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void TheRegistryPathsAreRelativeNeverHklm()
    {
        // Registry.LocalMachine is the HKLM hive, so a full "HKLM\..." path would create a key literally named
        // "HKLM" under HKLM, not the intended subkey. The path passed to it must never carry the prefix.
        foreach (var v in BrowserPolicies.All)
        {
            Assert.False(v.RegistryPath.StartsWith("HKLM", StringComparison.OrdinalIgnoreCase),
                $"{v.KeyPath} must not be passed to Registry.LocalMachine with its HKLM prefix (got {v.RegistryPath})");
            Assert.Equal(BrowserPolicies.RelativePath(v.KeyPath), v.RegistryPath);
            Assert.StartsWith(@"HKLM\", v.KeyPath);
        }
    }

    [Fact]
    public void ATitleSpanClosesOnChangeOfProgramTitleCountingOffOrTrayGone()
    {
        var clock = new TitleClock();
        Assert.Empty(clock.Counting(true, 0));
        Assert.Empty(clock.Front("msedge.exe", "A", 0));
        // A repeat front line does not close the span.
        Assert.Empty(clock.Front("msedge.exe", "A", 5_000));
        var onB = clock.Front("msedge.exe", "B", 42_700);
        Assert.Equal([new TitleSpan(0, 42, "msedge.exe", "A")], onB);
        var off = clock.Counting(false, 50_000);
        Assert.Equal([new TitleSpan(42_700, 7, "msedge.exe", "B")], off);
        // Counting on starts a new span for the title in front; B again for 900 ms is under 1 s.
        Assert.Empty(clock.Counting(true, 60_000));
        Assert.Empty(clock.Front(null, null, 60_900));
        Assert.Empty(clock.Front("chrome.exe", "C", 70_000));
        // The clock stepped back: the span's end is not after its start, so nothing.
        Assert.Empty(clock.Front("chrome.exe", "D", 69_000));
        var onE = clock.Front("chrome.exe", "E", 72_500);
        Assert.Equal([new TitleSpan(69_000, 3, "chrome.exe", "D")], onE);
    }

    [Fact]
    public void ASpanIsCappedAt86400Seconds()
    {
        var clock = new TitleClock();
        clock.Counting(true, 0);
        clock.Front("msedge.exe", "A", 0);
        var spans = clock.Front("msedge.exe", "B", 100_000_000);
        Assert.Equal([new TitleSpan(0, 86_400, "msedge.exe", "A")], spans);
    }

    /// <summary>The C# client's SiteTitlesUpload must serialise to the server's field names: a top-level
    /// "titles" array, each item with "at", "sec", "package" and "title" (lower case). A mismatch is a 422.</summary>
    [Fact]
    public void TheSiteTitlesUploadSerialisesWithTheServerFieldNames()
    {
        var body = new SiteTitlesUpload([new SiteTitleIn("2026-11-10T01:00:00Z", 42, "msedge.exe", "how to draw - Search")]);
        var json = JsonSerializer.Serialize(body, ApiJsonContext.Default.SiteTitlesUpload);
        Assert.Contains("\"titles\"", json);
        Assert.Contains("\"at\"", json);
        Assert.Contains("\"sec\"", json);
        Assert.Contains("\"package\"", json);
        Assert.Contains("\"title\"", json);
        // The PascalCase property names must not leak into the JSON.
        Assert.DoesNotContain("\"At\"", json);
        Assert.DoesNotContain("\"Sec\"", json);
        Assert.DoesNotContain("\"Package\"", json);
        Assert.DoesNotContain("\"Title\"", json);
        Assert.DoesNotContain("\"Titles\"", json);
    }

    /// <summary>The at field is milliseconds since the Unix epoch as a UTC instant ending in Z
    /// (docs/SPEC.md §12.10). The old code used the ticks constructor and a +00:00 offset, which sent year-0001
    /// dates and a 422.</summary>
    [Fact]
    public void IsoUtcFormatsUnixMillisecondsAsUtcZ()
    {
        Assert.Equal("2026-11-20T08:49:36.404Z", IsoUtc.ToIso(1_795_164_576_404));
    }
}
