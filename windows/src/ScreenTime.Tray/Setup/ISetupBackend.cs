namespace ScreenTime.Tray.Setup;

/// <summary>One local account people sign in with, as the setup window lists it.</summary>
/// <param name="UserName">The account name (what <c>enrol --user</c> takes), for example <c>sam</c>.</param>
/// <param name="FullName">The name Windows shows, or empty when the account has none.</param>
/// <param name="IsAdmin">In the Administrators group: a parent account, never limited (docs/SPEC.md §12.2).</param>
/// <param name="KidName">The kid this account is enrolled as on this PC, or null when it is not enrolled.</param>
public sealed record SetupAccount(string UserName, string FullName, bool IsAdmin, string? KidName);

/// <summary>What one enrolment gave: the kid's name when it worked, else a short sentence for the parent.</summary>
public sealed record EnrolAnswer(string? KidName, string? Error)
{
    public static EnrolAnswer Enrolled(string kidName) => new(kidName, null);
    public static EnrolAnswer Failed(string error) => new(null, error);
}

/// <summary>
/// What the setup window (docs/SPEC.md §12.2: "the installer asks for the server hostname, then lists local standard
/// accounts; for each kid account the parent enters an enrolment code") needs from the PC and the server. The demo
/// has a fake one; CARD-052b implements it. Errors are short sentences, never codes. Every call may take seconds: the
/// window shows it is busy and never calls two at once.
/// </summary>
public interface ISetupBackend
{
    /// <summary>The server this PC is set up with (its config.json), or null on a new install.</summary>
    string? SavedServer { get; }

    /// <summary>Whether Screen Time answers at <paramref name="address"/> (a hostname or URL as typed). Null when it does, else a sentence.</summary>
    Task<string?> CheckServerAsync(string address);

    /// <summary>The PC's local accounts, standard and administrator, without Windows' built-in ones, in name order.</summary>
    Task<IReadOnlyList<SetupAccount>> AccountsAsync();

    /// <summary>Enrols <paramref name="userName"/> with a 6-digit code from the parent app, on the server that was checked.</summary>
    Task<EnrolAnswer> EnrolAsync(string address, string userName, string code);

    /// <summary>Restarts the service so it uses the server and the accounts now. Null when it worked, else a sentence.</summary>
    Task<string?> FinishAsync();
}

/// <summary>Until CARD-052b: every call says it is not wired yet, so a real run cannot look like it worked.</summary>
internal sealed class NotWiredSetupBackend : ISetupBackend
{
    private const string NotYet = "Setup is not wired yet (CARD-052b).";

    public string? SavedServer => null;

    public Task<string?> CheckServerAsync(string address) => Task.FromResult<string?>(NotYet);

    public Task<IReadOnlyList<SetupAccount>> AccountsAsync() => Task.FromResult<IReadOnlyList<SetupAccount>>([]);

    public Task<EnrolAnswer> EnrolAsync(string address, string userName, string code) => Task.FromResult(EnrolAnswer.Failed(NotYet));

    public Task<string?> FinishAsync() => Task.FromResult<string?>(NotYet);
}
