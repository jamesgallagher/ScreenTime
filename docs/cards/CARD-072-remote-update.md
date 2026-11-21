# CARD-072: Remote Update now from the parent app

| Field | Value |
|---|---|
| Card | CARD-072 |
| Title | Remote Update now from the parent app |
| Size | M |
| Depends on | CARD-071 merged to `main`, and Claude's front-end PR ("Remote update: the device row"), merged to `main` |
| Spec sections | docs/SPEC.md §12.11 (read all of it, especially "Remote Update now"), §8.2 (snapshot), §12.1 (Updates), §12.2 (Self-update), §12.3 item 4 (remote parent mode: the same delivery path) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-072-remote-update` |
| PR title | `CARD-072: Remote Update now from the parent app` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

CARD-071 gave each kid device a manual **Update now** (in parent mode, on the device): on Android `KidUpdates.source.update()`, on Windows the `Asked` input of `UpdateDecision`. This card lets a parent press the same button **from the parent app**, the way a work phone's MDM pushes an update. The kid app is Device Owner and the PC service runs as SYSTEM, so both install without asking.

**Claude built the front end** (rule 10 of `AGENTS.md`: do not change these files; write problems under "Blockers / questions"): the device row on the kid screen (`android/app-parent/.../kids/` : version, status and **Update now**), its words, and `FakeDeviceUpdates` in `kids/RemoteUpdateSeam.kt`, **which you replace and delete**. The row reads `Device.appUpdate` and calls one function to request the update.

## 2. Goal

On a kid's page in the parent app, a parent taps **Update now** on a device; the device updates straight away (or as soon as it is next online), and the row shows the new version.

## 3. Out of scope

- **Any change to the automatic updates** (timing, networks, screen off, nobody using the PC, the 3-failure give-up, the kid phone's notification). A remote request acts exactly like CARD-071's tap, and only once per request.
- Updating the parent app remotely (impossible without Device Owner, §12.7). The web app. A notification to parents when a device has updated. Publishing changes.
- Any change to Claude's files listed above.

## 4. Tech and traps

- `pwsh` 7 only. UTF-8 without BOM. Generated clients only via `pnpm contract`.
- New migration: the next free number in `server/drizzle/`, adding columns only (no new table, so no RLS policy to copy).
- Devices get messages with `sendToDevices(...)` (`server/src/notify/dispatch.ts`); copy how `tellDevice` in `server/src/parentmode/routes.ts` sends `parent_mode` (high priority). The kid app reads messages in `android/app-kid/.../live/Live.kt` and the FCM service; the PC in `windows/src/ScreenTime.Core/Service/Live.cs`.
- The offer for a device must be computed by **the same function** the check route uses (`server/src/appupdate/routes.ts`): do not write a second copy of the offer rules.
- A kid debug build cannot be updated silently: build with `-PkidTestOnly=false` (see `docs/cards/CARD-059-run.ps1`). Emulator: `Medium_Phone_API_37.0`. Windows runs only in Windows Sandbox (copy CARD-071's `Test-Versions.ps1` pair).

## 5. Design (what to build)

### 5.1 Server

- Columns on `devices`: `app_version_code` (int, null), `update_requested_at` (timestamptz, null), `update_requested_code` (int, null).
- `POST /v1/device/app-update/check` also stores `app_version_code` (it already stores `app_version`).
- `POST /v1/devices/{id}/app-update` (`requireFamilyParent`, inside `withFamily`): find the offer for that device; none → 409 `{ error: "no_update" }`; otherwise store `update_requested_at = now`, `update_requested_code = offer.versionCode`, send `{ v: 1, type: "app_update", at }` to that device (high priority, TTL 24 h), answer 202 `{ versionName, requestedAt }`. Revoked device, archived kid, other family → 404. A second request replaces the first (new `requestedAt`).
- Snapshot (`GET /v1/device/state`): `appUpdate: { versionCode, requestedAt } | null`; null when nothing is requested or `app_version_code >= update_requested_code`.
- `Device` (every route that returns devices): `appUpdate: { versionName, state, requestedAt } | null` as §12.11. `state` is `requested` while the request is open, otherwise `available` when the device has an offer, otherwise `appUpdate` is null.

### 5.2 Kid app

- On `app_update` (live or FCM): sync now. After each sync, if the snapshot's `appUpdate` has `versionCode` above `BuildConfig.VERSION_CODE` and a `requestedAt` different from the one kept in SharedPreferences (`remote_update_handled_at`), keep it and call the CARD-071 update path (download even on mobile data, install now, not during an SOS: then it waits until the SOS is over). Do **not** write `update_asked_at` (no reopening).
- After the new version starts, enforcement comes back as after any update: a blocked device is blocked again.

### 5.3 Windows service

- On `app_update`: sync now. After each sync, the same rule as 5.2 per PC (one PC acts once for a `requestedAt`, kept in the store's key-value table), which sets `Asked` in `UpdateDecision`. The parent-mode guard of CARD-071 applies only to the tray's pipe lines, not to this.

### 5.4 Parent app

- Replace `FakeDeviceUpdates` with a real implementation: call `POST /v1/devices/{id}/app-update`, then refresh the kid's devices; a 409 refreshes too (the row then shows the truth). Delete `RemoteUpdateSeam.kt`.

## 6. Acceptance criteria

Server (`server/test/remote-update.test.ts`, new; fixed times: freeze the clock at `2026-11-21T10:00:00Z`, family time zone `UTC`):

1. Fixture: kid PC on `0.1.130` (code 130), `windows.json` offers 131. `POST /v1/devices/{pc}/app-update` → 202 `{ versionName: "0.1.131", requestedAt: "2026-11-21T10:00:00.000Z" }`; the row has `update_requested_code = 131`; one `app_update` message was sent to that device and no other (assert on the fake sender the tests already use).
2. Same PC, nothing newer offered → 409 `no_update`, nothing stored, nothing sent.
3. `windows.json` with `deviceIds: [otherPc]` → 409 for this PC (the offer function is shared: prove it by this case).
4. Revoked device → 404; device of another family → 404; kid device token → 401.
5. Snapshot for that PC: `appUpdate: { versionCode: 131, requestedAt }` after criterion 1; after the PC's check reports code 131 → `appUpdate: null`; a check reporting 130 again keeps it.
6. `GET` the kid's devices: no offer → `appUpdate: null`; offer, no request → `state: "available"`; after the request → `state: "requested"` with its `requestedAt`; after the device reports 131 → `null`.
7. A second request at `10:30:00Z` replaces `requestedAt`.
8. Android kid phone (`kid.json` offers 901 to 900): criteria 1 and 5 hold for it too (one test).

Kid app unit (`android/app-kid/src/test/.../update/RemoteUpdateTest.kt`):

9. Pure rule: request `{901, T1}`, running 900, handled none → act; handled T1 → do not act; running 901 → do not act; request null → do not act; request `{901, T2}` after handling T1 → act.
10. An SOS on → do not install now; the same request is acted on after the SOS ends.

Windows unit (`windows/tests/ScreenTime.Core.Tests/RemoteUpdateTests.cs`):

11. The same table as criterion 9, through your Core function; acting sets `Asked`.
12. All CARD-071 tests and every older `UpdateDecision` test pass unchanged.

Emulator run (`docs/cards/CARD-072-run.ps1`, from `CARD-071-kid-run.ps1`; prints `PASS`/`FAIL` and every `Screen-Text`):

13. Kid 900 enrolled, kid **out of time and blocked**, not in parent mode. Stand in for the parent's tap with a dev script you write, `server/scripts/dev-remote-update.ts <deviceId>` (copy `dev-parent-mode.ts`'s token signing; it calls the route as the family's first parent and prints the status and body). Publish 901 → the route answers 202.
14. Within 120 s `dumpsys package au.screentime.kid` shows `versionCode=901`; within 15 s more the block screen is in front again (print `mCurrentFocus` and `Screen-Text`).
15. The dev database shows `app_version_code = 901` for the device and the snapshot's `appUpdate` is null (print the query).
16. The route again → 409 `no_update` (print it).
17. Parent app (installed, signed in as Dad): the kid's page shows `Version 0.9.1` and `Up to date` for the phone (screenshot `card072-parent-row`).

Windows Sandbox run (`windows/installer/sandbox/Test-Remote.ps1` + `in-sandbox-remote.ps1`, from CARD-071's pair):

18. Build A installed and enrolled, a kid session unlocked, **no parent mode**, no `--update-anytime`. Publish B for this PC, call `dev-remote-update.ts` → 202.
19. Within 5 minutes the installed version is B, exactly one `ScreenTime.Tray.exe` runs in session 1, no `tamper.` event for this PC in the dev database, and the device row in `GET /v1/kids/{id}` (or the devices route) has `appUpdate: null` and `appVersion` B. Print each.

Whole card:

20. Section 8 passes; `Select-String -Path android -Pattern 'FakeDeviceUpdates' -Recurse -Include *.kt` prints nothing; `git status --short contract android/core-model windows/src/ScreenTime.Core/Api` prints nothing after `pnpm contract`; the last `git diff --name-only main` lists only `server/`, `packages/schemas/`, `contract/`, the generated clients, the kid app's `update/`, `live/`, `push/` or `service/` files, `windows/src/ScreenTime.Core/` (not `Api/`, not `UpdateView.cs`), `windows/src/ScreenTime.Service/Worker.cs`, the parent app's real replacement for the seam, your tests and the run scripts.

**Break it yourself** (paste each failing test; restore with `git checkout -- <file>`):
- Send the message to every device of the kid instead of the one → criterion 1 fails.
- Keep `appUpdate` in the snapshot after the device reports 131 → criterion 5 fails.
- Drop the "already handled" check on the kid app → criterion 9 fails.
- Copy the offer rules instead of calling the shared function and ignore `deviceIds` → criterion 3 fails.

## 7. Tests you write

As section 6, one test per criterion, named after the behaviour, with the card's fixed inputs. Changing what an existing test checks is a deviation: list it.

## 8. Checks

From the repo root, in `pwsh`. Run each slow command once with its output saved to a file in `C:\Users\james\OpenCode\Testing\temp\`, then search the file (AGENTS.md, "Saving test output").

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm contract
git status --short contract android/core-model windows/src/ScreenTime.Core/Api
pnpm typecheck
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
$pw = (Select-String -Path deploy\.env -Pattern '^POSTGRES_PASSWORD=(.*)').Matches[0].Groups[1].Value
$env:TEST_DATABASE_URL = "postgres://screentime:$pw@localhost:5432/screentime_test"
pnpm test *> C:\Users\james\OpenCode\Testing\temp\card072-test.txt; "exit $LASTEXITCODE"
cd windows; dotnet test *> C:\Users\james\OpenCode\Testing\temp\card072-dotnet.txt; "exit $LASTEXITCODE"; cd ..
cd android; $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; .\gradlew.bat assembleDebug test *> C:\Users\james\OpenCode\Testing\temp\card072-gradle.txt; "exit $LASTEXITCODE"; .\gradlew.bat --stop; cd ..
Select-String -Path C:\Users\james\OpenCode\Testing\temp\card072-*.txt -Pattern 'Test Files|Tests |FAIL|Passed!|Failed!|BUILD (SUCCESSFUL|FAILED)'
Select-String -Path android -Pattern 'FakeDeviceUpdates' -Recurse -Include *.kt
pwsh -File docs\cards\CARD-072-run.ps1
pwsh -File windows\installer\sandbox\Test-Remote.ps1
git diff --name-only main
```

## 9. Git and pull request

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-072-remote-update`.
2. Small commits: `CARD-072: <what changed>`.
3. Run section 8 again before pushing.
4. `git push -u origin bob/card-072-remote-update`; open a PR into `main` titled `CARD-072: Remote Update now from the parent app`, body in a file in `C:\Users\james\OpenCode\Testing\temp\` with: Card, What I did, Acceptance criteria (each with its proof and output), Deviations from the card, Blockers / questions.
5. **Do not merge.** Do not push to `main`.

## 10. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". In particular: if the block screen does not come back after a remote update (criterion 14), or a PC kid session is left unlocked after the update, report the exact output; do not work around it.

## 11. Handback report (required)

Your **last message to James**, inside one fenced code block. Real output only; `NOT RUN` with the reason for anything you did not run. Every emulator and Sandbox step's **real printed output**, not a summary. Every workaround is a deviation.

````text
Claude, here is Bob's handback for CARD-072. Please review and merge if it is good.

CARD: CARD-072 Remote Update now from the parent app
PR: <full PR URL>
Branch: bob/card-072-remote-update
Head commit: <git rev-parse HEAD>

Files changed (`git diff --name-only main...HEAD`):
<list>

Tests I wrote (file: test names, copied from the files):
<list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>

Break it yourself (each change, the failing test output, restored):
<list>

Emulator run (every line CARD-072-run.ps1 printed):
<paste>

Windows Sandbox run (every line Test-Remote.ps1 and in-sandbox-remote.ps1 printed):
<paste>

Screenshots (path: what it shows, or "not opened"):
<list>

Acceptance criteria:
- 1: <test or step> PASS|FAIL|NOT RUN
- ...
- 20: <test or step> PASS|FAIL|NOT RUN

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
