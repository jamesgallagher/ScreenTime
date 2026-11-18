# CARD-064: The parent app updates itself

| Field | Value |
|---|---|
| Card | CARD-064 |
| Title | The parent app updates itself |
| Size | M |
| Depends on | Claude's front-end PR ("Parent app updates: the screens, spec and CARD-064"), merged to `main` |
| Spec sections | docs/SPEC.md §12.7 (read it first), §9 (`/v1/me/app-update/…`), §12.1 (Updates), §12.5, §16.4 (Update row) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-064-parent-updates` |
| PR title | `CARD-064: The parent app updates itself` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**How this card works.** Claude did the design, built the parent screens and wrote this card: the behaviour, the interfaces and the acceptance criteria. **You write the code and the tests**, run every check and the emulator run, and send the handback. There is no code to copy. Where the card names a table, column, route, field, type, file or text, use that name exactly; everything else is your choice, as long as it follows the repo's patterns and `AGENTS.md`. Claude will re-run your tests, break a few lines of your code on purpose to see that a test fails, open every screenshot, check the run against the database, and review the code line by line before merging.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Write every file as UTF-8 without a BOM.

**What James asked for (18 Nov 2026).** The kid app and the Windows app update themselves from the family's server. The parent app does not: each new version has to be installed by hand on each parent's phone. James wants the parent app to know when a new version is out and to install it.

**The design in one paragraph (SPEC §12.7).** The parent app is not Device Owner, so it cannot install silently the way the kid app does. Claude tried it on the emulator (results in §12.7 and in 4 below): the first update always shows Android's "Update this app?", and Play Protect may ask about every new version. So the app **checks and downloads by itself, and installs when a parent taps Update**. The server offers `parent.json` (already written by `deploy/publish-downloads.ps1 -Parent`) to signed-in parents through two new routes, the same way it offers `kid.json` to kid devices.

**What Claude built (the front-end PR, merged before this card).** The screens, behind a seam that answers from memory:

| File (in `android/app-parent/src/main/kotlin/au/screentime/parent/`) | What it is |
|---|---|
| `update/ParentUpdate.kt` | `UpdateState` (Unknown, Checking, UpToDate, Available, Downloading, Ready, Installing, Failed), the `UpdateSource` interface (`state`, `checkNow()`, `update()`), the `ParentUpdates.source` holder, and the wording helpers. **Claude's: do not change.** |
| `update/UpdateRow.kt` | The row at the top of every tab. **Claude's: do not change.** |
| `home/HomeScreen.kt`, `home/SettingsScreen.kt` | Show the row and the version footer. **Claude's: do not change.** |
| `update/UpdateSeam.kt` | `FakeUpdateSource`: **you delete it.** |
| `ParentApp.kt` | Sets `ParentUpdates.source = FakeUpdateSource()`: **you change that line** (and its comment) to your real updater. |

Tests: `src/test/kotlin/au/screentime/parent/update/ParentUpdateTest.kt` (Claude's, keep it passing unchanged).

## 2. Goal

A parent phone with this version installed finds every later version on its own, downloads it, and installs it on one tap of **Update**, with the server knowing which version each parent phone runs.

## 3. Out of scope

- **No change to Claude's front-end files** (table above), except the one line in `ParentApp.kt`. A UI bug you find goes under "Blockers / questions".
- No silent install without a tap, no install when the app goes to the background, no notification about updates. (James chose "on a tap".)
- No change to the kid app, the Windows app, the web app or the download page (`/app`).
- No showing parent app versions anywhere in the web or Android UI (the server only stores it).
- No `Scan app` in Play Protect, ever, on any device: it uploads the APK to Google.
- No new library (no WorkManager). Do not edit generated files by hand: run `pnpm contract`.
- Never commit secrets (`deploy/.env`, tokens, keys, keystores, `google-services.json`).

## 4. Tech and traps

The existing stack only: TypeScript (Hono, zod, Drizzle, Vitest), Kotlin (JUnit Jupiter), PowerShell 7.

**What the emulator spike proved (18 Nov 2026, API 37 Play Store image, debug builds).** Read this before writing the installer; it is why the design is what it is.

- `PackageInstaller` session with `setAppPackageName(packageName)` and `setRequireUserAction(SessionParams.USER_ACTION_NOT_REQUIRED)`, committed with a `PendingIntent` to a receiver, exactly like the kid app's `AppUpdater.install` (`android/app-kid/.../update/AppUpdater.kt`).
- The manifest needs **both** `android.permission.REQUEST_INSTALL_PACKAGES` and `android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION`. Without the second, every update answers `STATUS_PENDING_USER_ACTION`, even when the app is its own installer.
- An app installed by the browser answers `STATUS_PENDING_USER_ACTION` (-1) on its first self-update, even with "Install unknown apps" allowed. The receiver then gets Android's screen as `Intent.EXTRA_INTENT`; start it with `FLAG_ACTIVITY_NEW_TASK`. **Android only opens it while the app is in front** (a background app cannot start activities), which is fine because a parent just tapped **Update**. After that one confirmed update, `dumpsys package` shows `installerPackageName=au.screentime.parent`, and later updates need nothing from Android.
- **Play Protect** shows "App scan recommended" for every version it has not seen, even from the background. Its **More details** opens **Install without scanning**. Your run taps that, never **Scan app**. A version declined there ends with a failure status in your receiver.
- To make the emulator look like a parent phone, install the first version with `adb shell pm install -i com.android.chrome <apk on the device>` (Chrome becomes the installer of record), not `adb install`. Push the APK to `/data/local/tmp/` first. In Git Bash, device paths get mangled; use `pwsh`.
- The emulator's only network is metered. As in the kid app, a debug build ignores "metered" (unit tests cover the rule itself).

**Other traps.**

- **Migration.** The latest is `0011_bedtime_extensions.sql`, so yours is `server/drizzle/0012_parent_app_version.sql`. Change `server/src/db/schema.ts`, run `pnpm --filter @screentime/server db:generate`, rename the generated file to that name, and check `server/drizzle/meta/_journal.json`. It only adds a nullable column to `parent_sessions`; that table's policies and grants already exist, so add nothing else.
- **Raw bytes.** `GET /v1/me/app-update/apk` is plain bytes like `/v1/device/app-update/apk`: register it with `app.get`, not in the contract. The app downloads it with its own HTTP call, so it needs the access token. `Session` keeps it private: add one public function to `Session` that returns a valid access token, refreshing it the way `call` does, and test it in `SessionTest.kt`.
- **Two version names in tests.** Gradle builds the parent app with `versionCode`/`versionName` from `android/app-parent/build.gradle.kts`. Add two optional Gradle properties, `parentVersionCode` and `parentVersionName`, that override them when given (the defaults stay exactly as they are). The run builds three versions with them; never edit `build.gradle.kts` during the run.
- **The dev server reads `deploy/releases`.** `deploy/docker-compose.yml` mounts it at `/releases`. The run writes the APK there first and `parent.json` last, as the publish script does. `deploy/releases` must stay out of git (check `.gitignore`; if it is not ignored, stop and ask).
- **Downloads page.** `server/src/downloads/routes.ts` also reads `parent.json`. A `parentIds` field must not break it (criterion 8).
- **After an install the old process is killed.** The new version starts fresh: on its first check it reports the new version and finds nothing newer. Delete the downloaded file once the running `versionCode` is at least the file's.
- Run Gradle from `android` with `JAVA_HOME` set to Android Studio's `jbr`.
- Kill a hung emulator by process name (`emulator*`, `qemu-system*`), start it with `-memory 3072`.

## 5. Design (what to build)

### 5.1 Data

`parent_sessions.app_version` (text, null): the parent app version of that session, set by the check route. Nothing else reads it in this card.

### 5.2 Server routes (`server/src`)

- `POST /v1/me/app-update/check` (parent bearer, `requireFamilyParent`): body `AppUpdateCheck`, answer `AppUpdateAnswer` (both already in `packages/schemas/src/appupdate.ts`; reuse them, no new schema). Stores `versionName` as `app_version` on the session of the access token (`sessionId`), only that session. Then reads `parent.json` from the releases folder and offers `{ versionCode, versionName, sha256, sizeBytes }` only when **all** hold: the file is there and valid (invalid → log it, like `readKidRelease`, and answer null); its `versionCode` is greater than the body's; the session's `client` is `android`; and either the file has no `parentIds` or it includes the caller's `parentId`. Otherwise `{ offer: null }`.
- `GET /v1/me/app-update/apk` (parent bearer, `requireFamilyParent`): the file named in `parent.json`, as `application/vnd.android.package-archive` with `Content-Length`, when it would be offered to this caller by the rules above (ignoring the version comparison). Otherwise 404 `No update for this phone.`
- `parent.json`'s schema in the server: `versionCode`, `versionName`, `sha256`, `sizeBytes`, `file` (an `.apk` name, same regex as `kid.json`), and optional `parentIds` (array of uuid).
- Put them in the existing `server/src/appupdate/routes.ts` or a new file next to it; then `pnpm contract`.

### 5.3 Publishing (`deploy/publish-downloads.ps1`)

Add `-ParentId <uuid>`: when given with `-Parent`, `parent.json` gets `parentIds: [<id>]`; without it, no `parentIds` field. Nothing else in the script changes. Update the usage lines at the top.

### 5.4 The parent app (`android/app-parent`)

- **Manifest:** the two permissions of section 4, and your install-result receiver with `android:exported="false"`.
- **`update/ParentUpdater.kt`** (new; name the class as you like) implements `UpdateSource`, created in `ParentApp.onCreate` with the `Session` and set as `ParentUpdates.source`. Delete `update/UpdateSeam.kt`.
- **When to check:** each time the app comes to the front (`MainActivity.onStart` may call it) while a parent is signed in: the first time since the app started, then at most every 6 hours (every minute in a debug build). `checkNow()` checks at once and shows `Checking` meanwhile. A failed check leaves the state as it was before, or `Unknown`.
- **States** (exactly the `UpdateState` values; the screens do the wording):
  - nothing newer → `UpToDate`;
  - offered, not downloaded, metered network → `Available(versionName, sizeBytes)`;
  - offered, not downloaded, not metered (or a debug build) → `Downloading`, then `Ready` when the file is checked;
  - offered and a checked file already here → `Ready`;
  - `update()` from `Available` → `Downloading` → (checked) → `Installing`; from `Ready` or `Failed` → `Installing`;
  - install finished with `STATUS_PENDING_USER_ACTION` → open Android's screen (section 4), stay `Installing`;
  - any other failure, a download that does not match the offer, or a declined question → `Failed(versionName)`;
  - `STATUS_SUCCESS` normally never arrives (the process is killed); if it does, do nothing.
- **Download:** `GET /v1/me/app-update/apk` with `Authorization: Bearer <token>` into a part file in `cacheDir/update/`, renamed to `parent-<versionCode>.apk` only when size and SHA-256 match the offer; otherwise delete it, log it and go `Failed`. Delete older files in that folder.
- Keep the decisions in small pure functions (which state from offer + file + metered; whether a check is due; whether a file matches; which state after an install status), so they can be unit-tested without Android.

## 6. Acceptance criteria

Server (`server/test/parent-update.test.ts`, new):

1. Migration `0012_parent_app_version.sql` adds `parent_sessions.app_version` (text, null); a session made before it reads null.
2. Check stores `versionName` on the caller's session, and no other session of the same parent changes.
3. Check offers `parent.json` when its `versionCode` is greater (the answer has exactly `versionCode`, `versionName`, `sha256`, `sizeBytes`), and answers `{ offer: null }` when it is equal, older, missing, or not valid JSON.
4. With `parentIds: [Mum]`, Mum's Android session gets the offer and Dad's gets null.
5. A `web` session gets `{ offer: null }` even when a newer version is published.
6. Without a token → 401; with a kid device token → 401.
7. The APK route answers 200 with the file's exact bytes, `Content-Type: application/vnd.android.package-archive` and the right `Content-Length` for an offered parent; 404 with no `parent.json`, for a parent not in `parentIds`, and when the named file is missing; 401 without a token.
8. `GET /v1/downloads` still lists `parent` (same `versionName`, `sizeBytes`, `fileName`) when `parent.json` has `parentIds`.
9. `publish-downloads.ps1 -Parent -ParentId <id> -To <temp folder>` writes `parent.json` with `parentIds: ["<id>"]`, and without `-ParentId` writes none (a check in section 8, not a Vitest test).

Parent app (`android/app-parent/src/test/kotlin/au/screentime/parent/update/ParentUpdaterTest.kt`, new, and `SessionTest.kt`):

10. Each row of the state list in 5.4 has a unit test of your pure functions, including: metered vs not metered (and the debug rule), a file already here, a check due the first time / not due after 59 min / due at 6 h, a file with the right size but wrong hash refused, `STATUS_PENDING_USER_ACTION` → open Android's screen, every other failure status → `Failed`.
11. The new `Session` function returns the current token, and a refreshed one when it is stale (the way `SessionTest` already tests `call`).
12. `ParentUpdateTest` (Claude's) passes unchanged; `UpdateSeam.kt` is gone; `Select-String -Path android\app-parent\src\main -Pattern 'FakeUpdateSource' -Recurse` prints nothing.
13. The merged manifest of the debug build has both permissions and the receiver with `exported="false"` (show the lines from `app-parent\build\intermediates\merged_manifest\debug\...\AndroidManifest.xml`).

Emulator run (`docs/cards/CARD-064-run.ps1`, which you write; it prints `PASS`/`FAIL` lines and every `Screen-Text` like `CARD-062-run.ps1`, which you may copy from):

14. A wiped emulator and a fresh dev server; version **A** (`-PparentVersionCode=900 -PparentVersionName=0.9.0`) installed with `pm install -i com.android.chrome`; signed in as `dad@example.com`; no `parent.json` in `deploy/releases`. Today shows no "ST Parent"; Settings shows `Version 0.9.0` and `Up to date`.
15. Version **B** (901, `0.9.1`) published to `deploy/releases` (APK, then `parent.json` with its real size and SHA-256). Settings › **Check for updates** → within 60 s the row says `ST Parent 0.9.1 is ready`. Screenshot `card064-ready`.
16. "Install unknown apps" not yet allowed for ST Parent: tap **Update** → Android's screen opens (print its `Screen-Text`; screenshot `card064-unknown-sources`). Press Back until ST Parent is in front → the row says `ST Parent 0.9.1 didn't install`.
17. Allow it with `adb shell appops set au.screentime.parent REQUEST_INSTALL_PACKAGES allow` (the one adb shortcut this card allows: a real parent does it on Android's screen of criterion 16). Tap **Update** → `Update this app?` (screenshot `card064-first-confirm`) → tap **Update**; if Play Protect asks, **More details** → **Install without scanning** (say whether it asked). Then `dumpsys package` shows `versionCode=901` and `installerPackageName=au.screentime.parent`, and the dev database has `app_version = '0.9.1'` on Dad's Android session (print the query and its result).
18. Within 15 s of the install, print the focused window (`dumpsys window | Select-String mCurrentFocus`). If ST Parent is not in front, this is `FAIL`: write it under "Blockers / questions" (the row's words say "The app opens again by itself"; Claude decides what changes). Do not add code to reopen it.
19. Version **C** (902, `0.9.2`) published. In the app, **Check for updates** → `ready` → **Update** → **no** `Update this app?` appears (print `Screen-Text` 3 s after the tap). If Play Protect asks, pass it as above and say so. `versionCode=902`. Screenshot `card064-second-update` of Settings showing `Version 0.9.2` and `Up to date`.
20. A `parent.json` for version D (903) with a wrong `sha256` → after **Check for updates**, the row never says `ready` (print `Screen-Text` after 60 s), and `adb logcat -d` has your log line about the file not matching.
21. A `parent.json` for version D with the right hash but `parentIds` = a new random uuid (not Dad's id; the dev seed has only Dad) → **Check for updates** → Settings says `Up to date`, no row.
22. Every command of section 8 passes, and the last `git diff --name-only` lists only: files under `server/`, `packages/schemas/` (only if you truly needed it: say why), `contract/`, `android/core-model/` (generated), `deploy/publish-downloads.ps1`, `android/app-parent/build.gradle.kts`, `android/app-parent/src/main/AndroidManifest.xml`, `android/app-parent/src/main/kotlin/au/screentime/parent/ParentApp.kt`, `.../MainActivity.kt`, `.../auth/Session.kt`, new files in `.../update/` (and the deleted `UpdateSeam.kt`), your tests, and `docs/cards/CARD-064-run.ps1`.

## 7. Tests you write

- `server/test/parent-update.test.ts`: criteria 1 to 8. Write `parent.json` and a small fake APK into a temp releases folder per test (as the kid update tests do; find them with `Select-String -Path server\test\*.ts -Pattern 'kid.json'`).
- `android/app-parent/src/test/.../update/ParentUpdaterTest.kt`: criterion 10. `SessionTest.kt`: criterion 11.
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
Select-String -Path android\app-parent\src\main -Pattern 'FakeUpdateSource' -Recurse
$out = 'C:\Users\james\OpenCode\Testing\temp\card064-publish'
pwsh -File deploy\publish-downloads.ps1 -Parent -ParentId 00000000-0000-4000-8000-000000000001 -To $out
Get-Content "$out\parent.json"
pwsh -File deploy\publish-downloads.ps1 -Parent -To $out
Get-Content "$out\parent.json"
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
pwsh -File docs\cards\CARD-064-run.ps1
git diff --name-only main
```

(The `create database` line fails harmlessly when the test database already exists. The publish lines build the signed release app; they need `android\keystore.properties`, which is on James's PC.) Run the `git status` line again **after** your last commit: it must print nothing. Paste each command's key output: for `pnpm test`, every package's summary line and your new test file's lines; for Gradle, the result lines of `ParentUpdaterTest`, `SessionTest` and `ParentUpdateTest`; for the run script, **every line it prints**.

## 9. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-064-parent-updates
   ```
2. Commit in small logical commits. Message format: `CARD-064: <what changed>`.
3. Before pushing, run section 8 again and make sure it passes.
4. Push: `git push -u origin bob/card-064-parent-updates`
5. Open a PR into `main` titled `CARD-064: The parent app updates itself`, with its body written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-064-parent-updates.md

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

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. In particular: if Android behaves differently from section 4 on the emulator (for example an `Update this app?` on the second update), report it with the exact output; do not work around it.

## 11. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the database and its own run of your tests and opens every screenshot, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- **Every acceptance criterion (1 to 22)** gets one line: the test name (copied from your file) or the run step that proves it, and `PASS`, `FAIL` or `NOT RUN`. A criterion with no test or run step is `NOT RUN`, never `PASS`.
- Describe a screenshot only if you opened it. If you cannot open images, write "not opened" next to it.
- "Deviations" lists every way your work differs from the card, and every workaround (a rerun of the script, a retry, a restarted emulator, an extra command) with why.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-064. Please review and merge if it is good.

CARD: CARD-064 The parent app updates itself
PR: <full PR URL>
Branch: bob/card-064-parent-updates
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Tests I wrote (file: test names, copied from the files):
<list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Emulator run (every line CARD-064-run.ps1 printed):
<paste>

Screenshots (path: what it shows, or "not opened"):
<list>

Acceptance criteria:
- 1: <test or step> PASS|FAIL|NOT RUN
- ...
- 22: <test or step> PASS|FAIL|NOT RUN

Did Play Protect ask? First update: <yes/no>. Second update: <yes/no>.

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
