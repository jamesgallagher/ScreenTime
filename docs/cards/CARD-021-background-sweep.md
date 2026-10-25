# CARD-021: Background sweep

| Field | Value |
|---|---|
| Card | CARD-021 |
| Title | Background sweep |
| Size | S |
| Depends on | CARD-020 (merged to `main`) |
| Spec sections | docs/SPEC.md §4 (tech), §8.5, §13, §15 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-021-background-sweep` |
| PR title | `CARD-021: Background sweep` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app. `server/src/index.ts` starts it: it loads the config, runs migrations, builds the app with `createApp(deps)` and listens. Every family query runs inside `withFamily` (row-level security). `notifyParents(deps, familyId, eventIds)` (`server/src/notify/dispatch.ts`) pushes committed events to the parent apps.

Two things happen on their own, with no request to trigger them:

1. **SOS auto stop** (SPEC §15): an SOS stops 2 hours after it starts (plus 2 hours per extend). The API already shows it as ended by `auto` once `auto_stop_at` has passed (CARD-020), but nobody stores that or tells the parents.
2. **Device offline** (SPEC §8.5): a kid device not seen for 6 hours during allowed hours should be reported to the parents as `device.offline`.

This card adds a **sweep**: one function that does both for every family, run by a timer once a minute inside the server process. There is one server process (Docker on James's Unraid), so there is no job queue and no lock: a pass that is still running when the next one is due is simply skipped. Time requests and parent-mode requests already expire when they are read (CARD-018, CARD-019), so they need no job.

## 2. Goal

`sweep(deps)` stores ran-out SOS alerts as ended by `auto` and writes `device.offline` once per absence, each with a push to the parents; `startSweeps(deps)` runs it once a minute from `server/src/index.ts`. Tested against PostgreSQL 18.

## 3. Out of scope

Do **not** do any of these in this card:

- No new npm packages (no pg-boss, no cron library) and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay unchanged.
- No new routes, no schema change in `packages/schemas`, and the contract stays the same.
- No change to the database schema or migrations. Do not change `server/src/db/` or anything in `server/drizzle/`.
- No message to the phone when its SOS runs out (it stops sharing by itself).
- Do not change any file that is not listed in section 5. `docs/SPEC.md` and `docs/BUILD-PLAN.md` were already updated by Claude.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key, a Firebase key, an FCM token or a device token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, hono ^4.13.13, drizzle-orm ^0.45.4, PostgreSQL 18. Nothing new to install. The timer is Node's own `setInterval`.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error.

| File | Action |
|---|---|
| `server/src/jobs/sweep.ts` | create (5.1) |
| `server/src/index.ts` | replace (5.2) |
| `server/test/jobs.test.ts` | create (5.3) |

That is 3 files.

### 5.1 `server/src/jobs/sweep.ts`

`sweep` goes over every family that is not disabled, one transaction each, then pushes. `startSweeps` runs it on a timer and returns a stop function.

```typescript
import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { AppDeps } from '../app.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, families, kids, scheduleVersions, sosIncidents } from '../db/schema.js';
import { familyToday } from '../grants/routes.js';
import { toSchedule } from '../kids/routes.js';
import { notifyParents } from '../notify/dispatch.js';
import { scheduleDay } from '../sync/day.js';

/** A device not seen for this long during allowed hours is reported (docs/SPEC.md §8.4, §14). */
const OFFLINE_AFTER = sql`interval '6 hours'`;

export interface SweepResult {
  /** SOS alerts that ran out and were marked ended by `auto`. */
  sosStopped: number;
  /** New `device.offline` events. */
  offline: number;
}

/**
 * Ends every SOS whose auto stop has passed: `ended_at` = `auto_stop_at`, `ended_by_kind` = `auto`, and a
 * `sos.ended` event. The phone stops sharing by itself at that time, so nothing is sent to it.
 */
async function stopExpiredSos(tx: FamilyTx, familyId: string) {
  const stopped = await tx
    .update(sosIncidents)
    .set({ endedAt: sql`${sosIncidents.autoStopAt}`, endedByKind: 'auto' })
    .where(and(isNull(sosIncidents.endedAt), sql`${sosIncidents.autoStopAt} <= now()`))
    .returning({ id: sosIncidents.id, kidId: sosIncidents.kidId, deviceId: sosIncidents.deviceId });
  if (stopped.length === 0) return [];
  return tx
    .insert(events)
    .values(
      stopped.map((s) => ({
        familyId,
        kidId: s.kidId,
        deviceId: s.deviceId,
        kind: 'sos.ended',
        at: sql`now()`,
        payload: { sosId: s.id, endedBy: 'auto', byName: null },
      })),
    )
    .returning({ id: events.id });
}

/**
 * Writes `device.offline` for each device that has not been seen for 6 hours, when all of those 6 hours fall
 * in today's allowed hours of its kid (from wake-up to bedtime). A device that is off overnight is not
 * reported in the morning. One event per absence: the payload keeps the `lastSeenAt` it was about.
 */
async function reportOfflineDevices(tx: FamilyTx, familyId: string) {
  const { timezone, day } = await familyToday(tx, familyId);
  const quiet = await tx
    .select({ id: devices.id, kidId: devices.kidId, name: devices.name, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .innerJoin(kids, eq(kids.id, devices.kidId))
    .where(
      and(
        isNull(devices.revokedAt),
        isNull(kids.archivedAt),
        isNotNull(devices.lastSeenAt),
        lt(devices.lastSeenAt, sql`now() - ${OFFLINE_AFTER}`),
      ),
    );
  const ids: { id: string }[] = [];
  for (const device of quiet) {
    const lastSeenAt = device.lastSeenAt?.toISOString();
    if (!lastSeenAt) continue;
    const [reported] = await tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.deviceId, device.id),
          eq(events.kind, 'device.offline'),
          sql`${events.payload} ->> 'lastSeenAt' = ${lastSeenAt}`,
        ),
      )
      .limit(1);
    if (reported) continue;

    const [scheduleRow] = await tx
      .select()
      .from(scheduleVersions)
      .where(eq(scheduleVersions.kidId, device.kidId))
      .orderBy(desc(scheduleVersions.version))
      .limit(1);
    if (!scheduleRow) throw new Error(`kid ${device.kidId} has no schedule`);
    const entry = scheduleDay(toSchedule(scheduleRow), day.date);
    // `24:00` is a valid time in PostgreSQL: the next midnight.
    const window = await tx.execute<{ allowed: boolean }>(sql`
      select now() - ${OFFLINE_AFTER} >= (${day.date}::date + ${entry.wake}::time) at time zone ${timezone}
         and now() < (${day.date}::date + ${entry.bedtime}::time) at time zone ${timezone} as allowed
    `);
    if (!window.rows[0]?.allowed) continue;

    const [event] = await tx
      .insert(events)
      .values({
        familyId,
        kidId: device.kidId,
        deviceId: device.id,
        kind: 'device.offline',
        at: sql`now()`,
        payload: { lastSeenAt, deviceName: device.name },
      })
      .returning({ id: events.id });
    if (event) ids.push(event);
  }
  return ids;
}

/** One pass over every family that is not disabled. Pushes go out after each family's transaction commits. */
export async function sweep(deps: AppDeps): Promise<SweepResult> {
  const result: SweepResult = { sosStopped: 0, offline: 0 };
  const rows = await deps.db.select({ id: families.id }).from(families).where(isNull(families.disabledAt));
  for (const { id: familyId } of rows) {
    const found = await withFamily(deps.db, familyId, async (tx) => ({
      sos: await stopExpiredSos(tx, familyId),
      offline: await reportOfflineDevices(tx, familyId),
    }));
    result.sosStopped += found.sos.length;
    result.offline += found.offline.length;
    await notifyParents(deps, familyId, [...found.sos, ...found.offline].map((e) => e.id));
  }
  return result;
}

/**
 * Runs `sweep` every `everyMs` (one minute by default) in this process. A pass that is still running when
 * the next is due is not doubled up. A failed pass is logged and the next one tries again. Returns a stop function.
 */
export function startSweeps(deps: AppDeps, everyMs = 60_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweep(deps);
    } catch (err) {
      console.error('background sweep failed', err);
    } finally {
      running = false;
    }
  }, everyMs);
  // The timer alone does not keep the process alive.
  timer.unref();
  return () => clearInterval(timer);
}
```

### 5.2 `server/src/index.ts`

The same as before, except that the app's dependencies are kept in `deps` and, at the end, `startSweeps` is started with them and the app's device hub.

```typescript
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { startSweeps } from './jobs/sweep.js';
import { createMailer } from './mailer.js';
import { createPusher } from './push.js';

const config = loadConfig();
const { db } = createDb(config.databaseUrl);

await runMigrations(db);
console.log('database migrations applied');
if (!config.smtp) {
  console.log('SMTP is not configured: sign-in codes are written to this log instead of emailed');
}

if (!config.firebaseServiceAccountJson) {
  console.log('Firebase is not configured: no push notifications are sent');
}

const deps = {
  db,
  config,
  mailer: createMailer(config.smtp),
  pusher: createPusher(config.firebaseServiceAccountJson),
};
const app = createApp(deps);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`screentime-server listening on http://localhost:${info.port}`);
});
// Lets GET /v1/device/ws upgrade to a WebSocket (docs/SPEC.md §8.3).
app.injectWebSocket(server);
// SOS auto stop and offline devices, once a minute (docs/SPEC.md §8.4, §15). The jobs share the app's device hub.
startSweeps({ ...deps, hub: app.hub });
```

### 5.3 `server/test/jobs.test.ts`

Calls `sweep` directly. Family A's time zone is a fixed offset in which it is always between 12:00 and 13:00 while the test runs, so the wake-up and bedtime cases do not depend on the hour.

```typescript
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import {
  devices,
  events,
  families,
  kids,
  notificationPrefs,
  parentSessions,
  parents,
  scheduleVersions,
  sosIncidents,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import { startSweeps, sweep } from '../src/jobs/sweep.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { resetDatabase, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** A fixed-offset zone where it is now between 12:00 and 13:00, so the hours below are always the same. */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

const week = (wake: string, bedtime: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, screensMin: 120, phoneMin: 60, wake, bedtime }));

describe.skipIf(!url)('background sweeps', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };

  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const deps = { db, config: testConfig(url ?? ''), mailer, pusher };
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  let familyA = '';
  let dadId = '';
  const phone = { id: '', kidId: '' };
  const tablet = { id: '', kidId: '' };
  const lateRiser = { id: '', kidId: '' };
  const earlyBed = { id: '', kidId: '' };
  const revoked = { id: '', kidId: '' };
  const disabledFamily = { id: '', kidId: '' };

  async function addKid(familyId: string, name: string, days: ReturnType<typeof week>) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'tablet' | 'phone', name: string) {
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(newDeviceToken()),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, kidId };
  }

  /** Sets when the device was last seen, `hours` ago (null: never). */
  async function lastSeen(device: { id: string }, hours: number | null) {
    await db
      .update(devices)
      .set({ lastSeenAt: hours === null ? null : sql`now() - make_interval(mins => ${Math.round(hours * 60)})` })
      .where(eq(devices.id, device.id));
  }

  /** An SOS from the phone that started `startedMinAgo` minutes ago and stops by itself `autoStopMin` minutes from now. */
  async function addSos(startedMinAgo: number, autoStopMin: number, endedByKid = false) {
    const id = randomUUID();
    await db.insert(sosIncidents).values({
      id,
      familyId: familyA,
      kidId: phone.kidId,
      deviceId: phone.id,
      startedAt: sql`now() - make_interval(mins => ${startedMinAgo})`,
      autoStopAt: sql`now() + make_interval(mins => ${autoStopMin})`,
      endedAt: endedByKid ? sql`now()` : null,
      endedByKind: endedByKid ? 'kid' : null,
    });
    return id;
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const zone = middayZone();
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: zone, parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: zone, parentCodeSecret: 'B'.repeat(32), disabledAt: new Date() },
      ])
      .returning();
    familyA = a?.id ?? '';
    const [mum, dad] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
      ])
      .returning();
    dadId = dad?.id ?? '';
    for (const [parentId, fcmToken] of [
      [mum?.id ?? '', 'fcm-mum'],
      [dadId, 'fcm-dad'],
    ]) {
      await db
        .insert(parentSessions)
        .values({ familyId: familyA, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken });
    }

    const alex = await addKid(familyA, 'Alex', week('00:00', '24:00'));
    Object.assign(phone, await addDevice(familyA, alex, 'phone', 'Pixel 7'));
    Object.assign(tablet, await addDevice(familyA, alex, 'tablet', 'Tablet'));
    Object.assign(revoked, await addDevice(familyA, alex, 'tablet', 'Old tablet'));
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, revoked.id));
    // Up at 9: at about 12:30 the last 6 hours started before wake-up.
    Object.assign(lateRiser, await addDevice(familyA, await addKid(familyA, 'Sam', week('09:00', '24:00')), 'phone', 'Sam phone'));
    // In bed at 11: it is past bedtime now.
    Object.assign(earlyBed, await addDevice(familyA, await addKid(familyA, 'Kim', week('00:00', '11:00')), 'tablet', 'Kim tablet'));
    Object.assign(disabledFamily, await addDevice(b?.id ?? '', await addKid(b?.id ?? '', 'Ben', week('00:00', '24:00')), 'phone', 'Ben phone'));
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(events);
    await db.delete(sosIncidents);
    await db.update(devices).set({ lastSeenAt: sql`now()` });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('SOS auto stop', () => {
    it('ends an SOS that ran out, once, and tells the parents', async () => {
      const ranOut = await addSos(180, -60);
      const running = await addSos(10, 110);
      const safe = await addSos(30, 90, true);

      expect(await sweep(deps)).toEqual({ sosStopped: 1, offline: 0 });
      const [row] = await db.select().from(sosIncidents).where(eq(sosIncidents.id, ranOut));
      expect(row?.endedByKind).toBe('auto');
      expect(row?.endedAt?.getTime()).toBe(row?.autoStopAt.getTime());
      const others = await db.select().from(sosIncidents).where(sql`${sosIncidents.id} in (${running}, ${safe})`);
      expect(others.map((s) => s.endedByKind).sort()).toEqual(['kid', null]);

      const [event] = await db.select().from(events);
      expect(event).toMatchObject({ kind: 'sos.ended', deviceId: phone.id, payload: { sosId: ranOut, endedBy: 'auto', byName: null } });
      for (const token of ['fcm-mum', 'fcm-dad']) {
        expect(sentTo(token).map((m) => ({ high: m.high, type: m.msg.type }))).toEqual([{ high: true, type: 'sos' }]);
      }

      sent.length = 0;
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 0 });
      expect(sent).toHaveLength(0);
    });
  });

  describe('device offline', () => {
    it('reports a device silent for 6 hours of allowed time, once per absence', async () => {
      await lastSeen(phone, 7);
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 1 });
      const [device] = await db.select().from(devices).where(eq(devices.id, phone.id));
      const [event] = await db.select().from(events);
      expect(event).toMatchObject({
        kind: 'device.offline',
        kidId: phone.kidId,
        deviceId: phone.id,
        payload: { lastSeenAt: device?.lastSeenAt?.toISOString(), deviceName: 'Pixel 7' },
      });
      const [push] = sentTo('fcm-mum');
      expect(push?.high).toBe(false);
      expect(push?.msg).toMatchObject({ type: 'device.offline', data: { kind: 'device.offline', deviceName: 'Pixel 7' } });

      // Still silent: nothing new.
      sent.length = 0;
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 0 });
      expect(sent).toHaveLength(0);

      // Back for a moment, then silent again: a new absence.
      await lastSeen(phone, 6.5);
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 1 });
      expect(await db.select().from(events).where(eq(events.kind, 'device.offline'))).toHaveLength(2);
    });

    it('leaves out devices seen lately or never, revoked ones, curfew hours and disabled families', async () => {
      await lastSeen(tablet, 5.5);
      await lastSeen(phone, null);
      await lastSeen(revoked, 8);
      await lastSeen(lateRiser, 8);
      await lastSeen(earlyBed, 8);
      await lastSeen(disabledFamily, 8);
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 0 });
      expect(await db.select().from(events)).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it('does not push to a parent who muted offline devices', async () => {
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'device.offline', enabled: false });
      await lastSeen(tablet, 7);
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 1 });
      await db.delete(notificationPrefs);
      expect(sentTo('fcm-mum')).toHaveLength(1);
      expect(sentTo('fcm-dad')).toHaveLength(0);
    });
  });

  describe('startSweeps', () => {
    it('sweeps on a timer until stopped', async () => {
      const ranOut = await addSos(180, -60);
      const stop = startSweeps(deps, 50);
      await new Promise((resolve) => setTimeout(resolve, 400));
      stop();
      const [row] = await db.select().from(sosIncidents).where(eq(sosIncidents.id, ranOut));
      expect(row?.endedByKind).toBe('auto');

      const later = await addSos(180, -60);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const [untouched] = await db.select().from(sosIncidents).where(eq(sosIncidents.id, later));
      expect(untouched?.endedAt).toBeNull();
    });
  });
});
```

## 6. Detailed spec

### 6.1 SOS auto stop

In each family: `UPDATE sos_incidents SET ended_at = auto_stop_at, ended_by_kind = 'auto' WHERE ended_at IS NULL AND auto_stop_at <= now() RETURNING ...`. For each row, an event `sos.ended` with payload `{ sosId, endedBy: 'auto', byName: null }`. After commit, `notifyParents` (`sos` is essential: every parent app, high priority). Because the update only matches rows not yet ended, a second pass finds nothing.

### 6.2 Device offline

In each family, for each device that is not revoked, of a kid who is not archived, with `last_seen_at` set and more than 6 hours ago:

1. Skip it if there is already a `device.offline` event for this device whose `payload ->> 'lastSeenAt'` is this `last_seen_at` (as ISO 8601 from JavaScript's `toISOString()`): that absence was reported.
2. Take today's schedule entry of the kid (latest schedule version, weekday of the family's local date). Report only when `now() - 6 hours >= today at wake` and `now() < today at bedtime`, both in the family time zone (`24:00` is the next midnight). So all of the last 6 hours were allowed hours, and a device off overnight is not reported in the morning.
3. Write the event `device.offline` with payload `{ lastSeenAt, deviceName }`.

After commit, `notifyParents` (`device.offline` is not essential: normal priority, a parent can mute it). When the device is seen again its `last_seen_at` changes, so a later silence is a new absence.

### 6.3 The timer

`startSweeps(deps, everyMs = 60000)` calls `sweep(deps)` every `everyMs`. If a pass is still running, that tick does nothing. Errors are logged (`background sweep failed`) and the next tick tries again. The timer is `unref()`ed. It returns a function that stops it. `server/src/index.ts` starts it after the server listens, with `{ ...deps, hub: app.hub }`.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-021-background-sweep
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-021-background-sweep.md` and `server/src/sos/routes.ts` (CARD-020) must exist after the pull. If not, you did not pull, or CARD-020 is not merged yet: run `git fetch origin` and `git pull origin main` again, and if `server/src/sos/routes.ts` is still missing, stop and ask James.
3. Create 5.1, replace 5.2. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-021: add the background sweep`.
4. Create 5.3. Commit: `CARD-021: add sweep tests`.
5. Run the acceptance checks in section 8.
6. Push and open the PR (section 10).
7. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
8. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  35 passed (35)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/jobs.test.ts (5 tests | 5 skipped)`, and every other file as before, so `Tests  41 passed | 170 skipped (211)`.
- [ ] `pnpm contract` leaves `git status --short contract` empty. `pnpm --filter @screentime/server db:generate` prints `No schema changes, nothing to migrate`.
- [ ] The database tests pass against PostgreSQL 18. Use a local `deploy/.env` with throwaway values (this replaces any `deploy/.env` you have; it is git-ignored):
  ```powershell
  Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db createdb -U screentime screentime_test
  $env:TEST_DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime_test"
  pnpm --filter @screentime/server test
  pnpm --filter @screentime/server test
  Remove-Item Env:TEST_DATABASE_URL
  ```
  Both runs: `test/jobs.test.ts (5 tests)` and `Tests  211 passed (211)`.
- [ ] The sweep runs in the real server (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
  ```powershell
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
  Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/request -ContentType 'application/json' -Body '{"email":"admin@example.com"}'
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "sign-in code for admin"
  ```
  Put the 6 digits from the last log line in place of `123456`, then create a family:
  ```powershell
  $a = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"admin@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $ah = @{ Authorization = "Bearer $($a.accessToken)" }
  Invoke-RestMethod -Method Post http://localhost:8080/v1/admin/families -Headers $ah -ContentType 'application/json' -Body '{"name":"Test family","timezone":"Australia/Sydney","firstParent":{"email":"parent@example.com","displayName":"Dad"}}' | Out-Null
  Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/request -ContentType 'application/json' -Body '{"email":"parent@example.com"}'
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "sign-in code for parent"
  ```
  Put those 6 digits in place of `123456`:
  ```powershell
  $p = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"parent@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $ph = @{ Authorization = "Bearer $($p.accessToken)" }
  ```
  Then add a kid, enrol a phone, start an SOS that began 3 hours ago (so it has already run out), count the SOS events, wait 70 seconds for the sweep, and count again:
  ```powershell
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  $c = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/enrolment-codes" -Headers $ph -ContentType 'application/json' -Body '{"form":"phone"}'
  $d = Invoke-RestMethod -Method Post http://localhost:8080/v1/enrol -ContentType 'application/json' -Body "{`"code`":`"$($c.code)`",`"platform`":`"android`",`"hasCellular`":true,`"model`":`"Pixel 7`",`"osVersion`":`"Android 14`",`"appVersion`":`"0.1.0`"}"
  $dh = @{ Authorization = "Bearer $($d.deviceToken)" }
  $s = Invoke-RestMethod -Method Post http://localhost:8080/v1/device/sos -Headers $dh -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`",`"startedAt`":`"$((Get-Date).ToUniversalTime().AddHours(-3).ToString('o'))`"}"
  "$($s.status) $($s.endedBy)"
  (Invoke-RestMethod 'http://localhost:8080/v1/events?kind=sos' -Headers $ph).events.Count
  Start-Sleep -Seconds 70
  $h = Invoke-RestMethod 'http://localhost:8080/v1/events?kind=sos' -Headers $ph
  "$($h.events.Count) $($h.events[0].kind) $($h.events[0].payload.endedBy)"
  ```
  The outputs are `ended auto`, `1` and, after the wait, `2 sos.ended auto`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 3 files (in any order):
  ```
  server/src/index.ts
  server/src/jobs/sweep.ts
  server/test/jobs.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `server/test/jobs.test.ts` | **SOS auto stop:** only the SOS that ran out is ended, with `ended_at` = `auto_stop_at` and `auto`; one `sos.ended` event with `endedBy: 'auto'`; a high-priority `sos` push to both parents; a second sweep finds and sends nothing. **Device offline:** a phone silent for 7 hours of allowed time gives one `device.offline` with its `lastSeenAt` and name, pushed at normal priority; a second sweep adds nothing; seen again and silent again gives a new one. Not reported: seen 5.5 hours ago, never seen, revoked, a kid who got up at 9:00 (the 6 hours started before wake-up), a kid past bedtime, a disabled family. A parent who muted `device.offline` gets no push. **Timer:** `startSweeps` ends a ran-out SOS within a few ticks, and after `stop()` nothing more happens. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 and 4). Message format: `CARD-021: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-021-background-sweep`
5. Open a PR into `main` titled `CARD-021: Background sweep`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-021-background-sweep --title "CARD-021: Background sweep" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-021-background-sweep.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract matches; db:generate finds no changes
   - [x] database tests, twice — output: `Tests  211 passed (211)` both times
   - [x] sweep on the real stack — output: `ended auto`, `1`, `2 sos.ended auto`
   - [x] deploy/.env not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 3 files

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

- **`server/src/sos/routes.ts` does not exist**: CARD-020 is not on your `main` yet. Stop and ask James.
- **`1 sos.started` instead of `2 sos.ended auto` after the wait**: the server image is old. Make sure you ran `up -d --build` after copying 5.2, wait another 30 seconds and read the events again once. If it is still 1, report it.
- **The startSweeps test fails once on a slow machine**: run the tests again once. If it fails twice, report it with its first error lines. Do not change the timings.
- **Blank lines and formatting**: copy them exactly too. In CARD-016 and CARD-018 a changed quote and a deleted blank line were not reported. Every difference from the card, however small, is a deviation: list it under "Deviations".
- **Different test data**: do not change values in the tests (names, hours, times, tokens), even when another value would also pass. If you think one is wrong, say so under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-021. Please review and merge if it is good.

CARD: CARD-021 Background sweep
PR: <full PR URL>
Branch: bob/card-021-background-sweep
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
