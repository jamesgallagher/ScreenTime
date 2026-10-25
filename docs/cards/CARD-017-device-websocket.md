# CARD-017: Live connection to kid devices

| Field | Value |
|---|---|
| Card | CARD-017 |
| Title | Live connection to kid devices |
| Size | M |
| Depends on | CARD-016 (merged to `main`) |
| Spec sections | docs/SPEC.md §8.3, §9.3, §10 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-017-device-websocket` |
| PR title | `CARD-017: Live connection to kid devices` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts`.

What exists already:

- Kid devices authenticate with `requireDevice` (`server/src/devices/auth.ts`): `Authorization: Bearer <deviceToken>`, 401 when the token is wrong or revoked.
- CARD-016 added `server/src/notify/dispatch.ts`. It has `notifyParents` (FCM pushes to parent apps) and `pushToKid`, which sends the `grant_added` envelope by FCM to a kid's Android devices after every grant. The envelope format is `{ v: 1, type, at, data }` (`Envelope` in `packages/schemas`).
- Devices fetch their state snapshot with `GET /v1/device/state` and get 304 when nothing changed.
- **Already on `main` (Claude added it with this card):** the `@hono/node-ws` ^1.3.1 package, and `ws` ^8.22.0 plus `@types/ws` ^8.18.2 as test-only packages, in `server/package.json` and `pnpm-lock.yaml`. You only run `pnpm install --frozen-lockfile` after pulling.

Windows PCs have no FCM, so today they only learn about a change when they poll. This card adds the live channel of SPEC §8.3 and §10:

1. **`GET /v1/device/ws`**: a WebSocket for kid devices, authenticated with the device token in the upgrade request. The device pings every 30 s and gets a `pong` back; a socket silent for 75 s is closed.
2. **The hub** (`server/src/live/hub.ts`): the sockets connected right now, in memory, by device id.
3. **Fan-out**: `sendToDevices` replaces `pushToKid`. It sends one envelope by WebSocket to every connected device it is for, and by FCM to Android devices when asked. `grant_added` now also reaches Windows PCs.
4. **`state_changed`**: after a parent changes something a device holds (schedule, contacts, family settings, parents, presets, parent-code secret, a device's name or pool), the affected devices are told to sync now. After a usage upload, the kid's other devices in that pool are told too, by WebSocket only.
5. **Disconnect on revoke**: revoking a device, archiving a kid, or enrolling a PC account again closes the old sockets at once (code 4401).

No database migration, no new route in the OpenAPI contract (`contract/openapi.json` stays unchanged: OpenAPI does not describe WebSockets), and no change to `packages/schemas`.

## 2. Goal

Kid devices can hold a live WebSocket to the server, keep it alive with pings, and receive `grant_added` and `state_changed` within a second of the change; revoked devices are cut off at once. All of it is tested against PostgreSQL 18 with real sockets on a local port.

## 3. Out of scope

Do **not** do any of these in this card:

- No device code (Android or Windows). The clients come in later cards.
- No `request_resolved`, `parent_mode`, `sos_ack` or `sos_ended` messages (CARD-018 to 020 send them through `sendToDevices`).
- No WebSocket for parent apps.
- No change to `packages/schemas`, `contract/openapi.json` or any test other than the new `server/test/live.test.ts`.
- No new npm packages and no lockfile change: the packages are already on `main`. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay unchanged.
- No database migration. Do not change `server/src/db/` or anything in `server/drizzle/`.
- Do not change any file that is not listed in section 5.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key, a Firebase key, an FCM token or a device token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, hono ^4.13.13, @hono/zod-openapi ^1.6.3, @hono/node-server ^1.19, drizzle-orm ^0.45.4, firebase-admin ^14.5.0, PostgreSQL 18. New to the code (already installed by the lockfile on `main`):

- `@hono/node-ws` ^1.3.1: `createNodeWebSocket({ app })` gives `upgradeWebSocket` (a Hono handler) and `injectWebSocket(server)`, which hooks the Node HTTP server's `upgrade` event. The upgrade request runs through the Hono app, so `requireDevice` and the error handler work as for any route.
- `ws` ^8.22.0 (dev only): the WebSocket client the tests use, because it can send an `Authorization` header.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character. Some test names contain an apostrophe and so use double quotes: keep them exactly as written.

| File | Action |
|---|---|
| `server/src/live/hub.ts` | create (5.1) |
| `server/src/live/routes.ts` | create (5.2) |
| `server/src/notify/dispatch.ts` | replace (5.3) |
| `server/src/grants/routes.ts` | replace (5.4) |
| `server/src/kids/routes.ts` | replace (5.5) |
| `server/src/family/routes.ts` | replace (5.6) |
| `server/src/devices/routes.ts` | replace (5.7) |
| `server/src/sync/routes.ts` | replace (5.8) |
| `server/src/app.ts` | replace (5.9) |
| `server/src/index.ts` | replace (5.10) |
| `server/test/live.test.ts` | create (5.11) |

That is 11 files.

### 5.1 `server/src/live/hub.ts`

```typescript
import type { Envelope } from '@screentime/schemas';

/** The part of a WebSocket the hub uses. */
export interface LiveSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Close codes the server uses (4000 to 4999 are free for applications). */
export const CLOSE_IDLE = 4408;
export const CLOSE_REVOKED = 4401;

/**
 * The kid devices connected by WebSocket right now (docs/SPEC.md §8.3, §10), kept in memory: the server
 * runs as one process. A device may have more than one socket for a moment while it reconnects.
 */
export class LiveHub {
  /** A socket that sends nothing for this long is closed. Devices ping every 30 s. */
  readonly idleMs: number;
  readonly #sockets = new Map<string, Set<LiveSocket>>();

  constructor(options: { idleMs?: number } = {}) {
    this.idleMs = options.idleMs ?? 75_000;
  }

  add(deviceId: string, socket: LiveSocket) {
    const set = this.#sockets.get(deviceId) ?? new Set<LiveSocket>();
    set.add(socket);
    this.#sockets.set(deviceId, set);
  }

  remove(deviceId: string, socket: LiveSocket) {
    const set = this.#sockets.get(deviceId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.#sockets.delete(deviceId);
  }

  /** How many sockets this device has open. */
  count(deviceId: string) {
    return this.#sockets.get(deviceId)?.size ?? 0;
  }

  /** Sends the message to every socket of these devices. Returns how many sockets it went to. */
  send(deviceIds: Iterable<string>, msg: Envelope) {
    const text = JSON.stringify(msg);
    let sent = 0;
    for (const id of deviceIds) {
      for (const socket of this.#sockets.get(id) ?? []) {
        try {
          socket.send(text);
          sent += 1;
        } catch (err) {
          console.error('websocket send failed', err);
        }
      }
    }
    return sent;
  }

  /** Closes every socket of these devices, for example when a device is revoked. */
  close(deviceIds: Iterable<string>, code: number, reason: string) {
    for (const id of deviceIds) {
      for (const socket of [...(this.#sockets.get(id) ?? [])]) {
        socket.close(code, reason);
        this.remove(id, socket);
      }
    }
  }
}
```

### 5.2 `server/src/live/routes.ts`

The WebSocket route. `upgradeWebSocket` calls the async function first: `requireDevice` throws 401 before any socket exists. The second handler only runs for a plain request without `Upgrade: websocket`.

```typescript
import type { UpgradeWebSocket } from 'hono/ws';
import type { Envelope } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireDevice } from '../devices/auth.js';
import { errorBody } from '../errors.js';
import type { createRouter } from '../router.js';
import { CLOSE_IDLE, type LiveHub, type LiveSocket } from './hub.js';

type Router = ReturnType<typeof createRouter>;

/**
 * `GET /v1/device/ws`: the live channel to kid devices (docs/SPEC.md §8.3, §10). The device sends its
 * token as `Authorization: Bearer <deviceToken>` with the upgrade request; a wrong or revoked token gets
 * 401 and no socket. The device sends `{ "type": "ping" }` every 30 s and gets a `pong` envelope back;
 * a socket silent for 75 s is closed (code 4408). The server only sends envelopes; usage stays on REST.
 */
export function registerLiveRoutes(
  app: Router,
  deps: AppDeps & { hub: LiveHub },
  upgradeWebSocket: UpgradeWebSocket,
) {
  const { db, hub } = deps;

  app.get(
    '/v1/device/ws',
    upgradeWebSocket(async (c) => {
      const { deviceId } = await requireDevice(c, db);
      let timer: NodeJS.Timeout | undefined;
      const restartIdleTimer = (ws: LiveSocket) => {
        clearTimeout(timer);
        timer = setTimeout(() => ws.close(CLOSE_IDLE, 'No ping for too long.'), hub.idleMs);
      };
      return {
        onOpen(_event, ws) {
          hub.add(deviceId, ws);
          restartIdleTimer(ws);
        },
        onMessage(event, ws) {
          restartIdleTimer(ws);
          let type: unknown;
          try {
            type = (JSON.parse(String(event.data)) as { type?: unknown }).type;
          } catch {
            return;
          }
          if (type === 'ping') {
            const pong: Envelope = { v: 1, type: 'pong', at: new Date().toISOString(), data: {} };
            ws.send(JSON.stringify(pong));
          }
        },
        onClose(_event, ws) {
          clearTimeout(timer);
          hub.remove(deviceId, ws);
        },
      };
    }),
    // Reached only by a request that is not a WebSocket upgrade.
    (c) => c.json(errorBody('validation_failed', 'Connect to this address with a WebSocket.'), 422),
  );
}
```

### 5.3 `server/src/notify/dispatch.ts`

The same as before, except: `pushToKid` is replaced by `sendToDevices` (WebSocket to every connected device, FCM to Android ones only when `fcm` is given), and `stateChanged` and `disconnectDevices` are new. Imports gain `ne` and `CLOSE_REVOKED`.

```typescript
import { and, asc, eq, inArray, isNotNull, isNull, ne, type SQL, sql } from 'drizzle-orm';
import { ESSENTIAL_KINDS, type Envelope, type EventItem, NotificationKind, type Pool } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/client.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, grants, kids, notificationPrefs, parentSessions, parents } from '../db/schema.js';
import { CLOSE_REVOKED } from '../live/hub.js';
import type { PushMessage, Pusher } from '../push.js';

/** The notification kind of an event kind (docs/SPEC.md §13), or null for events that never notify. */
export function notificationKindOf(eventKind: string): NotificationKind | null {
  if (eventKind === 'grant.added') return 'grant.by_other_parent';
  if (eventKind.startsWith('sos.')) return 'sos';
  if (eventKind.startsWith('tamper.')) return 'tamper';
  const parsed = NotificationKind.safeParse(eventKind);
  return parsed.success ? parsed.data : null;
}

/** Events as the history shows them, with kid and device names. `where` picks the rows. */
export async function selectEvents(tx: FamilyTx, where: SQL | undefined, limit?: number) {
  const query = tx
    .select({
      id: events.id,
      kind: events.kind,
      at: events.at,
      kidId: events.kidId,
      kidName: kids.name,
      deviceId: events.deviceId,
      deviceName: devices.name,
      payload: events.payload,
    })
    .from(events)
    .leftJoin(kids, eq(kids.id, events.kidId))
    .leftJoin(devices, eq(devices.id, events.deviceId))
    .where(where)
    .orderBy(sql`${events.at} desc`, sql`${events.id} desc`);
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map(
    (r): EventItem => ({ ...r, at: r.at.toISOString(), payload: (r.payload ?? {}) as Record<string, unknown> }),
  );
}

/** Sends the messages and forgets every token FCM says is dead, so it is not tried again. */
async function sendAndForgetDead(db: Db, pusher: Pusher, familyId: string, messages: PushMessage[]) {
  if (messages.length === 0) return;
  const dead = await pusher.send(messages);
  if (dead.length === 0) return;
  await withFamily(db, familyId, async (tx) => {
    await tx.update(parentSessions).set({ fcmToken: null }).where(inArray(parentSessions.fcmToken, dead));
    await tx.update(devices).set({ fcmToken: null }).where(inArray(devices.fcmToken, dead));
  });
}

/**
 * Pushes committed events to the parents' Android apps (docs/SPEC.md §13). Call it after the transaction
 * that wrote the events has committed. Every signed-in parent app with a push token gets each event,
 * except kinds the parent turned off (essential kinds cannot be), and except their own time changes.
 * A push that fails is logged and dropped: the event is in the history either way.
 */
export async function notifyParents(deps: AppDeps, familyId: string, eventIds: string[]) {
  const { db, pusher } = deps;
  if (!pusher || eventIds.length === 0) return;
  try {
    const messages = await withFamily(db, familyId, async (tx) => {
      const items = await selectEvents(tx, inArray(events.id, eventIds));
      // The parent who made a grant does not need to hear about it.
      const authors = await tx
        .select({ eventId: events.id, parentId: grants.createdBy })
        .from(events)
        .innerJoin(grants, sql`${grants.id}::text = ${events.payload} ->> 'grantId'`)
        .where(and(inArray(events.id, eventIds), eq(events.kind, 'grant.added')));
      const sessions = await tx
        .select({ parentId: parentSessions.parentId, token: parentSessions.fcmToken })
        .from(parentSessions)
        .innerJoin(parents, eq(parents.id, parentSessions.parentId))
        .where(and(isNull(parentSessions.revokedAt), isNotNull(parentSessions.fcmToken), isNull(parents.disabledAt)))
        .orderBy(asc(parentSessions.createdAt));
      const muted = await tx
        .select({ parentId: notificationPrefs.parentId, kind: notificationPrefs.kind })
        .from(notificationPrefs)
        .where(eq(notificationPrefs.enabled, false));

      const out: PushMessage[] = [];
      for (const item of items) {
        const kind = notificationKindOf(item.kind);
        if (!kind) continue;
        const essential = ESSENTIAL_KINDS.includes(kind);
        const author = authors.find((a) => a.eventId === item.id)?.parentId;
        const msg: Envelope = { v: 1, type: kind, at: item.at, data: item };
        for (const session of sessions) {
          if (!session.token || session.parentId === author) continue;
          if (!essential && muted.some((m) => m.parentId === session.parentId && m.kind === kind)) continue;
          out.push({ token: session.token, msg, high: essential });
        }
      }
      return out;
    });
    await sendAndForgetDead(db, pusher, familyId, messages);
  } catch (err) {
    console.error('push to parents failed', err);
  }
}

/** Which of a family's devices a message is for. Every field left out matches all. */
export interface DeviceTarget {
  kidId?: string;
  pool?: Pool;
  deviceId?: string;
  /** Leave this device out, for example the one whose upload caused the change. */
  exceptDeviceId?: string;
}

/** How to send by FCM as well: priority, and how long FCM keeps trying. */
export interface FcmOptions {
  high: boolean;
  ttlSec: number;
}

/**
 * Sends one message to a family's kid devices that are not revoked (docs/SPEC.md §8.3, §10): by WebSocket
 * to every one connected now, and, when `fcm` is given, by FCM to the Android ones with a push token.
 * Call it after the change has committed. Failures are logged: devices also pick changes up on sync.
 */
export async function sendToDevices(
  deps: AppDeps,
  familyId: string,
  target: DeviceTarget,
  msg: Envelope,
  fcm: FcmOptions | null,
) {
  const { db, pusher, hub } = deps;
  try {
    const rows = await withFamily(db, familyId, (tx) =>
      tx
        .select({ id: devices.id, platform: devices.platform, token: devices.fcmToken })
        .from(devices)
        .where(
          and(
            isNull(devices.revokedAt),
            target.kidId ? eq(devices.kidId, target.kidId) : undefined,
            target.pool ? eq(devices.pool, target.pool) : undefined,
            target.deviceId ? eq(devices.id, target.deviceId) : undefined,
            target.exceptDeviceId ? ne(devices.id, target.exceptDeviceId) : undefined,
          ),
        )
        .orderBy(asc(devices.enrolledAt)),
    );
    hub?.send(
      rows.map((r) => r.id),
      msg,
    );
    if (!fcm || !pusher) return;
    const messages = rows.flatMap((r) =>
      r.platform === 'android' && r.token ? [{ token: r.token, msg, high: fcm.high, ttlSec: fcm.ttlSec }] : [],
    );
    await sendAndForgetDead(db, pusher, familyId, messages);
  } catch (err) {
    console.error('push to kid devices failed', err);
  }
}

/** FCM keeps a `state_changed` for a day: by then the device has synced anyway. */
const STATE_CHANGED_TTL_SEC = 24 * 3600;

/**
 * Tells devices that their state snapshot changed, so they fetch it now (`state_changed`, docs/SPEC.md §10).
 * By WebSocket, and by FCM at normal priority unless `fcm` is false (usage uploads, which come every minute).
 */
export async function stateChanged(deps: AppDeps, familyId: string, target: DeviceTarget, fcm = true) {
  const msg: Envelope = { v: 1, type: 'state_changed', at: new Date().toISOString(), data: {} };
  await sendToDevices(deps, familyId, target, msg, fcm ? { high: false, ttlSec: STATE_CHANGED_TTL_SEC } : null);
}

/** Closes the WebSockets of devices that were just revoked. They get 401 if they try again. */
export function disconnectDevices(deps: AppDeps, deviceIds: string[]) {
  deps.hub?.close(deviceIds, CLOSE_REVOKED, 'This device is not enrolled.');
}
```

### 5.4 `server/src/grants/routes.ts`

The same as before, except `sendPushes` calls `sendToDevices` instead of `pushToKid`.

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { Grant, GrantCreate, LocalDate, LockNow, type Pool } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { events, families, grants, parents, scheduleVersions, usageSegments } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { findKid, toSchedule } from '../kids/routes.js';
import { notifyParents, sendToDevices } from '../notify/dispatch.js';
import { bearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { dayGrants, daySegments, type FamilyDay, familyDay, poolStatus } from '../sync/day.js';

type Router = ReturnType<typeof createRouter>;

const KidParam = z.object({ kidId: z.uuid() });
const DayQuery = z.object({ day: LocalDate.optional() });

const POOL_NAME: Record<Pool, string> = { screens: 'Screens', phone: 'Phone' };

const listGrantsRoute = createRoute({
  method: 'get',
  path: '/v1/kids/{kidId}/grants',
  tags: ['grants'],
  summary: "A kid's time adjustments for one day",
  description: 'Both pools, oldest first. `day` is the family-local date; today when left out.',
  security: bearer,
  request: { params: KidParam, query: DayQuery },
  responses: { 200: jsonResponse('The grants.', z.array(Grant)), ...errorResponses(401, 403, 404, 422) },
});

const createGrantRoute = createRoute({
  method: 'post',
  path: '/v1/kids/{kidId}/grants',
  tags: ['grants'],
  summary: 'Add or remove time for today',
  description:
    'Counts for today only. Sending the same `id` again returns the stored grant with 200 and changes nothing.',
  security: bearer,
  request: { params: KidParam, body: jsonBody(GrantCreate) },
  responses: {
    201: jsonResponse('Stored.', Grant),
    200: jsonResponse('Already stored with this id.', Grant),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});

const lockNowRoute = createRoute({
  method: 'post',
  path: '/v1/kids/{kidId}/lock-now',
  tags: ['grants'],
  summary: 'Lock a pool now',
  description:
    'Takes away the time left in the pool, rounded up to a whole minute, as a negative grant. Sending the same `id` again returns the stored grant with 200.',
  security: bearer,
  request: { params: KidParam, body: jsonBody(LockNow) },
  responses: {
    201: jsonResponse('Locked.', Grant),
    200: jsonResponse('Already stored with this id.', Grant),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});

/** Grants with the name of the parent who made them, oldest first. */
async function selectGrants(tx: FamilyTx, where: SQL | undefined) {
  const rows = await tx
    .select({ grant: grants, byName: parents.displayName })
    .from(grants)
    .innerJoin(parents, eq(parents.id, grants.createdBy))
    .where(where)
    .orderBy(asc(grants.createdAt), asc(grants.id));
  return rows.map(
    ({ grant, byName }): Grant => ({
      id: grant.id,
      pool: grant.pool as Pool,
      minutes: grant.minutes,
      day: grant.day,
      createdAt: grant.createdAt.toISOString(),
      byName,
      note: grant.note,
      requestId: grant.requestId,
    }),
  );
}

/**
 * Parent time adjustments: add, remove and lock now (docs/SPEC.md §7.3, §9.2, Q8).
 * A grant always counts for the family's local today. Devices pick it up on their next sync.
 */
export function registerGrantRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  async function today(tx: FamilyTx, familyId: string): Promise<{ timezone: string; day: FamilyDay }> {
    const [family] = await tx.select({ timezone: families.timezone }).from(families).where(eq(families.id, familyId));
    if (!family) throw new Error('family vanished after requireFamilyParent');
    return { timezone: family.timezone, day: await familyDay(tx, family.timezone) };
  }

  /** The grant already stored with this id, if it is this kid's. Another kid's (or family's) id is a conflict. */
  async function existing(tx: FamilyTx, id: string, kidId: string) {
    const [row] = await tx.select({ kidId: grants.kidId }).from(grants).where(eq(grants.id, id));
    if (!row) return null;
    if (row.kidId !== kidId) throw new ApiError('conflict', 'That grant id is already used.');
    const [grant] = await selectGrants(tx, eq(grants.id, id));
    return grant ?? null;
  }

  /**
   * Stores a new grant for today and records a `grant.added` event in the same transaction. `pushes` says
   * what to send once the transaction has committed; null when nothing new was stored.
   */
  async function insertGrant(
    tx: FamilyTx,
    familyId: string,
    parentId: string,
    kidId: string,
    day: FamilyDay,
    values: { id: string; pool: Pool; minutes: number; note: string | null },
    lockNow: boolean,
  ) {
    const inserted = await tx
      .insert(grants)
      .values({ ...values, familyId, kidId, day: day.date, createdBy: parentId })
      .onConflictDoNothing({ target: grants.id })
      .returning({ id: grants.id });
    // Lost a race with the same id from another request: answer with what is stored.
    if (inserted.length === 0) return { grant: await existing(tx, values.id, kidId), created: false, pushes: null };
    const [grant] = await selectGrants(tx, eq(grants.id, values.id));
    if (!grant) throw new Error('grant vanished after insert');
    // Other parents hear about it as `grant.by_other_parent` (docs/SPEC.md §13).
    const [event] = await tx
      .insert(events)
      .values({
        familyId,
        kidId,
        kind: 'grant.added',
        at: new Date(grant.createdAt),
        payload: { grantId: grant.id, pool: grant.pool, minutes: grant.minutes, byName: grant.byName, lockNow },
      })
      .returning({ id: events.id });
    if (!event) throw new Error('event insert returned nothing');
    return { grant, created: true, pushes: { eventId: event.id, dayEnd: day.dayEnd, now: day.now } };
  }

  /** After commit: tell the other parents, and the kid's devices in that pool so they show "Dad added 15 minutes". */
  async function sendPushes(
    familyId: string,
    kidId: string,
    grant: Grant,
    pushes: { eventId: string; dayEnd: Date; now: Date } | null,
  ) {
    if (!pushes) return;
    await notifyParents(deps, familyId, [pushes.eventId]);
    // The grant only counts today, so the push is worth nothing after midnight.
    const ttlSec = Math.max(60, Math.floor((pushes.dayEnd.getTime() - pushes.now.getTime()) / 1000));
    await sendToDevices(
      deps,
      familyId,
      { kidId, pool: grant.pool },
      {
        v: 1,
        type: 'grant_added',
        at: grant.createdAt,
        data: {
          grant: { id: grant.id, minutes: grant.minutes, createdAt: grant.createdAt, byName: grant.byName },
          byName: grant.byName,
        },
      },
      { high: true, ttlSec },
    );
  }

  app.openapi(listGrantsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const query = c.req.valid('query');
    const rows = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const date = query.day ?? (await today(tx, familyId)).day.date;
      return selectGrants(tx, and(eq(grants.kidId, kidId), eq(grants.day, date)));
    });
    return c.json(rows, 200);
  });

  app.openapi(createGrantRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const stored = await existing(tx, body.id, kidId);
      if (stored) return { grant: stored, created: false, pushes: null };
      const { day } = await today(tx, familyId);
      return insertGrant(
        tx,
        familyId,
        parentId,
        kidId,
        day,
        { id: body.id, pool: body.pool, minutes: body.minutes, note: body.note ?? null },
        false,
      );
    });
    if (!result.grant) throw new ApiError('conflict', 'That grant id is already used.');
    await sendPushes(familyId, kidId, result.grant, result.pushes);
    return result.created ? c.json(result.grant, 201) : c.json(result.grant, 200);
  });

  app.openapi(lockNowRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const { id, pool } = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const stored = await existing(tx, id, kidId);
      if (stored) return { grant: stored, created: false, pushes: null };
      const { timezone, day } = await today(tx, familyId);
      const [scheduleRow] = await tx
        .select()
        .from(scheduleVersions)
        .where(eq(scheduleVersions.kidId, kidId))
        .orderBy(desc(scheduleVersions.version))
        .limit(1);
      if (!scheduleRow) throw new Error(`kid ${kidId} has no schedule`);
      const status = poolStatus(
        timezone,
        day,
        toSchedule(scheduleRow),
        pool,
        await dayGrants(tx, day, and(eq(grants.kidId, kidId), eq(grants.pool, pool))),
        await daySegments(tx, day, and(eq(usageSegments.kidId, kidId), eq(usageSegments.pool, pool))),
      );
      if (status.locked) throw new ApiError('conflict', `${POOL_NAME[pool]} is already locked.`);
      // Rounded up, so the pool ends at or just below zero and locks at once (docs/SPEC.md §7.3).
      const minutes = -Math.ceil(status.remainingSec / 60);
      return insertGrant(tx, familyId, parentId, kidId, day, { id, pool, minutes, note: 'Lock now' }, true);
    });
    if (!result.grant) throw new ApiError('conflict', 'That grant id is already used.');
    await sendPushes(familyId, kidId, result.grant, result.pushes);
    return result.created ? c.json(result.grant, 201) : c.json(result.grant, 200);
  });
}
```

### 5.5 `server/src/kids/routes.ts`

The same as before, plus: `stateChanged` for the kid's devices after a kid name change, a schedule save and a contacts save, and archiving a kid returns the revoked device ids and closes their sockets.

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  Kid,
  KidContact,
  KidContactsPut,
  KidCreate,
  KidPatch,
  Schedule,
  type ScheduleDay,
  ScheduleInput,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { isUniqueViolation } from '../db/errors.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, kidContacts, kids, scheduleVersions } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { disconnectDevices, stateChanged } from '../notify/dispatch.js';
import { bearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { DEFAULT_WARN1_MIN, DEFAULT_WARN2_MIN, defaultWeek } from './schedule.js';

type Router = ReturnType<typeof createRouter>;

const KidParam = z.object({ kidId: z.uuid() });

function toKid(row: typeof kids.$inferSelect): Kid {
  return { id: row.id, name: row.name, avatarColor: row.avatarColor as Kid['avatarColor'] };
}

export function toSchedule(row: typeof scheduleVersions.$inferSelect): Schedule {
  // jsonb does not keep key order, so each day is rebuilt in the order of the contract.
  const days = (row.days as ScheduleDay[]).map(({ weekday, screensMin, phoneMin, wake, bedtime }) => ({
    weekday,
    screensMin,
    phoneMin,
    wake,
    bedtime,
  }));
  return { version: row.version, warn1Min: row.warn1Min, warn2Min: row.warn2Min, days };
}

const kidNotFound = () => new ApiError('not_found', 'No such kid in your family.');

/** The kid, if it is in the caller's family and not archived. Row-level security hides other families. */
export async function findKid(tx: FamilyTx, kidId: string) {
  const [row] = await tx
    .select()
    .from(kids)
    .where(and(eq(kids.id, kidId), isNull(kids.archivedAt)));
  if (!row) throw kidNotFound();
  return row;
}

const listKidsRoute = createRoute({
  method: 'get',
  path: '/v1/kids',
  tags: ['kids'],
  summary: 'Kids in the family',
  description: 'Archived kids are left out.',
  security: bearer,
  responses: { 200: jsonResponse('The kids, oldest first.', z.array(Kid)), ...errorResponses(401, 403) },
});

const createKidRoute = createRoute({
  method: 'post',
  path: '/v1/kids',
  tags: ['kids'],
  summary: 'Add a kid',
  description: 'The kid starts with the default schedule (version 1) and no contacts.',
  security: bearer,
  request: { body: jsonBody(KidCreate) },
  responses: { 201: jsonResponse('The new kid.', Kid), ...errorResponses(401, 403, 422) },
});

const getKidRoute = createRoute({
  method: 'get',
  path: '/v1/kids/{kidId}',
  tags: ['kids'],
  summary: 'One kid',
  security: bearer,
  request: { params: KidParam },
  responses: { 200: jsonResponse('The kid.', Kid), ...errorResponses(401, 403, 404, 422) },
});

const patchKidRoute = createRoute({
  method: 'patch',
  path: '/v1/kids/{kidId}',
  tags: ['kids'],
  summary: 'Change the name or colour of a kid',
  security: bearer,
  request: { params: KidParam, body: jsonBody(KidPatch) },
  responses: { 200: jsonResponse('The changed kid.', Kid), ...errorResponses(401, 403, 404, 422) },
});

const archiveKidRoute = createRoute({
  method: 'delete',
  path: '/v1/kids/{kidId}',
  tags: ['kids'],
  summary: 'Archive a kid',
  description: 'The kid disappears from lists and their devices are revoked; their history stays.',
  security: bearer,
  request: { params: KidParam },
  responses: { 204: { description: 'Archived.' }, ...errorResponses(401, 403, 404, 422) },
});

const getScheduleRoute = createRoute({
  method: 'get',
  path: '/v1/kids/{kidId}/schedule',
  tags: ['kids'],
  summary: 'The current schedule of a kid',
  security: bearer,
  request: { params: KidParam },
  responses: { 200: jsonResponse('The highest schedule version.', Schedule), ...errorResponses(401, 403, 404, 422) },
});

const putScheduleRoute = createRoute({
  method: 'put',
  path: '/v1/kids/{kidId}/schedule',
  tags: ['kids'],
  summary: 'Save a new schedule version',
  description: 'Old versions are kept. Devices pick up the new one on their next sync.',
  security: bearer,
  request: { params: KidParam, body: jsonBody(ScheduleInput) },
  responses: { 200: jsonResponse('The new schedule.', Schedule), ...errorResponses(401, 403, 404, 409, 422) },
});

const getContactsRoute = createRoute({
  method: 'get',
  path: '/v1/kids/{kidId}/contacts',
  tags: ['kids'],
  summary: 'The always-callable list of a kid',
  description: 'Parents with a phone number are always callable too; they are not in this list.',
  security: bearer,
  request: { params: KidParam },
  responses: { 200: jsonResponse('The contacts, in order.', z.array(KidContact)), ...errorResponses(401, 403, 404, 422) },
});

const putContactsRoute = createRoute({
  method: 'put',
  path: '/v1/kids/{kidId}/contacts',
  tags: ['kids'],
  summary: 'Replace the whole contact list',
  security: bearer,
  request: { params: KidParam, body: jsonBody(KidContactsPut) },
  responses: { 200: jsonResponse('The new contacts, in order.', z.array(KidContact)), ...errorResponses(401, 403, 404, 422) },
});

/**
 * Kids, their schedules and their always-callable contacts (docs/SPEC.md §9.2).
 * Every query runs inside `withFamily`, so row-level security limits it to the caller's family.
 */
export function registerKidRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  app.openapi(listKidsRoute, async (c) => {
    const { familyId } = await caller(c);
    const rows = await withFamily(db, familyId, (tx) =>
      tx.select().from(kids).where(isNull(kids.archivedAt)).orderBy(asc(kids.createdAt), asc(kids.id)),
    );
    return c.json(rows.map(toKid), 200);
  });

  app.openapi(createKidRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const body = c.req.valid('json');
    const row = await withFamily(db, familyId, async (tx) => {
      const [kid] = await tx.insert(kids).values({ familyId, name: body.name, avatarColor: body.avatarColor }).returning();
      if (!kid) throw new Error('kid insert returned nothing');
      await tx.insert(scheduleVersions).values({
        familyId,
        kidId: kid.id,
        version: 1,
        warn1Min: DEFAULT_WARN1_MIN,
        warn2Min: DEFAULT_WARN2_MIN,
        days: defaultWeek(),
        createdBy: parentId,
      });
      return kid;
    });
    return c.json(toKid(row), 201);
  });

  app.openapi(getKidRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    return c.json(toKid(await withFamily(db, familyId, (tx) => findKid(tx, kidId))), 200);
  });

  app.openapi(patchKidRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const patch = c.req.valid('json');
    const row = await withFamily(db, familyId, async (tx) => {
      if (Object.keys(patch).length === 0) return findKid(tx, kidId);
      const [kid] = await tx
        .update(kids)
        .set(patch)
        .where(and(eq(kids.id, kidId), isNull(kids.archivedAt)))
        .returning();
      if (!kid) throw kidNotFound();
      return kid;
    });
    if (Object.keys(patch).length > 0) await stateChanged(deps, familyId, { kidId });
    return c.json(toKid(row), 200);
  });

  app.openapi(archiveKidRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const revoked = await withFamily(db, familyId, async (tx) => {
      const [archived] = await tx
        .update(kids)
        .set({ archivedAt: sql`now()` })
        .where(and(eq(kids.id, kidId), isNull(kids.archivedAt)))
        .returning({ id: kids.id });
      if (!archived) throw kidNotFound();
      return tx
        .update(devices)
        .set({ revokedAt: sql`now()`, fcmToken: null })
        .where(and(eq(devices.kidId, kidId), isNull(devices.revokedAt)))
        .returning({ id: devices.id });
    });
    disconnectDevices(
      deps,
      revoked.map((d) => d.id),
    );
    return c.body(null, 204);
  });

  app.openapi(getScheduleRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const row = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const [latest] = await tx
        .select()
        .from(scheduleVersions)
        .where(eq(scheduleVersions.kidId, kidId))
        .orderBy(desc(scheduleVersions.version))
        .limit(1);
      if (!latest) throw new ApiError('not_found', 'This kid has no schedule yet.');
      return latest;
    });
    return c.json(toSchedule(row), 200);
  });

  app.openapi(putScheduleRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const input = c.req.valid('json');
    try {
      const row = await withFamily(db, familyId, async (tx) => {
        await findKid(tx, kidId);
        const [current] = await tx
          .select({ version: sql<number>`coalesce(max(${scheduleVersions.version}), 0)` })
          .from(scheduleVersions)
          .where(eq(scheduleVersions.kidId, kidId));
        const [saved] = await tx
          .insert(scheduleVersions)
          .values({ familyId, kidId, version: (current?.version ?? 0) + 1, ...input, createdBy: parentId })
          .returning();
        if (!saved) throw new Error('schedule insert returned nothing');
        return saved;
      });
      await stateChanged(deps, familyId, { kidId });
      return c.json(toSchedule(row), 200);
    } catch (err) {
      // Two parents saved at the same moment and both took the same version number.
      if (isUniqueViolation(err)) throw new ApiError('conflict', 'The schedule was changed at the same time. Try again.');
      throw err;
    }
  });

  app.openapi(getContactsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const rows = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      return tx
        .select()
        .from(kidContacts)
        .where(eq(kidContacts.kidId, kidId))
        .orderBy(asc(kidContacts.sort), asc(kidContacts.id));
    });
    return c.json(rows.map(({ id, label, phoneE164 }) => ({ id, label, phoneE164 })), 200);
  });

  app.openapi(putContactsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const { contacts } = c.req.valid('json');
    const rows = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      await tx.delete(kidContacts).where(and(eq(kidContacts.familyId, familyId), eq(kidContacts.kidId, kidId)));
      if (contacts.length === 0) return [];
      return tx
        .insert(kidContacts)
        .values(contacts.map((contact, sort) => ({ familyId, kidId, ...contact, sort })))
        .returning();
    });
    rows.sort((a, b) => a.sort - b.sort);
    await stateChanged(deps, familyId, { kidId });
    return c.json(rows.map(({ id, label, phoneE164 }) => ({ id, label, phoneE164 })), 200);
  });
}
```

### 5.6 `server/src/family/routes.ts`

The same as before, plus `stateChanged` for every device of the family after a family change, a parent added, edited or removed, presets saved, and the parent-code secret rotated.

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  Family,
  FamilyPatch,
  MessagePreset,
  MessagePresetsPut,
  Parent,
  ParentCodeSecret,
  ParentCreate,
  ParentPatch,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { isUniqueViolation } from '../db/errors.js';
import { withFamily } from '../db/family.js';
import { families, messagePresets, parentSessions, parents } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { stateChanged } from '../notify/dispatch.js';
import { bearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { newParentCodeSecret } from './secret.js';

type Router = ReturnType<typeof createRouter>;

const IdParam = z.object({ id: z.uuid() });

export function toFamily(row: typeof families.$inferSelect): Family {
  return { id: row.id, name: row.name, timezone: row.timezone, emergencyNumber: row.emergencyNumber };
}

export function toParent(row: typeof parents.$inferSelect): Parent {
  return { id: row.id, email: row.email, displayName: row.displayName, phoneE164: row.phoneE164 };
}

export const emailTaken = () => new ApiError('conflict', 'That email already belongs to a parent.');
const parentNotFound = () => new ApiError('not_found', 'No such parent in your family.');

const getFamilyRoute = createRoute({
  method: 'get',
  path: '/v1/family',
  tags: ['family'],
  summary: 'The family of the signed-in parent',
  security: bearer,
  responses: { 200: jsonResponse('The family.', Family), ...errorResponses(401, 403) },
});

const patchFamilyRoute = createRoute({
  method: 'patch',
  path: '/v1/family',
  tags: ['family'],
  summary: 'Change the family name, time zone or emergency number',
  security: bearer,
  request: { body: jsonBody(FamilyPatch) },
  responses: { 200: jsonResponse('The changed family.', Family), ...errorResponses(401, 403, 422) },
});

const listParentsRoute = createRoute({
  method: 'get',
  path: '/v1/family/parents',
  tags: ['family'],
  summary: 'Parents in the family',
  description: 'Removed (disabled) parents are left out.',
  security: bearer,
  responses: { 200: jsonResponse('The parents, oldest first.', z.array(Parent)), ...errorResponses(401, 403) },
});

const addParentRoute = createRoute({
  method: 'post',
  path: '/v1/family/parents',
  tags: ['family'],
  summary: 'Add a parent',
  description: 'They sign in with their email; no invitation is sent.',
  security: bearer,
  request: { body: jsonBody(ParentCreate) },
  responses: { 201: jsonResponse('The new parent.', Parent), ...errorResponses(401, 403, 409, 422) },
});

const patchParentRoute = createRoute({
  method: 'patch',
  path: '/v1/family/parents/{id}',
  tags: ['family'],
  summary: 'Change the name or phone of a parent',
  security: bearer,
  request: { params: IdParam, body: jsonBody(ParentPatch) },
  responses: { 200: jsonResponse('The changed parent.', Parent), ...errorResponses(401, 403, 404, 422) },
});

const removeParentRoute = createRoute({
  method: 'delete',
  path: '/v1/family/parents/{id}',
  tags: ['family'],
  summary: 'Remove a parent',
  description: 'Disables the parent and signs out all their sessions. You cannot remove yourself.',
  security: bearer,
  request: { params: IdParam },
  responses: { 204: { description: 'Removed.' }, ...errorResponses(401, 403, 404, 409, 422) },
});

const getPresetsRoute = createRoute({
  method: 'get',
  path: '/v1/family/message-presets',
  tags: ['family'],
  summary: 'Messages kids can send with one tap',
  security: bearer,
  responses: { 200: jsonResponse('The presets, in order.', z.array(MessagePreset)), ...errorResponses(401, 403) },
});

const putPresetsRoute = createRoute({
  method: 'put',
  path: '/v1/family/message-presets',
  tags: ['family'],
  summary: 'Replace the whole preset list',
  security: bearer,
  request: { body: jsonBody(MessagePresetsPut) },
  responses: { 200: jsonResponse('The new presets, in order.', z.array(MessagePreset)), ...errorResponses(401, 403, 422) },
});

const getParentCodeRoute = createRoute({
  method: 'get',
  path: '/v1/family/parent-code',
  tags: ['family'],
  summary: 'Secret for offline parent-mode codes',
  description: 'The parent app caches it to show rotating codes when a kid device is offline.',
  security: bearer,
  responses: { 200: jsonResponse('The secret.', ParentCodeSecret), ...errorResponses(401, 403) },
});

const rotateParentCodeRoute = createRoute({
  method: 'post',
  path: '/v1/family/parent-code/rotate',
  tags: ['family'],
  summary: 'Replace the parent-code secret',
  description: 'Old codes stop working once devices sync.',
  security: bearer,
  responses: { 200: jsonResponse('The new secret.', ParentCodeSecret), ...errorResponses(401, 403) },
});

/**
 * Family settings, parents, message presets and the parent-code secret (docs/SPEC.md §9.2).
 * Every query runs inside `withFamily`, so row-level security limits it to the caller's family.
 * Statements that are not limited by an id also name the family, as a second guard.
 */
export function registerFamilyRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  /** The family row, read through row-level security. */
  async function readFamily(familyId: string) {
    const [row] = await withFamily(db, familyId, (tx) => tx.select().from(families).where(eq(families.id, familyId)));
    if (!row) throw new ApiError('unauthorized', 'Sign in again.');
    return row;
  }

  app.openapi(getFamilyRoute, async (c) => {
    const { familyId } = await caller(c);
    return c.json(toFamily(await readFamily(familyId)), 200);
  });

  app.openapi(patchFamilyRoute, async (c) => {
    const { familyId } = await caller(c);
    const patch = c.req.valid('json');
    const [row] = await withFamily(db, familyId, (tx) =>
      Object.keys(patch).length === 0
        ? tx.select().from(families).where(eq(families.id, familyId))
        : tx.update(families).set(patch).where(eq(families.id, familyId)).returning(),
    );
    if (!row) throw new ApiError('unauthorized', 'Sign in again.');
    // Devices hold the time zone and emergency number (docs/SPEC.md §8.2).
    if (Object.keys(patch).length > 0) await stateChanged(deps, familyId, {});
    return c.json(toFamily(row), 200);
  });

  app.openapi(listParentsRoute, async (c) => {
    const { familyId } = await caller(c);
    const rows = await withFamily(db, familyId, (tx) =>
      tx.select().from(parents).where(isNull(parents.disabledAt)).orderBy(asc(parents.createdAt), asc(parents.id)),
    );
    return c.json(rows.map(toParent), 200);
  });

  app.openapi(addParentRoute, async (c) => {
    const { familyId } = await caller(c);
    const body = c.req.valid('json');
    try {
      const [row] = await withFamily(db, familyId, (tx) =>
        tx
          .insert(parents)
          .values({
            familyId,
            email: body.email.toLowerCase(),
            displayName: body.displayName,
            phoneE164: body.phoneE164 ?? null,
          })
          .returning(),
      );
      if (!row) throw new Error('parent insert returned nothing');
      // Devices list the parents to call.
      await stateChanged(deps, familyId, {});
      return c.json(toParent(row), 201);
    } catch (err) {
      // Emails are unique across all families, so this can also be a parent of another family.
      if (isUniqueViolation(err)) throw emailTaken();
      throw err;
    }
  });

  app.openapi(patchParentRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const [row] = await withFamily(db, familyId, (tx) => {
      const where = and(eq(parents.id, id), isNull(parents.disabledAt));
      return Object.keys(patch).length === 0
        ? tx.select().from(parents).where(where)
        : tx.update(parents).set(patch).where(where).returning();
    });
    if (!row) throw parentNotFound();
    if (Object.keys(patch).length > 0) await stateChanged(deps, familyId, {});
    return c.json(toParent(row), 200);
  });

  app.openapi(removeParentRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    if (id === parentId) throw new ApiError('conflict', 'You cannot remove yourself. Ask another parent.');
    await withFamily(db, familyId, async (tx) => {
      const [removed] = await tx
        .update(parents)
        .set({ disabledAt: sql`now()` })
        .where(and(eq(parents.id, id), isNull(parents.disabledAt)))
        .returning({ id: parents.id });
      if (!removed) throw parentNotFound();
      await tx
        .update(parentSessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(parentSessions.parentId, id), isNull(parentSessions.revokedAt)));
    });
    await stateChanged(deps, familyId, {});
    return c.body(null, 204);
  });

  app.openapi(getPresetsRoute, async (c) => {
    const { familyId } = await caller(c);
    const rows = await withFamily(db, familyId, (tx) =>
      tx.select().from(messagePresets).orderBy(asc(messagePresets.sort), asc(messagePresets.id)),
    );
    return c.json(rows.map(({ id, text }) => ({ id, text })), 200);
  });

  app.openapi(putPresetsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { presets } = c.req.valid('json');
    const rows = await withFamily(db, familyId, async (tx) => {
      // Old kid messages keep their text: their preset_id becomes null (ON DELETE SET NULL).
      await tx.delete(messagePresets).where(eq(messagePresets.familyId, familyId));
      if (presets.length === 0) return [];
      return tx
        .insert(messagePresets)
        .values(presets.map((p, sort) => ({ familyId, text: p.text, sort })))
        .returning();
    });
    rows.sort((a, b) => a.sort - b.sort);
    await stateChanged(deps, familyId, {});
    return c.json(rows.map(({ id, text }) => ({ id, text })), 200);
  });

  app.openapi(getParentCodeRoute, async (c) => {
    const { familyId } = await caller(c);
    return c.json({ secret: (await readFamily(familyId)).parentCodeSecret }, 200);
  });

  app.openapi(rotateParentCodeRoute, async (c) => {
    const { familyId } = await caller(c);
    const [row] = await withFamily(db, familyId, (tx) =>
      tx.update(families).set({ parentCodeSecret: newParentCodeSecret() }).where(eq(families.id, familyId)).returning(),
    );
    if (!row) throw new ApiError('unauthorized', 'Sign in again.');
    // Devices check offline parent-mode codes against this secret.
    await stateChanged(deps, familyId, {});
    return c.json({ secret: row.parentCodeSecret }, 200);
  });
}
```

### 5.7 `server/src/devices/routes.ts`

The same as before, plus: `stateChanged` for the device after a rename or pool change, its socket closed when it is revoked, and the sockets of a replaced PC account row closed after enrolment.

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  Device,
  type DeviceForm,
  DeviceMe,
  DevicePatch,
  EnrolmentCode,
  EnrolmentCodeCreate,
  EnrolRequest,
  EnrolResponse,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { clientIp } from '../auth/client-ip.js';
import { requireFamilyParent } from '../auth/guards.js';
import { RateLimiter } from '../auth/rate-limit.js';
import { withFamily } from '../db/family.js';
import { devices, enrolmentCodes, events, families, kids } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { findKid } from '../kids/routes.js';
import { disconnectDevices, notifyParents, stateChanged } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { requireDevice } from './auth.js';
import { hashDeviceToken, newDeviceToken, newEnrolmentCode } from './token.js';

type Router = ReturnType<typeof createRouter>;

/** Enrolment codes work for 10 minutes (docs/SPEC.md §11.3). */
const CODE_TTL = sql`now() + interval '10 minutes'`;

/** Which platform each form runs on. */
const PLATFORM_OF: Record<DeviceForm, 'android' | 'windows'> = { phone: 'android', tablet: 'android', pc: 'windows' };
const FORM_TEXT: Record<DeviceForm, string> = { phone: 'an Android phone', tablet: 'an Android tablet', pc: 'a Windows PC' };

const IdParam = z.object({ id: z.uuid() });
const KidParam = z.object({ kidId: z.uuid() });

function toDevice(row: typeof devices.$inferSelect): Device {
  return {
    id: row.id,
    kidId: row.kidId,
    platform: row.platform as Device['platform'],
    form: row.form as Device['form'],
    pool: row.pool as Device['pool'],
    name: row.name,
    hasCellular: row.hasCellular,
    model: row.model,
    osVersion: row.osVersion,
    appVersion: row.appVersion,
    windowsUserName: row.windowsUserName,
    enrolledAt: row.enrolledAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}

const deviceNotFound = () => new ApiError('not_found', 'No such device in your family.');

const createCodeRoute = createRoute({
  method: 'post',
  path: '/v1/kids/{kidId}/enrolment-codes',
  tags: ['devices'],
  summary: 'Make a code to add a device for a kid',
  description: 'The code works once, for 10 minutes. Show it in large digits and as a QR code of `qrPayload`.',
  security: bearer,
  request: { params: KidParam, body: jsonBody(EnrolmentCodeCreate) },
  responses: { 201: jsonResponse('The code.', EnrolmentCode), ...errorResponses(401, 403, 404, 422) },
});

const listDevicesRoute = createRoute({
  method: 'get',
  path: '/v1/devices',
  tags: ['devices'],
  summary: 'Devices in the family',
  description: 'Revoked devices are left out.',
  security: bearer,
  responses: { 200: jsonResponse('The devices, oldest first.', z.array(Device)), ...errorResponses(401, 403) },
});

const patchDeviceRoute = createRoute({
  method: 'patch',
  path: '/v1/devices/{id}',
  tags: ['devices'],
  summary: 'Rename a device or move it to another pool',
  security: bearer,
  request: { params: IdParam, body: jsonBody(DevicePatch) },
  responses: { 200: jsonResponse('The changed device.', Device), ...errorResponses(401, 403, 404, 422) },
});

const revokeDeviceRoute = createRoute({
  method: 'delete',
  path: '/v1/devices/{id}',
  tags: ['devices'],
  summary: 'Revoke a device',
  description: 'Its token stops working at once. Its history stays.',
  security: bearer,
  request: { params: IdParam },
  responses: { 204: { description: 'Revoked.' }, ...errorResponses(401, 403, 404, 422) },
});

const enrolRoute = createRoute({
  method: 'post',
  path: '/v1/enrol',
  tags: ['devices'],
  summary: 'Enrol a kid device with a code',
  description: 'Called by the kid device. No sign-in: the code is the proof.',
  request: { body: jsonBody(EnrolRequest) },
  responses: {
    201: jsonResponse('Enrolled. Keep the device token safe; it is not shown again.', EnrolResponse),
    ...errorResponses(401, 409, 422, 429),
  },
});

const deviceMeRoute = createRoute({
  method: 'get',
  path: '/v1/device/me',
  tags: ['device'],
  summary: 'The calling device, its kid and family',
  description: 'A 401 means the device was revoked and must be enrolled again.',
  security: deviceBearer,
  responses: { 200: jsonResponse('This device.', DeviceMe), ...errorResponses(401) },
});

/**
 * Enrolment codes, enrolment and device management (docs/SPEC.md §9, §11.2, §11.3).
 * Parent routes run inside `withFamily`. Enrolment has no family yet, so it uses the owner connection.
 */
export function registerDeviceRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);
  // A wrong code matches no row, so guesses are limited per IP instead of per code.
  const enrolsPerIp = new RateLimiter(10, 15 * 60 * 1000);

  /** A code that no unexpired, unused code in any family already has. */
  async function freeCode() {
    for (let i = 0; i < 10; i++) {
      const code = newEnrolmentCode();
      const [taken] = await db
        .select({ id: enrolmentCodes.id })
        .from(enrolmentCodes)
        .where(and(eq(enrolmentCodes.code, code), isNull(enrolmentCodes.consumedAt), gt(enrolmentCodes.expiresAt, sql`now()`)));
      if (!taken) return code;
    }
    throw new Error('no free enrolment code after 10 tries');
  }

  app.openapi(createCodeRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const { form } = c.req.valid('json');
    const code = await freeCode();
    const row = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const [saved] = await tx
        .insert(enrolmentCodes)
        .values({ familyId, kidId, form, code, expiresAt: CODE_TTL, createdBy: parentId })
        .returning();
      if (!saved) throw new Error('enrolment code insert returned nothing');
      return saved;
    });
    // The host the parent app used is the one the kid device can reach (the public hostname in production).
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    const qrPayload = `screentime://enrol?host=${encodeURIComponent(host)}&code=${code}`;
    return c.json({ code, qrPayload, expiresAt: row.expiresAt.toISOString() }, 201);
  });

  app.openapi(listDevicesRoute, async (c) => {
    const { familyId } = await caller(c);
    const rows = await withFamily(db, familyId, (tx) =>
      tx.select().from(devices).where(isNull(devices.revokedAt)).orderBy(asc(devices.enrolledAt), asc(devices.id)),
    );
    return c.json(rows.map(toDevice), 200);
  });

  app.openapi(patchDeviceRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const [row] = await withFamily(db, familyId, (tx) => {
      const where = and(eq(devices.id, id), isNull(devices.revokedAt));
      return Object.keys(patch).length === 0
        ? tx.select().from(devices).where(where)
        : tx.update(devices).set(patch).where(where).returning();
    });
    if (!row) throw deviceNotFound();
    // A new name or pool changes what the device shows and counts.
    if (Object.keys(patch).length > 0) await stateChanged(deps, familyId, { deviceId: id });
    return c.json(toDevice(row), 200);
  });

  app.openapi(revokeDeviceRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const [revoked] = await withFamily(db, familyId, (tx) =>
      tx
        .update(devices)
        .set({ revokedAt: sql`now()`, fcmToken: null })
        .where(and(eq(devices.id, id), isNull(devices.revokedAt)))
        .returning({ id: devices.id }),
    );
    if (!revoked) throw deviceNotFound();
    disconnectDevices(deps, [revoked.id]);
    return c.body(null, 204);
  });

  app.openapi(enrolRoute, async (c) => {
    if (!enrolsPerIp.hit(clientIp(c))) throw new ApiError('rate_limited', 'Too many enrolment attempts. Try again later.');
    const body = c.req.valid('json');
    const wrongCode = () => new ApiError('unauthorized', 'That code is wrong or has expired. Ask a parent for a new one.');
    const deviceToken = newDeviceToken();
    let replaced: { id: string }[] = [];
    const result = await db.transaction(async (tx) => {
      // Lock the code so two devices cannot use it at the same moment.
      const [found] = await tx
        .select({ code: enrolmentCodes, kid: kids, family: families })
        .from(enrolmentCodes)
        .innerJoin(kids, eq(kids.id, enrolmentCodes.kidId))
        .innerJoin(families, eq(families.id, enrolmentCodes.familyId))
        .where(
          and(
            eq(enrolmentCodes.code, body.code),
            isNull(enrolmentCodes.consumedAt),
            gt(enrolmentCodes.expiresAt, sql`now()`),
            isNull(kids.archivedAt),
            isNull(families.disabledAt),
          ),
        )
        .orderBy(desc(enrolmentCodes.createdAt))
        .limit(1)
        .for('update', { of: enrolmentCodes });
      if (!found) throw wrongCode();
      const { code, kid, family } = found;
      const form = code.form as DeviceForm;
      if (PLATFORM_OF[form] !== body.platform) throw new ApiError('conflict', `This code is for ${FORM_TEXT[form]}.`);

      if (body.platform === 'windows') {
        // Installing again on the same PC account replaces the old device row.
        replaced = await tx
          .update(devices)
          .set({ revokedAt: sql`now()`, fcmToken: null })
          .where(
            and(
              eq(devices.familyId, family.id),
              eq(devices.machineId, body.machineId ?? ''),
              eq(devices.windowsUserSid, body.windowsUserSid ?? ''),
              isNull(devices.revokedAt),
            ),
          )
          .returning({ id: devices.id });
      }
      const name = (body.platform === 'windows' ? `${body.windowsUserName} on ${body.model}` : body.model).slice(0, 40);
      const [device] = await tx
        .insert(devices)
        .values({
          familyId: family.id,
          kidId: kid.id,
          platform: body.platform,
          form,
          pool: form === 'phone' ? 'phone' : 'screens',
          name,
          hasCellular: body.hasCellular,
          model: body.model,
          osVersion: body.osVersion,
          appVersion: body.appVersion,
          machineId: body.machineId ?? null,
          windowsUserSid: body.windowsUserSid ?? null,
          windowsUserName: body.windowsUserName ?? null,
          tokenHash: hashDeviceToken(deviceToken),
          lastSeenAt: sql`now()`,
        })
        .returning();
      if (!device) throw new Error('device insert returned nothing');
      await tx
        .update(enrolmentCodes)
        .set({ consumedAt: sql`now()`, deviceId: device.id })
        .where(eq(enrolmentCodes.id, code.id));
      // Every notification kind is written to events (docs/SPEC.md §13) and pushed once committed.
      const [event] = await tx
        .insert(events)
        .values({
          familyId: family.id,
          kidId: kid.id,
          deviceId: device.id,
          kind: 'device.enrolled',
          at: sql`now()`,
          payload: { name, form, platform: body.platform },
        })
        .returning({ id: events.id });
      if (!event) throw new Error('event insert returned nothing');
      return {
        eventId: event.id,
        familyId: family.id,
        response: {
          deviceId: device.id,
          deviceToken,
          kid: { id: kid.id, name: kid.name },
          family: { name: family.name, timezone: family.timezone },
        },
      };
    });
    disconnectDevices(
      deps,
      replaced.map((d) => d.id),
    );
    await notifyParents(deps, result.familyId, [result.eventId]);
    return c.json(result.response, 201);
  });

  app.openapi(deviceMeRoute, async (c) => {
    const { deviceId } = await requireDevice(c, db);
    const [row] = await db
      .select({ device: devices, kid: kids, family: families })
      .from(devices)
      .innerJoin(kids, eq(kids.id, devices.kidId))
      .innerJoin(families, eq(families.id, devices.familyId))
      .where(eq(devices.id, deviceId));
    if (!row) throw new ApiError('unauthorized', 'This device is not enrolled.');
    const { device, kid, family } = row;
    return c.json(
      {
        device: {
          id: device.id,
          name: device.name,
          form: device.form as DeviceForm,
          pool: device.pool as Device['pool'],
          hasCellular: device.hasCellular,
        },
        kid: { id: kid.id, name: kid.name },
        family: { timezone: family.timezone, emergencyNumber: family.emergencyNumber },
      },
      200,
    );
  });
}
```

### 5.8 `server/src/sync/routes.ts`

The same as before, except the usage upload also returns the device's pool and, after the commit, sends `state_changed` by WebSocket only to the kid's other devices in that pool. `Pool` was already imported as a type.

```typescript
import { createHash } from 'node:crypto';
import { createRoute } from '@hono/zod-openapi';
import { and, asc, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import {
  type AvatarColor,
  type DeviceForm,
  DeviceState,
  type Pool,
  Today,
  UsageReceipt,
  type UsageSegmentIn,
  UsageUpload,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { withFamily } from '../db/family.js';
import {
  devices,
  families,
  grants,
  kidContacts,
  kids,
  messagePresets,
  parentModeSessions,
  parents,
  scheduleVersions,
  sosIncidents,
  timeRequests,
  usageSegments,
} from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { toSchedule } from '../kids/routes.js';
import { notifyParents, stateChanged } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { activeParentModes, dayGrants, daySegments, familyDay, poolStatus } from './day.js';
import { recordOverspend } from './overspend.js';

type Router = ReturnType<typeof createRouter>;

const POOLS: Pool[] = ['screens', 'phone'];

const stateRoute = createRoute({
  method: 'get',
  path: '/v1/device/state',
  tags: ['device'],
  summary: 'Everything this device needs to enforce',
  description:
    'Send the last `stateVersion` as `If-None-Match` to get 304 when nothing changed. A 304 has no body; use its `Date` header as the server time.',
  security: deviceBearer,
  responses: {
    200: {
      ...jsonResponse('The snapshot.', DeviceState),
      headers: { ETag: { description: 'The `stateVersion` in quotes.', schema: { type: 'string' } } },
    },
    304: { description: 'Nothing changed since the `stateVersion` sent in `If-None-Match`.' },
    ...errorResponses(401),
  },
});

const usageRoute = createRoute({
  method: 'post',
  path: '/v1/device/usage',
  tags: ['device'],
  summary: 'Upload usage segments',
  description:
    'Safe to send again. A segment sent again keeps its first `startedAt` and the latest `endedAt`; once closed it never reopens.',
  security: deviceBearer,
  request: { body: jsonBody(UsageUpload) },
  responses: { 200: jsonResponse('Stored.', UsageReceipt), ...errorResponses(401, 422) },
});

const todayRoute = createRoute({
  method: 'get',
  path: '/v1/today',
  tags: ['parent'],
  summary: 'Used and remaining time today for every kid and pool',
  security: bearer,
  responses: { 200: jsonResponse('The dashboard.', Today), ...errorResponses(401, 403) },
});

/** True if the `If-None-Match` header names this version. Proxies may weaken the tag to `W/"..."`. */
function matchesVersion(header: string | undefined, version: string) {
  if (!header) return false;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '').replace(/"/g, '') === version);
}

/** The later of two end times. An open end (null) only wins when both are open: a closed segment never reopens. */
function laterEnd(a: string | null, b: string | null) {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Joins repeats of one segment id in a single upload, by the same rule the database applies. */
function mergeRepeats(segments: UsageSegmentIn[]) {
  const byId = new Map<string, UsageSegmentIn>();
  for (const s of segments) {
    const prev = byId.get(s.id);
    if (!prev) {
      byId.set(s.id, s);
      continue;
    }
    byId.set(s.id, {
      ...prev,
      endedAt: laterEnd(prev.endedAt, s.endedAt),
      recordedOffline: prev.recordedOffline || s.recordedOffline,
    });
  }
  return [...byId.values()];
}

/** The device state snapshot, usage upload and the parent dashboard (docs/SPEC.md §8, §9.2, §9.3). */
export function registerSyncRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(stateRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const state = await withFamily(db, familyId, async (tx) => {
      const [row] = await tx
        .select({ device: devices, kid: kids, family: families })
        .from(devices)
        .innerJoin(kids, eq(kids.id, devices.kidId))
        .innerJoin(families, eq(families.id, devices.familyId))
        .where(eq(devices.id, deviceId));
      if (!row) throw new Error('device vanished after requireDevice');
      const { device, kid, family } = row;
      const pool = device.pool as Pool;
      const day = await familyDay(tx, family.timezone);

      const [schedule] = await tx
        .select()
        .from(scheduleVersions)
        .where(eq(scheduleVersions.kidId, kidId))
        .orderBy(desc(scheduleVersions.version))
        .limit(1);
      if (!schedule) throw new Error(`kid ${kidId} has no schedule`);
      const familyParents = await tx
        .select({ id: parents.id, displayName: parents.displayName, phoneE164: parents.phoneE164 })
        .from(parents)
        .where(isNull(parents.disabledAt))
        .orderBy(asc(parents.createdAt), asc(parents.id));
      const contacts = await tx
        .select({ label: kidContacts.label, phoneE164: kidContacts.phoneE164 })
        .from(kidContacts)
        .where(eq(kidContacts.kidId, kidId))
        .orderBy(asc(kidContacts.sort), asc(kidContacts.id));
      const presets = await tx
        .select({ id: messagePresets.id, text: messagePresets.text })
        .from(messagePresets)
        .orderBy(asc(messagePresets.sort), asc(messagePresets.id));
      const poolGrants = await dayGrants(tx, day, and(eq(grants.kidId, kidId), eq(grants.pool, pool)));
      const poolSegments = await daySegments(tx, day, and(eq(usageSegments.kidId, kidId), eq(usageSegments.pool, pool)));
      const [parentMode] = await activeParentModes(tx, eq(parentModeSessions.deviceId, deviceId));
      const [pending] = await tx
        .select({ id: timeRequests.id, minutes: timeRequests.minutes, createdAt: timeRequests.createdAt })
        .from(timeRequests)
        .where(
          and(
            eq(timeRequests.kidId, kidId),
            eq(timeRequests.pool, pool),
            eq(timeRequests.status, 'pending'),
            gte(timeRequests.createdAt, day.dayStart),
          ),
        )
        .orderBy(desc(timeRequests.createdAt))
        .limit(1);
      const [sos] = await tx
        .select({ id: sosIncidents.id, startedAt: sosIncidents.startedAt })
        .from(sosIncidents)
        .where(and(eq(sosIncidents.kidId, kidId), isNull(sosIncidents.endedAt), gt(sosIncidents.autoStopAt, sql`now()`)))
        .orderBy(desc(sosIncidents.startedAt))
        .limit(1);

      return {
        serverTime: day.now.toISOString(),
        content: {
          device: { id: device.id, name: device.name, form: device.form as DeviceForm, pool, hasCellular: device.hasCellular },
          kid: { id: kid.id, name: kid.name },
          family: { timezone: family.timezone, emergencyNumber: family.emergencyNumber, parentCodeSecret: family.parentCodeSecret },
          parents: familyParents,
          contacts,
          messagePresets: presets,
          schedule: toSchedule(schedule),
          today: {
            date: day.date,
            grants: poolGrants.map((g) => ({ id: g.id, minutes: g.minutes, createdAt: g.createdAt.toISOString(), byName: g.byName })),
            poolSegments: poolSegments.map((s) => ({
              id: s.id,
              deviceId: s.deviceId,
              startedAt: s.startedAt.toISOString(),
              endedAt: s.endedAt?.toISOString() ?? null,
            })),
          },
          parentMode: parentMode
            ? { active: true, endsAt: parentMode.endsAt?.toISOString() ?? null, byName: parentMode.byName }
            : { active: false, endsAt: null, byName: null },
          pendingRequest: pending ? { id: pending.id, minutes: pending.minutes, createdAt: pending.createdAt.toISOString() } : null,
          activeSos: sos ? { id: sos.id, startedAt: sos.startedAt.toISOString() } : null,
        },
      };
    });

    // The version covers everything except the clock, so it only changes when the device must act.
    const stateVersion = createHash('sha256').update(JSON.stringify(state.content)).digest('hex').slice(0, 32);
    c.header('ETag', `"${stateVersion}"`);
    if (matchesVersion(c.req.header('if-none-match'), stateVersion)) return c.body(null, 304);
    return c.json({ serverTime: state.serverTime, stateVersion, ...state.content }, 200);
  });

  app.openapi(usageRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const segments = mergeRepeats(c.req.valid('json').segments);
    const stored = await withFamily(db, familyId, async (tx) => {
      const [device] = await tx.select({ pool: devices.pool }).from(devices).where(eq(devices.id, deviceId));
      if (!device) throw new Error('device vanished after requireDevice');
      const rows = await tx
        .insert(usageSegments)
        .values(
          segments.map((s) => ({
            id: s.id,
            familyId,
            kidId,
            deviceId,
            // A segment stays in the pool the device had when the segment first arrived.
            pool: device.pool,
            startedAt: new Date(s.startedAt),
            endedAt: s.endedAt === null ? null : new Date(s.endedAt),
            recordedOffline: s.recordedOffline,
          })),
        )
        .onConflictDoUpdate({
          target: usageSegments.id,
          set: {
            endedAt: sql`case
              when ${usageSegments.endedAt} is null then excluded.ended_at
              when excluded.ended_at is null then ${usageSegments.endedAt}
              else greatest(${usageSegments.endedAt}, excluded.ended_at) end`,
            recordedOffline: sql`${usageSegments.recordedOffline} or excluded.recorded_offline`,
            receivedAt: sql`now()`,
          },
          // Another device's segment with the same id is left alone.
          setWhere: sql`${usageSegments.deviceId} = excluded.device_id`,
        })
        .returning({ id: usageSegments.id });
      const storedIds = new Set(rows.map((r) => r.id));
      const offline = segments.some((s) => s.recordedOffline && storedIds.has(s.id));
      return {
        received: rows.length,
        pool: device.pool as Pool,
        overspendEventId: offline ? await recordOverspend(tx, kidId, deviceId) : null,
      };
    });
    if (stored.overspendEventId) await notifyParents(deps, familyId, [stored.overspendEventId]);
    // The kid's other devices in this pool count these segments too. WebSocket only: this comes every minute.
    if (stored.received > 0) {
      await stateChanged(deps, familyId, { kidId, pool: stored.pool, exceptDeviceId: deviceId }, false);
    }
    return c.json({ received: stored.received }, 200);
  });

  app.openapi(todayRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const today = await withFamily(db, familyId, async (tx) => {
      const [family] = await tx.select().from(families).where(eq(families.id, familyId));
      if (!family) throw new Error('family vanished after requireFamilyParent');
      const day = await familyDay(tx, family.timezone);
      const kidRows = await tx.select().from(kids).where(isNull(kids.archivedAt)).orderBy(asc(kids.createdAt), asc(kids.id));
      const schedules = await tx
        .selectDistinctOn([scheduleVersions.kidId])
        .from(scheduleVersions)
        .orderBy(scheduleVersions.kidId, desc(scheduleVersions.version));
      const deviceRows = await tx
        .select()
        .from(devices)
        .where(isNull(devices.revokedAt))
        .orderBy(asc(devices.enrolledAt), asc(devices.id));
      const allGrants = await dayGrants(tx, day);
      const allSegments = await daySegments(tx, day);
      const modes = await activeParentModes(tx);

      return {
        serverTime: day.now.toISOString(),
        date: day.date,
        kids: kidRows.map((kid) => {
          const scheduleRow = schedules.find((s) => s.kidId === kid.id);
          if (!scheduleRow) throw new Error(`kid ${kid.id} has no schedule`);
          const schedule = toSchedule(scheduleRow);
          return {
            id: kid.id,
            name: kid.name,
            avatarColor: kid.avatarColor as AvatarColor,
            pools: POOLS.map((pool) => {
              const poolGrants = allGrants.filter((g) => g.kidId === kid.id && g.pool === pool);
              const poolSegments = allSegments.filter((s) => s.kidId === kid.id && s.pool === pool);
              const status = poolStatus(family.timezone, day, schedule, pool, poolGrants, poolSegments);
              return {
                pool,
                allowanceMin: status.allowanceMin,
                grantedMin: poolGrants.reduce((sum, g) => sum + g.minutes, 0),
                usedSec: status.usedSec,
                remainingSec: status.remainingSec,
                locked: status.locked,
                lockReason: status.lockReason,
                nextLockAt: status.nextLockAt,
                overspendSec: status.overspendSec,
                devices: deviceRows
                  .filter((d) => d.kidId === kid.id && d.pool === pool)
                  .map((d) => {
                    const mode = modes.find((m) => m.deviceId === d.id);
                    return {
                      id: d.id,
                      name: d.name,
                      form: d.form as DeviceForm,
                      inUse: poolSegments.some((s) => s.deviceId === d.id && s.endedAt === null),
                      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
                      parentMode: mode ? { endsAt: mode.endsAt?.toISOString() ?? null, byName: mode.byName } : null,
                    };
                  }),
              };
            }),
          };
        }),
      };
    });
    return c.json(today, 200);
  });
}
```

### 5.9 `server/src/app.ts`

`createApp` now makes a `LiveHub` (unless one is passed in `deps.hub`), creates the WebSocket helper, registers the route, and returns the app with `injectWebSocket` and `hub` attached.

```typescript
import { createRoute } from '@hono/zod-openapi';
import { createNodeWebSocket } from '@hono/node-ws';
import { logger } from 'hono/logger';
import { ErrorResponse, HealthResponse } from '@screentime/schemas';
import { registerAdminRoutes } from './admin/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { registerDeviceRoutes } from './devices/routes.js';
import { registerFamilyRoutes } from './family/routes.js';
import { registerGrantRoutes } from './grants/routes.js';
import { registerKidRoutes } from './kids/routes.js';
import { LiveHub } from './live/hub.js';
import { registerLiveRoutes } from './live/routes.js';
import type { Mailer } from './mailer.js';
import { registerNotifyRoutes } from './notify/routes.js';
import type { Pusher } from './push.js';
import { createRouter } from './router.js';
import { registerSyncRoutes } from './sync/routes.js';

/** What the routes need at request time. Tests pass their own. */
export interface AppDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
  /** Sends FCM pushes. Left out, nothing is sent (tests that do not check pushes). */
  pusher?: Pusher;
  /** The connected kid devices. Left out, the app makes its own. */
  hub?: LiveHub;
}

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['public'],
  summary: 'Check that the server is up',
  responses: {
    200: {
      description: 'The server is up.',
      content: { 'application/json': { schema: HealthResponse } },
    },
    500: {
      description: 'Unexpected server error.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

/**
 * Builds the whole API. Each call has its own rate-limit counters and its own hub of connected devices.
 * `injectWebSocket` must be called with the HTTP server so that `/v1/device/ws` can upgrade.
 */
export function createApp(appDeps: AppDeps) {
  const app = createRouter();
  const deps = { ...appDeps, hub: appDeps.hub ?? new LiveHub() };
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  if (process.env.NODE_ENV !== 'test') {
    app.use(logger());
  }

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'deviceAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'The opaque device token from POST /v1/enrol.',
  });

  app.openapi(healthRoute, (c) => {
    const body = HealthResponse.parse({
      status: 'ok',
      service: 'screentime-server',
      time: new Date().toISOString(),
    });
    return c.json(body, 200);
  });

  registerAuthRoutes(app, deps);
  registerFamilyRoutes(app, deps);
  registerKidRoutes(app, deps);
  registerDeviceRoutes(app, deps);
  registerSyncRoutes(app, deps);
  registerGrantRoutes(app, deps);
  registerNotifyRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerLiveRoutes(app, deps, upgradeWebSocket);

  return Object.assign(app, { injectWebSocket, hub: deps.hub });
}

/** The OpenAPI 3.1 document for every route (written to contract/openapi.json). */
export function openApiDocument(): ReturnType<ReturnType<typeof createApp>['getOpenAPI31Document']> {
  // Building the document never runs a handler, so the routes need no real database, settings, mailer or pusher.
  const app = createApp({} as AppDeps);
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'Screen Time API', version: '0.1.0' },
  });
}
```

### 5.10 `server/src/index.ts`

Keeps the server returned by `serve` and calls `app.injectWebSocket(server)`.

```typescript
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
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

const app = createApp({
  db,
  config,
  mailer: createMailer(config.smtp),
  pusher: createPusher(config.firebaseServiceAccountJson),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`screentime-server listening on http://localhost:${info.port}`);
});
// Lets GET /v1/device/ws upgrade to a WebSocket (docs/SPEC.md §8.3).
app.injectWebSocket(server);
```

### 5.11 `server/test/live.test.ts`

Three `LiveHub` tests that need no database, and five that start the app on a free local port (`port: 0`) and connect with real WebSockets. The test hub closes silent sockets after 400 ms instead of 75 s, so the test clients ping every 100 ms.

```typescript
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Envelope } from '@screentime/schemas';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import { CLOSE_IDLE, CLOSE_REVOKED, LiveHub, type LiveSocket } from '../src/live/hub.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const msg = (type: string): Envelope => ({ v: 1, type, at: new Date().toISOString(), data: {} });

/** A socket that records what it was sent. */
function fakeSocket() {
  const sent: string[] = [];
  const closed: number[] = [];
  const socket: LiveSocket = {
    send: (data) => sent.push(data),
    close: (code) => closed.push(code ?? 0),
  };
  return { socket, sent, closed };
}

describe('LiveHub', () => {
  it('sends to every socket of the named devices only', () => {
    const hub = new LiveHub();
    const a1 = fakeSocket();
    const a2 = fakeSocket();
    const b = fakeSocket();
    hub.add('a', a1.socket);
    hub.add('a', a2.socket);
    hub.add('b', b.socket);
    expect(hub.send(['a'], msg('state_changed'))).toBe(2);
    expect(JSON.parse(a1.sent[0] ?? '')).toMatchObject({ v: 1, type: 'state_changed' });
    expect(a2.sent).toHaveLength(1);
    expect(b.sent).toEqual([]);
    expect(hub.send(['nobody'], msg('state_changed'))).toBe(0);
  });

  it('forgets removed sockets and closes revoked devices', () => {
    const hub = new LiveHub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add('a', a.socket);
    hub.add('b', b.socket);
    hub.remove('a', a.socket);
    expect(hub.count('a')).toBe(0);
    expect(hub.send(['a'], msg('x'))).toBe(0);
    hub.close(['b'], CLOSE_REVOKED, 'gone');
    expect(b.closed).toEqual([CLOSE_REVOKED]);
    expect(hub.count('b')).toBe(0);
  });

  it('keeps sending to the others when one socket throws', () => {
    const hub = new LiveHub();
    const good = fakeSocket();
    hub.add('a', {
      send: () => {
        throw new Error('broken pipe');
      },
      close: () => {},
    });
    hub.add('a', good.socket);
    const error = console.error;
    console.error = () => {};
    try {
      expect(hub.send(['a'], msg('x'))).toBe(1);
    } finally {
      console.error = error;
    }
    expect(good.sent).toHaveLength(1);
  });
});

/** Every day the same, with no curfew, so the result does not depend on the weekday or the hour. */
const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

/** A connected test client that keeps every envelope it receives. */
interface Client {
  ws: WebSocket;
  received: Envelope[];
  /** Resolves with the next envelope of this type (or one already received). */
  next(type: string): Promise<Envelope>;
  closed: Promise<number>;
}

describe.skipIf(!url)('device WebSocket', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const pushed: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      pushed.push(...messages);
      return [];
    },
  };
  const hub = new LiveHub({ idleMs: 400 });
  const app = createApp({ db, config: testConfig(url ?? ''), mailer, pusher, hub });
  let server: ServerType;
  let base = '';

  let familyA = '';
  let familyB = '';
  let mum = '';

  /** Waits until `check` is true, for at most 2 seconds. */
  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(check()).toBe(true);
  }

  /** Sleeps a little so a message that should not come would have arrived. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  async function call(method: string, path: string, token: string, body?: unknown) {
    const res = await fetch(`http://${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.status;
  }

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'phone' | 'tablet' | 'pc', fcmToken: string | null = null) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: form === 'pc' ? 'windows' : 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name: form,
        tokenHash: hashDeviceToken(token),
        fcmToken,
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  /**
   * Opens a socket with the device token and waits until the server has it. It pings every 100 ms, as a
   * real device does every 30 s, unless `ping` is false.
   */
  function connect(deviceId: string, token: string, ping = true): Promise<Client> {
    const ws = new WebSocket(`ws://${base}/v1/device/ws`, { headers: { authorization: `Bearer ${token}` } });
    const received: Envelope[] = [];
    const waiters: Array<{ type: string; resolve: (m: Envelope) => void }> = [];
    ws.on('message', (data) => {
      const envelope = JSON.parse(String(data)) as Envelope;
      // Answers to the automatic pings are not kept.
      if (ping && envelope.type === 'pong') return;
      received.push(envelope);
      for (const w of waiters.filter((x) => x.type === envelope.type)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(envelope);
      }
    });
    const pinger = ping ? setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), 100) : undefined;
    const closed = new Promise<number>((resolve) =>
      ws.on('close', (code) => {
        clearInterval(pinger);
        resolve(code);
      }),
    );
    const next = (type: string) =>
      new Promise<Envelope>((resolve) => {
        const already = received.find((m) => m.type === type);
        if (already) resolve(already);
        else waiters.push({ type, resolve });
      });
    return new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('open', async () => {
        // The server registers the socket just after the upgrade.
        await waitFor(() => hub.count(deviceId) > 0);
        resolve({ ws, received, next, closed });
      });
    });
  }

  /** The HTTP status of a refused upgrade. */
  function refusedStatus(token: string | null): Promise<number> {
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    const ws = new WebSocket(`ws://${base}/v1/device/ws`, { headers });
    return new Promise((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('the upgrade was accepted')));
      ws.on('error', () => {});
    });
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    familyA = a?.id ?? '';
    familyB = b?.id ?? '';
    const [p1] = await db
      .insert(parents)
      .values([{ familyId: familyA, email: 'mum@example.com', displayName: 'Mum' }])
      .returning();
    mum = await tokenFor({ parentId: p1?.id ?? '', familyId: familyA });
    server = serve({ fetch: app.fetch, port: 0 });
    app.injectWebSocket(server);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  it('refuses an upgrade without a valid device token, and plain requests', async () => {
    expect(await refusedStatus(null)).toBe(401);
    expect(await refusedStatus('not-a-token')).toBe(401);
    const kidId = await addKid(familyA, 'Gone kid');
    const gone = await addDevice(familyA, kidId, 'pc');
    await call('DELETE', `/v1/devices/${gone.id}`, mum);
    expect(await refusedStatus(gone.token)).toBe(401);
    const plain = await fetch(`http://${base}/v1/device/ws`, { headers: { authorization: `Bearer ${gone.token}` } });
    expect(plain.status).toBe(401);
    const kid2 = await addKid(familyA, 'Plain kid');
    const live = await addDevice(familyA, kid2, 'pc');
    const notUpgrade = await fetch(`http://${base}/v1/device/ws`, { headers: { authorization: `Bearer ${live.token}` } });
    expect(notUpgrade.status).toBe(422);
  });

  it('answers ping with pong and closes a socket that goes quiet', async () => {
    const kidId = await addKid(familyA, 'Ping kid');
    const pc = await addDevice(familyA, kidId, 'pc');
    const client = await connect(pc.id, pc.token, false);
    client.ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await client.next('pong');
    expect(pong).toMatchObject({ v: 1, type: 'pong', data: {} });
    expect(Math.abs(Date.parse(pong.at) - Date.now())).toBeLessThan(5000);
    // Not JSON, and unknown types: ignored, but they still count as signs of life.
    client.ws.send('hello');
    client.ws.send(JSON.stringify({ type: 'something' }));
    // The test hub closes after 400 ms of silence (the real one after 75 s).
    expect(await client.closed).toBe(CLOSE_IDLE);
    await waitFor(() => hub.count(pc.id) === 0);
  });

  it('sends a grant to the devices in its pool, and by FCM only to Android', async () => {
    const kidId = await addKid(familyA, 'Grant kid');
    const otherKid = await addKid(familyA, 'Other kid');
    const pc = await addDevice(familyA, kidId, 'pc');
    const tablet = await addDevice(familyA, kidId, 'tablet', 'fcm-tablet');
    const phone = await addDevice(familyA, kidId, 'phone', 'fcm-phone');
    const other = await addDevice(familyA, otherKid, 'pc');
    const clients = await Promise.all([pc, tablet, phone, other].map((d) => connect(d.id, d.token)));
    const [pcClient, tabletClient, phoneClient, otherClient] = clients;
    pushed.length = 0;

    const id = randomUUID();
    expect(await call('POST', `/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 15 })).toBe(201);
    for (const client of [pcClient, tabletClient]) {
      expect(await client?.next('grant_added')).toMatchObject({
        type: 'grant_added',
        data: { grant: { id, minutes: 15, byName: 'Mum' }, byName: 'Mum' },
      });
    }
    await settle();
    expect(phoneClient?.received).toEqual([]);
    expect(otherClient?.received).toEqual([]);
    expect(pushed.map((p) => p.token)).toEqual(['fcm-tablet']);
    for (const client of clients) client?.ws.close();
  });

  it('tells devices to sync when their state changes', async () => {
    const kidId = await addKid(familyA, 'State kid');
    const otherKid = await addKid(familyA, 'Sibling');
    const pc = await addDevice(familyA, kidId, 'pc');
    const tablet = await addDevice(familyA, kidId, 'tablet', 'fcm-state-tablet');
    const sibling = await addDevice(familyA, otherKid, 'pc');
    const elsewhere = await addDevice(familyB, await addKid(familyB, 'Far kid'), 'pc');
    const [pcClient, tabletClient, siblingClient, elsewhereClient] = await Promise.all(
      [pc, tablet, sibling, elsewhere].map((d) => connect(d.id, d.token)),
    );
    const clear = () => {
      for (const c of [pcClient, tabletClient, siblingClient, elsewhereClient]) c?.received.splice(0);
      pushed.length = 0;
    };

    // A kid's schedule: only that kid's devices, by WebSocket and by FCM at normal priority.
    const week = flatWeek.map((d) => ({ ...d, screensMin: 90 }));
    clear();
    expect(await call('PUT', `/v1/kids/${kidId}/schedule`, mum, { warn1Min: 15, warn2Min: 5, days: week })).toBe(200);
    expect(await pcClient?.next('state_changed')).toMatchObject({ v: 1, type: 'state_changed', data: {} });
    await tabletClient?.next('state_changed');
    await settle();
    expect(siblingClient?.received).toEqual([]);
    expect(pushed).toMatchObject([{ token: 'fcm-state-tablet', high: false, ttlSec: 86400, msg: { type: 'state_changed' } }]);

    // Contacts and the kid's name: the same.
    clear();
    await call('PUT', `/v1/kids/${kidId}/contacts`, mum, { contacts: [{ label: 'Grandma', phoneE164: '+61400000001' }] });
    await pcClient?.next('state_changed');
    clear();
    await call('PATCH', `/v1/kids/${kidId}`, mum, { name: 'State kid 2' });
    await pcClient?.next('state_changed');

    // Family-wide settings: every device of the family, none of another family.
    for (const [method, path, body] of [
      ['PATCH', '/v1/family', { emergencyNumber: '112' }],
      ['PUT', '/v1/family/message-presets', { presets: [{ text: 'Hi' }] }],
      ['POST', '/v1/family/parent-code/rotate', undefined],
      ['POST', '/v1/family/parents', { email: 'dad@example.com', displayName: 'Dad' }],
    ] as const) {
      clear();
      expect(await call(method, path, mum, body)).toBeLessThan(300);
      await Promise.all([pcClient, tabletClient, siblingClient].map((c) => c?.next('state_changed')));
      await settle();
      expect(elsewhereClient?.received, `${method} ${path}`).toEqual([]);
    }

    // A device rename: only that device.
    clear();
    await call('PATCH', `/v1/devices/${tablet.id}`, mum, { name: 'XPPen' });
    await tabletClient?.next('state_changed');
    await settle();
    expect(pcClient?.received).toEqual([]);

    // A usage upload: the kid's other devices in the pool, by WebSocket only.
    clear();
    const segment = { id: randomUUID(), startedAt: new Date(Date.now() - 60_000).toISOString(), endedAt: null, recordedOffline: false };
    expect(await call('POST', '/v1/device/usage', tablet.token, { segments: [segment] })).toBe(200);
    await pcClient?.next('state_changed');
    await settle();
    expect(tabletClient?.received).toEqual([]);
    expect(siblingClient?.received).toEqual([]);
    expect(pushed).toEqual([]);

    for (const c of [pcClient, tabletClient, siblingClient, elsewhereClient]) c?.ws.close();
  });

  it('disconnects a device when it is revoked or its kid is archived', async () => {
    const kidId = await addKid(familyA, 'Revoked kid');
    const pc = await addDevice(familyA, kidId, 'pc');
    const tablet = await addDevice(familyA, kidId, 'tablet');
    const pcClient = await connect(pc.id, pc.token);
    const tabletClient = await connect(tablet.id, tablet.token);
    expect(await call('DELETE', `/v1/devices/${pc.id}`, mum)).toBe(204);
    expect(await pcClient.closed).toBe(CLOSE_REVOKED);
    expect(hub.count(pc.id)).toBe(0);
    expect(hub.count(tablet.id)).toBe(1);
    expect(await call('DELETE', `/v1/kids/${kidId}`, mum)).toBe(204);
    expect(await tabletClient.closed).toBe(CLOSE_REVOKED);
  });
});
```

## 6. Detailed spec

### 6.1 `GET /v1/device/ws`

- The upgrade request must carry `Authorization: Bearer <deviceToken>`. Missing, wrong, revoked device, archived kid or disabled family: **401**, no socket (the same rules as every device route; it also updates `last_seen_at`).
- A request to this path that is not a WebSocket upgrade, with a good token: **422** `Connect to this address with a WebSocket.`
- Once open, the socket is added to the hub under the device id. A device may have more than one socket at a time.
- Device to server: `{ "type": "ping" }` → the server answers `{ "v": 1, "type": "pong", "at": "<server time ISO>", "data": {} }`. Any other text (not JSON, or another type) is ignored. Every message from the device restarts the idle timer.
- No message for `hub.idleMs` (75 000 ms; tests use 400): the server closes the socket with code **4408**.
- When a socket closes for any reason it is removed from the hub.

### 6.2 What is sent, and to whom

`sendToDevices(deps, familyId, target, msg, fcm)` picks the family's devices that are not revoked and match every field given in `target` (`kidId`, `pool`, `deviceId`, and `exceptDeviceId` to leave one out). It sends `msg` by WebSocket to each of them that is connected, then, if `fcm` is given and a pusher is configured, by FCM to the Android ones with a push token, using `fcm.high` and `fcm.ttlSec`. Errors are caught and logged (`push to kid devices failed`).

| After | Message | Target | FCM |
|---|---|---|---|
| A new grant or lock now (not a repeated id) | `grant_added` `{ grant, byName }` | `{ kidId, pool }` | high, until local midnight (as in CARD-016) |
| `PATCH /v1/kids/{kidId}` with fields, `PUT .../schedule`, `PUT .../contacts` | `state_changed` `{}` | `{ kidId }` | normal, 86 400 s |
| `PATCH /v1/family` with fields, `POST /v1/family/parents`, `PATCH /v1/family/parents/{id}` with fields, `DELETE /v1/family/parents/{id}`, `PUT /v1/family/message-presets`, `POST /v1/family/parent-code/rotate` | `state_changed` `{}` | `{}` (whole family) | normal, 86 400 s |
| `PATCH /v1/devices/{id}` with fields | `state_changed` `{}` | `{ deviceId }` | normal, 86 400 s |
| `POST /v1/device/usage` that stored at least one segment | `state_changed` `{}` | `{ kidId, pool: uploader's pool, exceptDeviceId: uploader }` | none |

An empty PATCH body changes nothing and sends nothing. Every message is sent after the change has committed, before the HTTP answer.

### 6.3 Disconnects

`disconnectDevices(deps, ids)` closes every socket of those devices with code **4401** `This device is not enrolled.` Called after: `DELETE /v1/devices/{id}`, `DELETE /v1/kids/{kidId}` (all the kid's devices it revoked) and `POST /v1/enrol` when a PC account enrols again (the old rows it revoked). A reconnect with the old token then gets 401.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-017-device-websocket
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-017-device-websocket.md` must exist after the pull, and `server/package.json` must list `@hono/node-ws`. If not, you did not pull: run `git fetch origin` and `git pull origin main` again.
3. Create 5.1 and 5.2. Replace 5.3 to 5.10. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-017: add the device WebSocket and fan-out`.
4. Create 5.11. Commit: `CARD-017: add WebSocket tests`.
5. Run the acceptance checks in section 8.
6. Push and open the PR (section 10).
7. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
8. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  26 passed (26)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/live.test.ts (8 tests | 5 skipped)`, `test/admin.test.ts (8 tests | 8 skipped)`, `test/auth.test.ts (15 tests | 15 skipped)`, `test/db.test.ts (12 tests | 12 skipped)`, `test/devices.test.ts (12 tests | 12 skipped)`, `test/family.test.ts (17 tests | 17 skipped)`, `test/grants.test.ts (8 tests | 8 skipped)`, `test/kids.test.ts (10 tests | 10 skipped)`, `test/notify.test.ts (12 tests | 12 skipped)`, `test/sync.test.ts (13 tests | 13 skipped)`, `test/config.test.ts (8 tests)`, `test/tokens.test.ts (7 tests)`, `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (9 tests)`, `test/health.test.ts (2 tests)`, so `Tests  36 passed | 112 skipped (148)`.
- [ ] `pnpm contract` leaves `git status --short contract` empty (the contract does not change in this card). `pnpm --filter @screentime/server db:generate` prints `No schema changes, nothing to migrate`.
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
  Both runs: `test/live.test.ts (8 tests)` and `Tests  148 passed (148)`. (Running twice shows the socket tests are not flaky.)
- [ ] The WebSocket works on the real stack (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
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
  Then add a kid, enrol a PC, open its WebSocket with .NET's `ClientWebSocket`, ping, add 15 minutes, change a family setting, revoke the PC, and try to connect again:
  ```powershell
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  $c = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/enrolment-codes" -Headers $ph -ContentType 'application/json' -Body '{"form":"pc"}'
  $d = Invoke-RestMethod -Method Post http://localhost:8080/v1/enrol -ContentType 'application/json' -Body "{`"code`":`"$($c.code)`",`"platform`":`"windows`",`"hasCellular`":false,`"model`":`"Test PC`",`"osVersion`":`"Windows 11 Pro`",`"appVersion`":`"0.1.0`",`"machineId`":`"test-machine`",`"windowsUserSid`":`"S-1-5-21-1`",`"windowsUserName`":`"alex`"}"
  $none = [Threading.CancellationToken]::None
  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  $ws.Options.SetRequestHeader('Authorization', "Bearer $($d.deviceToken)")
  $ws.ConnectAsync([Uri]'ws://localhost:8080/v1/device/ws', $none).Wait()
  function Receive { $buf = [byte[]]::new(8192); $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $none).Result; ([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count) | ConvertFrom-Json) }
  $ping = [Text.Encoding]::UTF8.GetBytes('{"type":"ping"}')
  $ws.SendAsync([ArraySegment[byte]]::new($ping), 'Text', $true, $none).Wait()
  (Receive).type
  Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/grants" -Headers $ph -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`",`"pool`":`"screens`",`"minutes`":15}" | Out-Null
  $m = Receive
  "$($m.type) $($m.data.grant.minutes) $($m.data.byName)"
  Invoke-RestMethod -Method Patch http://localhost:8080/v1/family -Headers $ph -ContentType 'application/json' -Body '{"emergencyNumber":"000"}' | Out-Null
  (Receive).type
  Invoke-RestMethod -Method Delete "http://localhost:8080/v1/devices/$($d.deviceId)" -Headers $ph | Out-Null
  $buf = [byte[]]::new(8192); $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $none).Result
  "$($r.MessageType) $([int]$ws.CloseStatus)"
  $ws2 = [System.Net.WebSockets.ClientWebSocket]::new()
  $ws2.Options.SetRequestHeader('Authorization', "Bearer $($d.deviceToken)")
  try { $ws2.ConnectAsync([Uri]'ws://localhost:8080/v1/device/ws', $none).Wait(); 'connected' } catch { 'refused' }
  ```
  Run the lines from `$ping` to the end within about a minute of `ConnectAsync`: the server closes a socket that is silent for 75 s. The outputs are `pong`, `grant_added 15 Dad`, `state_changed`, `Close 4401` and `refused`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 11 files (in any order):
  ```
  server/src/app.ts
  server/src/devices/routes.ts
  server/src/family/routes.ts
  server/src/grants/routes.ts
  server/src/index.ts
  server/src/kids/routes.ts
  server/src/live/hub.ts
  server/src/live/routes.ts
  server/src/notify/dispatch.ts
  server/src/sync/routes.ts
  server/test/live.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `server/test/live.test.ts` | **Hub, no database:** a message reaches every socket of the named devices and no others; a removed socket gets nothing; closing a revoked device closes its sockets with 4401 and forgets them; one socket that throws does not stop the others. **Against a real database and real sockets:** an upgrade with no token, a bad token or a revoked device's token is refused with 401; a plain request with a revoked token is 401 and with a good token 422. `ping` gets a `pong` envelope with the server time; other text is ignored; a silent socket is closed with 4408 and leaves the hub. A grant reaches the kid's PC and tablet (Screens) by WebSocket, not the phone (Phone pool) or another kid's PC, and by FCM only the Android tablet. A schedule save reaches only that kid's devices (FCM at normal priority, 86 400 s); contacts and a kid rename the same; family settings, presets, the parent-code rotation and a new parent reach every device of the family and none of another family; a device rename only that device; a usage upload from the tablet reaches the PC, not the tablet itself nor another kid, and nothing by FCM. Revoking a device closes its socket with 4401, and archiving the kid closes the rest. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 and 4). Message format: `CARD-017: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-017-device-websocket`
5. Open a PR into `main` titled `CARD-017: Live connection to kid devices`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-017-device-websocket --title "CARD-017: Live connection to kid devices" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-017-device-websocket.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract unchanged; db:generate finds no changes
   - [x] database tests, twice — output: `Tests  148 passed (148)` both times
   - [x] WebSocket on the real stack — output: `pong`, `grant_added 15 Dad`, `state_changed`, `Close 4401`, `refused`
   - [x] deploy/.env not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 11 files

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

- **`Cannot find module '@hono/node-ws'`** or **`'ws'`**: you did not install after pulling. Run `pnpm install --frozen-lockfile` from the repo root. Do **not** run `pnpm add`, and do not change `pnpm-lock.yaml`.
- **`pushToKid` is not exported**: some file still uses the old name. Every file in section 5 must be the card's version; `pushToKid` is gone.
- **`Property 'injectWebSocket' does not exist`**: 5.9 (`app.ts`) is not copied exactly.
- **A `live.test.ts` test times out**: check Docker is running and `TEST_DATABASE_URL` is set; run the tests again once. If the same test fails twice, report it with its first error lines. Do not raise the timeouts, change the 400 ms idle time or the 100 ms pings, or skip the test.
- **The real-stack check prints `Close 4408` or hangs on `Receive`**: you waited more than 75 s between steps, so the server closed the idle socket. Run the lines from `$ws = ...` again, quicker.
- **Any change in `contract/openapi.json`** after `pnpm contract`: one of the route files is not the card's version. This card adds no OpenAPI route. Do not commit a changed contract.
- **Different test data**: do not change values in the tests (names, tokens, numbers, minutes), even when another value would also pass. If you think one is wrong, say so under "Deviations".
- **Small edits you think are harmless** (quote style, wording, formatting): don't. Copy the card exactly. If you change anything at all, it is a deviation and must be listed under "Deviations", with a commit of its own.
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-017. Please review and merge if it is good.

CARD: CARD-017 Live connection to kid devices
PR: <full PR URL>
Branch: bob/card-017-device-websocket
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
