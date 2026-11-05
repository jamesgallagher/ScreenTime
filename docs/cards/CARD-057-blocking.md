# CARD-057: Blocking apps and new app approval

| Field | Value |
|---|---|
| Card | CARD-057 |
| Title | Blocking apps and new app approval |
| Size | L |
| Depends on | CARD-056 and the CARD-057 front end (PR #157), merged to `main` |
| Spec sections | docs/SPEC.md §12.4, §6.1, §8.2, §9.2, §10, §13, §16.4, §16.5, Q35, Q37 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-057-blocking` |
| PR title | `CARD-057: Blocking apps and new app approval` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first (rules 8, 9 and 10 especially).

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Check with `$PSVersionTable.PSVersion` (7.x). Write every file as UTF-8 without a BOM: section 8.1 checks for mangled characters (`§` saved as `Â§`).

CARD-056 made the app list and the install and first-use alerts. This card lets a parent block an app on a kid's Android devices, and adds a per-kid switch that keeps new apps blocked until a parent answers. Android only.

Claude has **already rehearsed this whole card** with the code below, and every step of section 8 passed (section 8.3 has the output). Copy the code exactly. The tests are the contract and must pass unchanged.

The screens are merged (PR #157), behind a seam with fake rules that only shows in dev and debug builds. **Rule 10 of `AGENTS.md` applies:** the only changes you make to those screens are the seam removals in section 5.3, and those are exact.

## 2. Goal

A parent's `blocked` rule reaches the kid's device, which suspends the app, or hides it where Android refuses (the Play Store). `allowed` releases it, and parent mode releases everything until it ends. With new app approval on, a new app stays blocked until a parent answers. `pnpm test`, `.\gradlew.bat assembleDebug test`, the Windows tests and `pwsh -File docs\cards\CARD-057-run.ps1` all pass, and CI is green.

## 3. Out of scope

- No daily limits, no `limit` mode, no `daily_minutes`, no `app_usage_daily`, no usage access tamper check (CARD-058).
- No change to the time engine. App blocks do not touch the block screen or Lock Task.
- Nothing new on Windows. It only gets the regenerated client and the three test fixture lines in 5.3.
- No new library. Do not edit generated files by hand.
- Never run on a real phone, never install a release build, never commit secrets (`deploy/.env`, tokens, keys, `google-services.json`, `local.properties`).

## 4. Tech

The project's existing stack, with nothing new.

Traps Claude hit in the rehearsal, so you need not:

- **A reinstalled app comes back free.** The device must ask Android what is blocked (`isPackageSuspended`, `isApplicationHidden`), not trust what it saved. The first rehearsal trusted its saved list, and a reinstalled blocked app stayed open.
- A rule is per kid, so it can name an app that is not on this device. `applyBlocks` skips those.
- A hidden app is not in the launcher query, so `installed()` adds the hidden ones back. Otherwise blocking the Play Store would report it as removed.
- The Kotlin generator cannot do a named schema that is nullable. `KidApp.rule` uses a `KidAppRule` with no `.meta` id, and the route answers with the separate named `AppRuleSaved`.
- In the C# tests the JSON is a raw interpolated string, so `}}` breaks it. `apps` goes **before** `activeSos` in those fixtures.
- `apps` is required in the snapshot, so test fixtures need it. A device updating from an older build ignores its old cached snapshot until its first sync, which is fine.

## 5. Files

### 5.1 Create these, exactly

#### `server/scripts/dev-app-rule.ts`

```typescript
// Plays the parent's side of app rules in the development database, through the API, as a parent would in the app.
// It signs a short-lived parent token with JWT_SECRET for the family's first parent; the server must use the same secret.
// Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-app-rule.ts Alex rule com.android.chrome blocked
//   pnpm --filter @screentime/server exec tsx scripts/dev-app-rule.ts Alex approval on
// It prints the HTTP status. Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { kids, parents } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const [kidName, what, first, second] = process.argv.slice(2);
if (!databaseUrl || !jwtSecret || !kidName || !first || (what !== 'rule' && what !== 'approval')) {
  console.error('Usage: tsx scripts/dev-app-rule.ts <kid name> rule <package> <allowed|blocked> | approval <on|off>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db.select().from(kids).where(sql`lower(${kids.name}) = lower(${kidName})`).orderBy(asc(kids.createdAt)).limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}`);
  const [parent] = await db
    .select()
    .from(parents)
    .where(and(eq(parents.familyId, kid.familyId), isNull(parents.disabledAt)))
    .orderBy(asc(parents.createdAt))
    .limit(1);
  if (!parent) throw new Error(`the family of ${kid.name} has no parent`);
  const token = await signAccessToken(jwtSecret, { sessionId: randomUUID(), parentId: parent.id, familyId: kid.familyId, roles: ['parent'] });
  const path = what === 'rule' ? `/v1/kids/${kid.id}/apps/${encodeURIComponent(first)}/rule` : `/v1/kids/${kid.id}/app-settings`;
  const body = what === 'rule' ? { mode: second } : { newAppApproval: first === 'on' };
  const response = await fetch(`http://localhost:8080${path}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log(`${what} ${first} ${second ?? ''}: ${response.status}`);
} finally {
  await pool.end();
}
```

### 5.2 The tests: create these, exactly

#### `server/test/app-rules.test.ts`

```typescript
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { appRules, devices, events, families, kids, parentSessions, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('app rules', () => {
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

  let family = '';
  let dad = '';
  let otherDad = '';
  let kid = '';
  const phone = { id: '', token: '' };
  const pc = { id: '', token: '' };

  function app(pkg: string, over: Record<string, unknown> = {}) {
    return { package: pkg, label: pkg.toUpperCase(), source: 'play', installer: null, blockable: true, installedAt: '2026-11-03T06:00:00.000Z', firstUsedAt: null, ...over };
  }

  const put = (apps: unknown[]) => api.put('/v1/device/apps', phone.token, { apps });
  const rule = (pkg: string, mode: string, token = dad) => api.put(`/v1/kids/${kid}/apps/${encodeURIComponent(pkg)}/rule`, token, { mode });
  const settings = (on: boolean, token = dad) => api.put(`/v1/kids/${kid}/app-settings`, token, { newAppApproval: on });

  async function kinds() {
    const rows = await db.select().from(events).where(eq(events.familyId, family));
    return rows.filter((e) => e.kind.startsWith('app.')).map((e) => e.kind).sort();
  }

  async function addDevice(platform: 'android' | 'windows', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId: family,
        kidId: kid,
        platform,
        form: platform === 'android' ? 'phone' : 'pc',
        pool: platform === 'android' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function signIn(familyId: string, parentId: string, fcmToken: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    const [b] = await db.insert(families).values({ name: 'B', timezone: 'Australia/Sydney', parentCodeSecret: 'B'.repeat(32) }).returning();
    if (!a || !b) throw new Error('no family');
    family = a.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    const [q] = await db.insert(parents).values({ familyId: b.id, email: 'bea@example.com', displayName: 'Bea' }).returning();
    if (!p || !q) throw new Error('no parent');
    dad = await signIn(family, p.id, 'dad-phone');
    otherDad = await signIn(b.id, q.id, 'bea-phone');
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '07:00', bedtime: '20:30' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(phone, await addDevice('android', 'Pixel 7'));
    Object.assign(pc, await addDevice('windows', 'Alex on PC'));
  });

  it('blocks and allows an app, and the list shows the rule', async () => {
    await put([app('a.game'), app('b.game')]);
    const blocked = await rule('a.game', 'blocked');
    expect(blocked.status).toBe(200);
    expect(blocked.body).toEqual({ mode: 'blocked' });
    const list = await api.get(`/v1/kids/${kid}/apps`, dad);
    const rows = list.body.apps as { package: string; rule: { mode: string } | null }[];
    expect(rows.find((a) => a.package === 'a.game')?.rule).toEqual({ mode: 'blocked' });
    expect(rows.find((a) => a.package === 'b.game')?.rule).toBeNull();
    expect((await rule('a.game', 'allowed')).body).toEqual({ mode: 'allowed' });
  });

  it('refuses what a parent cannot do', async () => {
    await put([app('a.game'), app('com.android.settings', { blockable: false })]);
    expect((await rule('com.android.settings', 'blocked')).status).toBe(409);
    expect((await rule('not.there', 'blocked')).status).toBe(404);
    expect((await rule('a.game', 'held')).status).toBe(422);
    expect((await rule('a.game', 'blocked', otherDad)).status).toBe(404);
    expect((await settings(true, otherDad)).status).toBe(404);
    expect((await api.put(`/v1/kids/${kid}/app-settings`, null, { newAppApproval: true })).status).toBe(401);
  });

  it('puts the rules and the switch in the snapshot, and changes its version', async () => {
    await put([app('a.game')]);
    const before = await api.get('/v1/device/state', phone.token);
    expect(before.body.apps).toEqual({ newAppApproval: false, rules: [] });
    await rule('a.game', 'blocked');
    await settings(true);
    const after = await api.get('/v1/device/state', phone.token);
    expect(after.body.apps).toEqual({ newAppApproval: true, rules: [{ package: 'a.game', mode: 'blocked' }] });
    expect(after.body.stateVersion).not.toBe(before.body.stateVersion);
  });

  it('gives a PC an empty apps part', async () => {
    await put([app('a.game')]);
    await rule('a.game', 'blocked');
    await settings(true);
    const state = await api.get('/v1/device/state', pc.token);
    expect(state.body.apps).toEqual({ newAppApproval: false, rules: [] });
  });

  it('tells the devices when a rule or the switch changes', async () => {
    await db.update(devices).set({ fcmToken: 'kid-phone' }).where(eq(devices.id, phone.id));
    await put([app('a.game')]);
    sent.length = 0;
    await rule('a.game', 'blocked');
    expect(sent.filter((m) => m.token === 'kid-phone')).toHaveLength(1);
    await settings(true);
    expect(sent.filter((m) => m.token === 'kid-phone')).toHaveLength(2);
  });

  it('with approval off a new app only raises app.installed', async () => {
    await put([app('a.game')]);
    await put([app('a.game'), app('b.game')]);
    expect(await kinds()).toEqual(['app.installed']);
    expect(await db.select().from(appRules)).toEqual([]);
  });

  it('with approval on a new app is held, and the essential alert is pushed even when muted', async () => {
    await put([app('a.game')]);
    await settings(true);
    await db.update(devices).set({ fcmToken: 'kid-phone' }).where(eq(devices.id, phone.id));
    sent.length = 0;
    await put([app('a.game'), app('b.game', { label: 'Block Blast' })]);
    expect(await kinds()).toEqual(['app.approval']);
    const [held] = await db.select().from(appRules).where(eq(appRules.package, 'b.game'));
    expect(held?.mode).toBe('held');
    expect(held?.updatedBy).toBeNull();
    expect(sent.some((m) => m.token === 'dad-phone')).toBe(true);
    expect(sent.some((m) => m.token === 'kid-phone')).toBe(true);
    // The first list of a second device is still its baseline: nothing is held.
    const tablet = await addDevice('android', 'XPPen');
    await api.put('/v1/device/apps', tablet.token, { apps: [app('c.game')] });
    expect((await db.select().from(appRules).where(eq(appRules.package, 'c.game')))).toEqual([]);
  });

  it('an app with a rule is not held again: reinstalling a blocked or allowed app keeps its rule', async () => {
    await put([app('a.game'), app('b.game'), app('z.game')]);
    await rule('a.game', 'blocked');
    await rule('b.game', 'allowed');
    await settings(true);
    await put([app('z.game')]);
    await put([app('z.game'), app('a.game'), app('b.game')]);
    expect((await kinds()).filter((k) => k === 'app.approval')).toEqual([]);
    const rows = await db.select().from(appRules).where(and(eq(appRules.kidId, kid), eq(appRules.package, 'a.game')));
    expect(rows[0]?.mode).toBe('blocked');
  });

  it('an answer writes app.answered with who gave it, once', async () => {
    await put([app('a.game')]);
    await settings(true);
    await put([app('a.game'), app('b.game', { label: 'Block Blast' })]);
    await rule('b.game', 'allowed');
    await rule('b.game', 'blocked');
    const rows = await db.select().from(events).where(eq(events.kind, 'app.answered'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ package: 'b.game', label: 'Block Blast', approved: true, byName: 'Dad' });
  });

  it('turning approval off leaves waiting apps waiting', async () => {
    await put([app('a.game')]);
    await settings(true);
    await put([app('a.game'), app('b.game')]);
    await settings(false);
    const [held] = await db.select().from(appRules).where(eq(appRules.package, 'b.game'));
    expect(held?.mode).toBe('held');
  });
});
```

#### `android/app-kid/src/test/kotlin/au/screentime/kid/apps/AppBlocksTest.kt`

```kotlin
package au.screentime.kid.apps

import au.screentime.core.model.api.AppRuleMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Which apps should be blocked (docs/SPEC.md §12.4). */
class AppBlocksTest {
    private val rules = mapOf(
        "blocked.app" to AppRuleMode.BLOCKED,
        "held.app" to AppRuleMode.HELD,
        "allowed.app" to AppRuleMode.ALLOWED,
    )

    @Test
    fun blockedAndHeldRulesAreBlockedAndAllowedIsNot() {
        assertEquals(setOf("blocked.app", "held.app"), wantedBlocks(rules, emptySet(), emptySet(), parentMode = false))
    }

    @Test
    fun whatTheDeviceHoldsItselfIsBlockedToo() {
        assertEquals(setOf("new.app"), wantedBlocks(emptyMap(), setOf("new.app"), emptySet(), parentMode = false))
    }

    @Test
    fun whatTheDeviceNeedsIsNeverBlockedWhateverTheSnapshotSays() {
        val bad = mapOf(
            "com.google.android.gms" to AppRuleMode.BLOCKED,
            "com.google.android.gsf" to AppRuleMode.BLOCKED,
            "com.android.settings" to AppRuleMode.BLOCKED,
            "the.launcher" to AppRuleMode.BLOCKED,
        )
        assertEquals(emptySet<String>(), wantedBlocks(bad, setOf("the.launcher"), setOf("the.launcher"), parentMode = false))
    }

    @Test
    fun parentModeReleasesEverything() {
        assertEquals(emptySet<String>(), wantedBlocks(rules, setOf("new.app"), emptySet(), parentMode = true))
    }

    @Test
    fun thePlanOnlyHoldsTheDifference() {
        assertEquals(BlockPlan(setOf("a"), setOf("c")), blockPlan(setOf("a", "b"), setOf("b", "c")))
        assertEquals(BlockPlan(emptySet(), emptySet()), blockPlan(setOf("a"), setOf("a")))
    }

    @Test
    fun theFirstLookHoldsNothing() {
        assertEquals(emptySet<String>(), heldPackages(true, null, setOf("a", "b"), emptySet(), emptySet()))
    }

    @Test
    fun aNewAppIsHeldWithApprovalOnAndNoRule() {
        assertEquals(setOf("new"), heldPackages(true, setOf("old"), setOf("old", "new"), emptySet(), emptySet()))
    }

    @Test
    fun aNewAppWithARuleIsNotHeldHere() {
        assertEquals(emptySet<String>(), heldPackages(true, setOf("old"), setOf("old", "new"), setOf("new"), emptySet()))
    }

    @Test
    fun aNewAppIsNotHeldWithApprovalOff() {
        assertEquals(emptySet<String>(), heldPackages(false, setOf("old"), setOf("old", "new"), emptySet(), emptySet()))
    }

    @Test
    fun aHeldAppStaysUntilItHasARuleOrIsGone() {
        assertEquals(setOf("new"), heldPackages(true, setOf("new"), setOf("new"), emptySet(), setOf("new")))
        assertEquals(emptySet<String>(), heldPackages(true, setOf("new"), setOf("new"), setOf("new"), setOf("new")))
        assertEquals(emptySet<String>(), heldPackages(true, setOf("new"), emptySet(), emptySet(), setOf("new")))
    }

    @Test
    fun turningApprovalOffLetsGoOfAHeldAppWithNoRule() {
        assertEquals(emptySet<String>(), heldPackages(false, setOf("new"), setOf("new"), emptySet(), setOf("new")))
    }
}
```

### 5.3 Change these, exactly as in each diff

Lines with `+` are added and lines with `-` are removed. The surrounding lines show where.

#### `packages/schemas/src/apps.ts`

```diff
@@ -34,4 +34,26 @@ export const DeviceAppsPut = z
 export type DeviceAppsPut = z.infer<typeof DeviceAppsPut>;
 
+/** A parent's rule for an app (docs/SPEC.md §12.4). `held` is written by the server while a new app waits. */
+export const AppRuleMode = z.enum(['allowed', 'held', 'blocked']).meta({ id: 'AppRuleMode' });
+
+export type AppRuleMode = z.infer<typeof AppRuleMode>;
+
+/** Body of PUT /v1/kids/{kidId}/apps/{package}/rule. A parent cannot hold an app. */
+export const AppRulePut = z.object({ mode: z.enum(['allowed', 'blocked']) }).meta({ id: 'AppRulePut' });
+
+export type AppRulePut = z.infer<typeof AppRulePut>;
+
+export const KidAppRule = z.object({ mode: AppRuleMode });
+
+/** Answer of PUT /v1/kids/{kidId}/apps/{package}/rule. */
+export const AppRuleSaved = z.object({ mode: AppRuleMode }).meta({ id: 'AppRuleSaved' });
+
+export type KidAppRule = z.infer<typeof KidAppRule>;
+
+/** Body of PUT /v1/kids/{kidId}/app-settings. */
+export const KidAppSettings = z.object({ newAppApproval: z.boolean() }).meta({ id: 'KidAppSettings' });
+
+export type KidAppSettings = z.infer<typeof KidAppSettings>;
+
 /** One of the kid's devices an app is or was on. */
 export const KidAppDevice = z
@@ -56,4 +78,6 @@ export const KidApp = z
     /** 0 until app time is counted (CARD-058). */
     todaySeconds: z.int(),
+    /** Null means allowed. */
+    rule: KidAppRule.nullable(),
     devices: z.array(KidAppDevice),
   })
@@ -65,5 +89,4 @@ export type KidApp = z.infer<typeof KidApp>;
 export const KidApps = z
   .object({
-    /** Always false until new app approval exists (CARD-057). */
     newAppApproval: z.boolean(),
     apps: z.array(KidApp),
```

#### `packages/schemas/src/index.ts`

```diff
@@ -96,3 +96,15 @@ export {
   SosStatus,
 } from './sos.js';
-export { AppSource, DeviceAppIn, DeviceAppsPut, KidApp, KidAppDevice, KidApps } from './apps.js';
+export {
+  AppRuleMode,
+  AppRulePut,
+  AppRuleSaved,
+  AppSource,
+  DeviceAppIn,
+  DeviceAppsPut,
+  KidApp,
+  KidAppDevice,
+  KidAppRule,
+  KidApps,
+  KidAppSettings,
+} from './apps.js';
```

#### `packages/schemas/src/notify.ts`

```diff
@@ -15,4 +15,5 @@ export const NotificationKind = z
     'kid_message',
     'overspend',
+    'app.approval',
     'app.installed',
     'app.first_used',
@@ -26,5 +27,5 @@ export type NotificationKind = z.infer<typeof NotificationKind>;
 
 /** Kinds that cannot be turned off: SOS and every request that waits for a parent's answer. */
-export const ESSENTIAL_KINDS: readonly NotificationKind[] = ['sos', 'parent_mode.request', 'time_request'];
+export const ESSENTIAL_KINDS: readonly NotificationKind[] = ['sos', 'parent_mode.request', 'time_request', 'app.approval'];
 
 export const NotificationPref = z
```

#### `packages/schemas/src/sync.ts`

```diff
@@ -1,3 +1,4 @@
 import { z } from 'zod';
+import { AppRuleMode } from './apps.js';
 import { DeviceForm, Pool } from './devices.js';
 import { AvatarColor, Schedule } from './kids.js';
@@ -70,4 +71,9 @@ export const DeviceState = z
     pendingRequest: z.object({ id: z.uuid(), minutes: z.int(), createdAt: z.iso.datetime() }).nullable(),
     activeSos: z.object({ id: z.uuid(), startedAt: z.iso.datetime() }).nullable(),
+    /** The kid's app rules (docs/SPEC.md §12.4). Empty on a PC. */
+    apps: z.object({
+      newAppApproval: z.boolean(),
+      rules: z.array(z.object({ package: z.string(), mode: AppRuleMode })),
+    }),
   })
   .meta({ id: 'DeviceState' });
```

#### `server/src/db/schema.ts`

```diff
@@ -116,4 +116,5 @@ export const kids = pgTable(
     name: text('name').notNull(),
     avatarColor: text('avatar_color').notNull(),
+    newAppApproval: boolean('new_app_approval').notNull().default(false),
     createdAt: createdAt(),
     archivedAt: ts('archived_at'),
@@ -450,2 +451,21 @@ export const deviceApps = pgTable(
   (t) => [primaryKey({ columns: [t.deviceId, t.package] }), index('device_apps_kid_idx').on(t.kidId)],
 );
+
+/** A parent's rule for an app, for one kid (docs/SPEC.md §12.4). No row means allowed. */
+export const appRules = pgTable(
+  'app_rules',
+  {
+    familyId: familyId(),
+    kidId: uuid('kid_id')
+      .notNull()
+      .references(() => kids.id),
+    package: text('package').notNull(),
+    mode: text('mode').notNull(),
+    updatedAt: ts('updated_at').notNull().defaultNow(),
+    updatedBy: uuid('updated_by').references(() => parents.id),
+  },
+  (t) => [
+    primaryKey({ columns: [t.kidId, t.package] }),
+    check('app_rules_mode', sql`${t.mode} in ('allowed', 'held', 'blocked')`),
+  ],
+);
```

#### `server/src/apps/routes.ts`

```diff
@@ -1,13 +1,13 @@
 import { createRoute, z } from '@hono/zod-openapi';
 import { and, asc, eq, isNull } from 'drizzle-orm';
-import { DeviceAppsPut, KidApps, type KidApp } from '@screentime/schemas';
+import { type AppRuleMode, AppRulePut, AppRuleSaved, DeviceAppsPut, KidApps, KidAppSettings, type KidApp } from '@screentime/schemas';
 import type { AppDeps } from '../app.js';
 import { requireFamilyParent } from '../auth/guards.js';
 import { withFamily } from '../db/family.js';
-import { deviceApps, devices, events } from '../db/schema.js';
+import { appRules, deviceApps, devices, events, kids, parents } from '../db/schema.js';
 import { requireDevice } from '../devices/auth.js';
 import { ApiError } from '../errors.js';
 import { findKid } from '../kids/routes.js';
-import { notifyParents } from '../notify/dispatch.js';
+import { notifyParents, stateChanged } from '../notify/dispatch.js';
 import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
 import type { createRouter } from '../router.js';
@@ -37,4 +37,27 @@ const getKidAppsRoute = createRoute({
 });
 
+const putRuleRoute = createRoute({
+  method: 'put',
+  path: '/v1/kids/{kidId}/apps/{package}/rule',
+  tags: ['kids'],
+  summary: 'Allow or block an app for a kid',
+  description:
+    'Answering a waiting app also writes `app.answered`. An app on none of the kid\'s devices gets 404, and one that cannot be blocked gets 409.',
+  security: bearer,
+  request: { params: z.object({ kidId: z.uuid(), package: z.string().min(1).max(255) }), body: jsonBody(AppRulePut) },
+  responses: { 200: jsonResponse('The rule.', AppRuleSaved), ...errorResponses(401, 403, 404, 409, 422) },
+});
+
+const putSettingsRoute = createRoute({
+  method: 'put',
+  path: '/v1/kids/{kidId}/app-settings',
+  tags: ['kids'],
+  summary: 'Turn new app approval on or off for a kid',
+  description: 'Apps already waiting keep waiting for an answer.',
+  security: bearer,
+  request: { params: z.object({ kidId: z.uuid() }), body: jsonBody(KidAppSettings) },
+  responses: { 204: { description: 'Saved.' }, ...errorResponses(401, 403, 404, 422) },
+});
+
 /** A device clock can be ahead; nothing is stored as happening in the future. */
 function notFuture(at: Date, now: Date): Date {
@@ -57,4 +80,5 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
     const body = c.req.valid('json');
     const now = new Date();
+    let held = false;
     const eventIds = await withFamily(db, familyId, async (tx) => {
       const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId));
@@ -65,4 +89,7 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
       // The device's first list: what is already there raises nothing.
       const baseline = known.length === 0;
+      const [kid] = await tx.select({ newAppApproval: kids.newAppApproval }).from(kids).where(eq(kids.id, kidId));
+      const rules = await tx.select({ package: appRules.package }).from(appRules).where(eq(appRules.kidId, kidId));
+      const ruled = new Set(rules.map((r) => r.package));
       const toWrite: { kind: string; at: Date; payload: Record<string, unknown> }[] = [];
 
@@ -73,5 +100,14 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
         const firstUsedAt = earliest(row?.firstUsedAt ?? null, seenFirstUse);
         const payload = { package: a.package, label: a.label, source: a.source, deviceName: device.name };
-        if (!baseline && (!row || row.removedAt)) toWrite.push({ kind: 'app.installed', at: installedAt, payload });
+        if (!baseline && (!row || row.removedAt)) {
+          // With approval on and no rule yet, the new app waits for a parent (docs/SPEC.md §12.4, Q37).
+          const hold = kid?.newAppApproval === true && !ruled.has(a.package);
+          if (hold) {
+            await tx.insert(appRules).values({ familyId, kidId, package: a.package, mode: 'held' }).onConflictDoNothing();
+            ruled.add(a.package);
+            held = true;
+          }
+          toWrite.push({ kind: hold ? 'app.approval' : 'app.installed', at: installedAt, payload });
+        }
         if (!baseline && seenFirstUse && !row?.firstUsedAt) {
           toWrite.push({
@@ -113,4 +149,55 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
     });
     await notifyParents(deps, familyId, eventIds);
+    if (held) await stateChanged(deps, familyId, { kidId });
+    return c.body(null, 204);
+  });
+
+  app.openapi(putRuleRoute, async (c) => {
+    const { familyId, parentId } = await requireFamilyParent(c, db, config.jwtSecret);
+    const { kidId, package: pkg } = c.req.valid('param');
+    const { mode } = c.req.valid('json');
+    const eventIds = await withFamily(db, familyId, async (tx) => {
+      if (!(await findKid(tx, kidId))) throw new ApiError('not_found', 'No such kid in your family.');
+      const rows = await tx
+        .select({ label: deviceApps.label, blockable: deviceApps.blockable })
+        .from(deviceApps)
+        .innerJoin(devices, eq(devices.id, deviceApps.deviceId))
+        .where(and(eq(deviceApps.kidId, kidId), eq(deviceApps.package, pkg), isNull(devices.revokedAt)));
+      if (rows.length === 0) throw new ApiError('not_found', 'That app is not on any of this kid\'s devices.');
+      if (rows.some((r) => !r.blockable)) throw new ApiError('conflict', 'That app cannot be blocked.');
+      const [before] = await tx.select({ mode: appRules.mode }).from(appRules).where(and(eq(appRules.kidId, kidId), eq(appRules.package, pkg)));
+      const values = { mode, updatedAt: new Date(), updatedBy: parentId };
+      await tx
+        .insert(appRules)
+        .values({ familyId, kidId, package: pkg, ...values })
+        .onConflictDoUpdate({ target: [appRules.kidId, appRules.package], set: values });
+      if (before?.mode !== 'held') return [];
+      const [parent] = await tx.select({ name: parents.displayName }).from(parents).where(eq(parents.id, parentId));
+      const stored = await tx
+        .insert(events)
+        .values({
+          familyId,
+          kidId,
+          kind: 'app.answered',
+          at: new Date(),
+          payload: { package: pkg, label: rows[0]?.label, approved: mode === 'allowed', byName: parent?.name ?? null },
+        })
+        .returning({ id: events.id });
+      return stored.map((e) => e.id);
+    });
+    await notifyParents(deps, familyId, eventIds);
+    await stateChanged(deps, familyId, { kidId });
+    return c.json({ mode }, 200);
+  });
+
+  app.openapi(putSettingsRoute, async (c) => {
+    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
+    const { kidId } = c.req.valid('param');
+    const { newAppApproval } = c.req.valid('json');
+    await withFamily(db, familyId, async (tx) => {
+      if (!(await findKid(tx, kidId))) throw new ApiError('not_found', 'No such kid in your family.');
+      await tx.update(kids).set({ newAppApproval }).where(eq(kids.id, kidId));
+    });
+    await stateChanged(deps, familyId, { kidId });
     return c.body(null, 204);
   });
@@ -119,8 +206,8 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
     const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
     const { kidId } = c.req.valid('param');
-    const rows = await withFamily(db, familyId, async (tx) => {
+    const { kid, rows, rules } = await withFamily(db, familyId, async (tx) => {
       const kid = await findKid(tx, kidId);
       if (!kid) throw new ApiError('not_found', 'No such kid.');
-      return tx
+      const rows = await tx
         .select({ app: deviceApps, deviceName: devices.name })
         .from(deviceApps)
@@ -128,5 +215,8 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
         .where(and(eq(deviceApps.kidId, kidId), isNull(devices.revokedAt)))
         .orderBy(asc(deviceApps.label), asc(devices.name));
+      const rules = await tx.select().from(appRules).where(eq(appRules.kidId, kidId));
+      return { kid, rows, rules };
     });
+    const ruleOf = new Map(rules.map((r) => [r.package, r.mode as AppRuleMode]));
     const apps = new Map<string, KidApp>();
     for (const { app: row, deviceName } of rows) {
@@ -137,4 +227,5 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
         blockable: true,
         todaySeconds: 0,
+        rule: ruleOf.has(row.package) ? { mode: ruleOf.get(row.package) as AppRuleMode } : null,
         devices: [],
       };
@@ -150,5 +241,5 @@ export function registerAppRoutes(app: Router, deps: AppDeps) {
       apps.set(row.package, entry);
     }
-    return c.json({ newAppApproval: false, apps: [...apps.values()] }, 200);
+    return c.json({ newAppApproval: kid.newAppApproval, apps: [...apps.values()] }, 200);
   });
 }
```

#### `server/src/sync/routes.ts`

```diff
@@ -4,4 +4,5 @@ import { and, asc, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
 import {
   type AvatarColor,
+  type AppRuleMode,
   type DeviceForm,
   DeviceState,
@@ -16,4 +17,5 @@ import { requireFamilyParent } from '../auth/guards.js';
 import { withFamily } from '../db/family.js';
 import {
+  appRules,
   devices,
   families,
@@ -173,4 +175,14 @@ export function registerSyncRoutes(app: Router, deps: AppDeps) {
         .limit(1);
 
+      // Apps are Android only (docs/SPEC.md §12.4).
+      const rules =
+        device.platform === 'android'
+          ? await tx
+              .select({ package: appRules.package, mode: appRules.mode })
+              .from(appRules)
+              .where(eq(appRules.kidId, kidId))
+              .orderBy(asc(appRules.package))
+          : [];
+
       return {
         serverTime: day.now.toISOString(),
@@ -198,4 +210,8 @@ export function registerSyncRoutes(app: Router, deps: AppDeps) {
           pendingRequest: pending ? { id: pending.id, minutes: pending.minutes, createdAt: pending.createdAt.toISOString() } : null,
           activeSos: sos ? { id: sos.id, startedAt: sos.startedAt.toISOString() } : null,
+          apps: {
+            newAppApproval: device.platform === 'android' && kid.newAppApproval,
+            rules: rules.map((r) => ({ package: r.package, mode: r.mode as AppRuleMode })),
+          },
         },
       };
```

#### `server/src/notify/routes.ts`

```diff
@@ -98,4 +98,5 @@ const KIND_NAME: Record<NotificationKind, string> = {
   kid_message: 'Messages',
   overspend: 'Offline overspend',
+  'app.approval': 'New apps waiting for approval',
   'app.installed': 'New apps',
   'app.first_used': 'Apps used for the first time',
```

#### `server/scripts/dev-apps.ts`

```diff
@@ -4,5 +4,5 @@
 import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
 import { createDb } from '../src/db/client.js';
-import { deviceApps, events, kids } from '../src/db/schema.js';
+import { appRules, deviceApps, events, kids } from '../src/db/schema.js';
 
 const databaseUrl = process.env.DATABASE_URL;
@@ -24,4 +24,8 @@ try {
     );
   }
+  const rules = await db.select().from(appRules).where(eq(appRules.kidId, kid.id)).orderBy(asc(appRules.package));
+  console.log(`approval: ${kid.newAppApproval}`);
+  console.log(`rules: ${rules.length}`);
+  for (const r of rules) console.log(`rule ${r.package} ${r.mode}`);
   const list = await db
     .select()
```

#### `server/test/db.test.ts`

```diff
@@ -33,4 +33,5 @@ describe.skipIf(!url)('database', () => {
     );
     expect(result.rows.map((r) => r.table_name).sort()).toEqual([
+      'app_rules',
       'device_apps',
       'devices',
```

#### `server/test/notify.test.ts`

```diff
@@ -185,5 +185,5 @@ describe.skipIf(!url)('notifications', () => {
       const res = await api.get('/v1/me/notification-prefs', dad);
       expect(res.status).toBe(200);
-      expect(res.body).toHaveLength(12);
+      expect(res.body).toHaveLength(13);
       expect(res.body.every((p: { enabled: boolean }) => p.enabled)).toBe(true);
       expect(res.body.filter((p: { essential: boolean }) => p.essential).map((p: { kind: string }) => p.kind)).toEqual([
@@ -191,4 +191,5 @@ describe.skipIf(!url)('notifications', () => {
         'parent_mode.request',
         'time_request',
+        'app.approval',
       ]);
     });
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/admin/Policies.kt`

```diff
@@ -7,4 +7,5 @@ import android.content.Context
 import android.content.pm.PackageManager
 import android.content.pm.PermissionInfo
+import android.os.Build
 import android.os.UserManager
 import android.telecom.TelecomManager
@@ -26,6 +27,6 @@ object Policies {
     private const val MISSING = "missing"
 
-    /** Restrictions for every build. */
-    private val RESTRICTIONS = listOf(
+    /** Restrictions for every build. A private space could hide apps from the list and from blocks (docs/SPEC.md §12.4). */
+    private val RESTRICTIONS = listOfNotNull(
         UserManager.DISALLOW_APPS_CONTROL,
         UserManager.DISALLOW_SAFE_BOOT,
@@ -34,4 +35,5 @@ object Policies {
         UserManager.DISALLOW_ADD_USER,
         UserManager.DISALLOW_AIRPLANE_MODE,
+        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) UserManager.DISALLOW_ADD_PRIVATE_PROFILE else null,
     )
 
@@ -60,4 +62,6 @@ object Policies {
             dpm.setUninstallBlocked(admin, context.packageName, true)
         }
+        // The second line of the dialog Android shows when a blocked app is opened (docs/SPEC.md §12.4).
+        dpm.setShortSupportMessage(admin, "Ask Mum or Dad about this app.")
         dpm.setAutoTimeEnabled(admin, true)
         dpm.setAutoTimeZoneEnabled(admin, true)
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/apps/Apps.kt`

```diff
@@ -1,4 +1,5 @@
 package au.screentime.kid.apps
 
+import au.screentime.core.model.api.AppRuleMode
 import au.screentime.core.model.api.AppSource
 import au.screentime.core.model.api.DeviceAppIn
@@ -47,4 +48,41 @@ fun withFirstUses(known: Map<String, Long>, resumes: List<Resume>, ignored: Set<
 }
 
+/** What the device must do to match [wanted]: which packages to block, and which to release. */
+data class BlockPlan(val block: Set<String>, val release: Set<String>)
+
+/**
+ * Which packages should be blocked now (docs/SPEC.md §12.4): those with a `blocked` or `held` rule and those the
+ * device is holding itself, never anything in [protected] or [NEVER_BLOCKED]. Parent mode releases everything.
+ */
+fun wantedBlocks(
+    rules: Map<String, AppRuleMode>,
+    held: Set<String>,
+    protected: Set<String>,
+    parentMode: Boolean,
+): Set<String> {
+    if (parentMode) return emptySet()
+    val ruled = rules.filterValues { it == AppRuleMode.BLOCKED || it == AppRuleMode.HELD }.keys
+    return (ruled + held) - protected - NEVER_BLOCKED
+}
+
+fun blockPlan(wanted: Set<String>, applied: Set<String>): BlockPlan = BlockPlan(wanted - applied, applied - wanted)
+
+/**
+ * The packages the device holds itself until the server's rule arrives: new since the last look, with approval on and
+ * no rule. One already held stays until it has a rule or is gone. With approval off nothing new is held, and one with
+ * no rule is let go. The first look ([known] null) is the baseline, so nothing is held.
+ */
+fun heldPackages(
+    approval: Boolean,
+    known: Set<String>?,
+    installed: Set<String>,
+    rules: Set<String>,
+    held: Set<String>,
+): Set<String> {
+    if (!approval) return emptySet()
+    val new = if (known == null) emptySet() else installed - known
+    return (held + new).intersect(installed) - rules
+}
+
 private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/apps/AppWatcher.kt`

```diff
@@ -12,8 +12,12 @@ import android.provider.Telephony
 import android.telecom.TelecomManager
 import android.util.Log
+import android.app.admin.DevicePolicyManager
 import au.screentime.core.model.api.ApiClient
 import au.screentime.core.model.api.ApiException
 import au.screentime.core.model.api.ApiJson
 import au.screentime.core.model.api.DeviceAppsPut
+import au.screentime.core.model.api.DeviceState
+import au.screentime.kid.admin.KidDeviceAdminReceiver
+import au.screentime.kid.admin.Policies
 import kotlinx.coroutines.CancellationException
 
@@ -29,4 +33,54 @@ class AppWatcher(context: Context, private val api: ApiClient, private val now:
     private var warned = false
 
+    /**
+     * Makes the device match the snapshot's rules: suspended, or hidden when Android refuses (Play Store); released
+     * when no longer wanted. Cheap when nothing changed, so the service can call it after every run of the engine.
+     * Does nothing unless the app is Device Owner.
+     */
+    fun applyBlocks(state: DeviceState, parentMode: Boolean) {
+        if (!Policies.isDeviceOwner(context)) return
+        val rules = state.apps.rules.associate { it.`package` to it.mode }
+        val installed = installed().map { it.packageName }.toSet()
+        val knownBefore = prefs.getStringSet(KNOWN, null)
+        val held = heldPackages(state.apps.newAppApproval, knownBefore, installed, rules.keys, prefs.getStringSet(HELD, null).orEmpty())
+        val dpm = context.getSystemService(DevicePolicyManager::class.java)
+        val admin = KidDeviceAdminReceiver.component(context)
+        // Android's word, not what was saved: a reinstalled app comes back free. An app not on this device is skipped:
+        // rules are per kid, so it may only be on another one.
+        val suspended = prefs.getStringSet(SUSPENDED, null).orEmpty().filter { isSuspended(dpm, it) }.toSet()
+        val hidden = prefs.getStringSet(HIDDEN, null).orEmpty().filter { dpm.isApplicationHidden(admin, it) }.toSet()
+        val wanted = wantedBlocks(rules, held, protectedPackages(), parentMode).intersect(installed)
+        val plan = blockPlan(wanted, suspended + hidden)
+        prefs.edit().putStringSet(KNOWN, installed).putStringSet(HELD, held).commit()
+        if (plan.block.isEmpty() && plan.release.isEmpty()) return
+
+        val nowSuspended = suspended.toMutableSet()
+        val nowHidden = hidden.toMutableSet()
+        val unsuspend = plan.release.intersect(suspended)
+        if (unsuspend.isNotEmpty()) {
+            dpm.setPackagesSuspended(admin, unsuspend.toTypedArray(), false)
+            nowSuspended -= unsuspend
+        }
+        for (name in plan.release.intersect(hidden)) {
+            dpm.setApplicationHidden(admin, name, false)
+            nowHidden -= name
+        }
+        if (plan.block.isNotEmpty()) {
+            val refused = dpm.setPackagesSuspended(admin, plan.block.toTypedArray(), true).toSet()
+            nowSuspended += plan.block - refused
+            for (name in refused) {
+                if (dpm.setApplicationHidden(admin, name, true)) nowHidden += name
+            }
+        }
+        prefs.edit().putStringSet(SUSPENDED, nowSuspended).putStringSet(HIDDEN, nowHidden).commit()
+        Log.i(TAG, "apps: blocked ${(nowSuspended + nowHidden).sorted()} (hidden ${nowHidden.sorted()})")
+    }
+
+    private fun isSuspended(dpm: DevicePolicyManager, name: String): Boolean = try {
+        dpm.isPackageSuspended(KidDeviceAdminReceiver.component(context), name)
+    } catch (e: PackageManager.NameNotFoundException) {
+        false
+    }
+
     /** Reads new usage events. Sends the list if an app was used for the first time. */
     suspend fun tick() {
@@ -95,13 +149,14 @@ class AppWatcher(context: Context, private val api: ApiClient, private val now:
     }
 
-    /** Every app with a launcher icon, except this one. */
+    /** Every app with a launcher icon, except this one, and the apps this app hid: they stay on the list. */
     private fun installed(): List<InstalledApp> {
         val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
         val packages = pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
             .map { it.activityInfo.packageName }
-            .toSet() - context.packageName
+            .toSet() - context.packageName + prefs.getStringSet(HIDDEN, null).orEmpty()
         return packages.mapNotNull { name ->
             try {
-                val info = pm.getPackageInfo(name, PackageManager.PackageInfoFlags.of(0))
+                val flags = PackageManager.MATCH_UNINSTALLED_PACKAGES.toLong()
+                val info = pm.getPackageInfo(name, PackageManager.PackageInfoFlags.of(flags))
                 val app = info.applicationInfo ?: return@mapNotNull null
                 InstalledApp(
@@ -109,5 +164,5 @@ class AppWatcher(context: Context, private val api: ApiClient, private val now:
                     label = app.loadLabel(pm).toString(),
                     isSystem = app.flags and ApplicationInfo.FLAG_SYSTEM != 0,
-                    installer = pm.getInstallSourceInfo(name).installingPackageName,
+                    installer = runCatching { pm.getInstallSourceInfo(name).installingPackageName }.getOrNull(),
                     installedAtMs = info.firstInstallTime,
                 )
@@ -142,4 +197,8 @@ class AppWatcher(context: Context, private val api: ApiClient, private val now:
         const val SENT = "sent"
         const val READ_TO = "readTo"
+        const val KNOWN = "known"
+        const val HELD = "held"
+        const val SUSPENDED = "suspended"
+        const val HIDDEN = "hidden"
 
         /** The first read looks this far back, so apps already in use raise no alert. */
```

#### `android/app-kid/src/main/kotlin/au/screentime/kid/service/KidService.kt`

```diff
@@ -165,5 +165,8 @@ class KidService : Service() {
             Log.i(TAG, "apps: ${intent.action} ${intent.data?.schemeSpecificPart}")
             // No connection: the network callback syncs when it is back, and the sync sends the list.
-            scope.launch { if (apps?.send() == false) lastSyncOk = false }
+            scope.launch {
+                if (apps?.send() == false) lastSyncOk = false
+                report()
+            }
         }
     }
@@ -516,4 +519,5 @@ class KidService : Service() {
         if (sosOn != sos.active) Log.i(TAG, "sos: ${if (sos.active) "on" else "off"}")
         sosOn = sos.active
+        apps?.applyBlocks(cached.state, paused)
         val counting = !blocked && !paused && !sosOn
         if (wasCounting && !counting) recorder.stop(now)
```

#### `android/app-kid/src/test/kotlin/au/screentime/kid/usage/StateFixture.kt`

```diff
@@ -33,5 +33,6 @@ fun stateJson(
           "parentMode": {"active": false, "endsAt": null, "byName": null},
           "pendingRequest": null,
-          "activeSos": null
+          "activeSos": null,
+          "apps": { "newAppApproval": false, "rules": [] }
         }
     """.trimIndent()
```

#### `windows/tests/ScreenTime.Core.Tests/ApiClientTests.cs`

```diff
@@ -126,5 +126,5 @@ public class ApiClientTests
              "schedule":{"version":3,"warn1Min":15,"warn2Min":5,"days":[{"weekday":4,"screensMin":120,"phoneMin":60,"wake":"07:00","bedtime":"21:00"}]},
              "today":{"date":"2026-10-29","grants":[],"poolSegments":[{"id":"s-1","deviceId":"d-1","startedAt":"2026-10-29T07:00:00.000Z","endedAt":null}]},
-             "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"activeSos":null}
+             "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"apps":{"newAppApproval":false,"rules":[]},"activeSos":null}
             """;
         var server = new FakeServer(HttpStatusCode.OK, json, ("ETag", "\"v8\""));
```

#### `windows/tests/ScreenTime.Core.Tests/LocalStoreTests.cs`

```diff
@@ -76,5 +76,6 @@ public sealed class LocalStoreTests : IDisposable
             ParentMode: new DeviceStateParentMode(false, null, null),
             PendingRequest: null,
-            ActiveSos: null);
+            ActiveSos: null,
+            Apps: new DeviceStateApps(false, []));
         store.SaveState(Alex, new CachedState("\"v8\"", state));
```

#### `windows/tests/ScreenTime.Core.Tests/SyncTestData.cs`

```diff
@@ -27,5 +27,5 @@ internal static class SyncTestData
              "schedule":{"version":1,"warn1Min":15,"warn2Min":5,"days":[{{days}}]},
              "today":{"date":"{{date}}","grants":[{{grants}}],"poolSegments":[{{segments}}]},
-             "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"activeSos":null}
+             "parentMode":{"active":false,"endsAt":null,"byName":null},"pendingRequest":null,"apps":{"newAppApproval":false,"rules":[]},"activeSos":null}
             """;
     }
```

The seams of the front end. These are the only changes you make to Claude's files:

#### `android/app-parent/src/main/kotlin/au/screentime/parent/kids/Apps.kt`

```diff
@@ -1,4 +1,7 @@
 package au.screentime.parent.kids
 
+import au.screentime.core.model.api.AppRuleMode
+import au.screentime.core.model.api.AppRulePut
+import au.screentime.core.model.api.AppRulePutMode
 import au.screentime.core.time.formatDuration
 import java.time.Instant
@@ -45,10 +48,4 @@ fun appChoice(app: KidApp): AppChoice = when {
 }
 
-/** The seam: CARD-057 replaces this with the server, in `KidsViewModel` and `InboxViewModel`. */
-internal object FakeAppRules {
-    val rules = mutableMapOf<String, AppRule>()
-    var approval = false
-}
-
 /** Gone from every device. */
 fun isRemoved(app: KidApp): Boolean = app.devices.all { it.removedAt != null }
@@ -124,3 +121,13 @@ fun appRow(app: au.screentime.core.model.api.KidApp): KidApp = KidApp(
     devices = app.devices.map { KidAppDevice(it.deviceName, it.installedAt, it.firstUsedAt, it.removedAt) },
     blockable = app.blockable,
+    rule = when (app.rule?.mode) {
+        AppRuleMode.ALLOWED -> AppRule.ALLOWED
+        AppRuleMode.HELD -> AppRule.HELD
+        AppRuleMode.BLOCKED -> AppRule.BLOCKED
+        null -> null
+    },
 )
+
+/** The server's mode for a rule. A parent cannot hold an app, so HELD is never sent. */
+fun rulePut(rule: AppRule): AppRulePut =
+    AppRulePut(if (rule == AppRule.BLOCKED) AppRulePutMode.BLOCKED else AppRulePutMode.ALLOWED)
```

#### `android/app-parent/src/main/kotlin/au/screentime/parent/kids/AppsScreen.kt`

```diff
@@ -49,5 +49,4 @@ import androidx.compose.ui.unit.dp
 import au.screentime.core.model.api.Kid
 import au.screentime.core.ui.ScreenTimeTheme
-import au.screentime.parent.BuildConfig
 import au.screentime.parent.R
 import au.screentime.parent.today.Problem
@@ -141,8 +140,6 @@ fun AppsScreen(kid: Kid, vm: KidsViewModel, zone: ZoneId, onBack: () -> Unit) {
                         }
                     }
-                    if (APP_RULES_READY) {
-                        item {
-                            ApprovalCard(kid, approval, !busy) { on -> change { vm.saveNewAppApproval(kid.id, on) } }
-                        }
+                    item {
+                        ApprovalCard(kid, approval, !busy) { on -> change { vm.saveNewAppApproval(kid.id, on) } }
                     }
                     if (loaded.isEmpty()) {
@@ -162,5 +159,5 @@ fun AppsScreen(kid: Kid, vm: KidsViewModel, zone: ZoneId, onBack: () -> Unit) {
                         AppRow(app, zone, !busy) { rule -> change { vm.saveAppRule(kid.id, app.packageName, rule) } }
                     }
-                    if (APP_RULES_READY && loaded.isNotEmpty()) {
+                    if (loaded.isNotEmpty()) {
                         item {
                             Text(
@@ -178,7 +175,4 @@ fun AppsScreen(kid: Kid, vm: KidsViewModel, zone: ZoneId, onBack: () -> Unit) {
 }
 
-/** The seam: CARD-057 makes this true. Until then the rules are only shown in debug builds. */
-private val APP_RULES_READY = BuildConfig.DEBUG
-
 /** The "New apps need approval" switch. */
 @Composable
@@ -316,5 +310,5 @@ private fun AppRow(app: KidApp, zone: ZoneId, enabled: Boolean, onRule: (AppRule
             }
         }
-        if (APP_RULES_READY && !removed) {
+        if (!removed) {
             Column(modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
                 RuleControl(app, enabled, onRule)
```

#### `android/app-parent/src/main/kotlin/au/screentime/parent/kids/KidsViewModel.kt`

```diff
@@ -14,4 +14,5 @@ import au.screentime.core.model.api.EnrolmentCode
 import au.screentime.core.model.api.EnrolmentCodeCreate
 import au.screentime.core.model.api.Kid
+import au.screentime.core.model.api.KidAppSettings
 import au.screentime.core.model.api.KidContact
 import au.screentime.core.model.api.Schedule
@@ -123,6 +124,6 @@ class KidsViewModel(app: Application) : AndroidViewModel(app) {
         val deferred = viewModelScope.async {
             try {
-                val apps = session.call { getKidsApps(kidId) }.apps.map(::appRow)
-                Result.success(KidAppsView(FakeAppRules.approval, apps.map { it.copy(rule = FakeAppRules.rules[it.packageName]) }))
+                val apps = session.call { getKidsApps(kidId) }
+                Result.success(KidAppsView(apps.newAppApproval, apps.apps.map(::appRow)))
             } catch (e: CancellationException) {
                 throw e
@@ -134,16 +135,32 @@ class KidsViewModel(app: Application) : AndroidViewModel(app) {
     }
 
-    /** The seam: CARD-057 replaces this with `PUT /v1/kids/{kidId}/apps/{package}/rule`. */
-    @Suppress("UNUSED_PARAMETER", "RedundantSuspendModifier")
+    /** Allow or block an app; a failure is a [Result.failure] with the exception. */
     suspend fun saveAppRule(kidId: String, packageName: String, rule: AppRule): Result<Unit> {
-        FakeAppRules.rules[packageName] = rule
-        return Result.success(Unit)
+        val deferred = viewModelScope.async {
+            try {
+                session.call { putKidsAppsRule(kidId, packageName, rulePut(rule)) }
+                Result.success(Unit)
+            } catch (e: CancellationException) {
+                throw e
+            } catch (e: Exception) {
+                Result.failure(e)
+            }
+        }
+        return deferred.await()
     }
 
-    /** The seam: CARD-057 replaces this with `PUT /v1/kids/{kidId}/app-settings`. */
-    @Suppress("UNUSED_PARAMETER", "RedundantSuspendModifier")
+    /** Turn new app approval on or off; a failure is a [Result.failure] with the exception. */
     suspend fun saveNewAppApproval(kidId: String, on: Boolean): Result<Unit> {
-        FakeAppRules.approval = on
-        return Result.success(Unit)
+        val deferred = viewModelScope.async {
+            try {
+                session.call { putKidsAppSettings(kidId, KidAppSettings(on)) }
+                Result.success(Unit)
+            } catch (e: CancellationException) {
+                throw e
+            } catch (e: Exception) {
+                Result.failure(e)
+            }
+        }
+        return deferred.await()
     }
```

#### `android/app-parent/src/main/kotlin/au/screentime/parent/inbox/InboxScreen.kt`

```diff
@@ -54,5 +54,4 @@ import au.screentime.core.time.formatDuration
 import au.screentime.core.ui.AvatarColors
 import au.screentime.core.ui.ScreenTimeTheme
-import au.screentime.parent.BuildConfig
 import au.screentime.parent.kids.AppRule
 import au.screentime.parent.R
@@ -117,6 +116,5 @@ fun InboxScreen(vm: InboxViewModel, zone: ZoneId) {
                         }
                     }
-                    // Debug builds only until CARD-057 connects the server.
-                    val approvals = if (BuildConfig.DEBUG) pendingAppApprovals(state.events) else emptyList()
+                    val approvals = pendingAppApprovals(state.events)
                     if (state.requests.isNotEmpty() || approvals.isNotEmpty()) {
                         item {
```

#### `android/app-parent/src/main/kotlin/au/screentime/parent/inbox/InboxViewModel.kt`

```diff
@@ -13,5 +13,5 @@ import au.screentime.core.model.api.TimeRequestApprove
 import au.screentime.core.model.api.TimeRequestStatus
 import au.screentime.parent.kids.AppRule
-import au.screentime.parent.kids.FakeAppRules
+import au.screentime.parent.kids.rulePut
 import au.screentime.parent.ParentApp
 import au.screentime.parent.auth.SignedOutException
@@ -69,11 +69,9 @@ class InboxViewModel(app: Application) : AndroidViewModel(app) {
     }
 
-    /**
-     * Answer a new app that waits for a parent. The seam: CARD-057 replaces the fake with
-     * `PUT /v1/kids/{kidId}/apps/{package}/rule`.
-     */
+    /** Answer a new app that waits for a parent. */
     suspend fun answerApp(e: EventItem, rule: AppRule) {
         val packageName = approvalPackage(e) ?: return
-        answer { FakeAppRules.rules[packageName] = rule }
+        val kidId = e.kidId ?: return
+        answer { session.call { putKidsAppsRule(kidId, packageName, rulePut(rule)) } }
     }
```

#### `web/src/components/apps-panel.tsx`

```diff
@@ -6,5 +6,4 @@ import { Switch } from '@/components/ui/switch';
 import { ApiError } from '@/lib/api';
 import {
-  APP_RULES_READY,
   type AppChoice,
   appChoice,
@@ -106,5 +105,5 @@ function AppRow({ app, kidId, timeZone }: { app: KidApp; kidId: string; timeZone
           <p className="text-sm text-muted">{firstUsedLine(app, timeZone)}</p>
         </div>
-        {APP_RULES_READY && !removed && <RuleControl app={app} choice={appChoice(app)} kidId={kidId} />}
+        {!removed && <RuleControl app={app} choice={appChoice(app)} kidId={kidId} />}
       </div>
       {removed ? (
@@ -148,27 +147,25 @@ export function AppsPanel({ kidId, kidName }: { kidId: string; kidName: string }
   return (
     <div className="flex flex-col gap-4">
-      {APP_RULES_READY && (
-        <Card>
-          <CardContent className="flex items-center gap-4">
-            <div className="min-w-0 flex-1">
-              <label htmlFor="new-app-approval" className="font-medium">
-                New apps need approval
-              </label>
-              <p className="text-sm text-muted">A new app on {kidName}'s device stays blocked until a parent says yes.</p>
-              {approval.error && (
-                <p role="alert" className="mt-1 text-sm text-danger">
-                  {messageOf(approval.error)}
-                </p>
-              )}
-            </div>
-            <Switch
-              id="new-app-approval"
-              checked={apps.data.newAppApproval}
-              disabled={approval.isPending}
-              onCheckedChange={(on) => approval.mutate(on)}
-            />
-          </CardContent>
-        </Card>
-      )}
+      <Card>
+        <CardContent className="flex items-center gap-4">
+          <div className="min-w-0 flex-1">
+            <label htmlFor="new-app-approval" className="font-medium">
+              New apps need approval
+            </label>
+            <p className="text-sm text-muted">A new app on {kidName}'s device stays blocked until a parent says yes.</p>
+            {approval.error && (
+              <p role="alert" className="mt-1 text-sm text-danger">
+                {messageOf(approval.error)}
+              </p>
+            )}
+          </div>
+          <Switch
+            id="new-app-approval"
+            checked={apps.data.newAppApproval}
+            disabled={approval.isPending}
+            onCheckedChange={(on) => approval.mutate(on)}
+          />
+        </CardContent>
+      </Card>
       <Card>
         <CardHeader>
@@ -189,5 +186,5 @@ export function AppsPanel({ kidId, kidName }: { kidId: string; kidName: string }
             </ul>
           )}
-          {APP_RULES_READY && apps.data.apps.length > 0 && (
+          {apps.data.apps.length > 0 && (
             <p className="mt-4 border-t border-outline pt-4 text-sm text-muted">
               Blocking an app does not block its website. To stop YouTube in a browser, block the browsers too.
```

#### `web/src/lib/apps.ts`

```diff
@@ -1,41 +1,19 @@
-import type { KidApp as ServerApp, KidAppDevice, KidApps as ServerApps } from '@screentime/schemas';
+import type { KidApp, KidAppDevice, KidApps } from '@screentime/schemas';
 import { api } from '@/lib/auth';
 import { formatDuration } from '@/lib/format';
 
-export type { KidAppDevice };
-
-/** A parent's rule for an app (docs/SPEC.md §12.4). `held` is written by the server while a new app waits. */
-export type AppRuleMode = 'allowed' | 'held' | 'blocked';
-
-export type KidApp = ServerApp & { rule: { mode: AppRuleMode } | null };
-
-export interface KidApps {
-  newAppApproval: boolean;
-  apps: KidApp[];
-}
-
-/** The seam: CARD-057 replaces this, and the three functions below, with the server. */
-export const APP_RULES_READY = import.meta.env.DEV;
-const fakeRules = new Map<string, AppRuleMode>();
-let fakeApproval = false;
+export type { KidApp, KidAppDevice, KidApps };
 
 /** GET /v1/kids/{kidId}/apps (docs/SPEC.md §12.4). */
-export async function fetchKidApps(kidId: string): Promise<KidApps> {
-  const server = await api.get<ServerApps>(`/v1/kids/${kidId}/apps`);
-  return {
-    newAppApproval: fakeApproval,
-    apps: server.apps.map((a) => {
-      const mode = fakeRules.get(a.package);
-      return { ...a, rule: mode ? { mode } : null };
-    }),
-  };
+export function fetchKidApps(kidId: string): Promise<KidApps> {
+  return api.get<KidApps>(`/v1/kids/${kidId}/apps`);
 }
 
-export async function saveAppRule(_kidId: string, pkg: string, mode: 'allowed' | 'blocked'): Promise<void> {
-  fakeRules.set(pkg, mode);
+export async function saveAppRule(kidId: string, pkg: string, mode: 'allowed' | 'blocked'): Promise<void> {
+  await api.put(`/v1/kids/${kidId}/apps/${encodeURIComponent(pkg)}/rule`, { mode });
 }
 
-export async function saveNewAppApproval(_kidId: string, on: boolean): Promise<void> {
-  fakeApproval = on;
+export async function saveNewAppApproval(kidId: string, on: boolean): Promise<void> {
+  await api.put(`/v1/kids/${kidId}/app-settings`, { newAppApproval: on });
 }
```

#### `web/src/lib/settings.ts`

```diff
@@ -2,5 +2,5 @@ import type { NotificationKind } from '@screentime/schemas';
 
 /** What each notification switch means, in the words of docs/SPEC.md §13. The server sends the order. */
-export const NOTIFICATION_TEXT: Record<NotificationKind | 'app.approval', { title: string; detail: string }> = {
+export const NOTIFICATION_TEXT: Record<NotificationKind, { title: string; detail: string }> = {
   sos: { title: 'SOS', detail: 'When a kid presses SOS on their phone, and every update after.' },
   'parent_mode.request': { title: 'Parent mode requests', detail: 'When a kid asks a parent to unlock a device.' },
```

#### `web/src/pages/inbox.tsx`

```diff
@@ -9,5 +9,5 @@ import { Card, CardContent } from '@/components/ui/card';
 import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
 import { ApiError } from '@/lib/api';
-import { APP_RULES_READY, saveAppRule } from '@/lib/apps';
+import { saveAppRule } from '@/lib/apps';
 import { api, useAuth } from '@/lib/auth';
 import { formatDuration } from '@/lib/format';
@@ -298,5 +298,5 @@ export function InboxPage() {
   const all = events.data?.pages.flatMap((p) => p.events) ?? [];
   const parentMode = pendingParentModeRequests(all, now);
-  const approvals = APP_RULES_READY ? pendingAppApprovals(all) : [];
+  const approvals = pendingAppApprovals(all);
   const waiting = (requests.data?.length ?? 0) + parentMode.length + approvals.length;
```

### 5.4 The migration

After the `server/src/db/schema.ts` change, generate it from the repo root:

```powershell
pnpm --filter @screentime/schemas build
pnpm --filter @screentime/server exec drizzle-kit generate --name app_rules
```

That makes `server/drizzle/0006_app_rules.sql`, `server/drizzle/meta/0006_snapshot.json` and a new line in `server/drizzle/meta/_journal.json`. drizzle-kit does not write row-level security, so add these lines to the end of `0006_app_rules.sql`:

```sql
--> statement-breakpoint
ALTER TABLE app_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON app_rules
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
```

### 5.5 The generated files

After the schema and route changes, run `pnpm contract` from the repo root. It rewrites `contract/openapi.json`, `android/core-model/.../ApiClient.kt` and `ApiModels.kt`, and `windows/src/ScreenTime.Core/Api/ApiClient.g.cs` and `ApiModels.g.cs`. Commit them as they come, and never edit them by hand.

### 5.6 The run script

`docs/cards/CARD-057-run.ps1` is already in the repo. Do not change it. Do not copy it anywhere.

## 6. Detailed spec

This is what the code above does, for your review and for the PR. `docs/SPEC.md` §12.4 is the full version.

- **Rules** are per kid: `allowed`, `held` or `blocked`, with no row meaning allowed. `PUT /v1/kids/{kidId}/apps/{package}/rule` takes `allowed` or `blocked`. An app on none of the kid's devices gets 404, and one a device says cannot be blocked gets 409. Answering a `held` app writes the history event `app.answered` with payload `{ package, label, approved, byName }`.
- **The switch:** `PUT /v1/kids/{kidId}/app-settings` with `{ newAppApproval }`. Apps already waiting keep waiting when it is turned off.
- **The snapshot** gets `apps: { newAppApproval, rules: [{ package, mode }] }`. It is empty on a PC.
- **A new app with approval on:** the server writes a `held` rule and the essential `app.approval` instead of `app.installed`. The first list of a device is still its baseline, and an app that already has a rule is not held again.
- **On the device,** after every run of the engine: work out what should be blocked, ask Android what is, and fix the difference. It suspends first, and hides what Android refuses. It holds a new app itself at once, with no server needed, until a rule arrives. Parent mode releases everything. Whatever the snapshot says, it never blocks our app, Play services, Settings, the launcher, the phone apps or the default SMS app.
- **The dialog:** `setShortSupportMessage` gives the second line, "Ask Mum or Dad about this app." Android keeps its own title, "Blocked by work policy".
- **Android 15 and later:** `DISALLOW_ADD_PRIVATE_PROFILE` stops a private space, where apps could not be listed or blocked.

## 7. Steps

1. Start the branch (section 10).
2. Create the files of 5.1 and 5.2, and make the changes of 5.3.
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
dotnet test windows\tests\ScreenTime.Core.Tests
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git grep -l 'Â' -- packages server/src server/scripts server/test android/app-kid/src android/app-parent/src web/src windows/tests
```

- [ ] `pnpm typecheck` and `pnpm build` pass. An error that `screentime_test` already exists is fine.
- [ ] `pnpm test` passes. In the rehearsal the server had 248 passed, with 10 in `test/app-rules.test.ts`, and the web had 66.
- [ ] `dotnet test` says `Test run summary: Passed!`. In the rehearsal: 270.
- [ ] `.\gradlew.bat assembleDebug test` says `BUILD SUCCESSFUL`, with `AppBlocksTest` at 11 tests. Check with `Select-String 'tests="' android\app-kid\build\test-results\testDebugUnitTest\TEST-au.screentime.kid.apps.AppBlocksTest.xml`.
- [ ] The last `git grep` prints nothing. If it prints a file, you saved it in the wrong encoding: save it again as UTF-8 without a BOM.

### 8.2 On the emulator

Close what you can first, and stop any emulator still running: **the emulator freezes when the PC runs out of memory** (`adb` then hangs with no error), and timing checks can fail when it is merely slow. If that happens, stop the run with Ctrl+C, close other programs, and run it again. A rerun starts clean. Say so under Deviations, with the failures you saw.

From the repo root, in `pwsh`:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
pwsh -File docs\cards\CARD-057-run.ps1 2>&1 | Tee-Object -FilePath ..\temp\card057-out.txt
```

It takes about 7 minutes. It **wipes the emulator and the development database, and replaces `deploy\.env` with throwaway values**. It needs the debug APKs from 8.1. It stops the emulator at the end.

- [ ] The last line is `--- Finished with 0 failed.`, and no line starts with `FAIL`.
- [ ] Paste **all** of `..\temp\card057-out.txt` into the handback. A summary counts as `NOT RUN`.
- [ ] Say what you see in `..\temp\card057-dialog.png` (the blocked dialog), `..\temp\card057-apps.png` (the Apps page) and `..\temp\card057-inbox.png` (the inbox).

Not tested on the emulator: a real Play Store install, a real push to the device (the run makes the device sync by turning the screen off), and app updates while the Play Store is hidden. Do not try to sign in to Google. James tries these on a real device in the rollout.

### 8.3 What Claude saw

The same steps with the same code, in full. Times and ids will differ.

```text
--- 1. A wiped emulator
PASS no Screen Time app on the emulator
--- 2. A fresh server
Seeded family 01a1a9b1-3a13-740f-a55b-88b800fd36e4 with parent dad@example.com and kids Alex and Sam.
--- 3. Install, Device Owner, usage access, enrol
Success
  try 1: java.lang.IllegalStateException: Not allowed to set the device owner because there are already some accounts on the device.
  Device Owner on try 2
  seen after 1 s: com.android.settings
PASS the list reached the server
--- 4. Block Chrome: it will not open, and it stays on the list
rule com.android.chrome blocked: 200
  com.android.chrome after 0 s: hidden=false suspended=true
PASS Chrome is suspended
  11-05 14:12:51.595  4420  4885 I KidService: apps: blocked [com.android.chrome] (hidden [])
  top: com.android.settings/.enterprise.ActionDisabledByAdminDialog
  dialog: Blocked by work policy | Ask Mum or Dad about this app. | Close
PASS Chrome did not open
PASS the dialog names the parents
PASS Chrome is still listed, not removed
PASS blocking raised no install alert
--- 5. Allow it again
rule com.android.chrome allowed: 200
  com.android.chrome after 0 s: hidden=false suspended=false
PASS Chrome is free
  top: com.android.chrome/org.chromium.chrome.browser.firstrun.FirstRunActivity
PASS Chrome opens
--- 6. An app in front closes when it is blocked
PASS Clock is in front
rule com.google.android.deskclock blocked: 200
  com.google.android.deskclock after 0 s: hidden=false suspended=true
PASS Clock is suspended
  top: com.android.settings/.enterprise.ActionDisabledByAdminDialog
PASS Clock did not open
rule com.google.android.deskclock allowed: 200
  com.google.android.deskclock after 0 s: hidden=false suspended=false
PASS Clock is free
--- 7. The Play Store is hidden instead, and stays on the list
rule com.android.vending blocked: 200
  com.android.vending after 0 s: hidden=true suspended=false
PASS Play Store is hidden
  11-05 14:13:53.372  4420  4886 I KidService: apps: blocked [com.android.vending] (hidden [com.android.vending])
PASS Play Store has nothing to open
PASS market links stop working
  com.android.vending | Google Play Store | preinstalled | installer=null | blockable=true | baseline=true | used=- | removed=-
PASS Play Store is still listed, not removed
PASS Play services still work: not suspended
--- 8. What the device needs cannot be blocked
  rule com.android.settings blocked: 409
PASS the server refuses Settings
  rule com.google.android.dialer blocked: 409
PASS the server refuses the phone app
PASS the server has no rule for them
--- 9. Parent mode releases blocks, and its end brings them back
rule com.android.chrome blocked: 200
  com.android.chrome after 0 s: hidden=false suspended=true
PASS Chrome is suspended
Warning: Activity not started, its current task has been brought to the front
Dad turned parent mode on for Alex until a parent ends it.
  com.android.chrome after 0 s: hidden=false suspended=false
PASS parent mode releases Chrome
  com.android.vending after 0 s: hidden=false suspended=false
PASS parent mode releases the Play Store
Dad ended parent mode on Alex's device.
  com.android.chrome after 2 s: hidden=false suspended=true
PASS the end of parent mode blocks Chrome again
  com.android.vending after 0 s: hidden=true suspended=false
PASS the end of parent mode hides the Play Store again
--- 10. New app approval: held at once, then answered
approval on : 204
Success
  au.screentime.parent after 2 s: hidden=false suspended=true
PASS the new app is suspended
  seen after 1 s: app.approval | au.screentime.parent |
PASS the parent is asked
PASS the server holds it
PASS no plain install alert
  11-05 14:14:44.913  4420  4883 I KidService: apps: blocked [au.screentime.parent, com.android.chrome, com.android.vending] (hidden [com.android.vending])
rule au.screentime.parent allowed: 200
  au.screentime.parent after 0 s: hidden=false suspended=false
PASS Allow releases it
  seen after 1 s: app.answered | au.screentime.parent |
PASS the answer is in the history
--- 11. A rule outlives a reinstall
rule au.screentime.parent blocked: 200
  au.screentime.parent after 0 s: hidden=false suspended=true
PASS blocked
Success
Success
  au.screentime.parent after 2 s: hidden=false suspended=true
PASS blocked again after the reinstall
rule au.screentime.parent allowed: 200
  au.screentime.parent after 0 s: hidden=false suspended=false
PASS free
--- 12. Held while offline, then told to the server
Success
Success
  an app with an allowed rule, offline: hidden=false suspended=false
PASS an allowed app is not held
Success
Success
  au.screentime.parent after 2 s: hidden=false suspended=true
PASS offline with no rule: held by the device
  seen after 1 s: rule au.screentime.parent held
PASS back online: the parent is asked again
--- 13. The parent app shows and sets it
rule com.android.chrome allowed: 200
rule com.android.vending allowed: 200
rule au.screentime.parent allowed: 200
approval off : 204
  au.screentime.parent after 0 s: hidden=false suspended=false
PASS the parent app is free to open
  com.android.vending after 0 s: hidden=false suspended=false
PASS the Play Store is back
  Alex's apps | New apps need approval | A new app on Alex's device stays blocked until a parent says yes. | S | ST Parent | Installed another way · 5 Nov on Google sdk_gphone64_x86_64 | First used 5 Nov | Blocked | Allowed | C | Calendar | Came with Google sdk_gphone64_x86_64 | Never opened | Blocked | Allowed | C | Camera | Came with Google sdk_gphone64_x86_64 | Never opened | Blocked | Allowed | C | Chrome | Came with Google sdk_gphone64_x86_64 | First used 5 Nov | Blocked | Allowed | Today | Inbox | Kids | Settings
PASS the page has the switch and the choice
  Inbox | History | Today | 📱 | Alex opened ST Parent for the first time | On Google sdk_gphone64_x86_64 | 2:16 pm | 📱 | Dad allowed ST Parent for Alex | 2:16 pm | 📱 | Alex installed ST Parent | Installed another way on Google sdk_gphone64_x86_64 | 2:16 pm | 📱 | Alex installed ST Parent | Installed another way on Google sdk_gphone64_x86_64 | 2:15 pm | 📱 | Dad allowed ST Parent for Alex | 2:14 pm | 📱 | Alex installed ST Parent | Installed another way on Google sdk_gphone64_x86_64 | 2:14 pm | 📱 | Parent mode ended on Google sdk_gphone64_x86_64 | Ended by Dad | 2:14 pm | 📱 | Parent mode on Google sdk_gphone64_x86_64 until ended | 2:14 pm | Today | Inbox | Kids | Settings
PASS the history says who answered
--- Finished with 0 failed.
```

### 8.4 CI

- [ ] On the PR, every check is green.

## 9. Tests

- `server/test/app-rules.test.ts` (10 tests): block and allow, what a parent cannot do, the snapshot and its version, a PC's empty part, telling the devices, approval off, approval on with the essential alert, rules surviving a reinstall, `app.answered` once, and turning approval off.
- `android/app-kid/.../apps/AppBlocksTest.kt` (11 tests): which apps are wanted blocked, what is never blocked, parent mode, the plan, and when the device holds an app itself.
- `web/test/apps.test.ts`, `android/app-parent/.../kids/AppsTest.kt` and `.../inbox/InboxTest.kt` are already in the repo from PR #157 and must pass unchanged.
- The other test files in 5.3 change only by the counts, the table name and the fixtures shown.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-057-blocking
   ```
2. Commit in small logical commits. Message format: `CARD-057: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes.
4. Push: `git push -u origin bob/card-057-blocking`
5. Open a PR into `main` titled `CARD-057: Blocking apps and new app approval` with this body, written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-057-blocking.md

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
Claude, here is Bob's handback for CARD-057. Please review and merge if it is good.

CARD: CARD-057 Blocking apps and new app approval
PR: <full PR URL>
Branch: bob/card-057-blocking
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- pnpm typecheck -> <key lines, or NOT RUN: reason>
- pnpm test -> <test counts per package, or NOT RUN: reason>
- dotnet test windows\tests\ScreenTime.Core.Tests -> <summary, or NOT RUN: reason>
- .\gradlew.bat assembleDebug test -> <result and the AppBlocksTest line, or NOT RUN: reason>
- git grep for mangled characters -> <output, or NOT RUN: reason>
- pwsh -File docs\cards\CARD-057-run.ps1 -> <ALL of ..\temp\card057-out.txt, or NOT RUN: reason>
- The three screenshots -> <what each one shows, or NOT RUN: reason>
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
