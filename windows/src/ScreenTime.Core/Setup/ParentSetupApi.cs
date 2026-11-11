using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScreenTime.Core.Setup;

/// <summary>One kid of the family, as the setup window's pickers show it.</summary>
public sealed record SetupKid(string Id, string Name);

/// <summary>An answer from <see cref="ParentSetupApi"/>: the value, or a sentence for the parent (never a status code).</summary>
/// <param name="SignInAgain">The parent's sign-in ran out or was refused: the window goes back to "Sign in as a parent".</param>
public sealed record SetupAnswer<T>(T? Value, string? Error, bool SignInAgain = false)
{
    public static SetupAnswer<T> Ok(T value) => new(value, null);
}

/// <summary>
/// The parent routes the setup window uses (docs/SPEC.md §11.1 sign-in, §11.3 enrolment): email a sign-in code, sign in
/// with it, list the family's kids, and make a PC enrolment code for a kid. The access token stays in this object only,
/// never on disk; it lasts 15 minutes, and no refresh token is kept (the web client's refresh cookie is not stored).
/// <paramref name="http"/> has the server as its BaseAddress. Every failure is a sentence from <see cref="SetupRules"/>.
/// </summary>
public sealed class ParentSetupApi(HttpClient http)
{
    private string? _token;

    /// <summary>Whether a parent is signed in (the token may still have run out; the server then says 401).</summary>
    public bool SignedIn => _token is not null;

    /// <summary>Emails a 6-digit sign-in code to <paramref name="email"/>. Null when sent (the server never says whether the email is a parent's).</summary>
    public async Task<string?> RequestCodeAsync(string email, CancellationToken cancellationToken = default)
    {
        if (!SetupRules.IsEmail(email)) return SetupRules.NotAnEmail;
        var status = await StatusOf(Send(HttpMethod.Post, "v1/auth/otp/request", JsonContent.Create(new SetupOtpRequest(email.Trim()), SetupJsonContext.Default.SetupOtpRequest), cancellationToken));
        return status is 204 ? null : SetupRules.RequestCodeError(status);
    }

    /// <summary>Signs in with the emailed code; <paramref name="label"/> is how the parent's sessions list names this sign-in.</summary>
    public async Task<string?> SignInAsync(string email, string code, string label, CancellationToken cancellationToken = default)
    {
        _token = null;
        if (!SetupRules.IsSixDigits(code)) return SetupRules.BadCode;
        var body = new SetupOtpVerify(email.Trim(), code.Trim(), "web", label);
        using var response = await Send(HttpMethod.Post, "v1/auth/otp/verify", JsonContent.Create(body, SetupJsonContext.Default.SetupOtpVerify), cancellationToken);
        if (response is not { StatusCode: System.Net.HttpStatusCode.OK }) return SetupRules.SignInError(response is null ? null : (int)response.StatusCode);
        var auth = await Read(response, SetupJsonContext.Default.SetupAuth, cancellationToken);
        if (auth is null) return SetupRules.ServerProblem;
        _token = auth.AccessToken;
        return null;
    }

    /// <summary>The family's kids, oldest first (archived kids are left out by the server).</summary>
    public async Task<SetupAnswer<IReadOnlyList<SetupKid>>> KidsAsync(CancellationToken cancellationToken = default)
    {
        using var response = await Send(HttpMethod.Get, "v1/kids", null, cancellationToken);
        if (response is not { StatusCode: System.Net.HttpStatusCode.OK }) return Failed<IReadOnlyList<SetupKid>>(response);
        var kids = await Read(response, SetupJsonContext.Default.ListSetupKidJson, cancellationToken);
        if (kids is null) return new(null, SetupRules.ServerProblem);
        return SetupAnswer<IReadOnlyList<SetupKid>>.Ok(kids.Select(k => new SetupKid(k.Id, k.Name)).ToList());
    }

    /// <summary>Makes a PC enrolment code for the kid (it works once, for 10 minutes): what <c>ScreenTime.Service.exe enrol</c> takes.</summary>
    public async Task<SetupAnswer<string>> PcCodeAsync(string kidId, CancellationToken cancellationToken = default)
    {
        var body = JsonContent.Create(new SetupEnrolmentCodeCreate("pc"), SetupJsonContext.Default.SetupEnrolmentCodeCreate);
        using var response = await Send(HttpMethod.Post, $"v1/kids/{Uri.EscapeDataString(kidId)}/enrolment-codes", body, cancellationToken);
        if (response is not { StatusCode: System.Net.HttpStatusCode.Created }) return Failed<string>(response);
        var code = await Read(response, SetupJsonContext.Default.SetupEnrolmentCode, cancellationToken);
        return code is null ? new(null, SetupRules.ServerProblem) : SetupAnswer<string>.Ok(code.Code);
    }

    /// <summary>Ends the sign-in on the server too (best effort) and forgets the token.</summary>
    public async Task SignOutAsync(CancellationToken cancellationToken = default)
    {
        if (_token is null) return;
        using var _ = await Send(HttpMethod.Post, "v1/auth/logout", null, cancellationToken);
        _token = null;
    }

    private SetupAnswer<T> Failed<T>(HttpResponseMessage? response)
    {
        var status = response is null ? (int?)null : (int)response.StatusCode;
        if (status is 401 or 403) _token = null;
        return new(default, SetupRules.ParentCallError(status), status is 401 or 403);
    }

    /// <summary>Sends the request with the token when there is one; null when nothing answered.</summary>
    private async Task<HttpResponseMessage?> Send(HttpMethod method, string path, HttpContent? content, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, path) { Content = content };
        if (_token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        try
        {
            return await http.SendAsync(request, cancellationToken);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return null;
        }
    }

    private static async Task<int?> StatusOf(Task<HttpResponseMessage?> sending)
    {
        using var response = await sending;
        return response is null ? null : (int)response.StatusCode;
    }

    private static async Task<T?> Read<T>(HttpResponseMessage response, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> type, CancellationToken cancellationToken)
    {
        try
        {
            return await response.Content.ReadFromJsonAsync(type, cancellationToken);
        }
        catch (JsonException)
        {
            return default;
        }
    }
}

public sealed record SetupOtpRequest([property: JsonPropertyName("email")] string Email);

public sealed record SetupOtpVerify(
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("client")] string Client,
    [property: JsonPropertyName("clientLabel")] string ClientLabel);

public sealed record SetupAuth([property: JsonPropertyName("accessToken")] string AccessToken);

public sealed record SetupKidJson([property: JsonPropertyName("id")] string Id, [property: JsonPropertyName("name")] string Name);

public sealed record SetupEnrolmentCodeCreate([property: JsonPropertyName("form")] string Form);

public sealed record SetupEnrolmentCode([property: JsonPropertyName("code")] string Code);

/// <summary>The JSON source generator for the setup window's parent calls (Core is AOT-compatible: no reflection).</summary>
[JsonSourceGenerationOptions(RespectNullableAnnotations = true, RespectRequiredConstructorParameters = true)]
[JsonSerializable(typeof(SetupOtpRequest))]
[JsonSerializable(typeof(SetupOtpVerify))]
[JsonSerializable(typeof(SetupAuth))]
[JsonSerializable(typeof(List<SetupKidJson>), TypeInfoPropertyName = "ListSetupKidJson")]
[JsonSerializable(typeof(SetupEnrolmentCodeCreate))]
[JsonSerializable(typeof(SetupEnrolmentCode))]
public partial class SetupJsonContext : JsonSerializerContext
{
}
