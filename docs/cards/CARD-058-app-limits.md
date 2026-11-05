# CARD-058: Daily limits per app

| Field | Value |
|---|---|
| Card | CARD-058 |
| Title | Daily limits per app |
| Size | L |
| Depends on | CARD-057 and the CARD-058 front end (PR #160), merged to `main` |
| Spec sections | docs/SPEC.md §12.4, §6.1, §8.2, §9.2, §9.3, §10, §14, §16.2, §16.4, §16.5, Q36 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-058-app-limits` |
| PR title | `CARD-058: Daily limits per app` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first (rules 8, 9 and 10 especially).

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM: section 8.1 checks for mangled characters (`§` saved as `Â§`).

CARD-056 made the app list and CARD-057 made blocking. This card lets a parent give an app a daily limit, for example 30 minutes of YouTube, shared across the kid's Android devices. Android only.

Claude has already rehearsed this card with the code below, and every step of section 8 passed. Copy the code exactly. The tests are the contract and must pass unchanged.

The screens are merged (PR #160), behind a seam with fake limits that only shows in dev and debug builds. **Rule 10 of `AGENTS.md` applies:** the only changes you make to those screens are the seam removals in section 5.3, and those are exact.

**The run must be your own.** This card has no sample of Claude's output. Claude checks your run's ids and times against the file's date and the development database, as it did on CARD-057, whose pasted output was not from a run of that branch. If a step stops, hangs or fails, say so and paste what it printed: a failed run reported honestly is fine, and a run that did not happen is not.

## 2. Goal

A parent can set a daily limit on an app. The kid's device adds up the time from Android's usage events plus the time from the kid's other devices, warns at 5 minutes left, blocks the app at the limit, and shows what is left on the main screen. If usage access is turned off, parents are told and limited apps stay blocked. `pnpm test`, `.\gradlew.bat assembleDebug test`, the Windows tests and `pwsh -File docs\cards\CARD-058-run.ps1` all pass, and CI is green.

## 3. Out of scope

- A kid cannot ask for more time on one app (Q38). A parent changes the limit instead.
- No change to the time engine. App time still counts towards the pool as before.
- Nothing new on Windows. It only gets the regenerated client and the three test fixture lines in 5.3.
- No new library. Do not edit generated files by hand.
- Never run on a real phone, never install a release build, never commit secrets (`deploy/.env`, tokens, keys, `google-services.json`, `local.properties`).

## 4. Tech

The project's existing stack, with nothing new.

Traps Claude hit in the rehearsal, so you need not:

- **An upload can never be taken back.** The server keeps the larger value, so the usage upload must leave out parent mode even when parent mode has just ended and the service has not looked yet. That is why `sendUsage` adds the open span. The first rehearsal counted 43 seconds of parent mode.
- A kid can turn off usage access with one tap in Settings, and Device Owner cannot stop it. So the device treats it as tampering and blocks limited apps until it is back.
- In the C# tests the JSON is a raw interpolated string, so `}}` breaks it. Follow the diffs in 5.3 exactly.
- `dailyMinutes` is `.nullable()`, not optional, for the Kotlin generator. Send `null` for anything but a limit.
- Run `dotnet test` **from the `windows` folder**, where `global.json` is. From the repo root it fails.
- `pnpm test` covers `packages/schemas` too. Run all of it.

## 5. Files

### 5.1 The tests: create these, exactly

#### `server/test/app-limits.test.ts`

```typescript
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { appRules, appUsageDaily, devices, families, kids, parentSessions, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('app limits', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });

  let dad = '';
  let kid = '';
  let family = '';
  const phone = { id: '', token: '' };
  const tablet = { id: '', token: '' };
  const pc = { id: '', token: '' };
  const zone = 'Australia/Sydney';
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());

  function app(pkg: string) {
    return { package: pkg, label: pkg.toUpperCase(), source: 'play', installer: null, blockable: true, installedAt: '2026-11-03T06:00:00.000Z', firstUsedAt: null };
  }

  const rule = (pkg: string, mode: string, dailyMinutes: number | null) =>
    api.put(`/v1/kids/${kid}/apps/${encodeURIComponent(pkg)}/rule`, dad, { mode, dailyMinutes });
  const usage = (device: { token: string }, seconds: number, day = today(), pkg = 'a.game') =>
    api.post('/v1/device/app-usage', device.token, { days: [{ day, apps: [{ package: pkg, seconds }] }] });

  async function addDevice(platform: 'android' | 'windows', form: 'phone' | 'tablet' | 'pc', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({ familyId: family, kidId: kid, platform, form, pool: form === 'phone' ? 'phone' : 'screens', name, tokenHash: hashDeviceToken(token) })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    const [a] = await db.insert(families).values({ name: 'A', timezone: zone, parentCodeSecret: 'A'.repeat(32) }).returning();
    if (!a) throw new Error('no family');
    family = a.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    if (!p) throw new Error('no parent');
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId: family, parentId: p.id, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken: 'dad-phone' })
      .returning();
    if (!session) throw new Error('no session');
    dad = await signAccessToken(TEST_SECRET, { sessionId: session.id, parentId: p.id, familyId: family, roles: ['parent'] });
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '00:00', bedtime: '24:00' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(phone, await addDevice('android', 'phone', 'Pixel 7'));
    Object.assign(tablet, await addDevice('android', 'tablet', 'XPPen'));
    Object.assign(pc, await addDevice('windows', 'pc', 'Alex on PC'));
    await api.put('/v1/device/apps', phone.token, { apps: [app('a.game'), app('b.game')] });
  });

  it('stores a limit, and the list shows it', async () => {
    const saved = await rule('a.game', 'limit', 30);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ mode: 'limit', dailyMinutes: 30 });
    const list = await api.get(`/v1/kids/${kid}/apps`, dad);
    const row = (list.body.apps as { package: string; rule: unknown }[]).find((a) => a.package === 'a.game');
    expect(row?.rule).toEqual({ mode: 'limit', dailyMinutes: 30 });
  });

  it('refuses a limit it cannot use', async () => {
    expect((await rule('a.game', 'limit', null)).status).toBe(422);
    expect((await rule('a.game', 'limit', 0)).status).toBe(422);
    expect((await rule('a.game', 'limit', 7)).status).toBe(422);
    expect((await rule('a.game', 'limit', 485)).status).toBe(422);
    expect((await rule('a.game', 'blocked', 30)).status).toBe(422);
    expect((await rule('a.game', 'limit', 5)).status).toBe(200);
    expect((await rule('a.game', 'limit', 480)).status).toBe(200);
  });

  it('forgets the minutes when the rule stops being a limit', async () => {
    await rule('a.game', 'limit', 30);
    await rule('a.game', 'allowed', null);
    const [row] = await db.select().from(appRules).where(eq(appRules.package, 'a.game'));
    expect(row?.dailyMinutes).toBeNull();
  });

  it('never lowers a value', async () => {
    expect((await usage(phone, 100)).status).toBe(204);
    await usage(phone, 60);
    const [row] = await db.select().from(appUsageDaily);
    expect(row?.seconds).toBe(100);
    await usage(phone, 160);
    const [again] = await db.select().from(appUsageDaily);
    expect(again?.seconds).toBe(160);
  });

  it('refuses a PC, a bad day and no token', async () => {
    expect((await usage(pc, 100)).status).toBe(409);
    expect((await usage(phone, 100, 'yesterday')).status).toBe(422);
    expect((await usage(phone, -1)).status).toBe(422);
    expect((await api.post('/v1/device/app-usage', null, { days: [{ day: today(), apps: [] }] })).status).toBe(401);
  });

  it("adds up today across the kid's devices for a parent, and leaves out other days", async () => {
    await usage(phone, 100);
    await usage(tablet, 50);
    await usage(phone, 999, '2020-01-01');
    const list = await api.get(`/v1/kids/${kid}/apps`, dad);
    const rows = list.body.apps as { package: string; todaySeconds: number }[];
    expect(rows.find((a) => a.package === 'a.game')?.todaySeconds).toBe(150);
    expect(rows.find((a) => a.package === 'b.game')?.todaySeconds).toBe(0);
  });

  it("gives a device the others' seconds for limited apps only, and never its own", async () => {
    await rule('a.game', 'limit', 30);
    await usage(phone, 100);
    await usage(tablet, 50);
    await usage(tablet, 70, today(), 'b.game');
    const state = await api.get('/v1/device/state', phone.token);
    expect(state.body.today.appUsage).toEqual([{ package: 'a.game', deviceId: tablet.id, seconds: 50 }]);
    expect(state.body.apps.rules).toEqual([{ package: 'a.game', mode: 'limit', dailyMinutes: 30 }]);
    const other = await api.get('/v1/device/state', tablet.token);
    expect(other.body.today.appUsage).toEqual([{ package: 'a.game', deviceId: phone.id, seconds: 100 }]);
  });

  it('gives a PC nothing', async () => {
    await rule('a.game', 'limit', 30);
    await usage(tablet, 50);
    const state = await api.get('/v1/device/state', pc.token);
    expect(state.body.today.appUsage).toEqual([]);
    expect(state.body.apps.rules).toEqual([]);
  });

  it('does not push for usage, even of a limited app', async () => {
    await db.update(devices).set({ fcmToken: 'tablet-token' }).where(eq(devices.id, tablet.id));
    await rule('a.game', 'limit', 30);
    sent.length = 0;
    await usage(phone, 100);
    expect(sent).toEqual([]);
  });

  it('counts answering a waiting app with a limit as a yes', async () => {
    await api.put(`/v1/kids/${kid}/app-settings`, dad, { newAppApproval: true });
    await api.put('/v1/device/apps', phone.token, { apps: [app('a.game'), app('b.game'), app('c.game')] });
    await rule('c.game', 'limit', 30);
    const list = await api.get('/v1/events', dad);
    const answered = (list.body.events as { kind: string; payload: { approved: boolean } }[]).find((e) => e.kind === 'app.answered');
    expect(answered?.payload.approved).toBe(true);
  });
});
```

#### `android/app-kid/src/test/kotlin/au/screentime/kid/apps/AppLimitsTest.kt`

```kotlin
package au.screentime.kid.apps

import au.screentime.core.model.api.AppRuleMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** Adding up app time and daily limits (docs/SPEC.md §12.4). */
class AppLimitsTest {
    private fun resumed(name: String, at: Long) = UsageEvent(UsageKind.RESUMED, name, at * 1000)
    private fun paused(name: String, at: Long) = UsageEvent(UsageKind.PAUSED, name, at * 1000)
    private fun off(at: Long) = UsageEvent(UsageKind.SCREEN_OFF, "android", at * 1000)

    private fun usage(vararg events: UsageEvent, from: Long = 0, to: Long = 1000, notCounted: List<Span> = emptyList()) =
        appUsage(events.toList(), from * 1000, to * 1000, notCounted)

    @Test
    fun resumedToPausedCounts() {
        val u = usage(resumed("a", 10), paused("a", 70), resumed("b", 70), paused("b", 100))
        assertEquals(mapOf("a" to 60L, "b" to 30L), u.seconds)
        assertEquals(emptySet<String>(), u.inFront)
    }

    @Test
    fun severalVisitsAddUp() {
        assertEquals(mapOf("a" to 30L), usage(resumed("a", 0), paused("a", 10), resumed("a", 50), paused("a", 70)).seconds)
    }

    @Test
    fun screenOffEndsWhateverIsOpen() {
        val u = usage(resumed("a", 10), off(40), paused("a", 41))
        assertEquals(mapOf("a" to 30L), u.seconds)
        assertEquals(emptySet<String>(), u.inFront)
    }

    @Test
    fun anAppStillOpenCountsUpToNowAndIsInFront() {
        val u = usage(resumed("a", 900), to = 1000)
        assertEquals(mapOf("a" to 100L), u.seconds)
        assertEquals(setOf("a"), u.inFront)
    }

    @Test
    fun anAppInFrontAtMidnightCountsFromMidnight() {
        assertEquals(mapOf("a" to 40L), usage(paused("a", 140), from = 100, to = 200).seconds)
    }

    @Test
    fun yesterdaysEventsAreLeftOut() {
        assertEquals(emptyMap<String, Long>(), usage(resumed("a", 10), paused("a", 20), from = 100, to = 200).seconds)
    }

    @Test
    fun parentModeDoesNotCount() {
        val spans = listOf(Span(20_000, 50_000))
        assertEquals(mapOf("a" to 70L), usage(resumed("a", 0), paused("a", 100), notCounted = spans).seconds)
        assertEquals(mapOf("a" to 0L), usage(resumed("a", 30), paused("a", 40), notCounted = spans).seconds)
    }

    @Test
    fun aLimitLessBothDevices() {
        val limits = appLimits(mapOf("a" to 30), mapOf("a" to 600L), mapOf("a" to 300L), mapOf("a" to "App"))
        assertEquals(listOf(AppLimitNow("a", "App", 900)), limits)
    }

    @Test
    fun aLimitForAnAppNotOnThisDeviceIsLeftOut() {
        assertEquals(emptyList<AppLimitNow>(), appLimits(mapOf("a" to 30), emptyMap(), emptyMap(), emptyMap()))
    }

    @Test
    fun limitsAreInNameOrder() {
        val labels = mapOf("a" to "Zebra", "b" to "apple")
        assertEquals(listOf("apple", "Zebra"), appLimits(mapOf("a" to 5, "b" to 5), emptyMap(), emptyMap(), labels).map { it.label })
    }

    @Test
    fun aLimitUsedUpIsBlocked() {
        val wanted = wantedBlocks(mapOf("a" to AppRuleMode.LIMIT), emptySet(), emptySet(), parentMode = false, limitsOver = setOf("a"))
        assertEquals(setOf("a"), wanted)
    }

    @Test
    fun aLimitNotUsedUpIsNotBlocked() {
        assertEquals(emptySet<String>(), wantedBlocks(mapOf("a" to AppRuleMode.LIMIT), emptySet(), emptySet(), parentMode = false))
    }

    @Test
    fun parentModeAndNeverBlockedBeatALimit() {
        assertEquals(emptySet<String>(), wantedBlocks(emptyMap(), emptySet(), emptySet(), parentMode = true, limitsOver = setOf("a")))
        assertEquals(emptySet<String>(), wantedBlocks(emptyMap(), emptySet(), setOf("a"), parentMode = false, limitsOver = setOf("a", "com.google.android.gms")))
    }

    private fun limit(left: Long) = AppLimitNow("a", "YouTube", left)

    @Test
    fun theWarningComesOnceAtFiveMinutes() {
        assertEquals(emptyList<String>(), limitNews(listOf(limit(301)), setOf("a"), emptySet(), emptySet()).messages)
        val first = limitNews(listOf(limit(300)), setOf("a"), emptySet(), emptySet())
        assertEquals(listOf("5 minutes of YouTube left"), first.messages)
        assertEquals(emptyList<String>(), limitNews(listOf(limit(200)), setOf("a"), first.warned, first.done).messages)
    }

    @Test
    fun theLastWordComesOnce() {
        val first = limitNews(listOf(limit(0)), setOf("a"), setOf("a"), emptySet())
        assertEquals(listOf("That's all your YouTube for today"), first.messages)
        assertEquals(emptyList<String>(), limitNews(listOf(limit(-5)), setOf("a"), first.warned, first.done).messages)
    }

    @Test
    fun anAppNotInFrontIsNotNews() {
        assertEquals(emptyList<String>(), limitNews(listOf(limit(100)), emptySet(), emptySet(), emptySet()).messages)
        assertEquals(emptyList<String>(), limitNews(listOf(limit(0)), emptySet(), emptySet(), emptySet()).messages)
    }

    @Test
    fun moreTimeLetsTheNewsComeAgain() {
        val after = limitNews(listOf(limit(900)), setOf("a"), setOf("a"), setOf("a"))
        assertEquals(emptySet<String>(), after.warned)
        assertEquals(emptySet<String>(), after.done)
    }

    @Test
    fun theNextLookIsWhenAnAppInFrontRunsOut() {
        assertEquals(30_000L, nextLimitMs(listOf(limit(30)), setOf("a")))
        assertNull(nextLimitMs(listOf(limit(30)), emptySet()))
        assertNull(nextLimitMs(listOf(limit(0)), setOf("a")))
    }

    @Test
    fun spansSurviveBeingSaved() {
        val spans = listOf(Span(1, 2), Span(3, 4))
        assertEquals(spans, parseSpans(formatSpans(spans)))
        assertEquals(emptyList<Span>(), parseSpans(""))
        assertEquals(listOf(Span(5, 6)), parseSpans("rubbish,5-6"))
    }
}
```

### 5.2 The run script

`docs/cards/CARD-058-run.ps1` is already in the repo. Do not change it. Do not copy it anywhere.

### 5.3 Change these, exactly as in each diff

Lines with `+` are added and lines with `-` are removed. The surrounding lines show where.

#### `packages/schemas/src/apps.ts`

```diff
@@ -35,17 +35,25 @@ export type DeviceAppsPut = z.infer<typeof DeviceAppsPut>;
 
 /** A parent's rule for an app (docs/SPEC.md §12.4). `held` is written by the server while a new app waits. */
-export const AppRuleMode = z.enum(['allowed', 'held', 'blocked']).meta({ id: 'AppRuleMode' });
+export const AppRuleMode = z.enum(['allowed', 'held', 'blocked', 'limit']).meta({ id: 'AppRuleMode' });
 
 export type AppRuleMode = z.infer<typeof AppRuleMode>;
 
-/** Body of PUT /v1/kids/{kidId}/apps/{package}/rule. A parent cannot hold an app. */
-export const AppRulePut = z.object({ mode: z.enum(['allowed', 'blocked']) }).meta({ id: 'AppRulePut' });
+/**
+ * Body of PUT /v1/kids/{kidId}/apps/{package}/rule. A parent cannot hold an app. `dailyMinutes` is 5 to 480 in steps
+ * of 5 for `limit`, and null otherwise.
+ */
+export const AppRulePut = z
+  .object({ mode: z.enum(['allowed', 'blocked', 'limit']), dailyMinutes: z.int().nullable() })
+  .refine((r) => (r.mode === 'limit' ? r.dailyMinutes !== null && r.dailyMinutes >= 5 && r.dailyMinutes <= 480 && r.dailyMinutes % 5 === 0 : r.dailyMinutes === null), {
+    message: 'A limit needs 5 to 480 minutes in steps of 5, and only a limit has minutes.',
+  })
+  .meta({ id: 'AppRulePut' });
 
 export type AppRulePut = z.infer<typeof AppRulePut>;
 
-export const KidAppRule = z.object({ mode: AppRuleMode });
+export const KidAppRule = z.object({ mode: AppRuleMode, dailyMinutes: z.int().nullable() });
 
 /** Answer of PUT /v1/kids/{kidId}/apps/{package}/rule. */
-export const AppRuleSaved = z.object({ mode: AppRuleMode }).meta({ id: 'AppRuleSaved' });
+export const AppRuleSaved = z.object({ mode: AppRuleMode, dailyMinutes: z.int().nullable() }).meta({ id: 'AppRuleSaved' });
 
 export type KidAppRule = z.infer<typeof KidAppRule>;
@@ -56,4 +64,21 @@ export const KidAppSettings = z.object({ newAppApproval: z.boolean() }).meta({ i
 export type KidAppSettings = z.infer<typeof KidAppSettings>;
 
+/** Body of POST /v1/device/app-usage: seconds per app per local day. A repeat or an older upload never lowers a value. */
+export const DeviceAppUsageUpload = z
+  .object({
+    days: z
+      .array(
+        z.object({
+          day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
+          apps: z.array(z.object({ package: z.string().min(1).max(255), seconds: z.int().min(0).max(86400) })).max(500),
+        }),
+      )
+      .min(1)
+      .max(8),
+  })
+  .meta({ id: 'DeviceAppUsageUpload' });
+
+export type DeviceAppUsageUpload = z.infer<typeof DeviceAppUsageUpload>;
+
 /** One of the kid's devices an app is or was on. */
 export const KidAppDevice = z
@@ -76,5 +101,5 @@ export const KidApp = z
     source: AppSource,
     blockable: z.boolean(),
-    /** 0 until app time is counted (CARD-058). */
+    /** Today's seconds across the kid's devices. */
     todaySeconds: z.int(),
     /** Null means allowed. */
```

#### `packages/schemas/src/index.ts`

```diff
@@ -103,4 +103,5 @@ export {
   DeviceAppIn,
   DeviceAppsPut,
+  DeviceAppUsageUpload,
   KidApp,
   KidAppDevice,
```

#### `packages/schemas/src/sync.ts`

```diff
@@ -62,4 +62,6 @@ export const DeviceState = z
       /** Segments of every device in this pool (this one too) that overlap today, oldest first. */
       poolSegments: z.array(PoolSegment),
+      /** Today's seconds of the kid's other Android devices, only for apps with a daily limit (docs/SPEC.md §12.4). */
+      appUsage: z.array(z.object({ package: z.string(), deviceId: z.uuid(), seconds: z.int() })),
     }),
     parentMode: z.object({
@@ -74,5 +76,5 @@ export const DeviceState = z
     apps: z.object({
       newAppApproval: z.boolean(),
-      rules: z.array(z.object({ package: z.string(), mode: AppRuleMode })),
+      rules: z.array(z.object({ package: z.string(), mode: AppRuleMode, dailyMinutes: z.int().nullable() })),
     }),
   })
```

#### `server/src/db/schema.ts`

```diff
@@ -462,4 +462,5 @@ export const appRules = pgTable(
     package: text('package').notNull(),
     mode: text('mode').notNull(),
+    dailyMinutes: integer('daily_minutes'),
     updatedAt: ts('updated_at').notNull().defaultNow(),
     updatedBy: uuid('updated_by').references(() => parents.id),
@@ -467,5 +468,23 @@ export const appRules = pgTable(
   (t) => [
     primaryKey({ columns: [t.kidId, t.package] }),
-    check('app_rules_mode', sql`${t.mode} in ('allowed', 'held', 'blocked')`),
+    check('app_rules_mode', sql`${t.mode} in ('allowed', 'held', 'blocked', 'limit')`),
   ],
 );
+
+/** One device's seconds in one app on one local day (docs/SPEC.md §12.4). */
+export const appUsageDaily = pgTable(
+  'app_usage_daily',
+  {
+    familyId: familyId(),
+    kidId: uuid('kid_id')
+      .notNull()
+      .references(() => kids.id),
+    deviceId: uuid('device_id')
+      .notNull()
+      .references(() => devices.id),
+    package: text('package').notNull(),
+    day: date('day').notNull(),
+    seconds: integer('seconds').notNull(),
+  },
+  (t) => [primaryKey({ columns: [t.deviceId, t.package, t.day] }), index('app_usage_daily_kid_day_idx').on(t.kidId, t.day)],
+);
```

#### `server/src/apps/routes.ts`

```diff
@@ -1,9 +1,9 @@
 import { createRoute, z } from '@hono/zod-openapi';
-import { and, asc, eq, isNull } from 'drizzle-orm';
-import { type AppRuleMode, AppRulePut, AppRuleSaved, DeviceAppsPut, KidApps, KidAppSettings, type KidApp } from '@screentime/schemas';
+import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
+import { type AppRuleMode, AppRulePut, AppRuleSaved, DeviceAppsPut, DeviceAppUsageUpload, KidApps, KidAppSettings, type KidApp } from '@screentime/schemas';
 import type { AppDeps } from '../app.js';
 import { requireFamilyParent } from '../auth/guards.js';
 import { withFamily } from '../db/family.js';
-import { appRules, deviceApps, devices, events, kids, parents } from '../db/schema.js';
+import { appRules, appUsageDaily, deviceApps, devices, events, families, kids, parents } from '../db/schema.js';
 import { requireDevice } from '../devices/auth.js';
 import { ApiError } from '../errors.js';
@@ -12,4 +12,5 @@ import { notifyParents, stateChanged } from '../notify/dispatch.js';
 import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
 import type { createRouter } from '../router.js';
+import { familyDay } from '../sync/day.js';
 
 type Router = ReturnType<typeof createRouter>;
@@ -37,9 +38,20 @@ const getKidAppsRoute = createRoute({
 });
 
+const postUsageRoute = createRoute({
+  method: 'post',
+  path: '/v1/device/app-usage',
+  tags: ['device'],
+  summary: "Send the device's seconds per app per day",
+  description: 'A repeat or an older upload never lowers a value. Android only.',
+  security: deviceBearer,
+  request: { body: jsonBody(DeviceAppUsageUpload) },
+  responses: { 204: { description: 'Stored.' }, ...errorResponses(401, 409, 422) },
+});
+
 const putRuleRoute = createRoute({
   method: 'put',
   path: '/v1/kids/{kidId}/apps/{package}/rule',
   tags: ['kids'],
-  summary: 'Allow or block an app for a kid',
+  summary: 'Allow, block or limit an app for a kid',
   description:
     'Answering a waiting app also writes `app.answered`. An app on none of the kid\'s devices gets 404, and one that cannot be blocked gets 409.',
@@ -153,8 +165,39 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
   });
 
+  app.openapi(postUsageRoute, async (c) => {
+    const { deviceId, kidId, familyId } = await requireDevice(c, db);
+    const { days } = c.req.valid('json');
+    const limitedSent = await withFamily(db, familyId, async (tx) => {
+      const [device] = await tx.select({ platform: devices.platform }).from(devices).where(eq(devices.id, deviceId));
+      if (device?.platform !== 'android') throw new ApiError('conflict', 'Apps are only on Android devices.');
+      const sent = new Set<string>();
+      for (const { day, apps } of days) {
+        for (const a of apps) {
+          sent.add(a.package);
+          await tx
+            .insert(appUsageDaily)
+            .values({ familyId, kidId, deviceId, package: a.package, day, seconds: a.seconds })
+            .onConflictDoUpdate({
+              target: [appUsageDaily.deviceId, appUsageDaily.package, appUsageDaily.day],
+              set: { seconds: sql`greatest(${appUsageDaily.seconds}, excluded.seconds)` },
+            });
+        }
+      }
+      if (sent.size === 0) return false;
+      const limited = await tx
+        .select({ package: appRules.package })
+        .from(appRules)
+        .where(and(eq(appRules.kidId, kidId), eq(appRules.mode, 'limit'), inArray(appRules.package, [...sent])));
+      return limited.length > 0;
+    });
+    // The other devices count this at their next sync; a live channel that is open hears now. No push: it would be often.
+    if (limitedSent) await stateChanged(deps, familyId, { kidId }, false);
+    return c.body(null, 204);
+  });
+
   app.openapi(putRuleRoute, async (c) => {
     const { familyId, parentId } = await requireFamilyParent(c, db, config.jwtSecret);
     const { kidId, package: pkg } = c.req.valid('param');
-    const { mode } = c.req.valid('json');
+    const { mode, dailyMinutes } = c.req.valid('json');
     const eventIds = await withFamily(db, familyId, async (tx) => {
       if (!(await findKid(tx, kidId))) throw new ApiError('not_found', 'No such kid in your family.');
@@ -167,5 +210,5 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
       if (rows.some((r) => !r.blockable)) throw new ApiError('conflict', 'That app cannot be blocked.');
       const [before] = await tx.select({ mode: appRules.mode }).from(appRules).where(and(eq(appRules.kidId, kidId), eq(appRules.package, pkg)));
-      const values = { mode, updatedAt: new Date(), updatedBy: parentId };
+      const values = { mode, dailyMinutes, updatedAt: new Date(), updatedBy: parentId };
       await tx
         .insert(appRules)
@@ -181,5 +224,5 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
           kind: 'app.answered',
           at: new Date(),
-          payload: { package: pkg, label: rows[0]?.label, approved: mode === 'allowed', byName: parent?.name ?? null },
+          payload: { package: pkg, label: rows[0]?.label, approved: mode !== 'blocked', byName: parent?.name ?? null },
         })
         .returning({ id: events.id });
@@ -188,5 +231,5 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
     await notifyParents(deps, familyId, eventIds);
     await stateChanged(deps, familyId, { kidId });
-    return c.json({ mode }, 200);
+    return c.json({ mode, dailyMinutes }, 200);
   });
 
@@ -206,5 +249,5 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
     const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
     const { kidId } = c.req.valid('param');
-    const { kid, rows, rules } = await withFamily(db, familyId, async (tx) => {
+    const { kid, rows, rules, usage } = await withFamily(db, familyId, async (tx) => {
       const kid = await findKid(tx, kidId);
       if (!kid) throw new ApiError('not_found', 'No such kid.');
@@ -216,7 +259,15 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
         .orderBy(asc(deviceApps.label), asc(devices.name));
       const rules = await tx.select().from(appRules).where(eq(appRules.kidId, kidId));
-      return { kid, rows, rules };
+      const [family] = await tx.select({ timezone: families.timezone }).from(families);
+      const day = await familyDay(tx, family?.timezone ?? 'UTC');
+      const usage = await tx
+        .select({ package: appUsageDaily.package, seconds: sql<number>`sum(${appUsageDaily.seconds})::int` })
+        .from(appUsageDaily)
+        .where(and(eq(appUsageDaily.kidId, kidId), eq(appUsageDaily.day, day.date)))
+        .groupBy(appUsageDaily.package);
+      return { kid, rows, rules, usage };
     });
-    const ruleOf = new Map(rules.map((r) => [r.package, r.mode as AppRuleMode]));
+    const ruleOf = new Map(rules.map((r) => [r.package, { mode: r.mode as AppRuleMode, dailyMinutes: r.dailyMinutes }]));
+    const secondsOf = new Map(usage.map((u) => [u.package, u.seconds]));
     const apps = new Map<string, KidApp>();
     for (const { app: row, deviceName } of rows) {
@@ -226,6 +277,6 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
         source: row.source as KidApp['source'],
         blockable: true,
-        todaySeconds: 0,
-        rule: ruleOf.has(row.package) ? { mode: ruleOf.get(row.package) as AppRuleMode } : null,
+        todaySeconds: secondsOf.get(row.package) ?? 0,
+        rule: ruleOf.get(row.package) ?? null,
         devices: [],
       };
```

#### `server/src/sync/routes.ts`

```diff
@@ -1,5 +1,5 @@
 import { createHash } from 'node:crypto';
 import { createRoute } from '@hono/zod-openapi';
-import { and, asc, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
+import { and, asc, desc, eq, gt, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
 import {
   type AvatarColor,
@@ -18,4 +18,5 @@ import { withFamily } from '../db/family.js';
 import {
   appRules,
+  appUsageDaily,
   devices,
   families,
@@ -179,5 +180,5 @@ export function registerSyncRoutes(app: Router, deps: AppDeps) {
         device.platform === 'android'
           ? await tx
-              .select({ package: appRules.package, mode: appRules.mode })
+              .select({ package: appRules.package, mode: appRules.mode, dailyMinutes: appRules.dailyMinutes })
               .from(appRules)
               .where(eq(appRules.kidId, kidId))
@@ -185,4 +186,21 @@ export function registerSyncRoutes(app: Router, deps: AppDeps) {
           : [];
 
+      const limited = rules.filter((r) => r.mode === 'limit').map((r) => r.package);
+      const appUsage =
+        limited.length > 0
+          ? await tx
+              .select({ package: appUsageDaily.package, deviceId: appUsageDaily.deviceId, seconds: appUsageDaily.seconds })
+              .from(appUsageDaily)
+              .where(
+                and(
+                  eq(appUsageDaily.kidId, kidId),
+                  eq(appUsageDaily.day, day.date),
+                  inArray(appUsageDaily.package, limited),
+                  ne(appUsageDaily.deviceId, deviceId),
+                ),
+              )
+              .orderBy(asc(appUsageDaily.package), asc(appUsageDaily.deviceId))
+          : [];
+
       return {
         serverTime: day.now.toISOString(),
@@ -204,4 +222,5 @@ export function registerSyncRoutes(app: Router, deps: AppDeps) {
               endedAt: s.endedAt?.toISOString() ?? null,
             })),
+            appUsage,
           },
           parentMode: parentMode
@@ -212,5 +231,5 @@ export function registerSyncRoutes(app: Router, deps: AppDeps) {
           apps: {
             newAppApproval: device.platform === 'android' && kid.newAppApproval,
-            rules: rules.map((r) => ({ package: r.package, mode: r.mode as AppRuleMode })),
+            rules: rules.map((r) => ({ package: r.package, mode: r.mode as AppRuleMode, dailyMinutes: r.dailyMinutes })),
           },
         },
```

#### `server/scripts/dev-apps.ts`

```diff
@@ -4,5 +4,5 @@
 import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
 import { createDb } from '../src/db/client.js';
-import { appRules, deviceApps, events, kids } from '../src/db/schema.js';
+import { appRules, appUsageDaily, deviceApps, devices, events, kids } from '../src/db/schema.js';
 
 const databaseUrl = process.env.DATABASE_URL;
@@ -27,5 +27,12 @@ try {
   console.log(`approval: ${kid.newAppApproval}`);
   console.log(`rules: ${rules.length}`);
-  for (const r of rules) console.log(`rule ${r.package} ${r.mode}`);
+  for (const r of rules) console.log(`rule ${r.package} ${r.mode}${r.dailyMinutes === null ? '' : ` ${r.dailyMinutes}`}`);
+  const usage = await db
+    .select({ package: appUsageDaily.package, seconds: appUsageDaily.seconds, device: devices.name })
+    .from(appUsageDaily)
+    .innerJoin(devices, eq(devices.id, appUsageDaily.deviceId))
+    .where(eq(appUsageDaily.kidId, kid.id))
+    .orderBy(asc(appUsageDaily.package), asc(devices.name));
+  for (const u of usage) console.log(`usage ${u.package} ${u.device} ${u.seconds}`);
   const list = await db
     .select()
```

#### `server/scripts/dev-app-rule.ts`

```diff
@@ -3,5 +3,8 @@
 // Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
 //   pnpm --filter @screentime/server exec tsx scripts/dev-app-rule.ts Alex rule com.android.chrome blocked
+//   pnpm --filter @screentime/server exec tsx scripts/dev-app-rule.ts Alex rule com.android.chrome limit 30
 //   pnpm --filter @screentime/server exec tsx scripts/dev-app-rule.ts Alex approval on
+//   pnpm --filter @screentime/server exec tsx scripts/dev-app-rule.ts Alex tablet-usage com.android.chrome 260
+// "tablet-usage" reports today's seconds from a second Android device of the kid, which it adds the first time.
 // It prints the HTTP status. Never run this against the production database.
 import { randomUUID } from 'node:crypto';
@@ -9,11 +12,12 @@ import { and, asc, eq, isNull, sql } from 'drizzle-orm';
 import { signAccessToken } from '../src/auth/tokens.js';
 import { createDb } from '../src/db/client.js';
-import { kids, parents } from '../src/db/schema.js';
+import { appUsageDaily, devices, kids, parents } from '../src/db/schema.js';
+import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
 
 const databaseUrl = process.env.DATABASE_URL;
 const jwtSecret = process.env.JWT_SECRET;
-const [kidName, what, first, second] = process.argv.slice(2);
-if (!databaseUrl || !jwtSecret || !kidName || !first || (what !== 'rule' && what !== 'approval')) {
-  console.error('Usage: tsx scripts/dev-app-rule.ts <kid name> rule <package> <allowed|blocked> | approval <on|off>');
+const [kidName, what, first, second, third] = process.argv.slice(2);
+if (!databaseUrl || !jwtSecret || !kidName || !first || (what !== 'rule' && what !== 'approval' && what !== 'tablet-usage')) {
+  console.error('Usage: tsx scripts/dev-app-rule.ts <kid name> rule <package> <allowed|blocked|limit> [minutes] | approval <on|off> | tablet-usage <package> <seconds>');
   process.exit(1);
 }
@@ -30,7 +34,24 @@ try {
     .limit(1);
   if (!parent) throw new Error(`the family of ${kid.name} has no parent`);
+  if (what === 'tablet-usage') {
+    const deviceToken = newDeviceToken();
+    await db.delete(appUsageDaily).where(and(eq(appUsageDaily.kidId, kid.id), eq(appUsageDaily.package, first)));
+    const [tablet] = await db
+      .insert(devices)
+      .values({ familyId: kid.familyId, kidId: kid.id, platform: 'android', form: 'tablet', pool: 'screens', name: 'Test tablet', tokenHash: hashDeviceToken(deviceToken) })
+      .returning();
+    if (!tablet) throw new Error('no tablet');
+    const [{ day } = { day: '' }] = (await db.execute<{ day: string }>(sql`select to_char(now() at time zone (select timezone from families where id = ${kid.familyId}), 'YYYY-MM-DD') as day`)).rows;
+    const response = await fetch('http://localhost:8080/v1/device/app-usage', {
+      method: 'POST',
+      headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
+      body: JSON.stringify({ days: [{ day, apps: [{ package: first, seconds: Number(second) }] }] }),
+    });
+    console.log(`tablet-usage ${first} ${second}: ${response.status}`);
+    process.exitCode = response.status === 204 ? 0 : 1;
+  } else {
   const token = await signAccessToken(jwtSecret, { sessionId: randomUUID(), parentId: parent.id, familyId: kid.familyId, roles: ['parent'] });
   const path = what === 'rule' ? `/v1/kids/${kid.id}/apps/${encodeURIComponent(first)}/rule` : `/v1/kids/${kid.id}/app-settings`;
-  const body = what === 'rule' ? { mode: second } : { newAppApproval: first === 'on' };
+  const body = what === 'rule' ? { mode: second, dailyMinutes: third ? Number(third) : null } : { newAppApproval: first === 'on' };
   const response = await fetch(`http://localhost:8080${path}`, {
     method: 'PUT',
@@ -38,5 +59,6 @@ try {
     body: JSON.stringify(body),
   });
-  console.log(`${what} ${first} ${second ?? ''}: ${response.status}`);
+  console.log(`${what} ${first} ${second ?? ''} ${third ?? ''}: ${response.status}`);
+  }
 } finally {
   await pool.end();
```

#### `server/test/app-rules.test.ts`

```diff
@@ -37,5 +37,6 @@ describe.skipIf(!url)('app rules', () => {
 
   const put = (apps: unknown[]) => api.put('/v1/device/apps', phone.token, { apps });
-  const rule = (pkg: string, mode: string, token = dad) => api.put(`/v1/kids/${kid}/apps/${encodeURIComponent(pkg)}/rule`, token, { mode });
+  const rule = (pkg: string, mode: string, token = dad, dailyMinutes: number | null = null) =>
+    api.put(`/v1/kids/${kid}/apps/${encodeURIComponent(pkg)}/rule`, token, { mode, dailyMinutes });
   const settings = (on: boolean, token = dad) => api.put(`/v1/kids/${kid}/app-settings`, token, { newAppApproval: on });
 
@@ -101,10 +102,10 @@ describe.skipIf(!url)('app rules', () => {
     const blocked = await rule('a.game', 'blocked');
     expect(blocked.status).toBe(200);
-    expect(blocked.body).toEqual({ mode: 'blocked' });
+    expect(blocked.body).toEqual({ mode: 'blocked', dailyMinutes: null });
     const list = await api.get(`/v1/kids/${kid}/apps`, dad);
     const rows = list.body.apps as { package: string; rule: { mode: string } | null }[];
-    expect(rows.find((a) => a.package === 'a.game')?.rule).toEqual({ mode: 'blocked' });
+    expect(rows.find((a) => a.package === 'a.game')?.rule).toEqual({ mode: 'blocked', dailyMinutes: null });
     expect(rows.find((a) => a.package === 'b.game')?.rule).toBeNull();
-    expect((await rule('a.game', 'allowed')).body).toEqual({ mode: 'allowed' });
+    expect((await rule('a.game', 'allowed')).body).toEqual({ mode: 'allowed', dailyMinutes: null });
   });
 
@@ -126,5 +127,5 @@ describe.skipIf(!url)('app rules', () => {
     await settings(true);
     const after = await api.get('/v1/device/state', phone.token);
-    expect(after.body.apps).toEqual({ newAppApproval: true, rules: [{ package: 'a.game', mode: 'blocked' }] });
+    expect(after.body.apps).toEqual({ newAppApproval: true, rules: [{ package: 'a.game', mode: 'blocked', dailyMinutes: null }] });
     expect(after.body.stateVersion).not.toBe(before.body.stateVersion);
   });
```

#### `server/test/csharp-client.test.ts`

```diff
@@ -17,5 +17,5 @@ describe('C# API client', () => {
 
   it('has one method for every device operation and none for the parent ones', () => {
-    expect(client.match(/^ {4}public Task/gm)).toHaveLength(15);
+    expect(client.match(/^ {4}public Task/gm)).toHaveLength(16);
     expect(client).toContain(
       '    public Task<EnrolResponse> PostEnrolAsync(EnrolRequest body, CancellationToken cancellationToken = default) =>\n' +
```

#### `server/test/db.test.ts`

```diff
@@ -34,4 +34,5 @@ describe.skipIf(!url)('database', () => {
     expect(result.rows.map((r) => r.table_name).sort()).toEqual([
       'app_rules',
+      'app_usage_daily',
       'device_apps',
       'devices',
```

#### `server/test/sync.test.ts`

```diff
@@ -159,5 +159,5 @@ describe.skipIf(!url)('sync routes', () => {
         messagePresets: [{ id: expect.any(String), text: 'Can I have more time?' }],
         schedule: { version: 1, warn1Min: 15, warn2Min: 5, days: flatWeek },
-        today: { date: localDate(), grants: [], poolSegments: [] },
+        today: { date: localDate(), grants: [], poolSegments: [], appUsage: [] },
         parentMode: { active: false, endsAt: null, byName: null },
         pendingRequest: null,
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/apps/Apps.kt`

```diff
@@ -60,10 +60,106 @@ fun wantedBlocks(
     protected: Set<String>,
     parentMode: Boolean,
+    limitsOver: Set<String> = emptySet(),
 ): Set<String> {
     if (parentMode) return emptySet()
     val ruled = rules.filterValues { it == AppRuleMode.BLOCKED || it == AppRuleMode.HELD }.keys
-    return (ruled + held) - protected - NEVER_BLOCKED
+    return (ruled + held + limitsOver) - protected - NEVER_BLOCKED
 }
 
+/** What changes which app is in use: an activity coming to the front or leaving it, and the screen going off. */
+enum class UsageKind { RESUMED, PAUSED, SCREEN_OFF }
+
+data class UsageEvent(val kind: UsageKind, val packageName: String, val atMs: Long)
+
+/** A stretch of time that does not count: parent mode. */
+data class Span(val fromMs: Long, val toMs: Long)
+
+/** Seconds per app in a stretch of time, and what was still in front at the end of it. */
+data class AppUsageNow(val seconds: Map<String, Long>, val inFront: Set<String>)
+
+private fun msOutside(fromMs: Long, toMs: Long, spans: List<Span>): Long {
+    if (toMs <= fromMs) return 0
+    val inside = spans.sumOf { s -> (minOf(toMs, s.toMs) - maxOf(fromMs, s.fromMs)).coerceAtLeast(0) }
+    return (toMs - fromMs - inside).coerceAtLeast(0)
+}
+
+/**
+ * Adds up each app's time between [fromMs] and [toMs] from Android's usage events, oldest first: resumed to paused,
+ * ending at screen off, leaving out [notCounted]. An app already in front at [fromMs] has no resume in the events,
+ * so a pause with no resume before it counts from [fromMs]. One still open counts up to [toMs].
+ */
+fun appUsage(events: List<UsageEvent>, fromMs: Long, toMs: Long, notCounted: List<Span> = emptyList()): AppUsageNow {
+    val open = mutableMapOf<String, Long>()
+    val seen = mutableSetOf<String>()
+    val ms = mutableMapOf<String, Long>()
+    fun close(name: String, atMs: Long, startMs: Long) {
+        ms[name] = (ms[name] ?: 0) + msOutside(startMs, atMs, notCounted)
+    }
+    for (e in events.filter { it.atMs in fromMs..toMs }) {
+        when (e.kind) {
+            UsageKind.RESUMED -> {
+                seen += e.packageName
+                open.putIfAbsent(e.packageName, e.atMs)
+            }
+            UsageKind.PAUSED -> {
+                val start = open.remove(e.packageName)
+                if (start != null) {
+                    close(e.packageName, e.atMs, start)
+                } else if (seen.add(e.packageName)) {
+                    close(e.packageName, e.atMs, fromMs)
+                }
+            }
+            UsageKind.SCREEN_OFF -> {
+                open.forEach { (name, start) -> close(name, e.atMs, start) }
+                open.clear()
+            }
+        }
+    }
+    open.forEach { (name, start) -> close(name, toMs, start) }
+    return AppUsageNow(ms.mapValues { it.value / 1000 }, open.keys.toSet())
+}
+
+/** One app with a daily limit now. */
+data class AppLimitNow(val packageName: String, val label: String, val leftSec: Long)
+
+/**
+ * The limits of the apps on this device, by name: [minutes] per package, less this device's [own] seconds and the
+ * [others] of the kid's other devices. Two devices using one app at the same time count twice (docs/SPEC.md §12.4).
+ */
+fun appLimits(minutes: Map<String, Int>, own: Map<String, Long>, others: Map<String, Long>, labels: Map<String, String>): List<AppLimitNow> =
+    minutes.mapNotNull { (name, limit) ->
+        labels[name]?.let { label -> AppLimitNow(name, label, limit * 60L - (own[name] ?: 0) - (others[name] ?: 0)) }
+    }.sortedBy { it.label.lowercase() }
+
+/** What to tell the kid, and what is now remembered as told. */
+data class LimitNews(val messages: List<String>, val warned: Set<String>, val done: Set<String>)
+
+private const val WARN_LEFT_SEC = 300L
+
+/**
+ * A warning at 5 minutes left and a last word at the limit, once each, and only for an app in front: an app the kid is
+ * not using is not news. More time from a parent lets them come again.
+ */
+fun limitNews(limits: List<AppLimitNow>, inFront: Set<String>, warned: Set<String>, done: Set<String>): LimitNews {
+    val messages = mutableListOf<String>()
+    val nowWarned = warned.toMutableSet()
+    val nowDone = done.toMutableSet()
+    for (l in limits) {
+        if (l.leftSec > WARN_LEFT_SEC) nowWarned -= l.packageName
+        if (l.leftSec > 0) nowDone -= l.packageName
+        if (l.packageName !in inFront) continue
+        if (l.leftSec <= 0) {
+            if (nowDone.add(l.packageName)) messages += "That's all your ${l.label} for today"
+        } else if (l.leftSec <= WARN_LEFT_SEC && nowWarned.add(l.packageName)) {
+            messages += "5 minutes of ${l.label} left"
+        }
+    }
+    return LimitNews(messages, nowWarned, nowDone)
+}
+
+/** How long until an app in front uses up its limit, or null when none is coming. */
+fun nextLimitMs(limits: List<AppLimitNow>, inFront: Set<String>): Long? =
+    limits.filter { it.packageName in inFront && it.leftSec > 0 }.minOfOrNull { it.leftSec * 1000 }
+
 fun blockPlan(wanted: Set<String>, applied: Set<String>): BlockPlan = BlockPlan(wanted - applied, applied - wanted)
 
@@ -107,2 +203,12 @@ fun appListBody(apps: List<InstalledApp>, firstUses: Map<String, Long>, protecte
     )
 }
+
+/** Spans as saved in SharedPreferences: "from-to,from-to". Anything unreadable is dropped. */
+fun formatSpans(spans: List<Span>): String = spans.joinToString(",") { "${it.fromMs}-${it.toMs}" }
+
+fun parseSpans(text: String): List<Span> = text.split(",").mapNotNull { part ->
+    val numbers = part.split("-")
+    val from = numbers.getOrNull(0)?.toLongOrNull()
+    val to = numbers.getOrNull(1)?.toLongOrNull()
+    if (from != null && to != null) Span(from, to) else null
+}
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/apps/AppWatcher.kt`

```diff
@@ -14,4 +14,12 @@ import android.util.Log
 import android.app.admin.DevicePolicyManager
 import au.screentime.core.model.api.ApiClient
+import au.screentime.core.model.api.AppRuleMode
+import au.screentime.core.model.api.DeviceAppUsageUpload
+import au.screentime.core.model.api.DeviceAppUsageUploadDaysItem
+import au.screentime.core.model.api.DeviceAppUsageUploadDaysItemAppsItem
+import au.screentime.kid.status.AppLimitView
+import au.screentime.kid.usage.dayStartMs
+import java.time.Instant
+import java.time.ZoneId
 import au.screentime.core.model.api.ApiException
 import au.screentime.core.model.api.ApiJson
@@ -26,4 +34,7 @@ import kotlinx.coroutines.CancellationException
  * is kept in SharedPreferences, so a restart neither forgets a first use nor sends an unchanged list again.
  */
+/** What the service needs after a look at the blocks: the main screen's list, what to tell the kid, and when to look again. */
+data class BlocksNow(val limits: List<AppLimitView>, val news: List<String>, val nextLimitMs: Long?)
+
 class AppWatcher(context: Context, private val api: ApiClient, private val now: () -> Long = System::currentTimeMillis) {
     private val context = context.applicationContext
@@ -38,8 +49,18 @@ class AppWatcher(context: Context, private val api: ApiClient, private val now:
      * Does nothing unless the app is Device Owner.
      */
-    fun applyBlocks(state: DeviceState, parentMode: Boolean) {
-        if (!Policies.isDeviceOwner(context)) return
+    fun applyBlocks(state: DeviceState, parentMode: Boolean): BlocksNow {
         val rules = state.apps.rules.associate { it.`package` to it.mode }
-        val installed = installed().map { it.packageName }.toSet()
+        val apps = installed()
+        val installed = apps.map { it.packageName }.toSet()
+        val limits = limitsNow(state, parentMode, apps.associate { it.packageName to appLabel(it.label, it.packageName) })
+        val access = hasUsageAccess()
+        // Without usage access the time cannot be counted, so limited apps stay blocked until it is back (§12.4).
+        val over = limits.limits.filter { it.leftSec <= 0 || !access }.map { it.packageName }.toSet()
+        val result = BlocksNow(
+            limits = limits.limits.map { AppLimitView(it.label, if (access) it.leftSec else 0) },
+            news = if (parentMode) emptyList() else takeNews(limits),
+            nextLimitMs = if (parentMode || !access) null else nextLimitMs(limits.limits, limits.usage.inFront),
+        )
+        if (!Policies.isDeviceOwner(context)) return result
         val knownBefore = prefs.getStringSet(KNOWN, null)
         val held = heldPackages(state.apps.newAppApproval, knownBefore, installed, rules.keys, prefs.getStringSet(HELD, null).orEmpty())
@@ -50,8 +71,8 @@ class AppWatcher(context: Context, private val api: ApiClient, private val now:
         val suspended = prefs.getStringSet(SUSPENDED, null).orEmpty().filter { isSuspended(dpm, it) }.toSet()
         val hidden = prefs.getStringSet(HIDDEN, null).orEmpty().filter { dpm.isApplicationHidden(admin, it) }.toSet()
-        val wanted = wantedBlocks(rules, held, protectedPackages(), parentMode).intersect(installed)
+        val wanted = wantedBlocks(rules, held, protectedPackages(), parentMode, over).intersect(installed)
         val plan = blockPlan(wanted, suspended + hidden)
         prefs.edit().putStringSet(KNOWN, installed).putStringSet(HELD, held).commit()
-        if (plan.block.isEmpty() && plan.release.isEmpty()) return
+        if (plan.block.isEmpty() && plan.release.isEmpty()) return result
 
         val nowSuspended = suspended.toMutableSet()
@@ -75,4 +96,101 @@ class AppWatcher(context: Context, private val api: ApiClient, private val now:
         prefs.edit().putStringSet(SUSPENDED, nowSuspended).putStringSet(HIDDEN, nowHidden).commit()
         Log.i(TAG, "apps: blocked ${(nowSuspended + nowHidden).sorted()} (hidden ${nowHidden.sorted()})")
+        return result
+    }
+
+    private class LimitsNow(val limits: List<AppLimitNow>, val usage: AppUsageNow)
+
+    /** The limits now. It also keeps track of parent mode, whose time does not count. */
+    private fun limitsNow(state: DeviceState, parentMode: Boolean, labels: Map<String, String>): LimitsNow {
+        val now = this.now()
+        val dayStart = dayStartMs(state, now)
+        val usage = usageBetween(dayStart, now, notCounted(parentMode, dayStart, now))
+        val minutes = state.apps.rules
+            .filter { it.mode == AppRuleMode.LIMIT && it.dailyMinutes != null }
+            .associate { it.`package` to it.dailyMinutes!! }
+        val others = state.today.appUsage.groupBy { it.`package` }.mapValues { (_, rows) -> rows.sumOf { it.seconds.toLong() } }
+        return LimitsNow(appLimits(minutes, usage.seconds, others, labels), usage)
+    }
+
+    /** What to tell the kid now, once per app per day. */
+    private fun takeNews(limits: LimitsNow): List<String> {
+        val news = limitNews(limits.limits, limits.usage.inFront, prefs.getStringSet(WARNED, null).orEmpty(), prefs.getStringSet(DONE, null).orEmpty())
+        if (news.messages.isNotEmpty() || news.warned != prefs.getStringSet(WARNED, null).orEmpty() || news.done != prefs.getStringSet(DONE, null).orEmpty()) {
+            prefs.edit().putStringSet(WARNED, news.warned).putStringSet(DONE, news.done).commit()
+        }
+        return news.messages
+    }
+
+    /** Parent mode's spans today, with this one up to now. Older ones are forgotten; a new day starts clean. */
+    private fun notCounted(parentMode: Boolean, dayStart: Long, now: Long): List<Span> {
+        val spans = parseSpans(prefs.getString(SPANS, null).orEmpty()).filter { it.toMs > dayStart }.toMutableList()
+        val started = prefs.getLong(PARENT_FROM, -1).takeIf { it >= 0 }
+        val edit = prefs.edit()
+        if (parentMode && started == null) edit.putLong(PARENT_FROM, now)
+        if (!parentMode && started != null) {
+            spans += Span(started, now)
+            edit.remove(PARENT_FROM)
+        }
+        edit.putString(SPANS, formatSpans(spans)).commit()
+        return if (parentMode) spans + Span(started ?: now, now) else spans
+    }
+
+    private fun usageBetween(from: Long, to: Long, notCounted: List<Span>): AppUsageNow {
+        if (!hasUsageAccess()) return AppUsageNow(emptyMap(), emptySet())
+        val events = context.getSystemService(UsageStatsManager::class.java).queryEvents(from, to)
+        val event = UsageEvents.Event()
+        val out = mutableListOf<UsageEvent>()
+        while (events.hasNextEvent()) {
+            events.getNextEvent(event)
+            when (event.eventType) {
+                UsageEvents.Event.ACTIVITY_RESUMED -> out += UsageEvent(UsageKind.RESUMED, event.packageName, event.timeStamp)
+                UsageEvents.Event.ACTIVITY_PAUSED -> out += UsageEvent(UsageKind.PAUSED, event.packageName, event.timeStamp)
+                UsageEvents.Event.SCREEN_NON_INTERACTIVE -> out += UsageEvent(UsageKind.SCREEN_OFF, event.packageName, event.timeStamp)
+            }
+        }
+        return appUsage(out, from, to, notCounted)
+    }
+
+    /** Sends today's and yesterday's seconds per app when they changed, so a parent sees them and other devices count them. */
+    suspend fun sendUsage(state: DeviceState) {
+        if (!hasUsageAccess()) return
+        val now = this.now()
+        val zone = ZoneId.of(state.family.timezone)
+        val today = dayStartMs(state, now)
+        val yesterday = Instant.ofEpochMilli(today).atZone(zone).minusDays(1).toInstant().toEpochMilli()
+        // Parent mode may just have ended without the service having looked yet: an upload can never be taken back.
+        val open = prefs.getLong(PARENT_FROM, -1).takeIf { it >= 0 }?.let { Span(it, now) }
+        val spans = parseSpans(prefs.getString(SPANS, null).orEmpty()) + listOfNotNull(open)
+        fun day(from: Long, to: Long): DeviceAppUsageUploadDaysItem {
+            val seconds = usageBetween(from, to, spans).seconds
+                .filter { it.value > 0 && it.key != context.packageName }
+                .toSortedMap()
+            return DeviceAppUsageUploadDaysItem(
+                Instant.ofEpochMilli(from).atZone(zone).toLocalDate().toString(),
+                seconds.entries.take(500).map { DeviceAppUsageUploadDaysItemAppsItem(it.key, it.value.toInt().coerceAtMost(86400)) },
+            )
+        }
+        val body = DeviceAppUsageUpload(listOf(day(yesterday, today), day(today, now)).filter { it.apps.isNotEmpty() })
+        if (body.days.isEmpty()) return
+        val text = ApiJson.encodeToString(DeviceAppUsageUpload.serializer(), body)
+        if (text == prefs.getString(USAGE_SENT, null)) return
+        try {
+            api.postDeviceAppUsage(body)
+            prefs.edit().putString(USAGE_SENT, text).commit()
+        } catch (e: CancellationException) {
+            throw e
+        } catch (e: ApiException) {
+            Log.w(TAG, "apps: usage refused (${e.status})")
+        } catch (e: Exception) {
+            Log.i(TAG, "apps: usage not sent")
+        }
+    }
+
+    /** True once when usage access was on and is now off: a tamper attempt (docs/SPEC.md §12.4, §14). */
+    fun usageAccessLost(): Boolean {
+        val has = hasUsageAccess()
+        val had = prefs.getBoolean(HAD_ACCESS, false)
+        if (has != had) prefs.edit().putBoolean(HAD_ACCESS, has).commit()
+        return had && !has
     }
 
@@ -201,4 +319,10 @@ class AppWatcher(context: Context, private val api: ApiClient, private val now:
         const val SUSPENDED = "suspended"
         const val HIDDEN = "hidden"
+        const val WARNED = "warned"
+        const val DONE = "done"
+        const val SPANS = "spans"
+        const val PARENT_FROM = "parentFrom"
+        const val USAGE_SENT = "usageSent"
+        const val HAD_ACCESS = "hadAccess"
 
         /** The first read looks this far back, so apps already in use raise no alert. */
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

```diff
@@ -473,4 +473,5 @@ class KidService : Service() {
             sendTamper()
             apps?.send()
+            states.load()?.let { apps?.sendUsage(it.state) }
             val ok = syncer.sync()
             lastSyncElapsed = SystemClock.elapsedRealtime()
@@ -519,5 +520,13 @@ class KidService : Service() {
         if (sosOn != sos.active) Log.i(TAG, "sos: ${if (sos.active) "on" else "off"}")
         sosOn = sos.active
-        apps?.applyBlocks(cached.state, paused)
+        if (apps?.usageAccessLost() == true) onTamper(DeviceEventKind.TAMPER_POLICY, mapOf("missing" to "usage_access"))
+        val appsNow = apps?.applyBlocks(cached.state, paused)
+        if (appsNow != null) {
+            StatusHub.appLimits.value = appsNow.limits
+            appsNow.news.forEach {
+                Log.i(TAG, "apps: told the kid: $it")
+                notifier.showAppLimit(it)
+            }
+        }
         val counting = !blocked && !paused && !sosOn
         if (wasCounting && !counting) recorder.stop(now)
@@ -537,4 +546,6 @@ class KidService : Service() {
         }
         nextCheckAt = nextCheckAtMs(status, now)
+        // An app in front that is about to use up its limit: look again when it should run out.
+        appsNow?.nextLimitMs?.let { nextCheckAt = minOf(nextCheckAt, now + it) }
         wake.trySend(Unit)
         Log.i(
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/service/Notifier.kt`

```diff
@@ -120,4 +120,16 @@ class Notifier(private val context: Context) {
     }
 
+    /** "5 minutes of YouTube left" or "That's all your YouTube for today" (docs/SPEC.md §12.4). */
+    fun showAppLimit(text: String) {
+        val notification = Notification.Builder(context, WARNING_CHANNEL)
+            .setSmallIcon(R.drawable.ic_status)
+            .setContentTitle(text)
+            .setCategory(Notification.CATEGORY_REMINDER)
+            .setContentIntent(openApp)
+            .setAutoCancel(true)
+            .build()
+        manager.notify(APP_LIMIT_ID, notification)
+    }
+
     /** "Dad said yes! +15 min 🎉" or "Dad said not this time", heads-up; it goes away by itself after a minute. */
     fun showAnswer(answer: Answer) {
@@ -159,4 +171,5 @@ class Notifier(private val context: Context) {
         private const val ANSWER_ID = 3
         private const val GRANT_ID = 4
+        private const val APP_LIMIT_ID = 5
         private const val STATUS_CHANNEL = "status"
         private const val WARNING_CHANNEL = "warnings"
```

#### `android/app-kid/src/test/kotlin/au/screentime/kid/usage/StateFixture.kt`

```diff
@@ -30,5 +30,5 @@ fun stateJson(
           "messagePresets": [],
           "schedule": {"version": 1, "warn1Min": 15, "warn2Min": 5, "days": [$days]},
-          "today": {"date": "$date", "grants": [$grants], "poolSegments": [$segments]},
+          "today": {"date": "$date", "grants": [$grants], "poolSegments": [$segments], "appUsage": []},
           "parentMode": {"active": false, "endsAt": null, "byName": null},
           "pendingRequest": null,
```

#### `windows/tests/ScreenTime.Core.Tests/ApiClientTests.cs`

```diff
@@ -125,5 +125,5 @@ public class ApiClientTests
              "parents":[{"id":"p-1","displayName":"Dad","phoneE164":null}],"contacts":[],"messagePresets":[],
              "schedule":{"version":3,"warn1Min":15,"warn2Min":5,"days":[{"weekday":4,"screensMin":120,"phoneMin":60,"wake":"07:00","bedtime":"21:00"}]},
-             "today":{"date":"2026-10-29","grants":[],"poolSegments":[{"id":"s-1","deviceId":"d-1","startedAt":"2026-10-29T07:00:00.000Z","endedAt":null}]},
+             "today":{"date":"2026-10-29","grants":[],"poolSegments":[{"id":"s-1","deviceId":"d-1","startedAt":"2026-10-29T07:00:00.000Z","endedAt":null}],"appUsage":[]},
              "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"apps":{"newAppApproval":false,"rules":[]},"activeSos":null}
             """;
```

#### `windows/tests/ScreenTime.Core.Tests/LocalStoreTests.cs`

```diff
@@ -73,5 +73,5 @@ public sealed class LocalStoreTests : IDisposable
             MessagePresets: [],
             Schedule: new Schedule(3, 15, 5, [new ScheduleDay(4, 120, 60, "07:00", "21:00")]),
-            Today: new DeviceStateToday("2026-10-29", [], []),
+            Today: new DeviceStateToday("2026-10-29", [], [], []),
             ParentMode: new DeviceStateParentMode(false, null, null),
             PendingRequest: null,
```

#### `windows/tests/ScreenTime.Core.Tests/SyncTestData.cs`

```diff
@@ -26,5 +26,5 @@ internal static class SyncTestData
              "parents":[],"contacts":[],"messagePresets":[],
              "schedule":{"version":1,"warn1Min":15,"warn2Min":5,"days":[{{days}}]},
-             "today":{"date":"{{date}}","grants":[{{grants}}],"poolSegments":[{{segments}}]},
+             "today":{"date":"{{date}}","grants":[{{grants}}],"poolSegments":[{{segments}}],"appUsage":[]},
              "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"apps":{"newAppApproval":false,"rules":[]},"activeSos":null}
             """;
```

The seams of the front end. These are the only changes you make to Claude's files:

#### `android/app-parent/src/main/kotlin/au/screentime/parent/kids/Apps.kt`

```diff
@@ -59,8 +59,4 @@ fun stepLimit(minutes: Int, up: Boolean): Int =
     (minutes + if (up) LIMIT_STEP_MINUTES else -LIMIT_STEP_MINUTES).coerceIn(LIMIT_STEP_MINUTES, MAX_LIMIT_MINUTES)
 
-/** The seam: CARD-058 replaces this with the server, in `KidsViewModel`. */
-internal object FakeLimits {
-    val minutes = mutableMapOf<String, Int>()
-}
 
 /** Gone from every device. */
@@ -145,9 +141,14 @@ fun appRow(app: au.screentime.core.model.api.KidApp): KidApp = KidApp(
         AppRuleMode.HELD -> AppRule.HELD
         AppRuleMode.BLOCKED -> AppRule.BLOCKED
+        AppRuleMode.LIMIT -> AppRule.LIMIT
         null -> null
     },
+    dailyMinutes = app.rule?.dailyMinutes,
 )
 
 /** The server's mode for a rule. A parent cannot hold an app, so HELD is never sent. */
-fun rulePut(rule: AppRule): AppRulePut =
-    AppRulePut(if (rule == AppRule.BLOCKED) AppRulePutMode.BLOCKED else AppRulePutMode.ALLOWED)
+fun rulePut(rule: AppRule, minutes: Int? = null): AppRulePut = when (rule) {
+    AppRule.BLOCKED -> AppRulePut(AppRulePutMode.BLOCKED, null)
+    AppRule.LIMIT -> AppRulePut(AppRulePutMode.LIMIT, minutes ?: DEFAULT_LIMIT_MINUTES)
+    AppRule.ALLOWED, AppRule.HELD -> AppRulePut(AppRulePutMode.ALLOWED, null)
+}
```

#### `android/app-parent/src/main/kotlin/au/screentime/parent/kids/AppsScreen.kt`

```diff
@@ -49,5 +49,4 @@ import androidx.compose.ui.unit.dp
 import au.screentime.core.model.api.Kid
 import au.screentime.core.ui.ScreenTimeTheme
-import au.screentime.parent.BuildConfig
 import au.screentime.parent.R
 import au.screentime.parent.today.Problem
@@ -210,7 +209,4 @@ private fun ApprovalCard(kid: Kid, on: Boolean, enabled: Boolean, onChange: (Boo
 }
 
-/** The seam: CARD-058 makes this true. Until then a limit only shows in debug builds. */
-private val APP_LIMITS_READY = BuildConfig.DEBUG
-
 /** What a parent can do about one app: nothing, answer a waiting app, or choose Allowed, Blocked or Limit. */
 @Composable
@@ -236,5 +232,5 @@ private fun RuleControl(app: KidApp, enabled: Boolean, onRule: (AppRule, Int?) -
         }
         else -> Column {
-            val count = if (APP_LIMITS_READY) 3 else 2
+            val count = 3
             val minutes = app.dailyMinutes ?: DEFAULT_LIMIT_MINUTES
             SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
@@ -253,13 +249,11 @@ private fun RuleControl(app: KidApp, enabled: Boolean, onRule: (AppRule, Int?) -
                     label = { Text("Blocked") },
                 )
-                if (APP_LIMITS_READY) {
-                    SegmentedButton(
-                        selected = choice == AppChoice.LIMIT,
-                        onClick = { if (choice != AppChoice.LIMIT) onRule(AppRule.LIMIT, minutes) },
-                        shape = SegmentedButtonDefaults.itemShape(index = 2, count = count),
-                        enabled = enabled,
-                        label = { Text("Limit") },
-                    )
-                }
+                SegmentedButton(
+                    selected = choice == AppChoice.LIMIT,
+                    onClick = { if (choice != AppChoice.LIMIT) onRule(AppRule.LIMIT, minutes) },
+                    shape = SegmentedButtonDefaults.itemShape(index = 2, count = count),
+                    enabled = enabled,
+                    label = { Text("Limit") },
+                )
             }
             if (choice == AppChoice.LIMIT) {
```

#### `android/app-parent/src/main/kotlin/au/screentime/parent/kids/KidsViewModel.kt`

```diff
@@ -125,8 +125,5 @@ class KidsViewModel(app: Application) : AndroidViewModel(app) {
             try {
                 val apps = session.call { getKidsApps(kidId) }
-                val rows = apps.apps.map(::appRow).map { row ->
-                    FakeLimits.minutes[row.packageName]?.let { row.copy(rule = AppRule.LIMIT, dailyMinutes = it) } ?: row
-                }
-                Result.success(KidAppsView(apps.newAppApproval, rows))
+                Result.success(KidAppsView(apps.newAppApproval, apps.apps.map(::appRow)))
             } catch (e: CancellationException) {
                 throw e
@@ -140,13 +137,7 @@ class KidsViewModel(app: Application) : AndroidViewModel(app) {
     /** Allow or block an app; a failure is a [Result.failure] with the exception. */
     suspend fun saveAppRule(kidId: String, packageName: String, rule: AppRule, minutes: Int? = null): Result<Unit> {
-        // The seam: CARD-058 replaces this with the server.
-        if (rule == AppRule.LIMIT) {
-            FakeLimits.minutes[packageName] = minutes ?: DEFAULT_LIMIT_MINUTES
-            return Result.success(Unit)
-        }
-        FakeLimits.minutes.remove(packageName)
         val deferred = viewModelScope.async {
             try {
-                session.call { putKidsAppsRule(kidId, packageName, rulePut(rule)) }
+                session.call { putKidsAppsRule(kidId, packageName, rulePut(rule, minutes)) }
                 Result.success(Unit)
             } catch (e: CancellationException) {
```

#### `web/src/components/apps-panel.tsx`

```diff
@@ -6,5 +6,4 @@ import { Switch } from '@/components/ui/switch';
 import { ApiError } from '@/lib/api';
 import {
-  APP_LIMITS_READY,
   type AppChoice,
   appChoice,
@@ -33,5 +32,5 @@ const MODES: { value: Mode; label: string }[] = [
   { value: 'allowed', label: 'Allowed' },
   { value: 'blocked', label: 'Blocked' },
-  ...(APP_LIMITS_READY ? [{ value: 'limit' as const, label: 'Limit' }] : []),
+  { value: 'limit', label: 'Limit' },
 ];
```

#### `web/src/lib/apps.ts`

```diff
@@ -1,35 +1,11 @@
-import type { KidApp as ServerApp, KidAppDevice, KidApps as ServerApps } from '@screentime/schemas';
+import type { KidApp, KidAppDevice, KidApps } from '@screentime/schemas';
 import { api } from '@/lib/auth';
 import { formatDuration } from '@/lib/format';
 
-export type { KidAppDevice };
-
-export interface KidAppRule {
-  mode: 'allowed' | 'held' | 'blocked' | 'limit';
-  dailyMinutes: number | null;
-}
-
-export type KidApp = Omit<ServerApp, 'rule'> & { rule: KidAppRule | null };
-
-export interface KidApps {
-  newAppApproval: boolean;
-  apps: KidApp[];
-}
-
-/** The seam: CARD-058 replaces this, `fakeLimits` and the two functions below with the server. */
-export const APP_LIMITS_READY = import.meta.env.DEV;
-const fakeLimits = new Map<string, number>();
+export type { KidApp, KidAppDevice, KidApps };
 
 /** GET /v1/kids/{kidId}/apps (docs/SPEC.md §12.4). */
-export async function fetchKidApps(kidId: string): Promise<KidApps> {
-  const server = await api.get<ServerApps>(`/v1/kids/${kidId}/apps`);
-  return {
-    newAppApproval: server.newAppApproval,
-    apps: server.apps.map((a) => {
-      const minutes = fakeLimits.get(a.package);
-      if (minutes !== undefined) return { ...a, rule: { mode: 'limit' as const, dailyMinutes: minutes } };
-      return { ...a, rule: a.rule ? { mode: a.rule.mode, dailyMinutes: null } : null };
-    }),
-  };
+export function fetchKidApps(kidId: string): Promise<KidApps> {
+  return api.get<KidApps>(`/v1/kids/${kidId}/apps`);
 }
 
@@ -40,10 +16,5 @@ export async function saveAppRule(
   dailyMinutes: number | null = null,
 ): Promise<void> {
-  if (mode === 'limit') {
-    fakeLimits.set(pkg, dailyMinutes ?? DEFAULT_LIMIT_MINUTES);
-    return;
-  }
-  fakeLimits.delete(pkg);
-  await api.put(`/v1/kids/${kidId}/apps/${encodeURIComponent(pkg)}/rule`, { mode });
+  await api.put(`/v1/kids/${kidId}/apps/${encodeURIComponent(pkg)}/rule`, { mode, dailyMinutes });
 }
```

### 5.4 The migration

After the `server/src/db/schema.ts` change, generate it from the repo root:

```powershell
pnpm --filter @screentime/schemas build
pnpm --filter @screentime/server exec drizzle-kit generate --name app_limits
```

That makes `server/drizzle/0007_app_limits.sql`, `server/drizzle/meta/0007_snapshot.json` and a new line in `server/drizzle/meta/_journal.json`. drizzle-kit does not write row-level security, so add these lines to the end of `0007_app_limits.sql`:

```sql
--> statement-breakpoint
ALTER TABLE app_usage_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON app_usage_daily
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
```

### 5.5 The generated files

After the schema and route changes, run `pnpm contract` from the repo root. It rewrites `contract/openapi.json`, `android/core-model/.../ApiClient.kt` and `ApiModels.kt`, and `windows/src/ScreenTime.Core/Api/ApiClient.g.cs` and `ApiModels.g.cs`. Commit them as they come, and never edit them by hand.

## 6. Detailed spec

This is what the code above does, for your review and for the PR. `docs/SPEC.md` §12.4 is the full version.

- **A limit** is the rule mode `limit` with `dailyMinutes`: 5 to 480 in steps of 5. Every other mode has `dailyMinutes: null`, and anything else gets 422.
- **Usage:** `POST /v1/device/app-usage` takes seconds per app per local day. The server keeps the larger value. `GET /v1/kids/{kidId}/apps` gives `todaySeconds` across the kid's devices. The snapshot's `today.appUsage` gives each device the others' seconds, only for limited apps. Usage is not pushed.
- **On the device:** time is counted from Android's usage events since local midnight in the family's time zone: resumed to paused, ending at screen off, leaving out parent mode. Used time is that plus the other devices. Two devices at once count twice.
- **At 5 minutes left** with the app in front, a notification says "5 minutes of YouTube left". **At the limit** the app is blocked, and if it was in front a notification says "That's all your YouTube for today". The loop wakes when the time should run out. More time from a parent lets both come again.
- **Usage access off:** `tamper.policy` with `missing: usage_access`, the caught screen, and limited apps stay blocked until it is back.
- **The kid's main screen** lists the limits: "YouTube · 12m left", "YouTube · done for today", hidden during parent mode.

## 7. Steps

1. Start the branch (section 10).
2. Create the files of 5.1, and make the changes of 5.3.
3. Do 5.4, then 5.5.
4. Run section 8.1 until it passes.
5. Run section 8.2 and keep all its output.
6. Push, open the PR, wait for CI, and send the handback (sections 10 and 12).

## 8. Acceptance criteria

### 8.1 Build and tests

From the repo root, in `pwsh`:

```powershell
pnpm install --frozen-lockfile
pnpm contract
git status --short contract
pnpm build
pnpm typecheck
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
docker exec screentime-db-1 psql -U screentime -d postgres -c "create database screentime_test"
$pw = (Select-String -Path deploy\.env -Pattern '^POSTGRES_PASSWORD=(.*)').Matches[0].Groups[1].Value
$env:TEST_DATABASE_URL = "postgres://screentime:$pw@localhost:5432/screentime_test"
pnpm test
Remove-Item Env:TEST_DATABASE_URL
cd windows
dotnet test tests\ScreenTime.Core.Tests
cd ..\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git grep -l 'Â' -- packages server/src server/scripts server/test android/app-kid/src android/app-parent/src web/src windows/tests
```

- [ ] `pnpm typecheck` and `pnpm build` pass. An error that `screentime_test` already exists is fine.
- [ ] `pnpm test` passes. In the rehearsal: engine 27, schemas 36, web 69, server 258, with 10 in `test/app-limits.test.ts`.
- [ ] `dotnet test` says `Test run summary: Passed!`. In the rehearsal: 270.
- [ ] `.\gradlew.bat assembleDebug test` says `BUILD SUCCESSFUL`, with `AppLimitsTest` at 19 tests. Check with `Select-String 'tests="' android\app-kid\build\test-results\testDebugUnitTest\TEST-au.screentime.kid.apps.AppLimitsTest.xml`.
- [ ] The last `git grep` prints nothing. If it prints a file, you saved it in the wrong encoding: save it again as UTF-8 without a BOM.

### 8.2 On the emulator

Close what you can first, and stop any emulator still running: **the emulator freezes when the PC runs out of memory** (`adb` then hangs with no error), and timing checks can fail when it is merely slow. If that happens, stop the run with Ctrl+C, close other programs, and run it again. A rerun starts clean. Say so under Deviations, with the failures you saw.

From the repo root, in `pwsh`:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
pwsh -File docs\cards\CARD-058-run.ps1 2>&1 | Tee-Object -FilePath ..\temp\card058-bob-out.txt
```

It takes about 8 minutes. It **wipes the emulator and the development database, and replaces `deploy\.env` with throwaway values**. It needs the debug APKs from 8.1. It stops the emulator at the end.

- [ ] The last line is `--- Finished with 0 failed.`, and no line starts with `FAIL`. In the rehearsal: 23 `PASS` lines.
- [ ] Paste **all** of `..\temp\card058-bob-out.txt` into the handback. A summary counts as `NOT RUN`.
- [ ] Say what you see in `..\temp\card058-kid.png` (the kid's main screen) and `..\temp\card058-apps.png` (the Apps page). If one does not exist, write `NOT RUN`.

Not tested on the emulator: a limit resetting at a real midnight (the tests cover the sums), a real push, audio stopping at the limit, and a real device. Do not try to sign in to Google.

### 8.3 CI

- [ ] On the PR, every check is green.

## 9. Tests

- `server/test/app-limits.test.ts` (10 tests): storing a limit; refusing bad ones; forgetting the minutes; never lowering a value; refusing a PC, a bad day and no token; today's total for a parent; the others' seconds in the snapshot; nothing for a PC; no push for usage; a limit answering a waiting app counts as a yes.
- `android/app-kid/.../apps/AppLimitsTest.kt` (19 tests): adding up time, screen off, an app in front at midnight, yesterday left out, parent mode left out, limits across devices, blocks, the news, the next look, and saved spans.
- `web/test/apps.test.ts`, `android/app-parent/.../kids/AppsTest.kt` and `android/app-kid/.../status/AppLimitViewTest.kt` are already in the repo from PR #160 and must pass unchanged.
- The other test files in 5.3 change only as shown.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-058-app-limits
   ```
2. Commit in small logical commits. Message format: `CARD-058: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes.
4. Push: `git push -u origin bob/card-058-app-limits`
5. Open a PR into `main` titled `CARD-058: Daily limits per app` with this body, written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-058-app-limits.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] criterion 1 — output: `...`
   - [x] criterion 2 — output: `...`

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace, and every workaround (a restart, a retry). If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-058. Please review and merge if it is good.

CARD: CARD-058 Daily limits per app
PR: <full PR URL>
Branch: bob/card-058-app-limits
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- pnpm typecheck -> <key lines, or NOT RUN: reason>
- pnpm test -> <test counts per package, or NOT RUN: reason>
- dotnet test (from windows) -> <summary, or NOT RUN: reason>
- .\gradlew.bat assembleDebug test -> <result and the AppLimitsTest line, or NOT RUN: reason>
- git grep for mangled characters -> <output, or NOT RUN: reason>
- pwsh -File docs\cards\CARD-058-run.ps1 -> <ALL of ..\temp\card058-bob-out.txt, or NOT RUN: reason>
- The two screenshots -> <what each one shows, or NOT RUN: reason>
- CI -> <every check and its result, or NOT RUN: reason>

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
