# CARD-061: Windows updates itself

| Field | Value |
|---|---|
| Card | CARD-061 |
| Title | Windows updates itself |
| Size | L |
| Depends on | CARD-060, merged to `main` |
| Spec sections | docs/SPEC.md §12.2 (Updates), §9.3, §12.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-061-windows-updates` |
| PR title | `CARD-061: Windows updates itself` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**How this card works (James, 16 Nov 2026).** Claude did the design and wrote this card: the behaviour, the interfaces and the acceptance criteria. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a type, a route, a field, a pipe line or a file, use that name exactly; everything else (class layout, helper names) is your choice, as long as it follows the repo's existing patterns and `AGENTS.md`. Claude will re-run your tests, check your run's ids and times against the files and the database, and review the code line by line before merging.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM.

**What exists today.** A Windows PC only changes version when a parent runs a newer MSI on it by hand. The kid app on Android already updates itself from the family's server (CARD-059): it calls `POST /v1/device/app-update/check` with its version, gets an `offer` (version, `sha256`, `sizeBytes`) when `kid.json` in the server's releases folder has something newer for it, downloads the file from `GET /v1/device/app-update/apk`, checks it, and installs it. The Windows service already calls the same check once per start, but only to report its version: the server always answers `offer: null` to a PC, and the service ignores the answer. `deploy/publish-downloads.ps1 -Windows` already puts CI's newest MSI and `windows.json` in the releases folder for the download page.

**What Claude tried first (Windows Sandbox, 16 Nov 2026).** MSI 0.1.88 installed, a kid account enrolled, the tray running in its session; then MSI 0.1.89 installed with `msiexec /i <file> /qn /norestart /l*v <log>` from a one-time scheduled task running as SYSTEM, which is what this card's service will do:

| Thing tried | Result |
|---|---|
| msiexec's exit code | `0`. **No restart needed:** no `PendingFileRenameOperations` entry for ScreenTime. Only `C:\Config.Msi\*.rbf` temp files are queued for deletion at the next reboot, which is harmless |
| The service | The MSI's own service control stopped 0.1.88 and started 0.1.89. Running the new version straight after |
| How long | 134 s in the Sandbox |
| **The tray** | **The old tray kept running.** The log says Restart Manager shut it down, but the process stayed; its exe was swapped on disk underneath it. When the new service started a tray, there were **two**: the old one and a new one |

So the PC does not restart. Instead, the service closes its own trays before it starts the installer.

## 2. Goal

A Windows PC updates itself. The service asks the server for a newer version at start and every 6 hours; when there is one, it downloads the MSI into its protected folder and checks it; when nobody is using the PC (or after a day at the latest) it closes the trays, installs the MSI silently through a one-time SYSTEM task, and the new version starts by itself with one new tray and no restart. A parent can offer a version to one PC first. Nothing is reported as tampering.

## 3. Out of scope

- **No PC restart** of any kind, and no `shutdown.exe`.
- No change to the MSI (`windows/src/ScreenTime.Installer/`): the spike shows it already upgrades in place.
- No change to the Android kid app, the parent app or the web app, and no new notification kind. Parents see the new version on the Devices panel as today.
- No new library or package. Do not edit generated files by hand (`pnpm contract`).
- **Never run an installer on James's PC.** The update code only ever installs when the service runs as a real Windows service (`ServiceOptions.AsService`), and the only place you run that is Windows Sandbox (section 8.2).
- Never commit secrets (`deploy/.env`, tokens, keys).

## 4. Tech and traps

The project's existing stack, with nothing new: TypeScript (Hono, zod, Drizzle, Vitest), C# on .NET 10 (the service is **Native AOT**, the tray is WinUI and is not), xUnit, PowerShell 7. Windows Sandbox for the run (James has it turned on).

Traps Claude already hit, so you need not:

- **Native AOT.** The service cannot use reflection-based JSON or `[ComImport]` COM. Use source-generated JSON contexts (like `ParentModeJsonContext`), and create the scheduled task with `schtasks.exe` (a process), not the Task Scheduler COM API.
- **The tray restarts itself.** `TrayHost`'s loop starts a tray again about a second after it exits, and an exit is judged as a possible tamper 30 s later (`TrayExit`, `TrayKillWatch`). While an update is starting, both must be off for that session, or you get a new tray straight away and a false "tray app was closed" alert.
- **A version from a local build is `1.0.0`.** CI builds the MSI as `0.1.<run number>`, and the service's `versionCode` is that run number (`Win.AppVersion()`). Two MSIs for the Sandbox run must come from two CI runs of **your branch** (section 8.2).
- **Windows Sandbox on this PC does not run a `.wsb` LogonCommand** (Claude's spike sat at an empty desktop). Start the Sandbox, then drive it from the host with the `wsb` CLI: `wsb list`, `wsb exec --id <id> -c "cmd.exe /c powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\<script>.ps1 > C:\out\<name>-err.txt 2>&1" -r ExistingLogin`. PowerShell inside the Sandbox is **5.1**: inside a string, write `${LASTEXITCODE}:`, not `$LASTEXITCODE:` (a parse error).
- **The Sandbox has no console session.** As in `windows/installer/sandbox/in-sandbox.ps1`, set the installed service's `ImagePath` to `"<exe>" --session <session> --dry-lock` and restart it. **An upgrade rewrites `ImagePath`** (the MSI reinstalls the service), so the new service comes up without those flags and starts no tray until you set them again. That is a Sandbox artefact: say so in the run, set them again, restart, and check the tray then.
- **Enrolment codes last 10 minutes.** Make one (`server/scripts/dev-enrol-code.ts`) just before the Sandbox uses it.
- The Sandbox reaches the host's dev server at its default gateway, port 8080 (see `in-sandbox.ps1`).
- Run `dotnet test` **from the `windows` folder**, where `global.json` is.
- On a fresh checkout, `pnpm build` must run before `pnpm contract`.

## 5. Design (what to build)

### 5.1 Publishing (`deploy/publish-downloads.ps1`)

- `-Windows` writes `versionCode` into `windows.json`: the CI run **number** the MSI came from (the same number as in `0.1.<number>`).
- New `-DeviceId <uuid>`: adds `deviceIds: ["<uuid>"]` to `windows.json`, so only that PC is offered it (like `android/publish-kid.ps1 -DeviceId`). The download page still lists the file, as it does for a pilot kid app.
- New `-RunId <databaseId>`: take the MSI from that CI run instead of the newest successful run on `main` (for the Sandbox run, from your branch). It must still be a successful run of `windows.yml`.
- Everything else stays as it is (file first, `.json` last, `-To` for a folder).

### 5.2 Server

- `POST /v1/device/app-update/check`, for a **Windows** device: read `windows.json` with the same rules as `kid.json` (a missing or invalid file, or one without `versionCode` or `sha256`, means no offer and is logged once per read like `kid.json`). Offer it when its `versionCode` is greater than the one sent and, if it has `deviceIds`, the device is in it. The answer's shape is unchanged (`AppUpdateOffer`). Android behaves exactly as before. It still stores the version sent.
- New `GET /v1/device/app-update/msi`: the published MSI as plain bytes for a Windows device it is offered to (device token; `Content-Type: application/x-msi`, `Content-Length`). 404 when there is none for this device, for an Android device, or when the file is missing. Not in the OpenAPI contract, like `/apk`.
- `windows.json` may now hold `versionCode` and `deviceIds`. The public download list (`/v1/downloads`) keeps working with or without them.

### 5.3 Windows: the decision (in `ScreenTime.Core`, pure and unit-tested)

Put the rules in `ScreenTime.Core` (for example a folder `Update/`), with no Windows calls, so xUnit can test them with fake times and fake answers. The service only feeds it facts and carries out what it decides. It covers:

- **Which offer.** The PC has one service but may have several enrolled accounts, each asking the server. Take the highest `versionCode` offered by any account; ignore an offer not higher than the running version.
- **When to check.** At the first successful sync after start, then every 6 hours. A failed check tries again at the next sync.
- **Download.** Into `<data folder>\updates\ScreenTime-<versionName>.msi` (the data folder is `C:\ProgramData\ScreenTime`, which only SYSTEM and Administrators can write, so a kid cannot swap the file). Write to a `.part` file first; keep it only when its size and SHA-256 match the offer, otherwise delete it, log it, and try again at the next check. An MSI that is not verified is never run. When the offer goes away, delete what was downloaded.
- **When to install.** When no enrolled account's session is unlocked or in parent mode (locked, signed out, bedtime-locked, or nobody signed in). If that has not happened 24 hours after the download was verified, install anyway.
- **Attempts.** Remember the pending update (target `versionCode` and when it started) in the store's key-value table, so it survives the service stopping. At start: the running version is the target or higher means success (log `update: now <versionName>`, delete the file and the task, clear it); lower means that attempt failed. If the service is still running 10 minutes after it started the installer, that attempt failed too: let the trays start again. After **3 failed attempts** for one `versionCode`, stop trying that version until a higher one is offered.

### 5.4 Windows: carrying it out (service and tray)

- Only when `ServiceOptions.AsService` is true. In a console run (`--data …`, James's PC) the service checks, downloads and logs what it would do (`update: would install <versionName> (not a service)`), and installs nothing.
- New dev-only option `--update-anytime`: skip the "nobody is using the PC" wait, for the Sandbox run. Like `--session`, it is refused without `--dry-lock`, and the refusal message lists it.
- Before installing, for every kid session: turn off the tray restart loop and tray-exit judging, send the new pipe line `{"type":"quit"}` (service to tray), and wait up to 10 s for the tray to exit; kill it if it has not.
- The tray on `quit`: exits at once, as it does when the service is gone for 30 s (`TrayModel.Quit`).
- Then: `schtasks.exe /Create /TN ScreenTimeUpdate /TR "msiexec.exe /i \"<msi>\" /qn /norestart /l*v \"<data folder>\updates\install.log\"" /SC ONCE /ST 00:00 /RU SYSTEM /RL HIGHEST /F`, then `schtasks.exe /Run /TN ScreenTimeUpdate`, and log `update: installing <versionName>`. The MSI stops this service; that is expected. The new service deletes the task (`schtasks /Delete /TN ScreenTimeUpdate /F`) at start.
- If the task cannot be created or run: log it, count the attempt as failed, and start the trays again.
- Log lines start with `update: ` so the run can find them.

## 6. Acceptance criteria

Each one is checked by a command in section 8 or by a test you write (section 7). Claude re-checks every one.

**Server**

1. A Windows device whose version is lower than `windows.json`'s `versionCode` gets the offer (`versionCode`, `versionName`, `sha256`, `sizeBytes` from `windows.json`); equal or higher gets `offer: null`.
2. With `deviceIds`, only those Windows devices get the offer; the others get `null`.
3. A missing `windows.json`, invalid JSON, or one without `versionCode` or `sha256`, gives `offer: null`, and the request still stores the version (the device's `appVersion`).
4. Android devices get exactly what they got before: `kid.json` offers, never `windows.json` (the existing `app-update.test.ts` tests pass unchanged).
5. `GET /v1/device/app-update/msi` returns the file's bytes with `Content-Type: application/x-msi` and the right `Content-Length` to an offered Windows device; 404 to an Android device, to a Windows device not in `deviceIds`, and when the file is missing; 401 with no or a bad token.
6. `/v1/downloads` still lists the Windows file when `windows.json` has `versionCode` and `deviceIds`.

**Publishing**

7. `pwsh -File deploy\publish-downloads.ps1 -Windows -RunId <id> -DeviceId <uuid> -To <folder>` writes `ScreenTime-0.1.<n>.msi` and a `windows.json` with `versionName` `0.1.<n>`, `versionCode` `<n>`, the file's `sha256` and `sizeBytes`, and `deviceIds`; without `-DeviceId` there is no `deviceIds`.

**Windows decision (`ScreenTime.Core` unit tests)**

8. The highest offer across accounts wins; an offer not higher than the running version is ignored.
9. Checks happen at the first successful sync and then every 6 hours, not more often.
10. A download is kept only when size and SHA-256 both match; otherwise it is thrown away and nothing is installed.
11. Install is decided only when no session is unlocked or in parent mode, or 24 hours after the verified download, or at once with `--update-anytime`.
12. Success and failure are worked out at start from the stored pending update; a still-running service 10 minutes after starting the installer is a failure; after 3 failures for one `versionCode`, that version is not tried again until a higher one is offered.
13. The `quit` pipe line encodes as exactly `{"type":"quit"}` and decodes back.

**Windows behaviour (the Sandbox run, section 8.2)**

14. Starting from the older MSI (`A`) with a kid enrolled and its tray running, after publishing the newer MSI (`B`) to the dev server for that PC only, the service by itself: logs the offer, downloads and verifies `B`, quits the tray, starts the installer, and comes back as `B`'s version.
15. msiexec's exit code in `install.log` is `0`, and there is no `PendingFileRenameOperations` entry containing `ScreenTime`.
16. After setting the Sandbox flags again (section 4), **exactly one** tray runs, and it is `B`'s version.
17. The dev database shows the device's `app_version` as `B`'s `versionName`, and **no** `tamper.*` event for that device after the update started.
18. The pending update is cleared, the `ScreenTimeUpdate` task no longer exists, and `updates\` holds no MSI.
19. With a `windows.json` whose `sha256` is wrong, the service logs the mismatch, deletes the download, and installs nothing (the running version stays `A`).
20. A console run on James's PC never starts an installer (it logs `would install`), and `--update-anytime` without `--dry-lock` is refused with exit code 2.

**General**

21. `pnpm typecheck`, `pnpm test`, `dotnet test` and the Android build pass; CI is green.
22. Nothing in `windows/src/ScreenTime.Installer/`, the Android apps or the web app changed, and no generated file was edited by hand.

## 7. Tests you write

- `server/test/app-update.test.ts`: add tests for criteria 1 to 6 (keep every existing test unchanged). Use a temporary releases folder as the file already does.
- `windows/tests/ScreenTime.Core.Tests/UpdateTests.cs` (new): criteria 8 to 13, with fake times and offers. Name each test after the behaviour it proves.
- A test for criterion 7 is not needed; section 8.1 runs it.
- Every new test must fail if the behaviour it names is broken. Claude will break a few lines of your code on purpose to check.

## 8. Checks

### 8.1 Build, tests and publishing

From the repo root, in `pwsh`:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm contract
git status --short contract
pnpm typecheck
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
docker exec screentime-db-1 psql -U screentime -d postgres -c "create database screentime_test"
$pw = (Select-String -Path deploy\.env -Pattern '^POSTGRES_PASSWORD=(.*)').Matches[0].Groups[1].Value
$env:TEST_DATABASE_URL = "postgres://screentime:$pw@localhost:5432/screentime_test"
pnpm test
Remove-Item Env:TEST_DATABASE_URL
cd windows
dotnet test
dotnet build src\ScreenTime.Service -c Release
& src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe --update-anytime; "exit $LASTEXITCODE"
cd ..\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git diff --stat main -- windows/src/ScreenTime.Installer android/app-kid android/app-parent web/src
```

Paste each command's key output. The last line must print nothing.

### 8.2 The Sandbox run (criteria 14 to 20)

Write the run yourself as `windows/installer/sandbox/Test-Update.ps1` (on the host) and `windows/installer/sandbox/in-sandbox-update.ps1` (inside the Sandbox), next to the existing Sandbox scripts and in the same style. It must, in order, printing every step's real output:

1. Push your branch and get two successful `windows.yml` runs of it (CI runs one for the PR; start another with `gh workflow run windows.yml --repo jamesgallagher/ScreenTime --ref bob/card-061-windows-updates`). `A` is the lower run number, `B` the higher. Print both run ids and numbers.
2. Reset and seed the dev stack as `Test-Installer.ps1` does (this **wipes the development database and replaces `deploy\.env`** with throwaway values), and make sure `deploy\releases\` holds no `windows.json` yet.
3. Download `A`'s MSI. Start the Sandbox, then with `wsb exec`: install `A`, enrol the Sandbox account as Sam with a fresh code, set the service's `ImagePath` to `--session <s> --dry-lock --update-anytime`, restart it, and print the service version and every tray (pid, session, version).
4. On the host, find the Sandbox PC's device id in the dev database and publish `B` for it only: `publish-downloads.ps1 -Windows -RunId <B> -DeviceId <id> -To deploy\releases`. Print `windows.json`.
5. Wait (up to 10 minutes) for the update, printing the service's `update:` lines from its log. Then print: msiexec's exit code from `install.log`, the `PendingFileRenameOperations` check, the service version, and every tray. Set the Sandbox flags again (`--session <s> --dry-lock --update-anytime`), restart the service, wait 30 s, and print the service version and every tray again (criterion 16).
6. On the host, print the device's `app_version` and every `tamper.%` event for it from the dev database (criterion 17), and inside the Sandbox print the task check (`schtasks /Query /TN ScreenTimeUpdate`), the `updates\` folder and the stored pending update (criterion 18).
7. Publish `A`'s file again as a fake newer version with a wrong `sha256` (write that `windows.json` by hand with a `versionCode` above `B`'s), wait for the next check (restart the service to make it check now), and print the `update:` lines and the running version (criterion 19).
8. Stop the Sandbox (`wsb stop --id <id>`) and print `=== done`.

Run it from the repo root with `pwsh -File windows\installer\sandbox\Test-Update.ps1 2>&1 | Tee-Object -FilePath ..\temp\card061-bob-out.txt`. Every step prints real output; a step that could not run prints `NOT RUN: <reason>` and the run goes on where it can.

## 9. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-061-windows-updates
   ```
2. Commit in small logical commits. Message format: `CARD-061: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes.
4. Push: `git push -u origin bob/card-061-windows-updates`
5. Open a PR into `main` titled `CARD-061: Windows updates itself`, with its body written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-061-windows-updates.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] 1 — how it is proven (test name or run step) and the output
   - ...

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 11).

## 10. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. In particular, if the Sandbox shows that a restart **is** needed, or that the tray does not exit on `quit`, report it with the output; do not add a restart.

## 11. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs, the dev database and its own run of your tests, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- **Every acceptance criterion (1 to 22)** gets one line: the test name or the run step that proves it, and `PASS`, `FAIL` or `NOT RUN`.
- The Sandbox run is pasted **whole**: every line of `card061-bob-out.txt`. A step without its pasted output counts as `NOT RUN`.
- "Deviations" lists every way your work differs from the card, and every workaround you used in the run (a restart, a retry, an extra command) with why you needed it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-061. Please review and merge if it is good.

CARD: CARD-061 Windows updates itself
PR: <full PR URL>
Branch: bob/card-061-windows-updates
Head commit: <output of `git rev-parse HEAD`>
CI runs used for the Sandbox: A = <run id> (#<number>), B = <run id> (#<number>)

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Tests I wrote (file: test names):
<list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- 1: <test or step> PASS|FAIL|NOT RUN
- ...
- 22: <test or step> PASS|FAIL|NOT RUN

The Sandbox run (all of card061-bob-out.txt):
<paste it>

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
