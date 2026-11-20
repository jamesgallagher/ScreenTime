# CARD-069: Websites on a PC: the DNS log, browser policies and titles

| Field | Value |
|---|---|
| Card | CARD-069 |
| Title | Websites on a PC: the DNS log, browser policies and titles |
| Size | L |
| Depends on | CARD-068 (merged, `POST /v1/device/site-lookups` is live) and Claude's PR with this card, merged to `main` |
| Spec sections | docs/SPEC.md §12.10 (read it all first, especially "What the spikes proved" and "Windows collection"), §6.1 `site_titles`, §9.3 `POST /v1/device/site-titles`, §12.9 "Windows programs" (the `front` line, `ProgramClock`, counting rules) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-069-websites-windows` |
| PR title | `CARD-069: Websites on a PC: the DNS log, browser policies and titles` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The full specification is `docs/SPEC.md`. Repository rules for coding agents are in `AGENTS.md`: read it first, and start this card with `/card 069`.

**How this card works.** Claude did the design, proved the risky parts in two Windows Sandbox spikes, and wrote this card. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a table, column, route, field, class, method or file, use that name exactly; everything else is your choice, following the repo's patterns. Claude re-runs your tests, breaks lines of your code on purpose, compares your pasted output with the database, and reviews the code before merging.

**Use PowerShell 7 (`pwsh`) for every command, never Windows PowerShell 5.1.** Write every file as UTF-8 without a BOM.

**What James asked for (20 Nov 2026).** A Websites report: which sites a kid visited, in any browser and **in private windows too**, at system level, with **no browser extension**, and **browser extensions blocked**. CARD-068 did Android and the server's store. **This card does the kids' PCs**: the sites every program looks up, and the page titles of the four browsers the kids use (Edge, Chrome, Brave, Firefox; James asked for titles in this card). The classifier and the report page come in CARD-070. **No web or parent-app change in this card.**

**The design in one paragraph (SPEC §12.10 "Windows collection").** The service (LocalSystem) writes browser policies at every start, so Edge, Chrome and Brave use Windows' own DNS client (never their own or DNS over HTTPS), Firefox never uses DNS over HTTPS, Brave's Tor windows are off and no browser takes extensions. It turns on the DNS Client's operational log and subscribes to its event 3008, which names the host, the process and the **Windows account**; it keeps the lookups of enrolled kid accounts (not in parent mode), drops noise and repeats, keeps them in `state.db` and uploads them with the existing `POST /v1/device/site-lookups`. The tray adds the **browser window's title** to the `front` pipe line it already sends; the service times each title like a program and uploads the spans with a new route, `POST /v1/device/site-titles`, into a new table `site_titles` (90 days).

**What is already proven (Claude's spikes, 20 Nov 2026, Windows Sandbox, Edge 157).** With Edge's defaults its lookups never reach the DNS log; with `DnsOverHttpsMode = off` and `BuiltInDnsClientEnabled = 0` every Edge lookup is logged as `msedge`, **InPrivate included**. Each event 3008 carries the account's SID in its header (`Security UserID`). A page repeats its lookups many times. The window titles are as in 5.4. Do not spend time re-proving these.

## 2. Goal

With the new MSI on a PC, every site a kid account's programs look up, and every page title of the four browsers in front, reaches the server within a sync or two, and nothing from other accounts, from Windows itself or from parent mode does. Uninstalling removes the browser policies.

## 3. Out of scope

- **No web, parent app or Android change**, except the files `pnpm contract` regenerates.
- No classification, no report route, no UI (CARD-070). No change to `site_lookups`, `site_daily` or the existing route.
- No blocking of sites, no alerts, no other browser (Opera and others are a known gap).
- No titles of other programs: only the four browsers' windows are ever read.
- No change to program time (`ProgramClock`, `program_days`, `app-usage`), segments or limits.
- No change to the MSI (`Package.wxs`): `unharden` already runs at uninstall.
- **No new library** in `server` or `windows`. Never commit secrets. Do not edit generated files by hand: run `pnpm contract`.

## 4. Tech and traps

- **Migration.** The last one is `0015_site_lookups.sql`, so yours is `server/drizzle/0016_site_titles.sql` (see the `db-migration` skill): the table, its indexes, foreign keys and RLS with the `family_isolation` policy, copying `0015`.
- **Native AOT.** The service is published with Native AOT. Call Windows through `LibraryImport` in `windows/src/ScreenTime.Service/Windows.cs` (no reflection, no new NuGet package). The event log: `wevtapi.dll` `EvtSubscribe` (flag `EvtSubscribeToFutureEvents`, query `*[System[EventID=3008]]` on channel `Microsoft-Windows-DNS-Client/Operational`) with a push callback, `EvtRender` with `EvtRenderEventXml`, `EvtClose`. **Keep the callback delegate (or use an `UnmanagedCallersOnly` function pointer) in a field**, as `FrontWatcher` does for its hook, or it is collected and the service crashes. Any JSON (the pipe line) goes through the source-generated contexts. CI's AOT publish must show no new trim or AOT warnings.
- **Turning the log on.** Run `%SystemRoot%\System32\wevtutil.exe sl Microsoft-Windows-DNS-Client/Operational /e:true` at start (the spike did), and log `sites: dns log on`. A failure logs a warning and the service carries on; it tries again at the next start.
- **Threads.** The event callback runs on a Windows thread pool thread. It must not touch the worker's state directly: parse the XML, then hand the lookup to a `Channel` that one loop in the worker reads, taking `_sem` as the other handlers do, to check the account and parent mode and to write `state.db`.
- **The account.** The event's `UserID` is compared with the enrolled accounts' sids in `state.db` (`devices.sid`). Not enrolled (SYSTEM `S-1-5-18`, `S-1-5-19`, a parent's account) → dropped. Parent mode: the same check as programs (`ParentModeOn(sid, now)`).
- **The program.** The event's process id → `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageName` → `ProgramNames.Id(path)` (`msedge.exe`). A process that is gone or cannot be opened → `unknown`. Do this in the callback, at once: the process may exit a moment later.
- **The time** of a lookup is the event's `TimeCreated SystemTime` (UTC), not the time the service read it.
- **Registry.** `Microsoft.Win32.Registry` works under AOT (`Windows.cs` already uses it). Write the 64-bit view of `HKLM`. Removing (in `unharden`) deletes only the values this card writes (and the `ExtensionInstallBlocklist` and `DNSOverHTTPS` subkeys when they are then empty); other values a parent set stay.
- **The pipe line.** `PipeMessage.Front` gains an optional `title` (JSON `title`, left out when null). An old tray without it still works; a new tray to an old service is never a case (they ship in one MSI).
- **state.db.** New tables are added the way `program_days` was (CARD-067): `CREATE TABLE IF NOT EXISTS` at open, no version bump. `RemoveDevice` deletes the account's rows from both new tables too.
- **The server's 30-day window** compares with the server's clock: server tests use Vitest's fake `Date` at a fixed instant, as `server/test/site-lookups.test.ts` does (`vi.useFakeTimers({ toFake: ['Date'], now: ... })`), never the real now.
- **`dotnet test` runs from `windows`.** In C# raw strings with `{}` (the JSON and XML fixtures), use `$$"""` or plain raw strings without interpolation.
- Server tests skip without `TEST_DATABASE_URL`: check yours ran.

## 5. Design (what to build)

### 5.1 Server

1. **Table `site_titles`** exactly as SPEC §12.10: `family_id`, `kid_id`, `device_id`, `at` timestamptz, `sec` int, `package` text, `title` text, `received_at` timestamptz default now; PK (`device_id`, `at`, `package`); indexes (`kid_id`, `at`) and (`at`).
2. **Schema** `SiteTitlesUpload` in `packages/schemas/src/sites.ts`: `titles`, 1 to 500 items, each `at` (ISO datetime), `sec` (integer 1 to 86,400), `package` (1 to 255 characters), `title` (1 to 300 characters). Answer `SiteTitlesReceived { received: int }`.
3. **Route** `POST /v1/device/site-titles` (`requireDevice`) in `server/src/sites/routes.ts`, in the OpenAPI document. Inside `withFamily`: skip each title whose `at` is more than 30 days before now or more than 1 day after; insert the rest with `ON CONFLICT DO NOTHING RETURNING`; answer `200 { received: <returned rows> }`. Any device kind.
4. **Retention.** The sweep deletes `site_titles` rows with `at` older than 90 days, in the same pass as `site_lookups`.
5. **Dev script.** `server/scripts/dev-sites.ts` also prints, after the raw count, the `site_titles` rows of that kid's devices for that day (the family's local day of `at`), oldest first, as `HH:MM:SS | sec | package | title` (local time), under a line `titles:`.

### 5.2 Windows Core (`windows/src/ScreenTime.Core/Sites/`, all unit tested)

1. **`DnsEvents.Parse(string xml) → DnsLookup?`**: the record `DnsLookup(long AtMs, uint ProcessId, string UserSid, string QueryName, int QueryType, int QueryStatus)` from an event's XML (section 6, fixture A). Null when the event id is not 3008, or `QueryName`, `UserID`, `ProcessID`, `QueryStatus` or `TimeCreated` is missing or unreadable. Use `System.Xml` (`XmlReader` or `XDocument`), never string search.
2. **`SiteHosts.Normalize(string raw) → string?`**: trimmed, lower case, one trailing dot removed; null when the result is empty, has no dot, is an IPv4 or IPv6 literal, ends in `.local`, `.lan`, `.home.arpa` or `.arpa`, or does not match the server's host rule (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`, at most 253 characters).
3. **`SiteLookupFilter`** (one instance in the service, it keeps the repeat window): `Decide(DnsLookup e, string program, bool enrolled, bool parentMode) → SiteLookup?` with `SiteLookup(string Sid, long AtMs, string Host, string Program)`. Null when `QueryStatus` ≠ 0, not `enrolled`, `parentMode`, `Normalize` gives null, `program` is `screentime.tray.exe` or `screentime.service.exe`, or the same (sid, host, program) was **kept** less than 10,000 ms before `AtMs`. A dropped repeat does not move the window.
4. **`BrowserPolicies`**: the list of values in SPEC §12.10 "Browser policies" (key path, value name, kind, value), and the subkeys they live in. The service writes them all; `unharden` removes them all. Write both from this one list.
5. **`BrowserTitles`**: `IsBrowser(string programId)` (true for `msedge.exe`, `chrome.exe`, `brave.exe`, `firefox.exe`, any case; false for everything else, `msedgewebview2.exe` too) and `Clean(string? raw) → string?` (removes U+200B, U+200C, U+200D, U+FEFF and every control character, trims, cuts to 300 characters, trims again; null when empty).
6. **`TitleClock`** (one per account, like `ProgramClock`): `Front(string? program, string? title, long atMs)`, `Counting(bool on, long atMs)`, each returning the spans that closed: `TitleSpan(long AtMs, int Sec, string Program, string Title)`. A span runs while counting is on and a title is set; it closes when the program or title changes, counting stops, or the tray goes away (`Front(null, null, …)`). `Sec` = milliseconds / 1000 rounded down, at most 86,400; a span under 1 s, or one whose end is not after its start (the clock stepped back), is not returned. The same program and title again (a `front` line repeated after `hello`) does not close the span. Turning counting on starts a new span from that moment for the title in front.

### 5.3 Windows service and tray

1. **At service start**: write `BrowserPolicies` and log `sites: browser policies set` (a failure logs a warning naming the value and carries on); turn on the DNS log (section 4); subscribe to event 3008 and log `sites: dns log subscribed`.
2. **Each event**: `Parse` → the program from the process id → into the channel → the worker loop: `Decide` with `enrolled` (the sid is in `devices`) and `parentMode` → `state.db` table `site_lookups` (`id` autoincrement, `sid`, `at_ms`, `host`, `program`). Then, when the account has more than 50,000, delete its oldest down to 50,000.
3. **Upload lookups**: at each sync of an account, after `ReportPrograms`: the oldest 1,000 of that account with `POST /v1/device/site-lookups` (`package` = the program); on 200 delete exactly those rows and send the next 1,000, at most 10 calls per sync. A failure keeps them. Log `{Kid}: sites: sent <n> (<received> new)`.
4. **Tray**: `FrontWatcher` reads the front window's title (`GetWindowText`) only when `BrowserTitles.IsBrowser(id)`, cleans it with `BrowserTitles.Clean`, and sends the `front` line when the program, the label **or the title** changed (and after each `hello`, as today). Other programs never carry a title.
5. **Service**: each account's `KidSession` gets a `TitleClock`, fed wherever its `ProgramClock` is fed (front lines, counting on and off at lock, unlock, parent mode, tray exit and service stop). Closed spans go to `state.db` table `title_spans` (`id` autoincrement, `sid`, `at_ms`, `sec`, `program`, `title`); more than 20,000 for an account → delete its oldest down to 20,000.
6. **Upload titles**: at each sync, after the lookups: the oldest 500 spans with `POST /v1/device/site-titles` (`at` = start as ISO UTC, `sec`, `package` = program, `title`); on 200 delete exactly those and send the next 500, at most 10 calls. Log `{Kid}: sites: titles sent <n> (<received> new)`.
7. **`unharden`** (Program.cs) also removes `BrowserPolicies` and prints `Browser policies removed: <n> values`. `harden-check` also prints `Browser policies: set` or `Browser policies: missing <names>`.

### 5.4 Generated clients

`pnpm contract` regenerates `contract/openapi.json`, the Kotlin client and the C# client (`windows/src/ScreenTime.Core/Api/*.g.cs`; the service calls the new route through it). Commit them.

## 6. Acceptance criteria

Every criterion is a test with fixed inputs (fixed dates, a fixed time zone), unless it says otherwise. Claude re-checks each one.

**Fixture A** (a real event from Claude's spike; put it in the test file as it is):

```xml
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Microsoft-Windows-DNS-Client' Guid='{1c95126e-7eea-49a9-a3fe-a378b03ddb4d}'/><EventID>3008</EventID><Version>0</Version><Level>4</Level><Task>0</Task><Opcode>0</Opcode><Keywords>0x8000000000000000</Keywords><TimeCreated SystemTime='2026-11-20T08:49:36.4044541Z'/><EventRecordID>485</EventRecordID><Correlation/><Execution ProcessID='8948' ThreadID='9036'/><Channel>Microsoft-Windows-DNS-Client/Operational</Channel><Computer>9e7dba08-41fb-4ec1-941d-c57e67e30d90</Computer><Security UserID='S-1-5-21-2047949552-857980807-821054962-504'/></System><EventData><Data Name='QueryName'>www.abc.net.au</Data><Data Name='QueryType'>1</Data><Data Name='QueryOptions'>722968478755192832</Data><Data Name='QueryStatus'>0</Data><Data Name='QueryResults'>type: 5 www.abc.net.au.edgekey.net;type: 5 e3161.b.akamaiedge.net;23.210.64.132;</Data></EventData></Event>
```

**Server** (`server/test/site-titles.test.ts`, family time zone `Australia/Sydney`, fake `Date` at `2026-11-12T00:00:00Z`)

1. Migration `0016_site_titles.sql` creates `site_titles` with its primary key, and `pg_policies` has `family_isolation` for it.
2. A device posts `[{ at: "2026-11-10T01:00:00Z", sec: 42, package: "msedge.exe", title: "how to draw - Search and 2 more pages - [InPrivate] - Microsoft Edge" }, { at: "2026-11-10T01:00:42Z", sec: 7, package: "firefox.exe", title: "Wikipedia — Mozilla Firefox Private Browsing" }]` → `200 { received: 2 }`; both rows stored exactly as sent (title, sec, package, at), with the device's family, kid and device.
3. The same body again → `{ received: 0 }`, still 2 rows. The first item again with `sec: 50` → `{ received: 0 }` and `sec` stays 42.
4. Out of range: one body with `at` `2026-10-12T23:00:00Z` (more than 30 days before), `2026-11-11T23:00:00Z` and `2026-11-13T01:00:00Z` (more than 1 day after) → `{ received: 1 }`, only the `2026-11-11T23:00:00Z` row stored.
5. Validation, each in its own call → 422 and nothing stored: `sec` 0; `sec` 86,401; `sec` 1.5; a title of 301 characters; an empty title; an empty `package`; 501 titles; an empty `titles` array.
6. Isolation: a device token of family B writes rows with B's family; a parent of B sees none of A's rows through RLS.
7. Retention: with rows inserted straight into the table (the route would skip them) at `at` 89 and 91 days before the fake now, one sweep deletes only the 91-day row (and still deletes `site_lookups` as before).

**Windows Core** (`windows/tests/ScreenTime.Core.Tests/SitesTests.cs`)

8. `DnsEvents.Parse(fixture A)` → `AtMs` 1,795,164,576,404 (`2026-11-20T08:49:36.404Z`, sub-millisecond digits dropped), `ProcessId` 8948, `UserSid` `S-1-5-21-2047949552-857980807-821054962-504`, `QueryName` `www.abc.net.au`, `QueryType` 1, `QueryStatus` 0. Fixture A with `<EventID>3006</EventID>` → null; without the `Security` element → null; `"not xml"` → null.
9. `SiteHosts.Normalize`: `"WWW.ABC.NET.AU."` → `"www.abc.net.au"`; `" en.wikipedia.org "` → `"en.wikipedia.org"`; null for `""`, `"wpad"`, `"localhost"`, `"192.168.0.148"`, `"2404:6800:400a:1001::66"`, `"printer.local"`, `"router.lan"`, `"nas.home.arpa"`, `"148.0.168.192.in-addr.arpa"`, `"_ldap._tcp.example.com"`, and a 254-character host.
10. `SiteLookupFilter.Decide` with sid `S-1-5-21-1-2-3-1001`, program `msedge.exe`, enrolled, not parent mode, host `www.abc.net.au`, status 0, at 1,000,000 → kept (`SiteLookup` with those values). Then, each on its own fresh filter unless it says so: status 9003 → null; status 87 → null; not enrolled → null; parent mode → null; program `screentime.tray.exe` → null; host `wpad` → null.
11. Repeats (one filter): at 1,000,000 kept; at 1,009,999 same sid, host and program → null; at 1,010,000 → kept; at 1,015,000 → null; at 1,020,000 → kept (the dropped one did not move the window). The same host by `chrome.exe` at 1,009,999 → kept; the same host and program for sid `S-1-5-21-1-2-3-1002` at 1,009,999 → kept.
12. `BrowserTitles.IsBrowser`: true for `msedge.exe`, `CHROME.EXE`, `brave.exe`, `firefox.exe`; false for `msedgewebview2.exe`, `notepad.exe`, `""`. `BrowserTitles.Clean`: `"Wikipedia - Profile 1 - Microsoft\u200B Edge"` → `"Wikipedia - Profile 1 - Microsoft Edge"`; `"  a\tb\r\n "` → `"ab"`; `"\u200B"` → null; null → null; 400 × `"x"` → 300 × `"x"`.
13. `BrowserPolicies` has exactly the values of SPEC §12.10, **13 in all** (the test lists each key, name, kind and value and asserts the count): Edge, Chrome and Brave each `DnsOverHttpsMode` string `off`, `BuiltInDnsClientEnabled` DWORD 0 and `ExtensionInstallBlocklist\1` string `*` (9); Brave `TorDisabled` DWORD 1 (10); Firefox `DNSOverHTTPS\Enabled` DWORD 0, `DNSOverHTTPS\Locked` DWORD 1 and `ExtensionSettings` string `{"*":{"installation_mode":"blocked"}}` (13). Keys are under `HKLM\SOFTWARE\Policies\`: `Microsoft\Edge`, `Google\Chrome`, `BraveSoftware\Brave`, `Mozilla\Firefox`.
14. `TitleClock` (all times in ms): counting on at 0; `Front("msedge.exe", "A", 0)`; `Front("msedge.exe", "A", 5,000)` (a repeat) → nothing; `Front("msedge.exe", "B", 42,700)` → one span (0, 42, `msedge.exe`, `A`); `Counting(false, 50,000)` → (42,700, 7, `msedge.exe`, `B`); `Counting(true, 60,000)` then `Front(null, null, 60,900)` → nothing (B again for 900 ms: under 1 s); `Front("chrome.exe", "C", 70,000)` → nothing; `Front("chrome.exe", "D", 69,000)` (the clock stepped back) → nothing; `Front("chrome.exe", "E", 72,500)` → (69,000, 3, `chrome.exe`, `D`). On a fresh clock: counting on at 0, `Front("msedge.exe", "A", 0)`, `Front("msedge.exe", "B", 100,000,000)` → (0, 86,400, `msedge.exe`, `A`).
15. `LocalStore`: add 3 lookups for sid X and 1 for sid Y; the oldest 2 of X are the first two by `at_ms`; deleting them by id leaves 1 for X and 1 for Y. With the cap at 50,000, adding the 50,001st for X leaves 50,000 and the oldest is gone. The same for `title_spans` with its cap of 20,000. `RemoveDevice(X)` deletes X's rows in both tables and keeps Y's.
16. `PipeMessage`: `Front` with a third argument, the title: `Front("msedge.exe", "Microsoft Edge", "how to draw - Search")` serialises with `"title":"how to draw - Search"`; a `front` line without `title` (as an old tray sends it) parses with title null; `Front(null, null)` has no `title` field.

**Break it yourself** (paste each result)

17. One at a time, change the line, run the named tests, paste the failing test, restore with `git checkout -- <file>`:
    - `SiteLookupFilter`: move the window on a dropped repeat → criterion 11 fails;
    - `SiteLookupFilter`: drop the `QueryStatus` check → criterion 10 fails;
    - `SiteHosts.Normalize`: drop the "has a dot" rule → criterion 9 fails;
    - `TitleClock`: close the span on a repeated identical `Front` → criterion 14 fails;
    - server: answer the number of rows in the body instead of the returned rows → criterion 3 fails.

**In Windows Sandbox** (section 8.2)

18. Every step's real output pasted, with the host checks passing.

**General**

19. `pnpm contract` then `git status --short contract android/core-model windows/src/ScreenTime.Core/Api` prints nothing; `pnpm typecheck`, `pnpm test` (with `TEST_DATABASE_URL`), `dotnet test` and `.\gradlew.bat assembleDebug test` pass; CI is green, the Windows job's AOT publish and the installer job included.
20. `git diff --name-only main -- web/src android/app-parent/src/main android/app-kid/src/main packages/engine android/core-time windows/src/ScreenTime.Installer` prints only generated client files (none of these, in practice).

## 7. Tests you write

- `server/test/site-titles.test.ts` (new): criteria 1 to 7.
- `windows/tests/ScreenTime.Core.Tests/SitesTests.cs` (new): criteria 8 to 14.
- `LocalStoreTests.cs` and `PipeMessageTests.cs`: criteria 15 and 16, added to the existing files.
- Keep every existing test unchanged. **Changing what an existing test checks is a deviation: list it.** Each new test must fail if the behaviour it names breaks (see the `card-tests` skill). If you cannot make a criterion pass, leave its test as the card says, failing, and ask under "Blockers / questions".

## 8. Checks

### 8.1 Commands

From the repo root, in `pwsh`. Save slow runs to a file once and search the file (AGENTS.md, "Saving test output").

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
cd windows; dotnet test; cd ..
cd android; $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; .\gradlew.bat assembleDebug test; .\gradlew.bat --stop; cd ..
git diff --name-only main -- web/src android/app-parent/src/main android/app-kid/src/main packages/engine android/core-time windows/src/ScreenTime.Installer
```

(The `create database` line fails harmlessly when it exists.) Paste the **real totals** each test runner prints, not a sum you work out.

### 8.2 The run in Windows Sandbox

Write `windows/installer/sandbox/Test-Sites.ps1` and `windows/installer/sandbox/in-sandbox-sites.ps1`, copying the layout of `Test-Programs.ps1` and `in-sandbox-programs.ps1` (a work folder `C:\Users\james\OpenCode\Testing\temp\sandbox-sites-<time>`, `in` and `out` mapped folders, the dev server reset, Sam's PC code, a LogonCommand, results in `out\results.txt`), but with the host go-ahead below instead of their fixed waits. **Every line of `results.txt` starts with the time**, so the host looks for `=== done:` anywhere in a line (never `^=== done:`). Every check prints `ok: …` or `FAILED: …`; a failed check never lets the script carry on silently.

In the Sandbox (as WDAGUtilityAccount), in this order:

1. Install the MSI, enrol the account as Sam, point the service at this session with `--session <id> --dry-lock` and restart it, wait for the tray. Check: `ok: tray running`.
2. Check the policies with `Get-ItemProperty` (not the service's own code): `ok: edge policies` (`DnsOverHttpsMode` `off`, `BuiltInDnsClientEnabled` 0, `ExtensionInstallBlocklist` `1` = `*`), the same for `chrome policies` and `brave policies` (plus `TorDisabled` 1), and `firefox policies` (`DNSOverHTTPS` `Enabled` 0 and `Locked` 1, `ExtensionSettings`). Check the DNS log is on: `wevtutil gl Microsoft-Windows-DNS-Client/Operational` says `enabled: true` → `ok: dns log on`. Paste `ScreenTime.Service.exe harden-check`'s output.
3. Test-only setup (the service does not set these, and they do not touch DNS): Edge policies `HideFirstRunExperience` = 1 and `SyncDisabled` = 1, as Claude's spike did. Start Edge (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`) with `--no-first-run https://www.wikipedia.org/`, keep it in front 20 s; then `--inprivate https://www.abc.net.au/`, 30 s; then `--inprivate https://www.bing.com/search?q=how+to+draw`, 20 s. Before each wait, write the front window's title: `  front: <title>` (bring Edge to the front with `SetForegroundWindow` if it is not).
4. Close every Edge process **started in this Sandbox**, by process id (`Stop-Process -Id`, inside the Sandbox only). Write `=== 5. waiting for the host`.
5. Wait for the host's go-ahead: check every 5 s for `C:\in\stop.txt` (the host writes it into the read-only `in` folder; the Sandbox sees host writes), at most 4 minutes; on time-out write `FAILED: no go-ahead from the host after 240 s`.
6. Uninstall (`msiexec /x C:\in\ScreenTime.msi /qn`); check that none of the 13 policy values is left: `ok: policies removed` (any left → `FAILED:` naming them). Then `=== done: <n> failed` and shut down.

Meanwhile on the host, `Test-Sites.ps1`, once `results.txt` has the `=== 5.` line: every 10 s, for at most 4 minutes, run `server/scripts/dev-sites.ts Sam` until **two runs in a row** print the same output (the service syncs about once a minute). Then it writes `in\stop.txt`, waits for `=== done:` in `results.txt`, prints the last `dev-sites.ts` output and checks:

- `site_daily` has `wikipedia.org`, `abc.net.au` and `bing.com`, each with package `msedge.exe`;
- no row has package `svchost.exe`, `screentime.tray.exe` or `screentime.service.exe`;
- `titles:` has a row with `msedge.exe` whose title contains `Wikipedia` (10 to 25 s in all, summing its rows), one containing `[InPrivate]` and `ABC` (20 to 35 s in all), and one containing `how to draw` and `[InPrivate]` (10 to 25 s in all);
- no title row has a program other than the four browsers.

Then paste the **whole** of `out\results.txt` and the host output into the handback. A summary counts as `NOT RUN`. The run takes about 6 minutes (2 of them installing the MSI); a Sandbox window opens and closes by itself: do not click in it. **Nothing runs on James's desktop**: no program is opened, focused or closed there, and no policy is written on his PC.

**Run the Sandbox once, at the end**, for evidence: check logic with the unit tests first. Reuse the MSI you downloaded when nothing under `windows/src` changed since its CI run. The MSI from your PR's CI run:

```powershell
$run = (gh run list --branch bob/card-069-websites-windows --workflow Windows --limit 1 --json databaseId --jq '.[0].databaseId')
$msiDir = "C:\Users\james\OpenCode\Testing\temp\c69-msi-$run"
gh run download $run --name ScreenTime-msi --dir $msiDir
windows\installer\sandbox\Test-Sites.ps1 -Msi "$msiDir\ScreenTime.msi"
```

The first lines of the host script **reset the development database**, as the other Sandbox runs do.

Not tested in the run: Chrome, Brave and Firefox (the Sandbox has only Edge; their policies are checked in the registry, and their titles are stored as Windows shows them), a second kid account, a real lock (the Sandbox has no console session).

## 9. Git and pull request

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-069-websites-windows`.
2. Small logical commits: `CARD-069: <what changed>`.
3. Run 8.1 again before pushing. Push: `git push -u origin bob/card-069-websites-windows`. Wait for CI, then do 8.2 with that run's MSI.
4. Run `/review-card 069` and fix what it finds.
5. Open a PR into `main` titled `CARD-069: Websites on a PC: the DNS log, browser policies and titles`, body in `C:\Users\james\OpenCode\Testing\temp\` with the sections Card, What I did, Acceptance criteria (each with its test name or output), Deviations, Blockers / questions.
6. **Do not merge.** Do not push to `main`.
7. `/handback 069` for the handback (section 11).

## 10. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, commit what works, and write the problem under "Blockers / questions". "No Sandbox available" is not a reason: Windows Sandbox is turned on on this PC.

## 11. Handback report (required)

Your **last message to James** is the handback in one fenced block. Every command shows the **real** output you saw; anything not run is `NOT RUN: <reason>`; test totals are as the runner printed them; every workaround and every changed existing test is a deviation.

````text
Claude, here is Bob's handback for CARD-069. Please review and merge if it is good.

CARD: CARD-069 Websites on a PC: the DNS log, browser policies and titles
PR: <full PR URL>
Branch: bob/card-069-websites-windows
Head commit: <git rev-parse HEAD>

Files changed (git diff --name-only main...HEAD):
<list>

Commands run, with real output:
- <command> -> <key lines, or NOT RUN: reason>

Break it yourself (criterion 17), each change and the failing test:
- ...

Sandbox run (8.2): work folder, the whole results.txt, and the host output:
...

Acceptance criteria:
- [x] <criterion> (evidence above)

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
