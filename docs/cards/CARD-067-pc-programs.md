# CARD-067: Reports, programs on a PC

| Field | Value |
|---|---|
| Card | CARD-067 |
| Title | Reports, programs on a PC |
| Size | L |
| Depends on | CARD-066 (merged) and Claude's PR with this card, merged to `main` |
| Spec sections | docs/SPEC.md §12.9 "Windows programs (CARD-067)" (read it first), §6.1 `app_usage_daily` and `device_programs`, §9.3 `POST /v1/device/app-usage`, §12.2 (service, tray, pipe) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-067-pc-programs` |
| PR title | `CARD-067: Reports, programs on a PC` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**How this card works.** Claude did the design and wrote this card. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a table, column, route, field, pipe line, class or file, use that name exactly; everything else is your choice, as long as it follows the repo's patterns and `AGENTS.md`. Claude will re-run your tests, break lines of your code on purpose, compare your pasted output with the database and the Sandbox's files, and review the code before merging.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM.

**Never open, focus or close programs on James's own desktop.** Everything that needs a desktop (the tray watching the window in front) runs in **Windows Sandbox** (section 8.2). Never `Stop-Process` by name on James's PC.

**What James asked for (20 Nov 2026).** The Reports page (CARD-066) shows Android apps. James wants the same for the kids' PCs: "how much time they're spending on certain games", for example Genshin Impact, Spotify or Chrome. A program counts while it is **in front** and the account is unlocked, with **no idle cut-off**; with nothing open (the desktop, the taskbar, the Start menu) nothing counts.

**The design in one paragraph (SPEC §12.9 "Windows programs").** The tray, which runs in the kid's session, watches the window in front and tells the service which program it is, with the pipe line `front`. The service counts the time with its trusted clock, only while the account is counting, splits it at local midnight, keeps it in `state.db` (`program_days`) and uploads the last 8 days with the existing `POST /v1/device/app-usage`, which now takes a PC too, with each program's label. The server keeps the labels in a new table `device_programs`, and the report reads them. No web change: the Reports page already shows whatever the report holds.

**What is already proven (Claude, 20 Nov 2026, on James's PC from a normal non-elevated process).** Reading the window in front, its process and its exe path works for ordinary programs and for Store apps in `C:\Program Files\WindowsApps`. A Store app's window belongs to `ApplicationFrameHost.exe`; the real program is the process of a child window with a different process id (Calculator → `CalculatorApp.exe`). `FileDescription` gives "Calculator", "Claude", "Windows Explorer", but Notepad's is "Notepad.exe". Windows does **not** always give the front to a program a background script starts: a run must check what is really in front, not assume it.

## 2. Goal

On a PC with this version, Reports shows the programs the kid used and for how long (for example "Genshin Impact 2h 10m · Google Chrome 45m"), per day, week and month, next to the Android apps, with no time counted while nothing is open, the PC is locked, or parent mode is on.

## 3. Out of scope

- **No web or Android parent app change.** `web/src` stays as it is (the page already shows programs). No change to Claude's front-end files.
- **No Android kid app change**, except passing `null` (or nothing) for the new optional `label` where `AppWatcher.sendUsage` builds an upload item, **only if** the regenerated Kotlin client makes that necessary to compile. Say so in the PR if you did.
- No rules, limits, blocks or new-app approval for PC programs; they never appear in `GET /v1/kids/{kidId}/apps`.
- No idle detection. No window titles, no websites (a later phase).
- No change to the time engine or to how the Screens pool is counted.
- No new library. Do not edit generated files by hand: run `pnpm contract`.
- Never commit secrets.

## 4. Tech and traps

The existing stack only: TypeScript (Hono, zod, Drizzle, Vitest), C# (.NET 10, xUnit; the service is Native AOT, the tray is WPF), PowerShell 7.

- **Migration.** The last one is `0013_kid_kind.sql`, so yours is `server/drizzle/0014_device_programs.sql`, made with `pnpm --filter @screentime/server db:generate` after changing `server/src/db/schema.ts`, then renamed; check `server/drizzle/meta/_journal.json`. Add row-level security and the `family_isolation` policy exactly as `0009_device_games.sql` does.
- **Generated clients.** The upload item gains an optional `label`. After `pnpm contract`, look at the generated Kotlin `DeviceAppUsageUploadDaysItemAppsItem` and C# record: if the Kotlin one now needs a third argument, `AppWatcher.sendUsage` must pass it (section 3). Commit all generated files.
- **The pipe line.** Pipe messages are `PipeMessage` in `windows/src/ScreenTime.Core/Service/PipeMessage.cs`, serialized by a source-generated `PipeJsonContext` (needed for Native AOT). Add a **new parameter at the end** of the record (`Program`), and a factory `PipeMessage.Front(string? program, string? label)` that makes `{"type":"front","program":…,"text":…}`; a null program leaves both out. Old trays and services ignore unknown types, so a mixed version is safe.
- **Times come from the service.** The tray sends no times. The service stamps every `front` line and every count with its own `TrustedClock`, as it does for segments.
- **Local midnight.** Split at local midnight in the family time zone (the stored device's `Timezone`), through the time zone, never by adding 24 hours. Use `TimeZoneInfo.FindSystemTimeZoneById` with the IANA id the way the rest of Core already does.
- **`state.db`.** Do not raise `user_version`. Add `program_days` with `CREATE TABLE IF NOT EXISTS`, the way `kv` was added in CARD-051, so an existing store gets it at its next open.
- **UWP windows.** `ApplicationFrameHost.exe` owns the frame; take the first child window whose process id differs. If there is none (the app is starting or suspended), nothing counts.
- **The tray must not slow down.** Do the naming (process path and version info) off the UI thread, and cache by process id: `FileVersionInfo` reads the file each time.
- **Windows Sandbox** is turned on; Docker Desktop must be running. The MSI comes from your PR's CI run (native AOT needs C++ tools James's PC does not have). The Sandbox has no console session, so the service runs with `--session <its session> --dry-lock`, as `windows/installer/sandbox/in-sandbox-trayexit.ps1` does; it writes only warnings and errors to the Application event log (its information lines, such as `front:`, never appear there), so check results on the server instead.
- `pnpm test` builds first and covers `packages/schemas` and `web`. Run `dotnet test` from `windows`.

## 5. Design (what to build)

### 5.1 Server

1. **`device_programs`** as in SPEC §6.1: `family_id`, `kid_id`, `device_id`, `package` (text), `label` (text), `first_seen_at`, `last_seen_at` (timestamptz, default now), primary key (`device_id`, `package`), foreign keys like `device_games`, RLS.
2. **`POST /v1/device/app-usage`** (schema `DeviceAppUsageUpload` in `packages/schemas/src/apps.ts`): each app item gains `label`, optional, a string of 1 to 80 characters after trimming.
   - From an **Android** device: unchanged (the `label` is ignored; the limit and `state_changed` logic stays exactly as it is).
   - From a **Windows** device (it was 409 before): every `package` must match `^[a-z0-9][a-z0-9 ._()+\-]{0,250}\.exe$` (lower case, ends in `.exe`), else **422** for the whole body and nothing is stored. Each app is upserted into `app_usage_daily` keeping the larger value, exactly like Android. Each app with a `label` upserts `device_programs`: insert with `first_seen_at` = `last_seen_at` = now, or update `label` and `last_seen_at` (never `first_seen_at`). No `state_changed` is sent for a PC upload. Answer 204.
3. **The report** (`server/src/reports/apps.ts`):
   - `label`: the `device_apps` label on the report's devices (rule unchanged) → else the `device_programs` label on the report's devices (the latest `last_seen_at`) → else the `device_apps` label on any of the kid's devices → else the `device_programs` label on any of the kid's devices → else the package.
   - `installedAt` and `removedAt` stay as they are (from `device_apps` only), so they are null for a PC program.
   - `appsRecorded`: `true` for Android; for Windows, `true` when the device has at least one `device_programs` row, else `false`.

### 5.2 Windows Core (`windows/src/ScreenTime.Core/Programs/`, new folder; all pure and unit tested)

1. **`ProgramNames`**:
   - `Id(string exePath)` → the file name in lower case (`C:\X\Notepad.exe` → `notepad.exe`).
   - `Label(string exePath, string? fileDescription, string? productName)` → the trimmed `fileDescription` with a trailing `.exe` (any case) removed; if that is empty, the trimmed `productName`; if that is empty, the file name without `.exe`. Cut to 80 characters.
   - `Ignored(string exeFileName, string? windowClass)` → true for `explorer.exe` with class `Progman`, `WorkerW`, `Shell_TrayWnd` or `Shell_SecondaryTrayWnd`, and for the processes `LockApp.exe`, `StartMenuExperienceHost.exe`, `SearchHost.exe`, `ShellExperienceHost.exe`, `ShellHost.exe`, `ScreenTime.Tray.exe`, `ScreenTime.Service.exe` (any case, any window class). `explorer.exe` with class `CabinetWClass` is **not** ignored.
2. **`ProgramClock`** (per account): what is in front and what to add.
   - `Front(string? id, string? label, long atMs)`: closes the time so far for the old program, then the new one is in front from `atMs`.
   - `Counting(bool on, long atMs)`: closes the time so far; time is only added while counting is on.
   - `Flush(long atMs)`: closes the time so far without changing anything.
   - Closing adds `atMs - last` to the program in front, split at every local midnight of the family time zone in between, as a list of `(LocalDate day, string id, string label, long ms)` the caller stores. If `atMs < last` (the clock stepped back), nothing is added and `last` becomes `atMs`. Nothing is added while nothing is in front or counting is off.
3. **`ProgramUpload`**: from the stored rows, the `DeviceAppUsageUpload` body for the 8 local days ending today (today and the 7 before, oldest first): per day, seconds = ms / 1000 rounded down, capped at 86,400; only apps with at least 1 second; at most 500 per day, most seconds first; days with none left out. `null` when no day has anything.

### 5.3 `state.db` (`LocalStore`)

`program_days (sid TEXT, day TEXT, program TEXT, label TEXT, ms INTEGER, PRIMARY KEY (sid, day, program))`, created with `IF NOT EXISTS`. Methods: add ms to a row (creating it, and taking the newest label), read the rows of an account from a day on, and delete rows older than 31 days.

### 5.4 Tray (`windows/src/ScreenTime.Tray/`)

A `FrontWatcher`: a `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, …, WINEVENT_OUTOFCONTEXT)` on the UI thread plus a 5-second timer. Each time: window in front → `GetClassName` and process id (with the `ApplicationFrameHost.exe` child rule) → `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageName` → `ProgramNames`. No window, an ignored one, or a path that cannot be read → nothing. It sends `PipeMessage.Front(...)` only when the result differs from the last one sent, and sends the current one again after each (re)connection to the service. Unhook and stop the timer when the tray exits.

### 5.5 Service (`windows/src/ScreenTime.Service/`)

- One `ProgramClock` per kid session. On a `front` line: `Front(program, text, now)`; log at information level `front: <id> <label>` or `front: nothing`.
- Counting is on while the session is unlocked, not in parent mode, and its tray is connected. Call `Counting(...)` wherever those change (unlock, lock, logoff, parent mode on and off, tray connected and gone), and `Flush(now)` on the existing 60-second tick. Store every piece it returns in `program_days`.
- At each sync of an account, after the usage segments: build the `ProgramUpload` body; send it with `PostDeviceAppUsageAsync` when it is not null and differs from the last body sent successfully (keep that in `kv` as `program-usage-sent`); log `programs: sent <n> days (<first>..<last>)`. A failure is logged and retried at the next sync. Then prune `program_days` older than 31 days.

## 6. Acceptance criteria

Every criterion is a test with fixed inputs (fixed dates, never "now minus N") unless it says otherwise. Claude re-checks every one.

**Server** (`server/test/pc-programs.test.ts`, family time zone `UTC`)

1. Migration `0014_device_programs.sql` creates the table with its primary key and RLS (a test reads `pg_policies` for `device_programs`).
2. A PC posts `{ days: [{ day: "2026-11-10", apps: [{ package: "genshinimpact.exe", seconds: 3600, label: "Genshin Impact" }] }] }` → 204; `app_usage_daily` has 3600 for it; `device_programs` has the label with `first_seen_at` = `last_seen_at`.
3. Posting 1800 for the same day → still 3600; posting 4000 → 4000. Posting label "Genshin" later → label "Genshin", `first_seen_at` unchanged, `last_seen_at` later.
4. A PC posting `Notepad.exe`, `notepad`, `C:\x\notepad.exe` or `com.android.chrome` → 422 and nothing stored (check both tables). A label of 81 characters → 422. An item without a label → 204, time stored, no `device_programs` row.
5. An Android upload with a `label` → 204 and no `device_programs` row; an Android app with a `limit` rule still sends `state_changed` to the kid's other Android devices (the existing test still passes), and a PC upload sends none.
6. Report, day `2026-11-10`, kid with a phone and a PC: the PC program appears with label "Genshin Impact", `installedAt` and `removedAt` null, and its `devices` holds only the PC; the PC has `appsRecorded: true`. A second PC with no `device_programs` rows has `appsRecorded: false`.
7. Label order: a package `x.exe` with `device_programs` labels "Old" (`last_seen_at` 2026-11-01) and "New" (2026-11-05) on two report devices → "New". A package with a `device_apps` label on a report device and a `device_programs` label → the `device_apps` one.
8. `GET /v1/kids/{kidId}/apps` lists no PC program.

**Windows Core** (`windows/tests/ScreenTime.Core.Tests/ProgramsTests.cs`)

9. `Id`: `C:\Program Files\WindowsApps\Microsoft.WindowsCalculator_11.2607.0.0_x64__8wekyb3d8bbwe\CalculatorApp.exe` → `calculatorapp.exe`.
10. `Label`: ("…\Notepad.exe", "Notepad.exe", "Microsoft Notepad") → "Notepad"; ("…\CalculatorApp.exe", "Calculator", "Microsoft Calculator") → "Calculator"; ("…\x.exe", "", "Some Product") → "Some Product"; ("…\GenshinImpact.exe", null, null) → "GenshinImpact"; a 100-character description → its first 80 characters.
11. `Ignored`: true for (`explorer.exe`, `Progman`), (`Explorer.EXE`, `Shell_TrayWnd`), (`SearchHost.exe`, `Windows.UI.Core.CoreWindow`), (`screentime.tray.exe`, anything); false for (`explorer.exe`, `CabinetWClass`) and (`notepad.exe`, `Notepad`).
12. `ProgramClock`, zone `Australia/Sydney`, counting on: `Front("a.exe")` at 2026-11-10 09:00 local, `Front("b.exe")` at 09:10 → 600,000 ms for `a.exe` on 2026-11-10. `Flush` at 23:50 local and again at 00:20 local the next day, with `b.exe` in front → 600,000 ms on the 10th and 1,200,000 ms on the 11th from the second flush.
13. Counting off from 09:05 to 09:08 with `a.exe` in front from 09:00, flushed at 09:10 → 420,000 ms. Nothing in front (`Front(null)`) from 09:10 to 09:20, then a flush at 09:20 → nothing added. Clock back: `Front("a.exe")` at 09:20, `Flush` at 09:30 → 600,000; `Flush` at 09:25 → nothing; `Flush` at 09:26 → 60,000.
14. Daylight saving: in `Australia/Sydney`, `a.exe` in front from 2026-04-05 00:00 local (the day clocks go back, 25 hours long) to 2026-04-06 01:00 local, then a flush → 90,000,000 ms (25 h) on 2026-04-05 and 3,600,000 ms on 2026-04-06.
15. `ProgramUpload`, today 2026-11-20: rows on 2026-11-12 (9 days before) are left out; rows on 2026-11-13 to 2026-11-20 are in, oldest first; 999 ms is left out; 90,000,000 ms becomes 86,400; 600 programs on one day become the 500 with the most seconds; no rows → null.

**Store** (`LocalStoreTests.cs`)

16. An existing `state.db` (made with the old schema, `user_version` 1, without `program_days`) opens and gains `program_days`, keeping its other rows. Adding 1,000 ms twice to one row gives 2,000; a newer label replaces the old one; rows older than 31 days are deleted by the prune.

**Pipe** (`PipeMessageTests.cs`)

17. `PipeMessage.Encode(PipeMessage.Front("notepad.exe", "Notepad"))` is exactly `{"type":"front","program":"notepad.exe","text":"Notepad"}`; `Front(null, null)` is exactly `{"type":"front"}`; both decode back.

**Break it yourself** (paste each result in the handback)

18. One at a time, change the line, run the named tests, paste the failing test's name, then restore with `git checkout -- <file>`:
    - in `ProgramClock`, add the time without splitting at midnight → a criterion-12 or criterion-14 test fails;
    - in `ProgramClock`, add time while counting is off → a criterion-13 test fails;
    - in `ProgramNames.Ignored`, drop `Shell_TrayWnd` → a criterion-11 test fails;
    - in the server, let a PC upload skip the `.exe` check → a criterion-4 test fails.

**End to end in Windows Sandbox** (section 8.2)

19. Every line of the run's output pasted, and its last line `=== done: 0 failed`.

**General**

20. `pnpm contract` then `git status --short contract android/core-model windows/src/ScreenTime.Core/Api` prints nothing; `pnpm typecheck`, `pnpm test`, `dotnet test` and the Android build and tests pass; CI is green.
21. `git diff --name-only main -- web/src android/app-parent/src/main packages/engine android/core-time` prints nothing, and under `android/app-kid/src/main` at most `AppWatcher.kt` changed (section 3).

## 7. Tests you write

- `server/test/pc-programs.test.ts` (new): criteria 1 to 8. Fixed dates, family time zone `UTC`.
- `windows/tests/ScreenTime.Core.Tests/ProgramsTests.cs` (new): criteria 9 to 15.
- `LocalStoreTests.cs` and `PipeMessageTests.cs`: criteria 16 and 17, added to the existing files.
- Keep every existing test unchanged. **Changing what an existing test checks is a deviation: list it.** Each new test must fail if the behaviour it names breaks.

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
cd windows
dotnet test
cd ..\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git diff --name-only main -- web/src android/app-parent/src/main packages/engine android/core-time
git diff --name-only main -- android/app-kid/src/main
```

Paste the **real totals** each test runner prints (files and tests, passed and failed), not a sum you work out.

### 8.2 The run in Windows Sandbox

Write `windows/installer/sandbox/Test-Programs.ps1` and `windows/installer/sandbox/in-sandbox-programs.ps1`, modelled on `Test-TrayExit.ps1` and `in-sandbox-trayexit.ps1` (same layout: a work folder under `C:\Users\james\OpenCode\Testing\temp\`, `in` and `out` mapped folders, the dev server reset, Sam's PC code, a LogonCommand, results in `out\results.txt`, the Sandbox shut down at the end). Each check prints `ok: …` or `FAILED: …`, and the last line is `=== done: <n> failed`.

In the Sandbox (as WDAGUtilityAccount), in this order. **Corrected 20 Nov 2026 after Bob's first run** (Claude's mistakes in the first version: the Sandbox has no working Notepad, `MinimizeAll` does not minimise dialog windows such as Character Map, and the service writes only warnings and errors to the event log, so its `front:` and `programs: sent` lines never appear there), and **shortened after his second run** (a correct run took about 9 minutes; this one takes about 5). Every check prints `ok: …` or `FAILED: …`; a failed check never lets the script carry on silently. Every line of `results.txt` starts with the time, so the host looks for `=== done:` **anywhere** in a line (never `^=== done:`).

1. Install the MSI, enrol the account as Sam, point the service at this session with `--session <id> --dry-lock` and restart it, wait for the tray. Check: `ok: tray running`.
2. Start Character Map (`charmap.exe`) and make sure it is in front (if `GetForegroundWindow` is not its window, bring it to the front with `SetForegroundWindow`, using the documented ALT-key press first if needed). Check what is in front **before** timing: `ok: Character Map in front` (its exe is `charmap.exe`). Keep it in front **40 s**.
3. Close Character Map by its process id, start About Windows (`winver.exe`) the same way; check `ok: winver in front`; keep it **30 s**.
4. Close About Windows by its process id (`Stop-Process -Id`, inside the Sandbox only); check that the window in front now belongs to `explorer.exe` with class `Progman` or `WorkerW`, or that there is none: `ok: nothing in front`. Write `=== 5. waiting for the host` to `results.txt`.
5. Wait for the host's go-ahead: check every 5 s for `C:\in\stop.txt` (the host writes it into the `in` folder, which the Sandbox sees read-only), for at most 4 minutes. Then write `=== done: <n> failed` (and `FAILED: no go-ahead from the host after 240 s` if it timed out) and shut down.

Meanwhile on the host, `Test-Programs.ps1`, once `results.txt` has the `=== 5.` line: every 10 s, for at most 4 minutes, run `server/scripts/dev-report.ts Sam day` for today, until **two runs in a row** give the same seconds for both `charmap.exe` and `winver.exe` (the service uploads about once a minute, so the last upload after the programs closed is in). Then it writes `in\stop.txt`, waits for `=== done:` in `results.txt`, prints the last report and checks:

- `charmap.exe` labelled `Character Map` with 35 to 45 seconds;
- `winver.exe` labelled `Version Reporter Applet` with 25 to 35 seconds;
- nothing else above 15 seconds (the time on the desktop before step 2 and after step 4 is not counted), except the console that runs the script (`powershell.exe`, `conhost.exe`, `openconsole.exe` or `windowsterminal.exe`), which is printed but not checked;
- the PC has `appsRecorded: true`.

(Windows Sandbox has no Store apps, so neither Calculator nor Notepad is there: Claude's spike on James's PC covered the Store-app path. Bob's first two runs already showed the server receiving `charmap.exe` "Character Map" and `winver.exe` "Version Reporter Applet" from the Sandbox, with nothing for the desktop.)

Then paste the **whole** of `out\results.txt` and the host output into the handback. A summary counts as `NOT RUN`. The run takes about 5 minutes (about 2 of them installing the MSI); a Sandbox window opens and closes by itself: do not click in it. Nothing is installed on James's PC and no program is opened on his desktop.

**Run the Sandbox once, at the end**, for evidence: check logic with the unit tests first. **Reuse the MSI you already downloaded** when nothing under `windows/src` has changed since its CI run (script and test changes do not need a new MSI); download a new one only when `git diff --name-only <that run's commit> HEAD -- windows/src` prints something. The MSI from your PR's CI run:

```powershell
$run = (gh run list --branch bob/card-067-pc-programs --workflow Windows --limit 1 --json databaseId --jq '.[0].databaseId')
$msiDir = "C:\Users\james\OpenCode\Testing\temp\c67-msi-$run"
gh run download $run --name ScreenTime-msi --dir $msiDir
windows\installer\sandbox\Test-Programs.ps1 -Msi "$msiDir\ScreenTime.msi"
```

The first lines of the host script **reset the development database**, as the other Sandbox runs do.

Not tested in the run: Store apps (none in the Sandbox; Claude's spike covered them), a real lock (the Sandbox has no console session), sleep and reboot.

## 9. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-067-pc-programs
   ```
2. Commit in small logical commits. Message format: `CARD-067: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes. Push, wait for CI, then do 8.2 with that run's MSI.
4. Push: `git push -u origin bob/card-067-pc-programs`
5. Open a PR into `main` titled `CARD-067: Reports, programs on a PC`, with its body written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-067-pc-programs.md

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

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. "No Sandbox available" is not a reason to skip 8.2: Windows Sandbox is turned on, and earlier cards ran in it. If it really will not start, paste the error.

## 11. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block, so James can copy it in one go and paste it to Claude. Claude checks every line against the PR, the CI logs, the Sandbox's `out` folder and its own test run.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output as if you saw it.
- Every workaround (a restart, a retry, an extra script) is a deviation: list it with why.
- "Deviations" lists every way your files differ from the card, **including any existing test whose check you changed**. If you think the card is wrong, quote the exact line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-067. Please review and merge if it is good.

CARD: CARD-067 Reports, programs on a PC
PR: <full PR URL>
Branch: bob/card-067-pc-programs
Head commit: <output of `git rev-parse HEAD`>
Sandbox work folder: <path>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output (totals as the runners printed them):
- <command> -> <key output lines, or NOT RUN: reason>

Break it yourself (criterion 18), each change and the failing test:
- ...

Sandbox run (8.2): the whole of out\results.txt and the host output:
...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
