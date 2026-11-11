using ScreenTime.Core.Setup;

namespace ScreenTime.Tray.Setup;

/// <summary>
/// The fake backend for <c>--setup --demo</c>, so the window can be seen without the service or the server. Any
/// address answers after 1 s except one containing "bad". Any email gets a sign-in code; 123456 signs in, anything else
/// is wrong. The family is Alex and Sam; picking a kid connects, except Sam on the account "kim" (the server cannot be
/// reached). A typed code: 123456 enrols (as the account's name with a capital), 000000 is "wrong or expired", 409409 is
/// a phone code, anything else cannot reach the server. Alex is already enrolled; James is an administrator.
/// </summary>
internal sealed class DemoSetupBackend : ISetupBackend
{
    private readonly List<SetupAccount> _accounts =
    [
        new("alex", "Alex", false, "Alex"),
        new("james", "James Gallagher", true, null),
        new("kim", "", false, null),
        new("sam", "", false, null),
    ];

    private static readonly SetupKid[] Kids = [new("k-alex", "Alex"), new("k-sam", "Sam")];
    private bool _signedIn;

    public string? SavedServer => null;

    public async Task<string?> CheckServerAsync(string address)
    {
        await Task.Delay(1000);
        if (address.Contains("bad", StringComparison.OrdinalIgnoreCase)) return SetupRules.NoAnswer;
        return null;
    }

    public async Task<IReadOnlyList<SetupAccount>> AccountsAsync()
    {
        await Task.Delay(300);
        return _accounts.ToList();
    }

    public async Task<string?> RequestSignInCodeAsync(string address, string email)
    {
        await Task.Delay(800);
        return SetupRules.IsEmail(email) ? null : SetupRules.NotAnEmail;
    }

    public async Task<string?> SignInAsync(string address, string email, string code)
    {
        await Task.Delay(800);
        _signedIn = code.Trim() == "123456";
        return _signedIn ? null : SetupRules.WrongSignInCode;
    }

    public async Task<SetupAnswer<IReadOnlyList<SetupKid>>> KidsAsync()
    {
        await Task.Delay(300);
        return _signedIn ? SetupAnswer<IReadOnlyList<SetupKid>>.Ok(Kids) : new(null, SetupRules.SignInAgain, true);
    }

    public async Task<EnrolAnswer> ConnectAsync(string address, string userName, string kidId)
    {
        await Task.Delay(1500);
        if (!_signedIn) return EnrolAnswer.Failed(SetupRules.SignInAgain, signInAgain: true);
        if (userName == "kim" && kidId == "k-sam") return EnrolAnswer.Failed(SetupRules.Offline);
        return Enrol(userName, Kids.Single(k => k.Id == kidId).Name);
    }

    public async Task<EnrolAnswer> EnrolAsync(string address, string userName, string code)
    {
        await Task.Delay(1500);
        return code switch
        {
            "123456" => Enrol(userName, char.ToUpperInvariant(userName[0]) + userName[1..]),
            "000000" => EnrolAnswer.Failed(SetupRules.WrongCode),
            "409409" => EnrolAnswer.Failed(SetupRules.PhoneCode),
            _ => EnrolAnswer.Failed(SetupRules.Offline),
        };
    }

    public Task SignOutAsync()
    {
        _signedIn = false;
        return Task.CompletedTask;
    }

    public async Task<string?> FinishAsync()
    {
        await Task.Delay(1500);
        return null;
    }

    private EnrolAnswer Enrol(string userName, string kid)
    {
        var i = _accounts.FindIndex(a => a.UserName == userName);
        _accounts[i] = _accounts[i] with { KidName = kid };
        return EnrolAnswer.Enrolled(kid);
    }
}
