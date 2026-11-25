# CARD-074: Searches, from Android and PC titles to the Searches report

| Field | Value |
|---|---|
| Card | CARD-074 |
| Title | Searches, from Android and PC titles to the Searches report |
| Size | L |
| Depends on | CARD-073 (merged) and Claude's PR with this card and the Searches page, merged to `main` |
| Spec sections | docs/SPEC.md §12.12 (read it all first), §3 Q43, §12.10 "Browser titles", "Title rules" and "The API" (the PC titles you read searches from), §12.9 (the report rules you copy) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-074-searches` |
| PR title | `CARD-074: Searches, from Android and PC titles to the Searches report` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The full specification is `docs/SPEC.md`. Repository rules for coding agents are in `AGENTS.md`: read it first, and start this card with `/card 074`.

**How this card works.** Claude did the design, proved the risky parts in a spike, built the web page, and wrote this card. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a table, column, route, field, class or file, use that name exactly; everything else is your choice, following the repo's patterns. Claude re-runs your tests, breaks lines of your code on purpose, compares your pasted output with the database, and reviews the code before merging.

**Use PowerShell 7 (`pwsh`) for every command, never Windows PowerShell 5.1.** Write every file as UTF-8 without a BOM.

**What James asked for (25 Nov 2026).** A third Reports tab, **Searches**, listing every complete search a kid typed ("how to bake a cake", "how do I bypass Screen Time"), with the same Day / Week / Month choices. Claude's PR already added the page (`web/src/pages/searches.tsx`) behind a seam with fake data (`web/src/lib/searches.ts`), made every report open on Day, and took the PC searches off the Websites page.

**The design in one paragraph (SPEC §12.12).** On Android, the kid app gets an **accessibility service** that watches only Chrome, the Google app and the YouTube app and keeps a search only once it is **sent** (Chrome's address bar turns into `google.com/search?q=…`; the Google app opens its results). Searches wait in `kid.db` and go up at each sync with a new route, `POST /v1/device/searches`, which also says whether the service is on. The app turns its own service back on when someone turns it off, using `WRITE_SECURE_SETTINGS`, granted once over adb. On PCs nothing changes: the server already gets the browser window titles, and now turns each title that names a search into a row of the same `searches` table. `GET /v1/reports/searches` serves the page, and the seam swaps its fake for that call.

**What is already proven (Claude's spike on the Redmi, 25 Nov 2026; SPEC §12.12 "What the spike proved").** Our service runs next to Bark's; after `pm grant … WRITE_SECURE_SETTINGS` the app writes itself into `enabled_accessibility_services` and connects in 70 ms, and does it again after being taken out; Chrome's `com.android.chrome:id/url_bar` reads `google.com/search?q=how+to+bake+a+cake&oq=…` once the search is sent, incognito too; the Google app's box is `com.google.android.googlequicksearchbox:id/googleapp_search_box` and its results open as a WebView. Do not spend time re-proving these. **Not proven: the YouTube app** (step 5 of §8.2 is where you find out).

## 2. Goal

With the new kid app on a device, every search sent in Chrome, the Google app (and the YouTube app, if §8.2 finds a clear signal) reaches the server within a sync; every search in a PC browser's title becomes a search on the server as its title arrives; and the web Searches page shows them from the real route, with the device's capture state.

## 3. Out of scope

- **No change to the page or its helpers**: `web/src/pages/searches.tsx`, `web/src/components/report-controls.tsx`, `web/src/router.tsx`, `web/src/pages/websites.tsx` and the pure helpers in `web/src/lib/searches.ts` are Claude's (AGENTS.md rule 10). You change **only the seam part** of `web/src/lib/searches.ts` (§5.4). If the page looks wrong, write it under "Blockers / questions".
- **No Windows change.** PCs already send titles.
- No alerts, no blocking, no other Android browsers (Firefox, Samsung Internet), no searches inside other apps (TikTok, Roblox), no incognito flag on Android, no parent-app screen.
- No keystrokes: never store or send words that were typed and not sent.
- No new library.
- Never commit secrets. Do not edit generated files by hand: run `pnpm contract`.

## 4. Tech and traps

- **Migration.** The last one is `0018_sticky_roland_deschain.sql`, so yours is `server/drizzle/0019_searches.sql` (see the `db-migration` skill): the `searches` table with its primary key, index, foreign keys like `0009_device_games.sql` and RLS with the `family_isolation` policy; and the two new `devices` columns.
- **Fixed dates in server tests.** The upload skips searches more than 30 days old, so pin the clock: `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(new Date('2026-11-12T12:00:00Z'))`, as `server/test/site-report.test.ts` does. Put the family in `UTC` unless a criterion names another zone.
- **The family's local day** is worked out through the zone in SQL, never by adding hours (`server/src/reports/sites.ts` shows how for `site_titles`).
- **Only new title rows count.** In the site-titles route, turn into searches only the rows the insert returned (`ON CONFLICT DO NOTHING … RETURNING`), in order of `at`, in the same transaction.
- **Room migration.** `KidDatabase` is `version = 2` (`exportSchema = false`). Adding the `searches` table makes it `version = 3` with a `Migration(2, 3)` that creates it. **Never** `fallbackToDestructiveMigration`.
- **`WRITE_SECURE_SETTINGS`** is declared in the manifest (`<uses-permission>`; lint calls it a protected permission: add `tools:ignore="ProtectedPermissions"`) and **granted by adb only**: `adb shell pm grant au.screentime.kid android.permission.WRITE_SECURE_SETTINGS`. Check it with `checkSelfPermission` before writing the setting; never assume it.
- **Keep every other entry** of `enabled_accessibility_services` when adding ours (Bark's is on every kid phone). The entries are `:`-separated component names; ours is `au.screentime.kid/au.screentime.kid.searches.SearchService`. Writing the setting without ours, or replacing it, would turn Bark off.
- **The accessibility service config XML** (`res/xml/search_service.xml`): `android:packageNames="com.android.chrome,com.google.android.googlequicksearchbox,com.google.android.youtube"`, `android:accessibilityEventTypes="typeWindowStateChanged|typeWindowContentChanged"`, `android:accessibilityFlags="flagReportViewIds|flagIncludeNotImportantViews"`, `android:canRetrieveWindowContent="true"`, `android:notificationTimeout="300"`, `android:description` a string resource. These are what the spike used (it also listened to text changes and clicks: you do not need them).
- **Walk little.** Read the tree from `rootInActiveWindow` only when the event's package is one of the three, and stop at depth 40.
- **Parent mode's spans**: reuse `parseSpans` in `apps/Apps.kt` and the open span, as `sites/Sites.kt` does for site lookups.
- **The emulator** is Android Studio's `Medium_Phone_API_37.0` on this PC (the `emulator-run` skill). It has Chrome and the Google app; check for YouTube with `adb -e shell pm list packages com.google.android.youtube`.
- Server tests skip without `TEST_DATABASE_URL`: check yours ran (the runner prints them).

## 5. Design (what to build)

### 5.1 Schemas (`packages/schemas/src/searches.ts`, exported from `index.ts`)

Move the types from the seam (`web/src/lib/searches.ts`, top part) here as zod schemas with `.meta({ id })`, with exactly these names and fields: `SearchCapture` (`on`, `off`, `never`), `SearchReportDevice`, `SearchReportItem`, `SearchReport`. Add the upload: `SearchIn` (`at`, `lastAt` ISO instants; `count` int 1 to 1,000; `engine`; `query` trimmed, 1 to 200 characters; `package` 1 to 200 characters), `SearchesUpload` (`capture`: `on` or `off`; `searches`: 0 to 500 `SearchIn`), `SearchesReceived` (`received` int). Also:

- `SearchEngine` in `sites.ts` gains `youtube` (one enum for both).
- `SiteReport` loses `searches`, and `SiteReportSearch` goes (SPEC §12.12 "The API").

### 5.2 Server

- **`server/src/searches/routes.ts`** (new, registered in `server/src/app.ts`): `POST /v1/device/searches` (`requireDevice`), SPEC §12.12 "Upload". Upsert on (`device_id`, `at`, `package`) keeping the later `last_at` and the higher `count`; `received` counts rows inserted or changed. Sets `devices.search_capture` and `search_capture_at`.
- **`server/src/searches/fromTitles.ts`** (new): turns new `site_titles` rows into searches (SPEC §12.12 "From PC titles"), using `parseTitle` from `server/src/reports/titles.ts`. Called from the site-titles route in `server/src/sites/routes.ts` with the inserted rows; that route also sets the device's `search_capture` to `on`.
- **`server/src/searches/backfill.ts`** (new): at start-up (where `backfillSites` runs), when the `searches` table has no row with `source = 'title'`, read every `site_titles` row (all families, in order of device and `at`) through the same function. Log `searches: backfill N searches from M titles` (or nothing when skipped).
- **`server/src/reports/searches.ts`** (new) and the route `GET /v1/reports/searches` in `server/src/reports/routes.ts` (`requireFamilyParent`, inside `withFamily`), SPEC §12.12 "The API". Reuse the device and label helpers of `server/src/reports/sites.ts` (`packageLabels`) rather than copying them.
- **`server/src/reports/sites.ts`**: drop `searches` from the report (keep `browserSec`, `privateSec`, `pages`).
- The sweep (`server/src/jobs/sweep.ts`) does **not** touch `searches` (kept forever).
- **`server/scripts/dev-searches.ts <kid name>`** (new, like `dev-sites.ts`): prints each of the kid's devices with its `search_capture`, then its searches newest first, one line each: `at  engine  package  count  private  query`.

### 5.3 Android kid app (`android/app-kid/src/main`)

- **`kotlin/au/screentime/kid/searches/Searches.kt`** (pure, unit-tested): `searchFromUrl(text): Found?` (Chrome's rule), `cleanQuery(raw): String?`, `addSighting(rows, sighting): rows` (the 10-minute repeat rule), `withService(current, me): String?` (the setting with ours added, or null when it is already there), and a small state holder for the Google app (`GoogleAppSearch`: feed it the box's text and hint flag, and "results opened"; it gives the search once). SPEC §12.12 "The rules".
- **`kotlin/au/screentime/kid/searches/SearchService.kt`**: the `AccessibilityService`. On each event from one of the three packages it reads the node(s) the rules need, applies them, drops searches inside parent mode's spans, and stores what is found (Room, off the main thread). Log tag `Searches`: `searches: found <engine> <package>` (never the words in the log).
- **`kotlin/au/screentime/kid/searches/SearchCapture.kt`**: `ensureOn()` (adds ours with `withService` when missing and the grant is there; logs `searches: turned on`, or `searches: off, no grant` once), `isOn()`. Called from `KidService` at start, from a `ContentObserver` on `Settings.Secure.getUriFor(ENABLED_ACCESSIBILITY_SERVICES)` registered by `KidService`, and before each upload.
- **`kid.db`**: a `searches` table and DAO (SPEC §12.12 "Kept"), `Migration(2, 3)`.
- **Upload** in `KidService`'s sync, after the site lookups (`uploadLookups` is the example): always one call, also with no searches, so `capture` reaches the server; then the rest of the changed rows, 500 at a time, at most 10 calls; mark sent; delete sent rows older than 10 minutes. Log `searches: sent N, received M, capture on|off`.
- **Manifest**: the service (`android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"`, `exported="true"`, the intent filter `android.accessibilityservice.AccessibilityService`, the meta-data pointing at `@xml/search_service`, label "Screen Time"), and the `WRITE_SECURE_SETTINGS` uses-permission. Description string: "Lets Screen Time see what is searched for in Chrome, the Google app and YouTube. It keeps only searches that were sent."
- **YouTube app**: see §8.2 step 5. Write its rule in `Searches.kt` like the Google app's, with the ids you find, and a unit test from the tree you dumped. If you find no clear "search sent" signal, leave the YouTube app out (keep it in `packageNames` only if it has a rule) and say so under "Blockers / questions".

### 5.4 The seam (`web/src/lib/searches.ts`)

Replace the top part (the types, `fetchSearchReport` and the fake, down to `// ---- Pure helpers. ----`): re-export the types from `@screentime/schemas`, and make `fetchSearchReport` call `GET /v1/reports/searches` the way `fetchSiteReport` in `web/src/lib/sites.ts` does. Delete the fake. Do not change the helpers below that line. `web/test/searches.test.ts` must pass unchanged.

### 5.5 Generated clients and the guide

- `pnpm contract`, commit what it changes.
- `docs/guides/android-provisioning.md`: in step 4, after the `GET_USAGE_STATS` line, `& $adb shell pm grant au.screentime.kid android.permission.WRITE_SECURE_SETTINGS`, and in its check list `& $adb shell dumpsys package au.screentime.kid | Select-String WRITE_SECURE_SETTINGS` (shows `granted=true`). A new short section **"Searches on a device that is already set up"**: in parent mode, turn USB debugging on, run the grant, turn USB debugging off; or without a PC, turn **Screen Time** on in Settings → Accessibility (and "Allow restricted settings" in Screen Time's App info first if Android asks), knowing it then cannot turn itself back on.

## 6. Acceptance criteria

Each criterion is a test with these inputs and these expected values. **Never change an expected value to match your code**: if one fails and you think the card is wrong, leave the test failing and ask.

**Server, upload** (`server/test/searches.test.ts`, clock at `2026-11-12T12:00:00Z`, family zone `UTC`, an Android device `D`):

1. `POST /v1/device/searches` `{ capture: "on", searches: [{ at: "2026-11-12T05:05:00Z", lastAt: "2026-11-12T05:05:00Z", count: 1, engine: "google", query: "how to bake a cake", package: "com.android.chrome" }] }` → 200 `{ received: 1 }`; one `searches` row with those values, `private` null, `source` `android`; `devices.search_capture` = `on`.
2. The same body again → `{ received: 0 }`, the row unchanged.
3. The same `at` and package with `lastAt` `2026-11-12T05:09:00Z` and `count` 3 → `{ received: 1 }`, the row has `last_at` 05:09 and `count` 3. Then the first body again → `{ received: 0 }`, still 05:09 and 3.
4. Skipped, `{ received: 0 }`, no row: `at` `2026-10-13T11:59:00Z` (more than 30 days before the clock) and `at` `2026-11-13T12:01:00Z` (more than 1 day ahead). Kept: `at` `2026-10-13T12:01:00Z` → `{ received: 1 }`.
5. 422 and nothing stored for each: a query of only spaces; a query of 201 characters; engine `yahoo`; `count` 0; `lastAt` before `at`; 501 searches; `capture` `maybe`.
6. `{ capture: "off", searches: [] }` → `{ received: 0 }` and `search_capture` = `off`; then `{ capture: "on", searches: [] }` → `on`.
7. No device token → 401.

**Server, from PC titles** (same file; a Windows device `P`; `POST /v1/device/site-titles` with these rows, package `msedge.exe`):

8. Rows `{ at: "2026-11-12T02:00:00Z", sec: 60, title: "how to draw - Search - [InPrivate] - Microsoft Edge" }`, `{ at: "2026-11-12T02:01:00Z", sec: 30, title: "Wikipedia - Profile 1 - Microsoft Edge" }`, `{ at: "2026-11-12T02:01:30Z", sec: 20, title: "How to draw - Search - Microsoft Edge" }`, `{ at: "2026-11-12T02:20:00Z", sec: 10, title: "how to draw - Search - Microsoft Edge" }` → exactly two searches on `P`:
   - `at` 02:00:00, `last_at` 02:01:50, `count` 2, `engine` `bing`, `query` `how to draw`, `private` true, `package` `msedge.exe`, `source` `title`;
   - `at` 02:20:00, `last_at` 02:20:10, `count` 1, `query` `how to draw`, `private` false.
   And `P`'s `search_capture` = `on`.
9. The same upload again → still exactly those two rows, unchanged.
10. A later upload with `{ at: "2026-11-12T02:25:00Z", sec: 5, title: "how to draw - Search - Microsoft Edge" }` → the second search becomes `last_at` 02:25:05, `count` 2; still two rows.
11. Backfill: with the four titles of criterion 8 stored in `site_titles` directly and no searches, `backfillSearches` makes the same two rows as criterion 8; running it again changes nothing (there are `title` searches now).

**Server, report** (same file or `server/test/search-report.test.ts`):

12. Period edges, family zone `Australia/Sydney`, `period=day&date=2026-11-12` (local day = `2026-11-11T13:00:00Z` to `2026-11-12T13:00:00Z`), searches on `D` at `2026-11-11T12:59:00Z`, `2026-11-11T13:00:00Z`, `2026-11-12T12:59:00Z`, `2026-11-12T13:00:00Z` → `searches` has exactly the 2nd and 3rd, the 3rd first.
13. Shape: `D` with `search_capture` `on` and a Chrome search (the device has `com.android.chrome` labelled `Chrome` in `device_apps`), `P` with `search_capture` null and a `msedge.exe` search, a removed device `R` with `search_capture` `off` and a search in the period, a removed device `S` with none → `devices` is `D`, `P`, `R` (oldest enrolment first; not `S`) with `capture` `on`, `never`, `off`; the Chrome search has `appLabel` `Chrome` and `private` null; a search whose package has no label anywhere has `appLabel` equal to its package.
14. `deviceId=<D>` → only `D`'s searches, `devices` still `D`, `P`, `R`.
15. A kid with no devices → 200, `devices` `[]`, `searches` `[]`. An unknown kid, or another family's kid → 404. `period=year`, `date=2026-13-01`, or a `deviceId` that is not the kid's → 422 (the same rules and messages as `GET /v1/reports/apps`).
16. `GET /v1/reports/sites` has no `searches` field.
17. The sweep leaves a search with `at` 400 days before the clock in place.

**Android** (`android/app-kid/src/test/kotlin/au/screentime/kid/searches/SearchesTest.kt`):

18. `searchFromUrl`:
    - `google.com/search?q=how+to+bake+a+cake&oq=how+to+bake+a+cake&gs_lcrp=EgZjaHJvbWUy` → `google`, `how to bake a cake`
    - `https://www.google.com.au/search?q=Minecraft+cheats&client=ms-android-xiaomi-terr1-rso2` → `google`, `Minecraft cheats`
    - `google.com/search?q=best+dog+breeds&sca_esv=83a04e53a9fccb5f&source=hp` → `google`, `best dog breeds`
    - `bing.com/search?q=is+roblox+down&form=QBLH` → `bing`, `is roblox down`
    - `duckduckgo.com/?q=lego+star+wars&ia=web` → `duckduckgo`, `lego star wars`
    - `m.youtube.com/results?search_query=funny+cats` → `youtube`, `funny cats`
    - `google.com/search?q=%22quoted%22+50%25+off` → `google`, `"quoted" 50% off`
    - `google.com/search?q=++spaced+++out++` → `google`, `spaced out`
    - a `q` of 250 `a`s → a query of 200 `a`s
    - no search (null) for each: `how to bake a cage`, `google.com`, `google.com/#sbfbu=1&pi=`, `Search Google or type URL`, `google.com. Connection is not secure`, `google.com/search?q=`, `notgoogle.com/search?q=x`, `en.wikipedia.org/wiki/Cake`, `google.com/maps?q=cafe`
19. `addSighting`, a row `google` / `Minecraft cheats` / `com.android.chrome` first and last seen at 10:00:00: a sighting `minecraft cheats` at 10:09:59 → the same row, `lastAt` 10:09:59, `count` 2; a sighting at 10:20:00 (10 min 1 s after 10:09:59) → a new row; `com.google.android.googlequicksearchbox` at 10:05 → a new row; `bing` at 10:05 → a new row. Each change raises the row's `version`.
20. `GoogleAppSearch`: texts `we`, `weather`, `weather tomorrow` (hint false), then results opened → `weather tomorrow` once; results opened again → nothing; text `Ask Google` with hint true, then results opened → nothing; text `cats`, then text `` (cleared), then results opened → nothing.
21. `withService`, ours `au.screentime.kid/au.screentime.kid.searches.SearchService`, Bark's `com.pt.bark/com.pt.bark.services.accessibility.BarkAccessibilityService`: `null` → ours; `""` → ours; Bark's → `<Bark's>:<ours>`; `<Bark's>:<ours>` → null (no change); `<ours>:<Bark's>` → null.
22. A sighting inside a parent-mode span is dropped; one a second after the span ends is kept.

**Break it yourself.** For each line below, change it, run the named tests, paste the failure, and restore with `git checkout -- <file>`:

23. The repeat window: 10 minutes → 20 minutes in the server's title rule (criterion 8 or 10 must fail) and in `addSighting` (criterion 19 must fail).
24. The upsert: keep the new `count` instead of the higher one (criterion 3 must fail).
25. `withService`: return ours alone instead of adding it (criterion 21 must fail).
26. The report's period: use UTC midnight instead of the family's (criterion 12 must fail).

## 7. Tests you write

- `server/test/searches.test.ts` (new): criteria 1 to 11, 17; `server/test/search-report.test.ts` (new) or the same file: 12 to 16.
- `server/test/site-report.test.ts`: remove only the assertions on `searches` (the field is gone). **That is the one change to an existing test this card asks for; list it under Deviations anyway**, with the test names you touched. Any other change to what an existing test checks is a deviation too.
- `android/app-kid/src/test/kotlin/au/screentime/kid/searches/SearchesTest.kt` (new): criteria 18 to 22, plus YouTube's rule if you add it.
- `web/test/searches.test.ts` and `web/test/sites.test.ts`: unchanged, passing.
- Each new test must fail if the behaviour it names breaks (see the `card-tests` skill).

## 8. Checks

### 8.1 Commands

From the repo root, in `pwsh`. Save each slow run's output to a file and search it (AGENTS.md "Saving test output"):

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
cd windows; dotnet test; cd ..
cd android; $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; .\gradlew.bat assembleDebug test lint; .\gradlew.bat --stop; cd ..
git diff --name-only main -- web/src/pages web/src/components web/src/router.tsx windows/src packages/engine android/core-time
```

The last line must print nothing. (The `create database` line fails harmlessly when it exists.) Paste the totals each test runner prints.

### 8.2 On the emulator

With the dev API running (`pnpm dev:server`), on a **wiped** `Medium_Phone_API_37.0` with the debug kid app as Device Owner (the `emulator-run` skill). Paste the **real output of every step**:

1. Install, Device Owner, the `GET_USAGE_STATS` line as the skill says, then `adb -e shell pm grant au.screentime.kid android.permission.WRITE_SECURE_SETTINGS`. Enrol to the dev kid Alex and give time (`dev-enrol-code.ts Alex phone`, `dev-grant.ts Alex phone 60`). Paste `adb -e logcat -d -s Searches` (must show `searches: turned on`) and `adb -e shell settings get secure enabled_accessibility_services` (must contain `au.screentime.kid/au.screentime.kid.searches.SearchService`).
2. Chrome, 15 s apart: `adb -e shell am start -a android.intent.action.VIEW -d "https://www.google.com/search?q=how+to+bake+a+cake" -p com.android.chrome`, then the same with `https://www.bing.com/search?q=is+roblox+down`. (Chrome's first-run screens may need `Tap-Text` as in `docs/cards/CARD-058-run.ps1`; list any taps as deviations.) Paste the `searches: found` lines.
3. Typed and not sent: tap Chrome's address bar, `adb -e shell input text "abandoned%swords"`, then `adb -e shell input keyevent KEYCODE_BACK` twice. No `searches: found` line may follow.
4. The Google app: `adb -e shell am start -a android.search.action.GLOBAL_SEARCH`, `adb -e shell input text "weather%stomorrow"`, `adb -e shell input keyevent KEYCODE_ENTER`, wait 5 s. Paste the `searches: found google com.google.android.googlequicksearchbox` line. If the Google app needs a sign-in or first-run screen, tap past it and list the taps.
5. The YouTube app (if installed): open it, tap its search icon, `adb -e shell input text "funny%scats"`, `KEYCODE_ENTER`, wait 5 s. Dump the window (`adb -e shell uiautomator dump /sdcard/yt.xml` then `adb -e pull /sdcard/yt.xml`) before and after Enter; paste the nodes with a `resource-id` containing `search` from both dumps. Then write YouTube's rule (§5.3), rebuild, repeat this step and paste its `searches: found youtube` line. If there is no clear signal, or YouTube is not on the image, say so here and under "Blockers / questions".
6. Someone turns it off: `adb -e shell settings delete secure enabled_accessibility_services`, wait 5 s, paste `settings get secure enabled_accessibility_services` (ours is back) and the second `searches: turned on` line.
7. No grant: `adb -e shell pm revoke au.screentime.kid android.permission.WRITE_SECURE_SETTINGS`, then the `settings delete` of step 6, wait 5 s; paste the setting (ours is **not** back) and the `searches: off, no grant` line. Turn the screen off and on to sync (`adb -e shell input keyevent KEYCODE_SLEEP`, wait 15 s, `KEYCODE_WAKEUP`); paste the `searches: sent … capture off` line. Then grant again (step 1's command), wait 5 s, sync again, paste `capture on`.
8. `pnpm --filter @screentime/server exec tsx scripts/dev-searches.ts Alex`: paste it. It must show the phone with `on` and exactly the searches `how to bake a cake` (google, com.android.chrome), `is roblox down` (bing, com.android.chrome), `weather tomorrow` (google, com.google.android.googlequicksearchbox), and `funny cats` (youtube, com.google.android.youtube) if step 5 worked. Not `abandoned words`.
9. Sync once more and run step 8 again: the same rows, the same counts (nothing doubled).
10. Open the web app (`pnpm dev:web`, http://localhost:5173), sign in, Reports → Searches, Alex, Day: take one screenshot and save it as `temp\card-074-searches.png` (outside the repo). Paste the list of searches the page shows, typed out.
11. Stop the emulator with `adb -s emulator-5554 emu kill`.

A step without its pasted output counts as `NOT RUN`.

## 9. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-074-searches
   ```
2. Commit in small logical commits. Message format: `CARD-074: <what changed>`.
3. Before pushing, run every command in §8.1 again and make sure all pass.
4. Push: `git push -u origin bob/card-074-searches`
5. Open a PR into `main` titled `CARD-074: Searches, from Android and PC titles to the Searches report`, with the body of the template (`docs/cards/TEMPLATE.md` §10): what you did, each criterion with its output, deviations, blockers. Write the body in `C:\Users\james\OpenCode\Testing\temp\`, never in the repo.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (§11).

## 10. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR.

## 11. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs, the dev database and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- Paste the totals the test runners print; do not add them up yourself.
- "Deviations" lists every way your work differs from the card, every existing test whose checks you changed, and every workaround (a retry, a restart, an extra tap or script) with why you needed it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-074. Please review and merge if it is good.

CARD: CARD-074 Searches, from Android and PC titles to the Searches report
PR: <full PR URL>
Branch: bob/card-074-searches
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run (§8.1), with real output:
- <command> -> <key output lines, or NOT RUN: reason>

Break it yourself (criteria 23 to 26):
- <change> -> <failing test and its message> -> restored

Emulator (§8.2), every step's real output:
1. ...

Acceptance criteria:
- [x] <criterion> (test name, or output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<each one, including the site-report.test.ts change>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
