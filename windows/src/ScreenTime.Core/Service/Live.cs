using System.Text.Json;

namespace ScreenTime.Core.Service;

/// <summary>
/// The live channel's rules (docs/SPEC.md §8.3, §10): the socket address from the server address, the reconnect
/// backoff, and which frames ask for a sync. The same rules as the Android kid app's <c>live/Live.kt</c>.
/// </summary>
public static class Live
{
    /// <summary>The ping the client sends every 30 s (SPEC §10).</summary>
    public const string Ping = """{"type":"ping"}""";

    /// <summary>The WebSocket address from the server address: https becomes wss, http becomes ws; anything else throws.</summary>
    public static string Url(string serverUrl)
    {
        var text = serverUrl.TrimEnd('/');
        string scheme;
        string host;
        if (text.StartsWith("https://", StringComparison.Ordinal))
        {
            scheme = "wss://";
            host = text[8..];
        }
        else if (text.StartsWith("http://", StringComparison.Ordinal))
        {
            scheme = "ws://";
            host = text[7..];
        }
        else
        {
            throw new ArgumentException("Server must be http or https");
        }
        return scheme + host + "/v1/device/ws";
    }

    /// <summary>The reconnect wait: 1 s doubling to 60 s, times a jitter between 0.8 and 1.2.</summary>
    public static long BackoffMs(int attempt, double jitter)
    {
        var baseMs = Math.Min(1_000L << Math.Clamp(attempt, 0, 6), 60_000L);
        return (long)(baseMs * jitter);
    }

    /// <summary>
    /// Whether a received frame asks for a sync: every envelope but <c>pong</c>. Invalid JSON or anything that is not
    /// an object with a string <c>type</c> gives false.
    /// </summary>
    public static bool AsksForSync(string frame)
    {
        try
        {
            using var doc = JsonDocument.Parse(frame);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;
            if (root.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String)
            {
                return type.GetString() != "pong";
            }
            return false;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>
    /// The parent's answer in a <c>request_resolved</c> frame; null when the frame is not one (invalid JSON, another
    /// type, or a missing <c>data</c> field).
    /// </summary>
    public static RequestAnswer? Answer(string frame)
    {
        try
        {
            using var doc = JsonDocument.Parse(frame);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "request_resolved") return null;
            if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) return null;
            if (!data.TryGetProperty("approved", out var approved) || approved.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null;
            if (!data.TryGetProperty("minutes", out var minutes) || minutes.ValueKind != JsonValueKind.Number) return null;
            if (!data.TryGetProperty("byName", out var byName) || byName.ValueKind != JsonValueKind.String) return null;
            return new RequestAnswer(approved.ValueKind == JsonValueKind.True, minutes.GetInt32(), byName.GetString()!);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The id of the grant a "yes" in a <c>request_resolved</c> frame added; null for anything else.</summary>
    public static string? AnswerGrantId(string frame)
    {
        try
        {
            using var doc = JsonDocument.Parse(frame);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "request_resolved") return null;
            if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) return null;
            if (!data.TryGetProperty("grant", out var grant) || grant.ValueKind != JsonValueKind.Object) return null;
            if (!grant.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String) return null;
            return id.GetString();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// The parent's answer in a <c>parent_mode</c> frame; null when the frame is not one (invalid JSON, another
    /// type, or a <c>data</c> whose <c>active</c> is not true or false).
    /// </summary>
    public static ParentModeAnswer? ParentModeAnswer(string frame)
    {
        try
        {
            using var doc = JsonDocument.Parse(frame);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "parent_mode") return null;
            if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) return null;
            if (!data.TryGetProperty("active", out var active) || active.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null;
            return new ParentModeAnswer(active.ValueKind == JsonValueKind.True, Str(data, "endsAt"), Str(data, "byName"), Str(data, "requestId"));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Str(JsonElement data, string name) =>
        data.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
