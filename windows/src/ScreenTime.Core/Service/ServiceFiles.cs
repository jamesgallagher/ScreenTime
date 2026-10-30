using System.Text.Json;
using System.Text.Json.Serialization;
using ScreenTime.Core.Sync;

namespace ScreenTime.Core.Service;

/// <summary>The service's configuration, one file next to state.db.</summary>
public sealed record ServiceConfig(string ServerUrl);

internal sealed record ClockFile(ClockAnchor? Anchor, long LastTrustedMs);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, WriteIndented = true)]
[JsonSerializable(typeof(ServiceConfig))]
[JsonSerializable(typeof(ClockFile))]
internal sealed partial class ServiceJsonContext : JsonSerializerContext
{
}

/// <summary>The service's small files next to state.db (config and the clock store).</summary>
public static class ServiceFiles
{
    /// <summary>Reads the config, or null when the file is missing or broken.</summary>
    public static ServiceConfig? LoadConfig(string path)
    {
        if (!File.Exists(path)) return null;
        try
        {
            return JsonSerializer.Deserialize(File.ReadAllText(path), ServiceJsonContext.Default.ServiceConfig);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Writes the config atomically (a power cut never leaves half a file).</summary>
    public static void SaveConfig(string path, ServiceConfig config)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(config, ServiceJsonContext.Default.ServiceConfig));
        File.Move(tmp, path, overwrite: true);
    }

    /// <summary>
    /// Trims a server URL, adds <c>https://</c> when it has no scheme, checks it is an http(s) URL with a host, and
    /// ends it with exactly one <c>/</c>, which <see cref="System.Net.Http.HttpClient.BaseAddress"/> needs.
    /// </summary>
    public static string NormaliseServerUrl(string url)
    {
        var text = url.Trim();
        if (!text.Contains("://")) text = "https://" + text;
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || string.IsNullOrEmpty(uri.Host))
        {
            throw new ArgumentException("Server must be like https://screentime.example.com");
        }
        return uri.GetLeftPart(UriPartial.Authority) + "/";
    }
}

/// <summary>
/// The clock store on disk, one file next to state.db. A missing or broken file starts empty; every set writes the
/// whole file at once with both values, atomically.
/// </summary>
public sealed class FileClockStore : IClockStore
{
    private readonly string _path;
    private ClockAnchor? _anchor;
    private long _lastTrustedMs;

    public FileClockStore(string path)
    {
        _path = path;
        var loaded = LoadFile(path);
        _anchor = loaded.Anchor;
        _lastTrustedMs = loaded.LastTrustedMs;
    }

    public ClockAnchor? Anchor
    {
        get => _anchor;
        set { _anchor = value; SaveFile(); }
    }

    public long LastTrustedMs
    {
        get => _lastTrustedMs;
        set { _lastTrustedMs = value; SaveFile(); }
    }

    private static (ClockAnchor? Anchor, long LastTrustedMs) LoadFile(string path)
    {
        if (!File.Exists(path)) return (Anchor: null, LastTrustedMs: 0);
        try
        {
            var file = JsonSerializer.Deserialize(File.ReadAllText(path), ServiceJsonContext.Default.ClockFile);
            return (Anchor: file!.Anchor, LastTrustedMs: file.LastTrustedMs);
        }
        catch (JsonException)
        {
            return (Anchor: null, LastTrustedMs: 0);
        }
    }

    private void SaveFile()
    {
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(new ClockFile(_anchor, _lastTrustedMs), ServiceJsonContext.Default.ClockFile));
        File.Move(tmp, _path, overwrite: true);
    }
}
