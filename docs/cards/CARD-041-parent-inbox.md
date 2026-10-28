# CARD-041: Parent app: change time, Inbox and time requests

| Field | Value |
|---|---|
| Card | CARD-041 |
| Title | Parent app: change time, Inbox and time requests |
| Size | L |
| Depends on | CARD-040, merged to `main` (the parent app signs in and shows Today) |
| Spec sections | docs/SPEC.md §16.4 (Android parent app: Today, adjust sheet, Inbox), §7 (grants), §9.2 and §9.3 (time requests) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-041-parent-inbox` |
| PR title | `CARD-041: Parent app: change time, Inbox and time requests` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

CARD-040 (your PR #92) built the parent app's sign-in, app lock, the **Today** tab and the bottom bar. This card adds the two things a parent does most:

1. **Change a kid's time** from Today: every pool row gets a **±** button that opens the **adjust sheet**. The parent adds or takes away time in 15-minute steps (−4h to +8h), sees a preview ("Now 45m left → 1h left") and taps **Apply**; or taps **Lock now** to take away all the time left today, after a confirm dialog.
2. The **Inbox** tab: the kids' waiting **time requests** ("Ask for more time") as cards with **Yes**, **No** and **Other amount**, and under them the **history** of the last 50 family events ("Dad added 45m of Screens for Alex", "SOS from Alex", …). The Inbox tab in the bottom bar shows a **badge** with the number of waiting requests.

The server side is already built and in the generated Kotlin client `ApiClient` (`android/core-model`): `postKidsGrants`, `postKidsLockNow`, `getRequests`, `postRequestsApprove`, `postRequestsDeny` and `getEvents`. The web app already has the same screens (`web/src/components/adjust-dialog.tsx`, `web/src/pages/inbox.tsx`, `web/src/lib/inbox.ts`): the words in this card follow them, so a parent reads the same on both.

**How this card works (as CARD-040).** You write the app code yourself. The card gives:

- the exact contents of the files you **copy**: two icons, two test files, and a development script;
- what each Kotlin file you **write** or **change** must do: its public names (the tests call them), its rules, and for screens the exact layout, sizes, colours and words.

The tests are the contract: they must pass unchanged. Claude ran both test files against its own small implementation in GitHub Actions, so they compile and pass; Claude did **not** write the screens, so where the card says **exactly**, use those names and words, and where it leaves something open (private helpers, how you split a composable), choose what is simplest. When Claude reviews your PR it checks your code against this card.

## 2. Goal

`.\gradlew.bat assembleDebug test` passes with the two new test suites (13 tests) and the four from CARD-040 unchanged; the emulator run passes (add time, take time away, lock now, a locked pool, two time requests with the badge, Yes, Other amount, No, an answer that came too late, and Today after all of it); the nine screenshots exist; and the **Android / build and test** check is green.

## 3. Out of scope

Do **not** do any of these in this card:

- No parent-mode requests in the Inbox (CARD-042, with push). No push or FCM (CARD-042). No kid detail, schedules, devices or contacts (CARD-043). No SOS screen or banner (CARD-044). No "load more" for the history: 50 events only. No tablet layout or navigation rail. No wheel picker: the adjust sheet uses − and + buttons and quick amounts, as the web app does.
- No note on a grant (`GrantCreate.note` stays absent). No reply to a kid's message.
- No change to the server, the web app, `packages/` or `docs/`, except the new file `server/scripts/dev-ask.ts` (copied, 5.4).
- No change to `core-model`, `core-time`, `core-ui` or `app-kid`. No change to `android/app-parent/build.gradle.kts`, the manifests, `android/gradle/libs.versions.toml`, `settings.gradle.kts` or the Gradle wrapper. No new library. In particular **no `material-icons-extended`, no `androidx.navigation`, no Hilt**: the two new icons are vector drawables (5.1).
- No change to the CARD-040 files except the four this card names (`TodayViewModel.kt`, `TodayScreen.kt`, `HomeScreen.kt`, `MainActivity.kt`). `auth/Session.kt`, `auth/PrefsTokenStore.kt` and `today/TodayViewTest.kt` have three small fixes from Claude on `main` already: take them as they are.
- Never run the parent app on a real phone in this card. Never install a **release** build anywhere.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, a token, or any key. Never paste a token, a sign-in code or a device token into the PR or the handback.

## 4. Tech and versions

Unchanged from `main`: Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, Compose BOM 2026.09.00, Ktor 3.6.0, JUnit 6.1.3, Java 17 bytecode, minSdk 34, compileSdk 37, targetSdk 36. Everything this card uses is in the libraries the parent app already has: Compose Material 3 (`ModalBottomSheet`, `SingleChoiceSegmentedButtonRow`, `SegmentedButton`, `FilterChip`, `OutlinedIconButton`, `AlertDialog`, `BadgedBox`, `Badge`, `HorizontalDivider`, `PullToRefreshBox`), `java.util.UUID`, `java.time` and kotlinx.serialization's `JsonObject` / `JsonPrimitive` (through `core-model`).

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Gradle runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

`adb` is `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`. Every command below uses it as `& $adb`, after:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$t = "C:\Users\james\OpenCode\Testing\temp\c41"
New-Item -ItemType Directory -Force $t | Out-Null
```

## 5. Files

Paths are relative to the repo root. Kotlin files below are under `android/app-parent/src/main/kotlin/au/screentime/parent/` (written `…/` in the table) and tests under `android/app-parent/src/test/kotlin/au/screentime/parent/`.

| File | Action |
|---|---|
| `android/app-parent/src/main/res/drawable/ic_add.xml` | create, **copy** (5.1) |
| `android/app-parent/src/main/res/drawable/ic_remove.xml` | create, **copy** (5.1) |
| `…/today/Adjust.kt` | create, **write** (6.1) |
| `…/today/TodayViewModel.kt` | change, **write** (6.2) |
| `…/today/AdjustSheet.kt` | create, **write** (6.3) |
| `…/today/TodayScreen.kt` | change, **write** (6.4) |
| `…/inbox/Inbox.kt` | create, **write** (6.5) |
| `…/inbox/InboxViewModel.kt` | create, **write** (6.6) |
| `…/inbox/InboxScreen.kt` | create, **write** (6.7) |
| `…/home/HomeScreen.kt` | change, **write** (6.8) |
| `…/MainActivity.kt` | change, **write** (6.9) |
| `android/app-parent/src/test/kotlin/au/screentime/parent/today/AdjustTest.kt` | create, **copy** (5.2) |
| `android/app-parent/src/test/kotlin/au/screentime/parent/inbox/InboxTest.kt` | create, **copy** (5.3) |
| `server/scripts/dev-ask.ts` | create, **copy** (5.4) |

That is 14 files: 10 new, 4 changed.

**Copy** means: copy the code block exactly, character for character, blank lines included, and with exactly one newline at the end of the file (no blank line after the last `}`). This card is UTF-8; if you see `Â`, `â€` or `ðŸ` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Text uses `·` (U+00B7, a middle dot), `…` (U+2026), `→` (U+2192), `−` (U+2212, a real minus sign, **not** the hyphen `-`) and the curly quotes `“` (U+201C) and `”` (U+201D). Apostrophes are plain `'`, never `’`. Copy them exactly, and use them exactly where section 6 shows them.

**Write** means: write the file yourself from section 6. Use 4-space indentation and a KDoc comment (`/** … */`) on every public class and function, saying what it is for, as the rest of the project does. Strings shown to people must be **exactly** the card's words. **Change** means: keep everything the file has now and add or alter only what section 6 says.

### 5.1 Icons

Two vector drawables for the adjust sheet's − and + steps. Compose tints them (`Icon(painterResource(R.drawable.ic_add), …)`).

`android/app-parent/src/main/res/drawable/ic_add.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The adjust sheet's + step: Material Symbols Rounded "add", 24 dp. Compose tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <path
        android:fillColor="#FF000000"
        android:pathData="M440,520L240,520Q223,520 211.5,508.5Q200,497 200,480Q200,463 211.5,451.5Q223,440 240,440L440,440L440,240Q440,223 451.5,211.5Q463,200 480,200Q497,200 508.5,211.5Q520,223 520,240L520,440L720,440Q737,440 748.5,451.5Q760,463 760,480Q760,497 748.5,508.5Q737,520 720,520L520,520L520,720Q520,737 508.5,748.5Q497,760 480,760Q463,760 451.5,748.5Q440,737 440,720L440,520Z" />
</vector>
```

`android/app-parent/src/main/res/drawable/ic_remove.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The adjust sheet's − step: Material Symbols Rounded "remove", 24 dp. Compose tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <path
        android:fillColor="#FF000000"
        android:pathData="M240,520Q223,520 211.5,508.5Q200,497 200,480Q200,463 211.5,451.5Q223,440 240,440L720,440Q737,440 748.5,451.5Q760,463 760,480Q760,497 748.5,508.5Q737,520 720,520L240,520Z" />
</vector>
```

### 5.2 `…/test/…/today/AdjustTest.kt`

```kotlin
package au.screentime.parent.today

import au.screentime.core.model.api.LockReason
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TodayPool
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AdjustTest {
    private fun pool(remainingSec: Int, locked: Boolean = false) =
        TodayPool(Pool.PHONE, 120, 0, 0, remainingSec, locked, if (locked) LockReason.BEDTIME else null, null, 0, emptyList())

    @Test
    fun amountsAreFifteenMinuteStepsFromMinusFourToPlusEightHours() {
        assertEquals(15, ADJUST_DEFAULT)
        assertEquals(listOf(15, 30, 60, 120), QUICK_AMOUNTS)
        assertEquals(30, clampAdjust(30))
        assertEquals(30, clampAdjust(37))
        assertEquals(45, clampAdjust(38))
        assertEquals(-45, clampAdjust(-44))
        assertEquals(480, clampAdjust(600))
        assertEquals(-240, clampAdjust(-300))
        assertEquals(0, clampAdjust(0))
    }

    @Test
    fun theStepperStopsAtItsEnds() {
        assertEquals(30, stepUp(15))
        assertEquals(480, stepUp(480))
        assertEquals(0, stepDown(15))
        assertEquals(-240, stepDown(-240))
    }

    @Test
    fun amountsReadShortWithARealMinusSign() {
        assertEquals("+15m", formatAdjust(15))
        assertEquals("+1h", formatAdjust(60))
        assertEquals("+1h 30m", formatAdjust(90))
        assertEquals("+8h", formatAdjust(480))
        assertEquals("−45m", formatAdjust(-45))
        assertEquals("−2h", formatAdjust(-120))
        assertEquals("0m", formatAdjust(0))
    }

    @Test
    fun thePreviewShowsBeforeAndAfter() {
        assertEquals("Now 45m left → 1h left", adjustPreview(pool(2700), 15))
        assertEquals("Now 45m left → 15m left", adjustPreview(pool(2700), -30))
        assertEquals("Now 45m left → locked", adjustPreview(pool(2700), -60))
        assertEquals("Now 45m left → 45m left", adjustPreview(pool(2700), 0))
    }

    @Test
    fun aLockedPoolGetsExactlyTheGrant() {
        // After bedtime or out of time there is nothing left, so a grant gives exactly its own minutes (docs/SPEC.md §7).
        assertEquals("Now locked → 30m left", adjustPreview(pool(0, locked = true), 30))
        assertEquals("Now locked → locked", adjustPreview(pool(0, locked = true), -15))
    }

    @Test
    fun theSheetAndTheLockDialogNameTheKid() {
        assertEquals("Change Alex's time", adjustTitle("Alex"))
        assertEquals("Lock Alex's Phone now?", lockTitle("Alex", Pool.PHONE))
        assertEquals("Lock Sam's Screens now?", lockTitle("Sam", Pool.SCREENS))
    }
}
```

### 5.3 `…/test/…/inbox/InboxTest.kt`

```kotlin
package au.screentime.parent.inbox

import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.EventItem
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TimeRequest
import au.screentime.core.model.api.TimeRequestStatus
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class InboxTest {
    private val sydney = ZoneId.of("Australia/Sydney")

    // 4:00 pm on Wednesday 28 October 2026 in Sydney (UTC+11).
    private val now = Instant.parse("2026-10-28T05:00:00Z")

    private fun request(minutes: Int = 30, reason: String? = "finishing homework video", pool: Pool = Pool.PHONE) =
        TimeRequest(
            "r1", "k1", "Alex", "d1", "Pixel 7", pool, minutes, reason, TimeRequestStatus.PENDING,
            "2026-10-28T04:50:00Z", null, null, null, null,
        )

    private fun event(kind: String, vararg payload: Pair<String, Any?>, device: String? = "Pixel 7") = EventItem(
        id = "e1",
        kind = kind,
        at = "2026-10-28T04:30:00Z",
        kidId = "k1",
        kidName = "Alex",
        deviceId = "d1",
        deviceName = device,
        payload = JsonObject(
            payload.associate { (key, value) ->
                key to when (value) {
                    is String -> JsonPrimitive(value)
                    is Number -> JsonPrimitive(value)
                    is Boolean -> JsonPrimitive(value)
                    else -> kotlinx.serialization.json.JsonNull
                }
            },
        ),
    )

    private fun view(kind: String, vararg payload: Pair<String, Any?>) = eventView(event(kind, *payload), sydney)

    @Test
    fun aRequestReadsAsOneLine() {
        assertEquals("Alex wants 30m more Phone", requestTitle(request()))
        assertEquals("Alex wants 1h 30m more Screens", requestTitle(request(minutes = 90, pool = Pool.SCREENS)))
        assertEquals("“finishing homework video”", requestDetail(request()))
        assertNull(requestDetail(request(reason = null)))
        assertNull(requestDetail(request(reason = " ")))
    }

    @Test
    fun timeAndMessageEvents() {
        assertEquals(
            EventView("Alex asked for 30m more Phone", "“please”", EventTone.REQUEST),
            view("time_request", "minutes" to 30, "pool" to "phone", "reason" to "please"),
        )
        assertEquals(
            EventView("Dad said yes to Alex: 45m more", null, EventTone.TIME),
            view("time_request.resolved", "approved" to true, "minutes" to 45, "byName" to "Dad"),
        )
        assertEquals(
            EventView("Mum said no to Alex's request", null, EventTone.INFO),
            view("time_request.resolved", "approved" to false, "byName" to "Mum"),
        )
        assertEquals(
            EventView("Dad added 1h of Screens for Alex", null, EventTone.TIME),
            view("grant.added", "minutes" to 60, "pool" to "screens", "byName" to "Dad", "lockNow" to false),
        )
        assertEquals(
            EventView("Dad took away 15m of Phone from Alex", null, EventTone.TIME),
            view("grant.added", "minutes" to -15, "pool" to "phone", "byName" to "Dad", "lockNow" to false),
        )
        assertEquals(
            EventView("Mum locked Alex's Phone", null, EventTone.TIME),
            view("grant.added", "minutes" to -42, "pool" to "phone", "byName" to "Mum", "lockNow" to true),
        )
        assertEquals(
            EventView("Message from Alex", "“Can I stay up?”", EventTone.MESSAGE),
            view("kid_message", "body" to "Can I stay up?"),
        )
    }

    @Test
    fun parentModeSosAndDeviceEvents() {
        assertEquals(
            EventView("Alex asked for parent mode on Pixel 7", null, EventTone.REQUEST),
            view("parent_mode.request"),
        )
        assertEquals(
            EventView("Parent mode on Pixel 7 for 15 min", "Started by Dad", EventTone.INFO),
            view("parent_mode.used", "durationMin" to 15, "byName" to "Dad"),
        )
        assertEquals(
            EventView("Parent mode on Pixel 7 for 1 hour", "Started with the parent code", EventTone.INFO),
            view("parent_mode.used", "durationMin" to 60),
        )
        assertEquals(EventView("Parent mode on Pixel 7 until ended", "Started by Mum", EventTone.INFO), view("parent_mode.used", "byName" to "Mum"))
        assertEquals(EventView("Parent mode ended on Pixel 7", null, EventTone.INFO), view("parent_mode.ended"))
        assertEquals(EventView("SOS from Alex", "On Pixel 7", EventTone.SOS), view("sos.started"))
        assertEquals(EventView("Alex ended the SOS: safe", null, EventTone.SOS), view("sos.ended", "endedBy" to "kid"))
        assertEquals(EventView("Dad ended Alex's SOS", null, EventTone.SOS), view("sos.ended", "endedBy" to "parent", "byName" to "Dad"))
        assertEquals(
            EventView("Pixel 7 is offline", "Last seen at 3:05 pm", EventTone.INFO),
            view("device.offline", "lastSeenAt" to "2026-10-28T04:05:00Z"),
        )
        assertEquals(EventView("Pixel 7 was added for Alex", null, EventTone.INFO), view("device.enrolled", "name" to "Pixel 7"))
    }

    @Test
    fun tamperAndOverspendAreAlerts() {
        assertEquals(EventView("Pixel 7: the clock was changed", null, EventTone.ALERT), view("tamper.clock", "offsetMin" to "10"))
        assertEquals(EventView("Pixel 7: a call was blocked", null, EventTone.ALERT), view("tamper.call_blocked"))
        assertEquals(EventView("Pixel 7: something was tampered with", null, EventTone.ALERT), view("tamper.new_thing"))
        assertEquals(
            EventView(
                "Alex went 12m over on Screens",
                "Pixel 7 was offline, so it could not know the time had run out",
                EventTone.ALERT,
            ),
            view("overspend", "overspendSec" to 720, "pool" to "screens"),
        )
    }

    @Test
    fun anEventWithMissingOrOddFieldsStillReads() {
        assertEquals(EventView("Alex asked for less than a minute more time", null, EventTone.REQUEST), view("time_request"))
        assertEquals(EventView("A parent added 15m of time for Alex", null, EventTone.TIME), view("grant.added", "minutes" to 15))
        // A string where a number belongs is not read as the number.
        assertEquals(EventView("Alex asked for less than a minute more Phone", null, EventTone.REQUEST), view("time_request", "minutes" to "30", "pool" to "phone"))
        assertEquals(EventView("something.new", null, EventTone.INFO), view("something.new"))
        assertEquals(
            EventView("a device is offline", null, EventTone.INFO),
            eventView(event("device.offline", device = null), sydney),
        )
    }

    @Test
    fun whenIsTheTimeTodayThenYesterdayThenTheDate() {
        assertEquals("3:30 pm", whenText("2026-10-28T04:30:00Z", now, sydney))
        assertEquals("12:05 am", whenText("2026-10-27T13:05:00Z", now, sydney))
        assertEquals("Yesterday, 11:55 pm", whenText("2026-10-27T12:55:00Z", now, sydney))
        assertEquals("Sat 24 Oct, 9:00 am", whenText("2026-10-23T22:00:00Z", now, sydney))
    }

    @Test
    fun answeringTooLateSaysSo() {
        assertEquals("Someone already answered this request.", answerError(ApiException(409, null)))
        assertEquals("This request is gone.", answerError(ApiException(404, null)))
        assertEquals("Something went wrong on the server. Try again soon.", answerError(ApiException(500, null)))
        assertEquals("Can't reach Screen Time. Check the internet connection and try again.", answerError(IOException("x")))
    }
}
```

### 5.4 `server/scripts/dev-ask.ts`

For the emulator run: it makes a kid ask for more time from a pretend phone, as the kid app's **Ask for more time** would. Claude ran it against a local server.

```typescript
// Makes a kid of the development database ask for more time from a phone, for the parent app's Inbox: it enrols a
// pretend Android phone through the API and sends one "Ask for more time" from it, so the parents get a pending
// request in the phone pool. One request per kid and pool can wait at a time: answer it before asking again.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-ask.ts Alex 30 Finishing my homework video
// Minutes are 15, 30 or 60; every word after them is the reason (none: no reason). The API is at
// http://localhost:8080 unless API_URL says otherwise. Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { enrolmentCodes, kids, parents } from '../src/db/schema.js';
import { newEnrolmentCode } from '../src/devices/token.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const minutes = Number(process.argv[3]);
const reason = process.argv.slice(4).join(' ').trim() || null;
const apiUrl = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
if (!databaseUrl || !kidName || ![15, 30, 60].includes(minutes)) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-ask.ts <kid name> <15, 30 or 60> [reason words]');
  process.exit(1);
}

async function post(path: string, body: unknown, token?: string): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: the API said ${response.status}: ${await response.text()}`);
  return response.json();
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db
    .select()
    .from(kids)
    .where(sql`lower(${kids.name}) = lower(${kidName})`)
    .orderBy(asc(kids.createdAt))
    .limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}: run scripts/seed-dev.ts first`);
  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.familyId, kid.familyId))
    .orderBy(asc(parents.createdAt))
    .limit(1);
  if (!parent) throw new Error(`the family of ${kid.name} has no parent`);
  const code = newEnrolmentCode();
  await db.insert(enrolmentCodes).values({
    familyId: kid.familyId,
    kidId: kid.id,
    form: 'phone',
    code,
    expiresAt: sql`now() + interval '10 minutes'`,
    createdBy: parent.id,
  });

  const phone = `${kid.name}'s Dev Phone`;
  const enrolled = (await post('/v1/enrol', {
    code,
    platform: 'android',
    hasCellular: true,
    model: phone,
    osVersion: 'Android 14',
    appVersion: 'dev',
  })) as { deviceToken: string };
  await post('/v1/device/time-requests', { id: randomUUID(), minutes, reason }, enrolled.deviceToken);
  console.log(`${kid.name} asked for ${minutes} min more Phone from "${phone}"${reason ? `: "${reason}"` : '.'}`);
} finally {
  await pool.end();
}
```

## 6. What to write

All names below are public unless the card says **private**. The tests call the names in 6.1 and 6.5: spell them exactly.

### 6.1 `today/Adjust.kt` (new)

Package `au.screentime.parent.today`. Pure Kotlin, no Android or Compose imports: the rules of the adjust sheet (docs/SPEC.md §16.4, Q8). `AdjustTest` checks every one.

Constants:

| Name | Type and value |
|---|---|
| `ADJUST_STEP` | `const val` Int `15` |
| `ADJUST_MIN` | `const val` Int `-240` (−4 hours) |
| `ADJUST_MAX` | `const val` Int `480` (+8 hours) |
| `ADJUST_DEFAULT` | `const val` Int `15`: the amount when the sheet opens |
| `QUICK_AMOUNTS` | `val` `List<Int>` = `listOf(15, 30, 60, 120)` |

Functions:

- `fun clampAdjust(minutes: Int): Int`: the nearest multiple of 15 (round half up: `Math.round(minutes / 15.0)` times 15), then kept within `ADJUST_MIN..ADJUST_MAX`. `37` gives `30`, `38` gives `45`, `-44` gives `-45`, `600` gives `480`.
- `fun stepUp(minutes: Int): Int` = `clampAdjust(minutes + ADJUST_STEP)`; `fun stepDown(minutes: Int): Int` = `clampAdjust(minutes - ADJUST_STEP)`. They stop at the ends: `stepUp(480)` is `480`.
- `fun formatAdjust(minutes: Int): String`: how the amount reads in big type. `0` is `"0m"`. Otherwise a sign and the size: `+` for more, `−` (**U+2212**, not `-`) for less; the size is `"${h}h"` for whole hours, else `formatDuration(size * 60L)` from `au.screentime.core.time` (`"15m"`, `"1h 30m"`). So `"+15m"`, `"+1h"`, `"+1h 30m"`, `"+8h"`, `"−45m"`, `"−2h"`.
- `fun adjustPreview(pool: TodayPool, minutes: Int): String`: the line under the amount, `"<now> → <after>"` with `→` (U+2192) between two spaces.
  - `<now>` is `"Now locked"` when `pool.locked`, else `"Now ${formatDuration(pool.remainingSec.toLong())} left"`.
  - The time left now counts as **0** when the pool is locked (after bedtime only the granted amount counts, docs/SPEC.md §7). After = time left now + `minutes * 60`, at least 0.
  - `<after>` is `"locked"` when that is under 60 seconds, else `"${formatDuration(after)} left"`.
  - Examples: `"Now 45m left → 1h left"`, `"Now 45m left → locked"`, `"Now locked → 30m left"`.
- `fun adjustTitle(kidName: String): String` = `"Change $kidName's time"`.
- `fun lockTitle(kidName: String, pool: Pool): String` = `"Lock $kidName's ${poolName(pool)} now?"` (`poolName` is in `TodayView.kt`): `"Lock Alex's Phone now?"`.
- `fun lockText(kidName: String, pool: TodayPool): String` = `"This takes away the ${formatDuration(pool.remainingSec.toLong())} left today. $kidName can still ask for more time."` (the web app's words). Not in the tests; the emulator run checks it.

**Trap:** `Math.ceilDiv` and `Math.floorDiv(Long, Int)` overloads are not all on Android; you do not need them here. Do not use `kotlin.time.Duration` either: `formatDuration` takes seconds as a `Long`.

### 6.2 `today/TodayViewModel.kt` (change)

Keep `TodayState`, `load` and `clear` as they are. Add two functions the adjust sheet calls. Each sends one call, and on success calls `load()` so Today shows the new time at once.

- `suspend fun adjust(kidId: String, pool: Pool, minutes: Int, id: String): String?`: `session.call { postKidsGrants(kidId, GrantCreate(id = id, pool = pool, minutes = minutes)) }`.
- `suspend fun lockNow(kidId: String, pool: Pool, id: String): String?`: `session.call { postKidsLockNow(kidId, LockNow(id = id, pool = pool)) }`.

Both return `null` when it worked, else the words to show in the sheet:

| Caught | Returns |
|---|---|
| `CancellationException` | rethrow it (never swallow it) |
| `SignedOutException` | `null` (the app is going back to sign-in anyway) |
| `ApiException` | `"Something went wrong on the server. Try again soon."` |
| any other `Exception` | `"Can't reach Screen Time. Check the internet connection and try again."` |

`id` is a UUID made by the sheet (6.3). The server stores a grant once per `id`, so sending the same `id` again (a retry after a lost answer) never adds the time twice.

### 6.3 `today/AdjustSheet.kt` (new)

The adjust sheet: a Material 3 `ModalBottomSheet`. Signature, exactly:

```kotlin
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdjustSheet(kid: TodayKid, startPool: Pool, vm: TodayViewModel, onDone: () -> Unit)
```

`onDone` closes it (the caller stops showing it). Use `rememberModalBottomSheetState(skipPartiallyExpanded = true)`, `containerColor = MaterialTheme.colorScheme.surface`, and `onDismissRequest = onDone`. Swiping it down or tapping outside closes it without sending anything.

**State** (with `remember`): the chosen `pool` (starts at `startPool`), the `amount` in minutes (starts at `ADJUST_DEFAULT`), `busy` (a call is running), `error` (`String?`), `confirmLock` (the lock dialog is open), and the attempt `id` (`UUID.randomUUID().toString()`).

- Make a **new** `id` whenever the pool or the amount changes. Keep the same `id` when **Apply** is tapped again after an error with nothing changed (that is a retry). **Lock now** uses its own `lockId`, made the same way, new each time the pool changes.
- Choosing another pool sets the amount back to `ADJUST_DEFAULT` and clears `error`.
- The pool shown is `kid.pools.first { it.pool == pool }`. Today reloads while the sheet is open; always read the pool from the newest `kid` passed in, so the preview stays right.

**Layout**, top to bottom, in a `Column` with `Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 24.dp)`, `horizontalAlignment = Alignment.CenterHorizontally`:

1. `adjustTitle(kid.name)`: `titleLarge`, `FontWeight.SemiBold`, `onSurface`, aligned to the start (`Modifier.fillMaxWidth()`).
2. 16 dp gap. The pool choice: `SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth())` with one `SegmentedButton` per entry of `kid.pools`, in that order, label `poolName(it.pool)`, `shape = SegmentedButtonDefaults.itemShape(index, kid.pools.size)`, `selected` for the chosen pool. Disabled while `busy`.
3. 24 dp gap. The stepper, a `Row` with `verticalAlignment = Alignment.CenterVertically`:
   - `OutlinedIconButton` 48 dp (`Modifier.size(48.dp)`), icon `R.drawable.ic_remove`, `contentDescription = "15 minutes less"`, enabled when `amount > ADJUST_MIN` and not `busy`; it sets `amount = stepDown(amount)`.
   - The amount `formatAdjust(amount)` in `displaySmall`, `FontWeight.SemiBold`, centred in a `Modifier.widthIn(min = 160.dp)`, `textAlign = TextAlign.Center`. Colour: `MaterialTheme.colorScheme.primary` when the amount is more than 0, `ScreenTimeTheme.colors.danger` when less, `ScreenTimeTheme.colors.muted` at 0.
   - `OutlinedIconButton` 48 dp, icon `R.drawable.ic_add`, `contentDescription = "15 minutes more"`, enabled when `amount < ADJUST_MAX` and not `busy`; `amount = stepUp(amount)`.
4. 16 dp gap. Quick amounts: a `Row` with `horizontalArrangement = Arrangement.spacedBy(8.dp)`, one `FilterChip` per `QUICK_AMOUNTS`, label `formatAdjust(q)` (`"+15m"`, `"+30m"`, `"+1h"`, `"+2h"`), `selected = amount == q`; tapping sets `amount = q`.
5. 16 dp gap. `adjustPreview(pool, amount)`: `bodyLarge`, `ScreenTimeTheme.colors.muted`, centred.
6. If `error` is not null: 8 dp gap, the error in `bodyMedium`, `ScreenTimeTheme.colors.critical`, centred.
7. 24 dp gap. **Apply**: a `Button` (the pill shape is Material's default), `Modifier.fillMaxWidth().heightIn(min = 48.dp)`, text `"Apply"`; enabled when `amount != 0` and not `busy`. While `busy` it shows a `CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)` instead of the text. Tapping it launches (with `rememberCoroutineScope()`) `vm.adjust(kid.id, pool, amount, id)`: `busy` true before, false after; `null` back means done, so call `onDone()`; words back go into `error`.
8. Only when the pool is **not** `locked`: 8 dp gap, a `TextButton` (`Modifier.fillMaxWidth()`) with the text `"Lock now"` in `ScreenTimeTheme.colors.danger`, disabled while `busy`. It opens the lock dialog.

**The lock dialog** (when `confirmLock`): an `AlertDialog`:

- `title`: `lockTitle(kid.name, pool.pool)`;
- `text`: `lockText(kid.name, pool)`;
- `confirmButton`: `TextButton` `"Lock now"` in `ScreenTimeTheme.colors.danger`. It closes the dialog and launches `vm.lockNow(kid.id, pool.pool, lockId)`, with `busy` and `error` as for Apply; on `null` it calls `onDone()`;
- `dismissButton`: `TextButton` `"Cancel"`, closes the dialog only;
- `onDismissRequest`: closes the dialog only.

### 6.4 `today/TodayScreen.kt` (change)

1. `PoolRow` gets the ± button at the end of its **first** row (the name and status row): after the status text, an 8 dp gap, then an `OutlinedIconButton` of 36 dp (`Modifier.size(36.dp)`) holding the text `"±"` (U+00B1) in `titleMedium`, `MaterialTheme.colorScheme.primary`, with `Modifier.semantics { contentDescription = "Change ${kid.name}'s ${poolName(pool.pool)}" }` on the button (so `Change Alex's Screens`). The bar and the "used" line under it stay as they are, full width.
2. Tapping the ± button opens `AdjustSheet(kid, pool.pool, vm, onDone = …)` for that kid and pool. Keep which sheet is open in `TodayScreen` as `var adjusting by remember { mutableStateOf<Pair<String, Pool>?>(null) }` (kid id and pool); show the sheet when it is not null, passing the **current** `TodayKid` with that id from `state.today` (if the kid is gone, close it). `onDone` sets it back to `null`.
3. Pass what `KidCard` and `PoolRow` need (the kid, and a lambda for the ± tap): change their parameters as you like; they stay private.
4. Change `private fun Problem(…)` to a public `fun Problem(text: String, onRetry: () -> Unit)` with a KDoc, so the Inbox can use it. Nothing else about it changes.
5. Change the KDoc of `TodayScreen`: remove "Changing the time comes in CARD-041." and say that ± opens the adjust sheet.

Everything else on Today stays as CARD-040 built it.

### 6.5 `inbox/Inbox.kt` (new)

Package `au.screentime.parent.inbox`. Pure Kotlin, no Android or Compose imports: how requests and events read. It is the Kotlin twin of `web/src/lib/inbox.ts` (`eventView`, `whenText`): look there when in doubt. `InboxTest` checks every function.

```kotlin
/** The colour of an event's dot in the history. */
enum class EventTone { SOS, ALERT, REQUEST, MESSAGE, TIME, INFO }

/** One history row: the line, an optional second line, and the dot's colour. */
data class EventView(val text: String, val detail: String?, val tone: EventTone)
```

**Requests:**

- `fun requestTitle(r: TimeRequest): String` = `"${r.kidName} wants ${formatDuration(r.minutes * 60L)} more ${poolName(r.pool)}"`: `"Alex wants 30m more Phone"`. (`poolName` is in `au.screentime.parent.today`.)
- `fun requestDetail(r: TimeRequest): String?`: the reason in curly quotes, `"“${reason}”"`, or `null` when the reason is `null` or blank.

**Reading the payload.** `EventItem.payload` is a `JsonObject` that kids' devices partly fill in, so read every field defensively, with private helpers:

- a **text** field counts only when it is a `JsonPrimitive` with `isString` true (use `.content`);
- a **number** field counts only when it is a `JsonPrimitive` with `isString` false (use `.intOrNull`): `"minutes": "30"` is **not** 30;
- a **boolean** field counts only when it is a `JsonPrimitive` with `isString` false (use `.booleanOrNull`);
- anything missing or of the wrong type is `null`.

**`fun eventView(e: EventItem, zone: ZoneId): EventView`.** Names used in the table:

- `kid` = `e.kidName`, or `"A kid"` when null;
- `device` = `e.deviceName`, else the payload text `deviceName`, else `"a device"`;
- `by` = the payload text `byName`, or `"A parent"` when null (in the table, `<by>`); where the table says `by?`, it means the raw value, which can be null;
- `pool` = `"Screens"` for the payload text `pool` = `"screens"`, `"Phone"` for `"phone"`, otherwise `"time"`;
- `mins(m)` = `formatDuration(abs(m) * 60L)`; a missing number counts as 0 (and `formatDuration(0)` is `"less than a minute"`);
- `quoted(t)` = `"“$t”"`;
- `time(i)` = `timeOfDay(Instant.parse(i), zone)` (below).

| `e.kind` | `text` | `detail` | `tone` |
|---|---|---|---|
| `time_request` | `"$kid asked for ${mins(minutes)} more $pool"` | `quoted(reason)` if `reason` is there, else null | `REQUEST` |
| `time_request.resolved`, `approved` is `true` | `"<by> said yes to $kid: ${mins(minutes)} more"` | null | `TIME` |
| `time_request.resolved`, otherwise | `"<by> said no to $kid's request"` | null | `INFO` |
| `grant.added`, `lockNow` is `true` | `"<by> locked $kid's $pool"` | null | `TIME` |
| `grant.added`, `minutes` ≥ 0 (or missing) | `"<by> added ${mins(minutes)} of $pool for $kid"` | null | `TIME` |
| `grant.added`, `minutes` < 0 | `"<by> took away ${mins(minutes)} of $pool from $kid"` | null | `TIME` |
| `kid_message` | `"Message from $kid"` | `quoted(body ?: "")` | `MESSAGE` |
| `parent_mode.request` | `"$kid asked for parent mode on $device"` | null | `REQUEST` |
| `parent_mode.used` | `"Parent mode on $device <len>"`: `<len>` is `"until ended"` when `durationMin` is missing, `"for 1 hour"` for 60, else `"for $durationMin min"` | `"Started by $by?"` when `by?` is there, else `"Started with the parent code"` | `INFO` |
| `parent_mode.denied` | `"<by> said no to parent mode on $device"` | null | `INFO` |
| `parent_mode.ended` | `"Parent mode ended on $device"` | `"Ended by $by?"` when `by?` is there, else null | `INFO` |
| `sos.started` | `"SOS from $kid"` | `"On $device"` | `SOS` |
| `sos.acked` | `"<by> is on $kid's SOS"` | null | `SOS` |
| `sos.extended` | `"<by> kept $kid's SOS on"` | `"Until ${time(autoStopAt)}"` when `autoStopAt` is there, else null | `SOS` |
| `sos.ended`, `endedBy` = `"kid"` | `"$kid ended the SOS: safe"` | null | `SOS` |
| `sos.ended`, `endedBy` = `"auto"` | `"$kid's SOS stopped by itself"` | null | `SOS` |
| `sos.ended`, otherwise | `"<by> ended $kid's SOS"` | null | `SOS` |
| `overspend` | `"$kid went ${formatDuration(overspendSec)} over on $pool"` (`overspendSec` a number, 0 when missing) | `"$device was offline, so it could not know the time had run out"` | `ALERT` |
| `device.offline` | `"$device is offline"` | `"Last seen at ${time(lastSeenAt)}"` when `lastSeenAt` is there, else null | `INFO` |
| `device.enrolled` | `"${name ?: device} was added for $kid"` (`name` the payload text) | null | `INFO` |
| starts with `tamper.` | `"$device: <what>"`, `<what>` from the list below | `"Number: $number"` when the payload text `number` is there, else null | `ALERT` |
| anything else | `e.kind` itself | null | `INFO` |

Tamper `<what>`: `tamper.clock` → `"the clock was changed"`; `tamper.timezone` → `"the time zone was changed"`; `tamper.tray_killed` → `"the ScreenTime tray app was closed"`; `tamper.policy` → `"a protected setting was changed"`; `tamper.call_blocked` → `"a call was blocked"`; any other `tamper.…` → `"something was tampered with"`.

**Times:**

- `fun timeOfDay(instant: Instant, zone: ZoneId): String`: `DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)` in `zone`, then `.lowercase()`: `"3:30 pm"`, `"12:05 am"`.
- `fun whenText(at: String, now: Instant, zone: ZoneId): String`: `at` is an ISO instant. On the same calendar day as `now` (both in `zone`): just `timeOfDay`. The day before: `"Yesterday, " + timeOfDay`. Earlier: `DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)` of the day, `", "`, `timeOfDay`: `"Sat 24 Oct, 9:00 am"`.

**Errors:**

- `fun answerError(e: Exception): String`, for a Yes or No that did not work:

| `e` | Returns |
|---|---|
| `ApiException` with `status` 409 | `"Someone already answered this request."` |
| `ApiException` with `status` 404 | `"This request is gone."` |
| any other `ApiException` | `"Something went wrong on the server. Try again soon."` |
| anything else | `"Can't reach Screen Time. Check the internet connection and try again."` |

### 6.6 `inbox/InboxViewModel.kt` (new)

An `AndroidViewModel` like `TodayViewModel`, with `private val session = getApplication<ParentApp>().session`.

```kotlin
/** The Inbox's state. `requests` is null until the first answer. */
data class InboxState(
    val requests: List<TimeRequest>? = null,
    val events: List<EventItem> = emptyList(),
    val refreshing: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val busy: Boolean = false,
)
```

`var state by mutableStateOf(InboxState())` with a private setter, and:

- `val pending: Int` (a getter): `state.requests?.size ?: 0`. The badge shows it.
- `suspend fun load(pulled: Boolean = false)`: exactly as `TodayViewModel.load`, with the same `refreshing` and error handling and the same two error texts, but it asks for two things, one after the other in the same `try`: `session.call { getRequests(status = TimeRequestStatus.PENDING) }` and `session.call { getEvents(limit = 50) }.events`. On success it sets both and `error = null`.
- `suspend fun approve(request: TimeRequest, minutes: Int? = null)`: `session.call { postRequestsApprove(request.id, TimeRequestApprove(minutes = minutes)) }`. `null` minutes gives the kid what they asked for.
- `suspend fun deny(request: TimeRequest)`: `session.call { postRequestsDeny(request.id) }`.
- `approve` and `deny` both: do nothing if `state.busy`; set `busy = true, notice = null`; make the call; on any `Exception` except `CancellationException` (rethrow) and `SignedOutException` (ignore), set `notice = answerError(e)`; then, worked or not, call `load()` (a 409 means the card is stale: reloading drops it) and set `busy = false`.
- `fun clear()`: back to `InboxState()`, after a sign-out.

### 6.7 `inbox/InboxScreen.kt` (new)

```kotlin
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(vm: InboxViewModel, zone: ZoneId)
```

The home screen polls the Inbox every 30 seconds (6.8), so this screen has **no** loop of its own. It only loads once when it first shows (`LaunchedEffect(Unit) { vm.load() }`) and on pull-down.

**Layout:** a `Column(Modifier.fillMaxSize())` with `ScreenHeader("Inbox")`, then a `PullToRefreshBox` exactly as on Today (`isRefreshing = state.refreshing`, `onRefresh` launches `vm.load(pulled = true)`), holding:

- When `requests` is null and `error` is null: a centred `CircularProgressIndicator`.
- When `requests` is null and there is an `error`: `Problem(error, onRetry = …vm.load(pulled = true))` from `TodayScreen.kt`.
- Otherwise a `LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp))` with, in this order:
  1. `error`, if any: `bodyMedium`, `ScreenTimeTheme.colors.critical` (as on Today).
  2. `notice`, if any: same style.
  3. If `requests` is not empty: the heading `"Waiting for you"` (`titleMedium`, `FontWeight.SemiBold`, `onBackground`), then one **request card** per request, in the server's order (newest first). If it is empty, no heading and no cards.
  4. The heading `"History"` (same style).
  5. If `events` is empty: `"Nothing yet"` in `bodyLarge`, `ScreenTimeTheme.colors.muted`. Otherwise **one** card holding one **event row** per event, with a `HorizontalDivider(color = ScreenTimeTheme.colors.outline)` between rows (not before the first or after the last).

Use `items(…, key = { it.id })` for the request cards. The history card is one `item`.

Both kinds of card look like Today's kid card: `Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), border = BorderStroke(1.dp, ScreenTimeTheme.colors.outline))`.

**Request card** (`Column(Modifier.padding(16.dp))`):

1. `requestTitle(r)`: `bodyLarge`, `FontWeight.SemiBold`, `onSurface`.
2. If `requestDetail(r)` is not null: 2 dp gap, it in `bodyMedium`, `onSurface`.
3. 2 dp gap. `"${r.deviceName} · ${whenText(r.createdAt, now, zone)}"` in `bodySmall`, `ScreenTimeTheme.colors.muted` (`now` = `Instant.now()`, taken once per composition of the list).
4. 12 dp gap. A `Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically)` with three buttons, all disabled while `state.busy`:
   - `TextButton` `"Other amount"`: opens the amount dialog for this request;
   - `OutlinedButton` `"No"`: launches `vm.deny(r)`;
   - `Button` `"Yes, ${formatDuration(r.minutes * 60L)}"` (`"Yes, 30m"`): launches `vm.approve(r)`.

**The amount dialog** (one at a time; keep the open request's id in `TodayScreen`-style `remember` state in `InboxScreen`): an `AlertDialog` with:

- `title`: `"Give ${r.kidName} more ${poolName(r.pool)}"`;
- `text`: a `Column(horizontalAlignment = Alignment.CenterHorizontally)`:
  1. `"${r.kidName} asked for ${formatDuration(r.minutes * 60L)}. It counts for today only."` in `bodyMedium`;
  2. 16 dp gap. A stepper `Row` as in the adjust sheet: `OutlinedIconButton` 48 dp with `ic_remove`, `contentDescription = "15 minutes less"`, enabled above 15; the amount `formatDuration(minutes * 60L)` in `headlineMedium`, `FontWeight.SemiBold`, centred in `Modifier.widthIn(min = 120.dp)`; `OutlinedIconButton` 48 dp with `ic_add`, `contentDescription = "15 minutes more"`, enabled below 480. Steps of 15.
  3. 12 dp gap. A `Row(horizontalArrangement = Arrangement.spacedBy(8.dp))` of `FilterChip`s for 15, 30, 60, 120, label `formatDuration(q * 60L)` (`"15m"`, `"30m"`, `"1h"`, `"2h"`), selected when equal.
  The amount starts at `r.minutes` (clamped to 15..480).
- `confirmButton`: `TextButton` `"Give ${formatDuration(minutes * 60L)}"` (`"Give 45m"`): closes the dialog and launches `vm.approve(r, minutes)`;
- `dismissButton`: `TextButton` `"Cancel"`; `onDismissRequest` closes it too.

If the request disappears from `state.requests` while its dialog is open (someone else answered), close the dialog.

**Event row** (`Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.Top)`), from `val v = eventView(e, zone)`:

1. A 10 dp dot: `Box(Modifier.padding(top = 6.dp).size(10.dp).background(color, CircleShape))`, colour by `v.tone`: `SOS` → `ScreenTimeTheme.colors.danger`; `ALERT` → `ScreenTimeTheme.colors.warning`; `REQUEST` → `MaterialTheme.colorScheme.primary`; `MESSAGE` → `AvatarColors[1]` (violet, from `au.screentime.core.ui`); `TIME` → `AvatarColors[3]` (blue); `INFO` → `ScreenTimeTheme.colors.muted`.
2. 12 dp gap. A `Column(Modifier.weight(1f))`: `v.text` in `bodyMedium`, `onSurface`; under it, if `v.detail` is not null, `v.detail` in `bodySmall`, `onSurface`.
3. 8 dp gap. `whenText(e.at, now, zone)` in `bodySmall`, `ScreenTimeTheme.colors.muted`.

### 6.8 `home/HomeScreen.kt` (change)

1. The signature becomes, exactly: `fun HomeScreen(me: Me, today: TodayViewModel, inbox: InboxViewModel, secure: Boolean, onSignOut: () -> Unit)`.
2. **Poll the Inbox on every tab**, so the badge is right: at the top of `HomeScreen`, the same `LocalLifecycleOwner` + `repeatOnLifecycle(Lifecycle.State.STARTED)` loop as `TodayScreen` uses, calling `inbox.load()` then `delay(REFRESH_MS)` (from `today/TodayView.kt`), forever.
3. The Inbox tab's icon gets a badge: in `NavigationBarItem`'s `icon`, for `Tab.INBOX` only, wrap the `Icon` in `BadgedBox(badge = { if (inbox.pending > 0) Badge { Text("${inbox.pending}") } })`. The other tabs stay as they are.
4. `Tab.INBOX` shows `InboxScreen(inbox, ZoneId.of(me.family!!.timezone))` instead of the coming-soon page. (`HomeScreen` is only shown when the family is not null, see `MainActivity`.) If `ZoneId.of` throws for a bad name, use `ZoneId.systemDefault()` instead (`runCatching`).
5. Everything else stays. `ComingSoonPage` is still used by Kids.

### 6.9 `MainActivity.kt` (change)

1. Add `private val inbox: InboxViewModel by viewModels()` next to `today`.
2. In the `LaunchedEffect(state)` that clears Today on sign-out, also call `inbox.clear()`.
3. Pass `inbox` to `HomeScreen(s.me, today, inbox, secure = isSecure(), ::signOut)`.

Nothing else changes.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-041-parent-inbox
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-041-parent-inbox.md` must exist. If not, run `git pull origin main` again, and if still missing, stop and ask James.
2. Copy the files of section 5. Write the files of section 6 in the order of the section. Build and test:
   ```powershell
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat assembleDebug test
   cd ..
   ```
   Until it passes, fix **your** code, never the tests or the copied files. Commit: `CARD-041: Parent app: change time, Inbox and time requests`.
3. Run the acceptance checks in section 8, including the emulator run (8.2), in this session. If the emulator run shows a problem in your code, fix it, build and test again, commit (`CARD-041: <what you fixed>`), and run the emulator run again from step 1.
4. Push and open the PR (section 10).
5. Wait for the CI check to finish (`gh pr checks <number> --watch`).
6. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token, refresh, access or device token, or sign-in code in the PR or the handback. The throwaway `local-dev-only-…` values and the PIN `1234` below are fine.

### 8.1 Build and tests

- [ ] From `android`, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`, with no compiler warning in the `app-parent` files (paste any `w:` lines under "Deviations").
- [ ] The tests really ran. From `android`, this prints six lines:
  ```powershell
  Select-String -Path app-parent\build\test-results\testDebugUnitTest\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.parent.auth.SessionTest tests="9" failures="0" errors="0"
  au.screentime.parent.auth.SignInTest tests="4" failures="0" errors="0"
  au.screentime.parent.inbox.InboxTest tests="7" failures="0" errors="0"
  au.screentime.parent.lock.AppLockTest tests="3" failures="0" errors="0"
  au.screentime.parent.today.AdjustTest tests="6" failures="0" errors="0"
  au.screentime.parent.today.TodayViewTest tests="9" failures="0" errors="0"
  ```
- [ ] The tests and the copied files are unchanged: Claude compares every one of them byte for byte with this card.

### 8.2 On the emulator

Run every step below **in this session**, one after another without long breaks, exactly as written, and paste the **real terminal output** of each step into the handback. A summary is not accepted. If your context was summarised partway through, run the steps again from step 1. Paste any extra command you ran, with its output, under "Deviations". **Never do this run on a real phone.**

**The emulator.** Use `Medium_Phone_API_37.0`, wiped or not. Start it, and when `& $adb devices` lists exactly one `emulator-5554   device` and `& $adb shell getprop sys.boot_completed` prints `1`:

```powershell
& $adb shell locksettings get-disabled
& $adb shell am task lock stop
& $adb uninstall au.screentime.parent
& $adb shell settings put system screen_off_timeout 1800000
& $adb shell settings put system accelerometer_rotation 0
& $adb shell settings put system user_rotation 0
& $adb shell svc wifi enable
& $adb shell svc data enable
& $adb shell input keyevent KEYCODE_WAKEUP
& $adb shell wm dismiss-keyguard
```

The first line must print `true` (no screen lock). If it prints `false`, a PIN is left from an earlier run: run `& $adb shell locksettings clear --old 1234`. **Trap from CARD-040:** if the emulator was restarted while a PIN was set, Android keeps the user **locked** until the PIN is typed once, and every `am start` fails with `Activity class {…} does not exist` (error `-92`) although the app is installed. Then type the PIN on the emulator's own lock screen (or `& $adb shell input text 1234` and `& $adb shell input keyevent KEYCODE_ENTER`), run the `clear` above, and start this block again. This card does **not** set a PIN: the app lock was checked in CARD-040, and with no screen lock the app opens straight to Today.

`uninstall` may print an error on the first run; that is fine.

**The server.** From the repo root, with throwaway values (this replaces any `deploy/.env`; it is git-ignored). The `deploy\.env` has no SMTP values, so the server writes sign-in codes to its log:

```powershell
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
pnpm --filter @screentime/server exec tsx scripts/dev-bedtime.ts Alex 120 150
pnpm --filter @screentime/server exec tsx scripts/dev-bedtime.ts Sam 120 0
pnpm --filter @screentime/server exec tsx scripts/dev-usage.ts Alex 140
```

`seed-dev.ts` prints `Seeded family ... with parent dad@example.com and kids Alex and Sam.` The two `dev-bedtime.ts` give Alex 150 minutes of each pool today and Sam none. `dev-usage.ts` prints `Alex has been using "alex on Dev PC" for 140 min, and still is.`, so Alex's Screens has about 10 minutes left. If `up --wait` returns before the API answers, wait until `curl.exe -s http://localhost:8080/health` shows `"status":"ok"`. Do the run between 6 am and 9:30 pm Sydney time: `dev-bedtime.ts` refuses a bedtime after midnight.

**Helpers.** Paste them into the same PowerShell window (they are not files in the repo). `Screen-Text` prints every piece of text on the screen, joined with ` | `. `Tap-Text` taps the last node whose text is exactly the given text; `Tap-Desc` taps the node whose content description is exactly the given text. `Code` prints the newest sign-in code for dad@example.com from the server's log. `Grants` prints today's grants from the database, oldest first. `Pull` pulls the screen down to refresh.

```powershell
function Dump-Ui {
  & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  & $adb pull /sdcard/ui.xml "$t\ui.xml" | Out-Null
  [xml](Get-Content "$t\ui.xml" -Raw -Encoding UTF8)
}
function Screen-Text {
  $ui = Dump-Ui
  ($ui.SelectNodes('//node') | Where-Object { $_.text } | ForEach-Object { $_.text }) -join ' | '
}
function Tap-Node($node, [int]$wait) {
  $b = [regex]::Matches($node.bounds, '\d+') | ForEach-Object { [int]$_.Value }
  & $adb shell input tap ([int](($b[0] + $b[2]) / 2)) ([int](($b[1] + $b[3]) / 2))
  Start-Sleep -Seconds $wait
}
function Tap-Text([string]$text, [int]$wait = 2) {
  $node = (Dump-Ui).SelectNodes('//node') | Where-Object { $_.text -eq $text } | Select-Object -Last 1
  if (-not $node) { throw "No '$text' on screen" }
  Tap-Node $node $wait
}
function Tap-Desc([string]$desc, [int]$wait = 2) {
  $node = (Dump-Ui).SelectNodes('//node') | Where-Object { $_.'content-desc' -eq $desc } | Select-Object -Last 1
  if (-not $node) { throw "No '$desc' on screen" }
  Tap-Node $node $wait
}
function Hide-Keyboard {
  if (& $adb shell dumpsys input_method | Select-String 'mInputShown=true') {
    & $adb shell input keyevent KEYCODE_BACK
    Start-Sleep -Seconds 1
  }
}
function Shot([string]$name) {
  & $adb shell screencap -p /sdcard/shot.png
  & $adb pull /sdcard/shot.png "$t\$name.png" | Out-Null
}
function Open-App {
  & $adb shell am start -n au.screentime.parent/.MainActivity | Out-Null
  Start-Sleep -Seconds 3
}
function Pull {
  & $adb shell input swipe 540 700 540 1700 400
  Start-Sleep -Seconds 4
}
function Code {
  $line = docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env logs api | Select-String 'sign-in code for dad@example.com is (\d{6})' | Select-Object -Last 1
  $line.Matches[0].Groups[1].Value
}
function Grants {
  docker compose -f ..\deploy\docker-compose.yml --env-file ..\deploy\.env exec db psql -U screentime -d screentime -c "select k.name, g.pool, g.minutes, g.request_id is not null as from_request from grants g join kids k on k.id = g.kid_id order by g.created_at"
}
```

**The run.** From `android`, one step at a time; check each expected result before the next step. Minutes on Alex's Screens depend on how long the run takes: where the card says `N`, any number in the range given is fine.

1. Install, open and sign in:
   ```powershell
   & $adb install -r app-parent\build\outputs\apk\debug\app-parent-debug.apk
   Open-App
   Tap-Text "Email"
   & $adb shell input text "dad@example.com"
   Hide-Keyboard
   Tap-Text "Send code" 4
   $code = Code
   Tap-Text "Code"
   & $adb shell input text $code
   Hide-Keyboard
   Tap-Text "Sign in" 6
   Shot "1-today"
   Screen-Text
   ```
   `install` prints `Success`. `1-today` shows Today with no lock screen (the emulator has no screen lock): Alex's card with Screens `Nm left` in amber (N from 5 to 10) and Phone `2h 30m left`, Sam's card with both pools `Locked · out of time`, and on the right of **each** of the four pool rows a small round outlined **±** button. `Screen-Text` has `±` four times. Do not paste the code; write `<6 digits>` if it shows anywhere.
2. Open the adjust sheet on Alex's Screens:
   ```powershell
   Tap-Desc "Change Alex's Screens"
   Shot "2-adjust"
   Screen-Text
   ```
   `2-adjust` shows the sheet from the bottom: "Change Alex's time", the segmented **Screens | Phone** with Screens selected, the − button, `+15m` in big teal type, the + button, the four chips `+15m` (selected) `+30m` `+1h` `+2h`, `Now Nm left → N+15m left` in grey, the full-width **Apply** pill and a red **Lock now** under it. `Screen-Text` has `Change Alex's time | Screens | Phone | +15m | +15m | +30m | +1h | +2h | Now Nm left → …m left | Apply | Lock now`.
3. Choose +1h, one step less, and apply:
   ```powershell
   Tap-Text "+1h"
   Tap-Desc "15 minutes less"
   Screen-Text
   Tap-Text "Apply" 4
   Screen-Text
   Grants
   ```
   The first `Screen-Text` has `+45m` and `Now Nm left → …m left` with the second number about 45 more than the first. After **Apply** the sheet is gone and Today shows Alex's Screens at `Nm left` (N from 45 to 55) in teal. `Grants` prints one row: `Alex | screens | 45 | f`.
4. Lock Alex's Phone:
   ```powershell
   Tap-Desc "Change Alex's Phone"
   Tap-Text "Lock now"
   Screen-Text
   Tap-Text "Lock now" 4
   Shot "3-locked"
   Screen-Text
   Grants
   ```
   The first `Screen-Text` (the dialog) has `Lock Alex's Phone now? | This takes away the 2h 30m left today. Alex can still ask for more time. | Cancel | Lock now` (the order may differ). After the dialog's **Lock now**, `3-locked` shows Today with Alex's Phone `Locked · out of time` in grey, empty bar. `Grants` has a second row: `Alex | phone | -150 | f`.
5. A locked pool has no **Lock now**, and 0 cannot be applied:
   ```powershell
   Tap-Desc "Change Sam's Phone"
   Screen-Text
   Tap-Desc "15 minutes less"
   Shot "4-adjust-locked"
   Screen-Text
   & $adb shell input keyevent KEYCODE_BACK
   Start-Sleep -Seconds 2
   Grants
   ```
   The first `Screen-Text` has `Change Sam's time`, `Phone` selected, `Now locked → 15m left`, `Apply`, and **no** `Lock now`. After the − step, `4-adjust-locked` shows `0m` in grey, `Now locked → locked`, and **Apply** greyed out (disabled). BACK closes the sheet; `Grants` still has two rows.
6. Two kids ask for more time; the badge counts them:
   ```powershell
   pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-ask.ts Alex 30 Finishing my homework video
   pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-ask.ts Sam 60
   Start-Sleep -Seconds 35
   Shot "5-badge"
   Screen-Text
   ```
   The scripts print `Alex asked for 30 min more Phone from "Alex's Dev Phone": "Finishing my homework video"` and `Sam asked for 60 min more Phone from "Sam's Dev Phone".` Without touching the app (still on Today), `5-badge` shows a small red badge with `2` on the Inbox icon of the bottom bar. `Screen-Text` has a `2` (the badge) among the bottom bar's words.
7. The Inbox:
   ```powershell
   Tap-Text "Inbox" 3
   Shot "6-inbox"
   Screen-Text
   ```
   `6-inbox` shows "Inbox" at the top, the heading "Waiting for you", two request cards (Sam's first, newest), each with **Other amount**, **No** and **Yes, …** on the right, then "History" and one card of event rows with coloured dots and times on the right. `Screen-Text` has, in this order: `Inbox | Waiting for you | Sam wants 1h more Phone | Sam's Dev Phone · <time> | Other amount | No | Yes, 1h | Alex wants 30m more Phone | “Finishing my homework video” | Alex's Dev Phone · <time> | Other amount | No | Yes, 30m | History | Sam asked for 1h more Phone | Sam's Dev Phone was added for Sam | Alex asked for 30m more Phone | “Finishing my homework video” | Alex's Dev Phone was added for Alex | Dad locked Alex's Phone | Dad added 45m of Screens for Alex | …` (`<time>` like `3:41 pm`; after the history rows comes the bottom bar). The first two history rows have blue-green (teal) dots; `Dad locked …` and `Dad added …` have blue dots; `… was added …` grey dots.
8. Yes to Alex:
   ```powershell
   Tap-Text "Yes, 30m" 4
   Screen-Text
   Grants
   ```
   Alex's card is gone; Sam's stays. The first history row is `Dad said yes to Alex: 30m more`. The badge shows `1`. `Grants` has a third row: `Alex | phone | 30 | t`.
9. Other amount for Sam:
   ```powershell
   Tap-Text "Other amount"
   Shot "7-other-amount"
   Screen-Text
   Tap-Desc "15 minutes less"
   Tap-Text "Give 45m" 4
   Screen-Text
   Grants
   ```
   `7-other-amount` shows the dialog: "Give Sam more Phone", "Sam asked for 1h. It counts for today only.", the stepper with `1h`, the chips `15m 30m 1h 2h` with `1h` selected, and **Cancel** and **Give 1h**. After the − step and **Give 45m**: no "Waiting for you" any more, no badge, and the first history row is `Dad said yes to Sam: 45m more`. `Grants` has a fourth row: `Sam | phone | 45 | t`.
10. No to Sam, and an answer that came too late for Alex:
    ```powershell
    pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-ask.ts Sam 15
    Pull
    Tap-Text "No" 4
    Screen-Text
    pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-ask.ts Alex 15
    Pull
    pnpm --dir .. --filter @screentime/server exec tsx scripts/dev-answer.ts Alex no
    Tap-Text "No" 4
    Shot "8-too-late"
    Screen-Text
    ```
    After the first **No**: no request card, and the first history row is `Dad said no to Sam's request`. `dev-answer.ts` prints `Dad said no to Alex's request for 15 min (no reason).` (another parent answering first, as far as the app knows). After the second **No**, `8-too-late` shows `Someone already answered this request.` in orange-red at the top of the list, no request card, and `Dad said no to Alex's request` as the first history row. `Screen-Text` has `Someone already answered this request.`
11. Today after all of it:
    ```powershell
    Tap-Text "Today" 4
    Shot "9-today-after"
    Screen-Text
    ```
    Alex: Screens `Nm left` (N from 40 to 55), Phone `30m left`; Sam: Screens `Locked · out of time`, Phone `45m left` (or `44m left`). `Screen-Text` has `30m left` and `45m left` or `44m left`.
12. Undo, so the emulator can be used again:
    ```powershell
    & $adb uninstall au.screentime.parent
    & $adb shell settings put system screen_off_timeout 60000
    cd ..
    docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
    Remove-Item Env:DATABASE_URL
    Remove-Item Env:JWT_SECRET
    ```
    `uninstall` prints `Success`.

- [ ] Steps 1 to 12 gave the expected results, run in this session. Paste the real output of every helper and command in steps 1 to 11 into the handback (`Screen-Text`, `Grants`, and the scripts' lines).
- [ ] The nine screenshots exist in `C:\Users\james\OpenCode\Testing\temp\c41\`: `1-today.png`, `2-adjust.png`, `3-locked.png`, `4-adjust-locked.png`, `5-badge.png`, `6-inbox.png`, `7-other-amount.png`, `8-too-late.png`, `9-today-after.png`. Do not commit them. Claude looks at them.

### 8.3 Repo

- [ ] `pnpm typecheck` passes and `pnpm --filter @screentime/server test` passes (`53 passed | 171 skipped (224)` without a database). Nothing outside `android/app-parent/` changed except `server/scripts/dev-ask.ts`.
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties`, anything under `build/`, or any `.png` or `.xml` from the temp folder.
- [ ] The GitHub Actions **Android / build and test** check is green on the PR. Wait for it (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 14 files:
  ```
  android/app-parent/src/main/kotlin/au/screentime/parent/MainActivity.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/home/HomeScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/inbox/Inbox.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/inbox/InboxScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/inbox/InboxViewModel.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/today/Adjust.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/today/AdjustSheet.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/today/TodayScreen.kt
  android/app-parent/src/main/kotlin/au/screentime/parent/today/TodayViewModel.kt
  android/app-parent/src/main/res/drawable/ic_add.xml
  android/app-parent/src/main/res/drawable/ic_remove.xml
  android/app-parent/src/test/kotlin/au/screentime/parent/inbox/InboxTest.kt
  android/app-parent/src/test/kotlin/au/screentime/parent/today/AdjustTest.kt
  server/scripts/dev-ask.ts
  ```

## 9. Tests

The two new test files are copied (5.2, 5.3) and must pass **unchanged**: 13 tests. The four CARD-040 suites (25 tests) must still pass unchanged.

| Suite | Tests | Checks |
|---|---|---|
| `AdjustTest` | 6 | the default, the quick amounts and rounding to 15 minutes within −4h..+8h; the stepper's ends; the amount's words with a real minus sign; the preview before and after; a locked pool gets exactly the grant; the sheet's and the lock dialog's titles |
| `InboxTest` | 7 | a request's title and quoted reason; time, grant, lock and message events; parent mode, SOS and device events; tamper and overspend alerts; missing or wrongly typed payload fields; "3:30 pm", "Yesterday, …", "Sat 24 Oct, …"; the words for an answer that failed |

The screens are checked by the emulator run in 8.2.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit (step 2). Message format: `CARD-041: <what changed>`.
3. Before pushing, run the commands of 8.1 and 8.3 again and make sure all pass.
4. Push: `git push -u origin bob/card-041-parent-inbox`
5. Open a PR into `main` titled `CARD-041: Parent app: change time, Inbox and time requests`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (create the folder first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-041-parent-inbox --title "CARD-041: Parent app: change time, Inbox and time requests" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-041-parent-inbox.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`, no app-parent warnings
   - [x] tests ran — output: six suites, 38 tests, all `failures="0"`
   - [x] tests and copied files unchanged
   - [x] emulator run steps 1 to 12 — results as expected
   - [x] nine screenshots in C:\Users\james\OpenCode\Testing\temp\c41\
   - [x] typecheck and server tests — output: `53 passed | 171 skipped (224)`
   - [x] deploy/.env, local.properties, build/ and screenshots not tracked
   - [x] CI checks green
   - [x] only expected files changed — output: 14 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
   Only tick a box if you ran the command and saw that output. If you could not run something, leave the box empty and say why.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first error lines, not the whole log.

Known traps, and what to do:

- **A test fails**: fix your code until it passes. Never change a test, never skip one, never add `@Disabled`. Read the test: it says exactly what is expected. If you are sure a test contradicts this card, quote both under "Blockers / questions" and stop.
- **`AdjustTest` fails on `"−45m"`**: you used the hyphen `-` (U+002D). The sign is `−` (U+2212). Copy it from this card.
- **`InboxTest` `anEventWithMissingOrOddFieldsStillReads` fails**: a payload helper reads `"30"` (a string) as a number, or uses `.content` on a non-string. Follow the "Reading the payload" rules in 6.5.
- **`InboxTest` fails on `whenText`**: the formatter is not in `zone`, or not `Locale.ENGLISH`, or the result is not lowercased (`"3:30 PM"`).
- **`SingleChoiceSegmentedButtonRow`, `SegmentedButton` or `ModalBottomSheet` is experimental** in your build: put `@OptIn(ExperimentalMaterial3Api::class)` on the function (the signature in 6.3 has it already). Do not add a library.
- **`Unresolved reference: semantics` or `contentDescription`**: the imports are `androidx.compose.ui.semantics.semantics` and `androidx.compose.ui.semantics.contentDescription`.
- **Before step 1: `Activity class {au.screentime.parent/au.screentime.parent.MainActivity} does not exist` (error `-92`)** although `install` said `Success`: the emulator is still locked after a restart with a PIN. See "The emulator" in 8.2: type the PIN once, clear it, and start again. Do not change the manifest.
- **Step 1: the lock screen shows instead of Today**: `locksettings get-disabled` printed `false`. Clear the PIN (8.2) and run step 1 again from `Open-App`.
- **Step 2: `Tap-Desc` says `No 'Change Alex's Screens' on screen`**: the description is not on the button. Paste `Dump-Ui | Out-Null; Select-String -Path "$t\ui.xml" -Pattern '±' -Context 0,0` and stop.
- **Step 3: Today did not change after Apply**: `adjust` does not call `load()` after the grant (6.2), or the sheet did not close. Paste `Grants`: if the row is there, the grant worked and only the screen is stale.
- **Step 3 or 4: `Grants` has two rows for one tap**: the sheet sent two calls with two ids. Tapping once must send once; check that **Apply** is disabled while `busy`.
- **Step 6: no badge after 35 seconds**: the Inbox poll in `HomeScreen` (6.8) is missing, or `pending` does not read `state.requests`. Paste `Screen-Text` and stop.
- **Step 6: `dev-ask.ts` says `409 … You already asked`**: a request of that kid is still waiting from an earlier try. Run `down -v` and the server block again, then the run from step 1.
- **Step 10: the second `No` worked with no message**: the app's list was refreshed after `dev-answer.ts` ran (a 30-second poll fell in between) and the card was already gone, so there was nothing to tap: `Tap-Text "No"` then says `No 'No' on screen`. Run the last five commands of step 10 again from the second `dev-ask.ts`, quickly.
- **`Pull` does nothing**: the swipe must start inside the list. Use `& $adb shell input swipe 540 900 540 1900 400` instead and say so under "Deviations".
- **`dev-bedtime.ts` says the bedtime would be after midnight**: it is too late in the day. Do the run the next day after 6 am.
- **Never tap Emergency 000**, never run this on a real phone, and never install a release build.
- **Temporary files** (the PR body, `ui.xml`, the screenshots, any helper scripts) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **Every difference from the card is a deviation**: a copied file that differs, a name, a word on screen, a size or colour, a different way of running a check. List each one under "Deviations". If you explain why something happened, say whether you checked it or are guessing.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-041. Please review and merge if it is good.

CARD: CARD-041 Parent app: change time, Inbox and time requests
PR: <full PR URL>
Branch: bob/card-041-parent-inbox
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
