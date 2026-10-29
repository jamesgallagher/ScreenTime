# CARD-045: Windows: C# time engine

| Field | Value |
|---|---|
| Card | CARD-045 |
| Title | Windows: C# time engine |
| Size | S |
| Depends on | CARD-003 (test vectors), CARD-006 (Windows solution), merged to `main` |
| Spec sections | docs/SPEC.md §7 (time engine), §7.4 (test vectors) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-045-cs-engine` |
| PR title | `CARD-045: Windows: C# time engine` |

## 1. Project context

Read `AGENTS.md` first. Rule 8 says temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9 says the handback has the **real output of every command** and lists every workaround.

Screen Time has one time engine, written three times: TypeScript (`packages/engine/src/engine.ts`, the server), Kotlin (`android/core-time/src/main/kotlin/au/screentime/core/time/Engine.kt`, Android), and now C# for the Windows service. All three must give the same answer for every case in `test-vectors/engine/` (26 JSON files, docs/SPEC.md §7.4). This card writes the C# one in `windows/src/ScreenTime.Core/Time/Engine.cs`.

**Port `Engine.kt` step by step.** It is 167 lines with comments for each step of SPEC §7, and the C# file follows the same steps in the same order. Do not invent a different algorithm, and do not "improve" it.

**Already on `main` (Claude did it; do not change):**
- `windows/tests/ScreenTime.Core.Tests/ScreenTime.Core.Tests.csproj` copies `test-vectors/engine/*.json` next to the test binary as `vectors\*.json`.
- `.github/workflows/windows.yml` also runs when a vector changes.

This is the first Windows card. There is no emulator and no server: `dotnet build` and `dotnet test` are the whole run.

As in CARD-042: you **copy** the file in section 5 exactly, and you **write** the code from section 6. The test is the contract and must pass unchanged; Claude ran it in CI against its own implementation.

## 2. Goal

`dotnet build` and `dotnet test` pass in `windows/`. That means every vector, the edge-case tests, and the earlier `PoolTests` and `DurationFormatTests`. The **Windows / build and test** check is green.

## 3. Out of scope

- Only the two files in section 6.3. No change to the csproj files, `global.json`, the workflow, the vectors or any other language's engine.
- No NuGet package (`System.Text.Json` and `TimeZoneInfo` are part of .NET). No NodaTime.
- Nothing in `ScreenTime.Service` or `ScreenTime.Tray` yet (CARD-047 onward).

## 4. Tech

.NET 10 SDK (`windows/global.json`), C# latest, nullable on, **warnings are errors** (`windows/Directory.Build.props`). xUnit v3 on Microsoft Testing Platform. `ScreenTime.Core` is `IsAotCompatible`, so use no reflection: plain records and `switch` are fine.

Time zones are `TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney")`. .NET on Windows 10 and 11 takes IANA ids.

## 5. Files

Copy this one. Section 6 says what to write.

### 5.1 `windows/tests/ScreenTime.Core.Tests/EngineVectorsTests.cs`

```csharp
using System.Text.Json;
using ScreenTime.Core.Time;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-045: every case in test-vectors/engine/ (docs/SPEC.md §7.4). Copied verbatim from the card.</summary>
public class EngineVectorsTests
{
    private static readonly string Folder = Path.Combine(AppContext.BaseDirectory, "vectors");

    public static TheoryData<string> Files()
    {
        var data = new TheoryData<string>();
        foreach (var f in Directory.GetFiles(Folder, "*.json").Order(StringComparer.Ordinal)) data.Add(Path.GetFileName(f));
        return data;
    }

    [Fact]
    public void FindsTheVectorFiles()
    {
        Assert.True(Directory.GetFiles(Folder, "*.json").Length >= 26, "fewer than 26 vector files");
    }

    [Theory]
    [MemberData(nameof(Files))]
    public void Vector(string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(Folder, file)));
        var c = doc.RootElement;
        var day = c.GetProperty("day");
        var input = new EngineInput(
            TimeZoneInfo.FindSystemTimeZoneById(c.GetProperty("tz").GetString()!),
            DateOnly.Parse(c.GetProperty("date").GetString()!),
            Instant(c.GetProperty("now")),
            new DaySchedule(day.GetProperty("allowanceMin").GetInt32(), day.GetProperty("wake").GetString()!, day.GetProperty("bedtime").GetString()!),
            c.GetProperty("grants").EnumerateArray().Select(g => new Grant(g.GetProperty("minutes").GetInt32(), Instant(g.GetProperty("createdAt")))).ToList(),
            c.GetProperty("segments").EnumerateArray().Select(s => new Segment(Instant(s.GetProperty("start")), InstantOrNull(s.GetProperty("end")))).ToList());

        var r = Engine.Evaluate(input);
        var e = c.GetProperty("expect");
        Assert.Equal(e.GetProperty("locked").GetBoolean(), r.Locked);
        Assert.Equal(StringOrNull(e.GetProperty("lockReason")), r.LockReason?.ToApiValue());
        Assert.Equal(e.GetProperty("remainingSec").GetInt64(), r.RemainingSec);
        // DateTimeOffset equality compares instants, so the vectors' +11:00 offsets do not matter.
        Assert.Equal(InstantOrNull(e.GetProperty("nextLockAt")), r.NextLockAt);
        Assert.Equal(Instant(e.GetProperty("reevaluateAt")), r.ReevaluateAt);
        Assert.Equal(e.GetProperty("usedSec").GetInt64(), r.UsedSec);
        Assert.Equal(e.GetProperty("overspendSec").GetInt64(), r.OverspendSec);
    }

    [Fact]
    public void LockReasonsUseTheApiWords()
    {
        Assert.Equal("out_of_time", LockReason.OutOfTime.ToApiValue());
        Assert.Equal("bedtime", LockReason.Bedtime.ToApiValue());
        Assert.Equal("before_wake", LockReason.BeforeWake.ToApiValue());
    }

    [Fact]
    public void SkippedAndRepeatedLocalTimes()
    {
        var sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");
        // 4 Oct 2026: 02:00 jumps to 03:00, so 02:30 does not exist and moves forward to 03:30 (+11:00).
        Assert.Equal(DateTimeOffset.Parse("2026-10-04T03:30:00+11:00").ToUnixTimeMilliseconds(),
            Engine.LocalMs(new DateOnly(2026, 10, 4), new TimeOnly(2, 30), sydney));
        // 5 Apr 2026: 03:00 goes back to 02:00, so 02:30 happens twice; the earlier one (+11:00) counts.
        Assert.Equal(DateTimeOffset.Parse("2026-04-05T02:30:00+11:00").ToUnixTimeMilliseconds(),
            Engine.LocalMs(new DateOnly(2026, 4, 5), new TimeOnly(2, 30), sydney));
        Assert.Equal(DateTimeOffset.Parse("2026-10-22T07:00:00+11:00").ToUnixTimeMilliseconds(),
            Engine.LocalMs(new DateOnly(2026, 10, 22), new TimeOnly(7, 0), sydney));
    }

    private static DateTimeOffset Instant(JsonElement e) => DateTimeOffset.Parse(e.GetString()!, System.Globalization.CultureInfo.InvariantCulture);

    private static DateTimeOffset? InstantOrNull(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : Instant(e);

    private static string? StringOrNull(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetString();
}
```

## 6. What to write

### 6.1 The public API (in `windows/src/ScreenTime.Core/Time/Engine.cs`, namespace `ScreenTime.Core.Time`)

Use exactly these names and shapes; the test uses them.

- `public enum LockReason { OutOfTime, Bedtime, BeforeWake }`.
- `public static class LockReasonExtensions` with `public static string ToApiValue(this LockReason reason)`, which gives `"out_of_time"`, `"bedtime"` or `"before_wake"`. Unknown values throw `ArgumentOutOfRangeException`, like `Pool.cs`.
- `public sealed record DaySchedule(int AllowanceMin, string Wake, string Bedtime);`. `Wake` and `Bedtime` are `"HH:mm"`, and `Bedtime` may be `"24:00"` (the end of the day).
- `public sealed record Grant(int Minutes, DateTimeOffset CreatedAt);`
- `public sealed record Segment(DateTimeOffset Start, DateTimeOffset? End);`. A null `End` means the segment is still open and counts up to `Now`.
- `public sealed record EngineInput(TimeZoneInfo Tz, DateOnly Date, DateTimeOffset Now, DaySchedule Day, IReadOnlyList<Grant> Grants, IReadOnlyList<Segment> Segments);`
- `public sealed record EngineResult(bool Locked, LockReason? LockReason, long RemainingSec, DateTimeOffset? NextLockAt, DateTimeOffset ReevaluateAt, long UsedSec, long OverspendSec);`
- `public static class Engine` with:
  - `public static EngineResult Evaluate(EngineInput input)`
  - `public static long LocalMs(DateOnly date, TimeOnly time, TimeZoneInfo tz)`

Give each public type and method a one-line `///` summary, as `Pool.cs` does.

### 6.2 The rules

- **Inside, work in epoch milliseconds** (`long`, `ToUnixTimeMilliseconds()`), exactly as `Engine.kt` does, and turn them back with `DateTimeOffset.FromUnixTimeMilliseconds` only for the result.
- **Steps 1 to 8** are `Engine.kt`'s, line for line:
  - `dayStart` is `LocalMs(Date, 00:00)`, and `dayEnd` is `LocalMs(Date + 1 day, 00:00)`. Never add 24 hours.
  - `wakeAt` is `LocalMs(Date, Wake)`. `bedAt` is `dayEnd` when `Bedtime` is `"24:00"`, else `LocalMs(Date, Bedtime)`. Parse `"HH:mm"` with `TimeOnly.ParseExact(text, "HH:mm", CultureInfo.InvariantCulture)`.
  - Used time is the merged union of clipped segments, in whole seconds rounded down (`total / 1000`; the total is never negative).
  - Each grant belongs to the period that contains its `CreatedAt`. The rest follows `Engine.kt`: state, `nextLockAt`, the "tomorrow's business" rule, then `reevaluateAt` and the result.
- **`LocalMs`** turns a local date and time in the zone into an instant. Build `local = date.ToDateTime(time, DateTimeKind.Unspecified)`, then pick the offset:
  - When `tz.IsAmbiguousTime(local)` (the clock went back, so the time happens twice), use the **largest** of `tz.GetAmbiguousTimeOffsets(local)`. That gives the earlier instant.
  - When `tz.IsInvalidTime(local)` (the clock jumped forward, so the time never happens), use `tz.GetUtcOffset(local.AddHours(-2))`, the offset from before the jump. That moves the time forward by the gap, as Java does.
  - Otherwise use `tz.GetUtcOffset(local)`.

  Return `new DateTimeOffset(local, offset).ToUnixTimeMilliseconds()`. The test `SkippedAndRepeatedLocalTimes` checks all three cases.
- Use no `DateTime.Now`, `DateTimeOffset.UtcNow` or `TimeZoneInfo.Local`: everything comes from `input`.

### 6.3 Files

1. `windows/tests/ScreenTime.Core.Tests/EngineVectorsTests.cs`: copy from 5.1.
2. `windows/src/ScreenTime.Core/Time/Engine.cs`: write it from 6.1 and 6.2. One file holds all the types above.

## 7. Steps

1. `git checkout main`, `git pull`, `git checkout -b bob/card-045-cs-engine`. Check that `docs/cards/CARD-045-cs-engine.md` exists.
2. `dotnet --version` prints `10.0.` something. If the command is missing or older, **stop and ask James** to run `winget install Microsoft.DotNet.SDK.10`, then open a new PowerShell window.
3. Copy 5.1. Check it with 8.1's fingerprint command **once**.
4. Write `Engine.cs`.
5. From `windows`: `dotnet build ScreenTime.slnx -c Release`, then `dotnet test --solution ScreenTime.slnx -c Release --no-build`, until both pass. Fix your code, never the test. A failing vector names the file and the field; compare that step with `Engine.kt`.
6. Commit `CARD-045: Windows: C# time engine`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] `dotnet build ScreenTime.slnx -c Release` → `Build succeeded` with `0 Warning(s)` and `0 Error(s)`.
- [ ] `dotnet test --solution ScreenTime.slnx -c Release --no-build` → every test passes and none are skipped. Paste the summary lines. The total is **35 or more**: 26 vectors, 3 other `EngineVectorsTests` facts, and the earlier `PoolTests` and `DurationFormatTests`.
- [ ] `EngineVectorsTests.cs` is byte-identical to this card. Run this from the repo root **once**, paste the output, and do not compare the text any other way (it ignores Windows line endings):
  ```powershell
  $p = "windows\tests\ScreenTime.Core.Tests\EngineVectorsTests.cs"
  $b = [IO.File]::ReadAllBytes($p) | Where-Object { $_ -ne 13 }
  $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
  $h
  $h -eq "9550e765ae98f32b6d7f2c2d55366b0c04d91ed75488be51f90821559cf947ee"
  ```
  It prints the hash and `True`. If it prints `False`, copy 5.1 again once and re-run. Still `False`: paste it and carry on; Claude checks it in review.
- [ ] `Engine.cs` has none of `DateTime.Now`, `UtcNow` or `TimeZoneInfo.Local`. Paste the output of `Select-String -Path windows\src\ScreenTime.Core\Time\Engine.cs -Pattern 'DateTime.Now|UtcNow|TimeZoneInfo.Local'`, which must be empty.

### 8.2 Repo

- [ ] `git status` clean (no `bin\`, `obj\` or `TestResults\`).
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 2 files:
  ```
  windows/src/ScreenTime.Core/Time/Engine.cs
  windows/tests/ScreenTime.Core.Tests/EngineVectorsTests.cs
  ```

## 9. Tests

`EngineVectorsTests` is copied unchanged. It has a theory with one test per vector file, a check that at least 26 files are found, the lock reason words, and `LocalMs` on a skipped, a repeated and a normal local time in Sydney.

## 10. Git and pull request

Push `bob/card-045-cs-engine` and open the PR with `gh pr create --base main --title "CARD-045: Windows: C# time engine" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body says what the card asked for, lists the 2 files, and gives the test summary lines. Do not merge.

## 11. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". Never change the test.

- **`FindsTheVectorFiles` fails, or there are no vector tests**: the vectors were not copied into `bin\Release\net10.0\vectors\`. Paste `Get-ChildItem windows\tests\ScreenTime.Core.Tests\bin\Release\net10.0\vectors | Measure-Object` and stop. Do not change the csproj.
- **`TimeZoneNotFoundException`**: paste `[TimeZoneInfo]::FindSystemTimeZoneById("Australia/Sydney")` and `[System.Environment]::OSVersion`, then stop.
- **One or two vectors fail on `nextLockAt` or `reevaluateAt`**: compare your step 6 or step 7 with `Engine.kt` line by line, then fix your code.
- **A warning fails the build** (warnings are errors): fix the code. Do not add `#pragma warning disable` or `NoWarn`.

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
Claude, here is Bob's handback for CARD-045. Please review and merge if it is good.

CARD: CARD-045 Windows: C# time engine
PR: <full PR URL>
Branch: bob/card-045-cs-engine
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
