using ScreenTime.Core.Service;
using ScreenTime.Core.Sync;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047b: the service's small files next to state.db. Copied verbatim from the card.</summary>
public sealed class ServiceFilesTests : IDisposable
{
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "st-files-" + Guid.NewGuid().ToString("N"));

    public ServiceFilesTests() => Directory.CreateDirectory(_folder);

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    private string File(string name) => Path.Combine(_folder, name);

    [Fact]
    public void TheConfigRoundTripsAndAMissingOrBrokenFileIsNone()
    {
        Assert.Null(ServiceFiles.LoadConfig(File("config.json")));

        ServiceFiles.SaveConfig(File("config.json"), new ServiceConfig("https://screentime.example/"));
        Assert.Equal(new ServiceConfig("https://screentime.example/"), ServiceFiles.LoadConfig(File("config.json")));
        Assert.Contains("\"serverUrl\"", System.IO.File.ReadAllText(File("config.json")));

        System.IO.File.WriteAllText(File("config.json"), "{oops");
        Assert.Null(ServiceFiles.LoadConfig(File("config.json")));
    }

    [Theory]
    [InlineData("https://screentime.gallagherhome.au", "https://screentime.gallagherhome.au/")]
    [InlineData(" http://localhost:8080/ ", "http://localhost:8080/")]
    [InlineData("screentime.gallagherhome.au", "https://screentime.gallagherhome.au/")]
    public void ServerUrlsEndWithASlash(string given, string expected)
    {
        Assert.Equal(expected, ServiceFiles.NormaliseServerUrl(given));
    }

    [Theory]
    [InlineData("")]
    [InlineData("ftp://example.com")]
    [InlineData("https://")]
    public void ABadServerUrlThrows(string given)
    {
        Assert.Throws<ArgumentException>(() => ServiceFiles.NormaliseServerUrl(given));
    }

    [Fact]
    public void TheClockStoreKeepsItsValuesAcrossRestarts()
    {
        var first = new FileClockStore(File("clock.json"));
        Assert.Null(first.Anchor);
        Assert.Equal(0, first.LastTrustedMs);

        first.Anchor = new ClockAnchor(10_000_000, 1_000, 42);
        first.LastTrustedMs = 10_060_000;

        var second = new FileClockStore(File("clock.json"));
        Assert.Equal(new ClockAnchor(10_000_000, 1_000, 42), second.Anchor);
        Assert.Equal(10_060_000, second.LastTrustedMs);
        Assert.False(System.IO.File.Exists(File("clock.json.tmp")));
    }

    [Fact]
    public void ABrokenClockFileStartsEmpty()
    {
        System.IO.File.WriteAllText(File("clock.json"), "not json");
        var store = new FileClockStore(File("clock.json"));
        Assert.Null(store.Anchor);
        Assert.Equal(0, store.LastTrustedMs);
    }
}
