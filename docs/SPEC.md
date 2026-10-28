# Screen Time: specification

Status: v1 draft for review, 22 Oct 2026. This file is the single source of truth for what we build. If a card, a PR or a comment disagrees with this file, this file wins until it is changed by a reviewed PR.

Philosophy: **keep it simple**. Build the smallest thing that meets the requirement, and prefer boring, well documented platform features over clever ones.

Markers used below:

- **[PENDING]** a decision we know we still need. Listed again in section 17.
- **[PROPOSED]** a detail the architect chose that James has not yet confirmed. (All v1 proposals were accepted on 22 Oct 2026.)

---

## Contents

1. Product summary
2. Household and devices (v1)
3. Requirements decisions (interview log Q1 to Q33)
4. System architecture
5. Repository layout
6. Data model
7. The time engine (shared maths)
8. Sync model
9. API surface
10. Push and WebSocket messages
11. Authentication and security
12. Enforcement per platform
13. Notifications
14. Tamper detection
15. SOS
16. UX and visual direction
17. Pending decisions
18. Future (not v1)

---

## 1. Product summary

A self-hosted parental screen-time limiter for one family (multi-tenant underneath, so other families could be added later).

- Each kid has two **pools** of time per day: **Screens** (tablets and PCs, shared) and **Phone**.
- **Kid devices** run an enforcer app that counts usage and locks the device when the pool is empty, at bedtime, or before wake-up. Enforcement happens on the device, so it keeps working offline.
- **Parents** use a web app and a basic Android parent app to see today's usage, add or remove time, answer requests, receive messages and SOS alerts, and edit schedules.
- A **server** on James's Unraid box (Docker, behind a Cloudflare Tunnel) holds the shared ledger and relays pushes.

Platforms in v1: Android kid app (one APK for phone and tablet), Windows 11 kid enforcer, Android parent app, parent web app. The REST API is platform agnostic so an iOS app can be added later.

## 2. Household and devices (v1)

| Person | Devices managed | Pools used |
|---|---|---|
| Daughter, 13 | Pixel 7 (phone), XPPen Magic Drawing Pad 12.2 (Android tablet), own Windows 11 PC | Phone (Pixel 7), Screens (tablet + PC) |
| Son, 11 | Own Windows 11 PC | Screens |
| James | Pixel 10, parent app | n/a |
| Partner | Galaxy S23+, parent app | n/a |

The daughter's school laptop is **not** managed.

XPPen tablet runs Android 14 (sets minSdk 34, see 12.1). Both kids' PCs run **Windows 11 Pro**. The XPPen tablet has Google Play services, so FCM push works on every Android device.

## 3. Requirements decisions (interview log)

These are James's answers from the requirements interview (22 Oct 2026). Section references show where each is specified in detail.

| # | Decision | Spec |
|---|---|---|
| Q1 | Each kid has two pools: **Screens** (tablets and PCs) and **Phone**. Device types must be extensible later. | 6, 7 |
| Q2 | When the phone is out of time it shows an undismissable blocker. From the blocker the kid can still call a whitelist, make emergency calls and SMS, and press SOS. | 12.1, 15 |
| Q3 | The parent app receives SOS as a critical alert. | 13, 15 |
| Q4 | All Android in v1. The REST API must be platform agnostic for a future iOS app. | 9 |
| Q5 | Push uses Firebase Cloud Messaging (approved). Android-only push is accepted for v1. Use the best free services. | 10, 13 |
| Q6 / Q9 | Android enforcer becomes **Device Owner via ADB**, with no factory wipe. | 12.1 |
| Q7 | Two warnings before lock, configurable (default 15 and 5 minutes). On a PC they are toasts. Windows **locks** at zero and never signs the kid out. | 7, 12.2 |
| Q8 | Parent adjustments apply to **today only**, can be plus or minus, are entered with a 15-minute-step roller, and have no cap. Bedtime always locks. After bedtime the kid can use only the time a parent grants after bedtime. Adjustments are per kid per pool. | 7 |
| Q10 | On Windows, enforcement is per **Windows user account** (each kid account maps to a kid). | 6, 12.2 |
| Q11 | Each Android device is dedicated to one kid. | 6 |
| Q12 | Offline first: each device enforces locally from a cached schedule. | 8 |
| Q13 / Q30 | No app allowlists in v1. | 18 |
| Q14 | Parent auth by email + one-time code. The parent phone app is unlocked with biometrics or PIN. A super admin is set by a Docker environment variable. Families contain parents and kids. Multi-tenant. | 6, 11 |
| Q15 | "Parent mode" on a kid device: the parent approves by push and picks 2 min, 5 min, 15 min, 1 h or indefinite, and the device is unlocked and not counting. If the kid device is offline, a rotating code from the parent app works instead. All parents are notified. | 12.3 |
| Q16 | Multi-family: v1 serves only James's family, but is multi-tenant from day one with strict per-family isolation (Postgres row-level security), so other families can be added later. Self sign-up and the 20-device sideload limit are later concerns. | 6, 11.4, 18 |
| Q17 | Each parent can opt out of non-essential notifications. Essential ones are always on: SOS, parent mode requests and "ask for more time" (James, 25 Oct 2026). | 13 |
| Q18 | Reporting in v1: time used and time remaining today, per kid per pool. | 16.4 |
| Q19 | Counting: a phone or tablet counts while the screen is on **and** unlocked. A PC counts while the kid is signed in **and** the session is unlocked. There is no idle pause. | 12 |
| Q20 | Tamper attempts show a cheesy "caught you" screen (kids are 11 and 13) and notify parents. | 14 |
| Q21 | Schedule is per kid, 7 days. Each day has a Screens allowance, a Phone allowance, a bedtime and a wake-up time. Allowances reset at midnight. | 6, 7 |
| Q22 | Enrolment: parent app "Add device" shows a QR code and a 6-digit code. | 11.3 |
| Q23 | Kid UI: on Android a persistent notification; on Windows a tray icon flyout. | 16 |
| Q24 | Kids cannot pause their own counting. The only pause is parent mode. | 12.3 |
| Q25 | "Ask for more time" from the kid UI and from the block screen, with an optional reason. | 12, 16 |
| Q26 | Using two devices of the same pool at the same time counts **once** (overlap is merged). | 7 |
| Q27 | Offline overspend is allowed, then reported to parents (flagged). No carry over. | 7, 8 |
| Q28 | Out of time looks and behaves the same as the bedtime lock. Call and SMS features exist only on devices with cellular. | 12.1 |
| Q29 | From the block screen the kid can message Mum/Dad: editable preset messages plus custom text up to 160 characters. | 12, 16 |
| Q31 | SOS: phone only, goes to all parents, triggered by press-and-hold then a 5-second countdown, sends SMS and a critical alert, shares live location every 30 s, parents can acknowledge, and the child or a parent can end it. | 15 |
| Q32 | A locked Windows PC has no buttons. The kid asks a parent in person (or from their phone). | 12.2 |
| Q33 | Each kid has an "always callable" contact list managed in the parent app. Calls use the phone's native dialer. | 12.1 |
| Future | School-hours blocks, a cooldown between time requests, app allowlists. | 18 |

Also decided in research (22 Oct 2026): the tech stack in section 4, the sync design in section 8, Device Owner with Lock Task for Android, and a LocalSystem service plus tray helper for Windows.

## 4. System architecture

```
                    Unraid (Docker)
             ┌────────────────────────────────┐
 Cloudflare  │  api container                  │
  Tunnel ────┤   Hono API  /v1/*  + WebSocket  │──── PostgreSQL 18 container
             │   static parent web app  /      │
             └──────────┬─────────────────────┘
                        │ firebase-admin
                        ▼
                Firebase Cloud Messaging ──► Android kid app, Android parent app

 Windows PC:  ScreenTime.Service (LocalSystem) ◄─named pipe─► ScreenTime.Tray (per kid session)
              └── REST + always-on WebSocket to the API
```

### 4.1 Tech stack (approved)

| Piece | Choice | Why |
|---|---|---|
| Android kid app + parent app | Kotlin, Jetpack Compose, Material 3 | Device Owner, Lock Task, telephony and SMS are native APIs. No extra runtime, lowest battery. One Gradle project, two APKs. |
| Android shared code | Plain Kotlin modules: Ktor client, kotlinx.serialization, java.time | Shared by both apps, and KMP-ready for a future iOS parent app. |
| Windows enforcer | C# on .NET 10 (LTS), Worker Service as a Windows service, Native AOT | First-class Windows service support, small native exe, session lock/unlock events. |
| Windows tray | C# WinUI 3 (Windows App SDK) + H.NotifyIcon | Native Windows 11 look (Mica, Fluent) and shares code with the service. |
| Server | TypeScript on Node 24 LTS, Hono, Zod (schemas → OpenAPI), firebase-admin; background work is an in-process sweep once a minute (CARD-021, no job queue: one server process) | Small and fast, same language as the web app, reference FCM SDK, native WebSockets. |
| Database | PostgreSQL 18, Drizzle ORM | Row-level security per family, typed queries, migrations. |
| Web | TypeScript, React 19, Vite SPA, TanStack Router + Query, Tailwind CSS v4, shadcn/ui | Modern, typed, static build served by the API container. |
| Contract | Zod schemas → `contract/openapi.json` (committed). Kotlin and C# clients generated from it. CI fails on drift. | One API definition for three languages. |
| Shared maths | `test-vectors/` JSON cases run by the TS, Kotlin and C# engines | All three must compute the same remaining time. |

**Kotlin client (CARD-029).** `pnpm contract` also runs `server/scripts/kotlin-client.ts`, which turns `contract/openapi.json` into `ApiModels.kt` and `ApiClient.kt` in `android/core-model/src/main/kotlin/au/screentime/core/model/api/` (committed; `server/test/kotlin-client.test.ts` fails on drift). It is a small generator of our own (`server/scripts/kotlin-gen.ts`), not openapi-generator: no Java tool in the TypeScript build, the output is short and readable, and it throws on any schema shape it does not know. The hand-written half is `ApiSupport.kt`: `ApiClientBase` (Ktor, bearer token, `ApiException` on an error), `ApiJson` (unknown fields ignored), `Opt` and `Conditional`. Rules:
- A required field is `T`; required and nullable is `T?`; optional is `T? = null` (left out of the JSON when null); optional and nullable is `Opt<T> = Opt.Absent`, and `Opt.Value(null)` sends `null` (for example `ParentPatch.phoneE164`, where null removes the number).
- Ids, dates and times stay `String` in the models; the apps parse them with `java.time` where they need to. Enums are Kotlin enums with the API text in `wire`. Inline objects and enums are named after their owner and field (`DeviceStateParentsItem`, `SosEndedBy`).
- One function per operation, named by the method and the path, with `ById` when the path ends in an id: `getKids`, `getKidsById`, `postDeviceSos`. Path parameters, then `body`, then query parameters. `GET /v1/device/state` takes `ifNoneMatch` and returns `Conditional<DeviceState>` (`value` is null on 304).
- The client takes a Ktor engine, so each app picks its own and the tests use `MockEngine`. The token function gives the parent's access token or the device token.

### 4.2 Hosting

- Two containers on Unraid: `api` (also serves the built web app) and `postgres`. Docker Compose file in `deploy/`.
  Details (CARD-027): the `api` image builds `web/` and serves `web/dist` from `WEB_DIR` (`/app/public`) after every API route. A file that exists is sent (files under `/assets/` cached for a year, the rest `no-cache`); any other GET path without a file extension gets `index.html`; `/v1/...`, `/health` and missing files get the JSON 404. Web responses carry a strict Content-Security-Policy (own origin only, inline styles allowed, no framing), `nosniff`, `no-referrer` and `X-Frame-Options: DENY`. Without `WEB_DIR` (development, tests) the server is the API only.
- One public hostname through the Cloudflare Tunnel: **`screentime.gallagherhome.au`** (decided 22 Oct 2026; DNS and tunnel route are set up in the deploy card). Set as `PUBLIC_HOSTNAME`.
- Web app at `/`, API at `/v1/*`, health at `/health`, device WebSocket at `/v1/device/ws`.
- Cloudflare Access must **not** be put in front of `/v1/*`, because devices authenticate with their own tokens.
- Nightly `pg_dump` to an Unraid share.
- Firebase project `screentime-d307c` (free Spark plan) provides FCM for both Android apps. The service account JSON is passed as `FIREBASE_SERVICE_ACCOUNT_JSON`; `google-services.json` files are never committed.

## 5. Repository layout

Monorepo at `github.com/jamesgallagher/ScreenTime`, default branch `main`.

```
ScreenTime/
├── AGENTS.md                 rules for coding agents (Bob)
├── README.md
├── package.json              pnpm workspace root (TypeScript parts only)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── contract/
│   └── openapi.json          generated from packages/schemas, committed
├── packages/
│   ├── schemas/              Zod schemas: API bodies + push/WS messages (@screentime/schemas)
│   └── engine/               TypeScript time engine, pure functions (@screentime/engine)
├── server/                   Hono API, Drizzle, jobs, Dockerfile (@screentime/server)
├── web/                      React parent web app (@screentime/web)
├── android/                  one Gradle project
│   ├── app-kid/              enforcer APK (Device Owner)
│   ├── app-parent/           parent APK
│   ├── core-model/           generated API client + models
│   ├── core-time/            Kotlin time engine
│   └── core-ui/              theme + shared Compose components
├── windows/                  one .NET solution (ScreenTime.slnx)
│   ├── src/ScreenTime.Core/       generated client, cache, C# time engine
│   ├── src/ScreenTime.Service/    LocalSystem worker
│   ├── src/ScreenTime.Tray/       WinUI 3 tray helper
│   ├── src/ScreenTime.Installer/  WiX MSI
│   └── tests/ScreenTime.Core.Tests/
├── test-vectors/
│   └── engine/*.json         shared time-engine cases
├── deploy/                   docker-compose.yml, .env.example, backup script, Unraid notes
└── docs/
    ├── SPEC.md               this file
    ├── BUILD-PLAN.md         ordered cards
    ├── cards/                one file per card + TEMPLATE.md
    └── guides/               setup guides (ADB provisioning, Windows install, deploy)
```

## 6. Data model

PostgreSQL. All ids are UUIDs (v7 where the server generates them; clients generate ids for rows they create offline, such as usage segments and requests, so re-sending is idempotent). All timestamps are `timestamptz` in UTC. Local dates (`day`) are `date` in the family's time zone.

Every family-owned table (all except `otp_codes`) has `family_id` and a row-level security policy `family_id = NULLIF(current_setting('app.family_id', true), '')::uuid` (on `families` itself the column is `id`). Each family request runs in a transaction that does `SET LOCAL ROLE screentime_app` and sets `app.family_id` (`withFamily` in `server/src/db/family.ts`). The database user the server connects as owns the tables and so bypasses the policies; only sign-in and `/v1/admin/*` use it directly. `screentime_app` has no access to `otp_codes`.

### 6.1 Tables

**families**: `id`, `name`, `timezone` (IANA, for example `Australia/Sydney`; set when the family is created), `emergency_number` (default `000`), `parent_code_secret` (base32, 20 random bytes, for parent-mode codes), `created_at`, `disabled_at`.

**parents**: `id`, `family_id`, `email` (unique, lower case), `display_name` (what kids see, for example "Mum", "Dad"), `phone_e164` (nullable; used for SOS SMS and the call list), `created_at`, `disabled_at`.

**otp_codes**: `id`, `email`, `code_hash`, `expires_at` (10 min), `attempts`, `consumed_at`, `created_at`. Not family scoped.

**parent_sessions**: `id`, `parent_id`, `family_id` (both null for a super admin who is not a parent), `refresh_token_hash`, `client` (`web` | `android`), `client_label`, `fcm_token` (nullable, Android only), `created_at`, `last_used_at`, `revoked_at`.

**notification_prefs**: `family_id`, `parent_id`, `kind`, `enabled`. Missing row means enabled. Essential kinds ignore this table (section 13).

**kids**: `id`, `family_id`, `name`, `avatar_color` (one of the 8 tokens in 16.1), `created_at`, `archived_at`.

**kid_contacts** (Q33 always-callable list): `id`, `family_id`, `kid_id`, `label` (for example "Dad", "Grandma"), `phone_e164`, `sort`. At most 10 per kid. Parents with a phone number appear automatically at the top and are not stored here.

**message_presets** (Q29): `id`, `family_id`, `text` (max 160), `sort`. At most 10 per family. Seeded on family creation with: "Can I have more time?", "I'm done, you can lock it", "Can you call me?", "I'm on my way home", "I need help with homework".

**schedule_versions** (Q21, append only): `id`, `family_id`, `kid_id`, `version` (int, increments per kid), `warn1_min` (default 15), `warn2_min` (default 5), `days` (jsonb, exactly 7 entries, ISO weekday 1 = Monday to 7 = Sunday), `created_by`, `created_at`. The current schedule is the highest version.

```json
{ "weekday": 1, "screensMin": 120, "phoneMin": 90, "wake": "07:00", "bedtime": "20:30" }
```

Rules: allowances are whole minutes 0 to 1440. `wake` and `bedtime` are `HH:MM` local, `wake` < `bedtime`. `wake` may be `00:00` and `bedtime` may be `24:00`, which means no curfew on that side. Bedtime after midnight is not supported in v1. `warn1_min` > `warn2_min` ≥ 1, both ≤ 60.

**devices**: `id`, `family_id`, `kid_id`, `platform` (`android` | `windows`), `form` (`phone` | `tablet` | `pc`), `pool` (`screens` | `phone`, defaults from form: phone → phone, tablet and pc → screens), `name` (for example "Pixel 7", editable), `has_cellular` (bool), `model`, `os_version`, `app_version`, `machine_id` (Windows: machine GUID, so two kid accounts on one PC are linked), `windows_user_sid`, `windows_user_name`, `token_hash`, `fcm_token`, `enrolled_at`, `last_seen_at`, `revoked_at`.
A Windows device row is one PC **plus** one Windows user account (Q10). Pools and forms are text with a CHECK constraint so new ones can be added by migration (Q1).

**enrolment_codes** (Q22): `id`, `family_id`, `kid_id`, `form`, `code` (6 digits, unique among unexpired), `expires_at` (10 min), `attempts`, `created_by`, `consumed_at`, `device_id`.

**grants** (Q8, append only): `id` (client generated), `family_id`, `kid_id`, `pool`, `minutes` (int, non-zero, may be negative), `day` (local date, set by server from `created_at`), `created_at` (server time), `created_by` (parent id), `request_id` (nullable), `note` (nullable).

**usage_segments** (Q19, append only, upsert by id): `id` (device generated), `family_id`, `kid_id`, `device_id`, `pool`, `started_at`, `ended_at` (nullable while open), `recorded_offline` (bool: the device had no server contact while recording), `received_at`. Upsert rule: same id may be sent again with a later `ended_at`; the server keeps the latest `ended_at` and never moves `started_at`.

**time_requests** (Q25): `id` (client generated), `family_id`, `kid_id`, `device_id`, `pool`, `minutes` (15, 30 or 60), `reason` (nullable, max 160), `status` (`pending` | `approved` | `denied` | `expired`), `created_at`, `resolved_by`, `resolved_at`, `grant_id`. Pending requests expire at local midnight: the server marks them `expired` before it lists or answers requests or takes a new one. A kid has at most one pending request per pool.

**kid_messages** (Q29): `id` (client generated), `family_id`, `kid_id`, `device_id`, `body` (max 160), `preset_id` (nullable; set to null when the preset is deleted, the body keeps the text), `created_at`.

**parent_mode_sessions** (Q15): `id`, `family_id`, `kid_id`, `device_id`, `method` (`push` | `code` | `remote`), `requested_at`, `approved_by` (nullable for `code`), `duration_min` (2, 5, 15, 60, or null = indefinite), `started_at`, `ends_at` (null = indefinite), `ended_at`, `ended_by`.

**sos_incidents** (Q31): `id` (device generated), `family_id`, `kid_id`, `device_id`, `started_at`, `auto_stop_at` (start + 2 h, extendable), `ended_at`, `ended_by_kind` (`kid` | `parent` | `auto`), `ended_by_parent`.
**sos_locations**: `id`, `family_id`, `sos_id`, `at`, `lat`, `lng`, `accuracy_m`, `battery_pct`, `via` (`data` | `sms`).
**sos_acks**: `family_id`, `sos_id`, `parent_id`, `at`.

**events** (audit and notification feed): `id` (client or server generated), `family_id`, `kid_id`, `device_id`, `kind`, `at`, `payload` (jsonb), `created_at`. Kinds are listed in sections 13 and 14.

### 6.2 Super admin

The super admin is not a table row. The Docker env var `SUPER_ADMIN_EMAIL` names one email. Signing in with that email (normal OTP flow) gives the `superadmin` role, which can list, create and disable families and add the first parent to a family. Creating a family also creates its first parent, the default message presets and a parent-code secret, in one transaction. Disabling a family signs out every parent session in it at once. Removing `SUPER_ADMIN_EMAIL` takes the role away at once, without waiting for tokens to expire. The admin routes use the owner connection, not `withFamily`. A super admin who is also a parent in a family sees that family normally.

## 7. The time engine (shared maths)

The same pure function is implemented three times: `packages/engine` (TypeScript, used by server and web), `android/core-time` (Kotlin) and `windows/src/ScreenTime.Core` (C#). All three must pass every case in `test-vectors/engine/`.

Kotlin (CARD-028): `au.screentime.core.time.evaluate(EngineInput): EngineResult` in `android/core-time`, on `java.time` only, following `engine.ts` step for step in epoch milliseconds. `EngineVectorsTest` runs every vector file as its own JUnit test; it reads JSON with `kotlinx-serialization-json` as a test-only dependency.

### 7.1 Inputs

For one kid, one pool, one local date `D`:

- `tz`: family IANA time zone.
- `now`: trusted current instant (section 8.5).
- `day`: today's schedule entry for that pool: `allowanceMin`, `wake`, `bedtime`.
- `grants`: grants for this kid, pool and `D`: `{ minutes, createdAt }`.
- `segments`: usage segments of **all devices in the pool** overlapping `D`: `{ start, end | null }`. A null end means "still open", read as `now`.

### 7.2 Definitions

Using local time in `tz` on date `D`:

- `dayStart` = D 00:00, `dayEnd` = D+1 00:00 (handle daylight saving by converting through `tz`, never by adding 24 h).
- `wakeAt` = D at `wake`, `bedAt` = D at `bedtime` (`24:00` = `dayEnd`).
- Three periods: **morning curfew** `[dayStart, wakeAt)`, **allowed** `[wakeAt, bedAt)`, **evening curfew** `[bedAt, dayEnd)`.
- `used(P)` = length of the **union** of all segments, clipped to period `P` and to `[dayStart, now)`. Overlapping segments from different devices count once (Q26).
- A grant belongs to the period that contains its `createdAt`. Grants in the allowed period are **allowance grants**. Grants in a curfew period are **curfew grants** for that period only (Q8: after bedtime only granted time counts).

### 7.3 Outputs

```
allowanceLeft = allowanceMin*60 + Σ(allowance grants)*60 − used(allowed)            (seconds, may be negative)

if now in allowed:
    remainingSec = max(0, allowanceLeft)
    locked       = allowanceLeft <= 0
    lockReason   = locked ? "out_of_time" : null
    nextLockAt   = locked ? null : min(now + remainingSec, bedAt)

if now in a curfew period P:
    curfewLeft   = Σ(curfew grants in P)*60 − used(P)
    remainingSec = max(0, curfewLeft)
    locked       = curfewLeft <= 0
    lockReason   = locked ? (P is morning ? "before_wake" : "bedtime") : null
    nextLockAt   = locked ? null : now + remainingSec, except:
                   morning: if now + remainingSec >= wakeAt, the allowed period takes over at wakeAt,
                            so nextLockAt = allowanceLeft > 0 ? min(wakeAt + allowanceLeft, bedAt) : wakeAt
                   evening: if now + remainingSec >= dayEnd, nextLockAt = null (tomorrow decides)

nextLockAt is null when the device will not lock before dayEnd. When bedAt = dayEnd, use null instead of dayEnd.

reevaluateAt = earliest of: nextLockAt, the next period boundary after now (wakeAt, bedAt), dayEnd
overspendSec = max(0, −allowanceLeft)      reported to parents (Q27)
```

Devices schedule their single alarm at the earliest of `nextLockAt − warn1`, `nextLockAt − warn2`, `nextLockAt` and `reevaluateAt`, and re-run the engine whenever it fires or any input changes.

The engine also returns `usedSec` = `used(allowed)` + `used(both curfew periods)` for reporting (Q18).

Notes:

- Seconds internally. Kid UI shows whole minutes rounded **down**, and "less than a minute" under 60 s.
- Reset at midnight is automatic: a new `D` has no grants and no segments (Q21). A segment that crosses midnight is split by clipping.
- Bedtime always locks (Q8). A parent can still unlock after bedtime by granting time (a curfew grant) or by parent mode.
- Parent mode is outside the engine: while a parent-mode session is active the device is unlocked and records no segments.
- "Lock now" in the parent app is just a negative grant of the current remaining minutes, rounded up to a whole minute. The server works it out (`POST /v1/kids/{kidId}/lock-now`), so both parents' apps agree; a pool that is already locked answers 409.

### 7.4 Test vector format

One JSON file per case in `test-vectors/engine/`, named `NNN-short-name.json`:

```json
{
  "name": "grant after bedtime unlocks only for the granted time",
  "tz": "Australia/Sydney",
  "date": "2026-10-22",
  "now": "2026-10-22T21:10:00+11:00",
  "day": { "allowanceMin": 120, "wake": "07:00", "bedtime": "20:30" },
  "grants": [ { "minutes": 15, "createdAt": "2026-10-22T21:00:00+11:00" } ],
  "segments": [ { "start": "2026-10-22T21:01:00+11:00", "end": null } ],
  "expect": {
    "locked": false,
    "lockReason": null,
    "remainingSec": 360,
    "nextLockAt": "2026-10-22T21:16:00+11:00",
    "reevaluateAt": "2026-10-22T21:16:00+11:00",
    "usedSec": 540,
    "overspendSec": 0
  }
}
```

The cases must cover at least: plain allowance, zero allowance, grants plus and minus, negative grant that locks, two overlapping devices, back-to-back devices, segment crossing wake, crossing bedtime, crossing midnight, bedtime grant, morning grant, open segment, overspend, `wake = 00:00`, `bedtime = 24:00`, and both daylight-saving change days in `Australia/Sydney`.

## 8. Sync model

### 8.1 Principle

Each device is the authority over its own enforcement and never asks the server for permission. The server is the authority over the record: schedule, grants and usage. Records are append only with client ids, so sending twice or out of order is safe (Q12).

### 8.2 Device state snapshot

KISS: there is no cursor protocol. A device fetches one small snapshot, `GET /v1/device/state`, which contains everything it needs to enforce today and the rest of the week (section 9.3). The response carries an `ETag` (`stateVersion`); the device sends `If-None-Match` and gets `304` when nothing changed. The device caches the last snapshot on disk and enforces from it indefinitely when offline.

The snapshot includes the other pool devices' segments for today, so the device can merge its own unsent segments with them and run the engine locally.

Details:

- `stateVersion` is a hash of the whole snapshot except `serverTime`, so it changes only when something the device enforces changes. The `ETag` header is the version in double quotes. `If-None-Match` may hold several tags or a weak tag (`W/"…"`, which Cloudflare can produce); any match gives `304` with no body. A `304` still has the standard `Date` header, which the device uses as `serverTime`.
- `today.grants` holds only grants for this device's pool. `today.poolSegments` holds the segments of every device of this kid in this pool, this device's own too, that overlap today. The device merges them with its unsent segments by id.
- An open segment (no `endedAt`) of a device that has not been heard from for 10 minutes is shown as ending at that device's `last_seen_at`, so a phone that died while in use does not keep using up the pool. Devices upload at least every 5 minutes while in use (8.3), so a working device never looks stale. The stored segment is not changed.
- `parents` lists every enabled parent, oldest first, with `phoneE164` null when the parent has no phone. `pendingRequest` is the newest pending time request for this kid and pool made today, as `{ id, minutes, createdAt }`. `activeSos` is the kid's newest SOS that has not ended or auto-stopped, as `{ id, startedAt }`.

### 8.3 When devices sync

| Trigger | Android | Windows |
|---|---|---|
| Live channel | FCM high-priority data message. WebSocket only while the blocker is on screen and the screen is on. | WebSocket from the service, always on. |
| Heartbeat | n/a | ping every 30 s, dead after 75 s |
| Reconnect backoff | 1, 2, 4 … 60 s, ±20% jitter | same |
| Fallback poll, normal | none (FCM) | 60 s while the socket is down |
| Fallback poll, while locked | 10 s for 2 min, then 30 s, screen on only | 10 s while the socket is down |
| Safety-net | WorkManager every 60 min | covered by socket |
| Event-driven | screen on or unlock (if last sync > 2 min), network regained, boot | sign-in, unlock, resume, network regained, boot |
| Usage upload | every 5 min while screen on, every 1 min under 15 min left, and at screen off | every 60 s |
| Push TTL | until local midnight | n/a |
| Offline buffer | 30 days | 30 days |

On every push or socket message the device applies the payload if it carries one (for example a grant), then fetches the snapshot. On every reconnect it does a full sync.

Expected grant latency: PC about 1 s, Android 1 to 5 s, worst case about 10 s.

### 8.4 Offline and overspend (Q27)

A device that cannot reach the server keeps enforcing with what it knows. Segments recorded without server contact are flagged `recorded_offline`. When they arrive, the server recomputes the uploading device's pool for today; if `overspendSec` is at least 60 it writes an `overspend` event (payload `{ pool, overspendSec, day, deviceName }`) and notifies parents ("Screens went 12 min over: tablet was offline"). A later upload only writes another one when the overspend has grown by at least 60 s over the largest already reported for that kid, pool and day, so re-sent segments never repeat it. Uploads with only online segments never write one. Overspend is never carried to the next day. If an upload makes another online device's pool empty, that device gets the normal warnings, then locks.

### 8.5 Trusted time

- Every server response includes `serverTime`. The device stores `offset = serverTime − monotonic` using a clock the user cannot change (`SystemClock.elapsedRealtime()` on Android, `Environment.TickCount64` / `Stopwatch` on Windows). `trustedNow = monotonic + offset`.
- After a reboot while offline the monotonic clock resets; fall back to wall clock, but never earlier than the last saved trusted time.
- If the wall clock differs from `trustedNow` by more than 2 minutes, keep using `trustedNow` and raise a `tamper.clock` event.
- Local dates, wake and bedtime always use the **family** time zone from the snapshot, never the device's time zone.
- A device not seen for 6 hours during allowed hours raises `device.offline` for parents: the server's sweep (once a minute) reports a device whose `last_seen_at` is more than 6 hours ago when all of those 6 hours fall in today's allowed hours of its kid (`wake` to `bedtime`, family time zone), so a device that was off overnight is not reported in the morning. One event per absence, payload `{ lastSeenAt, deviceName }`; seen again and then silent again is a new absence (CARD-021).

## 9. API surface

REST + JSON over HTTPS. Base path `/v1`. Zod schemas in `packages/schemas` are the source; `contract/openapi.json` is generated and committed. Field names are camelCase. Errors use one shape:

```json
{ "error": { "code": "validation_failed", "message": "Human readable", "details": {} } }
```

Common codes: `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409), `validation_failed` (422), `rate_limited` (429), `internal` (500).

Two kinds of caller: **parent** (Bearer access token from OTP login) and **device** (Bearer device token from enrolment).

### 9.1 Public

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{ status: "ok", service, time }` |
| POST | `/v1/auth/otp/request` | `{ email }` → always 204 (does not reveal whether the email exists) |
| POST | `/v1/auth/otp/verify` | `{ email, code, client, clientLabel }` → `{ accessToken, refreshToken, expiresIn, me }` |
| POST | `/v1/auth/refresh` | `{ refreshToken }` → same shape as verify (refresh token rotates) |
| POST | `/v1/auth/logout` | Bearer access token; revokes the session's refresh token (the access token runs out within 15 min) |
| POST | `/v1/enrol` | `{ code, platform, hasCellular, model, osVersion, appVersion, machineId?, windowsUserSid?, windowsUserName? }` (the three Windows fields are required on Windows) → 201 `{ deviceId, deviceToken, kid, family }`. The code decides the kid and the form |

### 9.2 Parent

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/me` | parent, family, roles |
| PUT | `/v1/me/push-token` | `{ fcmToken \| null }` for the session of the access token → 204. The same token is taken off the parent's other sessions. A revoked session → 401 |
| GET / PUT | `/v1/me/notification-prefs` | GET: every kind of section 13 in a fixed order, each `{ kind, enabled, essential }`. PUT: list of `{ kind, enabled }`, each kind at most once; kinds left out keep their setting; turning off an essential kind → 422. Answers the full list |
| GET / PATCH | `/v1/family` | name, timezone, emergency number |
| GET / POST | `/v1/family/parents` | list, add parent (`email`, `displayName`, `phoneE164`) |
| PATCH / DELETE | `/v1/family/parents/{id}` | edit, disable |
| GET / PUT | `/v1/family/message-presets` | whole list replaced on PUT |
| GET | `/v1/family/parent-code` | `{ secret }` for offline parent-mode codes (cached by the parent app) |
| POST | `/v1/family/parent-code/rotate` | new secret; devices pick it up on next sync |
| GET | `/v1/today` | dashboard `{ serverTime, date, kids }`: every kid (oldest first) and both pools (Screens first): `allowanceMin`, `grantedMin`, `usedSec`, `remainingSec`, `locked`, `lockReason`, `nextLockAt`, `overspendSec`, and the pool's devices with `inUse`, `lastSeenAt` and active parent mode. Worked out by the engine (section 7) |
| GET / POST | `/v1/kids` | list, create |
| GET / PATCH / DELETE | `/v1/kids/{kidId}` | read, edit, archive |
| GET / PUT | `/v1/kids/{kidId}/schedule` | PUT writes a new version |
| GET / PUT | `/v1/kids/{kidId}/contacts` | whole list replaced on PUT |
| GET | `/v1/kids/{kidId}/grants?day=YYYY-MM-DD` | both pools, oldest first, each `{ id, pool, minutes, day, createdAt, byName, note, requestId }`; today by default |
| POST | `/v1/kids/{kidId}/grants` | `{ id, pool, minutes, note? }` → 201 grant. `minutes` is a non-zero multiple of 15 from the roller, −1440 to 1440; `note` 1 to 160 characters. Counts for the family's today. The same `id` again → 200 with the stored grant; an `id` used for another kid → 409 |
| POST | `/v1/kids/{kidId}/lock-now` | `{ id, pool }` → 201 grant of minus the pool's remaining minutes, rounded up, note "Lock now" (section 7.3). Already locked → 409. Same `id` again → 200 |
| POST | `/v1/kids/{kidId}/enrolment-codes` | `{ form }` → `{ code, qrPayload, expiresAt }` |
| GET | `/v1/devices` | all devices in family |
| PATCH / DELETE | `/v1/devices/{id}` | rename, change pool; DELETE revokes the token |
| POST / DELETE | `/v1/devices/{id}/parent-mode` | POST `{ durationMin }` (2, 5, 15, 60 or null = until ended) → 201 session, method `remote`; ends any other parent mode on the device first. DELETE ends it → 204 (nothing on is fine). Revoked device → 404 |
| GET | `/v1/requests?status=&kidId=&limit=` | time requests, newest first, archived kids left out. Each `{ id, kidId, kidName, deviceId, deviceName, pool, minutes, reason, status, createdAt, resolvedAt, resolvedByName, grantId, grantedMinutes }`. `limit` 1 to 100, default 50 |
| POST | `/v1/requests/{id}/approve` | `{ minutes? }` (a multiple of 15 from 15 to 1440; defaults to what was asked) → 200 request. Creates a grant for today in the request's pool, note "Asked for more time". Already answered or expired → 409 |
| POST | `/v1/requests/{id}/deny` | → 200 request. Already answered or expired → 409 |
| POST | `/v1/parent-mode-requests/{id}/approve` | `{ durationMin }` → 200 session, parent mode on. Already answered or expired → 409 |
| POST | `/v1/parent-mode-requests/{id}/deny` | → 200 session, status `denied`. Already answered or expired → 409 |
| GET | `/v1/messages?kidId=&before=&limit=` | `{ messages, nextBefore }`, newest first, archived kids included. Each `{ id, kidId, kidName, deviceId, deviceName, body, presetId, createdAt }`. Paged like `/v1/events` |
| GET | `/v1/events?kidId=&kind=&before=&limit=` | `{ events, nextBefore }`, newest first, every kind (muted ones too), archived kids included. Each event `{ id, kind, at, kidId, kidName, deviceId, deviceName, payload }`. `kind` matches the event kind or its start (`sos` matches `sos.started`). `limit` 1 to 100, default 50. Next page: `before` = `nextBefore` (null on the last page) |
| GET | `/v1/sos?active=&kidId=&limit=` | SOS alerts, newest first, archived kids included. Each `{ id, kidId, kidName, deviceId, deviceName, status, startedAt, autoStopAt, endedAt, endedBy, endedByName, lastLocation, acks }`. `status` `active` or `ended`; `endedBy` `kid`, `parent` or `auto` (ran out: `endedAt` = `autoStopAt`). `acks` `[{ parentId, byName, at }]` oldest first. `active` `true` or `false`; `limit` 1 to 100, default 50 |
| GET | `/v1/sos/{id}` | the SOS plus `locations` (every position, oldest first). The parent app reads it every 30 s while the SOS screen is open: positions are not pushed |
| POST | `/v1/sos/{id}/ack` | "I'm on it" → 200 SOS. Writes `sos.acked`, tells the phone (`sos_ack`). Again by the same parent → 200, nothing sent. Ended → 409 |
| POST | `/v1/sos/{id}/extend` | `autoStopAt` + 2 h → 200 SOS. Writes `sos.extended`, tells the phone (`sos_extended`). Ended → 409 |
| POST | `/v1/sos/{id}/end` | → 200 SOS. Writes `sos.ended`, tells the phone (`sos_ended`). Already ended → 409 (also when two parents end it at once) |

Super admin: `GET/POST /v1/admin/families`, `POST /v1/admin/families/{id}/parents`, `POST /v1/admin/families/{id}/disable`.

Rules for the family routes:

- Every family route needs a parent of an enabled family. A super admin who is not a parent gets 403. A parent who was removed, or whose family was disabled, gets 401 straight away, without waiting for the access token to expire.
- Parent emails are unique across all families and stored in lower case. Adding an email that is already used gives 409.
- A parent cannot remove themselves (409). Removing a parent sets `disabled_at` and signs out all their sessions. Removed parents are not listed.
- Message presets: at most 10, each 1 to 160 characters after trimming. PUT replaces the whole list, in the order given.
- `parentCodeSecret` is 32 base32 characters (20 random bytes).

Rules for the kid routes:

- A new kid starts with schedule version 1: Monday to Friday 120 min Screens, 90 min Phone, 07:00 to 20:30; Saturday and Sunday 180 and 120 min, 08:00 to 21:00; warnings 15 and 5 min. A kid name is 1 to 40 characters after trimming.
- DELETE archives the kid (`archived_at`) and revokes the kid's devices; the history stays. An archived kid is left out of lists and every `/v1/kids/{kidId}...` route answers 404.
- Schedule PUT takes `{ warn1Min, warn2Min, days }` with exactly 7 days in order Monday (1) to Sunday (7) and the rules in 6.1, and stores the next version. Two saves at the same moment: the second gets 409 and tries again.
- Contacts: at most 10, each with a label of 1 to 40 characters and an E.164 number. PUT replaces the whole list, in the order given.

### 9.3 Device

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/device/me` | `{ device, kid, family }`; a 401 means the device was revoked and must enrol again |
| GET | `/v1/device/state` | snapshot, ETag (below) |
| POST | `/v1/device/usage` | `{ segments: [{ id, startedAt, endedAt \| null, recordedOffline }] }` 1 to 500 per call → `{ received }`. Upsert by id (6.1): `startedAt` never moves, the latest `endedAt` wins and a closed segment never reopens, `recordedOffline` once true stays true. Repeats of one id in a call are joined first. An id that belongs to another device is ignored (not counted in `received`). A new segment takes the device's current pool |
| POST | `/v1/device/events` | `{ events: [{ id, kind, at, payload? }] }` 1 to 50 tamper events (section 14) → 204. `kind` one of `tamper.clock`, `tamper.timezone`, `tamper.tray_killed`, `tamper.policy`, `tamper.call_blocked`; `at` with offset, stored as `least(at, now())`; `payload` up to 10 flat fields (string ≤ 200, number, boolean, null). An id already stored is skipped. Parents get one push per kind per upload (the newest) |
| PUT | `/v1/device/push-token` | `{ fcmToken \| null }` (Android) → 204. The same token is taken off any other device |
| POST | `/v1/device/time-requests` | `{ id, minutes, reason? }` → 201 request (shape of `/v1/requests`). `minutes` 15, 30 or 60, `reason` 1 to 160 characters. For the device's pool. While the kid has a pending request for that pool → 409. Same `id` again → 200 |
| POST | `/v1/device/messages` | `{ id, body, presetId? }` → 201 message (shape of `/v1/messages`). `body` 1 to 160 characters. A `presetId` that no longer exists is stored as null. Same `id` again → 200 |
| POST | `/v1/device/parent-mode-requests` | `{ id }` → 201 session, status `pending`. Waits 10 min for a parent; a newer request from the same device expires older ones. Parent mode already on → 409. Same `id` again → 200 |
| POST | `/v1/device/parent-mode` | `{ id, durationMin, startedAt }`: parent mode the device started after a correct parent code (maybe offline) → 201 session, method `code`. A `startedAt` in the future counts as now. Ends any other parent mode on the device. Same `id` again → 200 |
| POST | `/v1/device/parent-mode/end` | kid device "End now" button → 204 (nothing on is fine) |
| POST | `/v1/device/sos` | `{ id, startedAt, location? }` → 201 SOS (shape of `/v1/sos`). Phones only (else 409). Stored from `least(startedAt, now())`, auto stop 2 h later. While the kid has an active SOS → 409. Same `id` again → 200. Writes `sos.started` (critical push) and emails every enabled parent |
| POST | `/v1/device/sos/{id}/locations` | `{ locations: [{ at, lat, lng, accuracyM?, batteryPct?, via }] }` 1 to 100 → 204. Also after the end (queued positions). A position with the same `at` as a stored one is skipped. Another device's SOS → 404 |
| POST | `/v1/device/sos/{id}/end` | kid held "I'm safe" → 204, writes `sos.ended`. Already ended is fine |
| GET | `/v1/device/ws` | WebSocket upgrade, `Authorization: Bearer <deviceToken>`. A wrong or revoked token gets 401 and no socket; a request that is not an upgrade gets 422. Details in section 10 |

Device state snapshot:

```json
{
  "serverTime": "2026-10-22T09:00:00Z",
  "stateVersion": "b3f1…",
  "device": { "id": "…", "name": "Pixel 7", "form": "phone", "pool": "phone", "hasCellular": true },
  "kid": { "id": "…", "name": "Alex" },
  "family": { "timezone": "Australia/Sydney", "emergencyNumber": "000", "parentCodeSecret": "BASE32…" },
  "parents": [ { "id": "…", "displayName": "Dad", "phoneE164": "+614…" } ],
  "contacts": [ { "label": "Grandma", "phoneE164": "+614…" } ],
  "messagePresets": [ { "id": "…", "text": "Can I have more time?" } ],
  "schedule": { "version": 3, "warn1Min": 15, "warn2Min": 5, "days": [ { "weekday": 1, "screensMin": 120, "phoneMin": 90, "wake": "07:00", "bedtime": "20:30" } ] },
  "today": {
    "date": "2026-10-22",
    "grants": [ { "id": "…", "minutes": 15, "createdAt": "…", "byName": "Dad" } ],
    "poolSegments": [ { "id": "…", "deviceId": "…", "startedAt": "…", "endedAt": "…" } ]
  },
  "parentMode": { "active": false, "endsAt": null, "byName": null },
  "pendingRequest": null,
  "activeSos": null
}
```

## 10. Push and WebSocket messages

One envelope, defined in `packages/schemas`, used for FCM data messages and WebSocket frames:

```json
{ "v": 1, "type": "grant_added", "at": "2026-10-22T09:00:00Z", "data": { } }
```

FCM data values must be strings, so the whole envelope is sent as one string field `msg`.

To kid devices:

| type | data | Device shows |
|---|---|---|
| `state_changed` | `{}` | nothing, re-syncs (with `If-None-Match`, so an unchanged snapshot costs a 304) |
| `grant_added` | `{ grant, byName }` | "Dad added 15 minutes" (or "Dad removed 15 minutes") |
| `request_resolved` | `{ requestId, approved, minutes, byName, grant }` (`minutes` 0 and `grant` null for a no) | "Dad said yes: +15 min" / "Dad said not this time", then re-syncs |
| `parent_mode` | `{ active, endsAt, byName, requestId }` (`requestId` set when it answers the device's request; `active: false` with a `requestId` is a no) | parent mode banner, or closes the "Hand to a parent" screen |
| `sos_ack` | `{ sosId, byName }` | "Dad has seen your SOS" |
| `sos_extended` | `{ sosId, byName, autoStopAt }` | keeps sharing its location until the new `autoStopAt` |
| `sos_ended` | `{ sosId, byName }` | SOS screen closes |

Every Android push that changes time produces a visible notification, which keeps FCM high priority from being downgraded.

To parent apps: `type` is the notification kind of section 13 and `data` is the event exactly as `/v1/events` lists it, so the app shows the same text in the notification and the inbox. Essential kinds use FCM `priority: high` (SOS also uses the critical channel); the rest use normal priority.

Delivery (CARD-016): pushes are sent after the database transaction commits. A failed push is logged and dropped (the event is in the history anyway, and devices also sync). Tokens that FCM reports as unregistered or invalid are cleared. `grant_added` to kid devices goes to the kid's Android devices in the grant's pool, with an FCM time to live that ends at local midnight. Without `FIREBASE_SERVICE_ACCOUNT_JSON` nothing is sent.

When the server sends to kid devices (CARD-017). Every message goes by WebSocket to each connected device it is for; "and FCM" means Android devices with a push token get it by FCM too:

| Change | Message | To | FCM |
|---|---|---|---|
| A grant or lock now | `grant_added` | the kid's devices in the grant's pool | high priority, time to live until local midnight |
| Schedule, contacts or kid name changed | `state_changed` | the kid's devices | normal priority, time to live 24 h |
| Family settings, parents (added, edited, removed), message presets, parent-code secret | `state_changed` | every device of the family | normal, 24 h |
| Device renamed or moved to another pool | `state_changed` | that device | normal, 24 h |
| A kid asks for more time (CARD-018) | `state_changed` | the kid's other devices in that pool | normal, 24 h |
| A parent answers a time request (CARD-018) | `request_resolved` | the kid's devices in the request's pool | high priority, time to live until local midnight |
| A parent approves or denies parent mode, or starts or ends it from the app (CARD-019) | `parent_mode` | that device | high priority; time to live until it ends (24 h for "until ended", 1 h for an end or a no) |
| Usage uploaded | `state_changed` | the kid's other devices in that pool | none (uploads come every minute; Android counts the others' use at its next sync) |
| Device revoked, kid archived, or a PC account enrolled again | the socket is closed with code 4401 | those devices | none |

Messages are sent after the change commits; a failure is logged and dropped.

WebSocket details: the device sends `{ "type": "ping" }` every 30 s and the server answers with the envelope `{ "v": 1, "type": "pong", "at": <server time>, "data": {} }`. Any message from the device counts as a sign of life; a socket silent for 75 s is closed with code 4408, and the device reconnects (section 8.3). Other messages from the device are ignored: usage uploads and everything else stay on REST. The server keeps the connected sockets in memory (one server process); a device may briefly have two while it reconnects.

## 11. Authentication and security

### 11.1 Parents (Q14)

1. Enter email → server emails a 6-digit code (expires 10 min, max 5 attempts, max 5 codes per email per hour).
2. Verify → access token (JWT, HS256, 15 min, claims: `sid` session id, `sub` parent id, `fam` family id, `roles`) and refresh token (opaque 32 random bytes, stored hashed, 90-day sliding, rotated on each use).
   Details (CARD-011): a code row is stored for every requested email, known or not, so the per-email limit does not reveal which emails exist; only emails of enabled parents in enabled families, and `SUPER_ADMIN_EMAIL`, are actually sent a code. Only the newest unexpired code for an email works, and a successful sign-in uses up all of that email's codes. Codes are stored as HMAC-SHA256 keyed with `JWT_SECRET`. Per IP (Cloudflare's `CF-Connecting-IP`): 20 code requests per hour and 30 verify attempts per 15 minutes, in memory.
3. Android parent app stores tokens in app storage encrypted with an Android Keystore key, and requires `BiometricPrompt` (strong biometric **or** device PIN/pattern) every time the app is opened after 5 minutes in the background.
4. The web app keeps the refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie and the access token in memory.
   Details (CARD-022): for `client: "web"` the server sets `st_refresh` (`Path=/v1/auth`, 90 days) and leaves `refreshToken` out of the JSON body; the web app refreshes with `{}` and the cookie, and logout deletes it. The session's stored `client` decides body or cookie. Android is unchanged.

Email is sent over SMTP with nodemailer using env vars, so the provider can be swapped by config alone. Provider (decided 22 Oct 2026): **Brevo SMTP relay**, reusing James's existing Brevo account (the one the Stremio AI Recommender uses):

| Env var | Value |
|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` (STARTTLS; `465` means implicit TLS) |
| `SMTP_USER` | Brevo SMTP login (secret-ish, from the existing deployment, never committed) |
| `SMTP_PASS` | Brevo SMTP key `xsmtpsib-…` (secret, from the existing deployment, never committed) |
| `SMTP_FROM` | `no-reply@gallagherhome.au` (already a verified Brevo sender) |
| `SMTP_FROM_NAME` | `ScreenTime App` |

If `SMTP_USER`, `SMTP_PASS` or `SMTP_FROM` is unset, the server logs the code to the console instead of sending (dev and tests only). Email subject: "Your ScreenTime sign-in code: 123456".

### 11.2 Devices

Each kid device gets an opaque 32-byte token at enrolment, stored hashed on the server. Revoking a device in the parent app kills the token. Android stores it in app private storage (protected by Device Owner restrictions). Windows stores it in `C:\ProgramData\ScreenTime\` with an ACL of SYSTEM and Administrators only.

### 11.3 Enrolment (Q22)

1. Parent: kid → "Add device" → picks Phone, Tablet or PC.
2. Server creates a 6-digit code valid for 10 minutes, unique among unused unexpired codes. The app shows the code in large digits and a QR code containing `screentime://enrol?host=<hostname>&code=<code>`, where the hostname is the one the parent app used to reach the server (the public hostname in production).
3. Kid device: Android setup screen scans the QR (CameraX + ML Kit barcode, bundled model) or takes the code typed in. Windows: the installer asks for server hostname and code.
4. `POST /v1/enrol` → device token. A code works once. A wrong code matches no row, so guesses are limited per IP: 10 enrol calls per 15 minutes, then 429. The code's form must fit the platform (phone and tablet: Android; PC: Windows), else 409 and the code stays usable. The device's form comes from the code and its pool from the form. Enrolling the same Windows machine and account again revokes the old device row. `enrolment_codes.attempts` is not used in v1.
5. A `device.enrolled` event is written (payload `{ name, form, platform }`); parents get it as a notification once push exists. The device name starts as the model (Windows: `<user name> on <model>`), at most 40 characters; parents can rename it.

### 11.4 Server

- Postgres RLS by `family_id` (section 6). The super admin role is used only in `/v1/admin/*`.
- Rate limits per IP and per email on auth and enrolment.
- `JWT_SECRET`, `DATABASE_URL`, `SUPER_ADMIN_EMAIL`, `PUBLIC_HOSTNAME`, SMTP vars (11.1), `FIREBASE_SERVICE_ACCOUNT_JSON` and `WEB_DIR` (set by the image) come from env. Never commit secrets; `deploy/.env.example` lists them.

## 12. Enforcement per platform

### 12.1 Android kid app (phone and tablet, one APK)

**Setup (Q6/Q9, no wipe)**, documented in `docs/guides/android-provisioning.md`:

1. On the kid device: temporarily remove every account (Settings › Accounts), extra users and guest, and any work profile. Turn on USB debugging.
2. From James's PC: `adb install app-kid.apk`, then `adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver`, and on a phone with a SIM `adb shell cmd role add-role-holder android.app.role.CALL_REDIRECTION au.screentime.kid` (an app cannot give itself the call redirection role, CARD-036).
3. Re-add the Google account. Open the app, scan the enrolment QR.
4. The app then applies restrictions, and USB debugging is turned off by `DISALLOW_DEBUGGING_FEATURES`.
5. Also turn on Android's own Emergency SOS with the parents as emergency contacts.

**Device Owner policies applied at startup** (once enrolment is confirmed, then on every start; CARD-030 applies the restrictions, auto time and permission grants, CARD-033 and CARD-036 the Lock Task packages; FRP comes in a later card; a **debug** build is test-only, keeps USB debugging on and does not block uninstalling, so a developer can always undo it with `adb shell dpm remove-active-admin`):

- `setUninstallBlocked(self)`, user restrictions `DISALLOW_APPS_CONTROL`, `DISALLOW_SAFE_BOOT`, `DISALLOW_FACTORY_RESET`, `DISALLOW_CONFIG_DATE_TIME`, `DISALLOW_DEBUGGING_FEATURES`, `DISALLOW_ADD_USER`, `DISALLOW_AIRPLANE_MODE`. Auto time and auto time zone forced on.
- Factory Reset Protection (`setFactoryResetProtectionPolicy`) set to **James's Google account** (decided 22 Oct 2026). The account's numeric Google ID is entered during provisioning and stored as a server family setting, never committed to the repo.
- Self-grant runtime permissions (phone, SMS, location, notifications, camera for QR) with `setPermissionGrantState`.
- Lock Task packages: our app, plus the system dialer / in-call UI package (resolved at runtime from `TelecomManager.getDefaultDialerPackage()`) only on devices with cellular.

**Counting (Q19):** a segment starts on `ACTION_USER_PRESENT` (unlocked) and ends on `ACTION_SCREEN_OFF`, on shutdown, and whenever the device becomes locked by us or enters parent mode. Timestamps only, no ticking timers. Open segment flushed to the local database every minute and on every event.

**Foreground service:** type `systemExempted` (allowed for Device Owner). Holds the persistent notification (16.2). Schedules exactly one `AlarmManager.setExactAndAllowWhileIdle` alarm for the next event (warn 1, warn 2, lock, bedtime, wake, midnight). Starts on boot (`BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED`).

As built (CARD-031): `service/KidService` is the `systemExempted` foreground service, started when the kid taps **Yes**, on every later app start, after a reboot (`BOOT_COMPLETED`) and after an app update (`MY_PACKAGE_REPLACED`). Its notification says only "Screen Time is on" until CARD-032. It listens for `SCREEN_ON`, `USER_PRESENT` and `SCREEN_OFF` while it runs. "In use" means interactive and the keyguard not locked: a segment starts when that becomes true (a second event does not start a second segment) and ends at screen off. Once a minute while in use the open segment's last-seen time is saved; a segment left open by a crash, a reboot or an update ends at its last-seen time when the service starts again. Segments live in a Room table (`kid.db`, Room 2.8 with KSP) with a version per row, so a change made during an upload is sent again; sent segments are deleted 30 days after they end. Sync = upload every changed segment (500 per call), then `GET /v1/device/state` with `If-None-Match`; the snapshot and its ETag are kept in `state.json` and `state.etag`. Syncs happen when the service starts, every 5 minutes while in use, at screen off, at unlock when the last sync is older than 2 minutes or failed, and when the network comes back after a failure. A failed sync marks the open segment `recordedOffline`, or when none is open the newest segment the server has not got (the sync at screen off failed). The trusted clock is the server time of the last answer (body `serverTime`, or the `Date` header on a 304) plus `elapsedRealtime`, kept per boot (`Settings.Global.BOOT_COUNT`); after a reboot without the server it is the wall clock, never earlier than the last trusted time. After every sync and unlock the service runs the engine on the snapshot with its own segments in place of the server's copies, and logs it (`adb logcat -s KidService`); the screens use it from CARD-032. A 401 is only logged for now.

As built (CARD-032): there is **no AlarmManager alarm**. Warnings and locks only matter while the device is in use, and then the screen is on and the service runs, so the service's own loop wakes up at the next warning, lock or period boundary (`nextCheckAtMs`, at least once a minute) and runs the engine again; when the screen comes back on, the unlock runs it at once. A bedtime or midnight that passes while the screen is off is picked up at the next unlock. Each run publishes a `KidStatus` (`status/`): the notification (title "Phone · 1h 12m left" or the lock headline, text "Bedtime 8:30 pm", "Phone is back at 7:00 am" or "New time tomorrow", sub text "Offline" after a failed sync, the chronometer counting down to the lock on the wall clock), the main screen through `StatusHub`, and the warnings. `WarningTracker` shows each warning once when the time to the lock falls to `warn1Min` or `warn2Min` while in use; more time from a parent lets it show again. "Time to the lock" is the time until `nextLockAt`, so bedtime counts too. Warnings use the channel "Time warnings" (high importance, no sound); the second one buzzes on a phone. The notification has no actions yet (ask and message come in CARD-035). The main screen replaces "All set": "Hi Alex", the 240 dp ring (the part of today's time that is left; `displayMedium` bold for the number, since `displayLarge` does not fit "10h 30m" in the ring), "Phone left", the bedtime line and "Offline · still counting". It counts down every second from `elapsedRealtime`. Its buttons come with their cards (035, 037, 038). `server/scripts/dev-bedtime.ts` moves a kid's bedtime to a few minutes from now for testing.

As built (CARD-033): when the engine says locked, the service ends the open segment and opens `block/BlockActivity` (its own task, out of Recents), which pins itself with `startLockTask()`. Lock Task allows only our package, with the power menu and the phone's own lock screen (`LOCK_TASK_FEATURE_GLOBAL_ACTIONS`, `LOCK_TASK_FEATURE_KEYGUARD`), so Home, Recents and the shade are gone but the lock screen's emergency call still works; the dialer joins the list in CARD-036. Nothing counts while blocked ("in use" also means not blocked). While blocked with the screen on the service syncs at least every 30 seconds, so a grant or a later bedtime shows within about 30 seconds (FCM and the WebSocket make it faster in CARD-034). When the engine says unlocked, the block screen calls `stopLockTask()` and closes, and a segment starts if the screen is on and unlocked. The service opens the block screen from the background; Android lets a Device Owner do that, and the CARD-033 emulator run checks it, also after a reboot. The policies are applied again at every service start. The block screen shows the time, a moon (bedtime, early morning) or an hourglass (out of time), the headline and when the device is back; its buttons come with CARD-035 to CARD-038. A failed sync now marks every segment the server has not got as `recordedOffline`, not only the newest, and syncs never overlap (CARD-032 found a slow failing sync plus a quick unlock marking the wrong segment).

As built (CARD-034): while the device is blocked with the screen on, the service keeps the WebSocket (`live/LiveChannel.kt`) open to `GET /v1/device/ws`, with the device token in the upgrade request; the address is the server address with `https` turned into `wss` (`http` into `ws` for the emulator). It sends `{ "type": "ping" }` every 30 s and treats a socket that has said nothing for 75 s as dead. Every envelope except `pong` makes the service sync, and so does every connect, since a message may have been missed while it was down; the service's own loop does the sync, never the socket's coroutine. After a failure or a close the channel waits 1, 2, 4 … 60 s (±20%) and tries again, a revoked device too (a 401 screen comes later). While the socket is open the 30-second poll stops; while it is down the poll runs as in CARD-033 (the "10 s for 2 min" poll of section 8.3 is not built: the socket makes it unneeded). When the device unlocks or the screen goes off, the socket is closed. A grant reaches the emulator in about a second. FCM, for a device that is not blocked or has its screen off, comes in CARD-034b. `server/scripts/dev-grant.ts` adds or removes time through the API as the family's first parent, so the push can be tried without the parent app.

As built (CARD-035): the main screen and the block screen have **Ask for more time** and **Message Mum and Dad** (the names are the family's parents, oldest first: "Message Dad", "Waiting for Mum or Dad…"). The ask sheet sends `POST /v1/device/time-requests` with 15, 30 or 60 minutes and an optional reason; the message sheet sends a preset (with its `presetId`) or the kid's own words with `POST /v1/device/messages`, then shows "Sent ✓" for 1.5 s. Each send keeps its id for a retry and gets a new one when the kid changes what is sent. There is no queue: offline, the sheet says "Can't reach Dad right now. Check the internet and try again." and the kid taps **Send** again; a 409 (already asked) closes the sheet like a success. After a send the screen asks the service to sync, so the snapshot's `pendingRequest` shows "Waiting for Dad…" (pulsing dot) and greys out **Ask for more time**. While a request waits and the screen is on, the live channel stays open even when the device is not blocked. A `request_resolved` envelope shows "Dad said yes! +30 min 🎉" (green) or "Dad said not this time" for 4 s on whichever screen is up, and as a heads-up notification (channel "Answers from your parents"); the snapshot then brings the grant. The notification actions, the contact row, Emergency, SOS and "I'm the parent" come in later cards. `server/scripts/dev-answer.ts` answers the kid's pending request as the family's first parent, for trying it on the emulator.

As built (CARD-036): on a phone with a SIM (`device.form` phone and `hasCellular`), the block screen has a row of round call buttons above **Ask for more time** (each parent with a mobile, oldest first, then the kid's contacts in the parents' order; 64 dp circles in the avatar colours with the initials, the name under it; the row scrolls sideways) and **Emergency 000** (the family's number, outlined in the dark theme's light red) under **Message**; tablets and phones without a SIM have neither. A tap calls at once with `TelecomManager.placeCall`; **Emergency** opens the dialer with the number filled in (`ACTION_DIAL`). The Lock Task list now holds, on a phone, the default phone app, the phone app the phone came with and `com.android.server.telecom` (the "Call with" choice on two-SIM phones), so the call screen and the dialer open over the block screen and Back or hanging up returns to it. `calls/CallGuard` is the `CallRedirectionService`: while blocked it cancels a call to any number that is not on the list or the family's emergency number, with a toast "Right now you can only call the people on your list"; numbers match after taking out spaces, dashes, dots and brackets, and the national form with a leading 0 matches the international one. Android never asks it about emergency numbers, and while the device may be used, or before the first status, every call goes through. It only works while the app holds the call redirection role, given with adb at setup; without it the app logs a warning at every start (the tamper event and the "caught" screen for a stopped call, and for a missing role, come with CARD-039). The block screen now scrolls when it does not fit (a phone on its side). `server/scripts/dev-contacts.ts` gives the family's first parent a mobile number and sets a kid's contacts through the API, for trying it on the emulator.

**Blocked state (Q2, Q28):** when the engine says `locked`, the app starts `BlockActivity` and calls `startLockTask()`. Home, Recents and the notification shade are disabled. The same screen is used for out of time, bedtime and before wake; only the copy changes. On unlock (grant, wake-up or parent mode) it calls `stopLockTask()` and finishes.

From the block screen:

- **Phones with cellular:** call buttons for each parent and each always-callable contact (`ACTION_CALL`), an emergency button that opens the dialer with the family emergency number filled in (`ACTION_DIAL`, apps cannot place emergency calls directly), and SOS (section 15). While locked, `CallRedirectionService` cancels outgoing calls to numbers not on the list; emergency numbers always go through.
- **All devices:** Ask for more time, Message Mum/Dad, I'm the parent.
- **Tablets and Wi-Fi devices:** no call, emergency or SOS buttons (Q28, Q31).

Messages and requests are sent through the server. If the phone has no data, the message is offered as an SMS to all parents instead ("No internet. Send as a text?").

**minSdk = 34 (Android 14)**, decided 22 Oct 2026: the XPPen tablet runs Android 14 and the Pixel 7 is newer. This lets the app use foreground service type `systemExempted` everywhere with no fallback code. `targetSdk` = 36 and `compileSdk` = 37 (Compose 1.12, in BOM 2026.09, requires compileSdk 37; found 22 Oct 2026). The parent app uses the same minSdk.

### 12.2 Windows kid enforcer

**Install** (documented in `docs/guides/windows-install.md`): kids use **standard** accounts, parents use admin accounts. A parent runs the MSI as admin. The installer asks for the server hostname, then lists local standard accounts; for each kid account the parent enters an enrolment code. The service is registered for automatic start, restart on failure (0 s, 5 s, 30 s) and Safe Mode (`SafeBoot\Minimal` and `Network` registry keys).

**ScreenTime.Service** (LocalSystem, Native AOT):

- Tracks sessions with `SERVICE_CONTROL_SESSIONCHANGE`: segment starts on logon or unlock of a **mapped** kid account on the active console session; ends on lock, logoff, disconnect, suspend and shutdown (Q19, no idle pause).
- Keeps the WebSocket, uploads usage every 60 s, runs the engine per mapped account, stores state in SQLite at `C:\ProgramData\ScreenTime\state.db`.
- Starts `ScreenTime.Tray.exe` in each mapped kid session with `CreateProcessAsUser`, and restarts it within 2 s if it exits.
- Talks to the tray over a named pipe `\\.\pipe\ScreenTime.<sessionId>`, ACL: SYSTEM and that kid's SID only. Messages are JSON lines.

**Lock (Q7):** at zero (or bedtime, or before wake) the service tells the tray to call `LockWorkStation()`. If the tray does not confirm within 2 s, the service calls `WTSDisconnectSession` on that session, which also returns to the lock screen. The kid is never signed out. If the kid unlocks while still out of time, the tray shows a toast "Out of Screens time. Ask Mum or Dad." and the session is locked again after 10 s. Usage during those 10 s is not counted.

**Locked PC (Q32):** the Windows lock screen cannot show our buttons. The kid asks in person or from their phone; a parent grants time or starts parent mode remotely from the parent app, and the kid can then unlock normally.

**Hardening at install** (PCs are Windows 11 Pro): remove the "Change the time zone" right (`SeTimeZonePrivilege`) from kid accounts via `LsaRemoveAccountRights` (works on any edition, no Group Policy needed); the guide also recommends a BIOS password and disabling USB boot. Pro also allows Local Group Policy and AppLocker, which the future app-allowlist feature can use.

### 12.3 Parent mode (Q15, Q24)

Parent mode makes one kid device unlocked and not counting for a chosen time. It is the only pause.

1. On the kid device the parent taps **I'm the parent**.
2. Device sends `POST /v1/device/parent-mode-requests`. Every parent gets a `parent_mode.request` push with actions. A parent opens it (biometric unlock), picks **2 min, 5 min, 15 min, 1 h or Until I end it**, and approves. The device gets a `parent_mode` push and unlocks.
3. If the device is offline, or no one answers, the same screen offers **Enter parent code**: a 6-digit TOTP (RFC 6238, SHA-1, 30 s step, accept ±1 step) shown in the parent app, computed from the family `parent_code_secret`. After a correct code the device asks the duration and starts locally, then reports it with `POST /v1/device/parent-mode` (sent again until the server has it), which raises a `parent_mode.used` event.
4. A parent can also start parent mode remotely from the parent app's device screen (needed for a locked Windows PC).
5. While active: no segments are recorded, Lock Task is off, and a banner/notification says "Parent mode · ends 4:15 pm" with **End now**.
6. "Until I end it" lasts until a parent ends it on the device or in the parent app.
7. All parents get a `parent_mode.used` notification whenever it starts (Q15).

As built (CARD-037), on the Android kid app: **I'm the parent** is a quiet text button at the bottom of the main screen and the block screen. It opens "Hand to a parent", which at once sends `POST /v1/device/parent-mode-requests` (one id each time it opens; a 409 means parent mode is already on) and says "We've asked Mum and Dad to approve." with a spinner; while it is open the live channel stays open, so a parent's yes unlocks within seconds and a no shows "Dad said no.". **Enter parent code instead** asks for the 6 digits (number keypad), checks them on the device against the family secret from the state snapshot (`family.parentCodeSecret`) and the trusted clock, and then asks "How long?" (2 min, 5 min, 15 min, 1 hour, Until I end it). The service keeps a code session and an **End now** in SharedPreferences (`parent_mode`) until the server has them, and sends them before each sync (`POST /v1/device/parent-mode`, then `POST /v1/device/parent-mode/end`). Parent mode is on when the snapshot's `parentMode` says so (until its `endsAt`), or when a code session the latest snapshot cannot know about yet is still running; an **End now** on the device beats any snapshot made before it. While it is on, the block screen closes, nothing is recorded, the notification says "Parent mode · ends 4:15 pm" / "Time isn't counting" with an **End now** action, the main screen shows the same line with **End now** in place of the kid's buttons, and the live channel stays open while the screen is on so a parent can end it from the app. When it ends (its time runs out, **End now**, or a parent ends it) the device is blocked again at once if it is out of time or bedtime. `server/scripts/dev-parent-mode.ts` answers yes or no, prints the parent code, or ends parent mode as the family's first parent, for trying it on the emulator.

## 13. Notifications

Parent notifications go to the Android parent app by FCM. The web app shows the same items in its inbox and as banners while open (polling `/v1/events` every 30 s), and sends no browser push in v1.

| Kind | When | Essential (cannot be turned off) |
|---|---|---|
| `sos.started`, `sos.acked`, `sos.extended`, `sos.ended` | Section 15 | Yes, critical alert |
| `tamper.*` | Section 14 | No |
| `parent_mode.request` | Kid asks for parent mode | Yes |
| `parent_mode.used` | Parent mode started on any device | No |
| `time_request` | Kid asks for more time | Yes (James, 25 Oct 2026) |
| `kid_message` | Kid sends a message | No |
| `overspend` | Offline overspend detected | No |
| `device.offline` | Not seen for 6 h during allowed hours | No |
| `device.enrolled` | New device added | No |
| `grant.by_other_parent` | The other parent changed time (from the `grant.added` event every grant writes, payload `{ grantId, pool, minutes, byName, lockNow }`) | No |

Rule (James, 22 Oct 2026, confirmed 25 Oct for "ask for more time"): SOS and every request that waits for a parent's answer (`parent_mode.request`, `time_request`) are essential; every informational kind can be switched off per parent. Sign-in code emails are always sent. Tamper and parent-mode-used are informational (confirmed). Muting only stops the push: **every** kind is always written to `events` and always shown in the event history (Inbox) in the parent app and web app.

Who gets a push: every signed-in parent app (an unrevoked parent session with a push token) of an enabled parent in the family, unless that parent turned the kind off. `sos` covers every `sos.*` event and `tamper` every `tamper.*` event. `grant.by_other_parent` is not sent to the parent who made the grant. Event kinds without a notification kind are history only: `time_request.resolved` (payload `{ requestId, approved, minutes, byName }`, written when a parent answers; a yes also writes `grant.added`, so the other parent hears about it as `grant.by_other_parent`). Payloads (CARD-018): `time_request` `{ requestId, pool, minutes, reason }`, `kid_message` `{ messageId, body }`. Parent mode (CARD-019): `parent_mode.request` `{ requestId }`; `parent_mode.used` `{ sessionId, method, durationMin, endsAt, byName }` (every start, `byName` null for the code; all parents get it, the one who started it too); history only: `parent_mode.denied` and `parent_mode.ended` `{ sessionId, byName }` (`byName` null when the device ended it). SOS (CARD-020): `sos.started` `{ sosId, startedAt, location }` (`location` as in `/v1/sos`, or null), `sos.acked` `{ sosId, byName }`, `sos.extended` `{ sosId, autoStopAt, byName }`, `sos.ended` `{ sosId, endedBy, byName }` (`endedBy` `kid` with `byName` null, or `parent`); every parent gets each, the one who acted too, and the parent app only rings the alarm for `sos.started`. Tamper (CARD-019b), suggested payloads from the device: `tamper.clock` `{ deviceTime, trustedTime, skewSec }`, `tamper.timezone` `{ from, to }`, `tamper.tray_killed` `{ exits }`, `tamper.policy` `{ policy }`, `tamper.call_blocked` `{ number }`.

Android parent app channels: `critical` (SOS: high importance, bypass Do Not Disturb, full-screen intent, alarm sound on the alarm stream looping until acknowledged), `alerts` (tamper, parent mode: high importance), `requests` (time requests, messages: default importance), `info` (the rest: low). First-run setup asks the parent to allow notifications, Do Not Disturb access and full-screen intents.

Kid device notifications: persistent status (silent), warnings at `warn1Min` and `warn2Min` before `nextLockAt` (heads-up with vibration, "15 minutes of Phone left"), time changes ("Dad added 15 minutes"), request answers, parent mode.

## 14. Tamper detection (Q20)

| Event kind | Detected by | Device reaction |
|---|---|---|
| `tamper.clock` | Wall clock jumps > 2 min from trusted time | Keep trusted time, caught screen |
| `tamper.timezone` | Device time zone changed (Windows) | Keep family time zone, caught screen |
| `tamper.tray_killed` | Tray helper exits 3 times in 10 min (Windows) | Restart, caught screen |
| `tamper.policy` | A Device Owner policy found missing at startup (Android) and re-applied | Re-apply, caught screen |
| `tamper.call_blocked` | Outgoing call to a non-listed number while locked | Call cancelled, caught screen |
| `tamper.offline_usage` | Usage uploaded that was recorded offline for > 30 min | none (server side) |
| `device.offline` | Server job: not seen 6 h during allowed hours | n/a |

Things Device Owner simply blocks (uninstall, force stop, safe mode, factory reset from Settings, date change) are not events.

**Caught screen:** cheesy on purpose, for ages 11 and 13. Full screen on Android (shown over everything for 8 seconds, then returns to whatever state applies); on Windows a large toast plus a flyout card. Copy rotates through:

- "Nice try, Agent Alex! 🕵️ Mum and Dad have been told."
- "Busted! 🚨 The Time Police have filed a report."
- "Whoa there, hacker! 💻 This attempt has been sent to HQ (Mum and Dad)."

Parents get a `tamper.*` notification with what happened and when. Devices report through `POST /v1/device/events` (section 9.2) and keep a queue while offline; sending the queue again is safe.

As built (CARD-039), on the Android kid app: three attempts are detected. **`tamper.clock`**: when Android says the clock was set (`TIME_SET`) and the trusted clock has the server's time for this boot, a wall clock more than 2 minutes from trusted time is an attempt, with payload `offsetMin` (minutes ahead, negative when behind). Trusted time does not move, so nothing extra counts. Device Owner already stops the kid changing the date in Settings; `adb shell cmd alarm set-time` still can (USB debugging, which release builds turn off), and the emulator run uses it. **`tamper.policy`**: every `Policies.apply` (each service start and each time the setup screen is shown after enrolment) reads back which policies are on (the user restrictions, auto time, auto time zone, and in release builds no debugging and uninstall blocked) before and after applying them, and keeps the "after" set in SharedPreferences (`policies`); one that was on after the last run and is found off is turned on again, logged, and reported with payload `missing` (comma-separated names, for example `auto_time`). A policy new in an app update is not missing. A missing call redirection role is still only a warning in the log. **`tamper.call_blocked`**: each call `CallGuard` stops while blocked, with no payload (the number is never sent or logged). The same kind again within a minute is the same attempt: logged only, no event and no caught screen. Events wait in SharedPreferences (`tamper`, the newest 100) and are sent before every sync, 50 per upload; any answer from the server counts as sent. The **caught screen** is `tamper/CaughtActivity`: full screen, fading between police blue and red, a big emoji, the headline, the line under it with the parents' names ("Nice try, Agent Alex!" / "Dad has been told.", "Busted!" / "The Time Police have filed a report.", "Whoa there, hacker!" / "This attempt has been sent to HQ (Dad)."), taking turns, a tilted white "REPORTED" stamp and "Back in 8 s". It shows as soon as the screen is on and unlocked (an attempt with the screen off waits for the next unlock), never over an SOS, and closes itself after 8 seconds; Back does nothing. It opens in the block screen's task, so while blocked it sits on top of the block screen in Lock Task and the block screen is what is left when it closes.

## 15. SOS (Q31)

Phones with cellular only.

1. **Trigger:** a red SOS button on the block screen and in the kid app's main screen. Press and hold for 2 seconds (a ring fills), then a 5-second countdown with a large **Cancel** button.
2. **SMS at once:** `SmsManager` sends to every parent with a phone number (no prompt, Device Owner grants SMS): "SOS from Alex. Location: https://maps.google.com/?q=-33.8,151.2 (±20 m). Battery 54%." Works without data.
3. **Server:** `POST /v1/device/sos` → `sos.started` critical push to every parent app and an email to every enabled parent (subject "SOS from Alex", the local time, the map link and battery, CARD-020).
4. **Live location:** fused location every 30 s over data (`/locations`), or one SMS every 5 min if there is no data. Auto stop after 2 h; a parent can extend by 2 h.
5. **Parent app:** full-screen red alert with the kid's name, time, last location (lat/lng, accuracy, age), battery, **Open in Maps** (geo intent), **Call Alex**, **I'm on it** (ack) and **End SOS**.
6. **Acknowledge:** the kid sees "Dad has seen your SOS" and big call buttons for each parent, plus a separate emergency number button.
7. **End:** the kid holds **I'm safe** for 2 s, or a parent taps **End SOS**. Every parent gets "SOS ended" by push and SMS with the last location. History is kept.
8. SOS usage is not counted and SOS works in any state (locked, unlocked, parent mode, offline).
9. **Auto stop:** the API shows an SOS past `autoStopAt` as ended by `auto` at once; the server's sweep (once a minute) then stores it (`ended_at = auto_stop_at`, `ended_by_kind = auto`) and writes `sos.ended` `{ sosId, endedBy: 'auto', byName: null }`, which every parent gets. Nothing is sent to the phone: it stops sharing by itself (CARD-021).

As built (CARD-038), on the Android kid app: only a phone with a SIM has the **SOS** button, a 72 dp red circle in the top corner of the main screen and the block screen. A tap only shows "Hold the SOS button for 2 seconds"; holding it fills a ring for 2 seconds, then a full-screen red countdown from 5 with a big white **Cancel**. At zero the SOS screen covers whatever is up (main screen or block screen, in any state): "SOS is on", "Telling Mum and Dad…" until the server has it, then "Sent to Mum and Dad. They can see where you are." (or "No internet. We texted Mum and Dad where you are."), "✓ Dad has seen your SOS" after a parent's "I'm on it", a call button for each parent with a mobile, **Emergency 000**, and **Hold: I'm safe** (2 seconds). The phone waits up to 10 seconds for a position from Android's own location providers (fused, GPS, network; no Play services), texts every parent with a mobile ("SOS from Alex. Location: https://maps.google.com/?q=-33.86880,151.20930 (±20 m). Battery 54%."), then sends `POST /v1/device/sos` with that position. Every 30 seconds, screen on or off, it takes the newest position and sends what the server does not have (`/locations`, 100 at a time); with no answer from the server for 5 minutes it texts the position again, and that position goes up later as `via: sms`. Everything waits in SharedPreferences (`sos`) until the server has it. Device Owner grants SMS, phone state (splitting a text into parts reads the SIM's group id, which needs `READ_PHONE_STATE`) and location (including background), and turns location on when an SOS starts (CARD-038b). Texts go out on their own thread, because Android calls the default messaging app while sending and a slow one must not hold up the SOS (CARD-038c). During an SOS the phone syncs every 5 minutes while the live channel is open and every 30 seconds while it is down, and at once when the network comes back with something still to send. Nothing counts during an SOS, the live channel stays open while the screen is on, and the notification says "SOS is on" and who has seen it. The SOS ends when the kid holds **I'm safe** (`POST /v1/device/sos/{id}/end`), when a parent ends it (`sos_ended`, or a snapshot made after the server got the SOS whose `activeSos` no longer has it), or at `autoStopAt` (moved by `sos_extended`); then every parent gets a text ("Alex is safe: SOS ended. Last location: …", "Alex's SOS was ended by Dad.", "Alex's SOS has stopped by itself."). A parent's "I'm on it" only reaches the phone over the live channel until FCM (CARD-034b). `server/scripts/dev-sos.ts` plays the parent (seen, longer, end) and shows the kid's newest SOS, for trying it on the emulator.

## 16. UX and visual direction

### 16.1 Design tokens (all apps)

Calm, friendly, rounded. Kids see big type and few words; parents see dense but tidy information.

| Token | Light | Dark | Use |
|---|---|---|---|
| `primary` | `#0F766E` | `#2DD4BF` | buttons, rings with plenty of time |
| `onPrimary` | `#FFFFFF` | `#042F2E` | |
| `background` | `#F7F7F5` | `#0C0A09` | |
| `surface` | `#FFFFFF` | `#1C1917` | cards, sheets |
| `surfaceVariant` | `#EFEFEB` | `#292524` | chips, inputs |
| `onSurface` | `#1C1917` | `#F5F5F4` | text |
| `muted` | `#57534E` | `#A8A29E` | secondary text |
| `outline` | `#D6D3D1` | `#44403C` | borders |
| `warning` | `#D97706` | `#FBBF24` | 15 min or less |
| `critical` | `#EA580C` | `#FB923C` | 5 min or less |
| `danger` | `#DC2626` | `#F87171` | SOS and destructive only |
| `night` | gradient `#1E1B4B` → `#312E81` | same | block screen background |
| `onNight` | `#E0E7FF` | same | text on block screen |

Kid avatar colours (8): `#0F766E` teal, `#7C3AED` violet, `#DB2777` pink, `#2563EB` blue, `#EA580C` orange, `#16A34A` green, `#CA8A04` gold, `#475569` slate.

Typography: Android uses the system font (Roboto) with Material 3 type scale; the big remaining-time number is `displayLarge` 57 sp, bold, tabular figures. Web uses Inter (self-hosted via `@fontsource-variable/inter`). Windows uses Segoe UI Variable.

Shape and spacing: 8 px grid; cards 16 px radius; buttons fully rounded (pill) 48 dp minimum height (56 dp for kid buttons); sheets 28 px top radius.

Icons: Material Symbols Rounded on Android, lucide on web, Segoe Fluent Icons on Windows.

Time formatting: "1h 12m", "45m", "less than a minute". Times of day in the family locale, 12-hour with am/pm ("8:30 pm") (en-AU, decided).

Copy tone: short, warm, Australian English ("Mum"). The kid UI never shows error codes.

### 16.2 Android kid app

**Persistent notification (Q23):** silent channel, small icon hourglass, title "Phone · 1h 12m left", text "Bedtime 8:30 pm". Uses the notification chronometer counting down to `nextLockAt` (no app wake-ups). Actions: **Ask for more**, **Message**. While locked: "Out of Phone time". While parent mode: "Parent mode · ends 4:15 pm" with **End now**.

**Main screen** (opened from launcher or notification), phone portrait:

```
┌──────────────────────────────┐
│ Hi Alex                 ⚙︎?  │  (no settings for kids; only a help icon)
│                              │
│        ╭──────────╮          │
│       │  1h 12m   │          │  ring 240 dp, stroke 20 dp
│       │ Phone left │          │  ring colour primary > 15 min, warning ≤ 15, critical ≤ 5
│        ╰──────────╯          │
│      Bedtime 8:30 pm         │
│                              │
│  [  Ask for more time     ]  │  filled primary, 56 dp
│  [  Message Mum or Dad    ]  │  tonal
│                              │
│  (SOS)  hold for help        │  red circle 72 dp, phones only
│                              │
│        I'm the parent        │  text button, muted
└──────────────────────────────┘
```

Tablet or landscape (window width ≥ 600 dp): ring on the left half, buttons in a column on the right.

**Block screen:** full screen, `night` gradient, no system bars. Top: current time small (`onNight` 70% opacity). Centre: an illustration (moon and stars for bedtime and before wake, hourglass for out of time, 160 dp, simple flat vector), headline 32 sp bold ("It's bedtime", "Out of Phone time", "Not yet, it's early"), subline ("Phone is back at 7:00 am" / "New time tomorrow"). Below: on phones a horizontal row of round contact buttons (64 dp circles with initials in avatar colours, label under), then a 2×2 grid of large rounded buttons: **Ask for more time**, **Message**, **Emergency 000** (outlined `danger`), **SOS** (filled `danger`). Tablets show only **Ask for more time** and **Message**. Bottom: **I'm the parent** text button.

**Ask for more time sheet:** title "How much more?", three large chips **15 min**, **30 min**, **1 hour** (15 selected), optional reason field "Why? (optional)" with 0/160 counter, **Send** button. After sending, the block screen shows a card "Waiting for Mum or Dad…" with a gentle pulsing dot; one pending request at a time. Answer arrives as "Dad said yes! +15 min 🎉" (green card, 4 s) or "Dad said not this time" (neutral card).

**Message sheet:** title "Message Mum and Dad", presets as tappable full-width chips, then "Or write your own" field with 0/160 counter, **Send**. Confirmation "Sent ✓".

**Parent mode screen:** title "Hand to a parent", text "We've asked Mum and Dad to approve.", spinner, then **Enter parent code instead** which reveals a 6-digit code entry (large boxes, numeric keypad). After a correct code: duration chips **2 min, 5 min, 15 min, 1 hour, Until I end it**.

**Warnings:** heads-up notification at warn 1 and warn 2. At warn 2 on the phone also a brief vibration pattern.

**SOS screens:** countdown: red full screen, huge number 5…1, **Cancel** button white pill. Active: red background, "SOS sent", list of parents with a tick when they have seen it, call buttons, emergency button, **I'm safe** (hold 2 s).

**Setup screen** (first run): if not Device Owner, show "Ask a parent to finish setup on a computer" with the guide URL. If Device Owner but not enrolled: **Scan QR code** (camera) or **Enter code** (6 boxes), then "This phone belongs to Alex. Correct?" **Yes**.

As built (CARD-030 and CARD-030b): not Device Owner → "Ask a parent to finish setup", the guide path and **Check again**. Device Owner, not enrolled → "Connect to your family", **Scan QR code**, "or type the code", 6 code boxes, **Connect**, and under it "Server: screentime.gallagherhome.au **Change**" (debug builds start at `http://10.0.2.2:8080`, the PC as seen from the emulator, and also accept `http://`). **Scan QR code** grants the camera through Device Owner (asks only if that fails) and shows the back camera full screen with a white 260 dp frame, "Point the camera at the QR code on Mum or Dad's phone" and **Cancel**. The first QR code seen is read with `parseEnrolLink`: a `screentime://enrol` link fills the server and code and connects at once; anything else goes back with "That QR code isn't from Screen Time." The app also opens `screentime://enrol` links itself (the phone's camera app, or `adb shell am start` on the emulator), which do the same as a scan. The QR host is reached over `https://`; debug builds use `http://` for a host with a port, like `10.0.2.2:8080`. Errors are short sentences, never codes (401 wrong or expired code, 409 a PC code, 429 too many tries, no connection). After `POST /v1/enrol` the token is stored at once and the kid sees "This phone belongs to Alex. Correct?" **Yes** / **No, that's not me**. **No** forgets the token (the device stays listed until a parent removes it). **Yes** applies the Device Owner policies and shows "All set, Alex"; the main screen replaces that in CARD-032.

### 16.3 Windows tray

**Tray icon:** hourglass glyph, with a small dot: teal (plenty), amber (≤ 15 min), orange (≤ 5 min), grey (offline, still counting). Tooltip "Screens · 1h 12m left".

**Flyout** (left click; 360 × 440 px, Mica, 8 px radius, anchored above the tray):

```
┌────────────────────────────────┐
│  Alex · Screens                │  14 pt semibold
│  1h 12m                        │  40 pt semibold, tabular
│  left today                    │
│  ███████████░░░░░  (progress)  │  colour by state
│  Bedtime 8:30 pm               │
│                                │
│  [ Ask for more time ]         │  accent button
│  [ Message Mum or Dad ]        │  standard button
│                                │
│  I'm the parent                │  hyperlink button
│  ───────────────────────────── │
│  Synced just now               │  caption, muted; "Offline · still counting"
└────────────────────────────────┘
```

Ask and Message open small dialogs with the same options as Android. Parent mode on Windows: dialog "Approve on your phone, or enter the parent code", 6-digit box, then duration choice.

**Toasts:** at warn 1 "15 minutes of Screens left", at warn 2 "5 minutes left. Save your work.", on grants "Dad added 15 minutes", and the relock toast in 12.2.

### 16.4 Android parent app

Navigation: bottom bar on phones (**Today**, **Inbox**, **Kids**, **Settings**), navigation rail on tablets with list-detail layout.

**Today** (Q18): one card per kid: avatar circle (40 dp, initial on avatar colour), name, then one row per pool:

```
Screens   ███████░░░  45m left · 1h 15m used     [ ± ]
Phone     ██░░░░░░░░  Locked · bedtime            [ ± ]
```

Status chips under each kid: "Using PC now", "Parent mode on Pixel 7 · 10 min", "Tablet offline 7h". An overspend shows an amber chip "12m over (tablet was offline)".

**Adjust sheet (Q8):** pool segmented control (Screens | Phone), a vertical wheel picker in 15-minute steps from −4h to +8h, default +15m, with live preview "Now 45m left → 1h 00m left". Buttons **Apply** and a small **Lock now** text button (danger colour, confirm dialog).

**Inbox:** pending time requests at top as cards ("Alex wants 30 min of Phone · 'finishing homework video'") with **Yes** (opens the roller preset to the requested amount) and **No**; then messages and events in time order.

**Kids › kid:** today summary, devices (name, form icon, last seen, **Parent mode**, rename, remove), **Schedule** editor (7 rows: day, Screens, Phone, Wake, Bedtime as tappable time chips; **Copy Monday to weekdays** and **Copy Saturday to weekend**; warnings 15/5 steppers), **Always callable** contacts list (add from phone contacts or type), **Add device** (pick Phone, Tablet, PC → full-screen QR code plus the 6 digits in 48 sp and a 10-minute countdown).

**Parent code:** reachable from Settings and from the parent mode notification: the 6-digit code in 48 sp with a circular 30-second countdown.

**SOS alert:** full-screen red activity (shown over the lock screen), as in section 15.

**Settings:** notification switches (essential ones shown on and disabled with "Always on"), message presets editor, family (parents list, add parent), time zone, sign out.

Unlock: biometric prompt on open (section 11.1). App lock screen shows the app icon and **Unlock**.

### 16.5 Parent web app

Same functions as the parent app except SOS alarms (the web shows a red banner at the top of every page while an SOS is active, with the map link) and parent code (also shown in Settings).

Development (CARD-022): `pnpm dev:web` serves the app on http://localhost:5173 and passes `/v1/*` and `/health` to the API on :8080, so the browser sees one origin (in production the server serves the build, CARD-027). Routes are defined in code (TanStack Router, no generator); components are shadcn/ui-style files in `web/src/components/ui` with our tokens, not the shadcn defaults.

Layout: left sidebar 240 px on ≥ 1024 px (Today, Inbox, Kids, Settings, and Admin for the super admin), top bar with a menu sheet below 1024 px. Content max width 1100 px. shadcn/ui components themed with the tokens in 16.1; light and dark follow the OS.

Pages: Sign in (email, then 6-digit code boxes), Today (kid cards as 16.4 in a responsive grid; the adjust sheet is a dialog with − and + buttons in 15-minute steps and quick amounts +15m, +30m, +1h, +2h instead of the wheel, CARD-023; a device silent for 6 hours shows an offline chip), Kids (one row per kid, **Add kid**, CARD-024), Kid detail (tabs: Today, Schedule, Devices, Contacts, CARD-024: the schedule uses selects in 15-minute steps instead of time chips, allowances up to 12 h and bedtime up to midnight; warnings are picked from 10/15/20/30/45/60 and 1/2/3/5/10 min; **Add device** asks for the device list every 3 s while the code is valid and says when the new device is connected; a PC code has no QR code; contact numbers are stored in E.164, and a 10-digit Australian number starting with 0 gets +61), Inbox (CARD-025: waiting time requests with **Yes**, **No** and **Other amount**, and parent-mode requests found in the events, a parent_mode.request under 10 minutes old with no used/denied/ended event for its session; then the event history, 50 at a time, refreshed every 30 s; the SOS banner checks `/v1/sos?active=true` every 15 s and uses the light theme's danger red in both themes), Settings (CARD-025b: one column of cards: the parent code first, hidden until **Show code**, worked out in the browser with Web Crypto and a 30 s ring, and **Make a new code** to rotate the secret; notification switches for the signed-in parent with the essential kinds shown as always on and listed first; up to 10 message presets saved as one list, with move up; parents add, edit and remove, never yourself, with a warning when a parent has no mobile; family name, time zone and emergency number, after which the sign-in is refreshed so every page uses the new time zone), Admin (CARD-026: families list, oldest first, with time zone, parent count, start date and a Disabled chip; **New family** dialog: name, time zone (the browser's by default), emergency number (000) and the first parent's email, name and optional mobile; each enabled family has **Add parent** and **Disable family** with a confirm step; a disabled family cannot be turned back on; a super admin with no family goes straight from sign-in to Admin).

## 17. Pending decisions

| # | Decision | Blocks |
|---|---|---|
| P1 | ~~XPPen Android version~~ Decided: Android 14, minSdk 34 | none |
| P2 | ~~Essential notifications~~ Decided: only SOS and approval requests; everything else mutable but always in event history | none |
| P3 | ~~Email provider~~ Decided: Brevo SMTP relay, sender "ScreenTime App" <no-reply@gallagherhome.au> | none |
| P4 | ~~Public hostname~~ Decided: `screentime.gallagherhome.au` (not configured yet) | none |
| P5 | ~~Windows edition~~ Decided: Windows 11 Pro on both PCs | none |
| P6 | ~~XPPen Play services~~ Decided: yes, it has the Play Store, so FCM works on all Android devices | none |
| P7 | ~~FRP account~~ Decided: James's own Google account | none |
| P8 | ~~Firebase project~~ Done: project "ScreenTime", ID `screentime-d307c` (James's Gmail account) | none |
| P9 | ~~Architect's proposed details~~ Accepted by James 22 Oct 2026: time request amounts 15/30/60, "Lock now" as negative grant, SMS fallback for messages, remote parent mode, 12-hour times, package name | none |

## 18. Future (not v1)

- School-hours blocks.
- Cooldown between time requests.
- App allowlists / always-allowed apps (Lock Task allowlist or app suspension on Android; restricted mode with exe and URL allowlists on Windows).
- iOS kid and parent apps (the API is ready).
- Windows credential provider so the lock screen can show Ask / Message / Parent buttons.
- Offline unlock codes for extra time (not just parent mode).
- Offline cap: a device unsynced for 30 minutes may only use half of what was left.
- History and weekly reports.
- MDM extras: app inventory, install/remove apps, location outside SOS, remote wipe.
- Accessibility-service fallback for devices that cannot be Device Owner.
- Browser push for the web app.
- Self sign-up for other families (super admin creates families in v1).
- Android developer verification (2027): register a free limited-distribution account and re-check that ADB installs stay exempt.
