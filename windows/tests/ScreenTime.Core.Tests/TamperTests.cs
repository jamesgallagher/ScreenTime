using Microsoft.Data.Sqlite;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Store;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-051: tamper detection on Windows (docs/SPEC.md §14) and the store's key-value table. Copied verbatim from the card.</summary>
public class TamperTests
{
    private static readonly long T = Ms("2026-10-27T05:00:00Z");

    [Fact]
    public void AClockMoreThanTwoMinutesOffIsReportedOnce()
    {
        var watch = new ClockWatch();
        Assert.Null(watch.Check(T + 600_000, T, anchored: false, "e0"));
        Assert.Null(watch.Check(T + 119_000, T, anchored: true, "e1"));
        var ahead = watch.Check(T + 300_000, T, anchored: true, "e2");
        Assert.NotNull(ahead);
        Assert.Equal("""{"id":"e2","kind":"tamper.clock","at":"2026-10-27T05:00:00.000Z","payload":{"offsetMin":5}}""", TamperEvents.Encode(ahead));
        Assert.Null(watch.Check(T + 301_000, T + 1_000, anchored: true, "e3"));
        Assert.Null(watch.Check(T + 2_000, T + 2_000, anchored: true, "e4"));
        var behind = watch.Check(T - 180_000, T + 3_000, anchored: true, "e5");
        Assert.NotNull(behind);
        Assert.Contains("\"offsetMin\":-3", TamperEvents.Encode(behind));
    }

    [Fact]
    public void ATimeZoneChangeIsReportedWithBothZones()
    {
        var watch = new TimeZoneWatch();
        Assert.Null(watch.Check("AUS Eastern Standard Time", T, "e1"));
        Assert.Null(watch.Check("AUS Eastern Standard Time", T + 1_000, "e2"));
        var changed = watch.Check("UTC", T + 2_000, "e3");
        Assert.NotNull(changed);
        Assert.Equal("""{"id":"e3","kind":"tamper.timezone","at":"2026-10-27T05:00:02.000Z","payload":{"from":"AUS Eastern Standard Time","to":"UTC"}}""", TamperEvents.Encode(changed));
        Assert.Null(watch.Check("UTC", T + 3_000, "e4"));
    }

    [Fact]
    public void ThreeTrayExitsInTenMinutesAreReported()
    {
        var watch = new TrayKillWatch();
        Assert.Null(watch.OnExit(T, "e1"));
        Assert.Null(watch.OnExit(T + 60_000, "e2"));
        var killed = watch.OnExit(T + 120_000, "e3");
        Assert.NotNull(killed);
        Assert.Equal("""{"id":"e3","kind":"tamper.tray_killed","at":"2026-10-27T05:02:00.000Z","payload":{"exits":3}}""", TamperEvents.Encode(killed));
        Assert.Null(watch.OnExit(T + 180_000, "e4"));
    }

    [Fact]
    public void ExitsSpreadOverMoreThanTenMinutesAreNot()
    {
        var watch = new TrayKillWatch();
        Assert.Null(watch.OnExit(T, "e1"));
        Assert.Null(watch.OnExit(T + 360_000, "e2"));
        Assert.Null(watch.OnExit(T + 720_000, "e3"));
        Assert.NotNull(watch.OnExit(T + 780_000, "e4"));
    }

    [Fact]
    public void AnEventReadsBackFromTheOutbox()
    {
        var e = new TimeZoneWatch();
        e.Check("A", T, "x");
        var changed = e.Check("B", T, "e9")!;
        var back = TamperEvents.Decode(TamperEvents.Encode(changed));
        Assert.NotNull(back);
        Assert.Equal("e9", back.Id);
        Assert.Equal(DeviceEventKind.TamperTimezone, back.Kind);
        Assert.Equal(TamperEvents.Encode(changed), TamperEvents.Encode(back));
        Assert.Null(TamperEvents.Decode("not json"));
    }

    [Fact]
    public void TheStoreKeepsValuesPerAccount()
    {
        var path = NewDbPath();
        try
        {
            using (var store = LocalStore.Open(path))
            {
                Assert.Null(store.GetValue(Alex, "parent-mode"));
                store.SetValue(Alex, "parent-mode", "one");
                store.SetValue(Alex, "parent-mode", "two");
                store.SetValue("S-1-5-21-1-1002", "parent-mode", "other");
                Assert.Equal("two", store.GetValue(Alex, "parent-mode"));
            }
            using (var again = LocalStore.Open(path))
            {
                Assert.Equal("two", again.GetValue(Alex, "parent-mode"));
                again.SetValue(Alex, "parent-mode", null);
                Assert.Null(again.GetValue(Alex, "parent-mode"));
                Assert.Equal("other", again.GetValue("S-1-5-21-1-1002", "parent-mode"));
            }
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public void AVersionOneStoreIsUpgradedInPlace()
    {
        var path = NewDbPath();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ConnectionString))
            {
                db.Open();
                using var cmd = db.CreateCommand();
                cmd.CommandText = """
                    CREATE TABLE devices (sid TEXT PRIMARY KEY, device_id TEXT NOT NULL, token BLOB NOT NULL, kid_name TEXT NOT NULL, timezone TEXT NOT NULL);
                    CREATE TABLE state (sid TEXT PRIMARY KEY, etag TEXT, json TEXT NOT NULL);
                    CREATE TABLE segments (id TEXT PRIMARY KEY, sid TEXT NOT NULL, started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER, last_seen_at_ms INTEGER NOT NULL, recorded_offline INTEGER NOT NULL, version INTEGER NOT NULL, sent_version INTEGER NOT NULL);
                    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
                    INSERT INTO devices VALUES ('S-1-5-21-1-1001', 'd1', x'01', 'Alex', 'Australia/Sydney');
                    PRAGMA user_version = 1;
                    """;
                cmd.ExecuteNonQuery();
            }
            using (var store = LocalStore.Open(path))
            {
                Assert.Equal("Alex", store.GetDevice(Alex)!.KidName);
                store.SetValue(Alex, "k", "v");
                Assert.Equal("v", store.GetValue(Alex, "k"));
            }
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public void ParentModeSurvivesARestartAsJson()
    {
        var local = new LocalParentMode(new CodeSession("c1", 15, T), T - 60_000, EndReported: false);
        Assert.Equal(local, ParentModeJson.Decode(ParentModeJson.Encode(local)));
        var forever = new LocalParentMode(new CodeSession("c2", null, T, T + 1_000));
        Assert.Equal(forever, ParentModeJson.Decode(ParentModeJson.Encode(forever)));
        Assert.Equal(new LocalParentMode(), ParentModeJson.Decode(null));
        Assert.Equal(new LocalParentMode(), ParentModeJson.Decode("not json"));
    }

    [Fact]
    public void TheCaughtLineIsJustItsType() =>
        Assert.Equal("""{"type":"caught"}""", PipeMessage.Encode(PipeMessage.Caught()));

    [Fact]
    public void ATrayExitCountsOnlyWhileTheSessionGoesOn()
    {
        Assert.True(TrayExit.Counts(sessionEnded: false, shuttingDown: false, sessionActive: true));
        // Conor's PC on 13 Nov 2026: shutting down closed the tray three times in seconds.
        Assert.False(TrayExit.Counts(sessionEnded: false, shuttingDown: true, sessionActive: true));
        // Signed out: the session is gone, or the service cancelled it at the sign-out.
        Assert.False(TrayExit.Counts(sessionEnded: false, shuttingDown: false, sessionActive: false));
        Assert.False(TrayExit.Counts(sessionEnded: true, shuttingDown: false, sessionActive: true));
    }
}
