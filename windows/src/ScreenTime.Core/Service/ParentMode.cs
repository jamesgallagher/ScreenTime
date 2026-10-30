using System.Globalization;
using System.Security.Cryptography;
using ScreenTime.Core.Api;
using ScreenTime.Core.Tray;

namespace ScreenTime.Core.Service;

/// <summary>
/// Parent mode on Windows (docs/SPEC.md §12.3): the parent code, whether parent mode is on from the snapshot or
/// from what this PC did itself, and the snapshot with parent mode as it is now. The same rules as Android's
/// <c>parentmode/ParentMode.kt</c>.
/// </summary>
public static class Totp
{
    /// <summary>RFC 4648 base32 (A–Z, 2–7), any case, = skipped; null when any other character appears.</summary>
    public static byte[]? Base32Decode(string text)
    {
        var outBytes = new List<byte>();
        var buffer = 0;
        var bits = 0;
        foreach (var ch in text)
        {
            var c = char.ToUpperInvariant(ch);
            int value;
            if (c is >= 'A' and <= 'Z') value = c - 'A';
            else if (c is >= '2' and <= '7') value = c - '2' + 26;
            else if (c == '=') continue;
            else return null;
            buffer = (buffer << 5 | value) & 0xFFFF;
            bits += 5;
            if (bits >= 8)
            {
                bits -= 8;
                outBytes.Add((byte)((buffer >> bits) & 0xFF));
            }
        }
        return outBytes.ToArray();
    }

    /// <summary>The 6-digit TOTP code (RFC 6238, SHA-1, 30 s steps) for the step that holds <paramref name="timeMs"/>.</summary>
    public static string Code(byte[] key, long timeMs)
    {
        var counter = new byte[8];
        var step = timeMs / 30_000;
        for (var i = 7; i >= 0; i--)
        {
            counter[i] = (byte)(step & 0xFF);
            step >>= 8;
        }
        var hash = HMACSHA1.HashData(key, counter);
        var at = hash[^1] & 0x0F;
        var number = ((hash[at] & 0x7F) << 24) | (hash[at + 1] << 16) | (hash[at + 2] << 8) | hash[at + 3];
        return (number % 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
    }

    /// <summary>Whether <paramref name="code"/> is the parent code now: good one step either side.</summary>
    public static bool Ok(string secret, string code, long nowMs)
    {
        var key = Base32Decode(secret);
        if (key is null || key.Length == 0) return false;
        if (code.Length != 6) return false;
        foreach (var ch in code)
        {
            if (ch is not (>= '0' and <= '9')) return false;
        }
        for (var i = -1; i <= 1; i++)
        {
            if (code == Code(key, nowMs + i * 30_000L)) return true;
        }
        return false;
    }
}

/// <summary>Parent mode started on this PC with the parent code; <c>ReportedAtMs</c> is set once the server has it.</summary>
public sealed record CodeSession(string Id, int? DurationMin, long StartedAtMs, long? ReportedAtMs = null)
{
    /// <summary>StartedAtMs + DurationMin minutes; null for "Until I end it".</summary>
    public long? EndsAtMs => DurationMin is null ? null : StartedAtMs + DurationMin * 60_000L;
}

/// <summary>What this PC did that the server may not know yet; <c>EndedAtMs</c> is when End now was last pressed here.</summary>
public sealed record LocalParentMode(CodeSession? Code = null, long? EndedAtMs = null, bool EndReported = true)
{
    /// <summary>(Code is not null and Code.ReportedAtMs is null) or !EndReported.</summary>
    public bool Pending => (Code is not null && Code.ReportedAtMs is null) || !EndReported;
}

/// <summary>Parent mode is on: <c>EndsAtMs</c> (null for "Until I end it") and <c>ByName</c> (null for a code).</summary>
public sealed record ParentModeOn(long? EndsAtMs, string? ByName);

/// <summary>A parent's yes or no from the live channel: active, endsAt, byName and requestId.</summary>
public sealed record ParentModeAnswer(bool Active, string? EndsAt, string? ByName, string? RequestId);

/// <summary>Whether parent mode is on, and the snapshot with parent mode as it is now (docs/SPEC.md §12.3).</summary>
public static class ParentModes
{
    /// <summary>Whether parent mode is on at <paramref name="nowMs"/>, from the snapshot or from this PC.</summary>
    public static ParentModeOn? Now(DeviceStateParentMode server, long serverTimeMs, LocalParentMode local, long nowMs)
    {
        var ended = local.EndedAtMs;
        var code = local.Code;
        if (code is not null && (ended is null || ended < code.StartedAtMs))
        {
            var notInSnapshot = code.ReportedAtMs is null || serverTimeMs < code.ReportedAtMs;
            if (notInSnapshot && (code.EndsAtMs is null || nowMs < code.EndsAtMs))
            {
                return new ParentModeOn(code.EndsAtMs, null);
            }
        }
        if (!server.Active || (ended is not null && serverTimeMs <= ended))
        {
            return null;
        }
        long? serverEnds = server.EndsAt is null ? null : DateTimeOffset.Parse(server.EndsAt, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();
        return serverEnds is null || nowMs < serverEnds ? new ParentModeOn(serverEnds, server.ByName) : null;
    }

    /// <summary>The snapshot with <c>ParentMode</c> as it is now, so <c>LockKeeper</c> and <c>TrayStatusBuilder</c> need no change.</summary>
    public static DeviceState Effective(DeviceState state, LocalParentMode local, long nowMs)
    {
        var serverTimeMs = DateTimeOffset.Parse(state.ServerTime, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();
        var on = Now(state.ParentMode, serverTimeMs, local, nowMs);
        var parentMode = on is null
            ? new DeviceStateParentMode(false, null, null)
            : new DeviceStateParentMode(true,
                on.EndsAtMs is null ? null : DateTimeOffset.FromUnixTimeMilliseconds(on.EndsAtMs.Value).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
                on.ByName);
        return state with { ParentMode = parentMode };
    }

    /// <summary>"Dad said no."; "Mum or Dad said no." when no parent said it.</summary>
    public static string NoText(string? byName, IReadOnlyList<string> parentNames) =>
        byName is null ? TrayText.Parents(parentNames, "or") + " said no." : $"{byName} said no.";
}
