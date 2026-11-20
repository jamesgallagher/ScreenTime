# CARD-070: Websites, the classifier and the report

| Field | Value |
|---|---|
| Card | CARD-070 |
| Title | Websites, the classifier and the report |
| Size | L |
| Depends on | CARD-068 and CARD-069 (merged), Claude's UI PR 213 (the Websites page, merged) and Claude's PR with this card, merged to `main` |
| Spec sections | docs/SPEC.md §12.10 (read it all, especially "Classifier and report", "Title rules" and the JSON example), §12.9 (the Apps report: periods, devices, names), §6.1 and §9.2 (the new tables and routes) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-070-websites-report` |
| PR title | `CARD-070: Websites, the classifier and the report` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The full specification is `docs/SPEC.md`. Repository rules for coding agents are in `AGENTS.md`: read it first, and start this card with `/card 070`.

**How this card works.** Claude did the design, tried the classifier prompt on the real model and the family resolver, built the Websites page, and wrote this card. **You write the code and the tests**, run every check, and send the handback. There is no code to copy, except the classifier's system prompt (section 5.4), which is a fixture: use it exactly. Where the card names a table, column, route, field, function or file, use that name exactly; everything else is your choice, following the repo's patterns. Claude re-runs your tests, breaks lines of your code on purpose, compares your pasted output with the database, and reviews the code before merging.

**Use PowerShell 7 (`pwsh`) for every command, never Windows PowerShell 5.1.** Write every file as UTF-8 without a BOM.

**What James asked for (20 and 21 Nov 2026).** A Websites report next to Apps: which sites a kid's devices looked up, sorted by the family's own LLM into kinds and categories, with Bark's duplicate lookups left out, CDNs and ads folded away, and on PCs the searches, private-window time and page titles. CARD-068 (Android) and CARD-069 (Windows) collect the data; **this card is the server side**: active minutes, the classifier, the report route and the parent's own categories. Claude built the page (PR 213); you only swap its fake for the real calls.

## 2. Goal

The Websites page at `/reports/websites` shows real data from the server: sites ranked by active minutes, sorted by the classifier within an hour of first being seen, Bark left out, and on PCs the searches, private time and pages read from the titles. A parent can set a site's kind and category. Nothing is ever fetched from a site, and only a site's name ever goes to Cloudflare's family resolver.

## 3. Out of scope

- **No change to any web file except the seam part of `web/src/lib/sites.ts`** (section 5.7). The pages and components are Claude's (AGENTS.md rule 10): a problem there goes under "Blockers / questions".
- No Android, Windows or parent-app change, except the files `pnpm contract` regenerates.
- No alerts, no blocking, no emails, no fetching of web pages, no new kid-app behaviour (Bark stays in the uploads).
- Production configuration and the deploy are Claude's: you add the settings to `deploy/docker-compose.yml` and `deploy/.env.example` only.
- **No new library** (`tldts` and Node's own `dns` and `fetch` are enough). Never commit secrets. Do not edit generated files by hand: run `pnpm contract`.
- **Never start, stop or restart a container on the Unraid server**, the vLLM ones above all. If the vLLM does not answer, write `NOT RUN` with the error and ask.

## 4. Tech and traps

- **Migration.** The last one is `0016_site_titles.sql`, so yours is `server/drizzle/0017_site_classes.sql` (see the `db-migration` skill): the two new columns, `site_classes` (no RLS, no `family_id`: it is shared) and `site_overrides` (RLS with the `family_isolation` policy, copying `0016`). `screentime_app` already gets rights on new tables by default privileges (`0002_rls.sql`).
- **The server's clock.** Every server test uses Vitest's fake `Date` at `2026-11-12T00:00:00Z` (`vi.useFakeTimers({ toFake: ['Date'], now: ... })`, as `server/test/site-lookups.test.ts` does), and the test family's time zone is `Australia/Sydney` (UTC+11 in November). Never the real now.
- **Report helpers.** `server/src/reports/apps.ts` already has the kid, period, today, instants and device-list logic as private functions. Export and reuse them (or move them to a shared file in `server/src/reports/`); do not copy them. The Apps report's tests must still pass unchanged.
- **Inject what talks to the outside.** The classifier takes its `fetch` and its family-resolver lookup as arguments, so tests pass fakes and nothing in `pnpm test` reaches the network. Node's resolver: `new dns.promises.Resolver({ timeout: 5000, tries: 1 })`, `setServers([familyDns])`, `resolve4(name)`.
- **Long calls never inside a transaction.** Read the candidates in short `withFamily` transactions, call the LLM outside any transaction, then write `site_classes` (a plain `db` call: the table has no RLS).
- **The LLM answer is untrusted.** Parse `choices[0].message.content` as JSON and check it with a zod schema; ignore any `site` that was not asked.
- **Server tests skip without `TEST_DATABASE_URL`**: check yours ran (the totals show them).
- **Start-up work.** The backfill and the classifier timer start in `server/src/index.ts` next to `startSweeps`, never in `app.ts` (tests build the app without them).

## 5. Design (what to build)

### 5.1 Active minutes and the backfill

1. Migration: `site_lookups.site text` (nullable), `site_daily.minutes integer NOT NULL DEFAULT 0`.
2. `POST /v1/device/site-lookups` stores `site` (`getDomain(host) ?? host`, as it already computes for `site_daily`) on each new raw row. After the `site_daily` upserts, for each distinct (`device_id`, `day`, `site`, `package`) touched by **new** rows, in the same transaction: set `minutes` = the number of distinct `date_trunc('minute', at)` among `site_lookups` rows with that device, site and package and `at` from that local day's midnight to the next (through the family's zone, as `localDay` does). Never add 1 per row.
3. `backfillSites(db)` in `server/src/sites/backfill.ts`: (a) for every `site_lookups` row with `site` null, set it from its host; (b) for every `site_daily` row that has at least one raw row (same device, site, package, local day), set `minutes` as in 2. Rows with no raw rows are not touched. Returns `{ filled, recounted }`; a second run returns `{ filled: 0, recounted: <same rows> }` and changes no value. It runs over every family (it works as the database owner, like the sweep's family loop or outside RLS; your choice).
4. `server/src/index.ts` runs `backfillSites` once at start in the background and logs `sites: backfill filled <filled> rows, recounted <recounted> days` when `filled` > 0; a failure is logged and the API carries on.
5. `server/scripts/backfill-sites.ts` runs it against `DATABASE_URL` and prints the same line.

### 5.2 Tables

- **`site_classes`**: `site text` primary key, `kind text`, `category text` (null until sorted), `owner text`, `label text`, `confidence real`, `family_dns_blocked boolean NOT NULL DEFAULT false`, `model text`, `attempts integer NOT NULL DEFAULT 0`, `classified_at timestamptz`.
- **`site_overrides`**: `family_id uuid` (FK families), `site text`, `kind text NOT NULL`, `category text NOT NULL`, `parent_id uuid` (FK parents), `set_at timestamptz NOT NULL DEFAULT now()`; PK (`family_id`, `site`); RLS `family_isolation`.

### 5.3 Shared constants (`server/src/sites/packages.ts`)

- `ECHO_PACKAGES`: `['com.pt.bark']`.
- `BROWSER_PACKAGES`: `com.android.chrome`, `org.mozilla.firefox`, `com.brave.browser`, `com.microsoft.emmx`, `com.sec.android.app.sbrowser`, `com.mi.globalbrowser`, `com.opera.browser`, `com.duckduckgo.mobile.android`, `msedge.exe`, `chrome.exe`, `brave.exe`, `firefox.exe`.
- `SITE_KINDS` and `SITE_CATEGORIES` come from the schemas (section 5.6), not a second list.

### 5.4 The classifier (`server/src/sites/classify.ts`)

- **Config** (`server/src/config.ts`, tested in `config.test.ts`): `classifier: { url, model, familyDns } | null`. `CLASSIFIER_URL` unset or empty → `null`. `CLASSIFIER_MODEL` default `Qwen3.8-27B`. `CLASSIFIER_FAMILY_DNS` default `1.1.1.3`; set but empty → `familyDns` null (no check). A trailing `/` on the URL is taken off.
- **`classifyPending(deps, io)`** with `io = { fetch, resolve4 }`, one run, returning `{ status: 'off' | 'nothing' | 'done' | 'unavailable' | 'bad_answer', asked: number, stored: number, blocked: number }`:
  1. Config null → `off`, no call.
  2. **Candidates**: sites in `site_daily` of every family not disabled, `package` not in `ECHO_PACKAGES`, whose `site_classes` row is missing or has `kind` null and `attempts` < 3. Lookups summed over all families; most first, then by site; at most 200. None → `nothing`.
  3. For each candidate: `hosts`, up to 5 distinct hosts of `site_lookups` rows with that `site`, package not echo, most rows first then by host; `apps`, up to 5 packages of its `site_daily` rows, echo left out, most lookups first then by package.
  4. In requests of 50 (in candidate order): `POST {url}/chat/completions`, header `content-type: application/json`, body exactly:
     `{ model, temperature: 0, max_tokens: 8192, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_schema', json_schema: { name: 'site_classes', strict: true, schema: <the schema below> } }, messages: [ { role: 'system', content: <the prompt below> }, { role: 'user', content: JSON.stringify(items) } ] }` where `items` = `[{ site, hosts, apps }]`. Time-out 120 s (`AbortSignal.timeout`).
  5. A rejected fetch, a time-out or an HTTP status other than 200 → stop at once, `unavailable`, log `classifier: unavailable (<reason>)`, change nothing for that request (earlier requests of the run stay stored).
  6. Content that is not JSON or breaks the answer schema → stop, `bad_answer`, log `classifier: bad answer (<reason>)`, and add 1 to `attempts` of every site of that request (insert the row with `kind` null when missing).
  7. Otherwise, for each asked site: a result → upsert `kind`, `category`, `owner` (only when `kind` is `cdn` or `app_service`, else null), `label` (null when longer than 80 characters), `confidence` (clamped 0 to 1), `model`, `classified_at` now, `attempts` + 1. No result → `attempts` + 1; when that makes 3: `kind` `unknown`, `category` `other`, `confidence` 0, `owner` and `label` null, `model`, `classified_at` now. Results for sites not asked are ignored.
  8. **Family filter** (when `familyDns` is set): for each site stored in step 7 (a result or the third miss) with `kind` `unknown` or `confidence` < 0.6, call `resolve4(site)`; when it gives no addresses or fails with "no data" / "not found", `resolve4(<its first host>)`. Any answer `0.0.0.0` → `family_dns_blocked` true, `kind` `website`, `category` `adult`. Any other outcome changes nothing. A site at 0.6 or more is never looked up.
  9. Log `classifier: <stored> sites sorted (<blocked> blocked by the family filter)`.
- **`startClassifier(deps, everyMs = 3_600_000)`** (like `startSweeps`): first run after 60 s, then every `everyMs`, never two at once, a failure logged; does nothing but log `classifier: off` when the config is null. Returns a stop function. Called from `index.ts`.

**The answer schema** (the `schema` in `json_schema`; build it from the zod enums or write it out, but the result must be this):

```json
{ "type": "object", "additionalProperties": false, "required": ["sites"],
  "properties": { "sites": { "type": "array", "items": { "type": "object", "additionalProperties": false,
    "required": ["site", "kind", "category", "owner", "label", "confidence"],
    "properties": {
      "site": { "type": "string" },
      "kind": { "enum": ["website", "cdn", "ads_tracking", "app_service", "unknown"] },
      "category": { "enum": ["social", "video", "games", "chat", "search", "education", "shopping", "news", "adult", "gambling", "violence_weapons", "drugs", "self_harm", "other"] },
      "owner": { "type": ["string", "null"] },
      "label": { "type": ["string", "null"] },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 } } } } } }
```

**The system prompt** (exported as `CLASSIFIER_PROMPT`; Claude tried it on 21 Nov 2026: 27 real sites, 5.5 s, all sensible). The category list in it is the 14 categories joined with `", "`:

```text
You sort internet domains for a parent's report of what their children's devices looked up.
For each input item (a registrable domain, some full hostnames seen under it, and the apps that looked it up) return exactly one result with the same "site".
kind: "website" = a site a person opens and reads or uses (including web apps and games played in a browser); "cdn" = serves files, images or video for another site or app; "ads_tracking" = advertising, analytics, tracking, telemetry; "app_service" = an API or backend an app or the operating system talks to, not opened by a person; "unknown" = you do not recognise the domain and cannot tell from its name.
category: what the site, or the site it serves, is about: social, video, games, chat, search, education, shopping, news, adult, gambling, violence_weapons, drugs, self_harm, other. Use "other" when none fits. For unknown, use "other".
owner: for cdn and app_service, the registrable domain of the site or company it serves (e.g. fbcdn.net -> facebook.com), else null.
label: the site's usual name ("Khan Academy"), or null if unsure.
confidence: 0 to 1, how sure you are of kind and category. Never guess a well-known name for a domain you do not recognise.
```

### 5.5 Title rules (`server/src/reports/titles.ts`)

`parseTitle(pkg: string, title: string) → { page: string | null; private: boolean; search: { engine: 'google' | 'bing' | 'duckduckgo'; query: string } | null }`, a pure function, exactly as SPEC §12.10 "Title rules" (steps 1 to 5). The package compares in lower case. A query longer than 200 characters is cut to 200 (then trimmed). The page is kept as it is (not lower-cased).

### 5.6 Schemas and routes

- `packages/schemas/src/sites.ts` (exported from `index.ts`, each with `.meta({ id })`): `SiteKind`, `SiteCategory`, `SiteClassSource` (`classifier`, `family_dns`, `parent`), `SearchEngine`, `SiteReportQuery` (as `AppReportQuery`), `SiteReportDevice`, `SiteReportApp`, `SiteReportSite`, `SiteReportCategory`, `SiteReportSearch`, `SiteReportPage`, `SiteReport`, `SiteClassOverride` (`kind`: the four kinds without `unknown`; `category`), `SiteClassSaved` (`site`, `kind`, `category`). **Field names, types and nullability exactly as the interfaces in `web/src/lib/sites.ts`** (Claude's seam) and SPEC §12.10; minutes and counts are integers ≥ 0, times ISO datetimes, dates `LocalDate`.
- **`buildSiteReport(tx, query)`** in `server/src/reports/sites.ts`: the only place the report is worked out (the route and the dev script call it), exactly as SPEC §12.10 "The API". Route `GET /v1/reports/sites` in `server/src/reports/routes.ts` (`requireFamilyParent`, `withFamily`), in the OpenAPI document.
- **`PUT /v1/sites/{site}/class`** and **`DELETE /v1/sites/{site}/class`** (`requireFamilyParent`) in `server/src/sites/routes.ts`: `site` checked with the host rule of `SiteLookupIn` (422 otherwise); PUT upserts `site_overrides` with the parent's id and answers `200 SiteClassSaved`; DELETE deletes and answers 204.

### 5.7 The web seam (`web/src/lib/sites.ts`, the seam part only)

Replace the local types with re-exports from `@screentime/schemas` (same names; keep the local `SiteReportQuery` interface, as `lib/reports.ts` keeps `AppReportQuery`). `fetchSiteReport` → `api.get<SiteReport>('/v1/reports/sites?kidId=…&period=…&date=…[&deviceId=…]')` (as `fetchAppReport` builds it); `setSiteClass` → `api.put(\`/v1/sites/${encodeURIComponent(site)}/class\`, override)`; `clearSiteClass` → `api.delete(...)`. Delete the fake (`fakeOverrides`, `FakeSite`, the `FAKE_*` lists, `hash`, `fakeReport`, `FAKE_DEVICES`) and nothing else: `categoryTotals` and every helper stay. `web/test/sites.test.ts` must pass **unchanged**.

### 5.8 Dev scripts and deploy files

- `server/scripts/dev-site-report.ts <kid name> <day|week|month> [YYYY-MM-DD] [device name]`: prints `buildSiteReport`'s JSON, like `dev-report.ts`.
- `server/scripts/dev-classify.ts`: with no argument, one `classifyPending` run against `DATABASE_URL` and the `CLASSIFIER_*` settings, printing the status line and then every `site_classes` row it changed as `site | kind | category | owner | label | confidence | family_dns_blocked`. With `--sample`: sends the 27 sites of section 6 fixture V (one request, the same body; nothing stored) and prints each answer as `site | kind | category | owner | ok|MISS`, then `score: <k>/27 kinds, <c>/27 categories`. With `--dns <name>...`: resolves each name at `CLASSIFIER_FAMILY_DNS` and prints `<name> blocked` or `<name> not blocked`.
- `deploy/docker-compose.yml` (api service) and `deploy/.env.example`: `CLASSIFIER_URL: ${CLASSIFIER_URL:-}`, `CLASSIFIER_MODEL: ${CLASSIFIER_MODEL:-Qwen3.8-27B}`, `CLASSIFIER_FAMILY_DNS: ${CLASSIFIER_FAMILY_DNS-1.1.1.3}` (no colon: an empty value turns it off); `.env.example` with `CLASSIFIER_URL=` empty and a comment.

## 6. Acceptance criteria

Every criterion is a test with these fixed inputs, unless it says otherwise. Claude re-checks each one. Fake `Date` `2026-11-12T00:00:00Z`; family A's time zone `Australia/Sydney` (its today is `2026-11-12`).

**Fixture S** (family A, kid **Sam**). Devices in this enrolment order: **P** (Android phone "Phone"), **W** (Windows PC "PC"), **T** (Android tablet "Tablet"). `device_apps` on P: `com.android.chrome` "Chrome", `com.google.android.youtube` "YouTube". `device_programs` on W: `msedge.exe` "Microsoft Edge". Lookups, posted with each device's token:

| # | device | at | host | package |
|---|---|---|---|---|
| L1 | P | 2026-11-10T01:00:05Z | www.khanacademy.org | com.android.chrome |
| L2 | P | 2026-11-10T01:00:30Z | khanacademy.org | com.android.chrome |
| L3 | P | 2026-11-10T01:00:40Z | cdn.kastatic.org | com.android.chrome |
| L4 | P | 2026-11-10T01:00:50Z | www.khanacademy.org | com.pt.bark |
| L5 | P | 2026-11-10T01:01:10Z | www.khanacademy.org | com.android.chrome |
| L6 | P | 2026-11-10T01:02:00Z | api.bark.us | com.pt.bark |
| L7 | P | 2026-11-10T01:05:00Z | khanacademy.org | com.android.chrome |
| L8 | P | 2026-11-10T12:59:30Z | www.youtube.com | com.google.android.youtube |
| L9 | P | 2026-11-10T13:00:30Z | www.youtube.com | com.google.android.youtube |
| L10 | P | 2026-11-10T13:00:45Z | rr3---sn-x.googlevideo.com | com.google.android.youtube |
| L11 | W | 2026-11-11T02:00:00Z | www.khanacademy.org | msedge.exe |
| L12 | W | 2026-11-11T02:00:20Z | www.sportsbet.com.au | msedge.exe |
| L13 | T | 2026-11-10T03:00:00Z | www.roblox.com | com.roblox.client |

P posts two calls: first L1, L3, L5, L8, L9, L10; then L2, L4, L6, L7. W posts L11, L12; T posts L13, then T is removed (`revoked_at` `2026-11-11T00:00:00Z`, set straight in the table). (L8 is 23:59:30 on 10 Nov in Sydney; L9 is 00:00:30 on 11 Nov.)

**Classes** (inserted straight into `site_classes` for the report tests, `attempts` 1): `khanacademy.org` website / education, label "Khan Academy", 0.99; `kastatic.org` cdn / education, owner `khanacademy.org`; `googlevideo.com` cdn / video, owner `youtube.com`; `sportsbet.com.au` website / gambling, label "Sportsbet"; `roblox.com` website / adult, `family_dns_blocked` true (a test value only). No row for `youtube.com`.

**Titles of W** (inserted straight into `site_titles`):

| # | at | sec | package | title |
|---|---|---|---|---|
| T1 | 2026-11-11T02:00:00Z | 42 | msedge.exe | how to draw - Search and 2 more pages - [InPrivate] - Microsoft Edge |
| T2 | 2026-11-11T02:00:42Z | 20 | msedge.exe | how to draw - Search - [InPrivate] - Microsoft Edge |
| T3 | 2026-11-11T02:01:10Z | 300 | msedge.exe | Wikipedia - Profile 1 - Microsoft Edge |
| T4 | 2026-11-11T02:06:10Z | 30 | msedge.exe | New tab - Profile 1 - Microsoft Edge |
| T5 | 2026-11-11T02:07:00Z | 15 | firefox.exe | Wikipedia — Mozilla Firefox Private Browsing |
| T6 | 2026-11-11T02:08:00Z | 50 | chrome.exe | fortnite skins - Google Search - Google Chrome |
| T7 | 2026-11-11T02:09:00Z | 10 | chrome.exe | How To Draw - Google Search - Google Chrome |
| T8 | 2026-11-11T02:10:00Z | 5 | msedge.exe | HOW TO DRAW - Search - Microsoft Edge |

**Active minutes** (`server/test/site-minutes.test.ts`)

1. Migration `0017_site_classes.sql`: `site_lookups.site` and `site_daily.minutes` exist; `site_classes` has no RLS; `site_overrides` has its primary key and `family_isolation` in `pg_policies`.
2. After P's **first** call: `site_daily` (P, `2026-11-10`, `khanacademy.org`, `com.android.chrome`) has `lookups` 2, `minutes` 2. After the second call: `lookups` 4, `minutes` **3** (L2 shares L1's minute). Every raw row of fixture S has `site` set (`www.khanacademy.org` → `khanacademy.org`, `rr3---sn-x.googlevideo.com` → `googlevideo.com`).
3. After all uploads, `site_daily` is exactly these 10 rows (device, day, site, package, lookups, minutes): P 2026-11-10 khanacademy.org com.android.chrome 4 3; P 2026-11-10 khanacademy.org com.pt.bark 1 1; P 2026-11-10 kastatic.org com.android.chrome 1 1; P 2026-11-10 bark.us com.pt.bark 1 1; P 2026-11-10 youtube.com com.google.android.youtube 1 1; P 2026-11-11 youtube.com com.google.android.youtube 1 1; P 2026-11-11 googlevideo.com com.google.android.youtube 1 1; W 2026-11-11 khanacademy.org msedge.exe 1 1; W 2026-11-11 sportsbet.com.au msedge.exe 1 1; T 2026-11-10 roblox.com com.roblox.client 1 1.
4. Backfill: with raw rows L1, L2, L5, L7 inserted straight in with `site` null, a `site_daily` row (P, 2026-11-10, khanacademy.org, com.android.chrome, `lookups` 4, `minutes` 0) and a row (P, 2026-08-01, khanacademy.org, com.android.chrome, `lookups` 9, `minutes` 0) with no raw rows: `backfillSites` → `filled` 4, all four rows' `site` = `khanacademy.org`, the first row's `minutes` 3, the August row still 0. A second run → `filled` 0 and the same values.

**Title rules** (`server/test/titles.test.ts`, no database). Each `parseTitle(package, title)` → `{ page, private, search }`:

5. Edge: `Wikipedia - Profile 1 - Microsoft Edge` → `Wikipedia`, false, null. `Example Domain and 1 more page - Profile 1 - Microsoft Edge` → `Example Domain`, false, null. `how to draw - Search and 2 more pages - [InPrivate] - Microsoft Edge` → `how to draw - Search`, true, bing `how to draw`. `minecraft cheats - Search and 1 more page - [InPrivate] - Microsoft Edge` → `minecraft cheats - Search`, true, bing `minecraft cheats`. `Wikipedia - [InPrivate] - Microsoft Edge` → `Wikipedia`, true, null. `Rock - Paper - Scissors - Personal - Microsoft Edge` → `Rock - Paper - Scissors`, false, null. `Shop - Work - Microsoft Edge` → `Shop`. `HOW TO DRAW - Search - Microsoft Edge` → bing `HOW TO DRAW`. `New tab - Profile 1 - Microsoft Edge` → null, false, null. `Microsoft Edge` → null, false, null.
6. Others: chrome.exe `fortnite skins - Google Search - Google Chrome` → `fortnite skins - Google Search`, false, google `fortnite skins`; chrome.exe `Roblox - Google Chrome (Incognito)` → `Roblox`, true, null; brave.exe `cats at DuckDuckGo - Brave` → duckduckgo `cats`, false; brave.exe `Roblox - Brave (Private)` → `Roblox`, true; firefox.exe `Wikipedia — Mozilla Firefox Private Browsing` → `Wikipedia`, true; firefox.exe `Wikipedia — Mozilla Firefox` and `Wikipedia - Mozilla Firefox` → `Wikipedia`, false; `CHROME.EXE` `x - Google Chrome` → `x`; notepad.exe `Untitled - Notepad` → `Untitled - Notepad`, false, null; chrome.exe 250 × `a` + ` - Google Search - Google Chrome` → google, a query of 200 `a`.

**The report** (`server/test/site-report.test.ts`, fixture S with the classes and titles)

7. Week, `date` `2026-11-11`, All devices: `from` `2026-11-09`, `to` `2026-11-15`, `today` `2026-11-12`, `titlesKeptFrom` `2026-08-15`. `devices` = P, W, T in that order, all `sitesRecorded` true, T's `removedAt` `2026-11-11T00:00:00.000Z`.
8. Same report, `sites` exactly, in order:
   - `khanacademy.org`: label "Khan Academy", website, education, source `classifier`, owner null, `minutes` 4, `lookups` 5 (Bark's L4 left out), `days` 2, `firstAt` `2026-11-10T01:00:05.000Z`, `lastAt` `2026-11-11T02:00:00.000Z`, `apps` [Chrome `com.android.chrome` browser true 3, Microsoft Edge `msedge.exe` browser true 1], `devices` [P 3, W 1];
   - `youtube.com`: label null, kind null, category null, source null, `minutes` 2, `lookups` 2, `days` 2, `firstAt` `2026-11-10T12:59:30.000Z`, `lastAt` `2026-11-10T13:00:30.000Z`, `apps` [YouTube `com.google.android.youtube` browser false 2], `devices` [P 2];
   - `roblox.com`: website, adult, source `family_dns`, `minutes` 1, `apps` [`com.roblox.client` label `com.roblox.client` browser false 1], `devices` [T 1];
   - `sportsbet.com.au`: label "Sportsbet", website, gambling, source `classifier`, `minutes` 1, `devices` [W 1].
   No `bark.us` anywhere.
9. Same report: `behindTheScenes` = `googlevideo.com` (cdn, owner `youtube.com`, minutes 1) then `kastatic.org` (cdn, owner `khanacademy.org`, minutes 1). `categories` = [education 4 / 1, null 2 / 1, adult 1 / 1, gambling 1 / 1].
10. Same report, titles: `browserSec` 472, `privateSec` 77; `searches` = [google `How To Draw` 10 false firstAt `2026-11-11T02:09:00.000Z` W; google `fortnite skins` 50 false `2026-11-11T02:08:00.000Z` W; bing `how to draw` 67 **true** `2026-11-11T02:00:00.000Z` W]; `pages` = [`Wikipedia` msedge.exe 300 false; `Wikipedia` firefox.exe 15 true].
11. Day `2026-11-10`, All devices: `sites` = khanacademy.org (minutes 3, lookups 4, days 1, `lastAt` `2026-11-10T01:05:00.000Z`, devices [P 3]), roblox.com (1), youtube.com (1, lookups 1); `behindTheScenes` = kastatic.org only; `browserSec` 0, `searches` [], `pages` []. `devices` still P, W, T.
12. Week, `deviceId` W: `sites` = khanacademy.org (minutes 1, apps [Microsoft Edge 1], devices [W 1]) and sportsbet.com.au; `behindTheScenes` []; titles as in criterion 10; `devices` still P, W, T. `deviceId` P: `browserSec` 0 and no searches or pages.
13. Empty and errors: week of `2026-10-26` → `sites`, `behindTheScenes`, `categories`, `searches`, `pages` all `[]`, `browserSec` and `privateSec` 0, `devices` P and W only (T is removed and has nothing then). A kid with no devices → 200 with every list empty. `date` `2026-11-13` → 422; `date` `2026-02-30` → 422; a `deviceId` of another kid → 404; a kid of family B → 404; no token → 401.

**A parent's own class** (`server/test/site-report.test.ts`)

14. `PUT /v1/sites/youtube.com/class` `{ kind: "website", category: "video" }` as a parent of A → 200 `{ site: "youtube.com", kind: "website", category: "video" }`; the row has that parent's id. The week report then has youtube.com with source `parent`, website, video, and `categories` [education 4, video 2, adult 1, gambling 1]. A PUT with `category: "social"` replaces it (one row). `DELETE` → 204 and youtube.com is back to null; `DELETE` again → 204.
15. 422 for each: site `not a site!`, site `-bad.com`, `kind: "unknown"`, `category: "porn"`. A device token → 401. Family B's parent sets youtube.com → family A's report still shows null for it.

**The classifier** (`server/test/classifier.test.ts`, fixture S without classes; family B has one device with one lookup, 2026-11-10T05:00:00Z `www.abc.net.au` `com.android.chrome`; a fake `fetch` that records each request and answers what each test says; a fake `resolve4` that records names)

16. The first request goes to `http://llm.test/v1/chat/completions` (config URL `http://llm.test/v1/`) with exactly the body of section 5.4 (`messages[0].content` === `CLASSIFIER_PROMPT`), and its `items` are, in order: `khanacademy.org` (hosts [`www.khanacademy.org`, `khanacademy.org`], apps [`com.android.chrome`, `msedge.exe`]), `youtube.com` (hosts [`www.youtube.com`], apps [`com.google.android.youtube`]), `abc.net.au`, `googlevideo.com`, `kastatic.org`, `roblox.com`, `sportsbet.com.au`. `bark.us` is not asked.
17. Answer: khanacademy.org website/education/owner null/"Khan Academy"/0.99; youtube.com website/video/owner `google.com`/"YouTube"/0.99; abc.net.au website/news/null/"ABC"/**0.5**; googlevideo.com cdn/video/`youtube.com`/null/0.95; kastatic.org cdn/education/`khanacademy.org`/null/0.95; roblox.com website/games/null/"Roblox"/0.99; plus `evil.example` website/adult (not asked); **no** sportsbet.com.au. `resolve4` answers `abc.net.au` with `203.2.218.214`. → status `done`, `stored` 6; rows for the six with `attempts` 1, `model` `Qwen3.8-27B`, `classified_at` `2026-11-12T00:00:00.000Z`; youtube.com's `owner` null; abc.net.au still news, not blocked; sportsbet.com.au has a row with `kind` null and `attempts` 1; no `evil.example` row; `resolve4` was called with `abc.net.au` only.
18. Then two more runs, each answering `{ "sites": [] }`: each asks only `sportsbet.com.au`; after the first `attempts` is 2 and `kind` null; after the second (attempts 3) it is `unknown` / `other` / confidence 0, and `resolve4` is called with `sportsbet.com.au` (answer: no addresses) and then `www.sportsbet.com.au` (answer `0.0.0.0`) → `family_dns_blocked` true, `kind` `website`, `category` `adult`, `blocked` 1. A fourth run → status `nothing`, no request.
19. Unavailable: `fetch` rejects (`TypeError: fetch failed`) → `unavailable`, no row in `site_classes`. `fetch` answers HTTP 503 → the same. Bad answer: content `not json` → `bad_answer`, a row for each of the 7 asked sites with `kind` null and `attempts` 1; content `{"sites":[{"site":"youtube.com","kind":"porn",...}]}` → the same.
20. Batches: with 120 extra sites (`s001.example` … `s120.example`, one `site_daily` row each on P, `lookups` 1) and fixture S's 7, a run makes 3 requests of 50, 50 and 27 items (each answered with `{ "sites": [] }`). With 250 extra sites instead (`s001.example` … `s250.example`) → 4 requests of 50: the 200 asked are `khanacademy.org`, `youtube.com`, then the sites with 1 lookup by name (`abc.net.au`, `googlevideo.com`, `kastatic.org`, `roblox.com`, `s001.example` … `s194.example`); `s195.example` … `s250.example` and `sportsbet.com.au` (57 sites) are not asked.
21. Off: config `classifier` null → status `off` and the fake `fetch` never called. With `familyDns` null, a site at 0.1 is stored and `resolve4` is never called.
22. Config (`config.test.ts`): no `CLASSIFIER_URL` → `classifier` null; `CLASSIFIER_URL=http://x/v1/` → url `http://x/v1`, model `Qwen3.8-27B`, familyDns `1.1.1.3`; `CLASSIFIER_FAMILY_DNS=` (empty) → familyDns null.

**Break it yourself** (paste each result)

23. One at a time, change the line, run the named test file, paste the failing test, restore with `git checkout -- <file>`:
    - upload: set `minutes` to the number of raw rows instead of distinct minutes → criterion 2 fails;
    - upload: count minutes over the UTC day instead of the family's local day → criterion 3 fails;
    - report: drop the echo-package filter → criterion 8 fails;
    - `parseTitle`: skip step 3 (" and N more pages") → criterion 5 fails;
    - classifier: no extra attempt for a site missing from the answer → criterion 18 fails;
    - classifier: look up every stored site at the family resolver, not only unknown or below 0.6 → criterion 17 fails.

**Against the real model and resolver** (not unit tests; paste the real output)

24. `curl.exe -s http://192.168.0.148:8686/v1/models` lists `Qwen3.8-27B`. (Anything else, or no answer: `NOT RUN` with the output, and ask. **Never start a container.**) Then `dev-classify.ts --sample` with `CLASSIFIER_URL=http://192.168.0.148:8686/v1` prints all 27 lines and a score of at least **24/27 kinds** and **22/27 categories** against fixture V.
25. `dev-classify.ts --dns nudity.testcategory.com malware.testcategory.com khanacademy.org` prints `blocked`, `blocked`, `not blocked`.
26. On the development database (after `pnpm dev:server` once, so the backfill ran): `dev-classify.ts` with the real model, then `dev-site-report.ts <a kid with website rows> week <a date with rows>`. Paste both outputs; Claude compares them with the database.

**Fixture V** (the 27 sites for `--sample`: site, hosts, apps → accepted kinds / accepted categories):

| site | hosts | apps | kind | category |
|---|---|---|---|---|
| khanacademy.org | www.khanacademy.org, cdn.kastatic.org | com.android.chrome | website | education |
| kastatic.org | cdn.kastatic.org | com.android.chrome | cdn | education |
| roblox.com | www.roblox.com, apis.roblox.com | com.roblox.client | website, app_service | games |
| rbxcdn.com | tr.rbxcdn.com | com.roblox.client | cdn | games |
| youtube.com | www.youtube.com, m.youtube.com | com.google.android.youtube, com.android.chrome | website | video |
| googlevideo.com | rr3---sn-ntqe6n76.googlevideo.com | com.google.android.youtube | cdn | video |
| ytimg.com | i.ytimg.com | com.android.chrome | cdn | video |
| doubleclick.net | googleads.g.doubleclick.net | com.android.chrome | ads_tracking | other |
| facebook.net | connect.facebook.net | com.android.chrome | ads_tracking, app_service | social, other |
| fbcdn.net | scontent.xx.fbcdn.net | com.android.chrome | cdn | social |
| tiktok.com | www.tiktok.com | com.android.chrome | website | video, social |
| discord.com | discord.com, gateway.discord.gg | msedge.exe | website | chat |
| coolmathgames.com | www.coolmathgames.com | msedge.exe | website | games |
| crazygames.com | www.crazygames.com | com.android.chrome | website | games |
| abc.net.au | www.abc.net.au | com.android.chrome | website | news |
| wikipedia.org | en.wikipedia.org | msedge.exe | website | education |
| bing.com | www.bing.com | msedge.exe | website | search |
| amazon.com.au | www.amazon.com.au | com.android.chrome | website | shopping |
| sportsbet.com.au | www.sportsbet.com.au | com.android.chrome | website | gambling |
| xiaomi.net | api.sec.miui.com, data.mistat.xiaomi.net | com.miui.securitycenter | app_service, ads_tracking | other |
| googleapis.com | play.googleapis.com, fonts.googleapis.com | com.android.vending, com.android.chrome | app_service, cdn | other |
| zlkj7q.xyz | zlkj7q.xyz | com.android.chrome | unknown | other |
| omegle.com | www.omegle.com | com.android.chrome | website | chat |
| reddit.com | www.reddit.com | com.android.chrome | website | social |
| redd.it | i.redd.it | com.android.chrome | cdn | social |
| scorecardresearch.com | sb.scorecardresearch.com | com.android.chrome | ads_tracking | other |
| bark.us | api.bark.us | com.pt.bark | app_service | other |

**General**

27. `pnpm contract` then `git status --short contract android/core-model windows/src/ScreenTime.Core/Api` prints nothing; `pnpm typecheck`, `pnpm test` (with `TEST_DATABASE_URL`), `cd windows; dotnet build; cd ..` and `.\gradlew.bat assembleDebug` pass; CI is green.
28. `git diff --name-only main -- web android/app-kid/src android/app-parent/src windows/src/ScreenTime.Service windows/src/ScreenTime.Tray packages/engine` prints only `web/src/lib/sites.ts` (plus generated client files, if any are under these paths).

## 7. Tests you write

- `server/test/site-minutes.test.ts` (new): criteria 1 to 4.
- `server/test/titles.test.ts` (new): criteria 5 and 6.
- `server/test/site-report.test.ts` (new): criteria 7 to 15.
- `server/test/classifier.test.ts` (new): criteria 16 to 21; `server/test/config.test.ts`: criterion 22, added.
- Keep every existing test unchanged, `web/test/sites.test.ts` and `server/test/reports.test.ts` included. **Changing what an existing test checks is a deviation: list it.** Each new test must fail if the behaviour it names breaks (see the `card-tests` skill). If you cannot make a criterion pass, leave its test as the card says, failing, and ask under "Blockers / questions".

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
cd windows; dotnet build; cd ..
cd android; $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; .\gradlew.bat assembleDebug; .\gradlew.bat --stop; cd ..
git diff --name-only main -- web android/app-kid/src android/app-parent/src windows/src/ScreenTime.Service windows/src/ScreenTime.Tray packages/engine
```

(The `create database` line fails harmlessly when it exists.) Paste the **real totals** each test runner prints, not a sum you work out.

### 8.2 The real model and resolver (criteria 24 to 26)

```powershell
curl.exe -s http://192.168.0.148:8686/v1/models
$env:CLASSIFIER_URL = "http://192.168.0.148:8686/v1"
$env:DATABASE_URL = "postgres://screentime:$pw@localhost:5432/screentime"
pnpm --filter @screentime/server exec tsx scripts/dev-classify.ts --sample
pnpm --filter @screentime/server exec tsx scripts/dev-classify.ts --dns nudity.testcategory.com malware.testcategory.com khanacademy.org
pnpm --filter @screentime/server exec tsx scripts/dev-classify.ts
pnpm --filter @screentime/server exec tsx scripts/dev-site-report.ts <kid> week <YYYY-MM-DD>
```

The model is shared with you (it is the model you run on): one `--sample` call takes about 6 s. Run `--sample` **once**; if the score is under the bar, paste it and ask rather than tuning the prompt (the prompt is fixed by this card). The development database is the one in `deploy/.env`, never production.

## 9. Git and pull request

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-070-websites-report`.
2. Small logical commits: `CARD-070: <what changed>`.
3. Run 8.1 again before pushing. Push: `git push -u origin bob/card-070-websites-report`. Wait for CI.
4. Run `/review-card 070` and fix what it finds.
5. Open a PR into `main` titled `CARD-070: Websites, the classifier and the report`, body in `C:\Users\james\OpenCode\Testing\temp\` with the sections Card, What I did, Acceptance criteria (each with its test name or output), Deviations, Blockers / questions.
6. **Do not merge.** Do not push to `main`.
7. `/handback 070` for the handback (section 11).

## 10. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, commit what works, and write the problem under "Blockers / questions". A web page that looks wrong with real data is Claude's to fix: describe it, do not change it.

## 11. Handback report (required)

Your **last message to James** is the handback in one fenced block. Every command shows the **real** output you saw; anything not run is `NOT RUN: <reason>`; test totals are as the runner printed them; every workaround and every changed existing test is a deviation.

````text
Claude, here is Bob's handback for CARD-070. Please review and merge if it is good.

CARD: CARD-070 Websites, the classifier and the report
PR: <full PR URL>
Branch: bob/card-070-websites-report
Head commit: <git rev-parse HEAD>

Files changed (git diff --name-only main...HEAD):
<list>

Commands run, with real output:
- <command> -> <key lines, or NOT RUN: reason>

Break it yourself (criterion 23), each change and the failing test:
- ...

Real model and resolver (criteria 24 to 26), the whole output of each command:
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
