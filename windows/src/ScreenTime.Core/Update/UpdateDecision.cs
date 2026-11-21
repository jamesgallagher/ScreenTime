using System.Text.Json;
using System.Text.Json.Serialization;
using ScreenTime.Core.Api;

namespace ScreenTime.Core.Update;

/// <summary>
/// The Windows self-update (docs/SPEC.md §12.2), decided here and carried out by the service. The service
/// feeds it facts (the offers, the sessions, the times) and does what it decides. Every rule is testable with
/// fake times and offers: no Windows calls here.
/// </summary>

/// <summary>One account's answer to "is there a newer version?": null when there is none.</summary>
public sealed record Offer(int VersionCode, string VersionName, string Sha256, int SizeBytes);

/// <summary>What this PC knows about an update it is working through, kept in the store's key-value table.</summary>
public sealed record PendingUpdate(int VersionCode, string VersionName, long StartedAtMs);

/// <summary>The state of a verified download of <see cref="Offer"/>: where the file is and when it was verified.</summary>
public sealed record VerifiedDownload(string Path, long VerifiedAtMs);

/// <summary>Whether an offer is usable at all: higher than the running version.</summary>
public static class UpdateOffer
{
    /// <summary>True when the offer is higher than the running version.</summary>
    public static bool IsNewer(Offer offer, int runningVersionCode) => offer.VersionCode > runningVersionCode;

    /// <summary>The highest offer worth having across several accounts; null when there is none.</summary>
    public static Offer? Best(IReadOnlyList<Offer?> offers, int runningVersionCode)
    {
        Offer? best = null;
        foreach (var o in offers)
        {
            if (o is null || !IsNewer(o, runningVersionCode)) continue;
            if (best is null || o.VersionCode > best.VersionCode) best = o;
        }
        return best;
    }
}

/// <summary>When a check is due: the first since the service started, then every <see cref="EveryMs"/> (docs/SPEC.md §12.2).</summary>
public static class UpdateCheck
{
    /// <summary>How often to check: every 6 hours.</summary>
    public const long EveryMs = 6 * 60 * 60 * 1000;

    /// <summary>True when a check is due now: the first, or <see cref="EveryMs"/> after the last.</summary>
    public static bool IsDue(long? lastCheckMs, long nowMs) => lastCheckMs is null || nowMs - lastCheckMs >= EveryMs;

    /// <summary>
    /// A parent's manual check never moves the 6-hour timer: it returns the last-check time unchanged so the
    /// automatic check still happens at its original time.
    /// </summary>
    public static long? AfterManualCheck(long? lastCheckMs) => lastCheckMs;
}

/// <summary>Where a downloaded MSI goes: the data folder, under <c>updates</c>, by version name.</summary>
public static class UpdateFile
{
    /// <summary>The file name for a version: <c>ScreenTime-&lt;versionName&gt;.msi</c>.</summary>
    public static string Name(string versionName) => $"ScreenTime-{versionName}.msi";

    /// <summary>The full path for a version in the data folder.</summary>
    public static string Path(string dataFolder, string versionName) =>
        System.IO.Path.Combine(dataFolder, "updates", Name(versionName));

    /// <summary>The <c>.part</c> file a download goes into first, before it is checked.</summary>
    public static string PartPath(string dataFolder, string versionName) =>
        System.IO.Path.Combine(dataFolder, "updates", Name(versionName) + ".part");
}

/// <summary>Whether a downloaded file is the one the offer promised: its size and SHA-256 (lower-case hex).</summary>
public static class UpdateVerify
{
    /// <summary>True when <paramref name="sizeBytes"/> and <paramref name="sha256"/> are what the offer said.</summary>
    public static bool Matches(long sizeBytes, string sha256, long offerSizeBytes, string offerSha256) =>
        sizeBytes == offerSizeBytes && sha256 == offerSha256;
}

/// <summary>When an update is installed: nobody is using the PC, or a day after the download was verified.</summary>
public static class UpdateInstall
{
    /// <summary>How long after a verified download to install anyway, even with someone using the PC: 24 hours.</summary>
    public const long AfterMs = 24 * 60 * 60 * 1000;

    /// <summary>
    /// True when the install is due now: nobody is using the PC (no session unlocked or in parent mode), or
    /// <see cref="AfterMs"/> after the download was verified, or <paramref name="anytime"/> (--update-anytime).
    /// </summary>
    public static bool IsDue(bool anyoneUsing, long verifiedAtMs, long nowMs, bool anytime)
    {
        if (anytime) return true;
        if (!anyoneUsing) return true;
        return nowMs - verifiedAtMs >= AfterMs;
    }
}

/// <summary>What an attempt at an update was, so a restart can work out what happened (docs/SPEC.md §12.2).</summary>
public static class UpdateAttempt
{
    /// <summary>How long after the installer started to wait before counting the attempt failed: 10 minutes.</summary>
    public const long FailedAfterMs = 10 * 60 * 1000;

    /// <summary>How many failed attempts for one version before it is not tried again: 3.</summary>
    public const int FailuresBeforeGivingUp = 3;

    /// <summary>
    /// What the stored pending update says now: succeeded (the running version is the target or higher), failed
    /// (it is lower), or still going (the service is still running within <see cref="FailedAfterMs"/>).
    /// </summary>
    public static (bool Succeeded, bool Failed) Result(PendingUpdate pending, int runningVersionCode, long nowMs)
    {
        if (runningVersionCode >= pending.VersionCode) return (true, false);
        if (nowMs - pending.StartedAtMs >= FailedAfterMs) return (false, true);
        return (false, false);
    }

    /// <summary>True when a version is not tried again: it failed <see cref="FailuresBeforeGivingUp"/> times.</summary>
    public static bool GiveUp(int failuresForVersion) => failuresForVersion >= FailuresBeforeGivingUp;
}

/// <summary>The pending update as JSON for the store's key-value table: kept across a service restart.</summary>
public static class PendingUpdateJson
{
    /// <summary>The pending update as one JSON string.</summary>
    public static string Encode(PendingUpdate pending) => JsonSerializer.Serialize(pending, PendingUpdateJsonContext.Default.PendingUpdate);

    /// <summary>The pending update back from its JSON; nothing when it is null, invalid JSON or a JSON null.</summary>
    public static PendingUpdate? Decode(string? json)
    {
        if (json is null) return null;
        try
        {
            return JsonSerializer.Deserialize(json, PendingUpdateJsonContext.Default.PendingUpdate);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(PendingUpdate))]
[JsonSerializable(typeof(UpdateFailures))]
internal sealed partial class PendingUpdateJsonContext : JsonSerializerContext;

/// <summary>
/// The failed attempts for one version, kept in the store's key-value table so a restart of the service (which every
/// attempt causes) does not forget them. Only the latest version tried is remembered: a higher one starts again at 0.
/// </summary>
public sealed record UpdateFailures(int VersionCode, int Count)
{
    /// <summary>The failures stored for <paramref name="versionCode"/>: 0 when the stored ones are for another version.</summary>
    public static int For(UpdateFailures? stored, int versionCode) => stored is { } s && s.VersionCode == versionCode ? s.Count : 0;

    /// <summary>The stored failures after one more failed attempt at <paramref name="versionCode"/>.</summary>
    public static UpdateFailures After(UpdateFailures? stored, int versionCode) => new(versionCode, For(stored, versionCode) + 1);

    public static string Encode(UpdateFailures failures) => JsonSerializer.Serialize(failures, PendingUpdateJsonContext.Default.UpdateFailures);

    /// <summary>The stored failures back from JSON; null when there are none or the JSON is not valid.</summary>
    public static UpdateFailures? Decode(string? json)
    {
        if (json is null) return null;
        try
        {
            return JsonSerializer.Deserialize(json, PendingUpdateJsonContext.Default.UpdateFailures);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>The next thing the update loop does.</summary>
public enum UpdateAction
{
    /// <summary>Nothing this tick.</summary>
    Nothing,
    /// <summary>Ask the server, for every enrolled account, whether there is a newer version.</summary>
    Check,
    /// <summary>Download and verify the MSI of the best offer.</summary>
    Download,
    /// <summary>Close the trays and start the installer.</summary>
    Install,
    /// <summary>The pending update succeeded: delete the file and the task, clear it.</summary>
    RecordSuccess,
    /// <summary>The pending update failed: count it, clear it, let the trays start again.</summary>
    RecordFailure,
}

/// <summary>
/// What the update loop knows on one tick. <c>VerifiedVersionCode</c> and <c>VerifiedAtMs</c> describe a downloaded
/// MSI that matched its offer (null when there is none); <c>Failures</c> are the stored failed attempts at the best
/// offer's version.
/// </summary>
public sealed record UpdateState(
    PendingUpdate? Pending,
    long? LastCheckMs,
    Offer? BestOffer,
    int? VerifiedVersionCode,
    long? VerifiedAtMs,
    int Failures,
    bool AnyoneUsing,
    bool Anytime,
    int RunningVersionCode,
    long NowMs,
    bool Asked = false);

/// <summary>
/// The update loop's decision (docs/SPEC.md §12.2): from what it knows, the one next thing to do. The service runs it
/// every tick and again after each step, so a check, a download and an install can follow each other at once.
/// </summary>
public static class UpdateDecision
{
    public static UpdateAction Decide(UpdateState state)
    {
        // An install was started: wait for its result, which the next service usually sees at start.
        if (state.Pending is { } pending)
        {
            var (succeeded, failed) = UpdateAttempt.Result(pending, state.RunningVersionCode, state.NowMs);
            if (succeeded) return UpdateAction.RecordSuccess;
            return failed ? UpdateAction.RecordFailure : UpdateAction.Nothing;
        }
        // Ask the server at the first tick after start, then every 6 hours.
        if (UpdateCheck.IsDue(state.LastCheckMs, state.NowMs)) return UpdateAction.Check;
        // A parent's manual "Update now" installs straight away, even while someone is using the PC
        // and even after three failures. It still needs the file to be downloaded and verified first.
        if (state.Asked)
        {
            if (state.BestOffer is not { } askedOffer) return UpdateAction.Nothing;
            if (state.VerifiedVersionCode != askedOffer.VersionCode || state.VerifiedAtMs is null) return UpdateAction.Download;
            return UpdateAction.Install;
        }
        if (state.BestOffer is not { } offer) return UpdateAction.Nothing;
        if (UpdateAttempt.GiveUp(state.Failures)) return UpdateAction.Nothing;
        if (state.VerifiedVersionCode != offer.VersionCode || state.VerifiedAtMs is not { } verifiedAt) return UpdateAction.Download;
        return UpdateInstall.IsDue(state.AnyoneUsing, verifiedAt, state.NowMs, state.Anytime) ? UpdateAction.Install : UpdateAction.Nothing;
    }
}
