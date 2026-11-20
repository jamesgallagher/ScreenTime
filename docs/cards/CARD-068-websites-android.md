# CARD-068: Websites, Android collection and the server's store

| Field | Value |
|---|---|
| Card | CARD-068 |
| Title | Websites, Android collection and the server's store |
| Size | L |
| Depends on | CARD-067 (merged) and Claude's PR with this card, merged to `main` |
| Spec sections | docs/SPEC.md §12.10 (read it first), §3 Q42, §6.1 `site_lookups` and `site_daily`, §9.3 `POST /v1/device/site-lookups`, §12.4 and §12.9 (parent mode's spans in the kid app) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-068-websites-android` |
| PR title | `CARD-068: Websites, Android collection and the server's store` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The full specification is `docs/SPEC.md`. Repository rules for coding agents are in `AGENTS.md`: read it first, and start this card with `/card 068`.

**How this card works.** Claude did the design, proved the risky parts in spikes, and wrote this card. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a table, column, route, field, class or file, use that name exactly; everything else is your choice, following the repo's patterns. Claude re-runs your tests, breaks lines of your code on purpose, compares your pasted output with the database, and reviews the code before merging.

**Use PowerShell 7 (`pwsh`) for every command, never Windows PowerShell 5.1.** Write every file as UTF-8 without a BOM.

**What James asked for (20 Nov 2026).** A Websites report: which sites a kid visited, in any browser and **in incognito too**, at system level, with **no browser extension**. This card is the first part: the Android kid app collects the sites, and the server stores them. Windows (CARD-069) and the classifier with the report page (CARD-070) come next. **No web or parent-app change in this card.**

**The design in one paragraph (SPEC §12.10).** The kid app is already Device Owner. It turns on Android's **network logging**, which hands the app's `DeviceAdminReceiver` batches of DNS lookups, each with the **host, the app's package and the time**. The kid app keeps them in `kid.db`, leaves out its own lookups and those in parent mode, and uploads them at each sync with a new route, `POST /v1/device/site-lookups`. The server keeps every lookup 90 days in `site_lookups` and adds them up per day, device, site and app in `site_daily`, kept forever. The kid app also gives Chrome a managed configuration that turns Chrome's Secure DNS off.

**What is already proven (Claude's spike on the Redmi, 20 Nov 2026).** Network logging works on a Device Owner app; `onNetworkLogsAvailable` arrives with a batch token; `retrieveNetworkLogs` gives `DnsEvent`s with the hostname and package (`com.android.chrome www.khanacademy.org`); it works in Chrome's incognito tabs and while Bark's VPN is connected; `adb shell dpm force-network-logs` delivers a batch at once. Do not spend time re-proving these.

## 2. Goal

With the new kid app on a device, every website its browsers and apps look up reaches the server within a sync or two of Android handing over a batch, and the server holds the raw lookups and the daily totals per site, ready for the report in CARD-070.

## 3. Out of scope

- **No web, parent app or Windows change**, except the files `pnpm contract` regenerates.
- No classification, no report route, no UI (CARD-070). No Windows collection (CARD-069).
- No VPN, no Private DNS change, no blocking, no alerts.
- No change to app usage, segments or limits.
- **One new library only: `tldts`** in `server` (the public suffix list, for the registrable domain). No other new library.
- Never commit secrets. Do not edit generated files by hand: run `pnpm contract`.

## 4. Tech and traps

- **Migration.** The last one is `0014_device_programs.sql`, so yours is `server/drizzle/0015_site_lookups.sql` (see the `db-migration` skill): both tables, their indexes, foreign keys like `0009_device_games.sql`, and RLS with the `family_isolation` policy on both.
- **The registrable domain.** Use `tldts`' `getDomain(host)`; when it returns null (a bare name, `localhost`, an unknown suffix), the site is the host itself.
- **The family's local day.** `site_daily.day` is the date of `at` in the family time zone, worked out through the zone (in SQL: `(at at time zone <tz>)::date`), never by adding hours.
- **Only new rows count.** Insert raw rows with `ON CONFLICT DO NOTHING ... RETURNING`, and add only the returned rows to `site_daily`, in the same transaction. A repeat upload must change nothing.
- **Room migration.** `KidDatabase` is `version = 1` with `exportSchema = false`. Adding the `site_lookups` table makes it `version = 2` with a `Migration(1, 2)` that creates the table. **Never** `fallbackToDestructiveMigration`: it would wipe usage segments that have not been sent.
- **The receiver.** `onNetworkLogsAvailable` runs on the main thread with about 10 seconds: use `goAsync()` and finish the work in a coroutine; call `retrieveNetworkLogs(admin, batchToken)` once (a second call, or a stale token, returns null). Keep `DnsEvent`s only; ignore `ConnectEvent`s. The manifest's receiver adds the action `android.app.action.NETWORK_LOGS_AVAILABLE` to its intent filter (the spike had it).
- **Parent mode's spans** are in `AppWatcher`'s `apps` preferences under `spans` (8 days, CARD-066), parsed by `parseSpans` in `apps/Apps.kt`, plus the open span in `PARENT_FROM`. Reuse them; do not keep a second copy.
- **Chrome's managed configuration.** `DevicePolicyManager.setApplicationRestrictions(admin, "com.android.chrome", bundle)` with the string `DnsOverHttpsMode = "off"`; read it back with `getApplicationRestrictions` and log it. Chrome reads it itself; nothing else to do.
- **The emulator** is Android Studio's `Medium_Phone_API_37.0` on this PC (see the `emulator-run` skill). It has Chrome.
- Server tests skip without `TEST_DATABASE_URL`: check yours ran.

## 5. Design (what to build)

### 5.1 Server

1. **Tables** exactly as SPEC §12.10 "Data": `site_lookups` (`family_id`, `kid_id`, `device_id`, `at` timestamptz, `host` text, `package` text, `received_at` timestamptz default now; PK (`device_id`, `at`, `host`, `package`); indexes (`kid_id`, `at`) and (`at`)) and `site_daily` (`family_id`, `kid_id`, `device_id`, `day` date, `site` text, `package` text, `lookups` int, `first_at`, `last_at` timestamptz; PK (`device_id`, `day`, `site`, `package`); index (`kid_id`, `day`)).
2. **Schema** `SiteLookupsUpload` in `packages/schemas/src/sites.ts` (exported from the index): `lookups`, 1 to 1,000 items, each `at` (ISO datetime), `host` (string matching `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`, at most 253 characters), `package` (1 to 255 characters). Answer `SiteLookupsReceived { received: int }`.
3. **Route** `POST /v1/device/site-lookups` (device token, `requireDevice`), in `server/src/sites/routes.ts`, registered in `server/src/app.ts` and in the OpenAPI document. Inside `withFamily`: skip each lookup whose `at` is more than 30 days before now or more than 1 day after; insert the rest into `site_lookups` (`ON CONFLICT DO NOTHING RETURNING`); for each returned row upsert `site_daily` for (`device_id`, local day, site, package): `lookups + 1`, `first_at = least`, `last_at = greatest`. Answer `200 { received: <returned rows> }`. Works for any device kind.
4. **Retention.** The sweep (`server/src/jobs/sweep.ts`) also deletes `site_lookups` rows with `at` older than 90 days, per family inside its existing `withFamily` pass. `site_daily` is never deleted.
5. **Dev script** `server/scripts/dev-sites.ts <kid name> [YYYY-MM-DD]`: prints the `site_daily` rows of that kid's devices for that day (default today), most lookups first, as `site | package | lookups | first..last`, then the count of raw `site_lookups` for that day. Development database only, said in its header.

### 5.2 Android kid app (`android/app-kid/src/main`)

1. **Turning it on.** When `KidService` starts and the app is Device Owner, call `setNetworkLoggingEnabled(admin, true)` when `isNetworkLoggingEnabled(admin)` is false; log `sites: network logging on` once. Set Chrome's managed configuration (4.) at the same time and log `sites: chrome policy {DnsOverHttpsMode=off}` from the read-back.
2. **Receiving.** `KidDeviceAdminReceiver.onNetworkLogsAvailable`: retrieve the batch, turn each `DnsEvent` into a candidate (`atMs = timestamp`, `host` = hostname lower-cased, trimmed, trailing dot removed, `package` = packageName), keep it only when `keepLookup` (5.) says so, and store the kept ones in `kid.db` table `site_lookups` (`id` autoincrement, `atMs`, `host`, `pkg`). Then, if more than 50,000 rows wait, delete the oldest down to 50,000. Log `sites: batch <token> <n> events, <k> kept`.
3. **Uploading.** At each sync, after `sendUsage`: send the oldest 1,000 rows with `POST /v1/device/site-lookups`; when the server answers 200, delete exactly those rows and send the next 1,000 (at most 10 calls per sync). A failure keeps them for the next sync. Log `sites: sent <n> (<received> new)`.
4. **Chrome.** `setApplicationRestrictions(admin, "com.android.chrome", bundleOf("DnsOverHttpsMode" to "off"))`. Incognito stays allowed.
5. **Pure functions** (in `android/app-kid/src/main/kotlin/au/screentime/kid/sites/Sites.kt`, unit tested): `normalizeHost(raw: String): String?` (lower case, trim, drop one trailing dot; null when empty or when it is an IPv4 or IPv6 literal) and `keepLookup(host: String?, pkg: String?, atMs: Long, ownPackage: String, parentModeSpans: List<Span>): Boolean` (false for a null host, a null or empty package, the app's own package, or a time inside any span; true otherwise).

### 5.3 Generated clients

`pnpm contract` regenerates `contract/openapi.json`, the Kotlin client (`ApiModels.kt`, `ApiClient.kt`: the kid app calls the new route through it) and the C# client. Commit them.

## 6. Acceptance criteria

Every criterion is a test with fixed inputs (fixed dates, a fixed time zone), unless it says otherwise. Claude re-checks each one.

**Server** (`server/test/site-lookups.test.ts`, family time zone `Australia/Sydney`)

1. Migration `0015_site_lookups.sql` creates both tables with their primary keys, and `pg_policies` has `family_isolation` for both.
2. A device posts `[{ at: "2026-11-10T01:00:00Z", host: "www.khanacademy.org", package: "com.android.chrome" }, { at: "2026-11-10T01:00:05Z", host: "cdn.kastatic.org", package: "com.android.chrome" }]` → `200 { received: 2 }`; `site_lookups` has 2 rows; `site_daily` has `khanacademy.org` 1 and `kastatic.org` 1 for day `2026-11-10`, package `com.android.chrome`, with `first_at` and `last_at` equal to each `at`.
3. The same body again → `{ received: 0 }`, and `site_daily` is unchanged (still 1 each).
4. `www.abc.net.au` → site `abc.net.au`; `localhost` and `printer` → the host itself.
5. Local day: `at` `2026-11-10T13:30:00Z` is 11 November 00:30 in Sydney → `site_daily.day` `2026-11-11`; `2026-11-10T12:30:00Z` → `2026-11-10`.
6. Two lookups of `www.coolmathgames.com` by `com.android.chrome` at `2026-11-10T01:00:00Z` and `2026-11-10T03:00:00Z`, posted in two calls (the later one first) → one `site_daily` row with `lookups` 2, `first_at` 01:00 and `last_at` 03:00.
7. Out of range (the server compares with its own clock, so this test builds `at` from the test's current time with fixed offsets): one body with `at` = now − 31 days, now − 1 hour and now + 2 days → `{ received: 1 }`, and only the now − 1 hour row is stored.
8. Validation, each in its own call → 422 and nothing stored: host `Www.Example.com` (a capital), `example.com.` (a trailing dot), `exa mple.com` (a space), a host of 254 characters; 1,001 lookups; an empty `lookups` array; an empty `package`.
9. Isolation: a device token of family B cannot write into family A (its rows carry its own family), and a parent of B sees none of A's rows through RLS.
10. Retention: with rows at 89 and 91 days before now, one sweep deletes only the 91-day row; `site_daily` keeps both days.

**Kid app** (`android/app-kid/src/test/kotlin/au/screentime/kid/sites/SitesTest.kt`)

11. `normalizeHost`: `"WWW.Example.COM."` → `"www.example.com"`; `" khanacademy.org "` → `"khanacademy.org"`; `""` → null; `"192.168.0.148"` → null; `"2404:6800:400a:1001::66"` → null.
12. `keepLookup`: false for a null host, a null package, `"au.screentime.kid"` (own package), a time inside a parent-mode span (span 1,000–2,000, at 1,500; the span's ends count as inside); true for `com.android.chrome` at 2,500.
13. The Room migration from version 1 to 2 keeps existing segments (a test with Room's `MigrationTestHelper`, or an instrumented-free test that runs the migration's SQL on an in-memory SQLite and checks a segment row survives). Say which in the PR.

**Break it yourself** (paste each result)

14. One at a time, change the line, run the named tests, paste the failing test, restore with `git checkout -- <file>`:
    - server: add every raw row to `site_daily`, not only the returned new ones → criterion 3 fails;
    - server: compute the day in UTC instead of the family zone → criterion 5 fails;
    - kid app: drop the own-package check in `keepLookup` → criterion 12 fails;
    - kid app: keep the trailing dot in `normalizeHost` → criterion 11 fails.

**End to end on the emulator** (section 8.2)

15. Every step's real output pasted.

**General**

16. `pnpm contract` then `git status --short contract android/core-model windows/src/ScreenTime.Core/Api` prints nothing; `pnpm typecheck`, `pnpm test` (with `TEST_DATABASE_URL`), `dotnet test` and `.\gradlew.bat assembleDebug test` pass; CI is green.
17. `git diff --name-only main -- web/src android/app-parent/src/main windows/src packages/engine android/core-time` prints only generated client files.

## 7. Tests you write

- `server/test/site-lookups.test.ts` (new): criteria 1 to 10, fixed dates.
- `android/app-kid/src/test/kotlin/au/screentime/kid/sites/SitesTest.kt` (new): criteria 11 to 13.
- Keep every existing test unchanged. **Changing what an existing test checks is a deviation: list it.** Each new test must fail if the behaviour it names breaks (see the `card-tests` skill).

## 8. Checks

### 8.1 Commands

From the repo root, in `pwsh`:

```powershell
pnpm install
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
cd android; $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; .\gradlew.bat assembleDebug test; .\gradlew.bat --stop; cd ..
git diff --name-only main -- web/src android/app-parent/src/main windows/src packages/engine android/core-time
```

(`pnpm install` without `--frozen-lockfile` this time, as `tldts` is new; commit `pnpm-lock.yaml`. The `create database` line fails harmlessly when it exists.) Paste the totals each test runner prints.

### 8.2 On the emulator

With the dev API running (`pnpm dev:server`, or the dev stack in Docker as it is), on a **wiped** `Medium_Phone_API_37.0` with the debug kid app as Device Owner (the `emulator-run` skill). Paste the **real output of every step**:

1. Enrol to the dev kid Alex and give time (`dev-enrol-code.ts Alex phone`, `dev-grant.ts Alex phone 60`). Paste the logcat lines `sites: network logging on` and `sites: chrome policy {DnsOverHttpsMode=off}` (`adb -e logcat -d -s KidService`, or your tag).
2. Open three sites in Chrome, 20 s apart: `adb -e shell am start -a android.intent.action.VIEW -d https://www.khanacademy.org -p com.android.chrome`, then `https://www.abc.net.au`, then `https://www.coolmathgames.com`. (Chrome's first-run screens may need `Tap-Text` as in `docs/cards/CARD-058-run.ps1`; list any taps as deviations.)
3. `adb -e shell dpm force-network-logs`, wait 10 s, paste the `sites: batch … kept` line.
4. Turn the screen off (`adb -e shell input keyevent KEYCODE_SLEEP`) so the app syncs; paste the `sites: sent …` line.
5. `pnpm --filter @screentime/server exec tsx scripts/dev-sites.ts Alex`: paste it. It must list `khanacademy.org`, `abc.net.au` and `coolmathgames.com` with package `com.android.chrome`, and no row with package `au.screentime.kid`.
6. Run step 4 again (screen on, then off): paste the `sites: sent` line; `dev-sites.ts` must show the same `lookups` numbers as in step 5 for those three sites (nothing counted twice).
7. Stop the emulator with `adb -s emulator-5554 emu kill`.

A step without its pasted output counts as `NOT RUN`.

## 9. Git and pull request

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-068-websites-android`.
2. Small logical commits: `CARD-068: <what changed>`.
3. Run 8.1 again before pushing. Push: `git push -u origin bob/card-068-websites-android`.
4. Run `/review-card 068` and fix what it finds.
5. Open a PR into `main` titled `CARD-068: Websites, Android collection and the server's store`, body in `C:\Users\james\OpenCode\Testing\temp\` with the sections Card, What I did, Acceptance criteria (each with its test name or output), Deviations, Blockers / questions.
6. **Do not merge.** Do not push to `main`.
7. `/handback 068` for the handback (section 11).

## 10. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, commit what works, and write the problem under "Blockers / questions". "No emulator available" is not a reason: it is on this PC.

## 11. Handback report (required)

Your **last message to James** is the handback in one fenced block. Every command shows the **real** output you saw; anything not run is `NOT RUN: <reason>`; test totals are as the runner printed them; every workaround and every changed existing test is a deviation.

````text
Claude, here is Bob's handback for CARD-068. Please review and merge if it is good.

CARD: CARD-068 Websites, Android collection and the server's store
PR: <full PR URL>
Branch: bob/card-068-websites-android
Head commit: <git rev-parse HEAD>

Files changed (git diff --name-only main...HEAD):
<list>

Commands run, with real output:
- <command> -> <key lines, or NOT RUN: reason>

Break it yourself (criterion 14), each change and the failing test:
- ...

Emulator run (8.2), real output of every step:
1. ...

Acceptance criteria:
- [x] <criterion> (evidence above)

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
