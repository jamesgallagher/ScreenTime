using ScreenTime.Core.Setup;

namespace ScreenTime.Tray.Setup;

/// <summary>One local account people sign in with, as the setup window lists it.</summary>
/// <param name="UserName">The account name (what <c>enrol --user</c> takes), for example <c>sam</c>.</param>
/// <param name="FullName">The name Windows shows, or empty when the account has none.</param>
/// <param name="IsAdmin">In the Administrators group: a parent account, never limited (docs/SPEC.md §12.2).</param>
/// <param name="KidName">The kid this account is enrolled as on this PC, or null when it is not enrolled.</param>
public sealed record SetupAccount(string UserName, string FullName, bool IsAdmin, string? KidName);

/// <summary>What one enrolment gave: the kid's name when it worked, else a short sentence for the parent.</summary>
/// <param name="SignInAgain">The parent's sign-in ran out: the window asks them to sign in again.</param>
public sealed record EnrolAnswer(string? KidName, string? Error, bool SignInAgain = false)
{
    public static EnrolAnswer Enrolled(string kidName) => new(kidName, null);
    public static EnrolAnswer Failed(string error, bool signInAgain = false) => new(null, error, signInAgain);
}

/// <summary>
/// What the setup window (docs/SPEC.md §12.2: the server, then a parent signs in once and picks the kid for each
/// standard account) needs from the PC and the server. The demo has a fake one. Errors are short sentences, never
/// codes. Every call may take seconds: the window shows it is busy and never calls two at once. The parent's sign-in
/// lives only in the backend's memory, never on disk.
/// </summary>
public interface ISetupBackend
{
    /// <summary>The server this PC is set up with (its config.json), or null on a new install.</summary>
    string? SavedServer { get; }

    /// <summary>Whether Screen Time answers at <paramref name="address"/> (a hostname or URL as typed). Null when it does, else a sentence.</summary>
    Task<string?> CheckServerAsync(string address);

    /// <summary>The PC's local accounts, standard and administrator, without Windows' built-in ones, in name order.</summary>
    Task<IReadOnlyList<SetupAccount>> AccountsAsync();

    /// <summary>Emails a 6-digit sign-in code to the parent. Null when sent, else a sentence.</summary>
    Task<string?> RequestSignInCodeAsync(string address, string email);

    /// <summary>Signs the parent in with the emailed code (any earlier sign-in ends). Null when signed in, else a sentence.</summary>
    Task<string?> SignInAsync(string address, string email, string code);

    /// <summary>The family's kids, oldest first, for the signed-in parent.</summary>
    Task<SetupAnswer<IReadOnlyList<SetupKid>>> KidsAsync();

    /// <summary>Enrols <paramref name="userName"/> as the kid: makes a PC code for them as the signed-in parent, then enrols with it.</summary>
    Task<EnrolAnswer> ConnectAsync(string address, string userName, string kidId);

    /// <summary>Enrols <paramref name="userName"/> with a 6-digit code typed from the parent app (no sign-in: "Have a code instead?").</summary>
    Task<EnrolAnswer> EnrolAsync(string address, string userName, string code);

    /// <summary>Ends the parent's sign-in (best effort; it runs out by itself after 15 minutes).</summary>
    Task SignOutAsync();

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

    public Task<string?> RequestSignInCodeAsync(string address, string email) => Task.FromResult<string?>(NotYet);

    public Task<string?> SignInAsync(string address, string email, string code) => Task.FromResult<string?>(NotYet);

    public Task<SetupAnswer<IReadOnlyList<SetupKid>>> KidsAsync() => Task.FromResult(new SetupAnswer<IReadOnlyList<SetupKid>>(null, NotYet));

    public Task<EnrolAnswer> ConnectAsync(string address, string userName, string kidId) => Task.FromResult(EnrolAnswer.Failed(NotYet));

    public Task<EnrolAnswer> EnrolAsync(string address, string userName, string code) => Task.FromResult(EnrolAnswer.Failed(NotYet));

    public Task SignOutAsync() => Task.CompletedTask;

    public Task<string?> FinishAsync() => Task.FromResult<string?>(NotYet);
}
