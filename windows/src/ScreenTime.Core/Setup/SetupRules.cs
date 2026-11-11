using ScreenTime.Core.Service;

namespace ScreenTime.Core.Setup;

/// <summary>One local account as Windows lists it (the setup window's raw input).</summary>
public sealed record LocalAccount(string UserName, string FullName, string Sid, bool Enabled, bool IsAdmin);

/// <summary>One account the setup window shows: <see cref="KidName"/> is the kid it is enrolled as on this PC, or null.</summary>
public sealed record PickedAccount(string UserName, string FullName, bool IsAdmin, string? KidName);

/// <summary>What <c>ScreenTime.Service.exe enrol</c> printed: the kid's name, or the server's HTTP status (null: no answer).</summary>
public sealed record EnrolOutcome(string? KidName, int? Status);

/// <summary>
/// The rules behind the setup window (docs/SPEC.md §12.2, §11.3): which accounts it lists, what the service's
/// <c>enrol</c> command printed, and the short sentences the parent sees. Errors are sentences, never codes.
/// </summary>
public static class SetupRules
{
    public const string NotAnAddress = "That doesn't look like a server address. Type it like screentime.example.com.";
    public const string NoAnswer = "Can't reach Screen Time at that address. Check it, and that this PC is online.";
    public const string NotScreenTime = "Something answered at that address, but it isn't Screen Time. Check the address.";
    public const string WrongCode = "That code is wrong or has expired. Make a new one in the parent app.";
    public const string PhoneCode = "That code is for a phone or tablet. In the parent app, choose PC.";
    public const string TooManyTries = "Too many tries. Wait 15 minutes, then try again.";
    public const string BadCode = "That code didn't work. Check the 6 digits.";
    public const string Offline = "Can't reach the server. Check this PC is online, then try again.";
    public const string ServerProblem = "The server had a problem. Try again in a minute.";
    public const string NotInstalled = "Screen Time isn't installed properly. Run the installer again.";
    public const string NoRestart = "Couldn't start the limits. Restart this PC to start them.";
    public const string NotAnEmail = "That doesn't look like an email address.";
    public const string WrongSignInCode = "That code is wrong or has expired. Check the email, or send a new code.";
    public const string SignInAgain = "Your sign-in has run out. Sign in again.";
    public const string NotAParent = "That email can't add PCs. Sign in with a parent's email.";
    public const string KidGone = "That kid isn't in the family any more. Sign in again to see the kids.";
    public const string NoKids = "Your family has no kids yet. Add them in the parent app, then sign in again.";

    /// <summary>Windows' built-in accounts by their last SID part: Administrator, Guest, DefaultAccount, WDAGUtilityAccount.</summary>
    private static readonly HashSet<string> BuiltInRids = ["500", "501", "503", "504"];

    /// <summary>
    /// The accounts the window lists: enabled, not built in, by name (ignoring case). <paramref name="kidBySid"/> is
    /// this PC's enrolled devices (state.db); an administrator is a parent, so it never shows a kid.
    /// </summary>
    public static IReadOnlyList<PickedAccount> Accounts(IEnumerable<LocalAccount> accounts, IReadOnlyDictionary<string, string> kidBySid) =>
        accounts
            .Where(a => a.Enabled && !IsBuiltIn(a.Sid))
            .OrderBy(a => a.UserName, StringComparer.OrdinalIgnoreCase)
            .Select(a => new PickedAccount(a.UserName, a.FullName.Trim(), a.IsAdmin,
                a.IsAdmin ? null : kidBySid.GetValueOrDefault(a.Sid)))
            .ToList();

    /// <summary>Whether <paramref name="sid"/> is one of Windows' built-in accounts.</summary>
    public static bool IsBuiltIn(string sid) => BuiltInRids.Contains(sid[(sid.LastIndexOf('-') + 1)..]);

    /// <summary>
    /// The server URL for an address as typed (<see cref="ServiceFiles.NormaliseServerUrl"/>: no scheme means https),
    /// or null when it is not one.
    /// </summary>
    public static string? ServerUrl(string typed)
    {
        try
        {
            return ServiceFiles.NormaliseServerUrl(typed);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /// <summary>The address to show for a saved URL: https without its scheme, http with it, never the last slash.</summary>
    public static string ShowServer(string url)
    {
        var text = url.TrimEnd('/');
        return text.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? text["https://".Length..] : text;
    }

    /// <summary>
    /// What <c>GET /health</c> said: null when it is a Screen Time server, else a sentence. <paramref name="status"/>
    /// is null when nothing answered.
    /// </summary>
    public static string? HealthError(int? status, string? body) => status switch
    {
        null => NoAnswer,
        200 when body is not null && body.Contains("\"screentime-server\"") => null,
        _ => NotScreenTime,
    };

    /// <summary>
    /// Reads what <c>ScreenTime.Service.exe enrol --user <paramref name="user"/></c> printed (its output and errors
    /// together): "Enrolled &lt;user&gt; as &lt;kid&gt; (device &lt;id&gt;)." with exit 0, or "Enrolment failed: &lt;status&gt; …".
    /// Anything else (a network error) is no answer.
    /// </summary>
    public static EnrolOutcome ParseEnrol(string user, int exitCode, string output)
    {
        var lines = output.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        var prefix = $"Enrolled {user} as ";
        if (exitCode == 0)
        {
            foreach (var line in lines)
            {
                var at = line.LastIndexOf(" (device ", StringComparison.Ordinal);
                if (line.StartsWith(prefix, StringComparison.Ordinal) && at > prefix.Length && line.EndsWith(").", StringComparison.Ordinal))
                {
                    return new EnrolOutcome(line[prefix.Length..at], null);
                }
            }
        }
        foreach (var line in lines)
        {
            const string failed = "Enrolment failed: ";
            if (!line.StartsWith(failed, StringComparison.Ordinal)) continue;
            var number = line[failed.Length..].Split(' ')[0];
            if (int.TryParse(number, out var status)) return new EnrolOutcome(null, status);
        }
        return new EnrolOutcome(null, null);
    }

    /// <summary>The sentence for an enrolment that failed with <paramref name="status"/> (null: no answer).</summary>
    public static string EnrolError(int? status) => status switch
    {
        null => Offline,
        401 or 404 => WrongCode,
        409 => PhoneCode,
        429 => TooManyTries,
        400 => BadCode,
        _ => ServerProblem,
    };

    /// <summary>Whether <paramref name="text"/> looks like an email address: something@something.something, no spaces.</summary>
    public static bool IsEmail(string text)
    {
        var t = text.Trim();
        var at = t.IndexOf('@');
        return t.Length <= 254 && at > 0 && at == t.LastIndexOf('@') && t.IndexOf('.', at) > at + 1 && !t.EndsWith('.') && !t.Any(char.IsWhiteSpace);
    }

    /// <summary>Whether <paramref name="text"/> is a 6-digit code (spaces around it ignored).</summary>
    public static bool IsSixDigits(string text) => text.Trim() is { Length: 6 } t && t.All(char.IsAsciiDigit);

    /// <summary>How the parent's list of signed-in sessions names the setup window's sign-in (at most 100 characters).</summary>
    public static string SignInLabel(string machineName)
    {
        var label = $"Screen Time Setup on {machineName.Trim()}".TrimEnd();
        return label.Length <= 100 ? label : label[..100];
    }

    /// <summary>The sentence for "email me a code" that failed with <paramref name="status"/> (null: no answer).</summary>
    public static string RequestCodeError(int? status) => status switch
    {
        null => Offline,
        422 => NotAnEmail,
        429 => TooManyTries,
        _ => ServerProblem,
    };

    /// <summary>The sentence for a sign-in with the emailed code that failed with <paramref name="status"/> (null: no answer).</summary>
    public static string SignInError(int? status) => status switch
    {
        null => Offline,
        401 => WrongSignInCode,
        422 => BadCode,
        429 => TooManyTries,
        _ => ServerProblem,
    };

    /// <summary>The sentence for a signed-in call (the kids, a PC code) that failed with <paramref name="status"/> (null: no answer).</summary>
    public static string ParentCallError(int? status) => status switch
    {
        null => Offline,
        401 => SignInAgain,
        403 => NotAParent,
        404 => KidGone,
        429 => TooManyTries,
        _ => ServerProblem,
    };
}
