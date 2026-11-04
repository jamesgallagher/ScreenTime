namespace ScreenTime.Tray.Setup;

/// <summary>
/// The fake backend for <c>--setup --demo</c>, so the window can be seen without the service or the server. Any
/// address answers after 1 s except one containing "bad"; the code 123456 enrols (as the account's name with a capital),
/// 000000 is "wrong or expired", 409409 is a phone code, and anything else cannot reach the server. Alex is already
/// enrolled; James is an administrator.
/// </summary>
internal sealed class DemoSetupBackend : ISetupBackend
{
    private readonly List<SetupAccount> _accounts =
    [
        new("alex", "Alex", false, "Alex"),
        new("james", "James Gallagher", true, null),
        new("sam", "", false, null),
    ];

    public string? SavedServer => null;

    public async Task<string?> CheckServerAsync(string address)
    {
        await Task.Delay(1000);
        if (address.Contains("bad", StringComparison.OrdinalIgnoreCase)) return "Can't reach Screen Time at that address. Check it, and that this PC is online.";
        return null;
    }

    public async Task<IReadOnlyList<SetupAccount>> AccountsAsync()
    {
        await Task.Delay(300);
        return _accounts.ToList();
    }

    public async Task<EnrolAnswer> EnrolAsync(string address, string userName, string code)
    {
        await Task.Delay(1500);
        switch (code)
        {
            case "123456":
                var kid = char.ToUpperInvariant(userName[0]) + userName[1..];
                var i = _accounts.FindIndex(a => a.UserName == userName);
                _accounts[i] = _accounts[i] with { KidName = kid };
                return EnrolAnswer.Enrolled(kid);
            case "000000":
                return EnrolAnswer.Failed("That code is wrong or has expired. Make a new one in the parent app.");
            case "409409":
                return EnrolAnswer.Failed("That code is for a phone or tablet. In the parent app, choose PC.");
            default:
                return EnrolAnswer.Failed("Can't reach the server. Check this PC is online, then try again.");
        }
    }

    public async Task<string?> FinishAsync()
    {
        await Task.Delay(1500);
        return null;
    }
}
