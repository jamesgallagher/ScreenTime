using System.Net;
using System.Text;
using System.Text.Json;
using ScreenTime.Core.Setup;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>The setup window's parent sign-in (sign in once, then pick a kid per account) against a fake server.</summary>
public sealed class ParentSetupApiTests
{
    /// <summary>Answers each "METHOD path" with a canned status and body; keeps every request it got. Unknown: 500.</summary>
    private sealed class FakeServer : HttpMessageHandler
    {
        public readonly Dictionary<string, (HttpStatusCode Status, string? Json)> Answers = [];
        public readonly List<(string Key, string? Bearer, string? Body)> Requests = [];
        public bool Offline { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (Offline) throw new HttpRequestException("No connection could be made.");
            var key = $"{request.Method} {request.RequestUri!.AbsolutePath}";
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            Requests.Add((key, request.Headers.Authorization?.Parameter, body));
            var (status, json) = Answers.GetValueOrDefault(key, (HttpStatusCode.InternalServerError, null));
            var response = new HttpResponseMessage(status);
            if (json is not null) response.Content = new StringContent(json, Encoding.UTF8, "application/json");
            return response;
        }
    }

    private const string Auth = """{"accessToken":"parent-token","expiresIn":900,"me":{"parent":null,"family":null,"roles":[]}}""";
    private const string Kids = """[{"id":"k-alex","name":"Alex","avatarColor":"teal"},{"id":"k-sam","name":"Sam","avatarColor":"amber"}]""";

    private static (ParentSetupApi Api, FakeServer Server) Make()
    {
        var server = new FakeServer();
        server.Answers["POST /v1/auth/otp/request"] = (HttpStatusCode.NoContent, null);
        server.Answers["POST /v1/auth/otp/verify"] = (HttpStatusCode.OK, Auth);
        server.Answers["GET /v1/kids"] = (HttpStatusCode.OK, Kids);
        server.Answers["POST /v1/kids/k-sam/enrolment-codes"] = (HttpStatusCode.Created, """{"code":"482913","qrPayload":"x","expiresAt":"2026-11-12T06:10:00.000Z"}""");
        server.Answers["POST /v1/auth/logout"] = (HttpStatusCode.NoContent, null);
        return (new ParentSetupApi(new HttpClient(server) { BaseAddress = new Uri("https://st.example/") }), server);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task SigningInOnceListsTheKidsAndMakesAPcCodeWithTheToken()
    {
        var (api, server) = Make();

        Assert.Null(await api.RequestCodeAsync(" dad@example.com ", Ct));
        Assert.Null(await api.SignInAsync("dad@example.com", "123456", "Screen Time Setup on DESKTOP-1", Ct));
        Assert.True(api.SignedIn);
        var kids = await api.KidsAsync(Ct);
        var code = await api.PcCodeAsync("k-sam", Ct);

        Assert.Equal([new SetupKid("k-alex", "Alex"), new SetupKid("k-sam", "Sam")], kids.Value);
        Assert.Equal("482913", code.Value);
        Assert.Equal(
            ["POST /v1/auth/otp/request", "POST /v1/auth/otp/verify", "GET /v1/kids", "POST /v1/kids/k-sam/enrolment-codes"],
            server.Requests.Select(r => r.Key));
        // The token goes only with the signed-in calls.
        Assert.Equal([null, null, "parent-token", "parent-token"], server.Requests.Select(r => r.Bearer));
        Assert.Equal("""{"email":"dad@example.com"}""", server.Requests[0].Body);
        using var verify = JsonDocument.Parse(server.Requests[1].Body!);
        Assert.Equal("123456", verify.RootElement.GetProperty("code").GetString());
        Assert.Equal("web", verify.RootElement.GetProperty("client").GetString());
        Assert.Equal("Screen Time Setup on DESKTOP-1", verify.RootElement.GetProperty("clientLabel").GetString());
        Assert.Equal("""{"form":"pc"}""", server.Requests[3].Body);
    }

    [Fact]
    public async Task SigningOutTellsTheServerAndForgetsTheToken()
    {
        var (api, server) = Make();
        await api.SignInAsync("dad@example.com", "123456", "x", Ct);

        await api.SignOutAsync(Ct);
        await api.SignOutAsync(Ct);

        Assert.False(api.SignedIn);
        Assert.Single(server.Requests, r => r.Key == "POST /v1/auth/logout" && r.Bearer == "parent-token");
    }

    [Fact]
    public async Task ABadEmailOrCodeIsCaughtBeforeTheServer()
    {
        var (api, server) = Make();

        Assert.Equal(SetupRules.NotAnEmail, await api.RequestCodeAsync("dad at example", Ct));
        Assert.Equal(SetupRules.BadCode, await api.SignInAsync("dad@example.com", "12345", "x", Ct));
        Assert.Empty(server.Requests);
    }

    [Fact]
    public async Task AWrongSignInCodeLeavesTheParentSignedOut()
    {
        var (api, server) = Make();
        server.Answers["POST /v1/auth/otp/verify"] = (HttpStatusCode.Unauthorized, """{"error":{"code":"unauthorized","message":"x"}}""");

        Assert.Equal(SetupRules.WrongSignInCode, await api.SignInAsync("dad@example.com", "000000", "x", Ct));
        Assert.False(api.SignedIn);
    }

    [Fact]
    public async Task ARunOutSignInAsksToSignInAgain()
    {
        var (api, server) = Make();
        await api.SignInAsync("dad@example.com", "123456", "x", Ct);
        server.Answers["POST /v1/kids/k-sam/enrolment-codes"] = (HttpStatusCode.Unauthorized, null);

        var code = await api.PcCodeAsync("k-sam", Ct);

        Assert.Equal(new SetupAnswer<string>(null, SetupRules.SignInAgain, true), code);
        Assert.False(api.SignedIn);
    }

    [Fact]
    public async Task AKidThatIsGoneIsASentenceButKeepsTheSignIn()
    {
        var (api, server) = Make();
        await api.SignInAsync("dad@example.com", "123456", "x", Ct);
        server.Answers["POST /v1/kids/k-old/enrolment-codes"] = (HttpStatusCode.NotFound, null);

        Assert.Equal(new SetupAnswer<string>(null, SetupRules.KidGone, false), await api.PcCodeAsync("k-old", Ct));
        Assert.True(api.SignedIn);
    }

    [Fact]
    public async Task NoAnswerIsOfflineAndAFamilylessEmailIsNotAParent()
    {
        var (api, server) = Make();
        server.Offline = true;
        Assert.Equal(SetupRules.Offline, await api.RequestCodeAsync("dad@example.com", Ct));
        Assert.Equal(SetupRules.Offline, await api.SignInAsync("dad@example.com", "123456", "x", Ct));

        server.Offline = false;
        await api.SignInAsync("admin@example.com", "123456", "x", Ct);
        server.Answers["GET /v1/kids"] = (HttpStatusCode.Forbidden, null);
        Assert.Equal(new SetupAnswer<IReadOnlyList<SetupKid>>(null, SetupRules.NotAParent, true), await api.KidsAsync(Ct));
    }

    [Theory]
    [InlineData("dad@example.com", true)]
    [InlineData("  dad@example.com ", true)]
    [InlineData("d.a.d@mail.example.com.au", true)]
    [InlineData("dad@example", false)]
    [InlineData("@example.com", false)]
    [InlineData("dad@@example.com", false)]
    [InlineData("dad @example.com", false)]
    [InlineData("dad@example.", false)]
    [InlineData("dad@.com", false)]
    [InlineData("", false)]
    public void AnEmailIsCheckedLooselyBeforeSending(string text, bool ok) => Assert.Equal(ok, SetupRules.IsEmail(text));

    [Fact]
    public void TheSignInIsNamedAfterThePcAndFitsTheServersLimit()
    {
        Assert.Equal("Screen Time Setup on CONOR-PC", SetupRules.SignInLabel("CONOR-PC"));
        Assert.Equal(100, SetupRules.SignInLabel(new string('X', 200)).Length);
    }

    [Theory]
    [InlineData(null, SetupRules.Offline, SetupRules.Offline, SetupRules.Offline)]
    [InlineData(401, SetupRules.ServerProblem, SetupRules.WrongSignInCode, SetupRules.SignInAgain)]
    [InlineData(403, SetupRules.ServerProblem, SetupRules.ServerProblem, SetupRules.NotAParent)]
    [InlineData(404, SetupRules.ServerProblem, SetupRules.ServerProblem, SetupRules.KidGone)]
    [InlineData(422, SetupRules.NotAnEmail, SetupRules.BadCode, SetupRules.ServerProblem)]
    [InlineData(429, SetupRules.TooManyTries, SetupRules.TooManyTries, SetupRules.TooManyTries)]
    [InlineData(500, SetupRules.ServerProblem, SetupRules.ServerProblem, SetupRules.ServerProblem)]
    public void EverySignInFailureIsASentenceNeverACode(int? status, string requestCode, string signIn, string signedInCall)
    {
        Assert.Equal(requestCode, SetupRules.RequestCodeError(status));
        Assert.Equal(signIn, SetupRules.SignInError(status));
        Assert.Equal(signedInCall, SetupRules.ParentCallError(status));
        foreach (var s in new[] { requestCode, signIn, signedInCall }) Assert.DoesNotMatch(@"\d{3}", s);
    }
}
