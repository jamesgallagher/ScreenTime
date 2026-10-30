# Build plan

Ordered list of small cards. Each card is one pull request with one concern. The spec is [SPEC.md](SPEC.md); cards point to the sections they implement.

## How a card moves

1. **Claude** writes the card as `docs/cards/CARD-NNN-<slug>.md` (from [TEMPLATE.md](cards/TEMPLATE.md)) and merges it to `main`.
2. **James** hands the card to **Bob** (local coder LLM, VS Code + QwenCode on James's PC).
3. **Bob** creates branch `bob/card-NNN-<slug>` from the latest `main`, does the work, runs every acceptance command, commits, pushes and opens a PR titled `CARD-NNN: <title>`. Bob never merges.
4. **Claude** reviews the PR on GitHub, asks for fixes or merges it.
5. Cards are written a few at a time, just ahead of Bob, so later cards can use what earlier ones taught us.
6. **UI is Claude's.** When a card has a user interface, Claude builds the front end first, in its own PR merged to `main`: the screens sit behind a small, named seam (a view model or interface) with fake data, so they build and run on their own, and Claude checks them on screen. The card then gives Bob the logic behind the seam, and lists the front-end files Bob must not change. A tiny piece of UI (one toast or dialog) may instead be a copied file in the card.

Rules for sizing: a card should touch one area, change roughly 100 to 500 lines, and be checkable with commands. Anything bigger is split.

Legend: **Size** S (under an hour for Bob), M (a session), L (split if possible). **James** = needs James's hands (hardware, accounts, installs).

## Phase 0: foundation and risk spikes

Spikes come early on purpose: Device Owner + Lock Task on the real phones, and a Windows service that can lock a session, are the two riskiest assumptions.

| Card | Title | Depends on | Size | James | Spec |
|---|---|---|---|---|---|
| 001 | Monorepo skeleton: pnpm workspace, `@screentime/schemas`, server `/health`, placeholder folders | none | S | Node 24 + pnpm installed | 5 |
| 002 | CI for TypeScript: GitHub Actions install, typecheck, test, path filters | 001 | S | | 4.1 |
| 003 | Time engine in TypeScript (`packages/engine`) + first 20 test vectors | 001 | M | | 7 |
| 004 | Android Gradle skeleton: `app-kid`, `app-parent`, `core-model`, `core-time`, `core-ui`, theme tokens, empty screens | 001 | M | Android Studio + SDK (minSdk 34) | 5, 16.1 |
| 005 | Spike: Device Owner + Lock Task + dialer allowlist on Pixel 7 and XPPen; FCM in Doze; Play services check | 004 | M | Phones, ADB | 12.1 |
| 006 | Windows .NET 10 solution skeleton (`.slnx`): Core, Service, Tray, Core.Tests (Installer folder only; MSI is 052) | 001 | S | .NET 10 SDK | 5 |
| 007 | Spike: service session events, tray in kid session, `LockWorkStation`, pipe, RAM, sleep/resume | 006 | M | Kid test account on PC | 12.2 |

## Phase 1: server

| Card | Title | Depends on | Size | James | Spec |
|---|---|---|---|---|---|
| 008 | Docker: server Dockerfile, `deploy/docker-compose.yml` with Postgres 18, Drizzle setup, migration runner | 001 | M | Docker Desktop | 4.2 |
| 009 | API conventions: `@hono/zod-openapi`, error shape, logging, OpenAPI export to `contract/openapi.json`, CI drift check | 002, 008 | M | | 9 |
| 010 | Database schema: every table in section 6, RLS policies, seed script for a dev family | 008 | M | | 6 |
| 011 | Parent auth: OTP request/verify, SMTP mailer, JWT + refresh rotation, rate limits, super admin role, `GET /v1/me` | 009, 010 | M | | 11.1, 6.2 |
| 012 | Family settings, parents, message presets, parent-code secret; super admin `/v1/admin/*` | 011 | M | | 9.2, 6.2 |
| 012b | Kids, schedules (versioned), always-callable contacts endpoints | 012 | M | | 6.1, 9.2 |
| 013 | Enrolment codes, `/v1/enrol`, device token auth, device list/rename/revoke | 012b | M | | 11.3 |
| 014 | Device state snapshot with ETag, usage upload, `/v1/today` using the engine | 003, 013 | M | | 8, 9.3 |
| 015 | Grants endpoints (add, remove, lock now) | 014 | S | | 7, 9.2 |
| 016 | Push: firebase-admin sender, push tokens, notification dispatcher with prefs and essentials, events feed, `overspend` events on usage upload | 015 | M | Firebase project | 10, 13 |
| 017 | Device WebSocket hub (`/v1/device/ws`), ping/pong, fan-out of envelopes | 014 | M | | 8.3, 10 |
| 018 | Time requests and kid messages (device + parent endpoints) | 016 | M | | 9 |
| 019 | Parent mode: requests, approve/deny, remote start/end, parent code secret, `parent_mode.used` | 016 | M | | 12.3 |
| 019b | Device events: `POST /v1/device/events` for `tamper.*` (section 14), stored and pushed to parents | 016 | S | | 14 |
| 020 | SOS endpoints, locations, acks, extend, end, email backup | 019b | M | | 15 |
| 021 | Background sweep (in process, once a minute): device offline, SOS auto stop. Time and parent-mode requests already expire when read (018, 019) | 020 | S | | 8.4, 14, 15 |

## Phase 2: parent web app

| Card | Title | Depends on | Size | James | Spec |
|---|---|---|---|---|---|
| 022 | Web skeleton: Vite, React 19, TanStack Router/Query, Tailwind v4, shadcn/ui, tokens, layout shell, sign-in; web refresh token in an HttpOnly cookie | 021 | M | | 11.1, 16.1, 16.5 |
| 023 | Today page and adjust dialog (web: − and + buttons and quick amounts instead of the wheel) | 015, 022 | M | | 16.4, 16.5 |
| 024 | Kids list and kid detail: schedule editor, contacts, devices, add device (QR, `qrcode.react`) | 013, 023 | M | | 16.4, 16.5 |
| 025 | Inbox (time and parent-mode requests, event history) and SOS banner | 018, 019, 020, 024 | M | | 13, 15, 16.5 |
| 025b | Settings: notification switches, message presets, parents, family, parent code | 025 | M | | 12.3, 13, 16.5 |
| 026 | Super admin pages | 022 | S | | 6.2 |
| 027 | Server serves the web build; production image | 008, 022 | S | | 4.2 |

## Phase 3: Android kid app

| Card | Title | Depends on | Size | James | Spec |
|---|---|---|---|---|---|
| 028 | `core-time`: Kotlin engine passing all test vectors | 003, 004 | M | | 7 |
| 029 | `core-model`: generated Kotlin client from `contract/openapi.json` | 009, 004 | S | | 4.1 |
| 030 | Device Owner policies + setup and enrolment screen (code entry), tested on the emulator | 013, 029 | M | Emulator, ADB | 12.1, 16.2 |
| 030b | QR scan on the setup screen (CameraX + ML Kit, bundled model) | 030 | S | Emulator | 11.3, 16.2 |
| 031 | Usage tracking, Room outbox, upload, state sync, trusted time | 014, 028, 030 | M | | 8, 12.1 |
| 032 | Enforcement service: alarms, warnings, persistent notification, main screen | 031 | M | | 12.1, 16.2 |
| 033 | Block screen in Lock Task | 032 | M | | 12.1, 16.2 |
| 034 | WebSocket while blocked | 017, 033 | M | | 8.3 |
| 034b | FCM receiver (Firebase app registration by James) | 016, 034 | M | Firebase console | 8.3 |
| 035 | Ask for more time and Message sheets | 018, 033 | M | | 16.2 |
| 036 | Calls from the block screen + `CallRedirectionService` | 033 | M | Phone with SIM | 12.1 |
| 037 | Parent mode (push approval + code) | 019, 033 | M | | 12.3 |
| 038 | SOS | 020, 036 | L | Phone with SIM | 15 |
| 039 | Tamper detection + caught screen | 021, 033 | M | | 14 |

## Phase 4: Android parent app

| Card | Title | Depends on | Size | James | Spec |
|---|---|---|---|---|---|
| 040 | Sign in, biometric lock, Today screen | 011, 015, 029 | M | | 11.1, 16.4 |
| 041 | Adjust sheet, inbox, requests, messages | 018, 040 | M | | 16.4 |
| 042 | FCM channels, parent-mode approval, parent code screen | 016, 019, 040 | M | | 13, 16.4 |
| 043 | Kid detail: schedule, contacts, devices, add device | 013, 040 | M | | 16.4 |
| 044 | SOS critical alert | 020, 042 | M | | 15 |

## Phase 5: Windows

| Card | Title | Depends on | Size | James | Spec |
|---|---|---|---|---|---|
| 045 | `ScreenTime.Core`: C# engine passing all test vectors | 003, 006 | M | | 7 |
| 046 | `ScreenTime.Core`: generated C# client + SQLite store | 009, 006 | M | | 4.1 |
| 047 | Service: enrolment CLI, session tracking per account, usage upload, state sync | 007, 013, 014, 045, 046 | M | | 12.2 |
| 048 | Service: lock and relock, WebSocket, tray launcher, named pipe | 017, 047 | M | | 12.2 |
| 049 | Tray logic: status for the flyout, warning and grant toasts, `view` pipe message (front end by Claude, PR #124) | 048 | M | | 16.3 |
| 049b | Tray wiring: the service sends `view` and the toasts, the tray shows them, the tray exits when the service is gone | 049 | M | | 12.2, 16.3 |
| 050 | Tray logic for Ask and Message: presets and pending ask in the status, `request_resolved` answers, `ask`/`message`/`reply`/`answer` pipe lines (front end by Claude, PR #130) | 018, 049b | S | | 16.2, 16.3 |
| 050b | Tray wiring for Ask and Message: the service calls the server and relays answers, the tray pipe implements the sender; a dev `--session` flag so runs work over Remote Desktop; the run repeats the 049b checks | 050 | M | | 12.2, 16.3 |
| 050c | Parent mode logic: TOTP parent code, code sessions and the effective snapshot, `parent_mode` answers, parent pipe lines (front end by Claude, PR #136) | 019, 050b | M | | 12.3, 16.3 |
| 050d | Parent mode wiring: the service checks the code, keeps and reports code sessions and End now, stops counting during parent mode, relays answers; the tray pipe implements the parent calls; run | 050c | M | | 12.3, 16.3 |
| 051 | Tamper and hardening: time zone right, tray kill counter, Safe Mode registration | 021, 048 | M | | 12.2, 14 |
| 052 | Installer (WiX MSI) | 049 | M | | 12.2 |

## Phase 6: deploy and rollout

| Card | Title | Depends on | Size | James | Spec |
|---|---|---|---|---|---|
| 053 | Deploy to Unraid: compose, tunnel route, backups, `docs/guides/deploy.md` | 027 | M | Unraid, Cloudflare | 4.2 |
| 054 | Guides: Android provisioning, Windows install | 038, 052 | S | | 12 |
| 055 | Household rollout and end-to-end acceptance checklist | all | S | All devices | all |

## Pending decisions that block cards

See SPEC section 17. None of the remaining pending decisions block an early card.
