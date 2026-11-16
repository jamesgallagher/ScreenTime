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
public sealed record PendingUpdate(int VersionCode, string VersionName, long StartedAtMs, int Failures = 0);

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

    /// <summary>
    /// Whether a version is offered again after being given up: only when a higher one is.
    /// </summary>
    public static bool Retry(int versionCode, int offeredVersionCode) => offeredVersionCode > versionCode;
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
internal sealed partial class PendingUpdateJsonContext : JsonSerializerContext;

/// <summary>The next action the update loop should take, given the stored state and the current facts.</summary>
public enum UpdateAction
{
    /// <summary>Do nothing this tick.</summary>
    Nothing,
    /// <summary>Check the server for a newer version (the first, or 6 hours after the last).</summary>
    Check,
    /// <summary>Download and verify the MSI for the offer.</summary>
    Download,
    /// <summary>Install the verified MSI.</summary>
    Install,
    /// <summary>The pending update succeeded: delete the file and task, clear the store.</summary>
    RecordSuccess,
    /// <summary>The pending update failed: count the failure, clear the store.</summary>
    RecordFailure,
}

/// <summary>The facts the update loop needs to decide the next action.</summary>
public sealed record UpdateState(
    PendingUpdate? pending,
    long? lastCheckMs,
    long? lastVerifiedAtMs,
    int failuresForVersion,
    Offer? bestOffer,
    bool anyoneUsing,
    bool anytime,
    int runningVersionCode,
    long nowMs);

/// <summary>
/// The update loop's decision (docs/SPEC.md §12.2): from the stored state and the current facts, what to do next.
/// The service feeds it the facts and does what it says. No Windows calls here.
/// </summary>
public static class UpdateDecision
{
    public static UpdateAction Decide(UpdateState state)
    {
        var pending = state.pending;
        var now = state.nowMs;

        // A stored pending update: work out what it says now.
        if (pending is { } p)
        {
            var (succeeded, failed) = UpdateAttempt.Result(p, state.runningVersionCode, now);
            if (succeeded) return UpdateAction.RecordSuccess;
            if (failed) return UpdateAction.RecordFailure;
            // Still going: do nothing until the service restarts (the MSI stops it).
            return UpdateAction.Nothing;
        }

        // A check is due: the first, or 6 hours after the last.
        if (!UpdateCheck.IsDue(state.lastCheckMs, now)) return UpdateAction.Nothing;

        // No offer: do nothing (the offer comes from the server answer, checked at the same tick).
        if (state.bestOffer is null) return UpdateAction.Nothing;

        // After 3 failed attempts for one versionCode, stop trying it until a higher one is offered.
        if (UpdateAttempt.GiveUp(state.failuresForVersion)) return UpdateAction.Nothing;

        // The offer is higher than the running version (checked by Best). Download and verify.
        return UpdateAction.Download;
    }

    /// <summary>
    /// After a download: whether the install is due now. The service calls this after a successful download.
    /// </summary>
    public static UpdateAction AfterDownload(bool anyoneUsing, long verifiedAtMs, long nowMs, bool anytime)
    {
        if (UpdateInstall.IsDue(anyoneUsing, verifiedAtMs, nowMs, anytime)) return UpdateAction.Install;
        return UpdateAction.Nothing;
    }
}
