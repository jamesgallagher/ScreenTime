# CARD-066: Reports, apps

| Field | Value |
|---|---|
| Card | CARD-066 |
| Title | Reports, apps |
| Size | L |
| Depends on | Claude's front-end PR ("Reports: the apps page, spec and CARD-066"), merged to `main` |
| Spec sections | docs/SPEC.md §12.9 (read it first), §3 Q41, §6.1 `app_usage_daily`, `usage_segments`, `device_apps`, §7.2 (union of segments), §9.2, §12.4 (daily limits, the upload), §16.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-066-reports-apps` |
| PR title | `CARD-066: Reports, apps` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**How this card works.** Claude did the design, built the web page and wrote this card: the behaviour, the interfaces and the acceptance criteria. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a table, column, route, field, type, schema or file, use that name exactly; everything else (helper names, file layout) is your choice, as long as it follows the repo's patterns and `AGENTS.md`. Claude will re-run your tests, break a few lines of your code on purpose to see that a test fails, compare your pasted output with the database, and review the code line by line before merging.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM.

**What James asked for (20 Nov 2026).** A **Reports** page: for each kid or shared device, then all devices or one, which apps were used and for how long, by day, week (Monday to Sunday) and calendar month, kept forever, quick, with screen time on top. Removed apps and devices must still show: a kid who installs an app and deletes it quickly is exactly what he wants to see. Windows programs, websites, the parent app and emails are later phases, not this card.

**The design in one paragraph (SPEC §12.9).** The data is already there: Android devices upload seconds per app per day into `app_usage_daily` (CARD-058), and every device uploads `usage_segments`. This card adds **one read route**, `GET /v1/reports/apps`, built by **one server function** that a later email phase will call too; **no new table, no cache**. It wires Claude's web seam to the route, and it fixes the Android kid app so it uploads **the last 8 days** of app time instead of 2, keeping parent mode out of every one of them.

**What Claude built (merged before this card).**

| Where | Files (Claude's: do not change, except the seam lines named in 5.5) |
|---|---|
| Web | `web/src/lib/reports.ts` (the seam at the top: the `AppReport…` types, `fetchAppReport` and its fake; pure helpers below it), `web/src/pages/reports.tsx`, the `/reports` route in `web/src/router.tsx`, the **Reports** link in `web/src/components/app-shell.tsx`; test `web/test/reports.test.ts` |

## 2. Goal

A parent opens **Reports**, picks a kid or shared device, and sees the real screen time and the real apps, ranked, for a day, a week or a month, on all devices or one, including apps and devices that have since been removed; a device that was offline for up to a week still gets its app time in.

## 3. Out of scope

- **No new table, column, migration or cache.** If you think an index is needed, measure first (criterion 11) and ask under "Blockers / questions" instead.
- **No Windows change** (`windows/src`), except files `pnpm contract` regenerates. PCs do not record programs yet (a later phase).
- **No Android parent app change** except files `pnpm contract` regenerates. Reports in the parent app is a later phase.
- **No change to the time engine** (`packages/engine`, `android/core-time`, `windows/src/ScreenTime.Core/Time`). Reuse nothing from it that would change it.
- No websites, no alerts, no emails.
- No change to Claude's front-end files beyond the seam lines in 5.5. A UI bug you find goes under "Blockers / questions".
- No change to `POST /v1/device/app-usage` (it already takes 8 days) or to how daily limits work on the device.
- No new library. Do not edit generated files by hand: run `pnpm contract`.
- Never commit secrets (`deploy/.env`, tokens, keys, `google-services.json`).

## 4. Tech and traps

The existing stack only: TypeScript (Hono, zod, Drizzle, Vitest), Kotlin (JUnit Jupiter), PowerShell 7.

- **Schemas and generated clients.** Add `packages/schemas/src/reports.ts` (and export it from the package index the way the other files are). After changing `packages/schemas`, `pnpm contract` regenerates `contract/openapi.json`, the Kotlin client (`android/core-model/.../api/ApiModels.kt`) and the C# client. Commit them. Every field of `AppReport` is **required** (nullable where the spec says null), so the Kotlin generator is happy; do not use `.default()` or optional-and-nullable.
- **Local dates and the time zone.** `from`, `to`, `today` and `app_usage_daily.day` are the family's local dates. The period's instants for `usage_segments` are local midnight of `from` to local midnight after `to`, converted **through the time zone** (Australia/Sydney has a 23-hour and a 25-hour day). Never add 24 hours. Look at how `familyToday` / `familyDay` and `server/src/sync/day.ts` already do it and reuse that.
- **The union of segments.** Screen time per pool is the length of the **union** of the report's devices' segments in that pool, as in SPEC §7.2: two devices used at the same time count once. A plain `sum(ended_at - started_at)` is wrong. Clip every segment to the period and to now before the union.
- **Open segments.** A segment with `ended_at` null ends at its device's `last_seen_at`, but never before its own `started_at` and never after now. (The engine reads null as now; the report must not, or a phone that went quiet last month would show a month of use.)
- **Labels and removed apps.** `device_apps` has one row per device and package, with `label`, `installed_at` and `removed_at`. A package can be in `app_usage_daily` with **no** `device_apps` row (it came to the front but has no launcher icon): its label is the package name and both dates are null.
- **Removed devices.** `devices.revoked_at` set = removed. They stay in `app_usage_daily` and `usage_segments`; the report must include them as SPEC §12.9 says. `GET /v1/devices` leaves them out, which is why the report carries its own `devices` list.
- **Row-level security.** Read everything inside `withFamily(...)` like the other parent routes, so the family policy applies.
- **The Android upload.** `AppWatcher.sendUsage` builds `day(yesterday, today)` and `day(today, now)`. Parent mode's spans live in the `SPANS` preference, and `notCounted(...)` **prunes them to today** every time it runs. With 8 days you must keep 8 days of spans, or older days would count parent mode and the server, which keeps the larger value, could never take it back. `limitsNow` must still give today's limits exactly as before. Day boundaries come from the family time zone through `ZoneId`, as `sendUsage` already does.
- `pnpm test` builds first and covers `packages/schemas` and `web` too. Run Gradle from `android` with `JAVA_HOME` set to Android Studio's `jbr`.

## 5. Design (what to build)

### 5.1 Schemas (`packages/schemas/src/reports.ts`)

Names and meta ids exactly:

- `ReportPeriod`: enum `day`, `week`, `month`.
- `AppReportQuery` (the query string): `kidId` uuid, `period` `ReportPeriod`, `date` optional `YYYY-MM-DD`, `deviceId` optional uuid.
- `AppReportDevice`: `deviceId`, `name`, `form` (`DeviceForm`), `platform` (`Platform`), `removedAt` (datetime, nullable), `appsRecorded` (boolean).
- `AppReportPool`: `pool` (`Pool`), `usedSec` (int ≥ 0).
- `AppReportAppDevice`: `deviceId`, `sec` (int > 0).
- `AppReportApp`: `package`, `label`, `totalSec`, `devices: AppReportAppDevice[]`, `installedAt` (datetime, nullable), `removedAt` (datetime, nullable).
- `AppReport`: `kidId`, `period`, `from`, `to`, `today` (all dates `YYYY-MM-DD`), `deviceId` (uuid, nullable), `devices: AppReportDevice[]`, `screenTime: AppReportPool[]`, `apps: AppReportApp[]`.

Instants are sent as ISO strings in UTC (`toISOString()`), like every other route.

### 5.2 The server function and route

- `server/src/reports/apps.ts`: one exported function that builds an `AppReport` from a family transaction and `{ kidId, period, date, deviceId }`. It is the only place the numbers are worked out; the route and the dev script (5.4) call it. A later email phase will call it too, so it must not depend on Hono or the request.
- `server/src/reports/routes.ts`: `GET /v1/reports/apps` for a **parent**, registered like the other route files, in the OpenAPI document (so `pnpm contract` picks it up).
- Behaviour, exactly as SPEC §12.9 "The API":
  1. `period` required; `date` defaults to the family's today. `from`/`to` are the day, the Monday-to-Sunday week, or the calendar month holding `date`.
  2. `date` after the family's today, or not a real date (`2026-02-30`) → **422** `validation_failed`.
  3. No such kid, or a kid of another family → **404**. An archived kid still answers.
  4. `deviceId` that is not one of the kid's devices (removed ones count as the kid's) → **404**. With `deviceId`, `screenTime` and `apps` are that device only; `devices` still lists them all.
  5. `devices`: the kid's devices by `enrolled_at`: every one with `revoked_at` null, and each revoked one with any `app_usage_daily` row in `from..to` or any segment overlapping the period. `appsRecorded` is `platform = 'android'`.
  6. `screenTime`: one entry per pool that a device **in the report** belongs to (the device's `pool`), Screens first, each the union length (section 4) in whole seconds rounded down. A shared device's report therefore has only `screens`. No device in the report → `[]`.
  7. `apps`: for the devices in the report, `app_usage_daily` rows with `day` in `from..to`, summed per package; only packages with a total > 0; ordered by `totalSec` descending, then `label`, then `package`. `devices` per app: each device with `sec > 0`, in the order of `devices`.
  8. `label`: the `device_apps.label` of the package on the report's devices with the latest `first_seen_at`; else on any of the kid's devices (same rule); else the package name.
  9. `installedAt`: the earliest `device_apps.installed_at` of the package on the report's devices; `removedAt`: when every one of those rows has `removed_at` set, the latest of them, otherwise null. No row on the report's devices → both null.

### 5.3 Android kid app (`android/app-kid/src/main`)

1. `AppWatcher.sendUsage` sends **today and the 7 days before it** (8 days, oldest first), each from local midnight to the next local midnight (today to now), in the family time zone. Days with no apps are left out, as now. It still sends only when the body text changed (`USAGE_SENT`), and still caps each day at 500 apps and each value at 86,400.
2. Parent mode's spans (`SPANS`) are kept for those 8 days: pruning keeps every span that ends after the start of the oldest day sent. Today's limits (`limitsNow`) use today's part only and behave exactly as before.
3. Extract the day list and the pruning into **pure functions** (next to `appUsage` in `apps/Apps.kt` or a new file beside it) so they are unit tested without Android.
4. Log one line per upload at info level: `apps: usage sent for <n> days (<first day>..<last day>)`. The emulator run reads it.

### 5.4 Dev script

`server/scripts/dev-report.ts`: prints the `AppReport` JSON for a kid of the development database by name, calling the function from 5.2 directly (no sign-in needed). Usage: `pnpm --filter @screentime/server exec tsx scripts/dev-report.ts <kid name> <day|week|month> [YYYY-MM-DD] [device name]`. Never against production, said in its header like the other dev scripts.

### 5.5 Wiring Claude's seam (the only front-end lines you change)

In `web/src/lib/reports.ts`, the block between `// ---- The seam` and `// ---- Pure helpers. ----`:

- Replace the interfaces `AppReportDevice`, `AppReportApp` and `AppReport` and the type `ReportPeriod` with type re-exports from `@screentime/schemas` under the same names, so the page and the test compile unchanged. `AppReportQuery` (the function's argument, with `deviceId: string | null`) stays as it is.
- `fetchAppReport(query)` keeps its signature and calls `api.get<AppReport>('/v1/reports/apps?…')` with `kidId`, `period`, `date`, and `deviceId` only when it is not null (use `URLSearchParams`).
- Delete `fakeReport`, `FAKE_APPS`, `FAKE_DEVICES`, `FAKE_REMOVED`, `hash`, the imports only they used, and the seam comment's sentences about the fake. Do not touch anything below `// ---- Pure helpers. ----`. `web/test/reports.test.ts` must pass **unchanged**.

## 6. Acceptance criteria

Each one is checked by a test you write (section 7) or a command in section 8. Claude re-checks every one.

**Server**

1. `GET /v1/reports/apps?kidId=…&period=week&date=2026-11-20` answers `from` `2026-11-16`, `to` `2026-11-22`; `date=2026-11-16` and `2026-11-22` give the same week; `period=month&date=2028-02-10` gives `2028-02-01`..`2028-02-29`; `period=day` gives `from = to = date`. Without `date`, the family's today (test with a fixed clock or by comparing with `familyToday`).
2. `date` the day after the family's today → 422; `date=2026-02-30` → 422; `period=year` → 422; a kid of another family → 404; an unknown `deviceId` → 404; a device of another kid of the same family → 404; a revoked device of this kid → 200.
3. Apps: with rows for two devices of one kid (YouTube 4200 s on the phone and 1800 s on the tablet on one day, plus 300 s on the phone the next day, and Roblox 3000 s on the tablet), the week report has YouTube first with `totalSec` 6300 and `devices` `[phone 4500, tablet 1800]`, then Roblox 3000. A row outside the period (the Sunday before, the Monday after) is not counted. With `deviceId` = the tablet: YouTube 1800, Roblox 3000, and Roblox first.
4. A package with no `device_apps` row has `label` = the package name and both dates null. A package removed from the only device that listed it has `removedAt` = that `removed_at` and `installedAt` = that `installed_at`; on two devices with one still installed, `removedAt` is null. The label is the most recently first-seen row's.
5. Devices: a revoked device with app time in the period is listed with `removedAt` = its `revoked_at` and its time counted; a revoked device with nothing in the period is not listed; a PC is listed with `appsRecorded: false`. Order is by enrolment.
6. Screen time: two segments on two devices of the Screens pool, 10:00–11:00 and 10:30–11:30 local, give `usedSec` 5400 (union), not 7200. A segment from 23:30 to 00:30 across the period's last midnight counts 1800 in that week. A phone's segment gives a separate `phone` entry, Screens first.
7. Open segment: `ended_at` null and the device's `last_seen_at` 20 minutes after the start → 1200 s, not "until now". `last_seen_at` before the start → 0.
8. Time zone: in Australia/Sydney, a day report on `2026-04-05` (the day clocks go back, 25 hours) clips segments at local midnights: a segment from 00:00 to 01:00 local on 6 April is not counted on 5 April.
9. A shared device (`kind = 'shared'`) answers with only a `screens` entry.
10. Family isolation: the same request with another family's parent → 404, and the function reads inside `withFamily`.
11. Speed: a test (or a script whose output you paste) that inserts **one year** of `app_usage_daily` for 3 devices and 60 packages a day (about 65,000 rows) and times a **month** report for All devices: under **200 ms** on the dev database, run three times, all three timings pasted.

**Kid app**

12. Unit tests for the pure functions of 5.3: the day list for "now" gives 8 days, oldest first, each starting at local midnight in the family time zone, the last ending at now; across a daylight-saving change one day is 23 h (or 25 h) long, not 24; span pruning keeps a span from 6 days ago and drops one from 9 days ago, and keeps an open one.
13. The existing kid-app tests (including `AppLimitsTest`) pass unchanged.

**Web**

14. `Select-String -Path web\src\lib\reports.ts -Pattern 'fake|FAKE|hash\('` prints nothing; `web/test/reports.test.ts` passes unchanged (`git diff main -- web/test/reports.test.ts` prints nothing).

**End to end**

15. Emulator run (section 8.2): every step's real output pasted.

**General**

16. `pnpm contract` then `git status --short contract android/core-model windows/src/ScreenTime.Core/Api` prints nothing; `pnpm typecheck`, `pnpm test`, `dotnet test` and the Android build and tests pass; CI is green.
17. The only changed files under `web/src`, `android/app-parent/src/main`, `windows/src`, `packages/engine` and `android/core-time` are `web/src/lib/reports.ts` and the generated client files. (Command in 8.1.)

## 7. Tests you write

- `server/test/reports.test.ts` (new): criteria 1 to 10, with the fixtures written through the database helpers the other server tests use. Name each test after the behaviour it proves.
- Criterion 11: either a test marked so it runs only when `REPORTS_PERF=1` is set, or `server/scripts/dev-report-perf.ts`; say which in the PR.
- Kid app: a test file next to the pure functions of 5.3 (criterion 12).
- Keep every existing test unchanged. Each new test must fail if the behaviour it names breaks.

## 8. Checks

### 8.1 Commands

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
Select-String -Path web\src\lib\reports.ts -Pattern 'fake|FAKE|hash\('
git diff main -- web/test/reports.test.ts
cd windows
dotnet test
cd ..\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git diff --name-only main -- web/src android/app-parent/src/main windows/src packages/engine android/core-time
```

(The `create database` line fails harmlessly when the test database already exists.) Run the `git status` line again after your last commit: it must print nothing. Then run criterion 11's timing and paste it.

### 8.2 Emulator run

On the API 37 Play emulator with the dev API (`pnpm dev:server`) and the debug kid app set up as Device Owner (see `docs/guides/android-provisioning.md` and `docs/cards/CARD-058-run.ps1` for the steps, including usage access). Paste the **real output of every step**:

1. Enrol the emulator to the development kid "Alex" (`server/scripts/dev-enrol-code.ts`), give Alex time (`server/scripts/dev-grant.ts`), and paste the device row from `GET /v1/devices`.
2. Open Chrome (`adb shell monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1`), keep it in front for 3 minutes, then turn the screen off (`adb shell input keyevent KEYCODE_SLEEP`) so the device syncs. Paste the `adb logcat -d -s KidService` line `apps: usage sent for … days (…)`.
3. `pnpm --filter @screentime/server exec tsx scripts/dev-report.ts Alex day`: paste the JSON. It must list Chrome with at least 150 seconds on the emulator, and a `screens` (or `phone`) entry with at least 150 seconds.
4. The same with `week` and `month`: paste both; Chrome's `totalSec` must be the same in all three (one day of data).
5. Remove the emulator's device in the web app (Alex → Devices → Remove), or with `docker exec screentime-db-1 psql -U screentime -d screentime -c "update devices set revoked_at = now() where id = '<id>'"`, then run step 3 again and paste it: the device is listed with `removedAt` set and Chrome still counted.

A step without its pasted output counts as NOT RUN. Every workaround (a force-stop, a restart, a retry, an extra command) is a deviation: list it with why.

## 9. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-066-reports-apps
   ```
2. Commit in small logical commits. Message format: `CARD-066: <what changed>`.
3. Before pushing, run section 8 again and make sure it passes.
4. Push: `git push -u origin bob/card-066-reports-apps`
5. Open a PR into `main` titled `CARD-066: Reports, apps`, with its body written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-066-reports-apps.md

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

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR.

## 11. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs, the development database and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- Every workaround (a force-stop, a restart, an extra script, a retry) is a deviation: list it with why you needed it.
- "Deviations" lists every way your files differ from the card. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-066. Please review and merge if it is good.

CARD: CARD-066 Reports, apps
PR: <full PR URL>
Branch: bob/card-066-reports-apps
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Speed (criterion 11), three timings:
- ...

Emulator run (8.2), real output of every step:
1. ...
2. ...

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
