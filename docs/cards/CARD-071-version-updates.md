# CARD-071: Version and Update now on every app

| Field | Value |
|---|---|
| Card | CARD-071 |
| Title | Version and Update now on every app |
| Size | L |
| Depends on | Claude's front-end PR ("Version and updates: the screens"), merged to `main` |
| Spec sections | docs/SPEC.md §12.11 (read it first, all of it), §12.1 (Updates), §12.2 (Self-update), §12.3 (parent mode), §12.7 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-071-version-updates` |
| PR title | `CARD-071: Version and Update now on every app` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

All three apps already update themselves: the kid app silently as Device Owner (§12.1, `android/app-kid/.../update/AppUpdater.kt`), the PC service from an MSI (§12.2, `windows/src/ScreenTime.Core/Update/UpdateDecision.cs` and `Worker.cs`), the parent app on a tap (§12.7, `android/app-parent/.../update/ParentUpdater.kt`). This card adds a parent's own **Check for updates** and **Update now** on top, with the version shown, the same way in all three.

**Claude built the front end** (rule 10 of `AGENTS.md`: do not change these files, even to fix something; write it under "Blockers / questions"):

- `android/core-ui/src/main/kotlin/au/screentime/core/ui/update/`: `UpdateState`, `UpdateSource` (`state`, `checkNow()`, `update()`), the words, `checkOnOpen(...)`, the `UpdatesSheet` composable and `VersionLink`.
- `android/app-kid/.../update/KidUpdateSeam.kt`: `FakeKidUpdateSource`, **which you replace and delete**. The kid main screen's version link under the parent mode banner.
- `android/app-parent/.../home/SettingsScreen.kt`: the version link and the sheet (the parent app's `ParentUpdates.source` now implements the core-ui `UpdateSource`).
- `windows/src/ScreenTime.Core/Update/UpdateView.cs` (`UpdateView`, `UpdateWords`), the pipe lines `update-check`, `update-now`, `update` in `PipeMessage.cs`, the tray's version link and Updates panel (`FlyoutWindow.xaml`, automation ids `VersionLink`, `UpdatesStatus`, `UpdatesMain`, `UpdatesLater`), and `FakeUpdates` in `DemoStatus.cs`, which only `--demo` uses: the real tray shows no version link until the service sends its first `update` line. The tray treats a refused or unreachable `update-check` / `update-now` as `check-failed` / `failed`; `SendResult.Refused` was added for the refusal.
- `test-vectors/update-words.json` and the tests that read it (`android/core-ui/src/test/.../UpdateWordsTest.kt`, `UpdateWordsTests.cs`): they must pass unchanged.

## 2. Goal

A parent in parent mode on a kid PC or kid phone, or on the parent app, sees the version, opens Updates, and gets a real check and a real **Update now** that installs straight away; parent mode is still on afterwards.

## 3. Out of scope

- Any server change. The check and download routes already exist and stay as they are.
- **Any change to the automatic updates.** When they check (6 hours), download (unmetered network on Android) and install (screen off on Android, nobody using the PC or 24 hours on Windows, a tap on the parent app), the "Update now" notification on the kid phone, the 3-failure give-up: all stay exactly as they are. This card only adds a manual trigger. Every behaviour that differs happens only after a parent tapped **Check for updates** or **Update now**, and only for that one check or install.
- The parent web app. Any change to Claude's files listed above. New words.
- The two known CARD-061 gaps (service information logs, double tray after a plain `Restart-Service`).

## 4. Tech and traps

- `pwsh` 7 only, never Windows PowerShell 5.1. UTF-8 without BOM.
- Kotlin, JUnit 6 (Jupiter); C# .NET 10, xUnit, Native AOT: any new JSON type needs the source-generated context (`PipeJsonContext` or the one `PipeMessage` already uses).
- A **debug** kid build is test-only and Android refuses to update it silently: build both versions with `-PkidTestOnly=false`, as `docs/cards/CARD-059-run.ps1` does (copy its shape).
- A console run of the service never installs: the Windows run happens in **Windows Sandbox**, copied from `windows/installer/sandbox/Test-Update.ps1` and `in-sandbox-update.ps1` (two CI builds A and B, `publish-downloads.ps1 -Windows -RunId <id> -DeviceId <id> -To deploy\releases`). Inside the Sandbox, click the tray with UI Automation by the automation ids above (see `in-sandbox-setup.ps1`'s `Press`). PowerShell inside the Sandbox is 5.1.
- An upgrade rewrites the service's ImagePath, so Sandbox flags (`--session 1 --dry-lock`) must be set again after B is installed (CARD-061 lesson). Do **not** pass `--update-anytime` in this run: the point is that a tap installs without it.
- The emulator is Android Studio's `Medium_Phone_API_37.0`. Parent mode on it: `server/scripts/dev-parent-mode.ts`.

## 5. Design (what to build)

### 5.1 Kid app (`android/app-kid`)

- A real `KidUpdateSource` (in `update/`) implementing core-ui's `UpdateSource`, backed by `AppUpdater`; set it where the fake is set, delete `KidUpdateSeam.kt`. The service owns the updater; the screen reaches it through `KidUpdates.source` (already declared by Claude).
- `checkNow()`: a check at once (`checking`, then `up-to-date` / `available` / `ready`, or `check-failed` when the call fails). It does **not** touch the automatic 6-hour timer: the next automatic check comes when it would have anyway.
- `update()`: downloads even on a metered network, then installs at once with the screen on (the existing `askNow()` path), never while an SOS is on. Writes `update_asked_at` (epoch ms) to SharedPreferences just before the install.
- `installing` while the session is committed; `failed` when `UpdateResultReceiver` gets a failure status or the file does not match.
- `BootReceiver` on `MY_PACKAGE_REPLACED`: as now, and if `update_asked_at` is within 10 minutes, start `MainActivity` and clear it. A pure function decides "within 10 minutes" (test it).

### 5.2 Windows (`windows/src`)

- `UpdateDecision`: a new input `Asked` (a parent's **Update now** not yet acted on). With `Asked`: download when the file is not verified, then `Install` even when someone is using the PC and even when the version gave up after 3 failures. Without it: exactly today's rules (existing tests stay unchanged).
- `Worker.cs`: handle `update-check` (one extra check at the next tick, whatever the 6-hour timer, without moving that timer's last-check time) and `update-now` (set `Asked`) **only from a session whose account is in parent mode**; otherwise `reply` `Refused` (`SendResult.Refused`; `Sent` otherwise) and log `update: refused, not in parent mode`. 
- Build an `UpdateView` (pure, in Core, tested) from the running version, the offer, the verified file, the pending attempt and the last check's result, and send `update` to every connected tray on `hello` and whenever it changes. A failed check is `check-failed` until the next check.
- Parent mode must survive the update (same end time). If it does not, that is a finding: report it, do not add a workaround outside this card.

### 5.3 Parent app (`android/app-parent`)

- `ParentUpdater`: a parent-asked check (`checkNow()`) that fails gives `check-failed` (today it falls back to the earlier state). Automatic checks that fail stay silent. Nothing else changes.

## 6. Acceptance criteria

Windows, unit (`windows/tests/ScreenTime.Core.Tests/UpdateTests.cs` and a new `UpdateViewTests.cs`):

1. Fixture: running 130, offer 131 verified at `2026-11-21T09:00:00Z`, now `2026-11-21T10:00:00Z`, someone using the PC, `Asked = false` → `Nothing`; same with `Asked = true` → `Install`.
2. Offer 131 not downloaded, someone using the PC, `Asked = true` → `Download`; after it is verified (same inputs, verified) → `Install`.
3. Offer 131 with 3 failures: `Asked = false` → `Nothing`; `Asked = true` → `Install`.
4. No offer, `Asked = true` → `Nothing` (and the view is `up-to-date` after a successful check).
5. `UpdateView` for each of: never checked (`unknown`), check running (`checking`), last check failed (`check-failed`), offer 131 not downloaded (`available`, `offered` "0.1.131", `sizeBytes` the offer's), downloading, verified (`ready`), pending attempt (`installing`), last attempt failed (`failed`), offer equal to running (`up-to-date`).
6. A session not in parent mode sending `update-now` gets `refused` and `Asked` stays false (test the pure guard you write for it).
7. Every existing test in `UpdateTests.cs` passes unchanged.

Android, unit (`android/app-kid/src/test/.../update/KidUpdateSourceTest.kt`, `BootReceiverTest` or a pure-function test, `android/app-parent/src/test/.../update/ParentUpdaterTest.kt`):

8. Kid `checkNow()`: server offers 901 to running 900 → `available` then `ready` once downloaded; offers null → `up-to-date`; call throws → `check-failed`.
9. Kid `update()` on a metered network with 901 not downloaded → downloads (the existing rule without the tap still waits: `nextUpdateStep(..., metered = true, asked = false)` → `NOTHING`).
10. Kid `update()` while an SOS is on → no install.
11. "Reopen after update": asked at `2026-11-21T10:00:00Z`, replaced at `10:09:59` → open; at `10:10:01` → do not open; no note → do not open.
12. Parent `checkNow()` whose call throws → `check-failed`; an automatic check that throws leaves the state as it was.
13a. **The automatic path is unchanged:** every existing test of `nextUpdateStep`, `checkDue` and `AppUpdater` (kid) and of `ParentUpdater` (parent) passes unchanged. A manual check at `2026-11-21T10:00:00Z` after an automatic one at `08:00:00Z` leaves the next automatic check due at `14:00:00Z` (test it on both Android and Windows). `git diff main -- android/app-kid/src/main/kotlin/au/screentime/kid/update/AppUpdater.kt` changes no line of `nextUpdateStep` or `checkDue` (paste it).
13. `UpdateWordsTest` (Kotlin) and `UpdateWordsTests` (C#) pass unchanged. `Select-String -Path android -Pattern 'FakeKidUpdateSource' -Recurse -Include *.kt` prints nothing.

Emulator run, kid app (`docs/cards/CARD-071-kid-run.ps1`, which you write from `CARD-059-run.ps1`; prints `PASS`/`FAIL` and every `Screen-Text`):

14. Kid version 900 (`0.9.0`, `-PkidTestOnly=false`) enrolled, no `kid.json` published. Main screen outside parent mode: `Screen-Text` has no "Version". Parent mode on (`dev-parent-mode.ts yes`, 15 min): `Version 0.9.0` shows under **End now**.
15. Tap it → the sheet says `You're up to date` (screenshot `card071-kid-uptodate`).
16. Publish 901 (`0.9.1`) for this device only. Tap **Check for updates** → `0.9.1 is ready. Update now?` or `0.9.1 is out (… MB). Update now?` within 60 s (print it; screenshot `card071-kid-offer`).
17. Tap **Update now** with the screen on → within 60 s `dumpsys package au.screentime.kid` shows `versionCode=901`; within 15 s more the focused window (`dumpsys window | Select-String mCurrentFocus`) is ST Kid, and `Screen-Text` still shows parent mode with the same end time (print both).
18. Stop the server (`docker compose ... stop api`), open the sheet, **Check for updates** → `Couldn't check. Check the internet and try again.` Start it again.

Windows Sandbox run (`windows/installer/sandbox/Test-Versions.ps1` + `in-sandbox-versions.ps1`, which you write from the CARD-061 pair; every line they print goes in the handback):

19. Install CI build A, enrol, **not** in parent mode: the open flyout has no visible `VersionLink` (print the automation search result). (The service's refusal is proven by criterion 6's unit test; the UI cannot send it.)
20. Parent mode on (`dev-parent-mode.ts yes`, 15 min): `VersionLink` reads `Version <A>`. Invoke it → `UpdatesStatus` reads `You're up to date` within 30 s.
21. Publish B for this PC only. Invoke **Check for updates** (`UpdatesMain`) → `UpdatesStatus` reads `<B> is ready. Update now?` (or `is out`) within 120 s.
22. Invoke **Update now** with the kid session unlocked → within 3 minutes the installed version is B (`Get-ItemProperty` of the uninstall key, print it), exactly one `ScreenTime.Tray.exe` runs in session 1, its `VersionLink` reads `Version <B>`, parent mode is still on with the same end time (print the tray's subline), and no `tamper.` event for this PC appears in the dev database (print the query and its result).

Parent app (one short emulator step, may go in the kid run script):

23. Parent app signed in as `dad@example.com`, server stopped: Settings › `Version …` → sheet → **Check for updates** → `Couldn't check. Check the internet and try again.` (print `Screen-Text`).

Whole card:

24. Section 8 passes; the last `git diff --name-only main` lists only: `android/app-kid/src/main/kotlin/au/screentime/kid/update/*`, `.../service/BootReceiver.kt`, `.../service/KidService.kt`, `android/app-parent/src/main/kotlin/au/screentime/parent/update/ParentUpdater.kt`, `windows/src/ScreenTime.Core/Update/*` (not `UpdateView.cs`'s words), `windows/src/ScreenTime.Core/Service/*` only if a JSON context needs a type, `windows/src/ScreenTime.Service/Worker.cs`, `windows/src/ScreenTime.Tray/*.cs` (wiring only, not the XAML), your tests, the deleted `KidUpdateSeam.kt`, and the run scripts.

**Break it yourself** (paste each failing test, restore with `git checkout -- <file>` between them):
- In `UpdateDecision`, ignore `Asked` → criteria 1 to 3 fail.
- In the Worker's guard, accept `update-now` from any session → criterion 6 fails.
- In the kid source, map a thrown check to `up-to-date` → criterion 8 fails.
- In the reopen function, use 10 hours instead of 10 minutes → criterion 11 fails.

## 7. Tests you write

As listed in section 6, one test per unit-test criterion (1 to 13a; criteria 14 to 23 are scripted run steps whose real printed output you paste, 24 is the diff check), named after the behaviour it proves, with the card's fixed inputs. **Changing what an existing test checks is a deviation**: list it.

## 8. Checks

From the repo root, in `pwsh`. Save slow output to a file and search it (AGENTS.md, "Saving test output").

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
cd windows; dotnet test *> C:\Users\james\OpenCode\Testing\temp\card071-dotnet.txt; "exit $LASTEXITCODE"; cd ..
Select-String -Path C:\Users\james\OpenCode\Testing\temp\card071-dotnet.txt -Pattern 'Passed!|Failed!'
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test *> C:\Users\james\OpenCode\Testing\temp\card071-gradle.txt; "exit $LASTEXITCODE"
.\gradlew.bat --stop
cd ..
Select-String -Path C:\Users\james\OpenCode\Testing\temp\card071-gradle.txt -Pattern 'BUILD (SUCCESSFUL|FAILED)|tests completed'
Select-String -Path android -Pattern 'FakeKidUpdateSource' -Recurse -Include *.kt
pwsh -File docs\cards\CARD-071-kid-run.ps1
pwsh -File windows\installer\sandbox\Test-Versions.ps1
git diff --name-only main
```

## 9. Git and pull request

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-071-version-updates`.
2. Small commits: `CARD-071: <what changed>`.
3. Run section 8 again before pushing.
4. `git push -u origin bob/card-071-version-updates`; open a PR into `main` titled `CARD-071: Version and Update now on every app`, body in a file in `C:\Users\james\OpenCode\Testing\temp\` with: Card, What I did, Acceptance criteria (each with its proof and output), Deviations from the card, Blockers / questions.
5. **Do not merge.** Do not push to `main`.

## 10. If something is wrong

Stop, commit what works, and write it under "Blockers / questions". In particular: if parent mode does not survive an update on either platform, if the kid app does not come back to the front after criterion 17, or if a Device Owner app is refused the activity start, report the exact output; do not work around it.

## 11. Handback report (required)

Your **last message to James**, inside one fenced code block. Real output only; `NOT RUN` with the reason for anything you did not run. Every Sandbox and emulator step's **real printed output**, not a summary. Every workaround (a retry, a restart, an extra script) is a deviation.

````text
Claude, here is Bob's handback for CARD-071. Please review and merge if it is good.

CARD: CARD-071 Version and Update now on every app
PR: <full PR URL>
Branch: bob/card-071-version-updates
Head commit: <git rev-parse HEAD>

Files changed (`git diff --name-only main...HEAD`):
<list>

Tests I wrote (file: test names, copied from the files):
<list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>

Break it yourself (each change, the failing test output, restored):
<list>

Kid emulator run (every line CARD-071-kid-run.ps1 printed):
<paste>

Windows Sandbox run (every line Test-Versions.ps1 and in-sandbox-versions.ps1 printed):
<paste>

Screenshots (path: what it shows, or "not opened"):
<list>

Acceptance criteria:
- 1: <test or step> PASS|FAIL|NOT RUN
- ...
- 24: <test or step> PASS|FAIL|NOT RUN

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
