# CARD-065: Shared devices

| Field | Value |
|---|---|
| Card | CARD-065 |
| Title | Shared devices |
| Size | L |
| Depends on | Claude's front-end PR ("Shared devices: the parent screens, spec and CARD-065"), merged to `main` |
| Spec sections | docs/SPEC.md §12.8 (read it first), §3 Q40, §6.1 `kids.kind`, §8.2, §12.3, §16.4, §16.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-065-shared-devices` |
| PR title | `CARD-065: Shared devices` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**How this card works.** Claude did the design, built the parent screens and wrote this card: the behaviour, the interfaces and the acceptance criteria. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a table, column, route, field, type, event or file, use that name exactly; everything else (helper names, file layout) is your choice, as long as it follows the repo's patterns and `AGENTS.md`. Claude will re-run your tests, break a few lines of your code on purpose to see that a test fails, and review the code line by line before merging.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM.

**What James asked for (19 Nov 2026).** Mum's tablet is taken by the kids and used with no limits; James's son installs games from the Play Store on it. James wants a **shared device**: a device that belongs to no kid, with its own time (none by default), bedtime, blocked apps, always-allowed apps and new-app approval. A kid asks for time on it like on their own device and the time never comes off a kid. Mum uses it through parent mode, which on a shared device ends when the screen goes off.

**The design in one paragraph (SPEC §12.8).** A shared device is a `kids` row with the new column `kind = 'shared'`. Everything already keyed by kid (schedule, grants, requests, messages, the engine, app rules, always-allowed apps, bedtime tonight, lock now, parent mode, events, pushes) works for it unchanged. The work is: the column and the field, a few rules that differ (one device at most, always the Screens pool, defaults at creation, no contacts), `kind` in the snapshot, three changes in the Android kid app (words, no calls or SOS, parent mode ends at screen off), and wiring Claude's two seams.

**What Claude built (merged before this card).** The parent screens, behind a seam that treats every row as a kid until `kind` exists:

| Where | Files (Claude's: do not change, except the seam lines named in 5.5) |
|---|---|
| Web | `web/src/lib/shared.ts` (the seam: `kindOf`, `createShared`, and the fake in `localStorage`; plus pure helpers), the Shared devices section in `web/src/pages/kids.tsx`, `web/src/pages/kid.tsx`, `web/src/pages/today.tsx`, `web/src/pages/inbox.tsx`, `web/src/lib/inbox.ts`, and the `shared` props in `kid-dialog.tsx`, `kid-avatar.tsx`, `schedule-editor.tsx`, `devices-panel.tsx`, `add-device-dialog.tsx`, `apps-panel.tsx`, `adjust-dialog.tsx`; tests `web/test/shared.test.ts` |
| Android parent app | `kids/Shared.kt` (the seam: both `isShared` functions and `SharedSeam`; plus pure helpers), the shared parts of `kids/KidsScreen.kt`, `kids/KidScreen.kt`, `kids/ScheduleScreen.kt`, `kids/Editors.kt`, `today/TodayScreen.kt`, `today/AdjustSheet.kt`; test `kids/SharedTest.kt` |

## 2. Goal

A parent adds a shared device in the web app, connects the tablet to it, and from then on it has its own time, bedtime and app rules; the kid app on it names the device, shows no calls or SOS, and ends parent mode at screen off.

## 3. Out of scope

- **No change to the time engine** (`packages/engine`, `android/core-time`, `windows/src/ScreenTime.Core/Time`).
- **No Windows change** (`windows/src`), except files `pnpm contract` regenerates. A PC account can be a shared device; parent mode there does not end when the PC locks (accepted, SPEC §12.8).
- No change to Claude's front-end files beyond the seam lines in 5.5. A UI bug you find goes under "Blockers / questions".
- No change of `kind` after creation; no way to turn a kid into a shared device or back.
- No change to the parent app's pushes or inbox wording ("Screens" stays there, SPEC §12.8).
- No new library. Do not edit generated files by hand: run `pnpm contract`.
- Never commit secrets (`deploy/.env`, tokens, keys, `google-services.json`).

## 4. Tech and traps

The existing stack only: TypeScript (Hono, zod, Drizzle, Vitest), Kotlin (JUnit Jupiter), PowerShell 7.

- **Migration.** The last one is `0012_parent_app_version.sql`, so yours is `server/drizzle/0013_kid_kind.sql`. Change `server/src/db/schema.ts`, run `pnpm --filter @screentime/server db:generate`, rename the generated file, check `server/drizzle/meta/_journal.json`. `kind` is `text not null default 'kid'` with a CHECK `kind in ('kid','shared')` (SPEC §6: kinds are text with a CHECK so more can be added).
- **Generated clients.** After changing `packages/schemas`, `pnpm contract` regenerates `contract/openapi.json`, the Kotlin client (`android/core-model/.../api/ApiModels.kt`) and the C# client. Commit them. Name the enum schema `KidKind` (meta id `KidKind`, values `kid`, `shared`), so Kotlin gets `KidKind.KID` / `KidKind.SHARED`. The Kotlin generator cannot do a field that is both optional and nullable; `kind` is **required** in every response, and **optional** (not nullable) in the create body.
- **Today's local weekday and time zone.** Defaults at creation read the other kids' **current** schedules (highest version each, archived kids left out).
- **The kid app reads the snapshot through `DeviceState`** (generated) and keeps the last one in `state.json`. A snapshot saved before this card has no `kind`, and a required field missing from it would make the app fail to read its cache. So in the **snapshot** schema `kid.kind` is **optional** (not nullable): Kotlin gets `kind: KidKind? = null`, and the kid app treats `null` as a kid. The server always sends it. (The generator has no defaults, so do not try `.default()`.)
- **Screen-off in the kid app.** `service/KidService.kt` already handles `Intent.ACTION_SCREEN_OFF` and already has an **End now** path for parent mode (SharedPreferences `parent_mode`, `POST /v1/device/parent-mode/end` sent before the next sync, then the device is blocked again if out of time). Reuse that path; do not write a second one.
- `pnpm test` builds first and covers `packages/schemas` too. Run Gradle from `android` with `JAVA_HOME` set to Android Studio's `jbr`.

## 5. Design (what to build)

### 5.1 Data and schemas

- `kids.kind` as in 4. Existing rows become `kid`.
- `Kid` (the API schema returned by `GET /v1/kids`, `GET /v1/kids/{kidId}`, `POST`, `PATCH`) gains required `kind: KidKind`. `TodayKid` gains required `kind`. The snapshot's `kid` object (`GET /v1/device/state`, SPEC §8.2) gains `kind`, optional in the schema (see 4) but always sent.
- The create body of `POST /v1/kids` gains optional `kind` (default `kid`). `PATCH /v1/kids/{kidId}` does not accept it (an unknown field is handled as the schema already handles unknown fields; do not add `kind` to the patch schema).

### 5.2 Server rules for `kind = 'shared'`

1. **Create defaults.** `POST /v1/kids` with `kind: 'shared'` stores `new_app_approval = true` and a first schedule (version 1) with, for each ISO weekday 1 to 7: `screensMin` 0, `phoneMin` 0, `wake` = the **latest** wake of that weekday across the family's other non-archived `kind = 'kid'` kids' current schedules, `bedtime` = the **earliest** bedtime of the same; `07:00` and `20:00` when the family has no such kid; `warn1Min` 15, `warn2Min` 5. A kid created without `kind` is unchanged (default schedule, approval off).
2. **One device at most.** `POST /v1/kids/{kidId}/enrolment-codes` for a shared one that has a device with `revoked_at` null → **409** with code `shared_has_device` and message exactly **`This shared device already has a device. Remove it first.`** Revoking (removing) the device frees the slot.
3. **Always Screens.** Enrolling into a shared one stores `pool = 'screens'` whatever the form (today `server/src/devices/routes.ts` sets `phone` for a phone).
4. **Today.** `GET /v1/today` lists a shared one with only its `screens` pool in `pools`.
5. **No contacts.** `GET /v1/kids/{kidId}/contacts` for a shared one → `[]`. `PUT` → **409** code `shared_device`, message exactly **`A shared device has no contacts.`** The snapshot's `contacts` is `[]` for a shared one.
6. Everything else (grants, lock now, requests, messages, apps, bedtime tonight, parent mode, archive) is unchanged and must keep working for a shared one.

### 5.3 Android kid app (`android/app-kid/src/main`)

All three follow from `state.kid.kind == KidKind.SHARED` in the cached snapshot.

1. **Words.** `status/KidStatus.kt` and `home/HomeScreen.kt`: the greeting is the name alone ("Mum's tablet", not "Hi Mum's tablet"); the pool word is **Time**, so the ring label says "Time left", the notification title "Time · 1h 12m left", and the out-of-time headline **"Out of time"** (not "Out of Time time"). Bedtime and before-wake words are unchanged. A `kid` row reads exactly as today.
2. **No calls, emergency button or SOS.** `canCall` is false for a shared one, whatever the form and SIM (this already hides the call row, **Emergency** and the **SOS** button, which all key off `canCall`).
3. **Parent mode ends at screen off.** On `ACTION_SCREEN_OFF`, when the device is shared and parent mode is on (from the server or a local code session, any duration including "Until I end it"), do exactly what the device's **End now** does. A `kid` device is unchanged.

### 5.4 What you do not change

The Windows service and tray, the engines, the parent app's inbox and push wording.

### 5.5 Wiring Claude's seams (the only front-end lines you change)

- `web/src/lib/shared.ts`: `kindOf(kid)` returns `kid.kind ?? 'kid'`; `createShared` sends `{ name, avatarColor, kind: 'shared' }` and returns the answer. Delete `FAKE_KEY`, `fakeSharedIds`, `rememberFakeShared` and the comment lines about the fake. Do not touch the helpers below the seam. `web/test/shared.test.ts` must pass unchanged.
- `android/app-parent/.../kids/Shared.kt`: both `isShared` functions return `kid.kind == KidKind.SHARED`. Delete `SharedSeam` and change the seam comment to say the kind comes from the server. `SharedTest` must pass unchanged.

## 6. Acceptance criteria

Each one is checked by a test you write (section 7) or a command in section 8. Claude re-checks every one.

**Server**

1. Migration `0013_kid_kind.sql` adds `kids.kind` (not null, default `kid`, CHECK); after migrating, existing kids read `kind: "kid"` from `GET /v1/kids`.
2. `POST /v1/kids` with `kind: "shared"` → 201 with `kind: "shared"`; `GET /v1/kids/{id}/apps` shows `newAppApproval: true`; its schedule has `screensMin` 0 every day and, with two kids whose Monday wakes are 07:00 and 07:30 and bedtimes 20:30 and 20:00, Monday `wake` 07:30 and `bedtime` 20:00. With no kids: 07:00 and 20:00 every day.
3. `POST /v1/kids` without `kind` → `kind: "kid"`, approval off, the usual default schedule (unchanged behaviour).
4. `PATCH` with `kind` does not change the kind.
5. Enrolment code for a shared one with an active device → 409 `shared_has_device` with the exact message; after `DELETE` of that device, a new code → 201.
6. A phone enrolled into a shared one has `pool: "screens"`.
7. `GET /v1/today`: the shared one has `kind: "shared"` and exactly one pool, `screens`; kids keep both pools and `kind: "kid"`.
8. Contacts: GET → `[]`; PUT → 409 `shared_device` with the exact message. The snapshot for its device has `contacts: []` and `kid.kind: "shared"`.
9. A grant, a time request and its approval, lock now, an app rule and bedtime tonight each work for a shared one (one test each, short).

**Kid app**

10. Unit tests: a snapshot JSON without `kind` parses and reads as a kid; for a shared snapshot, `KidStatus` gives the greeting `Mum's tablet`, pool word `Time`, title `Time · 1h 12m left`, out-of-time headline `Out of time`, and `canCall` false on a phone with a SIM; for a kid snapshot the words are unchanged.
11. Unit test (or a test of the decision function you extract): screen off with parent mode on ends it on a shared device, and does not on a kid device.
12. Emulator run (section 8.2): every step's real output pasted.

**Parent screens wired**

13. `Select-String -Path web\src\lib\shared.ts -Pattern 'fake|FAKE|localStorage'` prints nothing; `web/test/shared.test.ts` passes unchanged.
14. `Select-String -Path android\app-parent\src\main\kotlin\au\screentime\parent\kids\Shared.kt -Pattern 'SharedSeam'` prints nothing; `SharedTest` passes unchanged.

**General**

15. `pnpm contract` then `git status --short contract android/core-model windows/src/ScreenTime.Core/Api` prints nothing; `pnpm typecheck`, `pnpm test`, `dotnet test` and the Android build and tests pass; CI is green.
16. The only changed files under `web/src`, `android/app-parent/src/main`, `windows/src` and the engines are `web/src/lib/shared.ts`, `android/app-parent/.../kids/Shared.kt` and the generated client files. (Command in 8.1.)

## 7. Tests you write

- `server/test/shared-devices.test.ts` (new): criteria 1 to 9.
- Kid app: `android/app-kid/src/test/kotlin/au/screentime/kid/status/SharedStatusTest.kt` (new, criterion 10; reuse `StateFixture.kt`) and a test for criterion 11 next to the code you change.
- Keep every existing test unchanged. Name each test after the behaviour it proves. Each must fail if that behaviour breaks.

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
Select-String -Path web\src\lib\shared.ts -Pattern 'fake|FAKE|localStorage'
Select-String -Path android\app-parent\src\main\kotlin\au\screentime\parent\kids\Shared.kt -Pattern 'SharedSeam'
cd windows
dotnet test
cd ..\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git diff --name-only main -- web/src android/app-parent/src/main windows/src packages/engine android/core-time
```

(The `create database` line fails harmlessly when the test database already exists.) Run the `git status` line again after your last commit: it must print nothing.

### 8.2 Emulator run

On the API 37 Play emulator with the dev API (`pnpm dev:server`) and the debug kid app set up as Device Owner (see `docs/guides/android-provisioning.md` and the earlier run scripts in `docs/cards/`). Paste the **real output of every step**:

1. Create a shared device "Mum's tablet" through the API as the family's first parent (a small script in `server/scripts/`, like `dev-grant.ts`, is fine). Paste the `POST /v1/kids` answer.
2. Make an enrolment code for it (`server/scripts/dev-enrol-code.ts` or the API) and enrol the emulator. Paste the device row (`GET /v1/devices`): `pool` must be `screens`.
3. With 0 minutes, the block screen shows. Paste a `uiautomator dump` excerpt showing the headline `Out of time`, and that there is no SOS or call button.
4. Grant 15 minutes (`server/scripts/dev-grant.ts`). Paste the home screen's text: the greeting `Mum's tablet` and `Time left`.
5. Start parent mode "Until I end it" (`server/scripts/dev-parent-mode.ts`), check it is on, then turn the screen off (`adb shell input keyevent KEYCODE_SLEEP`), wait 10 s, turn it on. Paste `adb logcat -s KidService` lines showing parent mode ending at screen off, and the server's view that the session has `ended_at` set.
6. Make a second enrolment code for the same shared device: paste the 409.

A step without its pasted output counts as NOT RUN.

## 9. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-065-shared-devices
   ```
2. Commit in small logical commits. Message format: `CARD-065: <what changed>`.
3. Before pushing, run section 8 again and make sure it passes.
4. Push: `git push -u origin bob/card-065-shared-devices`
5. Open a PR into `main` titled `CARD-065: Shared devices`, with its body written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-065-shared-devices.md

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

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- Every workaround (a force-stop, a restart, an extra script, a retry) is a deviation: list it with why you needed it.
- "Deviations" lists every way your files differ from the card. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-065. Please review and merge if it is good.

CARD: CARD-065 Shared devices
PR: <full PR URL>
Branch: bob/card-065-shared-devices
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
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
