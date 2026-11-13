using System.Text.Json;
using System.Text.Json.Serialization;
using ScreenTime.Core.Api;

namespace ScreenTime.Core.Service;

/// <summary>The wall clock against the trusted time (docs/SPEC.md §14): an attempt when it is more than two minutes off.</summary>
public sealed class ClockWatch
{
    private bool _off;

    /// <summary>Checked against the trusted time: an attempt when it is off now and was not at the last anchored check.</summary>
    public DeviceEventIn? Check(long wallMs, long trustedMs, bool anchored, string id)
    {
        if (!anchored) return null;
        var off = Math.Abs(wallMs - trustedMs) > 120_000;
        if (off && !_off)
        {
            _off = true;
            var n = (long)Math.Round((wallMs - trustedMs) / 60_000.0, MidpointRounding.AwayFromZero);
            return TamperEvents.Event(id, DeviceEventKind.TamperClock, trustedMs, JsonSerializer.Serialize(new Dictionary<string, long> { ["offsetMin"] = n }, TamperJsonContext.Default.DictionaryStringInt64));
        }
        _off = off;
        return null;
    }
}

/// <summary>The PC's time zone (docs/SPEC.md §14): an attempt when its id changes.</summary>
public sealed class TimeZoneWatch
{
    private string? _last;

    /// <summary>Checked against the last id: an attempt when it differs, with both zones in the payload.</summary>
    public DeviceEventIn? Check(string zoneId, long nowMs, string id)
    {
        if (_last is null || _last == zoneId)
        {
            _last = zoneId;
            return null;
        }
        var from = _last;
        _last = zoneId;
        var payload = JsonSerializer.Serialize(new Dictionary<string, string> { ["from"] = from, ["to"] = zoneId }, TamperJsonContext.Default.DictionaryStringString);
        return TamperEvents.Event(id, DeviceEventKind.TamperTimezone, nowMs, payload);
    }
}

/// <summary>The tray's exits (docs/SPEC.md §14): an attempt when it exits three times within ten minutes.</summary>
public sealed class TrayKillWatch
{
    private readonly List<long> _exits = new();

    /// <summary>A tray exit: an attempt when there are three within ten minutes, then the list is cleared.</summary>
    public DeviceEventIn? OnExit(long nowMs, string id)
    {
        while (_exits.Count > 0 && nowMs - _exits[0] > 600_000) _exits.RemoveAt(0);
        _exits.Add(nowMs);
        if (_exits.Count >= 3)
        {
            _exits.Clear();
            return TamperEvents.Event(id, DeviceEventKind.TamperTrayKilled, nowMs, JsonSerializer.Serialize(new Dictionary<string, long> { ["exits"] = 3 }, TamperJsonContext.Default.DictionaryStringInt64));
        }
        return null;
    }
}

/// <summary>
/// Whether a tray exit counts toward <see cref="TrayKillWatch"/> (docs/SPEC.md §14). Windows closes the tray when the PC
/// shuts down or the account signs out, before it tells the service, so an exit is judged <see cref="DelayMs"/> later:
/// it counts only if the session is still going then, still in use, and the PC is not shutting down. On Conor's PC every
/// shutdown made three exits within seconds and a false "tray app was closed" (13 Nov 2026).
/// </summary>
public static class TrayExit
{
    /// <summary>How long after an exit it is judged.</summary>
    public const int DelayMs = 30_000;

    /// <summary>True when the exit was someone closing the tray, not the session or the PC ending.</summary>
    public static bool Counts(bool sessionEnded, bool shuttingDown, bool sessionActive) => !sessionEnded && !shuttingDown && sessionActive;
}

/// <summary>A tamper event as the API writes it, and the JSON lines for the outbox.</summary>
public static class TamperEvents
{
    /// <summary>Builds the event: the kind as its API name, the instant in UTC, and the payload from a JSON string.</summary>
    public static DeviceEventIn Event(string id, DeviceEventKind kind, long atMs, string payloadJson) =>
        new(id, kind, Iso(atMs), JsonDocument.Parse(payloadJson).RootElement.Clone());

    /// <summary>The event as one JSON line.</summary>
    public static string Encode(DeviceEventIn e) => JsonSerializer.Serialize(e, ApiJsonContext.Default.DeviceEventIn);

    /// <summary>The event back from its JSON line; null when it is not valid JSON.</summary>
    public static DeviceEventIn? Decode(string json)
    {
        try
        {
            return JsonSerializer.Deserialize(json, ApiJsonContext.Default.DeviceEventIn);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string Iso(long ms) =>
        DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
}

[JsonSerializable(typeof(Dictionary<string, string>))]
[JsonSerializable(typeof(Dictionary<string, long>))]
internal sealed partial class TamperJsonContext : JsonSerializerContext;
