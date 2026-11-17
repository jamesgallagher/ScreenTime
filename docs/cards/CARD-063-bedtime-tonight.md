# CARD-063: Extend bedtime tonight

| Field | Value |
|---|---|
| Card | CARD-063 |
| Title | Extend bedtime tonight |
| Size | L |
| Depends on | CARD-062 (Waiting for you) and Claude's front-end PR #186 ("Extend bedtime tonight: the parent screens, spec and CARD-063"), both merged to `main` |
| Spec sections | docs/SPEC.md §7.5 (read it first), §3 Q39, §6.1 `bedtime_extensions`, §8.2, §9.2, §13, §16.4 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-063-bedtime-tonight` |
| PR title | `CARD-063: Extend bedtime tonight` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**How this card works.** Claude did the design, built the parent screens and wrote this card: the behaviour, the interfaces and the acceptance criteria. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a table, column, route, field, type, event or file, use that name exactly; everything else (helper names, file layout) is your choice, as long as it follows the repo's patterns and `AGENTS.md`. Claude will re-run your tests, break a few lines of your code on purpose to see that a test fails, and review the code line by line before merging.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM.

**What James asked for (18 Nov 2026).** When a kid's time is used up, the device locks as "out of time", and on Android the block screen still offers the kid's **always-allowed apps** (homework apps, clock, calculator). At bedtime those apps close too. Today the only way a parent can let the kid keep going after bedtime is to **give time**, which unlocks the whole device. James wants a parent to **extend bedtime for tonight only**: if the kid has time left, they keep using it until the new bedtime; if not, the device stays "out of time" and the always-allowed apps keep working until the new bedtime.

**The design in one paragraph (SPEC §7.5).** A new table holds one later bedtime per kid per day. Tonight's bedtime is the later of the schedule's and that row. The server uses tonight's bedtime everywhere it reads today's schedule to enforce or report, **including the device snapshot**: the `schedule.days` entry for today's weekday carries tonight's bedtime. The time engine is not changed, and **no kid device code changes**: the Android kid app and the Windows service already take today's bedtime from that entry (`android/app-kid/.../usage/TodayInput.kt`, `windows/src/ScreenTime.Core/Sync/TodayInput.cs`), and the Android block screen already offers the always-allowed apps exactly when the lock reason is `out_of_time` (`KidService.kt`, around "Always-allowed apps"). So every device already installed honours an extension as soon as it syncs.

**What Claude built (PR #186, merged before this card).** The parent screens, behind a seam that answers from memory:

| Where | Files (Claude's: do not change, except the seam lines named in 5.4) |
|---|---|
| Web | `web/src/lib/bedtime.ts` (the seam: `TodayBedtime`, `bedtimeOf`, `extendBedtime`, `endBedtimeExtension`, plus pure helpers), `web/src/components/bedtime-dialog.tsx`, `BedtimeRow` in `web/src/pages/today.tsx`, the kid page's Today tab, the `bedtime.extended` line in `web/src/lib/inbox.ts`, tests in `web/test/bedtime.test.ts` and `web/test/inbox.test.ts` |
| Android parent app | `today/Bedtime.kt` (`TonightBedtime` and pure helpers), `today/BedtimeSheet.kt`, the bedtime row in `today/TodayScreen.kt`, the seam in `today/TodayViewModel.kt` (`bedtimeOf`, `extendBedtime`, `endBedtimeExtension`, the fake), the `bedtime.extended` line in `inbox/Inbox.kt`, `res/drawable/ic_bedtime.xml`, tests `today/BedtimeTest.kt` and `inbox/InboxTest.kt` |

## 2. Goal

A parent can extend one kid's bedtime for tonight from the web app and the Android parent app; the server stores it, applies it everywhere today's bedtime matters, tells the kid's devices and the other parents, and the existing kid devices enforce it.

## 3. Out of scope

- **No change to the time engine** (`packages/engine`, `android/core-time`, `windows/src/ScreenTime.Core/Time`) and no new test vectors.
- **No change to kid device code** (`android/app-kid/src/main`, `windows/src`), except files that `pnpm contract` regenerates. You **add tests** there (5.5), nothing else.
- No change to Claude's front-end files beyond the seam lines in 5.4. A UI bug you find goes under "Blockers / questions".
- No new notification kind: other parents hear about it as `grant.by_other_parent`.
- No kid-side notice such as "Dad moved bedtime" (the kid already sees "Bedtime 9:30 pm" on the home screen, the notification and the tray, because those read the same schedule entry).
- No extension of wake-up, and no earlier bedtime than the schedule's (that is "Lock now").
- No new library. Do not edit generated files by hand: run `pnpm contract`.
- Never commit secrets (`deploy/.env`, tokens, keys, `google-services.json`).

## 4. Tech and traps

The existing stack only: TypeScript (Hono, zod, Drizzle, Vitest), Kotlin (JUnit Jupiter), C# (xUnit), PowerShell 7.

- **Migrations.** CARD-062 adds `0010_…`, so yours is `server/drizzle/0011_bedtime_extensions.sql`. Change `server/src/db/schema.ts`, run `pnpm --filter @screentime/server db:generate` (drizzle-kit), rename the generated file to that name, and check `server/drizzle/meta/_journal.json` was updated. Add by hand, as `0009_device_games.sql` does, the row-level security policy every family table has (SPEC §6) and the grants for `screentime_app`. Look at `0009` and copy its shape.
- **Two cards in the parent app.** CARD-062 (Waiting for you) also changes the parent app and the server's notify code. Start from a `main` that has CARD-062 merged; if it is not merged yet, stop and say so.
- **Time in tests.** The tests depend on "now". Use the `middayZone()` pattern from `server/test/sync.test.ts` (a family time zone where it is around noon whatever the hour of the run), and write each kid's schedule so today's bedtime is a set number of minutes before or after the database's now (as `server/scripts/dev-bedtime.ts` does). Never hard-code a clock time that only works at some hours.
- **Today's weekday.** The snapshot must change only the entry whose `weekday` is the family's local today (ISO weekday, 1 = Monday), and only when the row's `day` is that local date. `scheduleDay` in `server/src/sync/day.ts` already finds that entry.
- **Generated clients.** After changing `packages/schemas`, `pnpm contract` regenerates `contract/openapi.json`, the Kotlin client (`android/core-model/.../api/ApiModels.kt`, `ApiClient.kt`) and the C# client (`windows/src/ScreenTime.Core/Api/ApiModels.g.cs`). Commit them. The Kotlin functions will be `putKidsBedtimeTonight` and `deleteKidsBedtimeTonight` (the generator names them from the method and path); use whatever it generates.
- **Server messages reach parents.** The web dialog shows the server's error `message` as is, and the Android sheet will too (5.4), so the 422 messages must be the exact words in 5.2.
- `pnpm test` builds first and covers `packages/schemas` too. Run `dotnet test` from `windows`. Run Gradle from `android` with `JAVA_HOME` set to Android Studio's `jbr`.

## 5. Design (what to build)

### 5.1 Data

Table `bedtime_extensions` exactly as SPEC §6.1: `family_id`, `kid_id`, `day` (date), `bedtime` (text `HH:MM`), `created_by` (parent id), `updated_at`; primary key `(kid_id, day)`; foreign keys like the other kid tables; RLS policy on `family_id`.

### 5.2 Schemas and routes (`packages/schemas`, `server/src`)

- New schema `TodayBedtime` (meta id `TodayBedtime`): `{ scheduled: string, tonight: string, extendedBy: string | null, earliest: string | null }`, all times `HH:MM`. Add it to `TodayKid` as a required field `bedtime`.
- New schema `BedtimeTonightPut` (meta id `BedtimeTonightPut`): `{ bedtime }`, `HH:MM` from `00:15` to `24:00` on a quarter hour (minutes `00`, `15`, `30`, `45`; `24:00` allowed). A value that is not like that is a normal `validation_failed` 422.
- `PUT /v1/kids/{kidId}/bedtime-tonight`, parent only, body `BedtimeTonightPut` → **200** `TodayBedtime`.
  - Today = the family's local date (`familyDay`). `scheduled` = today's bedtime from the kid's latest schedule version.
  - `earliest` = the first quarter hour that is later than `scheduled` **and** later than the local time now (strictly: at 20:45:00 the earliest is 21:00), or `null` when that would be after `24:00` (also when `scheduled` is `24:00`).
  - `bedtime` not later than `scheduled` → 422 `validation_failed`, message exactly **`Pick a time after the usual bedtime.`**
  - otherwise `bedtime` earlier than `earliest` → 422 `validation_failed`, message exactly **`That time has already passed. Pick a later one.`**
  - otherwise upsert the row for `(kidId, today)` with `created_by` = this parent and `updated_at` = now. If the stored time was already `bedtime`, change nothing, write nothing and send nothing; still answer 200.
  - When it changed: in the same transaction write an event `bedtime.extended` (kid set, no device) with payload exactly `{ day, scheduled, bedtime, byName, parentId }` (`byName` the parent's display name); after commit, notify parents and tell the devices (5.3).
- `DELETE /v1/kids/{kidId}/bedtime-tonight`, parent only → **200** `TodayBedtime` (now with `tonight` = `scheduled`). Deletes today's row. No row → change nothing, write nothing, send nothing, still 200. When a row was deleted: event `bedtime.extended` with `bedtime: null` and the same other fields, then 5.3.
- Unknown or archived kid → 404, like every `/v1/kids/{kidId}` route (`findKid`). Usual 401/403 rules.
- Tonight's bedtime, used by everything below: the row's `bedtime` when there is a row for today **and** it is later than `scheduled`; else `scheduled`. `extendedBy` is that row's parent's display name only in the first case, else `null`. (So a schedule saved later in the day with an even later bedtime simply wins.)

### 5.3 Using tonight's bedtime, pushes and notifications

Write **one** server function that loads a kid's schedule for today with tonight's bedtime already put into today's weekday entry (for example in `server/src/sync/day.ts`), and use it in **every** place that reads a kid's schedule for today. Today those are (`grep -rn "toSchedule(\|scheduleDay(" server/src`):

| File | What changes |
|---|---|
| `server/src/sync/routes.ts`, the snapshot (`GET /v1/device/state`) | `schedule.days` entry for today's weekday carries tonight's bedtime; `version` unchanged; so `stateVersion` changes |
| `server/src/sync/routes.ts`, `GET /v1/today` | the engine uses tonight's bedtime, and every kid gets `bedtime: TodayBedtime` |
| `server/src/grants/routes.ts` (lock now) | the engine uses tonight's bedtime |
| `server/src/sync/overspend.ts` | the engine uses tonight's bedtime |
| `server/src/jobs/sweep.ts` (device offline) | allowed hours end at tonight's bedtime |

**Not** `GET /v1/kids/{kidId}/schedule` or the schedule PUT: those keep showing and saving the usual schedule.

After a PUT or DELETE that changed something, once the transaction has committed:

- `notifyParents(deps, familyId, [eventId])`. In `server/src/notify/dispatch.ts`, map the event kind `bedtime.extended` to the notification kind `grant.by_other_parent`, and leave out the parent who made it (today the author is found by joining `grants`; for this event use `payload.parentId`).
- Send `state_changed` to **all** of the kid's devices (both pools: a `DeviceTarget` with only `kidId`) at FCM high priority with a TTL until local midnight (`secondsToMidnight` in `grants/routes.ts`), so a locked phone unlocks within seconds.

### 5.4 Wiring Claude's parent screens (the only front-end lines you change)

- `web/src/lib/bedtime.ts`: the `TodayBedtime` interface becomes the type from `@screentime/schemas` (re-export it so the helpers and tests keep importing it from here). `bedtimeOf(kid)` returns `kid.bedtime`. `extendBedtime` calls `PUT /v1/kids/{kidId}/bedtime-tonight` with `{ bedtime }` and returns the answer; `endBedtimeExtension` calls `DELETE` on the same path and returns the answer (`api.put` / `api.delete` from `@/lib/auth`). Delete the fake (`fake`, `FAKE_SCHEDULED`, `fakeEarliest`, the waits) and the header lines that say it answers from memory. Do not touch the helpers below the seam.
- `android/app-parent/.../today/TodayViewModel.kt`: `bedtimeOf(kid)` builds a `TonightBedtime` from `kid.bedtime` (same four fields). `extendBedtime` calls the generated PUT, then `load()`; `endBedtimeExtension` calls the generated DELETE, then `load()`. Errors as `adjust()` does, except a 422 `ApiException` returns the server's message (`e.error?.message`). Delete the fake (`fakeBedtimes`, `fakeEarliest`, `FAKE_SCHEDULED`, the `delay`s) and update the comment above them. Change the class comment in `today/Bedtime.kt` that mentions the fake to say the data comes from `TodayKid.bedtime`; nothing else in that file.

### 5.5 Tests on the kid devices (tests only, no device code)

These prove the claim that the installed devices honour an extension, using the code that is already there:

- `android/app-kid/src/test/kotlin/au/screentime/kid/usage/TonightBedtimeTest.kt` (new): a `DeviceState` (reuse `StateFixture.kt`) whose today's entry has `bedtime` `21:30` while the usual is `20:30`, local time 20:45, allowance used up: `todayInput` + `evaluate` give `locked`, `OUT_OF_TIME`, and the next re-evaluation at 21:30; with time left (say 30 min) it is not locked and locks at 21:15; and `KidStatus` (the builder in `status/KidStatus.kt`) shows bedtime `9:30 pm`. With the entry at `20:30` the same moment is `BEDTIME`.
- `windows/tests/ScreenTime.Core.Tests/TonightBedtimeTests.cs` (new): the same three cases through `TodayInput` + the C# engine, and `TrayStatusBuilder` shows bedtime `9:30 pm`.

## 6. Acceptance criteria

Each one is checked by a test you write (section 7) or a command in section 8. Claude re-checks every one.

**Data and routes**

1. The migration creates `bedtime_extensions` with primary key `(kid_id, day)` and a row-level security policy; a parent of another family gets 404 on both routes for this kid, and its rows are invisible to that family.
2. PUT with a valid later time → 200 `{ scheduled, tonight: <that time>, extendedBy: <parent display name>, earliest }`; one row stored; exactly one `bedtime.extended` event with payload `{ day, scheduled, bedtime, byName, parentId }`.
3. PUT the same time again → 200, no new event, no push. PUT another valid time (earlier or later than the stored one) → replaces it and writes a new event.
4. 422 with the exact messages of 5.2: a time equal to and earlier than `scheduled` (`Pick a time after the usual bedtime.`), a quarter hour that is later than `scheduled` but not later than now (`That time has already passed. Pick a later one.`), and a kid whose bedtime today is `24:00` (`Pick a time after the usual bedtime.`). `21:10`, `25:00` and `9:30` → 422 `validation_failed` from the schema.
5. DELETE with a row → 200 with `tonight` = `scheduled` and `extendedBy: null`, row gone, one event with `bedtime: null`. DELETE with none → 200, no event, no push.
6. Unknown kid, archived kid → 404; no token → 401.

**Tonight's bedtime everywhere**

7. `GET /v1/today`: every kid has `bedtime`; `earliest` follows the rule in 5.2 (including `null` for a `24:00` bedtime); an extended kid shows `tonight` and `extendedBy`; after the schedule is saved with a bedtime later than the extension, `tonight` is the schedule's and `extendedBy` is `null`.
8. `GET /v1/today` pools, with the usual bedtime already past and an extension to later: with allowance left, `locked: false` and `nextLockAt` no later than the new bedtime; with none left, `locked: true` and `lockReason: "out_of_time"` (not `"bedtime"`). After DELETE, `lockReason` is `"bedtime"` again.
9. The device snapshot: today's weekday entry has tonight's bedtime, the other six entries and `schedule.version` are unchanged, and `stateVersion` differs before and after the PUT, and again after the DELETE. A row whose `day` is yesterday (insert it directly) does not change the snapshot or Today.
10. Lock now during the extension, on a pool with time left, stores a negative grant of the remaining minutes (201), not 409.
11. The offline sweep counts the hours up to tonight's bedtime as allowed (a test in `server/test/jobs.test.ts` that fails if the sweep still uses the usual bedtime).
12. `GET /v1/kids/{kidId}/schedule` still shows the usual bedtime after a PUT.

**Pushes and notifications**

13. A PUT or DELETE that changed something sends `state_changed` to every device of the kid, both pools, with high priority; and pushes the event to the other parents' sessions as `grant.by_other_parent`, **not** to the parent who made it. A muted `grant.by_other_parent` is not sent.

**Devices (tests only)**

14. `TonightBedtimeTest.kt` passes and covers the three cases and the status text in 5.5.
15. `TonightBedtimeTests.cs` passes and covers the same.

**Parent screens wired**

16. `Select-String -Path web\src\lib\bedtime.ts -Pattern 'fake|FAKE'` prints nothing; the web tests pass unchanged (`web/test/bedtime.test.ts`, `web/test/inbox.test.ts`).
17. `Select-String -Path android\app-parent\src\main\kotlin\au\screentime\parent\today\TodayViewModel.kt -Pattern 'fake|FAKE|delay\('` prints nothing; `BedtimeTest` and `InboxTest` pass unchanged.

**General**

18. `pnpm contract` then `git status --short contract android/core-model windows/src/ScreenTime.Core/Api` prints nothing (generated files committed, no drift); `pnpm typecheck`, `pnpm test`, `dotnet test` and the Android build and tests pass; CI is green.
19. The only changed files under `web/src`, `android/app-parent/src/main`, `android/app-kid/src/main`, `windows/src` and the engines are: `web/src/lib/bedtime.ts`, `android/app-parent/.../today/TodayViewModel.kt`, `android/app-parent/.../today/Bedtime.kt` (its class comment), and the generated client files. (Command in 8.)

## 7. Tests you write

- `server/test/bedtime-tonight.test.ts` (new): criteria 1 to 10, 12 and 13. Use the fake pusher the way `server/test/games.test.ts` or `messages.test.ts` does to see what was sent.
- `server/test/jobs.test.ts`: add criterion 11.
- `android/app-kid/src/test/kotlin/au/screentime/kid/usage/TonightBedtimeTest.kt` and `windows/tests/ScreenTime.Core.Tests/TonightBedtimeTests.cs`: criteria 14 and 15.
- Keep every existing test unchanged. Name each test after the behaviour it proves. Each must fail if that behaviour breaks.

## 8. Checks

From the repo root, in `pwsh`:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm contract
git status --short contract android/core-model windows/src/ScreenTime.Core/Api
pnpm typecheck
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
docker exec screentime-db-1 psql -U screentime -d postgres -c "create database screentime_test"
$pw = (Select-String -Path deploy\.env -Pattern '^POSTGRES_PASSWORD=(.*)').Matches[0].Groups[1].Value
$env:TEST_DATABASE_URL = "postgres://screentime:$pw@localhost:5432/screentime_test"
pnpm test
Remove-Item Env:TEST_DATABASE_URL
Select-String -Path web\src\lib\bedtime.ts -Pattern 'fake|FAKE'
Select-String -Path android\app-parent\src\main\kotlin\au\screentime\parent\today\TodayViewModel.kt -Pattern 'fake|FAKE|delay\('
cd windows
dotnet test
cd ..\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git diff --name-only main -- web/src android/app-parent/src/main android/app-kid/src/main windows/src packages/engine android/core-time
```

(The `create database` line fails harmlessly when the test database already exists.) Run the `git status` line again **after** your last commit: it must print nothing. The last command must list only the files allowed in criterion 19. Paste each command's key output: for `pnpm test`, the summary line of every package and the lines of your new test files; for Gradle and `dotnet test`, the result lines of your new tests.

## 9. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-063-bedtime-tonight
   ```
2. Commit in small logical commits. Message format: `CARD-063: <what changed>`.
3. Before pushing, run section 8 again and make sure it passes.
4. Push: `git push -u origin bob/card-063-bedtime-tonight`
5. Open a PR into `main` titled `CARD-063: Extend bedtime tonight`, with its body written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-063-bedtime-tonight.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] 1 — how it is proven (test name or command) and the output
   - ...

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 11).

## 10. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. In particular, if a kid device test in 5.5 shows the device does **not** honour the snapshot's bedtime, report it with the output; do not change device code.

## 11. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own run of your tests, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- **Every acceptance criterion (1 to 19)** gets one line: the test name or command that proves it, and `PASS`, `FAIL` or `NOT RUN`.
- "Deviations" lists every way your work differs from the card, and every workaround you used (a retry, an extra command, a skipped step) with why.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-063. Please review and merge if it is good.

CARD: CARD-063 Extend bedtime tonight
PR: <full PR URL>
Branch: bob/card-063-bedtime-tonight
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Tests I wrote (file: test names):
<list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- 1: <test or command> PASS|FAIL|NOT RUN
- ...
- 19: <test or command> PASS|FAIL|NOT RUN

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
