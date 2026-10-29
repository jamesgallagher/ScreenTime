# CARD-046: Windows: C# API client

| Field | Value |
|---|---|
| Card | CARD-046 |
| Title | Windows: C# API client |
| Size | M |
| Depends on | CARD-045 merged to `main` |
| Spec sections | docs/SPEC.md §4.1 (one contract, generated clients), §9 (API) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-046-cs-client` |
| PR title | `CARD-046: Windows: C# API client` |

## 1. Project context

Read `AGENTS.md` first. Rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command** and lists every workaround.

`contract/openapi.json` is the one API contract. `pnpm contract` (in `server/`) exports it, then `server/scripts/kotlin-client.ts` turns it into the Android client with the generator in `server/scripts/kotlin-gen.ts`. This card adds the same for C#: a generator `server/scripts/csharp-gen.ts` and a writer `server/scripts/csharp-client.ts` that write two generated files into `windows/src/ScreenTime.Core/Api/`. The Windows service (CARD-047 onward) will call the server only through them.

**Read `kotlin-gen.ts` before you start and copy its shape**: the same `Schema`/`OpenApiDoc` types (import them, do not copy them), the same `pascal()` helper idea, the same "declare a placeholder, then fill it" trick so a record comes before its inline types, the same method naming. Section 6 lists every place where C# differs.

Only the **kid-device routes** are generated: paths that start with `/v1/device/`, plus `/v1/enrol`. Careful: `/v1/devices` (with an s) is a parent route and is **not** included. That is 14 operations and 37 schemas.

You **copy** the two test files in section 5 exactly and **write** the code from section 6. The tests are the contract; never change them.

## 2. Goal

- `pnpm contract` writes `ApiModels.g.cs` and `ApiClient.g.cs`, and running it twice changes nothing.
- `pnpm test` in `server/` passes, including the new `csharp-client.test.ts`.
- `dotnet build` and `dotnet test` in `windows/` pass, including the new `ApiClientTests`.
- CI **TypeScript** and **Windows / build and test** are green.

## 3. Out of scope

- No local database or offline queue (that is CARD-046b). No service, no tray, no timers.
- No change to `kotlin-gen.ts`, the Kotlin files, `contract/openapi.json`, any route, or any csproj or workflow.
- No NuGet package. `System.Text.Json` and `System.Net.Http.Json` are part of .NET 10.
- No parent routes in the C# client.

## 4. Tech

- Generator: TypeScript, run by `tsx`, tested by vitest, like `kotlin-gen.ts`.
- C#: .NET 10, nullable on, warnings are errors, `ScreenTime.Core` is `IsAotCompatible`. So: **no reflection**. JSON goes only through the source-generated `ApiJsonContext` (`JsonTypeInfo<T>` overloads everywhere). Never call `JsonSerializer` without a `JsonTypeInfo`.
- Strict JSON: the context sets `RespectNullableAnnotations = true` and `RespectRequiredConstructorParameters = true`, so a missing required field or a null in a non-null field throws `JsonException`. Unknown fields are ignored (the default).

## 5. Files to copy

Copy both exactly. Check each with the fingerprint command in 8.1, **once**.

### 5.1 `windows/tests/ScreenTime.Core.Tests/ApiClientTests.cs`

```csharp
using System.Net;
using System.Text;
using System.Text.Json;
using ScreenTime.Core.Api;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-046: the generated C# API client against a fake server. Copied verbatim from the card.</summary>
public class ApiClientTests
{
    /// <summary>Answers every request with one canned response, and keeps the request it got.</summary>
    private sealed class FakeServer(HttpStatusCode status, string? json, params (string Name, string Value)[] headers) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            var response = new HttpResponseMessage(status);
            if (json is not null) response.Content = new StringContent(json, Encoding.UTF8, "application/json");
            foreach (var (name, value) in headers) response.Headers.TryAddWithoutValidation(name, value);
            return response;
        }
    }

    private static ApiClient ClientFor(FakeServer server, string? token = "device-token") =>
        new(new HttpClient(server) { BaseAddress = new Uri("https://st.example/") }, () => token);

    private const string Enrolled = """
        {"deviceId":"d-1","deviceToken":"secret","kid":{"id":"k-1","name":"Alex"},"family":{"name":"Gallaghers","timezone":"Australia/Sydney"},"extra":"ignored"}
        """;

    [Fact]
    public async Task EnrolPostsTheRequestInTheApiWords()
    {
        var server = new FakeServer(HttpStatusCode.Created, Enrolled);
        var client = ClientFor(server, token: null);

        var enrolled = await client.PostEnrolAsync(new EnrolRequest(
            Code: "123456",
            Platform: Platform.Windows,
            HasCellular: false,
            Model: "Dell XPS",
            OsVersion: "Windows 11 Pro 24H2",
            AppVersion: "0.1.0",
            WindowsUserName: "Alex"));

        Assert.Equal(HttpMethod.Post, server.Request!.Method);
        Assert.Equal("https://st.example/v1/enrol", server.Request.RequestUri!.ToString());
        Assert.Null(server.Request.Headers.Authorization);
        using var sent = JsonDocument.Parse(server.Body!);
        var root = sent.RootElement;
        Assert.Equal("123456", root.GetProperty("code").GetString());
        Assert.Equal("windows", root.GetProperty("platform").GetString());
        Assert.False(root.GetProperty("hasCellular").GetBoolean());
        Assert.Equal("Alex", root.GetProperty("windowsUserName").GetString());
        // Optional fields left out are not sent at all.
        Assert.False(root.TryGetProperty("machineId", out _));
        Assert.False(root.TryGetProperty("windowsUserSid", out _));

        Assert.Equal("d-1", enrolled.DeviceId);
        Assert.Equal("secret", enrolled.DeviceToken);
        Assert.Equal("Alex", enrolled.Kid.Name);
        Assert.Equal("Australia/Sydney", enrolled.Family.Timezone);
    }

    [Fact]
    public async Task ARequiredNullIsSentAsNull()
    {
        // endedAt is required and nullable: an open segment sends "endedAt": null, never leaves it out.
        var server = new FakeServer(HttpStatusCode.OK, """{"received":1}""");
        var receipt = await ClientFor(server).PostDeviceUsageAsync(new UsageUpload([
            new UsageSegmentIn(Id: "s-1", StartedAt: "2026-10-29T08:00:00.000Z", EndedAt: null, RecordedOffline: false),
        ]));

        Assert.Equal("Bearer device-token", server.Request!.Headers.Authorization!.ToString());
        Assert.Equal("https://st.example/v1/device/usage", server.Request.RequestUri!.ToString());
        using var sent = JsonDocument.Parse(server.Body!);
        var segment = sent.RootElement.GetProperty("segments")[0];
        Assert.Equal(JsonValueKind.Null, segment.GetProperty("endedAt").ValueKind);
        Assert.False(segment.GetProperty("recordedOffline").GetBoolean());
        Assert.Equal(1, receipt.Received);
    }

    [Fact]
    public async Task AnOptionalNullIsLeftOut()
    {
        const string json = """
            {"id":"r-1","kidId":"k-1","kidName":"Alex","deviceId":"d-1","deviceName":"Alex's PC","pool":"screens","minutes":30,"reason":null,"status":"pending","createdAt":"2026-10-29T08:00:00.000Z","resolvedAt":null,"resolvedByName":null,"grantId":null,"grantedMinutes":null}
            """;
        var server = new FakeServer(HttpStatusCode.Created, json);
        var request = await ClientFor(server).PostDeviceTimeRequestsAsync(new TimeRequestCreate(Id: "r-1", Minutes: 30));

        using var sent = JsonDocument.Parse(server.Body!);
        Assert.Equal(30, sent.RootElement.GetProperty("minutes").GetInt32());
        Assert.False(sent.RootElement.TryGetProperty("reason", out _));
        Assert.Equal(TimeRequestStatus.Pending, request.Status);
        Assert.Null(request.GrantedMinutes);
    }

    [Fact]
    public async Task StateSendsIfNoneMatchAndANotModifiedHasNoValue()
    {
        var server = new FakeServer(HttpStatusCode.NotModified, null, ("ETag", "\"v7\""), ("Date", "Thu, 29 Oct 2026 08:00:00 GMT"));
        var state = await ClientFor(server).GetDeviceStateAsync(ifNoneMatch: "\"v7\"");

        Assert.Equal(HttpMethod.Get, server.Request!.Method);
        Assert.Equal("\"v7\"", server.Request.Headers.GetValues("If-None-Match").Single());
        Assert.Null(state.Value);
        Assert.Equal("\"v7\"", state.ETag);
        Assert.Equal("Thu, 29 Oct 2026 08:00:00 GMT", state.Date);
    }

    [Fact]
    public async Task StateReadsANewVersion()
    {
        const string json = """
            {"serverTime":"2026-10-29T08:00:00.000Z","stateVersion":"v8",
             "device":{"id":"d-1","name":"Alex's PC","form":"pc","pool":"screens","hasCellular":false},
             "kid":{"id":"k-1","name":"Alex"},
             "family":{"timezone":"Australia/Sydney","emergencyNumber":"000","parentCodeSecret":"not-a-real-secret"},
             "parents":[{"id":"p-1","displayName":"Dad","phoneE164":null}],"contacts":[],"messagePresets":[],
             "schedule":{"version":3,"warn1Min":15,"warn2Min":5,"days":[{"weekday":4,"screensMin":120,"phoneMin":60,"wake":"07:00","bedtime":"21:00"}]},
             "today":{"date":"2026-10-29","grants":[],"poolSegments":[{"id":"s-1","deviceId":"d-1","startedAt":"2026-10-29T07:00:00.000Z","endedAt":null}]},
             "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"activeSos":null}
            """;
        var server = new FakeServer(HttpStatusCode.OK, json, ("ETag", "\"v8\""));
        var state = await ClientFor(server).GetDeviceStateAsync();

        Assert.False(server.Request!.Headers.Contains("If-None-Match"));
        Assert.NotNull(state.Value);
        Assert.Equal("v8", state.Value.StateVersion);
        Assert.Equal(DeviceForm.Pc, state.Value.Device.Form);
        Assert.Equal(ScreenTime.Core.Api.Pool.Screens, state.Value.Device.Pool);
        Assert.Equal(120, state.Value.Schedule.Days[0].ScreensMin);
        Assert.Null(state.Value.Today.PoolSegments[0].EndedAt);
        Assert.Null(state.Value.Parents[0].PhoneE164);
        Assert.Null(state.Value.PendingRequest);
        Assert.Equal("\"v8\"", state.ETag);
    }

    [Fact]
    public async Task AnErrorBecomesAnApiExceptionWithTheServersCode()
    {
        const string json = """{"error":{"code":"conflict","message":"That code was already used."}}""";
        var server = new FakeServer(HttpStatusCode.Conflict, json);

        var e = await Assert.ThrowsAsync<ApiException>(() => ClientFor(server).PostEnrolAsync(new EnrolRequest(
            Code: "123456", Platform: Platform.Windows, HasCellular: false, Model: "m", OsVersion: "o", AppVersion: "a")));

        Assert.Equal(409, e.Status);
        Assert.NotNull(e.Error);
        Assert.Equal(ErrorCode.Conflict, e.Error.Code);
        Assert.Equal("That code was already used.", e.Error.Message);
    }

    [Fact]
    public async Task AMissingRequiredFieldIsAnError()
    {
        // The JSON context respects required fields, so a broken answer fails here, not later with a null.
        var server = new FakeServer(HttpStatusCode.OK, "{}");
        await Assert.ThrowsAsync<JsonException>(() => ClientFor(server).PostDeviceUsageAsync(new UsageUpload([
            new UsageSegmentIn(Id: "s-1", StartedAt: "2026-10-29T08:00:00.000Z", EndedAt: "2026-10-29T08:05:00.000Z", RecordedOffline: true),
        ])));
    }

    [Fact]
    public async Task AnErrorWithoutJsonStillHasItsStatus()
    {
        var server = new FakeServer(HttpStatusCode.BadGateway, null);
        var e = await Assert.ThrowsAsync<ApiException>(() => ClientFor(server).GetDeviceMeAsync());
        Assert.Equal(502, e.Status);
        Assert.Null(e.Error);
    }

    [Fact]
    public async Task PathIdsAreEscapedAndNoContentCallsReturnNothing()
    {
        var server = new FakeServer(HttpStatusCode.NoContent, null);
        await ClientFor(server).PostDeviceSosEndAsync("a b/c");
        Assert.Equal("/v1/device/sos/a%20b%2Fc/end", server.Request!.RequestUri!.AbsolutePath);
        Assert.Null(server.Body);
    }

    [Fact]
    public void EnumsUseTheApiText()
    {
        Assert.Equal("\"tamper.tray_killed\"", JsonSerializer.Serialize(DeviceEventKind.TamperTrayKilled, ApiJsonContext.Default.DeviceEventKind));
        Assert.Equal(ErrorCode.ValidationFailed, JsonSerializer.Deserialize("\"validation_failed\"", ApiJsonContext.Default.ErrorCode));
    }
}
```

### 5.2 `server/test/csharp-client.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateCSharp } from '../scripts/csharp-gen.js';
import type { OpenApiDoc } from '../scripts/kotlin-gen.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const doc = JSON.parse(read('../../contract/openapi.json')) as OpenApiDoc;
const api = '../../windows/src/ScreenTime.Core/Api/';

describe('C# API client', () => {
  const { models, client } = generateCSharp(doc);

  it('matches the committed ApiModels.g.cs and ApiClient.g.cs (run `pnpm contract` if this fails)', () => {
    expect(read(`${api}ApiModels.g.cs`)).toBe(models);
    expect(read(`${api}ApiClient.g.cs`)).toBe(client);
  });

  it('has one method for every device operation and none for the parent ones', () => {
    expect(client.match(/^ {4}public Task/gm)).toHaveLength(14);
    expect(client).toContain(
      '    public Task<EnrolResponse> PostEnrolAsync(EnrolRequest body, CancellationToken cancellationToken = default) =>\n' +
        '        SendAsync(HttpMethod.Post, "v1/enrol", auth: false, body, ApiJsonContext.Default.EnrolRequest, ApiJsonContext.Default.EnrolResponse, cancellationToken);\n',
    );
    expect(client).toContain(
      '    public Task<Conditional<DeviceState>> GetDeviceStateAsync(string? ifNoneMatch = null, CancellationToken cancellationToken = default) =>\n' +
        '        GetConditionalAsync("v1/device/state", auth: true, ifNoneMatch, ApiJsonContext.Default.DeviceState, cancellationToken);\n',
    );
    expect(client).toContain(
      '    public Task PostDeviceSosEndAsync(string id, CancellationToken cancellationToken = default) =>\n' +
        '        SendAsync(HttpMethod.Post, $"v1/device/sos/{Uri.EscapeDataString(id)}/end", auth: true, cancellationToken);\n',
    );
    expect(client).toContain('    /// <summary>Upload usage segments.</summary>\n    /// <remarks><c>POST /v1/device/usage</c></remarks>\n');
    expect(client).not.toContain('GetKids');
    expect(models).not.toMatch(/record (Kid|ParentCreate|FamilyPatch)\(/);
  });

  it('maps required, nullable and optional fields', () => {
    expect(models.startsWith('// Generated by server/scripts/csharp-client.ts from contract/openapi.json. Do not edit: run `pnpm contract`.\n\n#nullable enable\n')).toBe(true);
    // Required first, in contract order, then the optional ones with a default.
    expect(models).toContain(
      'public sealed record EnrolRequest(\n' +
        '    [property: JsonPropertyName("code")] string Code,\n' +
        '    [property: JsonPropertyName("platform")] Platform Platform,\n' +
        '    [property: JsonPropertyName("hasCellular")] bool HasCellular,\n' +
        '    [property: JsonPropertyName("model")] string Model,\n' +
        '    [property: JsonPropertyName("osVersion")] string OsVersion,\n' +
        '    [property: JsonPropertyName("appVersion")] string AppVersion,\n' +
        '    [property: JsonPropertyName("machineId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? MachineId = null,\n',
    );
    expect(models).toContain('    [property: JsonPropertyName("endedAt")] string? EndedAt,\n');
    expect(models).toContain('    [property: JsonPropertyName("minutes")] int Minutes,\n');
    expect(models).toContain('    [property: JsonPropertyName("durationMin")] int? DurationMin,\n');
    expect(models).toContain('    [property: JsonPropertyName("lat")] double Lat,\n');
    expect(models).toContain('    [property: JsonPropertyName("pendingRequest")] DeviceStatePendingRequest? PendingRequest,\n');
    expect(models).toContain('    [property: JsonPropertyName("parents")] IReadOnlyList<DeviceStateParentsItem> Parents,\n');
    expect(models).toContain(
      '    [property: JsonPropertyName("payload"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Payload = null);\n',
    );
    expect(models).toContain(
      '[JsonConverter(typeof(JsonStringEnumConverter<DeviceEventKind>))]\npublic enum DeviceEventKind\n{\n    [JsonStringEnumMemberName("tamper.clock")] TamperClock,\n',
    );
    expect(models).toContain('    [property: JsonPropertyName("endedBy")] SosEndedBy? EndedBy,\n');
    expect(models).toContain('[JsonSerializable(typeof(DeviceState))]\n');
    expect(models.endsWith('public partial class ApiJsonContext : JsonSerializerContext\n{\n}\n')).toBe(true);
  });

  it('only looks at schemas the device routes use, and refuses one it does not understand', () => {
    const odd = { anyOf: [{ type: 'string' }, { type: 'integer' }] };
    const route = { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Odd' } } } } } } };
    expect(() => generateCSharp({ paths: { '/v1/kids': route }, components: { schemas: { Odd: odd } } } as OpenApiDoc)).not.toThrow();
    expect(() => generateCSharp({ paths: { '/v1/device/odd': route }, components: { schemas: { Odd: odd } } } as OpenApiDoc)).toThrow(
      'Odd: unsupported schema',
    );
    const clash = {
      paths: { '/v1/device/x': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Kid' } } } } } } } },
      components: {
        schemas: {
          Kid: { type: 'object', properties: { pool: { $ref: '#/components/schemas/KidPool' }, other: { type: 'string', enum: ['a'] } } },
          KidPool: { type: 'string', enum: ['b'] },
          KidOther: { type: 'string', enum: ['c'] },
        },
      },
    } as OpenApiDoc;
    expect(() => generateCSharp(clash)).toThrow('two C# types are named KidOther');
  });
});
```

## 6. What to write

### 6.1 `server/scripts/csharp-gen.ts`

Export `generateCSharp(doc: OpenApiDoc): { models: string; client: string }` and `HEADER`:

```ts
export const HEADER = '// Generated by server/scripts/csharp-client.ts from contract/openapi.json. Do not edit: run `pnpm contract`.';
```

Import `type OpenApiDoc` (and the `Schema`/`Operation` types if you need them; export them from `kotlin-gen.ts` only if they are not exported yet, with no other change there).

**Which operations.** Every `(path, method)` in `doc.paths`, in contract order, where `path === '/v1/enrol'` or `path.startsWith('/v1/device/')`.

**Which schemas.** Start from those operations' request bodies and responses and follow every `$ref` (inside properties, `items`, `anyOf`, everywhere), again and again, until nothing new is found. Then walk `components.schemas` **in contract order** and, for each schema in that set:

| Schema | C# output |
|---|---|
| has `properties` | a record (6.2) |
| a string `enum` | an enum (6.3) |
| a plain `string`, or number choices (`anyOf` of number `enum`s and maybe `null`, like `ParentModeDuration`) | nothing; uses become `string` / `int` |
| anything else | `throw new Error(\`${name}: unsupported schema\`)` |

A schema that no device route uses is never looked at (the test checks this).

**Types.** For a property schema, `csharpType(schema, owner)` gives the C# type without `?`:

| Contract | C# |
|---|---|
| `$ref` to a plain string / number choices | `string` / `int` |
| `$ref` to anything else | the schema name |
| number choices (`anyOf`) | `int` |
| any other `anyOf` | throw `${owner}: anyOf is only supported for number choices` |
| `string` (any `format`: date-time, uuid…) | `string` |
| `string` with `enum` | an inline enum named `owner` |
| `integer` / `number` / `boolean` | `int` / `double` / `bool` |
| `array` | `IReadOnlyList<T>`, where T uses owner `${owner}Item` (add `?` if the item can be null) |
| `object` with `properties` | an inline record named `owner` |
| `object` without `properties` but with `additionalProperties` | `JsonElement` |
| anything else | throw `${owner}: unsupported type …` like Kotlin |

`owner` for a property is the record name plus `pascal(property)`: `DeviceState.pendingRequest` → `DeviceStatePendingRequest`, `ErrorResponse.error` → `ErrorResponseError`, `Sos.endedBy` → `SosEndedBy`.

"Can be null" is exactly `kotlin-gen.ts`'s `nullable()`: a `type` list with `"null"`, an `enum` with `null`, an `anyOf` with a null type, or a `$ref` to such a schema (so `$ref: SosLocation` can be null).

**Names.** A type name may be declared once. An inline type may also not take the name of **any** schema in `components.schemas`, used or not. Otherwise throw `two C# types are named ${name}`.

**Order.** Like Kotlin: a record or enum is written where it was first declared, and its inline types come right after it (placeholder trick).

### 6.2 Records

```csharp
public sealed record EnrolRequest(
    [property: JsonPropertyName("code")] string Code,
    ...
    [property: JsonPropertyName("windowsUserName"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? WindowsUserName = null);
```

- One parameter per line, 4 spaces. The parameter name is `pascal(property)`. The JSON name is the contract name.
- **Required properties first, in contract order, then the optional ones in contract order** (C# needs defaults last).
- Required: `[property: JsonPropertyName("x")] T X` with `T?` when it can be null. A required null **is sent** as `null`.
- Optional (not in `required`), null or not: `[property: JsonPropertyName("x"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] T? X = null`. Left out, it is not sent.
- Lines end with `,`; the last ends with `);`.

### 6.3 Enums

```csharp
[JsonConverter(typeof(JsonStringEnumConverter<DeviceEventKind>))]
public enum DeviceEventKind
{
    [JsonStringEnumMemberName("tamper.clock")] TamperClock,
    [JsonStringEnumMemberName("tamper.timezone")] TamperTimezone,
    ...
}
```

Member name is `pascal(value)` (`tamper.tray_killed` → `TamperTrayKilled`, `not_found` → `NotFound`). Every member line ends with `,`. `null` in an enum list is skipped (the property becomes `SosEndedBy?`). A member name starting with a digit throws `${name}: unsupported enum value ${value}`.

### 6.4 `ApiModels.g.cs` layout

Parts joined with one blank line (`'\n\n'`), file ends with one `\n`:

1. `HEADER`
2. `#nullable enable`
3. `using System.Text.Json;` and `using System.Text.Json.Serialization;` (two lines)
4. `namespace ScreenTime.Core.Api;`
5. every record and enum, each its own part
6. the context:

```csharp
/// <summary>The System.Text.Json source generator for every type above. A missing required field, or a null where none is allowed, throws.</summary>
[JsonSourceGenerationOptions(RespectNullableAnnotations = true, RespectRequiredConstructorParameters = true)]
[JsonSerializable(typeof(EnrolRequest))]
... one [JsonSerializable(typeof(X))] line for every record and enum, in the order they were written ...
public partial class ApiJsonContext : JsonSerializerContext
{
}
```

### 6.5 `ApiClient.g.cs` layout

Parts joined with `'\n\n'`, ending with one `\n`: `HEADER`, `#nullable enable`, `namespace ScreenTime.Core.Api;`, then the class:

```csharp
/// <summary>
/// The kid-device routes of the Screen Time API (docs/SPEC.md §9) for the Windows app. Each call throws
/// <see cref="ApiException"/> when the server answers with an error. <c>token</c> gives the device token, or null before enrolment.
/// </summary>
public sealed class ApiClient(HttpClient http, Func<string?> token) : ApiClientBase(http, token)
{
    /// <summary>Enrol a kid device with a code.</summary>
    /// <remarks><c>POST /v1/enrol</c></remarks>
    public Task<EnrolResponse> PostEnrolAsync(EnrolRequest body, CancellationToken cancellationToken = default) =>
        SendAsync(HttpMethod.Post, "v1/enrol", auth: false, body, ApiJsonContext.Default.EnrolRequest, ApiJsonContext.Default.EnrolResponse, cancellationToken);

    ... one method per operation, with one blank line between them ...
}
```

For each operation:

- **Name**: Kotlin's name (`postEnrol`, `getDeviceState`, `postDeviceSosLocations`, …) in PascalCase plus `Async`. Same rule: drop `/v1`, join the fixed segments, add `by id` if the path ends with a parameter.
- **Summary**: `/// <summary>${summary}.</summary>` with `&`, `<` and `>` escaped as `&amp;` `&lt;` `&gt;`, then `/// <remarks><c>${METHOD} ${path}</c></remarks>` (METHOD in capitals, the contract path).
- **Parameters**, in this order: each path parameter as `string name`; `TBody body` if there is a JSON request body; `string? ifNoneMatch = null` if the operation has a `304` response; always `CancellationToken cancellationToken = default` last. Any parameter that is not in the path throws `${METHOD} ${path}: unsupported parameter in ${in}`.
- **Result**: the schema of the first `2xx` response with `application/json`. None → `Task`. With a `304` → `Task<Conditional<T>>`. Otherwise `Task<T>`.
- **Path argument**: the contract path without its leading `/`. With path parameters it is an interpolated string, each `{id}` becoming `{Uri.EscapeDataString(id)}`: `$"v1/device/sos/{Uri.EscapeDataString(id)}/end"`. Without, a plain string `"v1/enrol"`.
- **`auth:`** is `true` when the operation has a non-empty `security`, else `false`.
- **Body line** (8 spaces), one of:
  - body and result: `SendAsync(HttpMethod.Post, path, auth: x, body, ApiJsonContext.Default.<Body>, ApiJsonContext.Default.<Result>, cancellationToken);`
  - result only: `SendAsync(HttpMethod.Get, path, auth: x, ApiJsonContext.Default.<Result>, cancellationToken);`
  - body only: `SendAsync(HttpMethod.Put, path, auth: x, body, ApiJsonContext.Default.<Body>, cancellationToken);`
  - neither: `SendAsync(HttpMethod.Post, path, auth: x, cancellationToken);`
  - `304`: `GetConditionalAsync(path, auth: x, ifNoneMatch, ApiJsonContext.Default.<Result>, cancellationToken);`

  `HttpMethod.Get`/`Post`/`Put`/`Patch`/`Delete` from the method.

### 6.6 `server/scripts/csharp-client.ts`

Like `kotlin-client.ts`: read the contract, call `generateCSharp`, write `windows/src/ScreenTime.Core/Api/ApiModels.g.cs` and `ApiClient.g.cs`, and print `wrote …`. In `server/package.json` the `contract` script becomes:

```json
"contract": "tsx scripts/export-openapi.ts && tsx scripts/kotlin-client.ts && tsx scripts/csharp-client.ts"
```

### 6.7 `windows/src/ScreenTime.Core/Api/ApiSupport.cs` (hand-written)

Namespace `ScreenTime.Core.Api`, with `using System.Net.Http.Headers;`, `using System.Net.Http.Json;`, `using System.Text.Json;` and `using System.Text.Json.Serialization.Metadata;`. One `///` summary per public type and member. Exactly these names and signatures (the method bodies are yours):

```csharp
public sealed class ApiException(int status, ErrorResponseError? error) : Exception(error?.Message ?? $"The server answered {status}.")
{
    public int Status { get; } = status;
    public ErrorResponseError? Error { get; } = error;
}

public sealed record Conditional<T>(T? Value, string? ETag, string? Date) where T : class;

public abstract class ApiClientBase(HttpClient http, Func<string?> token)
{
    protected Task<TResult> SendAsync<TBody, TResult>(HttpMethod method, string path, bool auth, TBody body, JsonTypeInfo<TBody> bodyType, JsonTypeInfo<TResult> resultType, CancellationToken cancellationToken);
    protected Task<TResult> SendAsync<TResult>(HttpMethod method, string path, bool auth, JsonTypeInfo<TResult> resultType, CancellationToken cancellationToken);
    protected Task SendAsync<TBody>(HttpMethod method, string path, bool auth, TBody body, JsonTypeInfo<TBody> bodyType, CancellationToken cancellationToken);
    protected Task SendAsync(HttpMethod method, string path, bool auth, CancellationToken cancellationToken);
    protected Task<Conditional<TResult>> GetConditionalAsync<TResult>(string path, bool auth, string? ifNoneMatch, JsonTypeInfo<TResult> resultType, CancellationToken cancellationToken) where TResult : class;
}
```

Behaviour (put the shared part in one private method):

1. `new HttpRequestMessage(method, path)`: a **relative** URI, so `HttpClient.BaseAddress` (which ends with `/`) comes in front.
2. If `auth` and `token()` is not null: `Authorization: Bearer <token>`. Otherwise no `Authorization` header.
3. A body: `request.Content = JsonContent.Create(body, bodyType)`. No body: no `Content` at all.
4. `ifNoneMatch` not null: `request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch)`.
5. Send with `http.SendAsync(request, cancellationToken)` and dispose the response.
6. For `GetConditionalAsync`, a `304` returns `new Conditional<TResult>(null, etag, date)`.
7. Any other status outside 200–299 throws `ApiException((int)status, error)`. `error` is the body read with `JsonSerializer.Deserialize(text, ApiJsonContext.Default.ErrorResponse)?.Error`, or `null` when the body is empty or is not that JSON (catch `JsonException` only for that).
8. A result: `await response.Content.ReadFromJsonAsync(resultType, cancellationToken)`. When it gives `null`, throw `new JsonException("The server sent null.")`. A `JsonException` here is **not** caught.
9. `GetConditionalAsync` success returns `new Conditional<TResult>(value, etag, date)`.
10. `etag` and `date` are the **raw** header text: `response.Headers.TryGetValues("ETag", out var v) ? v.First() : null` (same for `"Date"`). Do not use `Headers.ETag` or `Headers.Date`.

### 6.8 Files

1. `server/test/csharp-client.test.ts`: copy 5.2.
2. `windows/tests/ScreenTime.Core.Tests/ApiClientTests.cs`: copy 5.1.
3. `server/scripts/csharp-gen.ts`: write (6.1 to 6.5).
4. `server/scripts/csharp-client.ts`: write (6.6).
5. `server/package.json`: the one `contract` line (6.6).
6. `windows/src/ScreenTime.Core/Api/ApiSupport.cs`: write (6.7).
7. `windows/src/ScreenTime.Core/Api/ApiModels.g.cs` and `ApiClient.g.cs`: written by `pnpm contract`, **never by hand**.
8. `server/scripts/kotlin-gen.ts`: only if you must add `export` to its types (no other change). Say so under Deviations.

## 7. Steps

1. `git checkout main`, `git pull`, `git checkout -b bob/card-046-cs-client`. Check `docs/cards/CARD-046-cs-client.md` exists.
2. Copy 5.1 and 5.2. Run both fingerprints (8.1) **once**.
3. Write `csharp-gen.ts` and `csharp-client.ts`, change the `contract` line.
4. In `server/`: `pnpm contract`. Then `git status --short` must show only the new and changed files of 6.8 (if `contract/openapi.json` or a Kotlin file changes, **stop**: your `main` is out of date or something is wrong; paste `git diff --stat` and ask).
5. Run `pnpm contract` a second time. `git status --short` must be the same as after step 4 (no new changes).
6. In `server/`: `pnpm typecheck` and `pnpm test` until both pass (the database tests need Postgres as usual; if it is not running, run `pnpm vitest run test/csharp-client.test.ts test/kotlin-client.test.ts` and say so). Fix the generator, never the test.
7. Write `ApiSupport.cs`. In `windows/`: `dotnet build ScreenTime.slnx -c Release`, then `dotnet test --solution ScreenTime.slnx -c Release --no-build`, until both pass. A compile error **in a generated file** means the generator is wrong: fix `csharp-gen.ts` and run `pnpm contract` again. Never edit a `.g.cs` file.
8. Commit `CARD-046: Windows: C# API client`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] Fingerprints. From the repo root, run this **once** and paste the output. It prints two hashes and `True` twice. If one is `False`, copy that file again once and re-run; still `False`: paste it and carry on.
  ```powershell
  function Fp($p, $want) {
    $b = [IO.File]::ReadAllBytes($p) | Where-Object { $_ -ne 13 }
    $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
    $h; $h -eq $want
  }
  Fp "windows\tests\ScreenTime.Core.Tests\ApiClientTests.cs" "86b26213e172cce18a3466fb0a0658a43fe3eda38ca0a84e2ce5087c26b5de49"
  Fp "server\test\csharp-client.test.ts" "c6d0057b05833de3f0a65043fe1dff505306fb78857fee6b1efdb774cbc25c39"
  ```
- [ ] `pnpm contract` run twice; paste both `git status --short` outputs (they are the same).
- [ ] `pnpm typecheck` passes; `pnpm test` passes (paste the summary lines, including the `csharp-client.test.ts (4 tests)` line).
- [ ] `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors (warnings are errors, so a success means 0 warnings).
- [ ] `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 51 or more** (41 before + 10 `ApiClientTests`). Paste the summary lines.
- [ ] `Select-String -Path windows\src\ScreenTime.Core\Api\*.cs -Pattern 'JsonSerializerOptions|GetType\(\)|typeof\(object\)'` prints nothing (no reflection JSON).

### 8.2 Repo

- [ ] `git status` clean (no `bin\`, `obj\`, `TestResults\`).
- [ ] CI **TypeScript** and **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 8 files (9 if you had to export the types in `kotlin-gen.ts`):
  ```
  server/package.json
  server/scripts/csharp-client.ts
  server/scripts/csharp-gen.ts
  server/test/csharp-client.test.ts
  windows/src/ScreenTime.Core/Api/ApiClient.g.cs
  windows/src/ScreenTime.Core/Api/ApiModels.g.cs
  windows/src/ScreenTime.Core/Api/ApiSupport.cs
  windows/tests/ScreenTime.Core.Tests/ApiClientTests.cs
  ```

## 9. Tests

- `csharp-client.test.ts` (4 tests): the committed `.g.cs` files match the generator; 14 methods with exact lines for enrol, state and SOS end; exact record, enum and context lines; only device schemas are read, unknown schemas and name clashes throw.
- `ApiClientTests` (10 tests) run the generated client against a fake `HttpMessageHandler`: the enrol body and URL, a required null sent as `null`, an optional null left out, `If-None-Match` and a `304`, a full `DeviceState`, a missing required field throws `JsonException`, an error body becomes `ApiException` with the server's code, an error without JSON keeps its status, an escaped path id with no body, and the enum words.

## 10. Git and pull request

Push `bob/card-046-cs-client` and open the PR with `gh pr create --base main --title "CARD-046: Windows: C# API client" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body says what the card asked for, lists the files, and gives the test summary lines. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". Never change a test.

- **A copied C# test does not compile** and the error is in the test file itself (not a missing type or member your code should give): paste the full error and stop. The card may be wrong; Claude fixes it.
- **`JsonStringEnumMemberName`, `RespectNullableAnnotations` or `RespectRequiredConstructorParameters` "not found"**: paste `dotnet --version` and the error, then stop. They exist in .NET 9 and later.
- **The drift test fails on "matches the committed"**: run `pnpm contract` again and commit the `.g.cs` files. Never edit them by hand.
- **A warning fails the build**: fix the generator or `ApiSupport.cs`. No `#pragma warning disable`, no `NoWarn`.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- For an emulator or device run, paste the real output of **every** step (every `Screen-Text`, helper and script line). "The screenshots are the evidence" or "from earlier in the session" is not accepted: a step without its pasted output counts as `NOT RUN`, and Claude sends the PR back.
- Every workaround (force-stop, app restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-046. Please review and merge if it is good.

CARD: CARD-046 Windows: C# API client
PR: <full PR URL>
Branch: bob/card-046-cs-client
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
