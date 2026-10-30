using System.Text.Json;
using ScreenTime.Core.Api;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-047: shared test data for the sync tests. Copied verbatim from the card.</summary>
internal static class SyncTestData
{
    public const string Alex = "S-1-5-21-1-1001";

    /// <summary>A whole DeviceState as the server sends it. Every weekday has 120 min of Screens and 60 of Phone.</summary>
    public static string StateJson(
        string pool = "screens",
        string date = "2026-10-26",
        string grants = "",
        string segments = "",
        string serverTime = "2026-10-25T23:00:00.000Z")
    {
        var days = string.Join(",", Enumerable.Range(1, 7).Select(d =>
            $$"""{"weekday":{{d}},"screensMin":120,"phoneMin":60,"wake":"07:00","bedtime":"20:30"}"""));
        return $$"""
            {"serverTime":"{{serverTime}}","stateVersion":"v1",
             "device":{"id":"d1","name":"Alex's PC","form":"pc","pool":"{{pool}}","hasCellular":false},
             "kid":{"id":"k1","name":"Alex"},
             "family":{"timezone":"Australia/Sydney","emergencyNumber":"000","parentCodeSecret":"not-a-real-secret"},
             "parents":[],"contacts":[],"messagePresets":[],
             "schedule":{"version":1,"warn1Min":15,"warn2Min":5,"days":[{{days}}]},
             "today":{"date":"{{date}}","grants":[{{grants}}],"poolSegments":[{{segments}}]},
             "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"activeSos":null}
            """;
    }

    public static DeviceState State(string pool = "screens", string date = "2026-10-26", string grants = "", string segments = "") =>
        JsonSerializer.Deserialize(StateJson(pool, date, grants, segments), ApiJsonContext.Default.DeviceState)!;

    public static long Ms(string text) => DateTimeOffset.Parse(text, System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();

    /// <summary>A store on a new temp file; delete the folder with <see cref="Delete"/>.</summary>
    public static string NewDbPath() => Path.Combine(Path.GetTempPath(), "st-sync-" + Guid.NewGuid().ToString("N"), "state.db");

    public static void Delete(string dbPath)
    {
        var folder = Path.GetDirectoryName(dbPath)!;
        if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
    }

    /// <summary>A clock store in memory.</summary>
    public sealed class MemoryClockStore : ScreenTime.Core.Sync.IClockStore
    {
        public ScreenTime.Core.Sync.ClockAnchor? Anchor { get; set; }
        public long LastTrustedMs { get; set; }
    }
}
