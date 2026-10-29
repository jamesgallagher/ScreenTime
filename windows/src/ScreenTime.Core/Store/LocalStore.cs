using System.Text.Json;
using Microsoft.Data.Sqlite;
using ScreenTime.Core.Api;

namespace ScreenTime.Core.Store;

/// <summary>The enrolled device for one account, keyed by the account's Windows SID.</summary>
public sealed record StoredDevice(string Sid, string DeviceId, byte[] Token, string KidName, string Timezone);

/// <summary>A usage segment as stored locally.</summary>
public sealed record LocalSegment(string Id, string Sid, long StartedAtMs, long? EndedAtMs, long LastSeenAtMs, bool RecordedOffline);

/// <summary>A segment waiting to be uploaded, with the version the server has not yet seen.</summary>
public sealed record PendingSegment(LocalSegment Segment, int Version);

/// <summary>The last DeviceState from the server and its ETag.</summary>
public sealed record CachedState(string? ETag, DeviceState State);

/// <summary>A request waiting to be sent in the outbox.</summary>
public sealed record OutboxItem(long Id, string Sid, string Kind, string Body, long CreatedAtMs);

/// <summary>
/// The service's SQLite store, one file per PC, keyed by the account's Windows SID.
/// Synchronous; every public method takes a lock for its whole body.
/// </summary>
public sealed class LocalStore : IDisposable
{
    private const string SchemaSql = """
CREATE TABLE devices (
    sid        TEXT PRIMARY KEY,
    device_id  TEXT NOT NULL,
    token      BLOB NOT NULL,
    kid_name   TEXT NOT NULL,
    timezone   TEXT NOT NULL
);
CREATE TABLE state (
    sid   TEXT PRIMARY KEY,
    etag  TEXT,
    json  TEXT NOT NULL
);
CREATE TABLE segments (
    id               TEXT PRIMARY KEY,
    sid              TEXT NOT NULL,
    started_at_ms    INTEGER NOT NULL,
    ended_at_ms      INTEGER,
    last_seen_at_ms  INTEGER NOT NULL,
    recorded_offline INTEGER NOT NULL,
    version          INTEGER NOT NULL,
    sent_version     INTEGER NOT NULL
);
CREATE INDEX segments_sid_started ON segments (sid, started_at_ms);
CREATE TABLE outbox (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sid            TEXT NOT NULL,
    kind           TEXT NOT NULL,
    body           TEXT NOT NULL,
    created_at_ms  INTEGER NOT NULL
);
CREATE INDEX outbox_sid_id ON outbox (sid, id);
""";

    private readonly SqliteConnection _connection;
    private readonly object _lock = new();
    private readonly int _schemaVersion;

    private LocalStore(string path)
    {
        var builder = new SqliteConnectionStringBuilder { DataSource = path, Pooling = false };
        _connection = new SqliteConnection(builder.ConnectionString);
        _connection.Open();
        using (var cmd = _connection.CreateCommand())
        {
            cmd.CommandText = "PRAGMA journal_mode = WAL;";
            cmd.ExecuteNonQuery();
            cmd.CommandText = "PRAGMA foreign_keys = OFF;";
            cmd.ExecuteNonQuery();
        }
        var version = ReadUserVersion();
        if (version == 0)
        {
            using var tx = _connection.BeginTransaction();
            using (var cmd = _connection.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = SchemaSql;
                cmd.ExecuteNonQuery();
                cmd.CommandText = "PRAGMA user_version = 1;";
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
            version = 1;
        }
        else if (version != 1)
        {
            throw new InvalidOperationException($"state.db has schema version {version}; this app knows 1.");
        }
        _schemaVersion = version;
    }

    /// <summary>Opens the store at path, creating the folder and schema if they are missing.</summary>
    public static LocalStore Open(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        return new LocalStore(path);
    }

    /// <summary>The schema version read at open (1 after creating it).</summary>
    public int SchemaVersion => _schemaVersion;

    private int ReadUserVersion()
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        using var reader = cmd.ExecuteReader();
        if (reader.Read()) return (int)reader.GetInt64(0);
        return 0;
    }

    /// <summary>The enrolled device for an account, or null.</summary>
    public StoredDevice? GetDevice(string sid)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT device_id, token, kid_name, timezone FROM devices WHERE sid = $sid";
            cmd.Parameters.AddWithValue("$sid", sid);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            return new StoredDevice(sid, reader.GetString(0), (byte[])reader.GetValue(1), reader.GetString(2), reader.GetString(3));
        }
    }

    /// <summary>Stores the enrolled device for an account; a second put replaces the first.</summary>
    public void PutDevice(StoredDevice device)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = """
INSERT INTO devices (sid, device_id, token, kid_name, timezone)
VALUES ($sid, $device_id, $token, $kid_name, $timezone)
ON CONFLICT(sid) DO UPDATE SET device_id = $device_id, token = $token, kid_name = $kid_name, timezone = $timezone
""";
            cmd.Parameters.AddWithValue("$sid", device.Sid);
            cmd.Parameters.AddWithValue("$device_id", device.DeviceId);
            cmd.Parameters.AddWithValue("$token", device.Token);
            cmd.Parameters.AddWithValue("$kid_name", device.KidName);
            cmd.Parameters.AddWithValue("$timezone", device.Timezone);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>All enrolled devices, in sid order.</summary>
    public IReadOnlyList<StoredDevice> Devices()
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT sid, device_id, token, kid_name, timezone FROM devices ORDER BY sid";
            var list = new List<StoredDevice>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(new StoredDevice(reader.GetString(0), reader.GetString(1), (byte[])reader.GetValue(2), reader.GetString(3), reader.GetString(4)));
            }
            return list;
        }
    }

    /// <summary>Removes the account's rows from all four tables, in one transaction.</summary>
    public void RemoveDevice(string sid)
    {
        lock (_lock)
        {
            using var tx = _connection.BeginTransaction();
            using var cmd = _connection.CreateCommand();
            cmd.Transaction = tx;
            cmd.Parameters.AddWithValue("$sid", sid);
            cmd.CommandText = "DELETE FROM devices WHERE sid = $sid";
            cmd.ExecuteNonQuery();
            cmd.CommandText = "DELETE FROM state WHERE sid = $sid";
            cmd.ExecuteNonQuery();
            cmd.CommandText = "DELETE FROM segments WHERE sid = $sid";
            cmd.ExecuteNonQuery();
            cmd.CommandText = "DELETE FROM outbox WHERE sid = $sid";
            cmd.ExecuteNonQuery();
            tx.Commit();
        }
    }

    /// <summary>Stores the last DeviceState and its ETag for an account, replacing any earlier row.</summary>
    public void SaveState(string sid, CachedState state)
    {
        lock (_lock)
        {
            var json = JsonSerializer.Serialize(state.State, ApiJsonContext.Default.DeviceState);
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "INSERT INTO state (sid, etag, json) VALUES ($sid, $etag, $json) ON CONFLICT(sid) DO UPDATE SET etag = $etag, json = $json";
            cmd.Parameters.AddWithValue("$sid", sid);
            cmd.Parameters.AddWithValue("$etag", (object?)state.ETag ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$json", json);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>The last DeviceState for an account, or null when absent or the row is not valid JSON.</summary>
    public CachedState? LoadState(string sid)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT etag, json FROM state WHERE sid = $sid";
            cmd.Parameters.AddWithValue("$sid", sid);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            var etag = reader.IsDBNull(0) ? null : reader.GetString(0);
            var json = reader.GetString(1);
            DeviceState? state;
            try
            {
                state = JsonSerializer.Deserialize<DeviceState>(json, ApiJsonContext.Default.DeviceState);
            }
            catch (JsonException)
            {
                return null;
            }
            if (state is null) return null;
            return new CachedState(etag, state);
        }
    }

    /// <summary>The newest not-yet-ended segment for an account, or null.</summary>
    public LocalSegment? OpenSegment(string sid)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT id, sid, started_at_ms, ended_at_ms, last_seen_at_ms, recorded_offline FROM segments WHERE sid = $sid AND ended_at_ms IS NULL ORDER BY started_at_ms DESC LIMIT 1";
            cmd.Parameters.AddWithValue("$sid", sid);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            return new LocalSegment(reader.GetString(0), reader.GetString(1), reader.GetInt64(2), reader.IsDBNull(3) ? null : reader.GetInt64(3), reader.GetInt64(4), reader.GetInt64(5) != 0);
        }
    }

    /// <summary>Stores a segment with the next version, so it is uploaded again.</summary>
    public void PutSegment(LocalSegment segment)
    {
        lock (_lock)
        {
            using var tx = _connection.BeginTransaction();
            int version, sentVersion;
            using (var cmd = _connection.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "SELECT version, sent_version FROM segments WHERE id = $id";
                cmd.Parameters.AddWithValue("$id", segment.Id);
                using var reader = cmd.ExecuteReader();
                if (reader.Read())
                {
                    version = (int)reader.GetInt64(0);
                    sentVersion = (int)reader.GetInt64(1);
                }
                else
                {
                    version = 0;
                    sentVersion = 0;
                }
            }
            using (var cmd = _connection.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = """
INSERT INTO segments (id, sid, started_at_ms, ended_at_ms, last_seen_at_ms, recorded_offline, version, sent_version)
VALUES ($id, $sid, $started, $ended, $lastSeen, $offline, $version, $sentVersion)
ON CONFLICT(id) DO UPDATE SET
    sid = $sid,
    started_at_ms = $started,
    ended_at_ms = $ended,
    last_seen_at_ms = $lastSeen,
    recorded_offline = $offline,
    version = $version,
    sent_version = $sentVersion
""";
                cmd.Parameters.AddWithValue("$id", segment.Id);
                cmd.Parameters.AddWithValue("$sid", segment.Sid);
                cmd.Parameters.AddWithValue("$started", segment.StartedAtMs);
                cmd.Parameters.AddWithValue("$ended", (object?)segment.EndedAtMs ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$lastSeen", segment.LastSeenAtMs);
                cmd.Parameters.AddWithValue("$offline", segment.RecordedOffline ? 1 : 0);
                cmd.Parameters.AddWithValue("$version", version + 1);
                cmd.Parameters.AddWithValue("$sentVersion", sentVersion);
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
        }
    }

    /// <summary>Moves the segment's last-seen time without an upload (the version is unchanged).</summary>
    public void Touch(string id, long atMs)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "UPDATE segments SET last_seen_at_ms = $atMs WHERE id = $id";
            cmd.Parameters.AddWithValue("$atMs", atMs);
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>The account's segments still open, or ended at or after fromMs, oldest first.</summary>
    public IReadOnlyList<LocalSegment> SegmentsSince(string sid, long fromMs)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT id, sid, started_at_ms, ended_at_ms, last_seen_at_ms, recorded_offline FROM segments WHERE sid = $sid AND (ended_at_ms IS NULL OR ended_at_ms >= $fromMs) ORDER BY started_at_ms";
            cmd.Parameters.AddWithValue("$sid", sid);
            cmd.Parameters.AddWithValue("$fromMs", fromMs);
            var list = new List<LocalSegment>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(new LocalSegment(reader.GetString(0), reader.GetString(1), reader.GetInt64(2), reader.IsDBNull(3) ? null : reader.GetInt64(3), reader.GetInt64(4), reader.GetInt64(5) != 0));
            }
            return list;
        }
    }

    /// <summary>The account's segments waiting to be uploaded (version &gt; sentVersion), oldest first, at most limit.</summary>
    public IReadOnlyList<PendingSegment> PendingSegments(string sid, int limit)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT id, sid, started_at_ms, ended_at_ms, last_seen_at_ms, recorded_offline, version FROM segments WHERE sid = $sid AND version > sent_version ORDER BY started_at_ms LIMIT $limit";
            cmd.Parameters.AddWithValue("$sid", sid);
            cmd.Parameters.AddWithValue("$limit", limit);
            var list = new List<PendingSegment>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var segment = new LocalSegment(reader.GetString(0), reader.GetString(1), reader.GetInt64(2), reader.IsDBNull(3) ? null : reader.GetInt64(3), reader.GetInt64(4), reader.GetInt64(5) != 0);
                list.Add(new PendingSegment(segment, (int)reader.GetInt64(6)));
            }
            return list;
        }
    }

    /// <summary>Marks a segment's version as sent; an older answer never moves sentVersion back.</summary>
    public void MarkSent(string id, int version)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "UPDATE segments SET sent_version = $version WHERE id = $id AND sent_version < $version";
            cmd.Parameters.AddWithValue("$version", version);
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>Deletes, for all accounts, the ended segments whose version has been sent.</summary>
    public void Prune(long beforeMs)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "DELETE FROM segments WHERE ended_at_ms < $beforeMs AND version = sent_version";
            cmd.Parameters.AddWithValue("$beforeMs", beforeMs);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>Adds a request to the outbox and returns its new id.</summary>
    public long Enqueue(string sid, string kind, string body, long createdAtMs)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "INSERT INTO outbox (sid, kind, body, created_at_ms) VALUES ($sid, $kind, $body, $created)";
            cmd.Parameters.AddWithValue("$sid", sid);
            cmd.Parameters.AddWithValue("$kind", kind);
            cmd.Parameters.AddWithValue("$body", body);
            cmd.Parameters.AddWithValue("$created", createdAtMs);
            cmd.ExecuteNonQuery();
            using var idCmd = _connection.CreateCommand();
            idCmd.CommandText = "SELECT last_insert_rowid()";
            return (long)idCmd.ExecuteScalar()!;
        }
    }

    /// <summary>The account's outbox rows in id order, at most limit, without removing them.</summary>
    public IReadOnlyList<OutboxItem> PeekOutbox(string sid, int limit)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT id, sid, kind, body, created_at_ms FROM outbox WHERE sid = $sid ORDER BY id LIMIT $limit";
            cmd.Parameters.AddWithValue("$sid", sid);
            cmd.Parameters.AddWithValue("$limit", limit);
            var list = new List<OutboxItem>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(new OutboxItem(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt64(4)));
            }
            return list;
        }
    }

    /// <summary>Removes one outbox row.</summary>
    public void RemoveOutbox(long id)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "DELETE FROM outbox WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>Closes the connection, releasing the file.</summary>
    public void Dispose()
    {
        lock (_lock)
        {
            _connection.Dispose();
        }
    }
}
