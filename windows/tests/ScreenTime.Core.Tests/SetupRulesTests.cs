using ScreenTime.Core.Setup;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-052b: the rules behind the setup window. Copied verbatim from the card.</summary>
public sealed class SetupRulesTests
{
    private const string Pc = "S-1-5-21-1111111111-2222222222-3333333333";

    [Fact]
    public void TheListSkipsDisabledAndBuiltInAccountsAndSortsByName()
    {
        var accounts = new[]
        {
            new LocalAccount("sam", "", $"{Pc}-1002", true, false),
            new LocalAccount("Administrator", "", $"{Pc}-500", false, true),
            new LocalAccount("Guest", "", $"{Pc}-501", false, false),
            new LocalAccount("DefaultAccount", "", $"{Pc}-503", false, false),
            new LocalAccount("WDAGUtilityAccount", "", $"{Pc}-504", true, true),
            new LocalAccount("Alex", " Alex Gallagher ", $"{Pc}-1003", true, false),
            new LocalAccount("old", "", $"{Pc}-1004", false, false),
            new LocalAccount("james", "James Gallagher", $"{Pc}-1001", true, true),
        };

        var picked = SetupRules.Accounts(accounts, new Dictionary<string, string>());

        Assert.Equal(
            [
                new PickedAccount("Alex", "Alex Gallagher", false, null),
                new PickedAccount("james", "James Gallagher", true, null),
                new PickedAccount("sam", "", false, null),
            ],
            picked);
    }

    [Fact]
    public void AnEnrolledStandardAccountShowsItsKidButAnAdministratorNever()
    {
        var accounts = new[]
        {
            new LocalAccount("sam", "", $"{Pc}-1002", true, false),
            new LocalAccount("james", "", $"{Pc}-1001", true, true),
        };
        var kids = new Dictionary<string, string> { [$"{Pc}-1002"] = "Sam", [$"{Pc}-1001"] = "Alex" };

        var picked = SetupRules.Accounts(accounts, kids);

        Assert.Equal("Sam", picked.Single(a => a.UserName == "sam").KidName);
        Assert.Null(picked.Single(a => a.UserName == "james").KidName);
    }

    [Theory]
    [InlineData("S-1-5-21-1-2-3-500", true)]
    [InlineData("S-1-5-21-1-2-3-504", true)]
    [InlineData("S-1-5-21-1-2-3-1500", false)]
    [InlineData("S-1-5-21-1-2-3-1001", false)]
    public void BuiltInAccountsAreKnownByTheLastPartOfTheirSid(string sid, bool builtIn) =>
        Assert.Equal(builtIn, SetupRules.IsBuiltIn(sid));

    [Theory]
    [InlineData("screentime.gallagherhome.au", "https://screentime.gallagherhome.au/")]
    [InlineData(" https://screentime.gallagherhome.au/v1 ", "https://screentime.gallagherhome.au/")]
    [InlineData("http://172.18.0.1:8080", "http://172.18.0.1:8080/")]
    [InlineData("ftp://example.com", null)]
    [InlineData("not an address", null)]
    public void TheAddressAsTypedBecomesTheServerUrl(string typed, string? url) =>
        Assert.Equal(url, SetupRules.ServerUrl(typed));

    [Theory]
    [InlineData("https://screentime.gallagherhome.au/", "screentime.gallagherhome.au")]
    [InlineData("http://172.18.0.1:8080/", "http://172.18.0.1:8080")]
    public void ASavedUrlShowsWithoutHttpsAndTheLastSlash(string url, string shown) =>
        Assert.Equal(shown, SetupRules.ShowServer(url));

    [Fact]
    public void OnlyAScreenTimeHealthAnswerIsAServer()
    {
        Assert.Null(SetupRules.HealthError(200, """{"status":"ok","service":"screentime-server","time":"2026-11-04T06:00:00.000Z"}"""));
        Assert.Equal(SetupRules.NoAnswer, SetupRules.HealthError(null, null));
        Assert.Equal(SetupRules.NotScreenTime, SetupRules.HealthError(200, "<html>Unraid</html>"));
        Assert.Equal(SetupRules.NotScreenTime, SetupRules.HealthError(404, null));
        Assert.Equal(SetupRules.NotScreenTime, SetupRules.HealthError(502, "Bad gateway"));
    }

    [Fact]
    public void TheEnrolCommandsSuccessLineGivesTheKid()
    {
        var output = "Enrolled sam as Sam (device 01a1a522-79d3-7961-ae3a-c21c8b68f5e1).\n";
        Assert.Equal(new EnrolOutcome("Sam", null), SetupRules.ParseEnrol("sam", 0, output));
        // A kid's name can have spaces and brackets; only the last "(device" ends it.
        var odd = "Enrolled kim lee as Kim (the Great) (device 01a1a522-79d3-7961-ae3a-c21c8b68f5e1).\r\n";
        Assert.Equal(new EnrolOutcome("Kim (the Great)", null), SetupRules.ParseEnrol("kim lee", 0, odd));
    }

    [Fact]
    public void AFailedEnrolmentGivesTheServersStatusOrNoAnswer()
    {
        Assert.Equal(new EnrolOutcome(null, 401), SetupRules.ParseEnrol("sam", 1, "Enrolment failed: 401 invalid_code The code is wrong or expired.\n"));
        Assert.Equal(new EnrolOutcome(null, 409), SetupRules.ParseEnrol("sam", 1, "Enrolment failed: 409 form_mismatch \n"));
        Assert.Equal(new EnrolOutcome(null, null), SetupRules.ParseEnrol("sam", 1, "No connection could be made because the target machine actively refused it. (172.18.0.1:8080)\n"));
        Assert.Equal(new EnrolOutcome(null, null), SetupRules.ParseEnrol("sam", 1, ""));
        // A success line for another account, or with a failing exit code, is not a success.
        Assert.Equal(new EnrolOutcome(null, null), SetupRules.ParseEnrol("sam", 0, "Enrolled alex as Alex (device x)."));
        Assert.Equal(new EnrolOutcome(null, null), SetupRules.ParseEnrol("sam", 1, "Enrolled sam as Sam (device x)."));
    }

    [Theory]
    [InlineData(null, SetupRules.Offline)]
    [InlineData(401, SetupRules.WrongCode)]
    [InlineData(404, SetupRules.WrongCode)]
    [InlineData(409, SetupRules.PhoneCode)]
    [InlineData(429, SetupRules.TooManyTries)]
    [InlineData(400, SetupRules.BadCode)]
    [InlineData(500, SetupRules.ServerProblem)]
    [InlineData(503, SetupRules.ServerProblem)]
    public void EveryFailureIsASentenceNeverACode(int? status, string sentence)
    {
        Assert.Equal(sentence, SetupRules.EnrolError(status));
        Assert.DoesNotMatch(@"\d{3}", SetupRules.EnrolError(status));
    }
}
