# Screen Time: specification

Status: v1 draft for review, 22 Oct 2026. This file is the single source of truth for what we build. If a card, a PR or a comment disagrees with this file, this file wins until it is changed by a reviewed PR.

Philosophy: **keep it simple**. Build the smallest thing that meets the requirement, and prefer boring, well documented platform features over clever ones.

Markers used below:

- **[PENDING]** a decision we know we still need. Listed again in section 17.
- **[PROPOSED]** a detail the architect chose that James has not explicitly confirmed. Build it as written unless James changes it.

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

XPPen tablet runs Android 14 (sets minSdk 34, see 12.1). Unknown: Windows edition on the kids' PCs (Home or Pro).

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
| Q17 | Each parent can opt out of non-essential notifications. Essential ones are always on. | 13 |
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
| Android shared code | Plain Kotlin modules: Ktor client, kotlinx.serialization, kotlinx-datetime | Shared by both apps, and KMP-ready for a future iOS parent app. |
| Windows enforcer | C# on .NET 10 (LTS), Worker Service as a Windows service, Native AOT | First-class Windows service support, small native exe, session lock/unlock events. |
| Windows tray | C# WinUI 3 (Windows App SDK) + H.NotifyIcon | Native Windows 11 look (Mica, Fluent) and shares code with the service. |
| Server | TypeScript on Node 24 LTS, Hono, Zod (schemas → OpenAPI), firebase-admin, pg-boss | Small and fast, same language as the web app, reference FCM SDK, native WebSockets. |
| Database | PostgreSQL 18, Drizzle ORM | Row-level security per family, typed queries, migrations. |
| Web | TypeScript, React 19, Vite SPA, TanStack Router + Query, Tailwind CSS v4, shadcn/ui | Modern, typed, static build served by the API container. |
| Contract | Zod schemas → `contract/openapi.json` (committed). Kotlin and C# clients generated from it. CI fails on drift. | One API definition for three languages. |
| Shared maths | `test-vectors/` JSON cases run by the TS, Kotlin and C# engines | All three must compute the same remaining time. |

### 4.2 Hosting

- Two containers on Unraid: `api` (also serves the built web app) and `postgres`. Docker Compose file in `deploy/`.
- One public hostname through the existing Cloudflare Tunnel, for example `screentime.<domain>`. **[PENDING]** exact hostname.
- Web app at `/`, API at `/v1/*`, health at `/health`, device WebSocket at `/v1/device/ws`.
- Cloudflare Access must **not** be put in front of `/v1/*`, because devices authenticate with their own tokens.
- Nightly `pg_dump` to an Unraid share.

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
├── windows/                  one .NET solution (ScreenTime.sln)
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

Every family-owned table has `family_id` and a row-level security policy `family_id = current_setting('app.family_id')::uuid`. The API sets `app.family_id` at the start of each request transaction. The super admin bypasses this through a separate role used only by `/v1/admin/*`.

### 6.1 Tables

**families**: `id`, `name`, `timezone` (IANA, for example `Australia/Sydney`; set when the family is created), `emergency_number` (default `000`), `parent_code_secret` (base32, 20 random bytes, for parent-mode codes), `created_at`, `disabled_at`.

**parents**: `id`, `family_id`, `email` (unique, lower case), `display_name` (what kids see, for example "Mum", "Dad"), `phone_e164` (nullable; used for SOS SMS and the call list), `created_at`, `disabled_at`.

**otp_codes**: `id`, `email`, `code_hash`, `expires_at` (10 min), `attempts`, `consumed_at`, `created_at`. Not family scoped.

**parent_sessions**: `id`, `parent_id`, `family_id`, `refresh_token_hash`, `client` (`web` | `android`), `client_label`, `fcm_token` (nullable, Android only), `created_at`, `last_used_at`, `revoked_at`.

**notification_prefs**: `parent_id`, `kind`, `enabled`. Missing row means enabled. Essential kinds ignore this table (section 13).

**kids**: `id`, `family_id`, `name`, `avatar_color` (one of the 8 tokens in 16.1), `created_at`, `archived_at`.

**kid_contacts** (Q33 always-callable list): `id`, `family_id`, `kid_id`, `label` (for example "Dad", "Grandma"), `phone_e164`, `sort`. Parents with a phone number appear automatically at the top and are not stored here.

**message_presets** (Q29): `id`, `family_id`, `text` (max 160), `sort`. Seeded on family creation with: "Can I have more time?", "I'm done, you can lock it", "Can you call me?", "I'm on my way home", "I need help with homework".

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

**time_requests** (Q25): `id` (client generated), `family_id`, `kid_id`, `device_id`, `pool`, `minutes` (15, 30 or 60) **[PROPOSED]**, `reason` (nullable, max 160), `status` (`pending` | `approved` | `denied` | `expired`), `created_at`, `resolved_by`, `resolved_at`, `grant_id`. Pending requests expire at local midnight.

**kid_messages** (Q29): `id` (client generated), `family_id`, `kid_id`, `device_id`, `body` (max 160), `preset_id` (nullable), `created_at`.

**parent_mode_sessions** (Q15): `id`, `family_id`, `kid_id`, `device_id`, `method` (`push` | `code` | `remote`), `requested_at`, `approved_by` (nullable for `code`), `duration_min` (2, 5, 15, 60, or null = indefinite), `started_at`, `ends_at` (null = indefinite), `ended_at`, `ended_by`.

**sos_incidents** (Q31): `id` (device generated), `family_id`, `kid_id`, `device_id`, `started_at`, `auto_stop_at` (start + 2 h, extendable), `ended_at`, `ended_by_kind` (`kid` | `parent` | `auto`), `ended_by_parent`.
**sos_locations**: `id`, `sos_id`, `at`, `lat`, `lng`, `accuracy_m`, `battery_pct`, `via` (`data` | `sms`).
**sos_acks**: `sos_id`, `parent_id`, `at`.

**events** (audit and notification feed): `id` (client or server generated), `family_id`, `kid_id`, `device_id`, `kind`, `at`, `payload` (jsonb), `created_at`. Kinds are listed in sections 13 and 14.

### 6.2 Super admin

The super admin is not a table row. The Docker env var `SUPER_ADMIN_EMAIL` names one email. Signing in with that email (normal OTP flow) gives the `superadmin` role, which can list, create and disable families and add the first parent to a family. A super admin who is also a parent in a family sees that family normally.

## 7. The time engine (shared maths)

The same pure function is implemented three times: `packages/engine` (TypeScript, used by server and web), `android/core-time` (Kotlin) and `windows/src/ScreenTime.Core` (C#). All three must pass every case in `test-vectors/engine/`.

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
- "Lock now" in the parent app is just a negative grant of the current remaining minutes, rounded up to a whole minute **[PROPOSED]**.

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

A device that cannot reach the server keeps enforcing with what it knows. Segments recorded without server contact are flagged `recorded_offline`. When they arrive, the server recomputes the pool; if `overspendSec > 0` it raises an `overspend` event for parents ("Screens went 12 min over: tablet was offline"). Overspend is never carried to the next day. If an upload makes another online device's pool empty, that device gets the normal warnings, then locks.

### 8.5 Trusted time

- Every server response includes `serverTime`. The device stores `offset = serverTime − monotonic` using a clock the user cannot change (`SystemClock.elapsedRealtime()` on Android, `Environment.TickCount64` / `Stopwatch` on Windows). `trustedNow = monotonic + offset`.
- After a reboot while offline the monotonic clock resets; fall back to wall clock, but never earlier than the last saved trusted time.
- If the wall clock differs from `trustedNow` by more than 2 minutes, keep using `trustedNow` and raise a `tamper.clock` event.
- Local dates, wake and bedtime always use the **family** time zone from the snapshot, never the device's time zone.
- A device not seen for 6 hours during allowed hours raises `device.offline` for parents.

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
| POST | `/v1/auth/otp/verify` | `{ email, code, client, clientLabel }` → `{ accessToken, refreshToken, me }` |
| POST | `/v1/auth/refresh` | `{ refreshToken }` → new pair (refresh token rotates) |
| POST | `/v1/auth/logout` | revokes the current session |
| POST | `/v1/enrol` | `{ code, platform, form, hasCellular, model, osVersion, appVersion, machineId?, windowsUserSid?, windowsUserName? }` → `{ deviceId, deviceToken, kid, family }` |

### 9.2 Parent

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/me` | parent, family, roles |
| PUT | `/v1/me/push-token` | `{ fcmToken }` for this session |
| GET / PUT | `/v1/me/notification-prefs` | list of `{ kind, enabled }` |
| GET / PATCH | `/v1/family` | name, timezone, emergency number |
| GET / POST | `/v1/family/parents` | list, add parent (`email`, `displayName`, `phoneE164`) |
| PATCH / DELETE | `/v1/family/parents/{id}` | edit, disable |
| GET / PUT | `/v1/family/message-presets` | whole list replaced on PUT |
| GET | `/v1/family/parent-code` | `{ secret }` for offline parent-mode codes (cached by the parent app) |
| POST | `/v1/family/parent-code/rotate` | new secret; devices pick it up on next sync |
| GET | `/v1/today` | dashboard: every kid, every pool: `usedSec`, `remainingSec`, `locked`, `lockReason`, `overspendSec`, devices with `inUse` and `lastSeenAt`, active parent mode |
| GET / POST | `/v1/kids` | list, create |
| GET / PATCH / DELETE | `/v1/kids/{kidId}` | read, edit, archive |
| GET / PUT | `/v1/kids/{kidId}/schedule` | PUT writes a new version |
| GET / PUT | `/v1/kids/{kidId}/contacts` | whole list replaced on PUT |
| GET | `/v1/kids/{kidId}/grants?day=YYYY-MM-DD` | today by default |
| POST | `/v1/kids/{kidId}/grants` | `{ id, pool, minutes, note? }` minutes is a non-zero multiple of 15 from the roller, except "lock now" |
| POST | `/v1/kids/{kidId}/enrolment-codes` | `{ form }` → `{ code, qrPayload, expiresAt }` |
| GET | `/v1/devices` | all devices in family |
| PATCH / DELETE | `/v1/devices/{id}` | rename, change pool; DELETE revokes the token |
| POST / DELETE | `/v1/devices/{id}/parent-mode` | start remotely `{ durationMin \| null }`, or end |
| GET | `/v1/requests?status=pending` | time requests |
| POST | `/v1/requests/{id}/approve` | `{ minutes }` (defaults to requested) → creates a grant |
| POST | `/v1/requests/{id}/deny` | |
| POST | `/v1/parent-mode-requests/{id}/approve` | `{ durationMin \| null }` |
| POST | `/v1/parent-mode-requests/{id}/deny` | |
| GET | `/v1/messages?kidId=` | newest first, paged |
| GET | `/v1/events?kidId=&kind=` | newest first, paged |
| GET | `/v1/sos?active=true` | |
| GET | `/v1/sos/{id}` | incident + locations + acks |
| POST | `/v1/sos/{id}/ack` | "I'm on it" |
| POST | `/v1/sos/{id}/extend` | +2 h |
| POST | `/v1/sos/{id}/end` | |

Super admin: `GET/POST /v1/admin/families`, `POST /v1/admin/families/{id}/parents`, `POST /v1/admin/families/{id}/disable`.

### 9.3 Device

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/device/state` | snapshot, ETag (below) |
| POST | `/v1/device/usage` | `{ segments: [{ id, startedAt, endedAt \| null, recordedOffline }] }` up to 500 per call |
| POST | `/v1/device/events` | `{ events: [{ id, kind, at, payload }] }` tamper, parent mode by code, etc. |
| PUT | `/v1/device/push-token` | `{ fcmToken }` (Android) |
| POST | `/v1/device/time-requests` | `{ id, minutes, reason? }` |
| POST | `/v1/device/messages` | `{ id, body, presetId? }` |
| POST | `/v1/device/parent-mode-requests` | `{ id }` |
| POST | `/v1/device/parent-mode/end` | kid device "End parent mode" button |
| POST | `/v1/device/sos` | `{ id, startedAt, location? }` |
| POST | `/v1/device/sos/{id}/locations` | `{ locations: [{ at, lat, lng, accuracyM, batteryPct, via }] }` |
| POST | `/v1/device/sos/{id}/end` | kid pressed "I'm safe" |
| GET | `/v1/device/ws` | WebSocket upgrade, `Authorization: Bearer <deviceToken>` |

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
| `state_changed` | `{ stateVersion }` | nothing, re-syncs |
| `grant_added` | `{ grant, byName }` | "Dad added 15 minutes" (or "Dad removed 15 minutes") |
| `request_resolved` | `{ requestId, approved, minutes, byName }` | "Dad said yes: +15 min" / "Dad said not this time" |
| `parent_mode` | `{ active, endsAt, byName }` | parent mode banner |
| `sos_ack` | `{ sosId, byName }` | "Dad has seen your SOS" |
| `sos_ended` | `{ sosId, byName }` | SOS screen closes |

Every Android push that changes time produces a visible notification, which keeps FCM high priority from being downgraded.

To parent apps: one message per notification kind in section 13, `data` holds what the notification needs (kid name, pool, minutes, ids). SOS uses FCM `priority: high` and the critical channel.

WebSocket extras: client sends `{ "type": "ping" }` every 30 s, server answers `pong`. Usage uploads stay on REST.

## 11. Authentication and security

### 11.1 Parents (Q14)

1. Enter email → server emails a 6-digit code (expires 10 min, max 5 attempts, max 5 codes per email per hour).
2. Verify → access token (JWT, HS256, 15 min, claims: `sub` parent id, `fam` family id, `roles`) and refresh token (opaque 32 random bytes, stored hashed, 90-day sliding, rotated on each use).
3. Android parent app stores tokens in app storage encrypted with an Android Keystore key, and requires `BiometricPrompt` (strong biometric **or** device PIN/pattern) every time the app is opened after 5 minutes in the background.
4. The web app keeps the refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie and the access token in memory.

Email is sent over SMTP using env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`), so any free provider works. **[PENDING]** which provider.

### 11.2 Devices

Each kid device gets an opaque 32-byte token at enrolment, stored hashed on the server. Revoking a device in the parent app kills the token. Android stores it in app private storage (protected by Device Owner restrictions). Windows stores it in `C:\ProgramData\ScreenTime\` with an ACL of SYSTEM and Administrators only.

### 11.3 Enrolment (Q22)

1. Parent: kid → "Add device" → picks Phone, Tablet or PC.
2. Server creates a 6-digit code valid for 10 minutes. The app shows the code in large digits and a QR code containing `screentime://enrol?host=<hostname>&code=<code>`.
3. Kid device: Android setup screen scans the QR (CameraX + ML Kit barcode, bundled model) or takes the code typed in. Windows: the installer asks for server hostname and code.
4. `POST /v1/enrol` → device token. Wrong code: max 5 attempts per code, then the code is burned.
5. Parents get a `device.enrolled` notification.

### 11.4 Server

- Postgres RLS by `family_id` (section 6). The super admin role is used only in `/v1/admin/*`.
- Rate limits per IP and per email on auth and enrolment.
- `JWT_SECRET`, `DATABASE_URL`, `SUPER_ADMIN_EMAIL`, `PUBLIC_HOSTNAME`, SMTP vars and `FIREBASE_SERVICE_ACCOUNT_JSON` come from env. Never commit secrets; `deploy/.env.example` lists them.

## 12. Enforcement per platform

### 12.1 Android kid app (phone and tablet, one APK)

**Setup (Q6/Q9, no wipe)**, documented in `docs/guides/android-provisioning.md`:

1. On the kid device: temporarily remove every account (Settings › Accounts), extra users and guest, and any work profile. Turn on USB debugging.
2. From James's PC: `adb install app-kid.apk`, then `adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver` **[PROPOSED package name]**.
3. Re-add the Google account. Open the app, scan the enrolment QR.
4. The app then applies restrictions, and USB debugging is turned off by `DISALLOW_DEBUGGING_FEATURES`.
5. Also turn on Android's own Emergency SOS with the parents as emergency contacts.

**Device Owner policies applied at startup:**

- `setUninstallBlocked(self)`, user restrictions `DISALLOW_APPS_CONTROL`, `DISALLOW_SAFE_BOOT`, `DISALLOW_FACTORY_RESET`, `DISALLOW_CONFIG_DATE_TIME`, `DISALLOW_DEBUGGING_FEATURES`, `DISALLOW_ADD_USER`, `DISALLOW_AIRPLANE_MODE`. Auto time and auto time zone forced on.
- Factory Reset Protection account set to a parent's Google account **[PENDING: which account]**.
- Self-grant runtime permissions (phone, SMS, location, notifications, camera for QR) with `setPermissionGrantState`.
- Lock Task packages: our app, plus the system dialer / in-call UI package (resolved at runtime from `TelecomManager.getDefaultDialerPackage()`) only on devices with cellular.

**Counting (Q19):** a segment starts on `ACTION_USER_PRESENT` (unlocked) and ends on `ACTION_SCREEN_OFF`, on shutdown, and whenever the device becomes locked by us or enters parent mode. Timestamps only, no ticking timers. Open segment flushed to the local database every minute and on every event.

**Foreground service:** type `systemExempted` (allowed for Device Owner). Holds the persistent notification (16.2). Schedules exactly one `AlarmManager.setExactAndAllowWhileIdle` alarm for the next event (warn 1, warn 2, lock, bedtime, wake, midnight). Starts on boot (`BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED`).

**Blocked state (Q2, Q28):** when the engine says `locked`, the app starts `BlockActivity` and calls `startLockTask()`. Home, Recents and the notification shade are disabled. The same screen is used for out of time, bedtime and before wake; only the copy changes. On unlock (grant, wake-up or parent mode) it calls `stopLockTask()` and finishes.

From the block screen:

- **Phones with cellular:** call buttons for each parent and each always-callable contact (`ACTION_CALL`), an emergency button that opens the dialer with the family emergency number filled in (`ACTION_DIAL`, apps cannot place emergency calls directly), and SOS (section 15). While locked, `CallRedirectionService` cancels outgoing calls to numbers not on the list; emergency numbers always go through.
- **All devices:** Ask for more time, Message Mum/Dad, I'm the parent.
- **Tablets and Wi-Fi devices:** no call, emergency or SOS buttons (Q28, Q31).

Messages and requests are sent through the server. If the phone has no data, the message is offered as an SMS to all parents instead ("No internet. Send as a text?") **[PROPOSED]**.

**minSdk = 34 (Android 14)**, decided 22 Oct 2026: the XPPen tablet runs Android 14 and the Pixel 7 is newer. This lets the app use foreground service type `systemExempted` everywhere with no fallback code. `targetSdk` and `compileSdk` = 36. The parent app uses the same minSdk.

### 12.2 Windows kid enforcer

**Install** (documented in `docs/guides/windows-install.md`): kids use **standard** accounts, parents use admin accounts. A parent runs the MSI as admin. The installer asks for the server hostname, then lists local standard accounts; for each kid account the parent enters an enrolment code. The service is registered for automatic start, restart on failure (0 s, 5 s, 30 s) and Safe Mode (`SafeBoot\Minimal` and `Network` registry keys).

**ScreenTime.Service** (LocalSystem, Native AOT):

- Tracks sessions with `SERVICE_CONTROL_SESSIONCHANGE`: segment starts on logon or unlock of a **mapped** kid account on the active console session; ends on lock, logoff, disconnect, suspend and shutdown (Q19, no idle pause).
- Keeps the WebSocket, uploads usage every 60 s, runs the engine per mapped account, stores state in SQLite at `C:\ProgramData\ScreenTime\state.db`.
- Starts `ScreenTime.Tray.exe` in each mapped kid session with `CreateProcessAsUser`, and restarts it within 2 s if it exits.
- Talks to the tray over a named pipe `\\.\pipe\ScreenTime.<sessionId>`, ACL: SYSTEM and that kid's SID only. Messages are JSON lines.

**Lock (Q7):** at zero (or bedtime, or before wake) the service tells the tray to call `LockWorkStation()`. If the tray does not confirm within 2 s, the service calls `WTSDisconnectSession` on that session, which also returns to the lock screen. The kid is never signed out. If the kid unlocks while still out of time, the tray shows a toast "Out of Screens time. Ask Mum or Dad." and the session is locked again after 10 s. Usage during those 10 s is not counted.

**Locked PC (Q32):** the Windows lock screen cannot show our buttons. The kid asks in person or from their phone; a parent grants time or starts parent mode remotely from the parent app, and the kid can then unlock normally.

**Hardening at install:** remove the "Change the time zone" right (`SeTimeZonePrivilege`) from kid accounts via `LsaRemoveAccountRights`; the guide also recommends a BIOS password and disabling USB boot.

### 12.3 Parent mode (Q15, Q24)

Parent mode makes one kid device unlocked and not counting for a chosen time. It is the only pause.

1. On the kid device the parent taps **I'm the parent**.
2. Device sends `POST /v1/device/parent-mode-requests`. Every parent gets a `parent_mode_request` push with actions. A parent opens it (biometric unlock), picks **2 min, 5 min, 15 min, 1 h or Until I end it**, and approves. The device gets a `parent_mode` push and unlocks.
3. If the device is offline, or no one answers, the same screen offers **Enter parent code**: a 6-digit TOTP (RFC 6238, SHA-1, 30 s step, accept ±1 step) shown in the parent app, computed from the family `parent_code_secret`. After a correct code the device asks the duration and starts locally. It raises a `parent_mode.used` event when it next syncs.
4. A parent can also start parent mode remotely from the parent app's device screen (needed for a locked Windows PC) **[PROPOSED]**.
5. While active: no segments are recorded, Lock Task is off, and a banner/notification says "Parent mode · ends 4:15 pm" with **End now**.
6. "Until I end it" lasts until a parent ends it on the device or in the parent app.
7. All parents get a `parent_mode.used` notification whenever it starts (Q15).

## 13. Notifications

Parent notifications go to the Android parent app by FCM. The web app shows the same items in its inbox and as banners while open (polling `/v1/events` every 30 s), and sends no browser push in v1.

| Kind | When | Essential (cannot be turned off) |
|---|---|---|
| `sos.started`, `sos.update`, `sos.ended` | Section 15 | Yes, critical alert |
| `tamper.*` | Section 14 | No |
| `parent_mode.request` | Kid asks for parent mode | Yes |
| `parent_mode.used` | Parent mode started on any device | No |
| `time_request` | Kid asks for more time | No |
| `kid_message` | Kid sends a message | No |
| `overspend` | Offline overspend detected | No |
| `device.offline` | Not seen for 6 h during allowed hours | No |
| `device.enrolled` | New device added | No |
| `grant.by_other_parent` | The other parent changed time | No |

Rule (James, 22 Oct 2026): approval requests and SOS are essential; every informational kind can be switched off per parent. Sign-in code emails are always sent. Tamper and parent-mode-used are informational (confirmed). Muting only stops the push: **every** kind is always written to `events` and always shown in the event history (Inbox) in the parent app and web app.

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

Parents get a `tamper.*` notification with what happened and when.

## 15. SOS (Q31)

Phones with cellular only.

1. **Trigger:** a red SOS button on the block screen and in the kid app's main screen. Press and hold for 2 seconds (a ring fills), then a 5-second countdown with a large **Cancel** button.
2. **SMS at once:** `SmsManager` sends to every parent with a phone number (no prompt, Device Owner grants SMS): "SOS from Alex. Location: https://maps.google.com/?q=-33.8,151.2 (±20 m). Battery 54%." Works without data.
3. **Server:** `POST /v1/device/sos` → `sos.started` critical push to every parent app and an email to every parent.
4. **Live location:** fused location every 30 s over data (`/locations`), or one SMS every 5 min if there is no data. Auto stop after 2 h; a parent can extend by 2 h.
5. **Parent app:** full-screen red alert with the kid's name, time, last location (lat/lng, accuracy, age), battery, **Open in Maps** (geo intent), **Call Alex**, **I'm on it** (ack) and **End SOS**.
6. **Acknowledge:** the kid sees "Dad has seen your SOS" and big call buttons for each parent, plus a separate emergency number button.
7. **End:** the kid holds **I'm safe** for 2 s, or a parent taps **End SOS**. Every parent gets "SOS ended" by push and SMS with the last location. History is kept.
8. SOS usage is not counted and SOS works in any state (locked, unlocked, parent mode, offline).

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

Time formatting: "1h 12m", "45m", "less than a minute". Times of day in the family locale, 12-hour with am/pm ("8:30 pm") **[PROPOSED for en-AU]**.

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

Layout: left sidebar 240 px on ≥ 1024 px (Today, Inbox, Kids, Settings, and Admin for the super admin), top bar with a menu sheet below 1024 px. Content max width 1100 px. shadcn/ui components themed with the tokens in 16.1; light and dark follow the OS.

Pages: Sign in (email, then 6-digit code boxes), Today (kid cards as 16.4 in a responsive grid), Kid detail (tabs: Today, Schedule, Devices, Contacts), Inbox, Settings, Admin (families table, **New family** dialog: name, time zone, first parent email).

## 17. Pending decisions

| # | Decision | Blocks |
|---|---|---|
| P1 | ~~XPPen Android version~~ Decided: Android 14, minSdk 34 | none |
| P2 | Essential notification kinds (section 13) | Notifications card |
| P3 | Free email provider for OTP (any SMTP) | Deploy card |
| P4 | Public hostname for the Cloudflare Tunnel | Deploy card |
| P5 | Windows edition on the kids' PCs (Home or Pro) | Windows hardening card |
| P6 | Whether the XPPen has Google Play services (needed for FCM) | Android push card |
| P7 | Which parent Google account to use for Factory Reset Protection | Android policies card |
| P8 | Firebase project creation (James, free tier) | Push cards |
| P9 | **[PROPOSED]** items above: time request amounts 15/30/60, "Lock now" as negative grant, SMS fallback for messages, remote parent mode, 12-hour times | the card that builds each |

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
