# CARD-062: Waiting for you

| Field | Value |
|---|---|
| Card | CARD-062 |
| Title | Waiting for you |
| Size | M |
| Depends on | CARD-061, merged to `main`. Claude's front end came in the same PR as this card |
| Spec sections | docs/SPEC.md §9.2, §13, §16.4 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-062-waiting` |
| PR title | `CARD-062: Waiting for you` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

**How this card works.** Claude did the design, built the screen, and wrote this card: the behaviour, the interfaces and the acceptance criteria. **You write the code and the tests**, run every check, and send the handback. There is no code to copy. Where the card names a type, a route, a field, a file or a function, use that name exactly; everything else is your choice, as long as it follows the repo's existing patterns and `AGENTS.md`. Claude will re-run your tests, check your run's ids and times against the database, and review the code line by line before merging.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM.

**Why (James, 18 Nov 2026).** When a kid asks for more time, asks for parent mode, or sends a message, the parent app gets a notification. Tapping it opens whatever tab was last open, and if the notification is dismissed by accident, there is no easy way to find what it was. James wants a small area at the top of the parent app that lists everything waiting on a parent, until it is answered (or, for a message, acknowledged). When nothing waits, the app looks as it does today.

**What exists today.**

- Time requests: `GET /v1/requests?status=pending`, answered with `POST /v1/requests/{id}/approve|deny` (`server/src/requests/routes.ts`). Pending requests expire at local midnight (`expireOld`, run before every read).
- Parent-mode requests: rows in `parent_mode_sessions`, pending for 10 minutes (`statusSql` and `REQUEST_WAIT` in `server/src/parentmode/routes.ts`). There is **no** route that lists the pending ones: a parent can only reach one by tapping its notification.
- New apps held for approval (Android): `app_rules` rows with `mode = 'held'`, and an `app.approval` event with payload `{ package, label, source, deviceName }` (`server/src/apps/routes.ts`). The parent app currently finds them by scanning the last 50 events, so an older one gets lost.
- Kid messages: `kid_messages` rows and a `kid_message` event with payload `{ messageId, body }` (`server/src/messages/routes.ts`). A message has **no** "seen" state.
- Pushes (`server/src/notify/dispatch.ts`) reach the parent app's `ParentPushService`, which shows each one with `show()` in `android/app-parent/.../push/Notifications.kt` as `notify(e.id.hashCode(), …)` with no tag.

**What Claude built (front end, in the same PR as this card, already on `main`).** In `android/app-parent/src/main/kotlin/au/screentime/parent/inbox/`:

| File | What it is | Yours to change? |
|---|---|---|
| `Waiting.kt` | The UI model `Waiting` (sealed: `Time`, `ParentMode`, `NewApp`, `Message`), the words (`waitingTitle`, `waitingDetail`, `waitingMeta`, …), `visibleWaiting`, and `WaitingNews.open()` which opens the strip | **No** (Claude's) |
| `WaitingStrip.kt` | The "Waiting for you" card drawn at the top of every tab, under the SOS banner. Nothing is drawn when the list is empty | **No** (Claude's) |
| `home/HomeScreen.kt`, `inbox/InboxScreen.kt` | The strip placed on every tab; the Inbox now shows only the history | **No** (Claude's) |
| `WaitingSeam.kt` | **The seam.** Builds the list from the Inbox's existing data plus, in debug builds, a fake parent-mode request and a fake message | **Yes: delete this file** |
| `InboxViewModel.kt` | Holds `state.waiting`; `load()` calls the seam; `seen(message)` calls the seam | **Yes: wire it to the server** |

If you think one of Claude's files is wrong, do not change it: write it under "Blockers / questions" (AGENTS.md rule 10).

## 2. Goal

The server says what is waiting for a parent in one call (`GET /v1/waiting`), a parent can mark a kid's message as seen for the whole family (`POST /v1/messages/{id}/seen`), the parent app's strip shows the real list, a tapped notification for a waiting item opens the strip, and a notification for something that is no longer waiting goes away.

## 3. Out of scope

- No change to the strip's look, words or layout, or to `Waiting.kt` (section 1).
- **No new push or notification kind.** `kid_message.seen` is history only. No silent "something changed" push to the other parent: their strip updates at the next 30-second poll, and their stale notification goes when their app next loads the list.
- No reply from a parent to a kid's message.
- No change to the web app (it keeps its own inbox; it already reads `kid_message.seen` in its history). No change to the kid app or Windows.
- No new library or package. Generated files only through `pnpm contract`, never by hand.
- SOS stays as it is (its own red banner); it is **not** a waiting item.

## 4. Tech and traps

The existing stack only: TypeScript (Hono, `@hono/zod-openapi`, zod, Drizzle, Vitest), Kotlin with Jetpack Compose, JUnit 6 (Jupiter), PowerShell 7.

- **The schema must be flat**, not a zod discriminated union: the Kotlin client generator does not handle `oneOf`. Every kind-specific field is present on every item and `null` when it does not apply.
- **Old messages must not flood the strip.** The migration that adds `seen_at` must set `seen_at = created_at` on every existing row, or every message ever sent shows up as waiting after the deploy.
- Migrations are generated with `pnpm --filter @screentime/server db:generate` (drizzle-kit) after you change `server/src/db/schema.ts`; then add the backfill `update` by hand to the generated SQL file, and name it like the others (`server/drizzle/0010_<name>.sql`). Check `meta/_journal.json` was updated.
- Run `expireOld` (requests) before reading pending time requests, the same as `GET /v1/requests` does, so a request from yesterday is not listed.
- Reuse `statusSql` (or its rule) for parent mode: pending means not started, not ended, and requested less than 10 minutes ago. A newer request from the same device already ends the older one.
- Archived kids are left out of every kind.
- On a fresh checkout, `pnpm build` must run before `pnpm contract`.
- The parent app's notification id stays `e.id.hashCode()`; you add a **tag**. `NotificationManager.cancel(tag, id)` needs both.

## 5. Design (what to build)

### 5.1 Schemas (`packages/schemas/src/requests.ts`)

`KidMessage` gains two fields: `seenAt` (ISO datetime or null) and `seenByName` (string or null; null when nobody saw it yet or when it was backfilled).

New, exported from the package index, each with `.meta({ id })` like the others:

`WaitingKind`: `'time_request' | 'parent_mode_request' | 'app_approval' | 'kid_message'`.

`WaitingItem` (flat):

| Field | Type | Every kind / which kind |
|---|---|---|
| `kind` | `WaitingKind` | every |
| `id` | string | every: the request id, the parent-mode session id, `<kidId>:<package>` for an app, the message id |
| `eventId` | uuid or null | every: the event whose push made the notification (`time_request`, `parent_mode.request`, the newest `app.approval` for that kid and package, `kid_message`); null when none is found |
| `at` | ISO datetime | every: when it came in |
| `kidId`, `kidName` | uuid, string | every |
| `deviceId`, `deviceName` | uuid or null, string or null | every |
| `request` | `TimeRequest` or null | `time_request` only (the same object `GET /v1/requests` returns) |
| `expiresAt` | ISO datetime or null | `parent_mode_request` only: requested at + 10 minutes |
| `package`, `label`, `source` | string or null each | `app_approval` only (`label`, `source` from that `app.approval` event's payload) |
| `body` | string or null | `kid_message` only |

`WaitingList`: `{ items: WaitingItem[] }`.

### 5.2 Server

**Table** `kid_messages` gains `seen_at timestamptz null` and `seen_by uuid null references parents(id)`; backfill as in section 4.

**`GET /v1/waiting`** (parent, `requireFamilyParent`, tag `messages` or a new `waiting` tag, your choice) → 200 `WaitingList`:

- Pending time requests (after `expireOld`), pending parent-mode requests, held apps (`app_rules.mode = 'held'`), and messages with `seen_at` null. Archived kids left out.
- Newest first by `at`, ties by `id`; at most 100 items.
- Put it in a new `server/src/waiting/routes.ts`, registered in `server/src/app.ts` like the other route files.

**`POST /v1/messages/{id}/seen`** (parent) → 200 `KidMessage`:

- First time: sets `seen_at = now()`, `seen_by` = the parent, and writes one event `kid_message.seen` with `kidId`, `deviceId` and payload `{ messageId, byName }`. No push (it is not a notification kind; check `notificationKindOf` returns null for it).
- Again (by anyone): 200 with the stored message, `seenAt` and `seenByName` unchanged, no second event.
- A message of another family, or no such id: 404. Not a uuid: 422.

`GET /v1/messages` returns `seenAt` and `seenByName` too.

**`server/scripts/dev-ask.ts`** gains a `message` mode, like `parent-mode`: `tsx scripts/dev-ask.ts Alex message Can you pick me up at 5?` sends that text with `POST /v1/device/messages` from the pretend phone. Update its header comment.

Then run `pnpm contract` and commit `contract/openapi.json` and the regenerated Kotlin client.

### 5.3 Parent app

- **`InboxViewModel`**: `load()` gets the list with `getWaiting()` (generated name may differ slightly: use what `pnpm contract` produces) and maps each `WaitingItem` to Claude's `Waiting` types (an item whose kind-specific field is missing, or a kind it does not know, is skipped, never a crash). `seen(message)` calls `POST /v1/messages/{id}/seen`. Delete `WaitingSeam.kt`. Put the mapping in a pure function `waitingFrom(item: WaitingItem): Waiting?` in a new file `inbox/WaitingApi.kt`, so it can be unit-tested. Keep the existing `getRequests` call only if something still needs it; the strip must not.
- **Notifications** (`push/Notifications.kt`): an event of kind `time_request`, `parent_mode.request`, `app.approval` or `kid_message` is shown with the tag `"waiting:<event id>"` (a pure function `waitingTag(e: EventItem): String?`, null for other kinds). Tapping a `time_request`, `app.approval` or `kid_message` notification opens `MainActivity` with an extra `au.screentime.parent.OPEN_WAITING`, and `MainActivity` (in `onCreate` and `onNewIntent`) calls `WaitingNews.open()` when it sees it, then removes the extra. A `parent_mode.request` keeps opening the approval page as today.
- **Clearing stale notifications**: after every successful `load()`, cancel every notification of this app whose tag starts with `waiting:` and whose event id is not an `eventId` of the loaded list. Write the choice as a pure function `staleTags(active: List<String?>, waiting: List<Waiting>): List<String>` and unit-test it; the Android call around it (`activeNotifications`, `cancel(tag, id)`) stays small.

## 6. Acceptance criteria

Server (Vitest, in a new `server/test/waiting.test.ts` and in `server/test/messages.test.ts`):

1. With nothing waiting, `GET /v1/waiting` → 200 `{ "items": [] }`.
2. A pending time request is listed with `kind: "time_request"`, `id` = the request id, the full `request` object, and `eventId` = the id of its `time_request` event. After it is approved, or denied, it is gone.
3. A time request from before the family's local midnight is not listed (expired).
4. A parent-mode request is listed with `expiresAt` = requested at + 10 minutes and the `parent_mode.request` event's id; it is gone after approve, after deny, and once 10 minutes have passed (move `requested_at` back in the test).
5. A held app is listed with `id` = `<kidId>:<package>`, `package`, `label`, `source`, and `eventId` of the newest `app.approval` for that kid and package; it is gone once a rule is set with `PUT /v1/kids/{kidId}/apps/{package}/rule`.
6. A new kid message is listed with its `body` and `eventId`; after `POST /v1/messages/{id}/seen` it is gone, for every parent of the family.
7. `seen` the first time → 200 with `seenAt` set and `seenByName` = the parent's display name, and exactly one `kid_message.seen` event with payload `{ messageId, byName }`. A second `seen` (also by the other parent) → 200 with the same `seenAt` and `seenByName`, still one event. No push is sent for it (use the test pusher the notify tests use).
8. `seen` on another family's message → 404; on a non-uuid → 422; without a sign-in → 401.
9. Items of an archived kid are not listed; items of another family are never listed.
10. Order: newest `at` first across kinds (one test with all four kinds).
11. The migration: a message that existed before it reads `seenAt` = its `createdAt` (test it the way `server/test/db.test.ts` checks migrations, or say in the handback how you proved it).
12. `GET /v1/messages` returns `seenAt` and `seenByName`.

Parent app (JUnit, in a new `android/app-parent/src/test/kotlin/au/screentime/parent/inbox/WaitingApiTest.kt` and in `PushTest.kt`):

13. `waitingFrom` maps each of the four kinds to the right `Waiting` type with every field, and returns null for an unknown kind and for a `time_request` with `request` null.
14. `waitingTag` gives `waiting:<id>` for the four waiting kinds and null for others (`sos.started`, `grant.added`, `kid_message.seen`).
15. `staleTags` returns the `waiting:` tags whose event id is not in the list, ignores null tags and tags without the prefix, and returns nothing when everything is still waiting.

Build and contract:

16. `pnpm contract` leaves `git status --short contract android` clean after your commit (you committed what it generates).
17. `WaitingSeam.kt` no longer exists; `git diff --stat main -- android/app-parent/src/main/kotlin/au/screentime/parent/inbox/Waiting.kt android/app-parent/src/main/kotlin/au/screentime/parent/inbox/WaitingStrip.kt android/app-parent/src/main/kotlin/au/screentime/parent/home/HomeScreen.kt android/app-parent/src/main/kotlin/au/screentime/parent/inbox/InboxScreen.kt web/src` prints nothing.

Emulator run (section 8.2):

18. With nothing waiting, the Today tab shows no "Waiting for you".
19. After a time request (30 min, reason "Finishing my homework video"), a parent-mode request and a message from Alex, the strip says `Waiting for you · 3`, shows `Message from Alex` folded (it is the newest), and after `Show 2 more` also `Alex wants 30m more Phone` and `Alex wants parent mode`. The strip shows on the Kids and Settings tabs too.
20. `Got it` on the message: it leaves the strip, and the database has `seen_at` set for it and one `kid_message.seen` event.
21. `Yes, 30m`: the request leaves the strip and the database has it `approved` with a grant.
22. `Answer` opens `Parent mode for Alex?`; `Say no` goes back, and the strip no longer shows any item (the line `Waiting for you` is gone from the screen).

## 7. Tests you write

- `server/test/waiting.test.ts`: criteria 1 to 6 and 9 to 10, one `it` each at least.
- `server/test/messages.test.ts`: criteria 7, 8, 11, 12.
- `android/app-parent/src/test/kotlin/au/screentime/parent/inbox/WaitingApiTest.kt`: criterion 13 and 15 (or put `staleTags` tests in `PushTest.kt`).
- `android/app-parent/src/test/kotlin/au/screentime/parent/push/PushTest.kt`: criterion 14.

Use the existing test helpers in `server/test/helpers.ts` (family, parents, kids, enrolled devices), the same way `requests.test.ts` and `parentmode.test.ts` do.

## 8. Checks

### 8.1 Build and tests

From the repo root, in `pwsh`:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm contract
git status --short contract android
pnpm typecheck
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
docker exec screentime-db-1 psql -U screentime -d postgres -c "create database screentime_test"
$pw = (Select-String -Path deploy\.env -Pattern '^POSTGRES_PASSWORD=(.*)').Matches[0].Groups[1].Value
$env:TEST_DATABASE_URL = "postgres://screentime:$pw@localhost:5432/screentime_test"
pnpm test
Remove-Item Env:TEST_DATABASE_URL
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
Select-String 'tests="' app-parent\build\test-results\testDebugUnitTest\TEST-au.screentime.parent.inbox.WaitingApiTest.xml
.\gradlew.bat --stop
cd ..
git grep -l 'Â' -- packages server/src server/scripts server/test android/app-parent/src
```

Paste each command's key output. `git status --short contract android` must print nothing (after you committed); an error that `screentime_test` already exists is fine; the last `git grep` must print nothing.

### 8.2 The emulator run (criteria 18 to 22)

Write the run yourself as `docs/cards/CARD-062-run.ps1`. Copy the helpers and the first two steps from `docs/cards/CARD-058-run.ps1` (`Check`, `Tap-Text`, `Screen-Text`, `Shot`, `Open-Package`, the wiped emulator, the fresh server with `seed-dev.ts dad@example.com`, and the parent sign-in from its step 10). No kid app is needed: `dev-ask.ts` enrols a pretend phone through the API. It must, in order, printing every step's real output:

1. A wiped emulator; a fresh server; install the parent debug APK and sign in as `dad@example.com` (the code from `docker logs screentime-api-1`).
2. Print `Screen-Text` on Today and `Check 'nothing waiting' (-not (Screen-Text).Contains('Waiting for you'))`.
3. `dev-ask.ts Alex 30 Finishing my homework video`, then `dev-ask.ts Alex parent-mode`, then `dev-ask.ts Alex message Can you pick me up at 5?`. Wait 35 s (one poll), print `Screen-Text`, check criterion 19's folded words, tap `Show 2 more`, print `Screen-Text`, check the other two, `Shot 'card062-strip'`. Tap `Kids` and `Settings` and check `Waiting for you` is on each; back to `Today`.
4. Tap `Got it`; wait 3 s; print `Screen-Text`; check `Message from Alex` is gone; print `select id, seen_at, seen_by from kid_messages` and `select kind, payload from events where kind = 'kid_message.seen'` with `docker exec screentime-db-1 psql …`.
5. Tap `Yes, 30m`; wait 3 s; print `Screen-Text`; check the request is gone; print `select status, grant_id from time_requests`.
6. Tap `Answer`; print `Screen-Text`; check `Parent mode for Alex?`; tap `Say no`; wait 3 s; print `Screen-Text`; check `Waiting for you` is gone; `Shot 'card062-empty'`.
7. Stop the emulator and print `--- Finished with <n> failed.`

Close other programs first: **the emulator freezes when the PC runs out of memory** (`adb` then hangs with no error). Run it with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
pwsh -File docs\cards\CARD-062-run.ps1 2>&1 | Tee-Object -FilePath ..\temp\card062-bob-out.txt
```

It **wipes the emulator and the development database, and replaces `deploy\.env` with throwaway values** (as CARD-058's run does). Afterwards, bring the dev stack back with the real `deploy\.env` if you keep one elsewhere, and say so.

Not tested on the emulator: real pushes (the dev server has no Firebase), so the notification tag, the `OPEN_WAITING` tap and the clearing of stale notifications are covered by the unit tests only. Do not try to sign in to Google.

### 8.3 CI

Every check on the PR is green.

## 9. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-062-waiting
   ```
2. Commit in small logical commits. Message format: `CARD-062: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes.
4. Push: `git push -u origin bob/card-062-waiting`
5. Open a PR into `main` titled `CARD-062: Waiting for you`, with its body written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-062-waiting.md

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

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. If Claude's strip does something you think is wrong when it gets real data, describe it with the `Screen-Text` output; do not change Claude's files.

## 11. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs, the dev database and its own run of your tests, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- **Every acceptance criterion (1 to 22)** gets one line: the test name or the run step that proves it, and `PASS`, `FAIL` or `NOT RUN`.
- The emulator run is pasted **whole**: every line of `card062-bob-out.txt`. A step without its pasted output counts as `NOT RUN`.
- "Deviations" lists every way your work differs from the card, and every workaround you used in the run (a restart, a retry, an extra command) with why you needed it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-062. Please review and merge if it is good.

CARD: CARD-062 Waiting for you
PR: <full PR URL>
Branch: bob/card-062-waiting
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Tests I wrote (file: test names):
<list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- 1: <test name or run step> PASS / FAIL / NOT RUN: <reason>
- ...
- 22: ...

Emulator run (all of ..\temp\card062-bob-out.txt):
<paste every line>

What the screenshots show:
- card062-strip.png: <what you see>
- card062-empty.png: <what you see>

Deviations from the card:
<None, or each one: file, what differs, why; and every workaround in the run>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
