# CARD-049: Windows: the tray's status, warnings and grant toasts

| Field | Value |
|---|---|
| Card | CARD-049 |
| Title | Windows: the tray's status, warnings and grant toasts |
| Size | M |
| Depends on | CARD-048 and the tray front end (PR #124, by Claude), both merged to `main` |
| Spec sections | docs/SPEC.md §12.2 (pipe), §16.3 (Windows tray), Q7 (warnings) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-049-tray-status` |
| PR title | `CARD-049: Windows: the tray's status, warnings and grant toasts` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

`AGENTS.md` rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command** and lists every workaround.

**How UI cards work now.** Claude builds the UI and Bob builds the logic behind it. For the Windows tray, Claude's front end is already on `main` (PR #124):

- `windows/src/ScreenTime.Core/Tray/TrayStatus.cs`: the record `TrayStatus` (what the tray shows) and its display rules, plus `TrayText.Clock` and `TrayText.Parents`. Tested by `TrayStatusTests`.
- `windows/src/ScreenTime.Tray/*`: the icon, the flyout, the toasts and `TrayModel`, the seam that the pipe will feed.

These are **Claude's files: do not change any of them**. If one of them looks wrong, stop and write it under "Blockers / questions".

This card writes the **logic** the tray needs, all in `ScreenTime.Core` (plain C#, no Windows calls, tested in CI):

1. **`TrayStatusBuilder.From`**: turns the cached `DeviceState` and the engine's `EngineResult` into a `TrayStatus`.
2. **`WarningTracker`**: decides the two warning toasts before a lock ("15 minutes of Screens left", "5 minutes left. Save your work.").
3. **`GrantToasts`**: decides the "Dad added 15 minutes" toasts after a sync.
4. **`PipeMessage`**: a new `view` message that carries a `TrayStatus` from the service to the tray.

The next card (CARD-049b) wires these into the service and the tray and does the run on James's PC. **This card changes no service or tray code and has no PC run.**

## 2. Goal

- The four pieces above exist in `ScreenTime.Core` and pass the 28 new test cases in section 5.
- `dotnet build` and `dotnet test` pass in `windows/`: **total 194** (166 before + 28). CI **Windows / build and test** is green.

## 3. Out of scope

- Any change to `ScreenTime.Service` (`Worker.cs`, `TrayHost.cs`, …) or `ScreenTime.Tray` (`TrayPipe.cs`, `App.xaml.cs`, …): that is CARD-049b.
- Any change to `TrayStatus.cs`, `TrayStatusTests.cs` or anything else from PR #124 (Claude's front end).
- The Ask, Message and parent mode dialogs (CARD-050). Tamper events (CARD-051).
- No new packages, no change to the generated API files (`Api/*.g.cs`), the test csproj, any workflow or the server.
- Do not remove or rename anything in `PipeMessage` (the `status` message and its factory stay: CARD-048's tests use them).

## 4. Tech

- .NET 10, nullable on, warnings are errors. `ScreenTime.Core` is `IsAotCompatible`: no reflection, JSON only through source-generated contexts.
- Time zones: use `TimeZoneInfo.FindSystemTimeZoneById(state.Family.Timezone)` exactly as `Sync/TodayInput.cs` does (the IANA name, for example `Australia/Sydney`, works on Windows 11).
- **Two `Pool` enums.** `ScreenTime.Core.Pool` (in `Pool.cs`) and `ScreenTime.Core.Api.Pool` (in `ApiModels.g.cs`) both exist. `state.Device.Pool` is the **API** one: compare with `Api.Pool.Phone` (written exactly like that inside `namespace ScreenTime.Core.Tray`), or the build fails with `CS0019`.
- **A record cannot have a property and a static method with the same name** (`CS0102`, which stopped CARD-048 once). That is why the factory in 6.4 is `ViewOf`, not `View`.

## 5. Files to copy

Copy each file exactly, byte for byte, into `windows/tests/ScreenTime.Core.Tests/`. 8.1 checks the fingerprints. These tests are the contract: never change them.

### 5.1 `windows/tests/ScreenTime.Core.Tests/TrayStatusBuilderTests.cs`

```csharp
using ScreenTime.Core.Api;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-049: the tray's status from the state and the engine (docs/SPEC.md §16.3). Copied verbatim from the card.</summary>
public class TrayStatusBuilderTests
{
    // Monday 26 October 2026 in Sydney (UTC+11). Every day: 120 min, wake 07:00, bedtime 20:30, warnings 15 and 5.
    private static readonly long Noon = Ms("2026-10-26T01:00:00Z");

    private static EngineResult Open(long nowMs, long remainingSec, long lockAtMs, long usedSec = 3_000) =>
        new(false, null, remainingSec, DateTimeOffset.FromUnixTimeMilliseconds(lockAtMs), DateTimeOffset.FromUnixTimeMilliseconds(nowMs + 60_000), usedSec, 0);

    private static EngineResult Locked(LockReason reason, long nowMs) =>
        new(true, reason, 0, null, DateTimeOffset.FromUnixTimeMilliseconds(nowMs + 60_000), 7_200, 0);

    [Fact]
    public void WhileOpenItCountsToTheLock()
    {
        var s = TrayStatusBuilder.From(State(), Open(Noon, 4_320, Noon + 4_320_000), Noon, online: true, syncedAtMs: Noon - 20_000);
        Assert.Equal("Alex", s.KidName);
        Assert.Equal("Screens", s.PoolName);
        Assert.Null(s.LockReason);
        Assert.Equal(4_320, s.LeftSec);
        Assert.Equal(3_000, s.UsedSec);
        Assert.Equal(Noon + 4_320_000, s.LockAtMs);
        Assert.Equal("8:30 pm", s.Bedtime);
        Assert.Null(s.BackAt);
        Assert.Equal(15, s.Warn1Min);
        Assert.Equal(5, s.Warn2Min);
        Assert.True(s.Online);
        Assert.Equal(Noon - 20_000, s.SyncedAtMs);
        Assert.False(s.ParentMode);
        Assert.Null(s.ParentModeEnds);
        Assert.Empty(s.ParentNames);
    }

    [Fact]
    public void BedtimeBeforeTheTimeRunsOutIsTheLock()
    {
        var sevenPm = Ms("2026-10-26T08:00:00Z");
        var s = TrayStatusBuilder.From(State(), Open(sevenPm, 7_200, Ms("2026-10-26T09:30:00Z")), sevenPm, true, sevenPm);
        Assert.Equal(5_400, s.LeftSec);
        Assert.Equal("8:30 pm", s.Bedtime);
    }

    [Fact]
    public void AtBedtimeItIsBackAtTomorrowsWake()
    {
        var ninePm = Ms("2026-10-26T10:00:00Z");
        var s = TrayStatusBuilder.From(State(), Locked(LockReason.Bedtime, ninePm), ninePm, true, ninePm);
        Assert.Equal(LockReason.Bedtime, s.LockReason);
        Assert.Equal(0, s.LeftSec);
        Assert.Null(s.LockAtMs);
        Assert.Null(s.Bedtime);
        Assert.Equal("7:00 am", s.BackAt);
    }

    [Fact]
    public void BeforeWakeItIsBackAtTodaysWake()
    {
        var sixAm = Ms("2026-10-25T19:00:00Z");
        var s = TrayStatusBuilder.From(State(), Locked(LockReason.BeforeWake, sixAm), sixAm, true, sixAm);
        Assert.Equal(LockReason.BeforeWake, s.LockReason);
        Assert.Equal("7:00 am", s.BackAt);
        Assert.Equal("8:30 pm", s.Bedtime);
    }

    [Fact]
    public void OutOfTimeHasNoBackAt()
    {
        var s = TrayStatusBuilder.From(State(), Locked(LockReason.OutOfTime, Noon), Noon, true, Noon);
        Assert.Equal(LockReason.OutOfTime, s.LockReason);
        Assert.Null(s.BackAt);
        Assert.Equal(7_200, s.UsedSec);
    }

    [Fact]
    public void NoCurfewHasNoBedtime()
    {
        var state = State();
        var lateDays = state.Schedule.Days.Select(d => d with { Bedtime = "24:00" }).ToList();
        var s = TrayStatusBuilder.From(state with { Schedule = state.Schedule with { Days = lateDays } }, Open(Noon, 600, Noon + 600_000), Noon, true, Noon);
        Assert.Null(s.Bedtime);
    }

    [Fact]
    public void ParentModeIsNeverLockedAndSaysWhenItEnds()
    {
        var state = State() with { ParentMode = new DeviceStateParentMode(true, "2026-10-26T05:15:00.000Z", "Dad") };
        var s = TrayStatusBuilder.From(state, Locked(LockReason.OutOfTime, Noon) with { RemainingSec = 0 }, Noon, true, Noon);
        Assert.True(s.ParentMode);
        Assert.Null(s.LockReason);
        Assert.Null(s.LockAtMs);
        Assert.Equal("4:15 pm", s.ParentModeEnds);

        var untilEnded = state with { ParentMode = new DeviceStateParentMode(true, null, "Dad") };
        Assert.Null(TrayStatusBuilder.From(untilEnded, Open(Noon, 600, Noon + 600_000), Noon, true, Noon).ParentModeEnds);

        var ended = state with { ParentMode = new DeviceStateParentMode(true, "2026-10-26T00:59:00.000Z", "Dad") };
        var after = TrayStatusBuilder.From(ended, Locked(LockReason.OutOfTime, Noon), Noon, true, Noon);
        Assert.False(after.ParentMode);
        Assert.Equal(LockReason.OutOfTime, after.LockReason);
    }

    [Fact]
    public void ItNamesTheParentsAndThePool()
    {
        var state = State(pool: "phone") with
        {
            Parents = [new DeviceStateParentsItem("p1", "Mum", null), new DeviceStateParentsItem("p2", "Dad", "+61400000000")],
        };
        var s = TrayStatusBuilder.From(state, Open(Noon, 600, Noon + 600_000), Noon, online: false, syncedAtMs: null);
        Assert.Equal("Phone", s.PoolName);
        Assert.Equal(["Mum", "Dad"], s.ParentNames);
        Assert.False(s.Online);
        Assert.Null(s.SyncedAtMs);
    }
}
```

### 5.2 `windows/tests/ScreenTime.Core.Tests/WarningTrackerTests.cs`

```csharp
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-049: the two warning toasts before a lock (docs/SPEC.md §16.3, Q7). Copied verbatim from the card.</summary>
public class WarningTrackerTests
{
    private static TrayStatus Left(long leftSec, int warn1 = 15, int warn2 = 5) =>
        new("Alex", "Screens", null, leftSec, 0, 1_000_000 + leftSec * 1000, "8:30 pm", null, warn1, warn2, true, null, false, null, []);

    [Fact]
    public void EachWarningShowsOnceWhenTheTimeFallsToIt()
    {
        var w = new WarningTracker();
        Assert.Null(w.Check(Left(4_320)));
        Assert.Equal("15 minutes of Screens left", w.Check(Left(900)));
        Assert.Null(w.Check(Left(899)));
        Assert.Null(w.Check(Left(301)));
        Assert.Equal("5 minutes left. Save your work.", w.Check(Left(300)));
        Assert.Null(w.Check(Left(200)));
        Assert.Null(w.Check(Left(0)));
    }

    [Fact]
    public void JumpingPastBothShowsOnlyTheSecond()
    {
        var w = new WarningTracker();
        Assert.Null(w.Check(Left(4_320)));
        Assert.Equal("5 minutes left. Save your work.", w.Check(Left(200)));
    }

    [Fact]
    public void StartingInsideAWarningShowsIt()
    {
        var w = new WarningTracker();
        Assert.Equal("15 minutes of Screens left", w.Check(Left(600)));
    }

    [Fact]
    public void MoreTimeFromAParentLetsThemShowAgain()
    {
        var w = new WarningTracker();
        w.Check(Left(4_320));
        w.Check(Left(200));
        Assert.Null(w.Check(Left(2_000)));
        Assert.Equal("15 minutes of Screens left", w.Check(Left(900)));
    }

    [Fact]
    public void NoLockTodayParentModeOrLockedNeverWarn()
    {
        var w = new WarningTracker();
        Assert.Null(w.Check(Left(200) with { LockAtMs = null }));
        Assert.Null(w.Check(Left(200) with { ParentMode = true, LockAtMs = null }));
        Assert.Null(w.Check(Left(0) with { LockReason = LockReason.OutOfTime, LockAtMs = null }));
    }

    [Fact]
    public void TheMinutesComeFromTheSchedule()
    {
        var w = new WarningTracker();
        Assert.Equal("10 minutes of Screens left", w.Check(Left(600, warn1: 10, warn2: 1)));
        Assert.Equal("1 minute left. Save your work.", w.Check(Left(60, warn1: 10, warn2: 1)));
    }
}
```

### 5.3 `windows/tests/ScreenTime.Core.Tests/GrantToastsTests.cs`

```csharp
using ScreenTime.Core.Tray;
using Xunit;
using static ScreenTime.Core.Tests.SyncTestData;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-049: the "Dad added 15 minutes" toast (docs/SPEC.md §16.3). Copied verbatim from the card.</summary>
public class GrantToastsTests
{
    private static string G(string id, int minutes, string by = "Dad") =>
        $$"""{"id":"{{id}}","minutes":{{minutes}},"createdAt":"2026-10-26T01:00:00.000Z","byName":"{{by}}"}""";

    [Fact]
    public void GrantsAlreadyThereAtStartAreNotToasted()
    {
        var t = new GrantToasts();
        Assert.Empty(t.Check(State(grants: G("g1", 15))));
    }

    [Fact]
    public void ANewGrantIsToastedOnce()
    {
        var t = new GrantToasts();
        t.Check(State(grants: G("g1", 15)));
        Assert.Equal(["Dad added 15 minutes"], t.Check(State(grants: G("g1", 15) + "," + G("g2", 15))));
        Assert.Empty(t.Check(State(grants: G("g1", 15) + "," + G("g2", 15))));
    }

    [Fact]
    public void ARemovalIsNotToasted()
    {
        var t = new GrantToasts();
        t.Check(State());
        Assert.Empty(t.Check(State(grants: G("g1", -30))));
    }

    [Theory]
    [InlineData(1, "Dad added 1 minute")]
    [InlineData(45, "Dad added 45 minutes")]
    [InlineData(60, "Dad added 1 hour")]
    [InlineData(90, "Dad added 1h 30m")]
    [InlineData(120, "Dad added 2h")]
    public void TheMinutesReadNaturally(int minutes, string expected)
    {
        var t = new GrantToasts();
        t.Check(State());
        Assert.Equal([expected], t.Check(State(grants: G("g1", minutes))));
    }

    [Fact]
    public void SeveralNewGrantsAreToastedInOrder()
    {
        var t = new GrantToasts();
        t.Check(State());
        Assert.Equal(["Mum added 15 minutes", "Dad added 30 minutes"], t.Check(State(grants: G("g1", 15, "Mum") + "," + G("g2", 30))));
    }

    [Fact]
    public void ANewDayStartsQuietly()
    {
        var t = new GrantToasts();
        t.Check(State(date: "2026-10-26", grants: G("g1", 15)));
        Assert.Empty(t.Check(State(date: "2026-10-27", grants: G("g9", 30))));
        Assert.Equal(["Dad added 15 minutes"], t.Check(State(date: "2026-10-27", grants: G("g9", 30) + "," + G("g10", 15))));
    }
}
```

### 5.4 `windows/tests/ScreenTime.Core.Tests/PipeViewTests.cs`

```csharp
using ScreenTime.Core.Service;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-049: the <c>view</c> line from the service to the tray (docs/SPEC.md §12.2, §16.3). Copied verbatim from the card.</summary>
public class PipeViewTests
{
    private static readonly TrayStatus Open = new(
        "Alex", "Screens", null, 4_320, 3_000, 1_761_440_400_000, "8:30 pm", null, 15, 5, true, 1_761_436_000_000, false, null, ["Mum", "Dad"]);

    [Fact]
    public void AViewIsOneLineAndKeepsItsNulls() => Assert.Equal(
        """{"type":"view","view":{"kidName":"Alex","poolName":"Screens","lockReason":null,"leftSec":4320,"usedSec":3000,"lockAtMs":1761440400000,"bedtime":"8:30 pm","backAt":null,"warn1Min":15,"warn2Min":5,"online":true,"syncedAtMs":1761436000000,"parentMode":false,"parentModeEnds":null,"parentNames":["Mum","Dad"]}}""",
        PipeMessage.Encode(PipeMessage.ViewOf(Open)));

    [Fact]
    public void TheLockReasonIsItsName()
    {
        var locked = Open with { LockReason = LockReason.BeforeWake, LockAtMs = null, LeftSec = 0 };
        Assert.Contains("\"lockReason\":\"BeforeWake\"", PipeMessage.Encode(PipeMessage.ViewOf(locked)));
    }

    [Fact]
    public void AViewDecodesBackToTheSameStatus()
    {
        var locked = Open with { LockReason = LockReason.Bedtime, LockAtMs = null, BackAt = "7:00 am", SyncedAtMs = null };
        var decoded = PipeMessage.Decode(PipeMessage.Encode(PipeMessage.ViewOf(locked)));
        Assert.NotNull(decoded);
        Assert.Equal("view", decoded.Type);
        Assert.Equivalent(locked, decoded.View, strict: true);
    }

    [Fact]
    public void OtherMessagesHaveNoView()
    {
        Assert.Null(PipeMessage.Decode(PipeMessage.Encode(PipeMessage.Lock("l1")))!.View);
        Assert.Equal("""{"type":"lock","id":"l1"}""", PipeMessage.Encode(PipeMessage.Lock("l1")));
    }
}
```

## 6. What to write

All new files go in `windows/src/ScreenTime.Core/Tray/` with `namespace ScreenTime.Core.Tray;`. Give every public type and member a one-line `/// <summary>` like the files around it.

### 6.1 `TrayStatusBuilder.cs`

```csharp
public static class TrayStatusBuilder
{
    public static TrayStatus From(DeviceState state, EngineResult result, long nowMs, bool online, long? syncedAtMs);
}
```

It is the Windows twin of the Android kid app's `kidStatus` (`android/app-kid/src/main/kotlin/au/screentime/kid/status/KidStatus.kt`). Work it out in this order:

| Step | Rule |
|---|---|
| Local time | `tz = TimeZoneInfo.FindSystemTimeZoneById(state.Family.Timezone)`; `local = TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(nowMs), tz)`; `date = DateOnly.FromDateTime(local.DateTime)`. |
| Schedule day | The `ScheduleDay` in `state.Schedule.Days` whose `Weekday` is the ISO weekday of a date (Monday = 1 … Sunday = 7: `((int)d.DayOfWeek + 6) % 7 + 1`). `today` = the day for `date`. |
| `parentMode` | `LockKeeper.ParentModeOn(state, nowMs)` (from CARD-048). |
| `locked` | `result.Locked && !parentMode`. |
| `LockReason` | `locked ? result.LockReason : null`. |
| `LockAtMs` | `parentMode ? null : result.NextLockAt?.ToUnixTimeMilliseconds()`. |
| `LeftSec` | `locked` → `0`. Otherwise, when `LockAtMs` is set → `Math.Max(0, (LockAtMs - nowMs) / 1000)`. Otherwise → `result.RemainingSec`. |
| `UsedSec` | `result.UsedSec`. |
| `Bedtime` | `null` when `today.Bedtime` is `"24:00"`. Otherwise parse it (`TimeOnly.ParseExact(…, "HH:mm", CultureInfo.InvariantCulture)`); when the local time of day is **before** it, `TrayText.Clock(hour, minute)` ("8:30 pm"), else `null`. |
| `BackAt` | `LockReason` `BeforeWake` → today's `Wake` as `TrayText.Clock`. `Bedtime` → **tomorrow's** (`date.AddDays(1)`) `Wake`. Anything else → `null`. |
| `ParentModeEnds` | When `parentMode` and `state.ParentMode.EndsAt` is not null: parse it (`DateTimeOffset.Parse(…, CultureInfo.InvariantCulture)`), convert to `tz`, `TrayText.Clock(hour, minute)` ("4:15 pm"). Else `null`. |
| The rest | `KidName` = `state.Kid.Name`; `PoolName` = `"Phone"` when `state.Device.Pool == Api.Pool.Phone`, else `"Screens"`; `Warn1Min`/`Warn2Min` from `state.Schedule`; `Online` and `SyncedAtMs` as passed in; `ParentMode` = `parentMode`; `ParentNames` = `state.Parents` display names, in order, as a `List<string>`. |

### 6.2 `WarningTracker.cs`

```csharp
public sealed class WarningTracker
{
    public string? Check(TrayStatus status);
}
```

One per kid session; the service calls `Check` every second while the session is in use. It shows each warning **once**, when the time left falls to its threshold; when a parent adds time and the time left goes back above a threshold, that warning can show again. The Windows twin of Android's `WarningTracker` (`android/app-kid/src/main/kotlin/au/screentime/kid/status/Warnings.kt`).

State: `long lastLeftSec`, starting at `long.MaxValue`.

1. `left` = `long.MaxValue` when `status.LockAtMs` is null, `status.Locked` or `status.ParentMode`; otherwise `status.LeftSec`.
2. `before = lastLeftSec`, then `lastLeftSec = left`.
3. `left <= 0`: return `null`.
4. `warn1 = status.Warn1Min * 60L`, `warn2 = status.Warn2Min * 60L`.
5. `left <= warn2 && before > warn2`: return the second warning. Check this **before** the first, so jumping past both shows only the second.
6. `left <= warn1 && before > warn1`: return the first warning.
7. Otherwise `null`.

Texts (exact):

| Warning | Text |
|---|---|
| First | `"{Warn1Min} minutes of {PoolName} left"`, for example `15 minutes of Screens left` |
| Second | `"{Warn2Min} minutes left. Save your work."`; when `Warn2Min` is 1: `1 minute left. Save your work.` |

(`Warn1Min` is always greater than `Warn2Min`, so it is never 1.)

### 6.3 `GrantToasts.cs`

```csharp
public sealed class GrantToasts
{
    public IReadOnlyList<string> Check(DeviceState state);
}
```

One per enrolled account; the service calls it after every successful sync. It returns one toast text for each **new** grant of time, in the order of `state.Today.Grants`.

State: a `HashSet<string>` of grant ids already seen, and the `string? date` they belong to.

1. When `state.Today.Date` differs from `date` (this includes the first call): clear the set, set `date`, and treat this call as **quiet**.
2. For each grant in `state.Today.Grants`: add its `Id` to the set. When it was not in the set before, the call is not quiet, and `Minutes > 0`: add `"{ByName} added {minutes}"`.
3. Return the list (empty when there is nothing).

So grants already there when the service starts, or on the first sync of a new day, are never toasted, and removals (negative minutes) are never toasted.

`{minutes}`: `1` → `1 minute`; 2 to 59 → `{n} minutes`; `60` → `1 hour`; more → `DurationFormat.Format(n * 60L)` (`1h 30m`, `2h`).

### 6.4 `windows/src/ScreenTime.Core/Service/PipeMessage.cs` (changed)

Three changes, nothing else:

1. Add `using ScreenTime.Core.Tray;`.
2. Add a last record parameter `TrayStatus? View = null`, so the record ends `… bool? Offline = null, TrayStatus? View = null)`, and a factory next to the others:
   ```csharp
   /// <summary>What the tray shows (service to tray, after every sync and on hello).</summary>
   public static PipeMessage ViewOf(TrayStatus status) => new("view", View: status);
   ```
3. In the `[JsonSourceGenerationOptions(...)]` on `PipeJsonContext`, add `UseStringEnumConverter = true` at the end, so `lockReason` is written as its name (`"BeforeWake"`).

Do not add `[JsonSerializable(typeof(TrayStatus))]`: the generator finds it through `PipeMessage`. `TrayStatus` already writes its nulls (Claude's front end), which `PipeViewTests` checks.

## 7. Steps

1. `git checkout main`, `git pull`, `git checkout -b bob/card-049-tray-status`. Check that `windows/src/ScreenTime.Core/Tray/TrayStatus.cs` and `windows/src/ScreenTime.Tray/TrayModel.cs` exist (PR #124). If they do not, stop: PR #124 is not merged yet.
2. Copy the four files in section 5. Run the fingerprints (8.1) **once**.
3. Write 6.1 to 6.4.
4. Build and test from `windows\` until all pass. When an error is not clear to you after one try, paste it in the handback and stop.
5. Run the rest of 8.1 and 8.2.
6. Commit `CARD-049: Windows: the tray's status, warnings and grant toasts`, push, open the PR (section 10), wait for CI, then write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: four lines, each ending in `True`.
  ```powershell
  $root = (Get-Location).Path
  function Fp($f, $want) {
    $b = [IO.File]::ReadAllBytes("$root\windows\$f") | Where-Object { $_ -ne 13 }
    $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
    "$f $h $($h -eq $want)"
  }
  Fp "tests\ScreenTime.Core.Tests\TrayStatusBuilderTests.cs" "0055c9cef15c42b3d8ae8bf3e3b5c0cbf7838df58a8a1c8e4eff7e83caf25632"
  Fp "tests\ScreenTime.Core.Tests\WarningTrackerTests.cs" "f3e9bc731776c184483dbf4161ccb37605763af32cf1a0d6e5819bd4cac90d78"
  Fp "tests\ScreenTime.Core.Tests\GrantToastsTests.cs" "7ab60398e5540abd3028167bc77441029fdde519c18cac3e84cc6dadfa9191ea"
  Fp "tests\ScreenTime.Core.Tests\PipeViewTests.cs" "c2f6cb8f61921ddc59f7f49cbca884d00724536d3f619e590986313db02a301f"
  ```
  (`$root` matters: `ReadAllBytes` does not follow PowerShell's current folder.)
- [ ] From `windows\`: `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] From `windows\`: `dotnet test --solution ScreenTime.slnx -c Release --no-build` → all pass, none skipped, **total 194**. Paste the summary lines.
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Core\Tray\*.cs,windows\src\ScreenTime.Core\Service\PipeMessage.cs -Pattern 'DateTime\.Now|UtcNow|TickCount|DllImport'` prints nothing.

### 8.2 Repo

- [ ] `git status` clean. No `bin\`, `obj\` or `*.log` in the repo.
- [ ] CI **Windows / build and test** green on the PR.
- [ ] `git diff --name-only main...HEAD` lists exactly these 8 files:
  ```
  windows/src/ScreenTime.Core/Service/PipeMessage.cs
  windows/src/ScreenTime.Core/Tray/GrantToasts.cs
  windows/src/ScreenTime.Core/Tray/TrayStatusBuilder.cs
  windows/src/ScreenTime.Core/Tray/WarningTracker.cs
  windows/tests/ScreenTime.Core.Tests/GrantToastsTests.cs
  windows/tests/ScreenTime.Core.Tests/PipeViewTests.cs
  windows/tests/ScreenTime.Core.Tests/TrayStatusBuilderTests.cs
  windows/tests/ScreenTime.Core.Tests/WarningTrackerTests.cs
  ```

### 8.3 Run on James's PC

None in this card: it has no service or tray change. Write `8.3: none in this card` in the handback.

## 9. Tests

| File | Tests | What it checks |
|---|---|---|
| `TrayStatusBuilderTests` | 8 | Counting to the lock; bedtime before the time runs out; back at tomorrow's wake at bedtime and today's before wake; out of time; no curfew; parent mode (with an end, until ended, already ended); parent names, the Phone pool, offline. |
| `WarningTrackerTests` | 6 | Each warning once; jumping past both; starting inside one; showing again after more time; no warnings without a lock, in parent mode or locked; minutes from the schedule and "1 minute". |
| `GrantToastsTests` | 10 cases | Old grants are quiet; a new grant once; removals; the minute texts (5 cases); several in order; a new day starts quietly. |
| `PipeViewTests` | 4 | The exact `view` line with its nulls; the lock reason as a name; a round trip; other messages have no `view`. |

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-049-tray-status
   ```
2. Commit with the message `CARD-049: Windows: the tray's status, warnings and grant toasts`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-049-tray-status`
5. Write the PR body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` and open the PR with `gh pr create --base main --title "CARD-049: Windows: the tray's status, warnings and grant toasts" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body:
   ```markdown
   ## Card
   docs/cards/CARD-049-tray-status.md

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

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Never change a copied test or one of Claude's front-end files.

- **A copied test does not compile**, and the error is in the test file: paste the full error and stop. The card may be wrong.
- **`CS0102` on `PipeMessage`**: you named the factory `View`. It must be `ViewOf` (section 4).
- **`CS0019` on `Pool`**: compare with `Api.Pool.Phone` (section 4).
- **An AOT or trim warning (`IL…`)**: paste it and stop. No `NoWarn`, no `#pragma`.
- **A test fails and you cannot see why after one careful read of section 6**: paste the failing test's output and stop.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- Every workaround (restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-049. Please review and merge if it is good.

CARD: CARD-049 Windows: the tray's status, warnings and grant toasts
PR: <full PR URL>
Branch: bob/card-049-tray-status
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
