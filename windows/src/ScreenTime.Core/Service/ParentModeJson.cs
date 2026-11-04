using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScreenTime.Core.Service;

/// <summary>Parent mode as JSON for the store's key-value table (docs/SPEC.md §12.3): kept across a service restart.</summary>
public static class ParentModeJson
{
    /// <summary>Parent mode as one JSON string.</summary>
    public static string Encode(LocalParentMode local) => JsonSerializer.Serialize(local, ParentModeJsonContext.Default.LocalParentMode);

    /// <summary>Parent mode back from its JSON; nothing when it is null, invalid JSON or a JSON null.</summary>
    public static LocalParentMode Decode(string? json)
    {
        if (json is null) return new LocalParentMode();
        try
        {
            return JsonSerializer.Deserialize(json, ParentModeJsonContext.Default.LocalParentMode) ?? new LocalParentMode();
        }
        catch (JsonException)
        {
            return new LocalParentMode();
        }
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(LocalParentMode))]
internal sealed partial class ParentModeJsonContext : JsonSerializerContext;
