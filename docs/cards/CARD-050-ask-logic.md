# CARD-050: Windows: the logic behind Ask and Message

| Field | Value |
|---|---|
| Card | CARD-050 |
| Title | Windows: the logic behind Ask and Message |
| Size | S |
| Depends on | CARD-049b and the tray's Ask and Message front end (PR #130, by Claude), both merged to `main` |
| Spec sections | docs/SPEC.md §16.2 (Ask and Message sheets, as built in CARD-035), §16.3 (Windows tray), §12.2 (pipe) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-050-ask-logic` |
| PR title | `CARD-050: Windows: the logic behind Ask and Message` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

`AGENTS.md` rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command**. Rule 10: never change Claude's front-end files.

**Claude's front end is on `main` (PR #130).** The tray's flyout now has an **Ask for more time** panel (15 min, 30 min or 1 hour, and a reason) and a **Message** panel (the family's presets, or the kid's own words). They send through the seam `TrayModel.Sender` (`ITraySender`) and show answers through `TrayModel.Answer`. In `ScreenTime.Core/Tray/TrayStatus.cs`, Claude added to `TrayStatus` two last parameters, `Presets` (a list of `TrayPreset(Id, Text)`) and `PendingMinutes`, and the enum `SendResult { Sent, AlreadyAsked, Offline }`. These are Claude's files: do not change them.

This card writes the **logic** in `ScreenTime.Core` (plain C#, tested in CI):

1. `TrayStatusBuilder.From` fills `Presets` and `PendingMinutes`.
2. `RequestAnswer` and `Live.Answer(frame)`: read a parent's answer from the live channel's `request_resolved` message, and word it like Android ("Dad said yes! +30 min 🎉").
3. Four new pipe messages: `ask` and `message` (tray to service), `reply` and `answer` (service to tray).
4. `SendResults.Of(exception)`: a 409 from the server means "already asked"; anything else means "can't reach".

The next card (CARD-050b) wires these into the service and the tray and does the run. **This card has no service or tray change and no PC run.**

## 2. Goal

- The four pieces exist and pass the 15 new test cases in section 5.
- `dotnet build` and `dotnet test` pass in `windows/`: **total 210** (195 before + 15). CI **Windows / build and test** is green.

## 3. Out of scope

- Any change to `ScreenTime.Service` or `ScreenTime.Tray`: that is CARD-050b.
- Any change to Claude's files: `TrayStatus.cs` (with `TrayPreset` and `SendResult`), `TrayStatusTests.cs`, anything in `ScreenTime.Tray`.
- Parent mode (CARD-050c). No new packages, no change to the generated API files, the test csproj, any workflow or the server.
- Do not remove or rename anything already in `PipeMessage` or `Live`.

## 4. Tech

- .NET 10, nullable on, warnings are errors. `ScreenTime.Core` is `IsAotCompatible`: no reflection, JSON only through source-generated contexts (`PipeJsonContext` already exists) or `JsonDocument`.
- **A record cannot have a property and a static method with the same name** (`CS0102`). The new factories are named so they never clash: `Ask`, `Message`, `Reply`, `Answer`, while the new properties are `Minutes`, `Reason`, `PresetId`, `Result`, `Approved`. Use exactly these names.
- The JSON encoder writes `'` as `\u0027`. That is valid JSON and reads back the same, so do not try to change it (the tests allow for it).

## 5. Files to copy

Copy this file exactly, byte for byte. 8.1 checks the fingerprint. It is the contract: never change it.

### 5.1 `windows/tests/ScreenTime.Core.Tests/AskAndMessageTests.cs`

```csharp
using ScreenTime.Core.Api;
using ScreenTime.Core.Service;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-050: the logic behind the tray's Ask and Message panels (docs/SPEC.md §16.2, §16.3). Copied verbatim from the card.</summary>
public class AskAndMessageTests
{
    private static readonly long Noon = Ms("2026-10-26T01:00:00Z");

    private static EngineResult Open(long left) =>
        new(false, null, left, DateTimeOffset.FromUnixTimeMilliseconds(Noon + left * 1000), DateTimeOffset.FromUnixTimeMilliseconds(Noon + 60_000), 0, 0);

    [Fact]
    public void TheStatusCarriesThePresetsInOrder()
    {
        var state = State() with
        {
            MessagePresets = [new DeviceStateMessagePresetsItem("p1", "Can I have 5 more minutes?"), new DeviceStateMessagePresetsItem("p2", "I'm hungry")],
        };
        var s = TrayStatusBuilder.From(state, Open(600), Noon, true, Noon);
        Assert.Equal([new TrayPreset("p1", "Can I have 5 more minutes?"), new TrayPreset("p2", "I'm hungry")], s.Presets!);
        Assert.Null(s.PendingMinutes);
    }

    [Fact]
    public void TheStatusSaysWhenAnAskIsWaiting()
    {
        var state = State() with { PendingRequest = new DeviceStatePendingRequest("r1", 30, "2026-10-26T00:55:00.000Z") };
        var s = TrayStatusBuilder.From(state, Open(600), Noon, true, Noon);
        Assert.Equal(30, s.PendingMinutes);
        Assert.Empty(s.Presets!);
    }

    [Theory]
    [InlineData(true, 15, "Dad", "Dad said yes! +15 min 🎉")]
    [InlineData(true, 60, "Mum", "Mum said yes! +1h 🎉")]
    [InlineData(true, 90, "Dad", "Dad said yes! +1h 30m 🎉")]
    [InlineData(false, 0, "Dad", "Dad said not this time")]
    public void AnAnswerReadsLikeAndroid(bool approved, int minutes, string byName, string expected)
    {
        var frame = $$$"""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"requestId":"r1","approved":{{{(approved ? "true" : "false")}}},"minutes":{{{minutes}}},"byName":"{{{byName}}}","grant":null}}""";
        var answer = Live.Answer(frame);
        Assert.NotNull(answer);
        Assert.Equal(new RequestAnswer(approved, minutes, byName), answer);
        Assert.Equal(expected, answer.Text());
    }

    [Theory]
    [InlineData("""{"v":1,"type":"grant_added","at":"2026-10-26T01:00:00Z","data":{}}""")]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"approved":true}}""")]
    [InlineData("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z"}""")]
    [InlineData("not json")]
    [InlineData("[1]")]
    public void OtherFramesAreNoAnswer(string frame) => Assert.Null(Live.Answer(frame));

    [Fact]
    public void AnAnswerStillAsksForASync() =>
        Assert.True(Live.AsksForSync("""{"v":1,"type":"request_resolved","at":"2026-10-26T01:00:00Z","data":{"requestId":"r1","approved":true,"minutes":15,"byName":"Dad","grant":null}}"""));

    [Fact]
    public void TheNewPipeLinesAreCompact()
    {
        Assert.Equal("""{"type":"ask","id":"a1","minutes":30,"reason":"Homework"}""", PipeMessage.Encode(PipeMessage.Ask("a1", 30, "Homework")));
        Assert.Equal("""{"type":"ask","id":"a1","minutes":15}""", PipeMessage.Encode(PipeMessage.Ask("a1", 15, null)));
        Assert.Equal("""{"type":"message","id":"m1","text":"Hungry","presetId":"p2"}""", PipeMessage.Encode(PipeMessage.Message("m1", "p2", "Hungry")));
        Assert.Equal("""{"type":"message","id":"m1","text":"Hi"}""", PipeMessage.Encode(PipeMessage.Message("m1", null, "Hi")));
        Assert.Equal("""{"type":"reply","id":"a1","result":"AlreadyAsked"}""", PipeMessage.Encode(PipeMessage.Reply("a1", SendResult.AlreadyAsked)));
        Assert.Equal("""{"type":"answer","text":"Dad said not this time","approved":false}""", PipeMessage.Encode(PipeMessage.Answer("Dad said not this time", false)));
    }

    [Fact]
    public void TheNewPipeLinesReadBack()
    {
        foreach (var m in new[]
        {
            PipeMessage.Ask("a1", 60, "Please"),
            PipeMessage.Message("m1", "p1", "Can I have 5 more minutes?"),
            PipeMessage.Reply("m1", SendResult.Offline),
            PipeMessage.Answer("Mum said yes! +1h 🎉", true),
        })
        {
            Assert.Equal(m, PipeMessage.Decode(PipeMessage.Encode(m)));
        }
    }

    [Fact]
    public void ThereIsAlreadyAnAskIsNotAFailure()
    {
        Assert.Equal(SendResult.AlreadyAsked, SendResults.Of(new ApiException(409, null)));
        Assert.Equal(SendResult.Offline, SendResults.Of(new ApiException(500, null)));
        Assert.Equal(SendResult.Offline, SendResults.Of(new ApiException(400, null)));
        Assert.Equal(SendResult.Offline, SendResults.Of(new HttpRequestException("no route")));
        Assert.Equal(SendResult.Offline, SendResults.Of(new TaskCanceledException()));
    }
}
```

## 6. What to write

Give every public type and member a one-line `/// <summary>` like the files around it.

### 6.1 `windows/src/ScreenTime.Core/Tray/TrayStatusBuilder.cs` (changed)

At the end of the `new TrayStatus(...)` call, after `parentNames`, pass two more arguments:

- `Presets`: `state.MessagePresets.Select(p => new TrayPreset(p.Id, p.Text)).ToList()` (in the state's order).
- `PendingMinutes`: `state.PendingRequest?.Minutes`.

Nothing else in this file changes.

### 6.2 `windows/src/ScreenTime.Core/Service/RequestAnswer.cs` (new)

```csharp
namespace ScreenTime.Core.Service;

public sealed record RequestAnswer(bool Approved, int Minutes, string ByName)
{
    public string Text();
}
```

A parent's answer to the kid's "Ask for more time". `Text()` is the line the tray shows, the same as Android:

| Answer | Text |
|---|---|
| Yes, under 60 minutes | `"{ByName} said yes! +{Minutes} min 🎉"`, for example `Dad said yes! +15 min 🎉` |
| Yes, 60 minutes or more | `"{ByName} said yes! +{DurationFormat.Format(Minutes * 60L)} 🎉"`, for example `Mum said yes! +1h 🎉`, `Dad said yes! +1h 30m 🎉` |
| No | `"{ByName} said not this time"` |

(`DurationFormat` is `ScreenTime.Core.DurationFormat`. The 🎉 is one character, U+1F389.)

### 6.3 `windows/src/ScreenTime.Core/Service/Live.cs` (changed)

Add one method; change nothing else:

```csharp
public static RequestAnswer? Answer(string frame);
```

The server sends the answer on the live channel as `{"v":1,"type":"request_resolved","at":"…","data":{"requestId":"…","approved":true,"minutes":30,"byName":"Dad","grant":{…}|null}}`. Parse with `JsonDocument.Parse` (inside `using`) and return a `RequestAnswer` only when **all** of these hold, otherwise `null`:

- the root is an object whose `type` is the string `request_resolved`;
- it has an object `data`;
- `data.approved` is `true` or `false`;
- `data.minutes` is a number (read it with `GetInt32()`);
- `data.byName` is a string.

Catch `JsonException` (invalid JSON) and return `null`. `AsksForSync` stays as it is: a `request_resolved` frame still asks for a sync (the test checks it).

### 6.4 `windows/src/ScreenTime.Core/Service/PipeMessage.cs` (changed)

1. Add five last record parameters, after `TrayStatus? View = null`, in this order: `int? Minutes = null, string? Reason = null, string? PresetId = null, SendResult? Result = null, bool? Approved = null`. (`SendResult` is in `ScreenTime.Core.Tray`, already imported.)
2. Add four factories next to the others:

| Factory | Type | Sets | Direction and meaning |
|---|---|---|---|
| `Ask(string id, int minutes, string? reason)` | `ask` | `Id`, `Minutes`, `Reason` | Tray to service: "Ask for more time". |
| `Message(string id, string? presetId, string text)` | `message` | `Id`, `Text`, `PresetId` | Tray to service: a message to the parents. |
| `Reply(string id, SendResult result)` | `reply` | `Id`, `Result` | Service to tray: how the `ask` or `message` with this `id` went. |
| `Answer(string text, bool approved)` | `answer` | `Text`, `Approved` | Service to tray: a parent's answer, already worded. |

Nothing else changes: the JSON context already writes enums as names (`"AlreadyAsked"`) and leaves out nulls, which the tests check.

### 6.5 `windows/src/ScreenTime.Core/Tray/SendResults.cs` (new)

```csharp
namespace ScreenTime.Core.Tray;

public static class SendResults
{
    public static SendResult Of(Exception e);
}
```

How a failed send shows in the tray: an `ApiException` (`ScreenTime.Core.Api`) whose `Status` is `409` (an ask is already waiting) → `SendResult.AlreadyAsked`. Any other exception → `SendResult.Offline`.

## 7. Steps

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-050-ask-logic`. Check that `windows/src/ScreenTime.Core/Tray/TrayStatus.cs` contains `enum SendResult` and `record TrayPreset`. If not, stop: PR #130 is not merged yet.
2. Copy the file in section 5. Run the fingerprint (8.1) **once**.
3. Write 6.1 to 6.5.
4. Build and test from `windows\` until all pass. When an error is not clear to you after one try, paste it in the handback and stop.
5. Run the rest of 8.1 and 8.2.
6. Commit `CARD-050: Windows: the logic behind Ask and Message`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: one line ending in `True`.
  ```powershell
  $root = (Get-Location).Path
  $b = [IO.File]::ReadAllBytes("$root\windows\tests\ScreenTime.Core.Tests\AskAndMessageTests.cs") | Where-Object { $_ -ne 13 }
  $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
  "AskAndMessageTests.cs $h $($h -eq '9ff3a2c600402e47ccd91bef24055a2de429efa8d2e378c82a8084ab7ed37d00')"
  ```
- [ ] From `windows\`: `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] From `windows\`: `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 210**. Paste the summary lines.
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Core\Tray\*.cs,windows\src\ScreenTime.Core\Service\*.cs -Pattern 'DateTime\.Now|UtcNow|TickCount|DllImport'` prints nothing.

### 8.2 Repo

- [ ] `git status` clean. No `bin\`, `obj\` or `*.log` in the repo.
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 6 files:
  ```
  windows/src/ScreenTime.Core/Service/Live.cs
  windows/src/ScreenTime.Core/Service/PipeMessage.cs
  windows/src/ScreenTime.Core/Service/RequestAnswer.cs
  windows/src/ScreenTime.Core/Tray/SendResults.cs
  windows/src/ScreenTime.Core/Tray/TrayStatusBuilder.cs
  windows/tests/ScreenTime.Core.Tests/AskAndMessageTests.cs
  ```

### 8.3 Run on James's PC

None in this card. Write `8.3: none in this card` in the handback.

## 9. Tests

| File | Tests | What it checks |
|---|---|---|
| `AskAndMessageTests` | 15 cases | The presets in order and an empty list; the pending minutes; four answer texts (yes under and over an hour, no); five frames that are no answer; an answer still asks for a sync; the exact new pipe lines; reading them back; 409 versus every other failure. |

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-050-ask-logic
   ```
2. Commit with the message `CARD-050: Windows: the logic behind Ask and Message`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-050-ask-logic`
5. Write the PR body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` and open the PR with `gh pr create --base main --title "CARD-050: Windows: the logic behind Ask and Message" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body:
   ```markdown
   ## Card
   docs/cards/CARD-050-ask-logic.md

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
- **`CS0102` on `PipeMessage`**: a factory has the same name as a property. Use exactly the names in 6.4.
- **A JSON line test fails on `\u0027`**: you changed a test string. Copy the file again from section 5.
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
Claude, here is Bob's handback for CARD-050. Please review and merge if it is good.

CARD: CARD-050 Windows: the logic behind Ask and Message
PR: <full PR URL>
Branch: bob/card-050-ask-logic
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
