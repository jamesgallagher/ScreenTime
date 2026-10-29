using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace ScreenTime.Core.Api;

/// <summary>The error the server answered with, when it did.</summary>
public sealed class ApiException(int status, ErrorResponseError? error) : Exception(error?.Message ?? $"The server answered {status}.")
{
    /// <summary>The HTTP status code of the server's answer.</summary>
    public int Status { get; } = status;

    /// <summary>The server's error body, or null when there was none.</summary>
    public ErrorResponseError? Error { get; } = error;
}

/// <summary>A conditional result: the value, or null on a 304, with the raw ETag and Date header text.</summary>
public sealed record Conditional<T>(T? Value, string? ETag, string? Date) where T : class;

/// <summary>
/// The shared behaviour of every generated client: build the request, send it, and turn the answer
/// into a result or an <see cref="ApiException"/>. JSON goes only through the source-generated
/// <see cref="ApiJsonContext"/> (no reflection).
/// </summary>
public abstract class ApiClientBase(HttpClient http, Func<string?> token)
{
    /// <summary>Send a request with a body and a result.</summary>
    protected async Task<TResult> SendAsync<TBody, TResult>(HttpMethod method, string path, bool auth, TBody body, JsonTypeInfo<TBody> bodyType, JsonTypeInfo<TResult> resultType, CancellationToken cancellationToken)
    {
        var response = await SendAndCheck(method, path, auth, JsonContent.Create(body, bodyType), null, allow304: false, cancellationToken);
        using (response)
        {
            var result = await response.Content!.ReadFromJsonAsync(resultType, cancellationToken);
            if (result is null) throw new JsonException("The server sent null.");
            return result;
        }
    }

    /// <summary>Send a request with no body and a result.</summary>
    protected async Task<TResult> SendAsync<TResult>(HttpMethod method, string path, bool auth, JsonTypeInfo<TResult> resultType, CancellationToken cancellationToken)
    {
        var response = await SendAndCheck(method, path, auth, null, null, allow304: false, cancellationToken);
        using (response)
        {
            var result = await response.Content!.ReadFromJsonAsync(resultType, cancellationToken);
            if (result is null) throw new JsonException("The server sent null.");
            return result;
        }
    }

    /// <summary>Send a request with a body and no result.</summary>
    protected async Task SendAsync<TBody>(HttpMethod method, string path, bool auth, TBody body, JsonTypeInfo<TBody> bodyType, CancellationToken cancellationToken)
    {
        var response = await SendAndCheck(method, path, auth, JsonContent.Create(body, bodyType), null, allow304: false, cancellationToken);
        using (response) { }
    }

    /// <summary>Send a request with no body and no result.</summary>
    protected async Task SendAsync(HttpMethod method, string path, bool auth, CancellationToken cancellationToken)
    {
        var response = await SendAndCheck(method, path, auth, null, null, allow304: false, cancellationToken);
        using (response) { }
    }

    /// <summary>Send a GET that may answer 304, returning the value plus the raw ETag and Date header text.</summary>
    protected async Task<Conditional<TResult>> GetConditionalAsync<TResult>(string path, bool auth, string? ifNoneMatch, JsonTypeInfo<TResult> resultType, CancellationToken cancellationToken) where TResult : class
    {
        var response = await SendAndCheck(HttpMethod.Get, path, auth, null, ifNoneMatch, allow304: true, cancellationToken);
        using (response)
        {
            if (response.StatusCode == HttpStatusCode.NotModified)
            {
                return new Conditional<TResult>(null, HeaderValue(response, "ETag"), HeaderValue(response, "Date"));
            }
            var value = await response.Content!.ReadFromJsonAsync(resultType, cancellationToken);
            if (value is null) throw new JsonException("The server sent null.");
            return new Conditional<TResult>(value, HeaderValue(response, "ETag"), HeaderValue(response, "Date"));
        }
    }

    /// <summary>Builds the request, sends it, and checks the status. The caller disposes the response on success.</summary>
    private async Task<HttpResponseMessage> SendAndCheck(HttpMethod method, string path, bool auth, HttpContent? content, string? ifNoneMatch, bool allow304, CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(method, path);
        if (auth)
        {
            var t = token();
            if (t is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", t);
        }
        if (content is not null) request.Content = content;
        if (ifNoneMatch is not null) request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
        var response = await http.SendAsync(request, cancellationToken);
        var code = (int)response.StatusCode;
        if (code < 200 || code >= 300)
        {
            if (code == 304 && allow304) return response;
            var error = await ReadError(response);
            response.Dispose();
            throw new ApiException(code, error);
        }
        return response;
    }

    /// <summary>Reads the server's error body, or null when there is none or it is not that JSON.</summary>
    private static async Task<ErrorResponseError?> ReadError(HttpResponseMessage response)
    {
        if (response.Content is null) return null;
        var text = await response.Content.ReadAsStringAsync();
        if (string.IsNullOrEmpty(text)) return null;
        try
        {
            return JsonSerializer.Deserialize(text, ApiJsonContext.Default.ErrorResponse)?.Error;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The raw header text, or null when the header is absent.</summary>
    private static string? HeaderValue(HttpResponseMessage response, string name)
    {
        return response.Headers.TryGetValues(name, out var v) ? v.First() : null;
    }
}
