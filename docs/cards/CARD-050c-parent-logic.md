# CARD-050c: Windows: the logic behind parent mode

| Field | Value |
|---|---|
| Card | CARD-050c |
| Title | Windows: the logic behind parent mode |
| Size | M |
| Depends on | CARD-050b and the tray's parent mode front end (PR #136, by Claude), both merged to `main` |
| Spec sections | docs/SPEC.md §12.3 (parent mode, as built in CARD-037), §16.3 (Windows tray), §12.2 (pipe) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-050c-parent-logic` |
| PR title | `CARD-050c: Windows: the logic behind parent mode` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

`AGENTS.md` rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command**. Rule 10: never change Claude's front-end files.

**Parent mode** (docs/SPEC.md §12.3) makes one kid device unlocked and not counting for a chosen time. On the device the kid taps **I'm the parent**: every parent is asked to approve, or a parent types the **parent code**, a 6-digit TOTP (RFC 6238, SHA-1, 30 s steps, one step either side accepted) made from the family secret `family.parentCodeSecret` in the state snapshot. After a right code the device asks "How long?" (2, 5, 15 or 60 minutes, or "Until I end it"), starts parent mode itself, and reports it to the server until the server has it. **End now** stops it.

**Claude's front end is on `main` (PR #136).** The tray's flyout has the parent mode panel and **End now**, behind the seam `ITraySender` (`RequestParentModeAsync`, `CheckParentCodeAsync`, `StartParentModeAsync`, `EndParentModeAsync`) and `TrayModel.ParentModeNo(text)`. These are Claude's files: do not change them.

This card writes the **logic** in `ScreenTime.Core` (plain C#, tested in CI). It is the Windows twin of the Android kid app's `android/app-kid/src/main/kotlin/au/screentime/kid/parentmode/ParentMode.kt`, which you can read for reference:

1. `Totp`: base32 and the parent code.
2. `CodeSession`, `LocalParentMode`, `ParentModeOn` and `ParentModes.Now(...)`: whether parent mode is on, from the snapshot and from what this PC did itself.
3. `ParentModes.Effective(...)`: the snapshot with parent mode as it is now, so `LockKeeper` and `TrayStatusBuilder` need no change.
4. `Live.ParentModeAnswer(frame)` and `ParentModes.NoText(...)`: a parent's yes or no from the live channel.
5. Six pipe lines for the parent panel.

The next card (CARD-050d) wires these into the service and the tray, stops counting during parent mode, and does the run. **This card has no service or tray change and no PC run.**

## 2. Goal

- The pieces exist and pass the 20 new test cases in section 5.
- `dotnet build` and `dotnet test` pass in `windows/`: **total 236** (216 before + 20). CI **Windows / build and test** is green.

## 3. Out of scope

- Any change to `ScreenTime.Service` or `ScreenTime.Tray`: that is CARD-050d.
- Any change to Claude's files, `LockKeeper.cs`, `TrayStatusBuilder.cs`, the generated API files, the test csproj, any workflow or the server. No new packages.
- Do not remove or rename anything already in `PipeMessage` or `Live`.

## 4. Tech

- .NET 10, nullable on, warnings are errors. `ScreenTime.Core` is `IsAotCompatible`: no reflection. HMAC-SHA1 is `System.Security.Cryptography.HMACSHA1.HashData(key, data)` (in .NET, no package).
- **A record cannot have a property and a static method with the same name** (`CS0102`). The new factories (`ParentAsk`, `ParentCode`, `ParentStart`, `ParentEnd`, `Done`, `ParentNo`) do not clash with any property. Use exactly these names, and name the TOTP class `Totp` (a class called `ParentCode` would clash with the factory's name in reading).
- Times are epoch milliseconds of the trusted clock, as everywhere in `ScreenTime.Core`.

## 5. Files to copy

Copy this file exactly, byte for byte. 8.1 checks the fingerprint. It is the contract: never change it.

### 5.1 `windows/tests/ScreenTime.Core.Tests/ParentModeTests.cs`

```csharp
using System.Text;
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-050c: parent mode on Windows (docs/SPEC.md §12.3), the same rules as Android's ParentMode.kt. Copied verbatim from the card.</summary>
public class ParentModeTests
{
    /// <summary>The RFC 6238 test key, "12345678901234567890", in base32.</summary>
    private const string RfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    private static readonly DeviceStateParentMode Off = new(false, null, null);

    [Fact]
    public void Base32IsDecodedInAnyCaseWithPadding()
    {
        Assert.Equal(Encoding.ASCII.GetBytes("12345678901234567890"), Totp.Base32Decode(RfcSecret));
        Assert.Equal(Encoding.ASCII.GetBytes("12345678901234567890"), Totp.Base32Decode(RfcSecret.ToLowerInvariant()));
        Assert.Equal(Encoding.ASCII.GetBytes("f"), Totp.Base32Decode("MY======"));
        Assert.Equal(Encoding.ASCII.GetBytes("foobar"), Totp.Base32Decode("MZXW6YTBOI======"));
        Assert.Null(Totp.Base32Decode("MZXW1"));
    }

    [Theory]
    [InlineData(59_000L, "287082")]
    [InlineData(1_111_111_109_000L, "081804")]
    [InlineData(1_111_111_111_000L, "050471")]
    [InlineData(1_234_567_890_000L, "005924")]
    [InlineData(2_000_000_000_000L, "279037")]
    [InlineData(20_000_000_000_000L, "353130")]
    public void TheCodesAreTheRfc6238OnesCutToSixDigits(long timeMs, string expected) =>
        Assert.Equal(expected, Totp.Code(Totp.Base32Decode(RfcSecret)!, timeMs));

    [Fact]
    public void ACodeIsGoodForOneStepEitherSide()
    {
        const long now = 1_111_111_109_000L;
        Assert.True(Totp.Ok(RfcSecret, "081804", now));
        Assert.True(Totp.Ok(RfcSecret, "081804", now + 30_000L));
        Assert.True(Totp.Ok(RfcSecret, "081804", now - 30_000L));
        Assert.False(Totp.Ok(RfcSecret, "081804", now + 60_000L));
        Assert.False(Totp.Ok(RfcSecret, "081805", now));
        Assert.False(Totp.Ok(RfcSecret, "81804", now));
        Assert.False(Totp.Ok(RfcSecret, "08180a", now));
        Assert.False(Totp.Ok("not base32!", "081804", now));
        Assert.False(Totp.Ok("", "081804", now));
    }

    [Fact]
    public void TheSnapshotSaysWhenAParentTurnedItOn()
    {
        var now = Ms("2026-10-27T05:00:00Z");
        var on = new DeviceStateParentMode(true, "2026-10-27T05:15:00.000Z", "Dad");
        Assert.Equal(new ParentModeOn(Ms("2026-10-27T05:15:00Z"), "Dad"), ParentModes.Now(on, now - 1_000, new LocalParentMode(), now));
        Assert.Null(ParentModes.Now(on, now - 1_000, new LocalParentMode(), Ms("2026-10-27T05:15:00Z")));
        var forever = new DeviceStateParentMode(true, null, "Mum");
        Assert.Equal(new ParentModeOn(null, "Mum"), ParentModes.Now(forever, now, new LocalParentMode(), now + 86_400_000L));
        Assert.Null(ParentModes.Now(Off, now, new LocalParentMode(), now));
    }

    [Fact]
    public void ACodeSessionCountsUntilTheSnapshotHasIt()
    {
        var start = Ms("2026-10-27T05:00:00Z");
        var code = new CodeSession("c1", 15, start);
        var local = new LocalParentMode(code);
        Assert.Equal(new ParentModeOn(start + 15 * 60_000L, null), ParentModes.Now(Off, start - 60_000L, local, start + 60_000L));
        Assert.Null(ParentModes.Now(Off, start - 60_000L, local, start + 15 * 60_000L));
        var sent = new LocalParentMode(code with { ReportedAtMs = start + 60_000L });
        Assert.Equal(new ParentModeOn(start + 15 * 60_000L, null), ParentModes.Now(Off, start, sent, start + 120_000L));
        Assert.Null(ParentModes.Now(Off, start + 90_000L, sent, start + 120_000L));
        var forever = new LocalParentMode(new CodeSession("c2", null, start));
        Assert.Equal(new ParentModeOn(null, null), ParentModes.Now(Off, start, forever, start + 86_400_000L));
        Assert.True(local.Pending);
        Assert.False(sent.Pending);
    }

    [Fact]
    public void EndNowBeatsOlderSnapshotsAndCodeSessions()
    {
        var now = Ms("2026-10-27T05:00:00Z");
        var on = new DeviceStateParentMode(true, null, "Dad");
        var ended = new LocalParentMode(EndedAtMs: now, EndReported: false);
        Assert.Null(ParentModes.Now(on, now - 1_000, ended, now + 1_000));
        Assert.Equal(new ParentModeOn(null, "Dad"), ParentModes.Now(on, now + 5_000, ended, now + 6_000));
        var before = ended with { Code = new CodeSession("c1", null, now - 60_000L) };
        Assert.Null(ParentModes.Now(Off, now - 120_000L, before, now + 1_000));
        var after = ended with { Code = new CodeSession("c2", 5, now + 1_000) };
        Assert.Equal(new ParentModeOn(now + 1_000 + 5 * 60_000L, null), ParentModes.Now(Off, now - 120_000L, after, now + 2_000));
        Assert.True(ended.Pending);
    }

    [Fact]
    public void TheEffectiveStateCarriesParentModeForEveryoneElse()
    {
        // The snapshot was made at 2026-10-25T23:00:00Z (SyncTestData), with parent mode off.
        var state = State();
        var start = Ms("2026-10-25T23:01:00Z");
        var local = new LocalParentMode(new CodeSession("c1", 15, start));
        var on = ParentModes.Effective(state, local, start + 1_000);
        Assert.Equal(new DeviceStateParentMode(true, "2026-10-25T23:16:00.000Z", null), on.ParentMode);
        Assert.True(LockKeeper.ParentModeOn(on, start + 1_000));
        Assert.Equal(state with { ParentMode = on.ParentMode }, on);

        var over = ParentModes.Effective(state, local, start + 15 * 60_000L);
        Assert.Equal(new DeviceStateParentMode(false, null, null), over.ParentMode);
        Assert.Same(state.Today, over.Today);
    }

    [Theory]
    [InlineData("""{"v":1,"type":"parent_mode","at":"2026-10-27T05:00:00Z","data":{"active":false,"endsAt":null,"byName":"Dad","requestId":"r1"}}""", false, "Dad", "r1")]
    [InlineData("""{"v":1,"type":"parent_mode","at":"2026-10-27T05:00:00Z","data":{"active":true,"endsAt":"2026-10-27T05:15:00.000Z","byName":"Mum","requestId":null}}""", true, "Mum", null)]
    public void AParentsAnswerIsRead(string frame, bool active, string byName, string? requestId)
    {
        var answer = Live.ParentModeAnswer(frame);
        Assert.NotNull(answer);
        Assert.Equal(active, answer.Active);
        Assert.Equal(byName, answer.ByName);
        Assert.Equal(requestId, answer.RequestId);
    }

    [Theory]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-27T05:00:00Z","data":{"active":false}}""")]
    [InlineData("""{"v":1,"type":"parent_mode","at":"2026-10-27T05:00:00Z"}""")]
    [InlineData("""{"v":1,"type":"parent_mode","at":"2026-10-27T05:00:00Z","data":{"endsAt":null}}""")]
    [InlineData("not json")]
    public void OtherFramesAreNoParentModeAnswer(string frame) => Assert.Null(Live.ParentModeAnswer(frame));

    [Fact]
    public void ANoNamesWhoSaidIt()
    {
        Assert.Equal("Dad said no.", ParentModes.NoText("Dad", ["Mum", "Dad"]));
        Assert.Equal("Mum or Dad said no.", ParentModes.NoText(null, ["Mum", "Dad"]));
    }

    [Fact]
    public void TheParentPipeLinesAreCompact()
    {
        Assert.Equal("""{"type":"parent-ask","id":"p1"}""", PipeMessage.Encode(PipeMessage.ParentAsk("p1")));
        Assert.Equal("""{"type":"parent-code","id":"p2","text":"081804"}""", PipeMessage.Encode(PipeMessage.ParentCode("p2", "081804")));
        Assert.Equal("""{"type":"parent-start","id":"p3","minutes":15}""", PipeMessage.Encode(PipeMessage.ParentStart("p3", 15)));
        Assert.Equal("""{"type":"parent-start","id":"p3"}""", PipeMessage.Encode(PipeMessage.ParentStart("p3", null)));
        Assert.Equal("""{"type":"parent-end","id":"p4"}""", PipeMessage.Encode(PipeMessage.ParentEnd("p4")));
        Assert.Equal("""{"type":"done","id":"p2","approved":false}""", PipeMessage.Encode(PipeMessage.Done("p2", false)));
        Assert.Equal("""{"type":"parent-no","text":"Dad said no."}""", PipeMessage.Encode(PipeMessage.ParentNo("Dad said no.")));
        foreach (var m in new[] { PipeMessage.ParentStart("p3", null), PipeMessage.Done("p2", true), PipeMessage.ParentCode("p2", "000000") })
        {
            Assert.Equal(m, PipeMessage.Decode(PipeMessage.Encode(m)));
        }
    }
}
```

## 6. What to write

### 6.1 `windows/src/ScreenTime.Core/Service/ParentMode.cs` (new, `namespace ScreenTime.Core.Service`)

Give every public type and member a one-line `/// <summary>`. It holds these types:

**a. `public static class Totp`**

| Member | What it does |
|---|---|
| `public static byte[]? Base32Decode(string text)` | RFC 4648 base32 (`A`–`Z`, `2`–`7`), any case (`char.ToUpperInvariant`), `=` skipped. Any other character → `null`. Keep a 16-bit buffer: for each value, `buffer = ((buffer << 5) \| value) & 0xFFFF; bits += 5;` and when `bits >= 8`: `bits -= 8;` output the byte `(buffer >> bits) & 0xFF`. |
| `public static string Code(byte[] key, long timeMs)` | The 6-digit code for the 30 s step that holds `timeMs`. The step is `floor(timeMs / 30_000)` as an 8-byte **big-endian** counter. `hash = HMACSHA1.HashData(key, counter)`; `at = hash[^1] & 0x0F`; `number = ((hash[at] & 0x7F) << 24) \| (hash[at+1] << 16) \| (hash[at+2] << 8) \| hash[at+3]`; return `(number % 1_000_000)` as 6 digits with leading zeros (`ToString("D6", CultureInfo.InvariantCulture)`). |
| `public static bool Ok(string secret, string code, long nowMs)` | False when the secret does not decode or decodes to nothing, or `code` is not exactly 6 ASCII digits. Otherwise true when `code` equals `Code(key, nowMs + i * 30_000)` for `i` = −1, 0 or 1. |

**b. The records:**

```csharp
public sealed record CodeSession(string Id, int? DurationMin, long StartedAtMs, long? ReportedAtMs = null)
{
    public long? EndsAtMs { get; }        // StartedAtMs + DurationMin minutes; null for "Until I end it"
}

public sealed record LocalParentMode(CodeSession? Code = null, long? EndedAtMs = null, bool EndReported = true)
{
    public bool Pending { get; }          // (Code is not null and Code.ReportedAtMs is null) or !EndReported
}

public sealed record ParentModeOn(long? EndsAtMs, string? ByName);

public sealed record ParentModeAnswer(bool Active, string? EndsAt, string? ByName, string? RequestId);
```

(`EndsAtMs` and `Pending` are expression-bodied properties: `=> …`.) A `CodeSession` is parent mode started on this PC with the parent code; `ReportedAtMs` is set once the server has it. `LocalParentMode` is what this PC did that the server may not know yet; `EndedAtMs` is when **End now** was last pressed here.

**c. `public static class ParentModes`**

`public static ParentModeOn? Now(DeviceStateParentMode server, long serverTimeMs, LocalParentMode local, long nowMs)`: whether parent mode is on at `nowMs`, from the snapshot `server` (made at `serverTimeMs`) or from this PC. The same steps as Android's `parentModeNow`:

1. `ended = local.EndedAtMs`.
2. When `local.Code` is set and (`ended` is null or `ended < Code.StartedAtMs`): `notInSnapshot` is true when `Code.ReportedAtMs` is null or `serverTimeMs < Code.ReportedAtMs`. When `notInSnapshot` and (`Code.EndsAtMs` is null or `nowMs < Code.EndsAtMs`): return `new ParentModeOn(Code.EndsAtMs, null)`.
3. When `!server.Active`, or `ended` is set and `serverTimeMs <= ended`: return `null`.
4. `serverEnds` = `server.EndsAt` parsed (`DateTimeOffset.Parse(…, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds()`), or null. Return `new ParentModeOn(serverEnds, server.ByName)` when `serverEnds` is null or `nowMs < serverEnds`; otherwise `null`.

`public static DeviceState Effective(DeviceState state, LocalParentMode local, long nowMs)`: the snapshot with `ParentMode` as it is now. `serverTimeMs` is `state.ServerTime` parsed the same way. When `Now(...)` is null: `new DeviceStateParentMode(false, null, null)`. Otherwise `new DeviceStateParentMode(true, endsAt, on.ByName)`, where `endsAt` is `on.EndsAtMs` written as UTC `yyyy-MM-dd'T'HH:mm:ss.fff'Z'` (`DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime.ToString(…, CultureInfo.InvariantCulture)`), or null. Return `state with { ParentMode = … }` (everything else is the same object).

`public static string NoText(string? byName, IReadOnlyList<string> parentNames)`: `"{byName} said no."`; when `byName` is null, `TrayText.Parents(parentNames, "or")` instead ("Mum or Dad said no."). `TrayText` is in `ScreenTime.Core.Tray`.

### 6.2 `windows/src/ScreenTime.Core/Service/Live.cs` (changed)

Add, at the end of the class:

```csharp
public static ParentModeAnswer? ParentModeAnswer(string frame);
```

The server sends `{"v":1,"type":"parent_mode","at":"…","data":{"active":false,"endsAt":null,"byName":"Dad","requestId":"r1"}}` when a parent says yes or no (or starts or ends parent mode from the app). Parse with `JsonDocument` (inside `using`), catch `JsonException`. Return null unless the root is an object whose `type` is the string `parent_mode`, with an object `data` whose `active` is `true` or `false`. Then return `new ParentModeAnswer(active, endsAt, byName, requestId)`, each of the three texts being the string in `data` or null when missing or not a string (a small private helper for that is fine).

### 6.3 `windows/src/ScreenTime.Core/Service/PipeMessage.cs` (changed)

Add six factories next to the others. No new record parameters: they use `Id`, `Text`, `Minutes` and `Approved`.

| Factory | Type | Sets | Direction and meaning |
|---|---|---|---|
| `ParentAsk(string id)` | `parent-ask` | `Id` | Tray to service: "I'm the parent", ask every parent. |
| `ParentCode(string id, string code)` | `parent-code` | `Id`, `Text` = code | Tray to service: is this the parent code? |
| `ParentStart(string id, int? minutes)` | `parent-start` | `Id`, `Minutes` | Tray to service: start for that long; null is "Until I end it". |
| `ParentEnd(string id)` | `parent-end` | `Id` | Tray to service: End now. |
| `Done(string id, bool ok)` | `done` | `Id`, `Approved` = ok | Service to tray: the answer to `parent-code`, `parent-start` or `parent-end`. |
| `ParentNo(string text)` | `parent-no` | `Text` | Service to tray: "Dad said no." |

(The answer to `parent-ask` is the existing `Reply(id, SendResult)`.)

## 7. Steps

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-050c-parent-logic`. Check that `windows/src/ScreenTime.Tray/ITraySender.cs` contains `CheckParentCodeAsync`. If not, stop: PR #136 is not merged yet.
2. Copy the file in section 5. Run the fingerprint (8.1) **once**.
3. Write 6.1 to 6.3.
4. Build and test from `windows\` until all pass. When an error is not clear to you after one try, paste it in the handback and stop.
5. Run the rest of 8.1 and 8.2.
6. Commit `CARD-050c: Windows: the logic behind parent mode`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: one line ending in `True`.
  ```powershell
  $root = (Get-Location).Path
  $b = [IO.File]::ReadAllBytes("$root\windows\tests\ScreenTime.Core.Tests\ParentModeTests.cs") | Where-Object { $_ -ne 13 }
  $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
  "ParentModeTests.cs $h $($h -eq 'cae6aaaafbad165d474523a9f89bd260bf900356fbf8581bc8e94691193f3baa')"
  ```
- [ ] From `windows\`: `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] From `windows\`: `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 236**. Paste the summary lines.
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Core\Service\*.cs -Pattern 'DateTime\.Now|UtcNow|TickCount|DllImport'` prints nothing.

### 8.2 Repo

- [ ] `git status` clean. No `bin\`, `obj\` or `*.log` in the repo.
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 4 files:
  ```
  windows/src/ScreenTime.Core/Service/Live.cs
  windows/src/ScreenTime.Core/Service/ParentMode.cs
  windows/src/ScreenTime.Core/Service/PipeMessage.cs
  windows/tests/ScreenTime.Core.Tests/ParentModeTests.cs
  ```

### 8.3 Run on James's PC

None in this card. Write `8.3: none in this card` in the handback.

## 9. Tests

| File | Tests | What it checks |
|---|---|---|
| `ParentModeTests` | 20 cases | Base32 in any case with padding; the six RFC 6238 codes cut to six digits; a code is good one step either side and nothing else is; the snapshot's parent mode and its end; a code session until the snapshot has it, and `Pending`; End now beats older snapshots and code sessions; the effective snapshot (and that `LockKeeper` sees it); two parent answers; four frames that are none; the "said no" text; the six parent pipe lines and reading them back. |

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-050c-parent-logic
   ```
2. Commit with the message `CARD-050c: Windows: the logic behind parent mode`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-050c-parent-logic`
5. Write the PR body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` and open the PR with `gh pr create --base main --title "CARD-050c: Windows: the logic behind parent mode" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body:
   ```markdown
   ## Card
   docs/cards/CARD-050c-parent-logic.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] criterion 1 — output: `...`
   - [x] criterion 2 — output: `...`

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Never change the copied test or one of Claude's front-end files.

- **The copied test does not compile**, and the error is in the test file: paste the full error and stop. The card may be wrong.
- **A code test fails** (`287082` and friends): check the counter is big-endian and the step is `timeMs / 30_000`; read Android's `parentCode` in `ParentMode.kt` once. If it still fails, paste the output and stop.
- **`CS0102` on `PipeMessage`**: a factory has the same name as a property. Use exactly the names in 6.3.
- **An AOT or trim warning (`IL…`)**: paste it and stop. No `NoWarn`, no `#pragma`.
- **A test fails and you cannot see why after one careful read of section 6**: paste the failing test's output and stop.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- Every workaround (restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-050c. Please review and merge if it is good.

CARD: CARD-050c Windows: the logic behind parent mode
PR: <full PR URL>
Branch: bob/card-050c-parent-logic
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

8.3: none in this card

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
