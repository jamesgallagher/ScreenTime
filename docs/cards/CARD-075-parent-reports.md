# CARD-075: Reports in the parent app

| Field | Value |
|---|---|
| Card | CARD-075 |
| Title | Reports in the parent app |
| Size | M |
| Depends on | CARD-074, merged to `main`. Claude's front end came in the same PR as this card |
| Spec sections | docs/SPEC.md §12.9 ("In the Android parent app"), §12.10, §12.12, §16.4, §16.6 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-075-parent-reports` |
| PR title | `CARD-075: Reports in the parent app` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**How this card works.** Claude did the design, built the screens, and wrote this card: the behaviour, the interfaces and the acceptance criteria. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a type, a route, a field, a file or a function, use that name exactly; everything else is your choice, as long as it follows the repo's existing patterns and `AGENTS.md`. Claude will re-run your tests, break the code on purpose, check your run's output against the database, and review the code line by line before merging.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM.

**Why (James, 28 Nov 2026).** Reports (Apps, Websites, Searches) are only in the web app. James wants them in the Android parent app too, and set a rule: **the web app and the parent app keep feature parity** (SPEC Q44, §16.6).

**What exists today.**

- The server routes, all built and deployed: `GET /v1/reports/apps`, `GET /v1/reports/sites`, `GET /v1/reports/searches` (query `kidId`, `period` = `day|week|month`, `date` = `YYYY-MM-DD`, optional `deviceId`), `PUT /v1/sites/{site}/class` (body `{ kind, category }`) and `DELETE /v1/sites/{site}/class`. **No server change in this card.**
- The generated Kotlin client already has them: `getReportsApps`, `getReportsSites`, `getReportsSearches`, `putSitesClass`, `deleteSitesClass`, and the models `AppReport`, `SiteReport`, `SearchReport`, `SiteClassOverride`. Do not open the generated files; search for a name if you need its signature.
- The pattern to copy for a source behind an interface: `android/app-parent/src/main/kotlin/au/screentime/parent/kids/RemoteUpdate.kt` (interface + `object RemoteUpdates { lateinit var source }`), `kids/ServerDeviceUpdates.kt` (the real one), the line in `ParentApp.kt` that sets it, and `src/test/.../kids/ServerDeviceUpdatesTest.kt` (a `Session` on a ktor `MockEngine`).
- Error words the other tabs use (`KidsViewModel.load`, `InboxViewModel.load`): "Something went wrong on the server. Pull down to try again." and "Can't reach Screen Time. Check the internet connection."

**What Claude built (front end, in the same PR as this card, already on `main`).** In `android/app-parent/src/main/kotlin/au/screentime/parent/reports/`:

| File | What it is | Yours to change? |
|---|---|---|
| `Reports.kt` | `ReportKind`, `ReportQuery`, the seam interface `ReportsSource`, `object Reports { var source }`, and the period helpers (`periodRange`, `shiftPeriod`, `isCurrentPeriod`, `periodLabel`, `periodDates`, `namesList`, …) | **Only** the `Reports` object (section 5.1). Nothing else |
| `ReportLines.kt` | The words and numbers of the three reports (`splitOther`, `deviceSplit`, `removedLine`, `categoryLabel`, `whenLine`, `groupByDay`, `searchTotals`, …), ported from the web app's `web/src/lib/reports.ts`, `sites.ts`, `searches.ts` | **No** (Claude's). You test it |
| `ReportsScreen.kt`, `AppsReport.kt`, `WebsitesReport.kt`, `SearchesReport.kt`, `SiteClassSheet.kt` | The Reports tab and its cards, and the "what is this site" sheet | **No** (Claude's) |
| `res/drawable/ic_reports.xml`, `home/HomeScreen.kt`, `MainActivity.kt` | The fifth tab and its view model | **No** (Claude's) |
| `FakeReports.kt` | **The seam.** Made-up reports (a Pixel, a Desk PC, an Old tablet) | **Yes: delete this file** |
| `ReportsViewModel.kt` | Holds the choice and the shown report; `show(query)` calls `Reports.source`; `setSiteClass` / `clearSiteClass`. The lines marked `SEAM (CARD-075)` have no error handling and no stale-answer check | **Yes: finish it** (section 5.2) |

If you think one of Claude's files is wrong (a helper gives a different answer from a fixture in section 6, a word is wrong, a screen breaks on real data), **do not change it**: leave your test as the card says, failing, and write it under "Blockers / questions" with the output (AGENTS.md rule 10).

## 2. Goal

The parent app's Reports tab shows the real Apps, Websites and Searches reports from the server, a parent can set or reset what a site is from the app, failures say so in words, a late answer for an older choice never replaces the newer one, and every helper of the tab is proven against the fixtures below.

## 3. Out of scope

- No server, schema, contract or web change. No new route, no new library or package.
- No change to Claude's files (section 1 table), not even to fix something.
- No tablet layout (navigation rail), no remembering the choice across app restarts, no deep link from a push.
- No kid-app or Windows change.

## 4. Tech and traps

Kotlin, Jetpack Compose, ktor client, JUnit 6 (Jupiter), PowerShell 7.

- **Fixed dates and a fixed zone in every test.** The zone is `Australia/Sydney` (+11 in November) wherever a helper takes a zone; "today" is `2026-11-20` (a Friday) unless a fixture says otherwise. Never `LocalDate.now()` or `Instant.now()` in a test.
- `ReportsViewModel` is a plain `ViewModel` using `viewModelScope`; unit tests here have no Android main dispatcher. So put the decision logic in a **pure function** (section 5.2) and test that, not the view model.
- `Session.call { … }` throws `SignedOutException` when the sign-in is gone, `ApiException` (with `status`) for an HTTP error, and other exceptions (for example `java.io.IOException`) when the network fails. Always rethrow `CancellationException`.
- `date` goes to the server as `LocalDate.toString()` (`2026-11-20`); `period` as the enum (the client sends its `wire`). A null `deviceId` must not appear in the URL at all.
- `PUT /v1/sites/{site}/class`: the site goes in the path through the client (it encodes it); do not build the URL yourself.
- Run Gradle from `android` with `JAVA_HOME` set to Android Studio's `jbr`. Run a slow command once with its output in a file, then search the file (AGENTS.md "Saving test output").

## 5. Design (what to build)

### 5.1 The real source

- New file `reports/ServerReports.kt`: `class ServerReports(private val session: Session) : ReportsSource`. `apps`, `sites`, `searches` call `getReportsApps`, `getReportsSites`, `getReportsSearches` with the query's `kidId`, `period`, `date.toString()` and `deviceId`. `setSiteClass` calls `putSitesClass(site, override)`; `clearSiteClass` calls `deleteSitesClass(site)`. Errors are **not** caught here: they go up to the view model.
- In `Reports.kt`, change only the object to `object Reports { lateinit var source: ReportsSource }` (and its comment). In `ParentApp.onCreate`, next to `RemoteUpdates.source = …`, set `Reports.source = ServerReports(session)`.
- Delete `reports/FakeReports.kt`. `git grep FakeReports` must then find nothing in `android/`.

### 5.2 The view model

Keep `ReportsViewModel`'s public API as it is (`state`, `choose`, `show(query, force, pulled)`, `setSiteClass`, `clearSiteClass`, `clear`): Claude's screen calls it.

- New in `ReportsViewModel.kt` (top level, pure): `sealed interface ReportResult` with `Ok(val data: ReportData)`, `Failed(val words: String)`, `SignedOut`; a function `resultOf(e: Exception): ReportResult` that maps an exception to its result (table below); and `fun reportsAfter(state: ReportsState, asked: ReportQuery?, answered: ReportQuery, result: ReportResult): ReportsState`, which gives the state after an answer arrives:
  - `answered != asked` → `state` unchanged (a late answer for an older choice is dropped).
  - `Ok` → `shown = data`, `loading = false`, `refreshing = false`, `error = null`.
  - `Failed` → `shown` kept as it was, `loading = false`, `refreshing = false`, `error = words`.
  - `SignedOut` → `shown` kept, `loading = false`, `refreshing = false`, `error = null`.
- `show` uses them: catch everything the source throws except `CancellationException`, turn it into a `ReportResult` with `resultOf`, and set `state = reportsAfter(state, asked, query, result)`.
- `resultOf`:

| Exception | Result |
|---|---|
| `SignedOutException` | `SignedOut` |
| `ApiException` with status 404 or 422 | `Failed("That kid or device isn't in the family any more. Pull down to load it again.")` |
| any other `ApiException` | `Failed("Something went wrong on the server. Pull down to try again.")` |
| anything else | `Failed("Can't reach Screen Time. Check the internet connection.")` |

- `setSiteClass` and `clearSiteClass`: on success, load the shown report again (`show(asked, force = true)`) and return `null`. On a failure return words and do **not** reload: `ApiException` → "Couldn't save that. Try again."; `SignedOutException` → `null`; anything else → "Can't reach Screen Time. Check the internet connection.". Rethrow `CancellationException`. Put this mapping in a pure top-level function `saveError(e: Exception): String?` so it can be tested.

### 5.3 Data for the emulator run

New script `server/scripts/dev-report-data.ts <kid name> <YYYY-MM-DD>` (copy the header, the "never in production" line and the argument checks of `dev-apps.ts`). For the development database only, it gives that kid two new devices, **Report Phone** (Android phone) and **Report PC** (Windows PC), and puts this on the given family-local day, through the device routes or straight into the tables (your choice), so that the three report routes then return exactly it. Run it twice and nothing doubles (it removes its own two devices and their rows first). It prints one line per thing it wrote.

| What | Device | Value |
|---|---|---|
| App `com.roblox.client` "Roblox" | Report Phone | 3000 s |
| App `com.google.android.youtube` "YouTube" | Report Phone | 2400 s |
| App `com.android.settings` "Settings" | Report Phone | 40 s |
| Program `minecraft.exe` "Minecraft" | Report PC | 1200 s |
| Site `youtube.com`: kind website, category video, label "YouTube" | Report Phone | 12 active minutes, app Chrome |
| Site `stake.com`: kind website, category gambling, label "Stake" | Report Phone | 3 active minutes, app Chrome |
| Site `ytimg.com`: kind cdn, owner youtube.com | Report Phone | 5 active minutes, app YouTube |
| Search "volcano facts", Google in Chrome (`com.android.chrome`) | Report Phone | 16:20 local, once |
| Search "roblox promo codes", Google app (`com.google.android.googlequicksearchbox`) | Report Phone | 15:12 local, once |

Both devices count as sending apps, sites and searches (`appsRecorded`, `sitesRecorded` true, `capture` `on`). The classes of the three sites are set so the classifier is not needed (no `CLASSIFIER_URL` on the dev server).

## 6. Acceptance criteria

Tests are in `android/app-parent/src/test/kotlin/au/screentime/parent/reports/`. Zone `Australia/Sydney`, today `2026-11-20` unless said. Every row is its own test (or its own assertion with its own message). Write the expected values exactly as here.

**Periods (`Reports.kt`)**

1. `periodRange(WEEK, 2026-11-16)` and `periodRange(WEEK, 2026-11-22)` are both `2026-11-16 … 2026-11-22`; `periodRange(MONTH, 2026-02-10)` is `2026-02-01 … 2026-02-28`; `periodRange(DAY, 2026-11-20)` is `2026-11-20 … 2026-11-20`.
2. `shiftPeriod(WEEK, 2026-11-20, -1)` = `2026-11-09`; `(WEEK, 2026-11-20, 1)` = `2026-11-23`; `(MONTH, 2026-03-31, -1)` = `2026-02-01`; `(DAY, 2026-01-01, -1)` = `2025-12-31`.
3. `isCurrentPeriod(WEEK, 2026-11-16, today 2026-11-22)` true; `(WEEK, 2026-11-15, today 2026-11-22)` false; `(MONTH, 2026-11-01, today 2026-11-30)` true.
4. `periodLabel` with today 2026-11-20: DAY 2026-11-20 "Today", 2026-11-19 "Yesterday", 2026-11-18 "Wed 18 Nov", 2025-12-31 "Wed 31 Dec 2025"; WEEK 2026-11-18 "This week", 2026-11-10 "9 – 15 Nov", 2026-11-01 "26 Oct – 1 Nov", 2025-12-31 "29 Dec – 4 Jan 2026"; MONTH 2026-11-03 "This month", 2026-10-15 "October 2026". (The dash is U+2013 with a space each side.)
5. `periodDates`: DAY 2026-11-20 "Friday 20 November 2026"; WEEK 2026-11-20 "Mon 16 Nov – Sun 22 Nov 2026"; MONTH 2026-02-10 "1 – 28 Feb 2026".
6. `namesList`: `[]` → "", `[Redmi]` → "Redmi", `[Redmi, Desk PC]` → "Redmi and Desk PC", `[Redmi, Tablet, Desk PC]` → "Redmi, Tablet and Desk PC". `chipDevices` of one device → empty; of two → both.

**Apps (`ReportLines.kt`)**

7. `splitOther` of apps A 3000 s, B 60 s, C 59 s, D 0 s → shown [A, B], other [C, D], otherSec 59.
8. `shortDuration`: 59 → "<1m", 60 → "1m", 3900 → "1h 5m", 7200 → "2h". `totalDuration(0)` → "0m".
9. `deviceSplit`: report `deviceId` null, devices P "Pixel" and Q "Desk PC" both `appsRecorded`, app split P 4200 s and Q 1800 s → "Pixel 1h 10m · Desk PC 30m". Same with Q `appsRecorded = false` → null. Report `deviceId = P` → null. An app device id not in the report, 300 s, next to P → "Pixel 1h 10m · A device 5m".
10. `removedLine`: installedAt `2026-11-02T14:00:00Z`, removedAt `2026-11-03T14:00:00Z` → "Installed 3 Nov · removed 4 Nov" (in UTC these would be 2 and 3 Nov: the zone matters); installedAt null → "Removed 4 Nov"; removedAt null → null.
11. `barFraction`: (0, 100) → 0; (1, 1000) → 0.02; (50, 100) → 0.5; (5, 0) → 0.
12. `screenTimeLabel`: with a device "Pixel" → "Pixel"; shared, no device → "Time"; SCREENS → "Screens"; PHONE → "Phone".
13. `hasUnrecorded`: a PC with `appsRecorded` false and not removed → true; the same PC removed → false; report `deviceId` = the phone (the PC not in the report) → false.

**Websites (`ReportLines.kt`)**

14. `categoryLabel`: null → "Not sorted yet", VIOLENCE_WEAPONS → "Violence and weapons", SELF_HARM → "Self-harm"; every `SiteCategory` entry has a non-empty label.
15. `isWorthALook` is true for exactly ADULT, GAMBLING, VIOLENCE_WEAPONS, DRUGS, SELF_HARM, and false for every other category and for null.
16. `activeTime(0)` → "0m"; `activeTime(65)` → "1h 5m". `appsLine` of apps Chrome, Roblox → "Chrome, Roblox"; of A, B, C, D, E → "A, B, C +2".
17. `whenLine`: DAY, firstAt `2026-11-20T04:10:00Z`, lastAt `2026-11-20T09:45:00Z` → "3:10 pm – 8:45 pm"; both `04:10Z` → "at 3:10 pm"; WEEK with days 1 → "on 1 day", days 4 → "on 4 days".
18. `siteDeviceSplit`: report `deviceId` null, site devices P 40 and Q 12 minutes → "Pixel 40m · Desk PC 12m"; one site device → null; report `deviceId = P` → null.
19. `sourceLine`: PARENT → "Set by a parent"; FAMILY_DNS → "Blocked by a family filter: adult or unsafe"; CLASSIFIER → null; null → null. `ownerLine`: site `ytimg.com` owner `youtube.com` → "for youtube.com"; owner equal to the site → null; owner null → null.
20. `filterSites`: `SiteFilter.Category(null)` keeps only the sites with category null; `SiteFilter.Category(GAMES)` only games; `SiteFilter.All` all, in order.
21. `notRecorded` lists a PC with `sitesRecorded` false, not removed, and not a removed one; `hasPc` is true with a Windows device that has `sitesRecorded`, false when that device is not the report's `deviceId`; `titlesCut` with `from` 2026-08-01 and `titlesKeptFrom` 2026-08-23 → true, with both 2026-08-23 → false.
22. `startKind`: UNKNOWN → WEBSITE, null → WEBSITE, CDN → CDN, ADS_TRACKING → ADS_TRACKING.

**Searches (`ReportLines.kt`)**

23. `groupByDay` of three searches, newest first, at `2026-11-19T14:30:00Z`, `2026-11-19T12:00:00Z`, `2026-11-17T01:00:00Z` → three days: 2026-11-20 "Today", 2026-11-19 "Yesterday", 2026-11-17 "Tue 17 Nov", one search each (the first one is 20 Nov in Sydney, not 19).
24. `filterSearches` with "  ROBLOX " finds "roblox promo codes" and not "volcano facts"; with "" returns all.
25. `whereLine`: package `com.google.android.googlequicksearchbox` → "Google app"; `com.google.android.youtube` → "YouTube app"; `com.android.chrome`, GOOGLE, appLabel Chrome → "Google in Chrome"; `msedge.exe`, BING, appLabel Edge → "Bing in Edge".
26. `timeLine`: at = lastAt = `2026-11-20T05:05:00Z` → "4:05 pm"; lastAt `2026-11-20T05:09:00Z` → "4:05 pm – 4:09 pm".
27. `searchTotals` of queries "Roblox" (private true), "roblox " (private null), "volcano" (private false) → searches 3, different 2, private 1.
28. `notRecording`: devices A capture OFF, B NEVER, C ON, D OFF but removed → off [A], never [B]. `searchDeviceName` with a report of one device → null.

**The source and the view model**

29. `ServerReportsTest` (MockEngine): `apps` of query (APPS, kid `k1`, device `d1`, WEEK, 2026-11-20) sends `GET /v1/reports/apps` with exactly the parameters `kidId=k1`, `period=week`, `date=2026-11-20`, `deviceId=d1`; with device null the request has **no** `deviceId` parameter. `sites` and `searches` hit `/v1/reports/sites` and `/v1/reports/searches` with the same parameters.
30. `setSiteClass("stake.com", SiteClassOverride(WEBSITE, GAMES))` sends `PUT /v1/sites/stake.com/class` with body kind `website`, category `games`; `clearSiteClass("stake.com")` sends `DELETE /v1/sites/stake.com/class`.
31. A 500 answer makes `apps` throw `ApiException` with status 500 (not caught in `ServerReports`).
32. `reportsAfter`: an `Ok` for the asked query gives `shown` = that data, `loading` false, `refreshing` false, `error` null.
33. `reportsAfter`: an answer whose query is not `asked` (asked is DAY 2026-11-20, answer is for DAY 2026-11-19) returns the state unchanged, also when it is `Ok`.
34. `reportsAfter`: `Failed("x")` keeps the shown report and sets `error` "x", `loading` false; `SignedOut` keeps the shown report with `error` null and `loading` false.
35. `resultOf`: `ApiException` 500 → the server words; 404 and 422 → the kid-or-device words; `IOException` → the can't-reach words; `SignedOutException` → `SignedOut` (exact words in 5.2).
36. `saveError`: `ApiException` 500 → "Couldn't save that. Try again."; `IOException` → the can't-reach words; `SignedOutException` → null.

**Wiring**

37. `FakeReports.kt` is gone, `git grep -n FakeReports -- android` prints nothing, and `ParentApp.kt` sets `Reports.source = ServerReports(session)`.
38. `git diff main...HEAD --name-only` shows no change to `ReportLines.kt`, `ReportsScreen.kt`, `AppsReport.kt`, `WebsitesReport.kt`, `SearchesReport.kt`, `SiteClassSheet.kt`, `HomeScreen.kt`, `MainActivity.kt`, `ic_reports.xml`, nothing under `server/src`, `packages`, `contract` or `web`, and in `Reports.kt` only the `Reports` object.
39. **Break it yourself** (paste the failing test for each, then `git checkout -- <file>`): (a) in `Reports.kt` `periodRange`, `previousOrSame` → `previous` (criterion 1 must fail); (b) in `ReportLines.kt` `removedLine`, use `ZoneOffset.UTC` instead of `zone` (criterion 10 must fail); (c) in `reportsAfter`, remove the `answered != asked` check (criterion 33 must fail); (d) in `ServerReports.apps`, pass `deviceId = null` always (criterion 29 must fail). These two Claude files may be changed only for this, and must be restored.

**The emulator run (section 8.2)**

40. Apps, Yesterday, All devices: the screen shows `Roblox`, `50m`, `YouTube`, `40m`, `Minecraft`, `20m`, `Report Phone 50m`, `Report PC 20m`, and `Other` with `1 app under a minute each`; the chips `All devices`, `Report Phone`, `Report PC` are there.
41. Tapping `Report PC` shows `Minecraft` and not `Roblox`.
42. Websites, Yesterday, All devices: `1 site worth a look`, `Stake · Gambling`, `YouTube`, `12m`, `Behind the scenes`.
43. The site sheet: tap `Change what Stake is`, then `Games`, then `Save`; the screen no longer shows `worth a look`, shows `Set by a parent`, and the database has one `site_overrides` row for `stake.com` with kind `website` and category `games`. Then the sheet again, `Go back to automatic`: `1 site worth a look` is back and `site_overrides` has no row for `stake.com`.
44. Searches, Yesterday: `“volcano facts”`, `Google in Chrome`, `“roblox promo codes”`, `Google app`, and the totals `Searches` `2`.
45. The server stopped (`docker stop screentime-api-1`), pull down on Searches: `Can't reach Screen Time. Check the internet connection.` shows and the two searches stay on screen. Start it again (`docker start screentime-api-1`).
46. The app under test is the debug APK built from your branch, and the database rows pasted in the run match what the screen showed.

## 7. Tests you write

- `ReportsPeriodsTest.kt`: criteria 1 to 6.
- `ReportLinesTest.kt` (or one file per report: `AppsLinesTest.kt`, `SitesLinesTest.kt`, `SearchesLinesTest.kt`): 7 to 28.
- `ServerReportsTest.kt`: 29 to 31 (copy the `Session` + `MockEngine` set-up of `kids/ServerDeviceUpdatesTest.kt`; check the request's URL path and `url.parameters`).
- `ReportsViewModelTest.kt`: 32 to 36 (the pure functions only).

Build the report objects in the tests with the generated model constructors (search `ApiModels.kt` for `data class AppReport(` to see a constructor's fields). A small builder function at the top of a test file is fine.

## 8. Checks

### 8.1 Build and tests

From the repo root, in `pwsh`:

```powershell
New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat :app-parent:assembleDebug :app-parent:testDebugUnitTest *> ..\..\temp\card075-gradle.txt; "exit code: $LASTEXITCODE"
Select-String -Path ..\..\temp\card075-gradle.txt -Pattern 'BUILD (SUCCESSFUL|FAILED)|FAILED'
Get-ChildItem app-parent\build\test-results\testDebugUnitTest\TEST-au.screentime.parent.reports.*.xml | ForEach-Object { Select-String -Path $_ -Pattern '<testsuite ' | ForEach-Object { $_.Line.Substring(0, [Math]::Min(220, $_.Line.Length)) } }
.\gradlew.bat --stop
cd ..
git grep -n FakeReports -- android
git grep -l 'Â' -- android/app-parent/src server/scripts
git diff main...HEAD --name-only
```

Paste each command's key output. The two `git grep` lines must print nothing.

### 8.2 The emulator run (criteria 40 to 46)

Write the run yourself as `docs/cards/CARD-075-run.ps1`. Copy the helpers and the start from `docs/cards/CARD-072-run.ps1` (`Check`, `Ui`, `Tap-Text`, `Screen-Text`, `Shot`, `Open-Package`, `Db`, `Wait-Screen`, `Wait-Health`, the wiped emulator `Medium_Phone_API_37.0` with `-memory 3072`, the fresh server with `seed-dev.ts dad@example.com`, and the parent sign-in). No kid app is needed. CARD-072's `Tap-Text` matches a node's `text` only; the ‹ arrow (`Before`) and a site's **⋮** (`Change what Stake is`) have no text, only a content description, so add a `Tap-Desc` helper that matches `content-desc` the same way. It must, in order, printing every step's real output:

1. A wiped emulator; a fresh server; install the parent debug APK from your branch and sign in as `dad@example.com` (the code from `docker logs screentime-api-1`); answer the notification question with `Don't allow`.
2. Work out yesterday in the family zone (`Australia/Sydney`) and print it; run `dev-report-data.ts Alex <that date>` and print its output.
3. Tap `Reports`, then `Before` (the ‹ arrow, content description `Before`) once so the period reads `Yesterday`; print `Screen-Text`; check criterion 40 (scroll down with `input swipe` if a word is below the fold, and print `Screen-Text` again after each swipe). `Shot 'card075-apps'`.
4. Tap `Report PC`; print `Screen-Text`; check criterion 41. Tap `All devices`.
5. Tap `Websites`; print `Screen-Text`; check criterion 42 (swipe as needed). `Shot 'card075-websites'`.
6. Criterion 43: the sheet, `Games`, `Save`; wait 3 s; print `Screen-Text`; print `Db "select site, kind, category from site_overrides"`; then `Go back to automatic`; wait 3 s; print `Screen-Text` and the same query.
7. Tap `Searches`; print `Screen-Text`; check criterion 44. `Shot 'card075-searches'`.
8. Criterion 45: `docker stop screentime-api-1`, pull down (`input swipe 540 700 540 1600`), wait 5 s, print `Screen-Text`, check; `docker start screentime-api-1` and `Wait-Health`.
9. Print `Db "select name, platform from devices where name like 'Report %'"`, stop the emulator and print `--- Finished with <n> failed.`

Close other programs first: **the emulator freezes when the PC runs out of memory** (`adb` then hangs with no error). Run it with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
pwsh -File docs\cards\CARD-075-run.ps1 2>&1 | Tee-Object -FilePath ..\temp\card075-bob-out.txt
```

It **wipes the emulator and the development database** (as CARD-072's run does). Say in the handback if you had to bring the dev stack back afterwards.

### 8.3 CI

Every check on the PR is green.

## 9. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-075-parent-reports
   ```
2. Commit in small logical commits. Message format: `CARD-075: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes.
4. Push: `git push -u origin bob/card-075-parent-reports`
5. Open a PR into `main` titled `CARD-075: Reports in the parent app`, with its body written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-075-parent-reports.md

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

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. If one of Claude's helpers fails a fixture, keep the test as the card says (failing) and ask; never change the expected value. If Claude's screens do something wrong with real data, describe it with the `Screen-Text` output; do not change Claude's files. Changing what an existing test checks is a deviation: list it.

## 11. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs, the dev database and its own run of your tests, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- **Every acceptance criterion (1 to 46)** gets one line: the test name or the run step that proves it, and `PASS`, `FAIL` or `NOT RUN`.
- Paste the test totals Gradle wrote (the `<testsuite` lines); do not add them up yourself.
- The break-it step (criterion 39) shows each failing test's output and the `git checkout` that restored it.
- The emulator run is pasted **whole**: every line of `card075-bob-out.txt`. A step without its pasted output counts as `NOT RUN`.
- "Deviations" lists every way your work differs from the card, and every workaround you used in the run (a restart, a retry, an extra command) with why you needed it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-075. Please review and merge if it is good.

CARD: CARD-075 Reports in the parent app
PR: <full PR URL>
Branch: bob/card-075-parent-reports
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Tests I wrote (file: test names):
<list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Break it (criterion 39):
- (a) <failing test output> / restored with <command>
- (b) ...
- (c) ...
- (d) ...

Acceptance criteria:
- 1: <test name or run step> PASS / FAIL / NOT RUN: <reason>
- ...
- 46: ...

Emulator run (all of ..\temp\card075-bob-out.txt):
<paste every line>

What the screenshots show:
- card075-apps.png: <what you see>
- card075-websites.png: <what you see>
- card075-searches.png: <what you see>

Deviations from the card:
<None, or each one: file, what differs, why; and every workaround in the run>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
