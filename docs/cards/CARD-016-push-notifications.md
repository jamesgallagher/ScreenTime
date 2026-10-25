# CARD-016: Push notifications and event history

| Field | Value |
|---|---|
| Card | CARD-016 |
| Title | Push notifications and event history |
| Size | M |
| Depends on | CARD-015 (merged to `main`) |
| Spec sections | docs/SPEC.md §8.4, §9.2, §9.3, §10, §13, Q17, Q27 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-016-push-notifications` |
| PR title | `CARD-016: Push notifications and event history` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`. Request and response shapes are Zod schemas in `packages/schemas` (package `@screentime/schemas`), and `pnpm contract` writes the generated OpenAPI document to `contract/openapi.json`, which is committed; `server/test/openapi.test.ts` fails if it is out of date. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts`.

What exists already:

- Parent routes use `requireFamilyParent` (`server/src/auth/guards.ts`); kid device routes use `requireDevice` (`server/src/devices/auth.ts`). Both run their queries through `withFamily` (`server/src/db/family.ts`), which limits them to one family by row-level security.
- The tables this card uses all exist (CARD-010): `parent_sessions.fcm_token`, `devices.fcm_token`, `notification_prefs` (`parent_id`, `kind`, `enabled`; a missing row means on) and `events` (`kind`, `at`, `kid_id`, `device_id`, `payload`).
- Two kinds of event are already written: `device.enrolled` (by `POST /v1/enrol`, CARD-013) and `grant.added` (by every grant and lock now, CARD-015).
- `server/src/sync/day.ts` (CARD-014) has `familyDay`, `dayGrants`, `daySegments` and `poolStatus`, which runs the shared time engine for one kid and pool.
- **Already on `main` (Claude added it with this card):** the `firebase-admin` ^14.5.0 package in `server/package.json` and `pnpm-lock.yaml`, and two `allowBuilds` lines in `pnpm-workspace.yaml`. You only run `pnpm install --frozen-lockfile` after pulling.

This card adds push notifications by Firebase Cloud Messaging (FCM) and the event history:

1. **Push tokens.** `PUT /v1/me/push-token` stores the parent app's FCM token on its session; `PUT /v1/device/push-token` stores a kid device's token.
2. **Notification settings.** `GET` and `PUT /v1/me/notification-prefs`: each parent can turn kinds off, except the essential ones (SOS, parent mode requests, ask for more time), which are always on.
3. **The dispatcher** (`server/src/notify/dispatch.ts`): after an event is committed it pushes it to every parent app that should get it. A grant also pushes `grant_added` to the kid's Android devices in that pool.
4. **Offline overspend** (SPEC §8.4): when a device uploads segments it recorded offline and the pool is now over, the server writes an `overspend` event and notifies parents.
5. **The event history**: `GET /v1/events`, newest first, paged.
6. **The sender** (`server/src/push.ts`): `firebase-admin`, configured by the new `FIREBASE_SERVICE_ACCOUNT_JSON` setting. Without it the server sends nothing, so local runs and tests never talk to Google.

No database migration is needed.

## 2. Goal

Parents' and kids' apps can register for pushes; parents get each event they have not muted (essential ones always) and never their own time changes; kid devices hear about new grants at once; offline overspend is reported once per real increase; and the history lists every event. All of it is tested against PostgreSQL 18 with a fake sender, and the OpenAPI contract describes the 5 new operations.

## 3. Out of scope

Do **not** do any of these in this card:

- No WebSocket (CARD-017). No `state_changed` pushes for other changes (schedule edits, contacts and so on).
- No time requests, kid messages, parent mode or SOS routes (CARD-018 to 020). Their kinds are listed, but nothing writes those events yet.
- No device offline job (CARD-021).
- No Android or web app code.
- No new npm packages and no lockfile change: `firebase-admin` is already on `main`. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay unchanged.
- No database migration. Do not change `server/src/db/schema.ts` or anything in `server/drizzle/`.
- Do not change any file that is not listed in section 5. In particular, leave `server/src/sync/day.ts`, `server/src/kids/`, `server/src/auth/`, `server/src/db/`, `docs/` and the other existing tests as they are.
- You do **not** need a Firebase key. Never put a real Firebase service account key, FCM token, JWT secret, SMTP key or device token in a file, the PR or the handback. `deploy/.env` is never committed.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, Zod ^4.6, hono ^4.13.13, @hono/zod-openapi ^1.6.3, drizzle-orm ^0.45.4, PostgreSQL 18. New to the code (already installed by the lockfile on `main`): `firebase-admin` ^14.5.0, imported as `firebase-admin/app` and `firebase-admin/messaging`.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character. Some test names contain an apostrophe and so use double quotes (`it("saves the token on the caller's session ...", ...)`): keep them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/notify.ts` | create (5.1) |
| `packages/schemas/src/index.ts` | replace (5.2) |
| `packages/schemas/test/notify.test.ts` | create (5.3) |
| `server/src/config.ts` | replace (5.4) |
| `server/src/push.ts` | create (5.5) |
| `server/src/notify/dispatch.ts` | create (5.6) |
| `server/src/notify/routes.ts` | create (5.7) |
| `server/src/sync/overspend.ts` | create (5.8) |
| `server/src/sync/routes.ts` | replace (5.9) |
| `server/src/grants/routes.ts` | replace (5.10) |
| `server/src/devices/routes.ts` | replace (5.11) |
| `server/src/app.ts` | replace (5.12) |
| `server/src/index.ts` | replace (5.13) |
| `server/test/helpers.ts` | replace (5.14) |
| `server/test/config.test.ts` | replace (5.15) |
| `server/test/notify.test.ts` | create (5.16) |
| `server/test/openapi.test.ts` | replace (5.17) |
| `deploy/docker-compose.yml` | replace (5.18) |
| `deploy/.env.example` | replace (5.19) |
| `contract/openapi.json` | **generated** by `pnpm contract` (5.20) |

That is 20 files.

### 5.1 `packages/schemas/src/notify.ts`

The notification kinds, the essential ones, and the shapes of the new routes. `Envelope` is the one message format of every push (SPEC §10).

```typescript
import { z } from 'zod';

/**
 * What a parent can be notified about (docs/SPEC.md §13). One kind can cover several event kinds:
 * `sos` is every `sos.*` event, `tamper` every `tamper.*` event, and `grant.by_other_parent` is a
 * `grant.added` event made by another parent.
 */
export const NotificationKind = z
  .enum([
    'sos',
    'tamper',
    'parent_mode.request',
    'parent_mode.used',
    'time_request',
    'kid_message',
    'overspend',
    'device.offline',
    'device.enrolled',
    'grant.by_other_parent',
  ])
  .meta({ id: 'NotificationKind' });

export type NotificationKind = z.infer<typeof NotificationKind>;

/** Kinds that cannot be turned off: SOS and every request that waits for a parent's answer. */
export const ESSENTIAL_KINDS: readonly NotificationKind[] = ['sos', 'parent_mode.request', 'time_request'];

export const NotificationPref = z
  .object({
    kind: NotificationKind,
    enabled: z.boolean(),
    /** Always on; `enabled` is then always true. */
    essential: z.boolean(),
  })
  .meta({ id: 'NotificationPref' });

export type NotificationPref = z.infer<typeof NotificationPref>;

/** Body of PUT /v1/me/notification-prefs. Kinds left out keep their setting. */
export const NotificationPrefsPut = z
  .array(z.object({ kind: NotificationKind, enabled: z.boolean() }))
  .min(1)
  .max(NotificationKind.options.length)
  .refine((prefs) => new Set(prefs.map((p) => p.kind)).size === prefs.length, { message: 'Each kind may appear only once.' })
  .meta({ id: 'NotificationPrefsPut' });

export type NotificationPrefsPut = z.infer<typeof NotificationPrefsPut>;

/** Body of PUT /v1/me/push-token and PUT /v1/device/push-token. null stops pushes to this app. */
export const PushTokenPut = z
  .object({ fcmToken: z.string().min(1).max(4096).nullable() })
  .meta({ id: 'PushTokenPut' });

export type PushTokenPut = z.infer<typeof PushTokenPut>;

/** One entry of the event history (docs/SPEC.md §6.1 events, §13). */
export const EventItem = z
  .object({
    id: z.uuid(),
    /** The event kind, for example `grant.added`, `overspend` or `sos.started`. */
    kind: z.string(),
    at: z.iso.datetime(),
    kidId: z.uuid().nullable(),
    kidName: z.string().nullable(),
    deviceId: z.uuid().nullable(),
    deviceName: z.string().nullable(),
    /** What happened. Its fields depend on `kind`. */
    payload: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'EventItem' });

export type EventItem = z.infer<typeof EventItem>;

/** GET /v1/events. */
export const EventPage = z
  .object({
    /** Newest first. */
    events: z.array(EventItem),
    /** Pass as `before` to get the next, older page. null on the last page. */
    nextBefore: z.uuid().nullable(),
  })
  .meta({ id: 'EventPage' });

export type EventPage = z.infer<typeof EventPage>;

/**
 * Every push and WebSocket message (docs/SPEC.md §10). For FCM the whole envelope is one string data field
 * `msg`. To parents `type` is the notification kind and `data` the EventItem; to kid devices `type` is a
 * device message such as `grant_added`.
 */
export const Envelope = z
  .object({
    v: z.literal(1),
    type: z.string(),
    at: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'Envelope' });

export type Envelope = z.infer<typeof Envelope>;
```

### 5.2 `packages/schemas/src/index.ts`

The same as before with the `notify.js` exports added at the end.

```typescript
export { AuthResponse, Me, OtpRequest, OtpVerifyRequest, RefreshRequest, Role } from './auth.js';
export { ErrorCode, ErrorResponse } from './errors.js';
export {
  Device,
  DeviceForm,
  DeviceMe,
  DevicePatch,
  EnrolmentCode,
  EnrolmentCodeCreate,
  EnrolRequest,
  EnrolResponse,
  Platform,
  Pool,
} from './devices.js';
export {
  AdminFamily,
  AdminFamilyCreate,
  AdminFamilyCreated,
  EmergencyNumber,
  Family,
  FamilyPatch,
  MessagePreset,
  MessagePresetsPut,
  Parent,
  ParentCodeSecret,
  ParentCreate,
  ParentPatch,
  PhoneE164,
  TimeZone,
} from './family.js';
export { HealthResponse } from './health.js';
export {
  AvatarColor,
  Kid,
  KidContact,
  KidContactsPut,
  KidCreate,
  KidPatch,
  Schedule,
  ScheduleDay,
  ScheduleInput,
} from './kids.js';
export {
  DeviceState,
  LockReason,
  PoolSegment,
  StateGrant,
  Today,
  TodayDevice,
  TodayKid,
  TodayPool,
  UsageReceipt,
  UsageSegmentIn,
  UsageUpload,
} from './sync.js';
export { Grant, GrantCreate, LocalDate, LockNow } from './grants.js';
export {
  ESSENTIAL_KINDS,
  Envelope,
  EventItem,
  EventPage,
  NotificationKind,
  NotificationPref,
  NotificationPrefsPut,
  PushTokenPut,
} from './notify.js';
```

### 5.3 `packages/schemas/test/notify.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { ESSENTIAL_KINDS, NotificationKind, NotificationPrefsPut, PushTokenPut } from '../src/index.js';

describe('notification schemas', () => {
  it('makes SOS and requests that wait for a parent essential', () => {
    expect([...ESSENTIAL_KINDS].sort()).toEqual(['parent_mode.request', 'sos', 'time_request']);
    for (const kind of ESSENTIAL_KINDS) expect(NotificationKind.options).toContain(kind);
  });

  it('takes each kind once in a prefs update', () => {
    expect(NotificationPrefsPut.safeParse([{ kind: 'overspend', enabled: false }]).success).toBe(true);
    expect(NotificationPrefsPut.safeParse([]).success).toBe(false);
    expect(
      NotificationPrefsPut.safeParse([
        { kind: 'overspend', enabled: false },
        { kind: 'overspend', enabled: true },
      ]).success,
    ).toBe(false);
    expect(NotificationPrefsPut.safeParse([{ kind: 'sos.started', enabled: false }]).success).toBe(false);
  });

  it('takes a push token or null', () => {
    expect(PushTokenPut.safeParse({ fcmToken: 'abc' }).success).toBe(true);
    expect(PushTokenPut.safeParse({ fcmToken: null }).success).toBe(true);
    expect(PushTokenPut.safeParse({ fcmToken: '' }).success).toBe(false);
    expect(PushTokenPut.safeParse({}).success).toBe(false);
  });
});
```

### 5.4 `server/src/config.ts`

Adds `firebaseServiceAccountJson`. A value that is not a service account key stops the server at start, so a pasted half key is noticed at once.

```typescript
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

export interface Config {
  port: number;
  databaseUrl: string;
  /** Signs access tokens (HS256) and keys the sign-in code hashes. At least 32 characters. */
  jwtSecret: string;
  /** Lower case. Signing in with this email gives the `superadmin` role (docs/SPEC.md §6.2). */
  superAdminEmail: string | null;
  /** Null when SMTP_USER, SMTP_PASS or SMTP_FROM is unset: sign-in codes are then logged, not emailed. */
  smtp: SmtpConfig | null;
  /** The Firebase service account key (JSON). Null when FIREBASE_SERVICE_ACCOUNT_JSON is unset: no pushes are sent. */
  firebaseServiceAccountJson: string | null;
}

/** Reads settings from environment variables. Throws if a required one is missing. Empty values count as unset. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set');
  }
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  const firebase = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || null;
  if (firebase && !isServiceAccount(firebase)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not a Firebase service account key');
  }
  const { SMTP_USER: user, SMTP_PASS: pass, SMTP_FROM: from } = env;
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl,
    jwtSecret,
    superAdminEmail: env.SUPER_ADMIN_EMAIL ? env.SUPER_ADMIN_EMAIL.trim().toLowerCase() : null,
    smtp:
      user && pass && from
        ? {
            host: env.SMTP_HOST || 'smtp-relay.brevo.com',
            port: Number(env.SMTP_PORT || 587),
            user,
            pass,
            from,
            fromName: env.SMTP_FROM_NAME || 'ScreenTime App',
          }
        : null,
    firebaseServiceAccountJson: firebase,
  };
}

/** True for the JSON key file that Firebase downloads (Project settings, Service accounts). */
function isServiceAccount(json: string) {
  try {
    const key = JSON.parse(json) as Record<string, unknown>;
    return ['project_id', 'client_email', 'private_key'].every((field) => typeof key[field] === 'string');
  } catch {
    return false;
  }
}
```

### 5.5 `server/src/push.ts`

The FCM sender. Tests never use the real one: they pass a fake `Pusher`.

```typescript
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Envelope } from '@screentime/schemas';

export interface PushMessage {
  /** The app's FCM registration token. */
  token: string;
  msg: Envelope;
  /** FCM high priority wakes a sleeping phone. Only for messages that show a notification (docs/SPEC.md §10). */
  high: boolean;
  /** Seconds FCM keeps trying to deliver; after that the message is dropped. FCM's default is 4 weeks. */
  ttlSec?: number;
}

export interface Pusher {
  /** Sends every message. Returns the tokens FCM says are no longer valid, so they can be cleared. */
  send(messages: PushMessage[]): Promise<string[]>;
}

/** FCM's answers for a token that will never work again (the app was uninstalled or signed out). */
const DEAD_TOKEN = new Set(['registration-token-not-registered', 'invalid-registration-token']);

/** FCM takes at most 500 messages per batch. */
const BATCH = 500;

/** Sends pushes with Firebase Cloud Messaging (docs/SPEC.md §10), or nothing when Firebase is not configured. */
export function createPusher(serviceAccountJson: string | null): Pusher {
  if (!serviceAccountJson) {
    return {
      async send() {
        return [];
      },
    };
  }
  const app = initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) }, 'screentime');
  const messaging = getMessaging(app);
  return {
    async send(messages) {
      const dead: string[] = [];
      for (let i = 0; i < messages.length; i += BATCH) {
        const batch = messages.slice(i, i + BATCH);
        const result = await messaging.sendEach(
          batch.map((m) => ({
            token: m.token,
            // FCM data values must be strings, so the envelope travels as one field.
            data: { msg: JSON.stringify(m.msg) },
            android: { priority: m.high ? 'high' : 'normal', ...(m.ttlSec === undefined ? {} : { ttl: m.ttlSec * 1000 }) },
          })),
        );
        result.responses.forEach((response, j) => {
          if (response.success) return;
          const code = response.error?.code.replace(/^messaging\//, '') ?? 'unknown';
          const token = batch[j]?.token;
          if (DEAD_TOKEN.has(code) && token) dead.push(token);
          else console.error(`push not sent: ${code}: ${response.error?.message ?? ''}`);
        });
      }
      return dead;
    },
  };
}
```

### 5.6 `server/src/notify/dispatch.ts`

Who gets which push. Called after the transaction that wrote the event has committed, so a push never announces something that was rolled back.

```typescript
import { and, asc, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import { ESSENTIAL_KINDS, type Envelope, type EventItem, NotificationKind, type Pool } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/client.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, grants, kids, notificationPrefs, parentSessions, parents } from '../db/schema.js';
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

/**
 * Pushes one message to a kid's Android devices in one pool (docs/SPEC.md §10). Revoked devices and
 * devices without a push token are skipped. Failures are logged: devices also pick changes up on sync.
 */
export async function pushToKid(
  deps: AppDeps,
  familyId: string,
  kidId: string,
  pool: Pool,
  msg: Envelope,
  ttlSec: number,
) {
  const { db, pusher } = deps;
  if (!pusher) return;
  try {
    const rows = await withFamily(db, familyId, (tx) =>
      tx
        .select({ token: devices.fcmToken })
        .from(devices)
        .where(
          and(
            eq(devices.kidId, kidId),
            eq(devices.pool, pool),
            eq(devices.platform, 'android'),
            isNull(devices.revokedAt),
            isNotNull(devices.fcmToken),
          ),
        )
        .orderBy(asc(devices.enrolledAt)),
    );
    const messages = rows.flatMap((r) => (r.token ? [{ token: r.token, msg, high: true, ttlSec }] : []));
    await sendAndForgetDead(db, pusher, familyId, messages);
  } catch (err) {
    console.error('push to kid devices failed', err);
  }
}
```

### 5.7 `server/src/notify/routes.ts`

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  ESSENTIAL_KINDS,
  EventPage,
  NotificationKind,
  NotificationPref,
  NotificationPrefsPut,
  PushTokenPut,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, notificationPrefs, parentSessions } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { selectEvents } from './dispatch.js';

type Router = ReturnType<typeof createRouter>;

const EventsQuery = z.object({
  kidId: z.uuid().optional(),
  /** An event kind (`overspend`), or the start of one (`sos` matches `sos.started`). */
  kind: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)*$/)
    .max(64)
    .optional(),
  /** `nextBefore` of the previous page. */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const parentPushTokenRoute = createRoute({
  method: 'put',
  path: '/v1/me/push-token',
  tags: ['notifications'],
  summary: "Set this parent app's push token",
  description: 'For the session of the access token. null stops pushes to this app. Signing out also stops them.',
  security: bearer,
  request: { body: jsonBody(PushTokenPut) },
  responses: { 204: { description: 'Saved.' }, ...errorResponses(401, 403, 422) },
});

const getPrefsRoute = createRoute({
  method: 'get',
  path: '/v1/me/notification-prefs',
  tags: ['notifications'],
  summary: 'Which notifications this parent gets',
  description: 'Every kind, in a fixed order. Essential kinds are always on.',
  security: bearer,
  responses: { 200: jsonResponse('The settings.', z.array(NotificationPref)), ...errorResponses(401, 403) },
});

const putPrefsRoute = createRoute({
  method: 'put',
  path: '/v1/me/notification-prefs',
  tags: ['notifications'],
  summary: 'Turn notification kinds on or off',
  description:
    'Kinds left out keep their setting. Turning off an essential kind is refused (422). Muting only stops the push: the history still shows every event.',
  security: bearer,
  request: { body: jsonBody(NotificationPrefsPut) },
  responses: { 200: jsonResponse('Every kind after the change.', z.array(NotificationPref)), ...errorResponses(401, 403, 422) },
});

const devicePushTokenRoute = createRoute({
  method: 'put',
  path: '/v1/device/push-token',
  tags: ['device'],
  summary: "Set this kid device's push token",
  description: 'Android only. null stops pushes to this device.',
  security: deviceBearer,
  request: { body: jsonBody(PushTokenPut) },
  responses: { 204: { description: 'Saved.' }, ...errorResponses(401, 422) },
});

const eventsRoute = createRoute({
  method: 'get',
  path: '/v1/events',
  tags: ['notifications'],
  summary: 'The event history',
  description:
    'Newest first, every kind (muted ones too), archived kids included. `limit` defaults to 50. For the next page pass `nextBefore` as `before`.',
  security: bearer,
  request: { query: EventsQuery },
  responses: { 200: jsonResponse('One page of events.', EventPage), ...errorResponses(401, 403, 422) },
});

const KIND_NAME: Record<NotificationKind, string> = {
  sos: 'SOS',
  tamper: 'Tamper',
  'parent_mode.request': 'Parent mode request',
  'parent_mode.used': 'Parent mode used',
  time_request: 'Ask for more time',
  kid_message: 'Messages',
  overspend: 'Offline overspend',
  'device.offline': 'Device offline',
  'device.enrolled': 'Device added',
  'grant.by_other_parent': 'Time changed by another parent',
};

/** Every kind for one parent: a missing row means on, and essential kinds are always on. */
async function prefsOf(tx: FamilyTx, parentId: string): Promise<NotificationPref[]> {
  const rows = await tx.select().from(notificationPrefs).where(eq(notificationPrefs.parentId, parentId));
  return NotificationKind.options.map((kind) => {
    const essential = ESSENTIAL_KINDS.includes(kind);
    const row = rows.find((r) => r.kind === kind);
    return { kind, enabled: essential || (row?.enabled ?? true), essential };
  });
}

/** Push tokens, notification settings and the event history (docs/SPEC.md §9.2, §9.3, §13). */
export function registerNotifyRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  app.openapi(parentPushTokenRoute, async (c) => {
    const { familyId, parentId, sessionId } = await caller(c);
    const { fcmToken } = c.req.valid('json');
    const saved = await withFamily(db, familyId, async (tx) => {
      if (fcmToken) {
        // The same phone signed in again: only the newest session keeps the token, so it gets each push once.
        await tx
          .update(parentSessions)
          .set({ fcmToken: null })
          .where(and(eq(parentSessions.fcmToken, fcmToken), ne(parentSessions.id, sessionId)));
      }
      return tx
        .update(parentSessions)
        .set({ fcmToken })
        .where(and(eq(parentSessions.id, sessionId), eq(parentSessions.parentId, parentId), isNull(parentSessions.revokedAt)))
        .returning({ id: parentSessions.id });
    });
    if (saved.length === 0) throw new ApiError('unauthorized', 'Sign in again.');
    return c.body(null, 204);
  });

  app.openapi(getPrefsRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const prefs = await withFamily(db, familyId, (tx) => prefsOf(tx, parentId));
    return c.json(prefs, 200);
  });

  app.openapi(putPrefsRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const body = c.req.valid('json');
    const essentialOff = body.find((p) => !p.enabled && ESSENTIAL_KINDS.includes(p.kind));
    if (essentialOff) throw new ApiError('validation_failed', `${KIND_NAME[essentialOff.kind]} notifications cannot be turned off.`);
    const prefs = await withFamily(db, familyId, async (tx) => {
      await tx
        .insert(notificationPrefs)
        .values(body.map((p) => ({ familyId, parentId, kind: p.kind, enabled: p.enabled })))
        .onConflictDoUpdate({
          target: [notificationPrefs.parentId, notificationPrefs.kind],
          set: { enabled: sql`excluded.enabled` },
        });
      return prefsOf(tx, parentId);
    });
    return c.json(prefs, 200);
  });

  app.openapi(devicePushTokenRoute, async (c) => {
    const { familyId, deviceId } = await requireDevice(c, db);
    const { fcmToken } = c.req.valid('json');
    await withFamily(db, familyId, async (tx) => {
      if (fcmToken) {
        await tx
          .update(devices)
          .set({ fcmToken: null })
          .where(and(eq(devices.fcmToken, fcmToken), ne(devices.id, deviceId)));
      }
      await tx.update(devices).set({ fcmToken }).where(eq(devices.id, deviceId));
    });
    return c.body(null, 204);
  });

  app.openapi(eventsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId, kind, before, limit } = c.req.valid('query');
    const rows = await withFamily(db, familyId, (tx) =>
      selectEvents(
        tx,
        and(
          kidId ? eq(events.kidId, kidId) : undefined,
          kind ? sql`(${events.kind} = ${kind} or starts_with(${events.kind}, ${`${kind}.`}))` : undefined,
          before
            ? sql`(${events.at}, ${events.id}) < (select e.at, e.id from ${events} e where e.id = ${before})`
            : undefined,
        ),
        limit + 1,
      ),
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return c.json({ events: page, nextBefore: rows.length > limit && last ? last.id : null }, 200);
  });
}
```

### 5.8 `server/src/sync/overspend.ts`

```typescript
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Pool } from '@screentime/schemas';
import type { FamilyTx } from '../db/family.js';
import { devices, events, families, grants, scheduleVersions, usageSegments } from '../db/schema.js';
import { toSchedule } from '../kids/routes.js';
import { dayGrants, daySegments, familyDay, poolStatus } from './day.js';

/** Less than this is not worth telling a parent about, and is the least a new report must add. */
const STEP_SEC = 60;

/**
 * Called after a device uploads segments it recorded offline (docs/SPEC.md §8.4, Q27). If the device's
 * pool is now over today's time, writes an `overspend` event, unless an earlier one today already
 * reported nearly as much. Returns the new event's id, or null.
 */
export async function recordOverspend(tx: FamilyTx, kidId: string, deviceId: string): Promise<string | null> {
  const [row] = await tx
    .select({ device: devices, timezone: families.timezone })
    .from(devices)
    .innerJoin(families, eq(families.id, devices.familyId))
    .where(eq(devices.id, deviceId));
  if (!row) throw new Error('device vanished after requireDevice');
  const pool = row.device.pool as Pool;
  const day = await familyDay(tx, row.timezone);
  const [scheduleRow] = await tx
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.kidId, kidId))
    .orderBy(desc(scheduleVersions.version))
    .limit(1);
  if (!scheduleRow) throw new Error(`kid ${kidId} has no schedule`);
  const status = poolStatus(
    row.timezone,
    day,
    toSchedule(scheduleRow),
    pool,
    await dayGrants(tx, day, and(eq(grants.kidId, kidId), eq(grants.pool, pool))),
    await daySegments(tx, day, and(eq(usageSegments.kidId, kidId), eq(usageSegments.pool, pool))),
  );
  if (status.overspendSec < STEP_SEC) return null;

  const [reported] = await tx
    .select({ max: sql`max((${events.payload} ->> 'overspendSec')::int)`.mapWith(Number) })
    .from(events)
    .where(
      and(
        eq(events.kidId, kidId),
        eq(events.kind, 'overspend'),
        sql`${events.payload} ->> 'pool' = ${pool}`,
        sql`${events.payload} ->> 'day' = ${day.date}`,
      ),
    );
  // max() of no rows is null.
  if (reported?.max && status.overspendSec < reported.max + STEP_SEC) return null;

  const [event] = await tx
    .insert(events)
    .values({
      familyId: row.device.familyId,
      kidId,
      deviceId,
      kind: 'overspend',
      at: sql`now()`,
      payload: { pool, overspendSec: status.overspendSec, day: day.date, deviceName: row.device.name },
    })
    .returning({ id: events.id });
  if (!event) throw new Error('event insert returned nothing');
  return event.id;
}
```

### 5.9 `server/src/sync/routes.ts`

The same as before, except the usage upload: it keeps the stored rows, calls `recordOverspend` when an offline segment was stored, and notifies parents after the commit. Two new imports.

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
import { notifyParents } from '../notify/dispatch.js';
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
      return { received: rows.length, overspendEventId: offline ? await recordOverspend(tx, kidId, deviceId) : null };
    });
    if (stored.overspendEventId) await notifyParents(deps, familyId, [stored.overspendEventId]);
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

### 5.10 `server/src/grants/routes.ts`

The same as before, except: `insertGrant` returns the event id (`pushes`), and both POST routes call `sendPushes` after the transaction.

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
import { notifyParents, pushToKid } from '../notify/dispatch.js';
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
    await pushToKid(
      deps,
      familyId,
      kidId,
      grant.pool,
      {
        v: 1,
        type: 'grant_added',
        at: grant.createdAt,
        data: {
          grant: { id: grant.id, minutes: grant.minutes, createdAt: grant.createdAt, byName: grant.byName },
          byName: grant.byName,
        },
      },
      ttlSec,
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

### 5.11 `server/src/devices/routes.ts`

The same as before, except enrolment: the `device.enrolled` event id is returned from the transaction and parents are notified after it.

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
import { notifyParents } from '../notify/dispatch.js';
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
    return c.body(null, 204);
  });

  app.openapi(enrolRoute, async (c) => {
    if (!enrolsPerIp.hit(clientIp(c))) throw new ApiError('rate_limited', 'Too many enrolment attempts. Try again later.');
    const body = c.req.valid('json');
    const wrongCode = () => new ApiError('unauthorized', 'That code is wrong or has expired. Ask a parent for a new one.');
    const deviceToken = newDeviceToken();
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
        await tx
          .update(devices)
          .set({ revokedAt: sql`now()`, fcmToken: null })
          .where(
            and(
              eq(devices.familyId, family.id),
              eq(devices.machineId, body.machineId ?? ''),
              eq(devices.windowsUserSid, body.windowsUserSid ?? ''),
              isNull(devices.revokedAt),
            ),
          );
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

### 5.12 `server/src/app.ts`

Adds the optional `pusher` to `AppDeps` and registers the new routes.

```typescript
import { createRoute } from '@hono/zod-openapi';
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

/** Builds the whole API. Each call has its own rate-limit counters. */
export function createApp(deps: AppDeps) {
  const app = createRouter();

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

  return app;
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

### 5.13 `server/src/index.ts`

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

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`screentime-server listening on http://localhost:${info.port}`);
});
```

### 5.14 `server/test/helpers.ts`

Only `testConfig` changes (`firebaseServiceAccountJson: null`).

```typescript
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Role } from '@screentime/schemas';
import { type AppDeps, createApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/tokens.js';
import type { Config } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

export const TEST_SECRET = 'test-secret-that-is-at-least-32-chars';

export function testConfig(databaseUrl: string, superAdminEmail: string | null = null): Config {
  return { port: 0, databaseUrl, jwtSecret: TEST_SECRET, superAdminEmail, smtp: null, firebaseServiceAccountJson: null };
}

/** Empties the test database and applies every migration. Only for TEST_DATABASE_URL. */
export async function resetDatabase(db: Db, pool: pg.Pool) {
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await runMigrations(db);
}

/** An access token as sign-in would issue it. The routes under test do not look up the session. */
export function tokenFor(who: { parentId: string | null; familyId: string | null }, roles: Role[] = ['parent']) {
  return signAccessToken(TEST_SECRET, { sessionId: randomUUID(), ...who, roles });
}

/** Small JSON client for one app. */
export function client(deps: AppDeps) {
  const app = createApp(deps);
  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return {
    get: (path: string, token: string | null) => call('GET', path, token),
    post: (path: string, token: string | null, body?: unknown) => call('POST', path, token, body),
    patch: (path: string, token: string | null, body: unknown) => call('PATCH', path, token, body),
    put: (path: string, token: string | null, body: unknown) => call('PUT', path, token, body),
    del: (path: string, token: string | null) => call('DELETE', path, token),
  };
}
```

### 5.15 `server/test/config.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const SECRET = 'x'.repeat(32);
const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: SECRET };

describe('loadConfig', () => {
  it('reads the required settings and defaults the rest', () => {
    expect(loadConfig(base)).toEqual({
      port: 8080,
      databaseUrl: 'postgres://x',
      jwtSecret: SECRET,
      superAdminEmail: null,
      smtp: null,
      firebaseServiceAccountJson: null,
    });
  });

  it('reads PORT', () => {
    expect(loadConfig({ ...base, PORT: '9000' }).port).toBe(9000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ JWT_SECRET: SECRET })).toThrow('DATABASE_URL is not set');
  });

  it('throws when JWT_SECRET is missing or too short', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow('JWT_SECRET is not set');
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow('JWT_SECRET must be at least 32 characters');
  });

  it('lower-cases SUPER_ADMIN_EMAIL', () => {
    expect(loadConfig({ ...base, SUPER_ADMIN_EMAIL: ' James@Example.com ' }).superAdminEmail).toBe('james@example.com');
  });

  it('treats empty values as unset (Docker Compose passes unset variables as empty)', () => {
    const config = loadConfig({ ...base, SUPER_ADMIN_EMAIL: '', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'a@b.c', SMTP_HOST: '', SMTP_PORT: '', SMTP_FROM_NAME: '' });
    expect(config.superAdminEmail).toBeNull();
    expect(config.smtp).toMatchObject({ host: 'smtp-relay.brevo.com', port: 587, fromName: 'ScreenTime App' });
    expect(loadConfig({ ...base, SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '' }).smtp).toBeNull();
  });

  it('turns SMTP on only when user, password and sender are all set', () => {
    expect(loadConfig({ ...base, SMTP_USER: 'u', SMTP_PASS: 'p' }).smtp).toBeNull();
    expect(loadConfig({ ...base, SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'no-reply@example.com' }).smtp).toEqual({
      host: 'smtp-relay.brevo.com',
      port: 587,
      user: 'u',
      pass: 'p',
      from: 'no-reply@example.com',
      fromName: 'ScreenTime App',
    });
  });

  it('reads FIREBASE_SERVICE_ACCOUNT_JSON and rejects anything that is not a service account key', () => {
    const key = JSON.stringify({ type: 'service_account', project_id: 'p', client_email: 'a@p.iam.gserviceaccount.com', private_key: 'k' });
    expect(loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: key }).firebaseServiceAccountJson).toBe(key);
    expect(loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: '' }).firebaseServiceAccountJson).toBeNull();
    expect(() => loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"p"}' })).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not a Firebase service account key',
    );
    expect(() => loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: 'not json' })).toThrow('not a Firebase service account key');
  });
});
```

### 5.16 `server/test/notify.test.ts`

```typescript
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
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
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import { notifyParents } from '../src/notify/dispatch.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** A fixed-offset zone where it is about midday right now, so the test times never cross local midnight. */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

const zone = middayZone();
/** Now plus `m` minutes, as ISO 8601. */
const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** Every day the same, with no curfew, so the result does not depend on the weekday or the hour. */
const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

const phone = { platform: 'android', hasCellular: true, model: 'Pixel 7', osVersion: 'Android 14', appVersion: '0.1.0' };

describe.skipIf(!url)('notifications', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };

  /** Records every push. Tokens in `dead` are answered as no longer valid. */
  const sent: PushMessage[] = [];
  let dead: string[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return dead.filter((t) => messages.some((m) => m.token === t));
    },
  };
  const deps = { db, config: testConfig(url ?? ''), mailer, pusher };
  const api = client(deps);
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  let familyA = '';
  let familyB = '';
  let mumId = '';
  let dadId = '';
  let mum = '';
  let dad = '';
  let bea = '';
  let mumSession = '';

  /** A signed-in parent app session with a push token, and an access token for it. */
  async function signIn(familyId: string, parentId: string, fcmToken: string | null) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    const token = await signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
    return { sessionId: session.id, token };
  }

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'tablet' | 'phone', fcmToken: string | null) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name: form === 'phone' ? 'Pixel 7' : 'Tablet',
        tokenHash: hashDeviceToken(token),
        fcmToken,
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function addEvent(familyId: string, kidId: string | null, kind: string, minutesAgo: number) {
    const [event] = await db
      .insert(events)
      .values({ familyId, kidId, kind, at: new Date(Date.now() - minutesAgo * 60_000), payload: { n: minutesAgo } })
      .returning();
    if (!event) throw new Error('no event');
    return event.id;
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: zone, parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    familyA = a?.id ?? '';
    familyB = b?.id ?? '';
    const [p1, p2, p3] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: familyB, email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mumId = p1?.id ?? '';
    dadId = p2?.id ?? '';
    const mumApp = await signIn(familyA, mumId, 'fcm-mum');
    mum = mumApp.token;
    mumSession = mumApp.sessionId;
    dad = (await signIn(familyA, dadId, 'fcm-dad')).token;
    bea = (await signIn(familyB, p3?.id ?? '', 'fcm-bea')).token;
  });

  beforeEach(() => {
    sent.length = 0;
    dead = [];
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('PUT /v1/me/push-token', () => {
    it("saves the token on the caller's session and moves it off older sessions", async () => {
      const older = await signIn(familyA, mumId, 'fcm-shared');
      const newer = await signIn(familyA, mumId, null);
      expect((await api.put('/v1/me/push-token', newer.token, { fcmToken: 'fcm-shared' })).status).toBe(204);
      const [a] = await db.select().from(parentSessions).where(eq(parentSessions.id, older.sessionId));
      const [b] = await db.select().from(parentSessions).where(eq(parentSessions.id, newer.sessionId));
      expect(a?.fcmToken).toBeNull();
      expect(b?.fcmToken).toBe('fcm-shared');

      expect((await api.put('/v1/me/push-token', newer.token, { fcmToken: null })).status).toBe(204);
      const [cleared] = await db.select().from(parentSessions).where(eq(parentSessions.id, newer.sessionId));
      expect(cleared?.fcmToken).toBeNull();
    });

    it('refuses a revoked or unknown session and a bad body', async () => {
      const gone = await signIn(familyA, mumId, null);
      await db.update(parentSessions).set({ revokedAt: new Date() }).where(eq(parentSessions.id, gone.sessionId));
      expect((await api.put('/v1/me/push-token', gone.token, { fcmToken: 'x' })).status).toBe(401);
      const unknown = await tokenFor({ parentId: mumId, familyId: familyA });
      expect((await api.put('/v1/me/push-token', unknown, { fcmToken: 'x' })).status).toBe(401);
      expect((await api.put('/v1/me/push-token', mum, { fcmToken: '' })).status).toBe(422);
      expect((await api.put('/v1/me/push-token', null, { fcmToken: 'x' })).status).toBe(401);
      const [own] = await db.select().from(parentSessions).where(eq(parentSessions.id, mumSession));
      expect(own?.fcmToken).toBe('fcm-mum');
    });
  });

  describe('notification prefs', () => {
    it('lists every kind, all on, with the essential ones marked', async () => {
      const res = await api.get('/v1/me/notification-prefs', dad);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(10);
      expect(res.body.every((p: { enabled: boolean }) => p.enabled)).toBe(true);
      expect(res.body.filter((p: { essential: boolean }) => p.essential).map((p: { kind: string }) => p.kind)).toEqual([
        'sos',
        'parent_mode.request',
        'time_request',
      ]);
    });

    it('turns kinds off and on for one parent only, and refuses essential kinds', async () => {
      const res = await api.put('/v1/me/notification-prefs', dad, [
        { kind: 'device.enrolled', enabled: false },
        { kind: 'kid_message', enabled: false },
      ]);
      expect(res.status).toBe(200);
      expect(res.body).toContainEqual({ kind: 'device.enrolled', enabled: false, essential: false });
      expect(res.body).toContainEqual({ kind: 'kid_message', enabled: false, essential: false });
      const again = await api.put('/v1/me/notification-prefs', dad, [{ kind: 'kid_message', enabled: true }]);
      expect(again.body).toContainEqual({ kind: 'kid_message', enabled: true, essential: false });
      expect(again.body).toContainEqual({ kind: 'device.enrolled', enabled: false, essential: false });
      const mine = (await api.get('/v1/me/notification-prefs', mum)).body;
      expect(mine).toContainEqual({ kind: 'device.enrolled', enabled: true, essential: false });

      const refused = await api.put('/v1/me/notification-prefs', dad, [{ kind: 'time_request', enabled: false }]);
      expect(refused.status).toBe(422);
      expect(refused.body.error.message).toBe('Ask for more time notifications cannot be turned off.');
      expect((await api.put('/v1/me/notification-prefs', dad, [{ kind: 'sos.started', enabled: false }])).status).toBe(422);
      await db.delete(notificationPrefs).where(eq(notificationPrefs.parentId, dadId));
    });
  });

  describe('PUT /v1/device/push-token', () => {
    it('saves the token and takes it off any other device', async () => {
      const kidId = await addKid(familyA, 'Token kid');
      const old = await addDevice(familyA, kidId, 'tablet', 'fcm-tab');
      const fresh = await addDevice(familyA, kidId, 'tablet', null);
      expect((await api.put('/v1/device/push-token', fresh.token, { fcmToken: 'fcm-tab' })).status).toBe(204);
      const [a] = await db.select().from(devices).where(eq(devices.id, old.id));
      const [b] = await db.select().from(devices).where(eq(devices.id, fresh.id));
      expect(a?.fcmToken).toBeNull();
      expect(b?.fcmToken).toBe('fcm-tab');
      expect((await api.put('/v1/device/push-token', 'not-a-token', { fcmToken: 'x' })).status).toBe(401);
    });
  });

  describe('GET /v1/events', () => {
    it('pages newest first, filters by kid and kind, and only shows the own family', async () => {
      const kidId = await addKid(familyA, 'History kid');
      const otherKid = await addKid(familyA, 'Other kid');
      await addEvent(familyA, kidId, 'sos.started', 50);
      await addEvent(familyA, kidId, 'sos.ended', 40);
      await addEvent(familyA, kidId, 'overspend', 30);
      await addEvent(familyA, otherKid, 'overspend', 20);
      await addEvent(familyA, kidId, 'sosx', 10);
      await addEvent(familyB, null, 'overspend', 5);

      const first = await api.get(`/v1/events?kidId=${kidId}&limit=2`, mum);
      expect(first.status).toBe(200);
      expect(first.body.events.map((e: { kind: string }) => e.kind)).toEqual(['sosx', 'overspend']);
      expect(first.body.events[0]).toMatchObject({ kidId, kidName: 'History kid', deviceId: null, deviceName: null, payload: { n: 10 } });
      const second = await api.get(`/v1/events?kidId=${kidId}&limit=2&before=${first.body.nextBefore}`, mum);
      expect(second.body.events.map((e: { kind: string }) => e.kind)).toEqual(['sos.ended', 'sos.started']);
      expect(second.body.nextBefore).toBeNull();

      const sos = await api.get(`/v1/events?kidId=${kidId}&kind=sos`, mum);
      expect(sos.body.events.map((e: { kind: string }) => e.kind)).toEqual(['sos.ended', 'sos.started']);
      expect(sos.body.nextBefore).toBeNull();
      const overspend = await api.get('/v1/events?kind=overspend', mum);
      expect(overspend.body.events).toHaveLength(2);
      expect((await api.get('/v1/events?kind=overspend', bea)).body.events).toHaveLength(1);

      expect((await api.get('/v1/events?limit=101', mum)).status).toBe(422);
      expect((await api.get('/v1/events?kind=SOS', mum)).status).toBe(422);
      expect((await api.get('/v1/events', null)).status).toBe(401);
    });
  });

  describe('pushes', () => {
    it('tells the other parent and the kid devices in the pool about a grant', async () => {
      const kidId = await addKid(familyA, 'Grant kid');
      await addDevice(familyA, kidId, 'tablet', 'fcm-grant-tablet');
      await addDevice(familyA, kidId, 'phone', 'fcm-grant-phone');
      const revoked = await addDevice(familyA, kidId, 'tablet', 'fcm-grant-revoked');
      await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, revoked.id));

      const id = randomUUID();
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 15 })).status).toBe(201);
      expect(sentTo('fcm-mum')).toEqual([]);
      const [toDad] = sentTo('fcm-dad');
      expect(toDad).toMatchObject({
        high: false,
        msg: {
          v: 1,
          type: 'grant.by_other_parent',
          data: { kind: 'grant.added', kidId, kidName: 'Grant kid', payload: { grantId: id, minutes: 15, byName: 'Mum' } },
        },
      });
      const [toTablet] = sentTo('fcm-grant-tablet');
      expect(toTablet).toMatchObject({
        high: true,
        msg: { v: 1, type: 'grant_added', data: { grant: { id, minutes: 15, byName: 'Mum' }, byName: 'Mum' } },
      });
      expect(toTablet?.ttlSec).toBeGreaterThanOrEqual(60);
      expect(toTablet?.ttlSec).toBeLessThanOrEqual(24 * 3600);
      expect(sentTo('fcm-grant-phone')).toEqual([]);
      expect(sentTo('fcm-grant-revoked')).toEqual([]);
      expect(sentTo('fcm-bea')).toEqual([]);

      // Sending the same grant again changes nothing and pushes nothing.
      sent.length = 0;
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 15 })).status).toBe(200);
      expect(sent).toEqual([]);
    });

    it('skips muted kinds but never essential ones', async () => {
      await db
        .insert(notificationPrefs)
        .values([
          { familyId: familyA, parentId: mumId, kind: 'overspend', enabled: false },
          // Cannot be stored through the API; the dispatcher must still ignore it.
          { familyId: familyA, parentId: mumId, kind: 'sos', enabled: false },
        ]);
      const overspend = await addEvent(familyA, null, 'overspend', 0);
      const sos = await addEvent(familyA, null, 'sos.started', 0);
      const unknown = await addEvent(familyA, null, 'state.synced', 0);
      await notifyParents(deps, familyA, [overspend, sos, unknown]);
      expect(sentTo('fcm-mum').map((m) => m.msg.type)).toEqual(['sos']);
      expect(sentTo('fcm-mum')[0]?.high).toBe(true);
      expect(sentTo('fcm-dad').map((m) => m.msg.type).sort()).toEqual(['overspend', 'sos']);
      await db.delete(notificationPrefs).where(eq(notificationPrefs.parentId, mumId));
    });

    it('forgets tokens that FCM says are dead', async () => {
      const gone = await signIn(familyA, dadId, 'fcm-dead');
      dead = ['fcm-dead'];
      await notifyParents(deps, familyA, [await addEvent(familyA, null, 'overspend', 0)]);
      expect(sentTo('fcm-dead')).toHaveLength(1);
      const [row] = await db.select().from(parentSessions).where(eq(parentSessions.id, gone.sessionId));
      expect(row?.fcmToken).toBeNull();
    });

    it('tells parents when a device is enrolled', async () => {
      await api.put('/v1/me/notification-prefs', dad, [{ kind: 'device.enrolled', enabled: false }]);
      const kidId = await addKid(familyA, 'Enrol kid');
      const code = (await api.post(`/v1/kids/${kidId}/enrolment-codes`, mum, { form: 'phone' })).body.code;
      const res = await api.post('/v1/enrol', null, { code, ...phone });
      expect(res.status).toBe(201);
      expect(sentTo('fcm-mum')).toMatchObject([
        { msg: { type: 'device.enrolled', data: { kidId, deviceId: res.body.deviceId, deviceName: 'Pixel 7' } } },
      ]);
      // Dad turned these off.
      expect(sentTo('fcm-dad')).toEqual([]);
      await db.delete(notificationPrefs).where(eq(notificationPrefs.parentId, dadId));
    });
  });

  describe('overspend on usage upload', () => {
    it('reports offline overspend once, and again only when it grows by a minute', async () => {
      const kidId = await addKid(familyA, 'Offline kid');
      const tablet = await addDevice(familyA, kidId, 'tablet', null);
      const overspends = () =>
        db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'overspend')));

      // 130 minutes against 120: 10 minutes over.
      const long = { id: randomUUID(), startedAt: at(-130), endedAt: at(0), recordedOffline: true };
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [long] })).status).toBe(200);
      const [first] = await overspends();
      expect(first).toMatchObject({ deviceId: tablet.id, payload: { pool: 'screens', deviceName: 'Tablet' } });
      const firstSec = (first?.payload as { overspendSec: number }).overspendSec;
      expect(firstSec).toBeGreaterThanOrEqual(600);
      expect(firstSec).toBeLessThan(610);
      expect(sentTo('fcm-mum')).toMatchObject([{ msg: { type: 'overspend', data: { payload: { overspendSec: firstSec } } } }]);

      // The same segment again: nothing new.
      sent.length = 0;
      await api.post('/v1/device/usage', tablet.token, { segments: [long] });
      expect(await overspends()).toHaveLength(1);
      expect(sent).toEqual([]);

      // Five more minutes: a second report.
      const earlier = { id: randomUUID(), startedAt: at(-136), endedAt: at(-131), recordedOffline: true };
      await api.post('/v1/device/usage', tablet.token, { segments: [earlier] });
      const all = await overspends();
      expect(all).toHaveLength(2);
      expect(all.map((e) => (e.payload as { overspendSec: number }).overspendSec).sort((a, b) => a - b)[1]).toBeGreaterThanOrEqual(900);
    });

    it('does not report overspend from online use', async () => {
      const kidId = await addKid(familyA, 'Online kid');
      const tablet = await addDevice(familyA, kidId, 'tablet', null);
      const segment = { id: randomUUID(), startedAt: at(-130), endedAt: at(0), recordedOffline: false };
      await api.post('/v1/device/usage', tablet.token, { segments: [segment] });
      const rows = await db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'overspend')));
      expect(rows).toEqual([]);
      expect(sent).toEqual([]);
    });
  });
});
```

### 5.17 `server/test/openapi.test.ts`

```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../src/app.js';

describe('OpenAPI contract', () => {
  const doc = openApiDocument();

  it('describes GET /health and the shared schemas', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths?.['/health']?.get).toBeDefined();
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['ErrorCode', 'ErrorResponse', 'HealthResponse']),
    );
  });

  it('describes sign-in and GET /v1/me, with bearer auth where needed', () => {
    expect(doc.paths?.['/v1/auth/otp/request']?.post).toBeDefined();
    expect(doc.paths?.['/v1/auth/otp/verify']?.post).toBeDefined();
    expect(doc.paths?.['/v1/auth/refresh']?.post).toBeDefined();
    expect(doc.paths?.['/v1/auth/logout']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/me']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.components?.securitySchemes?.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['AuthResponse', 'Me', 'OtpRequest', 'OtpVerifyRequest', 'RefreshRequest', 'Role']),
    );
  });

  it('describes the family and super admin routes, all behind bearer auth', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch' | 'put' | 'delete']> = [
      ['/v1/family', 'get'],
      ['/v1/family', 'patch'],
      ['/v1/family/parents', 'get'],
      ['/v1/family/parents', 'post'],
      ['/v1/family/parents/{id}', 'patch'],
      ['/v1/family/parents/{id}', 'delete'],
      ['/v1/family/message-presets', 'get'],
      ['/v1/family/message-presets', 'put'],
      ['/v1/family/parent-code', 'get'],
      ['/v1/family/parent-code/rotate', 'post'],
      ['/v1/admin/families', 'get'],
      ['/v1/admin/families', 'post'],
      ['/v1/admin/families/{id}/parents', 'post'],
      ['/v1/admin/families/{id}/disable', 'post'],
    ];
    for (const [path, method] of routes) {
      expect(doc.paths?.[path]?.[method]?.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'AdminFamily',
        'AdminFamilyCreate',
        'AdminFamilyCreated',
        'Family',
        'FamilyPatch',
        'MessagePreset',
        'MessagePresetsPut',
        'Parent',
        'ParentCodeSecret',
        'ParentCreate',
        'ParentPatch',
      ]),
    );
  });

  it('describes the kid routes, all behind bearer auth', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch' | 'put' | 'delete']> = [
      ['/v1/kids', 'get'],
      ['/v1/kids', 'post'],
      ['/v1/kids/{kidId}', 'get'],
      ['/v1/kids/{kidId}', 'patch'],
      ['/v1/kids/{kidId}', 'delete'],
      ['/v1/kids/{kidId}/schedule', 'get'],
      ['/v1/kids/{kidId}/schedule', 'put'],
      ['/v1/kids/{kidId}/contacts', 'get'],
      ['/v1/kids/{kidId}/contacts', 'put'],
    ];
    for (const [path, method] of routes) {
      expect(doc.paths?.[path]?.[method]?.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'AvatarColor',
        'Kid',
        'KidContact',
        'KidContactsPut',
        'KidCreate',
        'KidPatch',
        'Schedule',
        'ScheduleDay',
        'ScheduleInput',
      ]),
    );
  });

  it('describes enrolment and the device routes, each with the right auth', () => {
    const parentRoutes: Array<[string, 'get' | 'post' | 'patch' | 'delete']> = [
      ['/v1/kids/{kidId}/enrolment-codes', 'post'],
      ['/v1/devices', 'get'],
      ['/v1/devices/{id}', 'patch'],
      ['/v1/devices/{id}', 'delete'],
    ];
    for (const [path, method] of parentRoutes) {
      expect(doc.paths?.[path]?.[method]?.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(doc.paths?.['/v1/enrol']?.post).toBeDefined();
    expect(doc.paths?.['/v1/enrol']?.post?.security).toBeUndefined();
    expect(doc.paths?.['/v1/device/me']?.get?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.components?.securitySchemes?.deviceAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'Device',
        'DeviceForm',
        'DeviceMe',
        'DevicePatch',
        'EnrolmentCode',
        'EnrolmentCodeCreate',
        'EnrolRequest',
        'EnrolResponse',
        'Platform',
        'Pool',
      ]),
    );
  });

  it('describes the state snapshot, usage upload and the dashboard', () => {
    expect(doc.paths?.['/v1/device/state']?.get?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/device/state']?.get?.responses?.['304']).toBeDefined();
    expect(doc.paths?.['/v1/device/usage']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/today']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'DeviceState',
        'LockReason',
        'PoolSegment',
        'StateGrant',
        'Today',
        'TodayDevice',
        'TodayKid',
        'TodayPool',
        'UsageReceipt',
        'UsageSegmentIn',
        'UsageUpload',
      ]),
    );
  });

  it('describes the grant routes, all behind bearer auth', () => {
    expect(doc.paths?.['/v1/kids/{kidId}/grants']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/kids/{kidId}/grants']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/kids/{kidId}/lock-now']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['Grant', 'GrantCreate', 'LocalDate', 'LockNow']),
    );
  });

  it('describes push tokens, notification settings and the event history, each with the right auth', () => {
    expect(doc.paths?.['/v1/me/push-token']?.put?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/me/notification-prefs']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/me/notification-prefs']?.put?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/events']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/device/push-token']?.put?.security).toEqual([{ deviceAuth: [] }]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['EventItem', 'EventPage', 'NotificationKind', 'NotificationPref', 'NotificationPrefsPut', 'PushTokenPut']),
    );
  });

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.18 `deploy/docker-compose.yml`

One line added: `FIREBASE_SERVICE_ACCOUNT_JSON`.

```yaml
# Screen Time: API server + PostgreSQL 18.
# Run from the repo root:  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
name: screentime

services:
  db:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_DB: screentime
      POSTGRES_USER: screentime
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in deploy/.env}
    volumes:
      # PostgreSQL 18 images keep data under /var/lib/postgresql/18/docker, so mount the parent.
      - db-data:/var/lib/postgresql
    ports:
      # Only reachable from this machine (for local development and backups).
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U screentime -d screentime"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    build:
      context: ..
      dockerfile: server/Dockerfile
    restart: unless-stopped
    environment:
      PORT: "8080"
      DATABASE_URL: postgres://screentime:${POSTGRES_PASSWORD}@db:5432/screentime
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in deploy/.env}
      SUPER_ADMIN_EMAIL: ${SUPER_ADMIN_EMAIL:-}
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASS: ${SMTP_PASS:-}
      SMTP_FROM: ${SMTP_FROM:-}
      SMTP_FROM_NAME: ${SMTP_FROM_NAME:-}
      FIREBASE_SERVICE_ACCOUNT_JSON: ${FIREBASE_SERVICE_ACCOUNT_JSON:-}
    ports:
      - "8080:8080"
    depends_on:
      db:
        condition: service_healthy

volumes:
  db-data:
```

### 5.19 `deploy/.env.example`

Adds the empty `FIREBASE_SERVICE_ACCOUNT_JSON=` at the end. Leave it empty: the real key goes only into James's own `deploy/.env` or the Unraid container, never into git.

```bash
# Copy to deploy/.env (git-ignored) and change the values. Never commit deploy/.env.
POSTGRES_PASSWORD=change-me

# Signs sign-in tokens. At least 32 random characters (the server refuses to start otherwise). Make one with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_SECRET=change-me

# Signing in with this email gives the super admin role (docs/SPEC.md §6.2). Leave empty for none.
SUPER_ADMIN_EMAIL=

# Brevo SMTP relay (docs/SPEC.md §11.1). Leave SMTP_USER, SMTP_PASS or SMTP_FROM empty to log
# sign-in codes to the api container log instead of emailing them (development only).
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=no-reply@gallagherhome.au
SMTP_FROM_NAME=ScreenTime App

# Firebase Cloud Messaging (docs/SPEC.md §10, §13): the service account key of Firebase project
# screentime-d307c (Project settings, Service accounts, Generate new private key), as ONE line of JSON
# in single quotes. Leave empty to send no push notifications (development only). Never commit the key.
FIREBASE_SERVICE_ACCOUNT_JSON=
```

### 5.20 `contract/openapi.json` (generated)

Do **not** write this by hand. After all the files above, run from the repo root:

```powershell
pnpm contract
```

It prints `wrote ...\contract\openapi.json`. The file must be exactly this:

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Screen Time API",
    "version": "0.1.0"
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      },
      "deviceAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "The opaque device token from POST /v1/enrol."
      }
    },
    "schemas": {
      "HealthResponse": {
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "ok"
            ]
          },
          "service": {
            "type": "string",
            "minLength": 1
          },
          "time": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "status",
          "service",
          "time"
        ]
      },
      "ErrorResponse": {
        "type": "object",
        "properties": {
          "error": {
            "type": "object",
            "properties": {
              "code": {
                "$ref": "#/components/schemas/ErrorCode"
              },
              "message": {
                "type": "string"
              },
              "details": {
                "type": "object",
                "additionalProperties": {}
              }
            },
            "required": [
              "code",
              "message"
            ]
          }
        },
        "required": [
          "error"
        ]
      },
      "ErrorCode": {
        "type": "string",
        "enum": [
          "unauthorized",
          "forbidden",
          "not_found",
          "conflict",
          "validation_failed",
          "rate_limited",
          "internal"
        ]
      },
      "OtpRequest": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 254,
            "format": "email"
          }
        },
        "required": [
          "email"
        ]
      },
      "AuthResponse": {
        "type": "object",
        "properties": {
          "accessToken": {
            "type": "string"
          },
          "refreshToken": {
            "type": "string"
          },
          "expiresIn": {
            "type": "integer",
            "exclusiveMinimum": 0
          },
          "me": {
            "$ref": "#/components/schemas/Me"
          }
        },
        "required": [
          "accessToken",
          "refreshToken",
          "expiresIn",
          "me"
        ]
      },
      "Me": {
        "type": "object",
        "properties": {
          "parent": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "email": {
                "type": "string",
                "format": "email"
              },
              "displayName": {
                "type": "string"
              },
              "phoneE164": {
                "type": [
                  "string",
                  "null"
                ]
              }
            },
            "required": [
              "id",
              "email",
              "displayName",
              "phoneE164"
            ]
          },
          "family": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              },
              "timezone": {
                "type": "string"
              },
              "emergencyNumber": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "name",
              "timezone",
              "emergencyNumber"
            ]
          },
          "roles": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Role"
            }
          }
        },
        "required": [
          "parent",
          "family",
          "roles"
        ]
      },
      "Role": {
        "type": "string",
        "enum": [
          "parent",
          "superadmin"
        ]
      },
      "OtpVerifyRequest": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 254,
            "format": "email"
          },
          "code": {
            "type": "string",
            "pattern": "^[0-9]{6}$"
          },
          "client": {
            "type": "string",
            "enum": [
              "web",
              "android"
            ]
          },
          "clientLabel": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "email",
          "code",
          "client",
          "clientLabel"
        ]
      },
      "RefreshRequest": {
        "type": "object",
        "properties": {
          "refreshToken": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "required": [
          "refreshToken"
        ]
      },
      "Family": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "timezone": {
            "type": "string"
          },
          "emergencyNumber": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name",
          "timezone",
          "emergencyNumber"
        ]
      },
      "FamilyPatch": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "timezone": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "emergencyNumber": {
            "type": "string",
            "pattern": "^[0-9]{2,6}$"
          }
        }
      },
      "Parent": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "email": {
            "type": "string",
            "format": "email"
          },
          "displayName": {
            "type": "string"
          },
          "phoneE164": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "email",
          "displayName",
          "phoneE164"
        ]
      },
      "ParentCreate": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 254,
            "format": "email"
          },
          "displayName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "phoneE164": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\+[1-9][0-9]{6,14}$"
          }
        },
        "required": [
          "email",
          "displayName"
        ]
      },
      "ParentPatch": {
        "type": "object",
        "properties": {
          "displayName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "phoneE164": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\+[1-9][0-9]{6,14}$"
          }
        }
      },
      "MessagePreset": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "text"
        ]
      },
      "MessagePresetsPut": {
        "type": "object",
        "properties": {
          "presets": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "text": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160
                }
              },
              "required": [
                "text"
              ]
            },
            "maxItems": 10
          }
        },
        "required": [
          "presets"
        ]
      },
      "ParentCodeSecret": {
        "type": "object",
        "properties": {
          "secret": {
            "type": "string",
            "pattern": "^[A-Z2-7]{32}$"
          }
        },
        "required": [
          "secret"
        ]
      },
      "Kid": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "avatarColor": {
            "$ref": "#/components/schemas/AvatarColor"
          }
        },
        "required": [
          "id",
          "name",
          "avatarColor"
        ]
      },
      "AvatarColor": {
        "type": "string",
        "enum": [
          "#0F766E",
          "#7C3AED",
          "#DB2777",
          "#2563EB",
          "#EA580C",
          "#16A34A",
          "#CA8A04",
          "#475569"
        ]
      },
      "KidCreate": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "avatarColor": {
            "$ref": "#/components/schemas/AvatarColor"
          }
        },
        "required": [
          "name",
          "avatarColor"
        ]
      },
      "KidPatch": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "avatarColor": {
            "$ref": "#/components/schemas/AvatarColor"
          }
        }
      },
      "Schedule": {
        "type": "object",
        "properties": {
          "version": {
            "type": "integer"
          },
          "warn1Min": {
            "type": "integer"
          },
          "warn2Min": {
            "type": "integer"
          },
          "days": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ScheduleDay"
            }
          }
        },
        "required": [
          "version",
          "warn1Min",
          "warn2Min",
          "days"
        ]
      },
      "ScheduleDay": {
        "type": "object",
        "properties": {
          "weekday": {
            "type": "integer",
            "minimum": 1,
            "maximum": 7
          },
          "screensMin": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1440
          },
          "phoneMin": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1440
          },
          "wake": {
            "type": "string",
            "pattern": "^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$"
          },
          "bedtime": {
            "type": "string",
            "pattern": "^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$"
          }
        },
        "required": [
          "weekday",
          "screensMin",
          "phoneMin",
          "wake",
          "bedtime"
        ]
      },
      "ScheduleInput": {
        "type": "object",
        "properties": {
          "warn1Min": {
            "type": "integer",
            "minimum": 2,
            "maximum": 60
          },
          "warn2Min": {
            "type": "integer",
            "minimum": 1,
            "maximum": 59
          },
          "days": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ScheduleDay"
            }
          }
        },
        "required": [
          "warn1Min",
          "warn2Min",
          "days"
        ]
      },
      "KidContact": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "label": {
            "type": "string"
          },
          "phoneE164": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "label",
          "phoneE164"
        ]
      },
      "KidContactsPut": {
        "type": "object",
        "properties": {
          "contacts": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "label": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 40
                },
                "phoneE164": {
                  "type": "string",
                  "pattern": "^\\+[1-9][0-9]{6,14}$"
                }
              },
              "required": [
                "label",
                "phoneE164"
              ]
            },
            "maxItems": 10
          }
        },
        "required": [
          "contacts"
        ]
      },
      "EnrolmentCode": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^[0-9]{6}$"
          },
          "qrPayload": {
            "type": "string"
          },
          "expiresAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "code",
          "qrPayload",
          "expiresAt"
        ]
      },
      "EnrolmentCodeCreate": {
        "type": "object",
        "properties": {
          "form": {
            "$ref": "#/components/schemas/DeviceForm"
          }
        },
        "required": [
          "form"
        ]
      },
      "DeviceForm": {
        "type": "string",
        "enum": [
          "phone",
          "tablet",
          "pc"
        ]
      },
      "Device": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "kidId": {
            "type": "string",
            "format": "uuid"
          },
          "platform": {
            "$ref": "#/components/schemas/Platform"
          },
          "form": {
            "$ref": "#/components/schemas/DeviceForm"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "name": {
            "type": "string"
          },
          "hasCellular": {
            "type": "boolean"
          },
          "model": {
            "type": [
              "string",
              "null"
            ]
          },
          "osVersion": {
            "type": [
              "string",
              "null"
            ]
          },
          "appVersion": {
            "type": [
              "string",
              "null"
            ]
          },
          "windowsUserName": {
            "type": [
              "string",
              "null"
            ]
          },
          "enrolledAt": {
            "type": "string",
            "format": "date-time"
          },
          "lastSeenAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "kidId",
          "platform",
          "form",
          "pool",
          "name",
          "hasCellular",
          "model",
          "osVersion",
          "appVersion",
          "windowsUserName",
          "enrolledAt",
          "lastSeenAt"
        ]
      },
      "Platform": {
        "type": "string",
        "enum": [
          "android",
          "windows"
        ]
      },
      "Pool": {
        "type": "string",
        "enum": [
          "screens",
          "phone"
        ]
      },
      "DevicePatch": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          }
        }
      },
      "EnrolResponse": {
        "type": "object",
        "properties": {
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "deviceToken": {
            "type": "string"
          },
          "kid": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "name"
            ]
          },
          "family": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "timezone": {
                "type": "string"
              }
            },
            "required": [
              "name",
              "timezone"
            ]
          }
        },
        "required": [
          "deviceId",
          "deviceToken",
          "kid",
          "family"
        ]
      },
      "EnrolRequest": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^[0-9]{6}$"
          },
          "platform": {
            "$ref": "#/components/schemas/Platform"
          },
          "hasCellular": {
            "type": "boolean"
          },
          "model": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "osVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "appVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "machineId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "windowsUserSid": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "windowsUserName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "code",
          "platform",
          "hasCellular",
          "model",
          "osVersion",
          "appVersion"
        ]
      },
      "DeviceMe": {
        "type": "object",
        "properties": {
          "device": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              },
              "form": {
                "$ref": "#/components/schemas/DeviceForm"
              },
              "pool": {
                "$ref": "#/components/schemas/Pool"
              },
              "hasCellular": {
                "type": "boolean"
              }
            },
            "required": [
              "id",
              "name",
              "form",
              "pool",
              "hasCellular"
            ]
          },
          "kid": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "name"
            ]
          },
          "family": {
            "type": "object",
            "properties": {
              "timezone": {
                "type": "string"
              },
              "emergencyNumber": {
                "type": "string"
              }
            },
            "required": [
              "timezone",
              "emergencyNumber"
            ]
          }
        },
        "required": [
          "device",
          "kid",
          "family"
        ]
      },
      "DeviceState": {
        "type": "object",
        "properties": {
          "serverTime": {
            "type": "string",
            "format": "date-time"
          },
          "stateVersion": {
            "type": "string"
          },
          "device": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              },
              "form": {
                "$ref": "#/components/schemas/DeviceForm"
              },
              "pool": {
                "$ref": "#/components/schemas/Pool"
              },
              "hasCellular": {
                "type": "boolean"
              }
            },
            "required": [
              "id",
              "name",
              "form",
              "pool",
              "hasCellular"
            ]
          },
          "kid": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "name"
            ]
          },
          "family": {
            "type": "object",
            "properties": {
              "timezone": {
                "type": "string"
              },
              "emergencyNumber": {
                "type": "string"
              },
              "parentCodeSecret": {
                "type": "string"
              }
            },
            "required": [
              "timezone",
              "emergencyNumber",
              "parentCodeSecret"
            ]
          },
          "parents": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "displayName": {
                  "type": "string"
                },
                "phoneE164": {
                  "type": [
                    "string",
                    "null"
                  ]
                }
              },
              "required": [
                "id",
                "displayName",
                "phoneE164"
              ]
            }
          },
          "contacts": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "label": {
                  "type": "string"
                },
                "phoneE164": {
                  "type": "string"
                }
              },
              "required": [
                "label",
                "phoneE164"
              ]
            }
          },
          "messagePresets": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "text": {
                  "type": "string"
                }
              },
              "required": [
                "id",
                "text"
              ]
            }
          },
          "schedule": {
            "$ref": "#/components/schemas/Schedule"
          },
          "today": {
            "type": "object",
            "properties": {
              "date": {
                "type": "string"
              },
              "grants": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/StateGrant"
                }
              },
              "poolSegments": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/PoolSegment"
                }
              }
            },
            "required": [
              "date",
              "grants",
              "poolSegments"
            ]
          },
          "parentMode": {
            "type": "object",
            "properties": {
              "active": {
                "type": "boolean"
              },
              "endsAt": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date-time"
              },
              "byName": {
                "type": [
                  "string",
                  "null"
                ]
              }
            },
            "required": [
              "active",
              "endsAt",
              "byName"
            ]
          },
          "pendingRequest": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "minutes": {
                "type": "integer"
              },
              "createdAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "id",
              "minutes",
              "createdAt"
            ]
          },
          "activeSos": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "startedAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "id",
              "startedAt"
            ]
          }
        },
        "required": [
          "serverTime",
          "stateVersion",
          "device",
          "kid",
          "family",
          "parents",
          "contacts",
          "messagePresets",
          "schedule",
          "today",
          "parentMode",
          "pendingRequest",
          "activeSos"
        ]
      },
      "StateGrant": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "minutes": {
            "type": "integer"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "byName": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "minutes",
          "createdAt",
          "byName"
        ]
      },
      "PoolSegment": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "endedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "deviceId",
          "startedAt",
          "endedAt"
        ]
      },
      "UsageReceipt": {
        "type": "object",
        "properties": {
          "received": {
            "type": "integer"
          }
        },
        "required": [
          "received"
        ]
      },
      "UsageUpload": {
        "type": "object",
        "properties": {
          "segments": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/UsageSegmentIn"
            },
            "minItems": 1,
            "maxItems": 500
          }
        },
        "required": [
          "segments"
        ]
      },
      "UsageSegmentIn": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "endedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "recordedOffline": {
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "startedAt",
          "endedAt",
          "recordedOffline"
        ]
      },
      "Today": {
        "type": "object",
        "properties": {
          "serverTime": {
            "type": "string",
            "format": "date-time"
          },
          "date": {
            "type": "string"
          },
          "kids": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TodayKid"
            }
          }
        },
        "required": [
          "serverTime",
          "date",
          "kids"
        ]
      },
      "TodayKid": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "avatarColor": {
            "$ref": "#/components/schemas/AvatarColor"
          },
          "pools": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TodayPool"
            }
          }
        },
        "required": [
          "id",
          "name",
          "avatarColor",
          "pools"
        ]
      },
      "TodayPool": {
        "type": "object",
        "properties": {
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "allowanceMin": {
            "type": "integer"
          },
          "grantedMin": {
            "type": "integer"
          },
          "usedSec": {
            "type": "integer"
          },
          "remainingSec": {
            "type": "integer"
          },
          "locked": {
            "type": "boolean"
          },
          "lockReason": {
            "$ref": "#/components/schemas/LockReason"
          },
          "nextLockAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "overspendSec": {
            "type": "integer"
          },
          "devices": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TodayDevice"
            }
          }
        },
        "required": [
          "pool",
          "allowanceMin",
          "grantedMin",
          "usedSec",
          "remainingSec",
          "locked",
          "lockReason",
          "nextLockAt",
          "overspendSec",
          "devices"
        ]
      },
      "LockReason": {
        "type": [
          "string",
          "null"
        ],
        "enum": [
          "out_of_time",
          "bedtime",
          "before_wake",
          null
        ]
      },
      "TodayDevice": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "form": {
            "$ref": "#/components/schemas/DeviceForm"
          },
          "inUse": {
            "type": "boolean"
          },
          "lastSeenAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "parentMode": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "endsAt": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date-time"
              },
              "byName": {
                "type": [
                  "string",
                  "null"
                ]
              }
            },
            "required": [
              "endsAt",
              "byName"
            ]
          }
        },
        "required": [
          "id",
          "name",
          "form",
          "inUse",
          "lastSeenAt",
          "parentMode"
        ]
      },
      "Grant": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "minutes": {
            "type": "integer"
          },
          "day": {
            "$ref": "#/components/schemas/LocalDate"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "byName": {
            "type": "string"
          },
          "note": {
            "type": [
              "string",
              "null"
            ]
          },
          "requestId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          }
        },
        "required": [
          "id",
          "pool",
          "minutes",
          "day",
          "createdAt",
          "byName",
          "note",
          "requestId"
        ]
      },
      "LocalDate": {
        "type": "string",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
      },
      "GrantCreate": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "minutes": {
            "type": "integer",
            "minimum": -1440,
            "maximum": 1440
          },
          "note": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1,
            "maxLength": 160
          }
        },
        "required": [
          "id",
          "pool",
          "minutes"
        ]
      },
      "LockNow": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          }
        },
        "required": [
          "id",
          "pool"
        ]
      },
      "PushTokenPut": {
        "type": "object",
        "properties": {
          "fcmToken": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1,
            "maxLength": 4096
          }
        },
        "required": [
          "fcmToken"
        ]
      },
      "NotificationPref": {
        "type": "object",
        "properties": {
          "kind": {
            "$ref": "#/components/schemas/NotificationKind"
          },
          "enabled": {
            "type": "boolean"
          },
          "essential": {
            "type": "boolean"
          }
        },
        "required": [
          "kind",
          "enabled",
          "essential"
        ]
      },
      "NotificationKind": {
        "type": "string",
        "enum": [
          "sos",
          "tamper",
          "parent_mode.request",
          "parent_mode.used",
          "time_request",
          "kid_message",
          "overspend",
          "device.offline",
          "device.enrolled",
          "grant.by_other_parent"
        ]
      },
      "NotificationPrefsPut": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "kind": {
              "$ref": "#/components/schemas/NotificationKind"
            },
            "enabled": {
              "type": "boolean"
            }
          },
          "required": [
            "kind",
            "enabled"
          ]
        },
        "minItems": 1,
        "maxItems": 10
      },
      "EventPage": {
        "type": "object",
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/EventItem"
            }
          },
          "nextBefore": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          }
        },
        "required": [
          "events",
          "nextBefore"
        ]
      },
      "EventItem": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "kind": {
            "type": "string"
          },
          "at": {
            "type": "string",
            "format": "date-time"
          },
          "kidId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "kidName": {
            "type": [
              "string",
              "null"
            ]
          },
          "deviceId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "deviceName": {
            "type": [
              "string",
              "null"
            ]
          },
          "payload": {
            "type": "object",
            "additionalProperties": {}
          }
        },
        "required": [
          "id",
          "kind",
          "at",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "payload"
        ]
      },
      "AdminFamily": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "timezone": {
            "type": "string"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "disabledAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "parentCount": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "id",
          "name",
          "timezone",
          "createdAt",
          "disabledAt",
          "parentCount"
        ]
      },
      "AdminFamilyCreated": {
        "type": "object",
        "properties": {
          "family": {
            "$ref": "#/components/schemas/Family"
          },
          "parent": {
            "$ref": "#/components/schemas/Parent"
          }
        },
        "required": [
          "family",
          "parent"
        ]
      },
      "AdminFamilyCreate": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "timezone": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "emergencyNumber": {
            "type": "string",
            "pattern": "^[0-9]{2,6}$"
          },
          "firstParent": {
            "$ref": "#/components/schemas/ParentCreate"
          }
        },
        "required": [
          "name",
          "timezone",
          "firstParent"
        ]
      }
    },
    "parameters": {}
  },
  "paths": {
    "/health": {
      "get": {
        "tags": [
          "public"
        ],
        "summary": "Check that the server is up",
        "responses": {
          "200": {
            "description": "The server is up.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/HealthResponse"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected server error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/otp/request": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Email a sign-in code",
        "description": "Always answers 204, whether or not the email belongs to a parent.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OtpRequest"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Code sent if the email can sign in."
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "429": {
            "description": "Too many attempts. Try again later.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/otp/verify": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Sign in with an emailed code",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OtpVerifyRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Signed in.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/AuthResponse"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "429": {
            "description": "Too many attempts. Try again later.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/refresh": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Swap a refresh token for a new token pair",
        "description": "The refresh token rotates: the old one stops working.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/RefreshRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "New tokens.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/AuthResponse"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/logout": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Sign out this session",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "204": {
            "description": "Signed out."
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/me": {
      "get": {
        "tags": [
          "parent"
        ],
        "summary": "The signed-in parent, family and roles",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The caller.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Me"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/family": {
      "get": {
        "tags": [
          "family"
        ],
        "summary": "The family of the signed-in parent",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The family.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Family"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "patch": {
        "tags": [
          "family"
        ],
        "summary": "Change the family name, time zone or emergency number",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/FamilyPatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The changed family.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Family"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/family/parents": {
      "get": {
        "tags": [
          "family"
        ],
        "summary": "Parents in the family",
        "description": "Removed (disabled) parents are left out.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The parents, oldest first.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Parent"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": [
          "family"
        ],
        "summary": "Add a parent",
        "description": "They sign in with their email; no invitation is sent.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ParentCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The new parent.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Parent"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/family/parents/{id}": {
      "patch": {
        "tags": [
          "family"
        ],
        "summary": "Change the name or phone of a parent",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ParentPatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The changed parent.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Parent"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "delete": {
        "tags": [
          "family"
        ],
        "summary": "Remove a parent",
        "description": "Disables the parent and signs out all their sessions. You cannot remove yourself.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Removed."
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/family/message-presets": {
      "get": {
        "tags": [
          "family"
        ],
        "summary": "Messages kids can send with one tap",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The presets, in order.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/MessagePreset"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "put": {
        "tags": [
          "family"
        ],
        "summary": "Replace the whole preset list",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/MessagePresetsPut"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The new presets, in order.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/MessagePreset"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/family/parent-code": {
      "get": {
        "tags": [
          "family"
        ],
        "summary": "Secret for offline parent-mode codes",
        "description": "The parent app caches it to show rotating codes when a kid device is offline.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The secret.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentCodeSecret"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/family/parent-code/rotate": {
      "post": {
        "tags": [
          "family"
        ],
        "summary": "Replace the parent-code secret",
        "description": "Old codes stop working once devices sync.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The new secret.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentCodeSecret"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/kids": {
      "get": {
        "tags": [
          "kids"
        ],
        "summary": "Kids in the family",
        "description": "Archived kids are left out.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The kids, oldest first.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Kid"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": [
          "kids"
        ],
        "summary": "Add a kid",
        "description": "The kid starts with the default schedule (version 1) and no contacts.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/KidCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The new kid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Kid"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/kids/{kidId}": {
      "get": {
        "tags": [
          "kids"
        ],
        "summary": "One kid",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "The kid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Kid"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "patch": {
        "tags": [
          "kids"
        ],
        "summary": "Change the name or colour of a kid",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/KidPatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The changed kid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Kid"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "delete": {
        "tags": [
          "kids"
        ],
        "summary": "Archive a kid",
        "description": "The kid disappears from lists and their devices are revoked; their history stays.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Archived."
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/kids/{kidId}/schedule": {
      "get": {
        "tags": [
          "kids"
        ],
        "summary": "The current schedule of a kid",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "The highest schedule version.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Schedule"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "put": {
        "tags": [
          "kids"
        ],
        "summary": "Save a new schedule version",
        "description": "Old versions are kept. Devices pick up the new one on their next sync.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ScheduleInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The new schedule.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Schedule"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/kids/{kidId}/contacts": {
      "get": {
        "tags": [
          "kids"
        ],
        "summary": "The always-callable list of a kid",
        "description": "Parents with a phone number are always callable too; they are not in this list.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "The contacts, in order.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/KidContact"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "put": {
        "tags": [
          "kids"
        ],
        "summary": "Replace the whole contact list",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/KidContactsPut"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The new contacts, in order.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/KidContact"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/kids/{kidId}/enrolment-codes": {
      "post": {
        "tags": [
          "devices"
        ],
        "summary": "Make a code to add a device for a kid",
        "description": "The code works once, for 10 minutes. Show it in large digits and as a QR code of `qrPayload`.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/EnrolmentCodeCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The code.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/EnrolmentCode"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/devices": {
      "get": {
        "tags": [
          "devices"
        ],
        "summary": "Devices in the family",
        "description": "Revoked devices are left out.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The devices, oldest first.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Device"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/devices/{id}": {
      "patch": {
        "tags": [
          "devices"
        ],
        "summary": "Rename a device or move it to another pool",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/DevicePatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The changed device.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Device"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "delete": {
        "tags": [
          "devices"
        ],
        "summary": "Revoke a device",
        "description": "Its token stops working at once. Its history stays.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Revoked."
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/enrol": {
      "post": {
        "tags": [
          "devices"
        ],
        "summary": "Enrol a kid device with a code",
        "description": "Called by the kid device. No sign-in: the code is the proof.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/EnrolRequest"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Enrolled. Keep the device token safe; it is not shown again.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/EnrolResponse"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "429": {
            "description": "Too many attempts. Try again later.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/device/me": {
      "get": {
        "tags": [
          "device"
        ],
        "summary": "The calling device, its kid and family",
        "description": "A 401 means the device was revoked and must be enrolled again.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "This device.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DeviceMe"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/device/state": {
      "get": {
        "tags": [
          "device"
        ],
        "summary": "Everything this device needs to enforce",
        "description": "Send the last `stateVersion` as `If-None-Match` to get 304 when nothing changed. A 304 has no body; use its `Date` header as the server time.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The snapshot.",
            "headers": {
              "ETag": {
                "description": "The `stateVersion` in quotes.",
                "schema": {
                  "type": "string"
                }
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DeviceState"
                }
              }
            }
          },
          "304": {
            "description": "Nothing changed since the `stateVersion` sent in `If-None-Match`."
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/device/usage": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Upload usage segments",
        "description": "Safe to send again. A segment sent again keeps its first `startedAt` and the latest `endedAt`; once closed it never reopens.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/UsageUpload"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Stored.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/UsageReceipt"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/today": {
      "get": {
        "tags": [
          "parent"
        ],
        "summary": "Used and remaining time today for every kid and pool",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The dashboard.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Today"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/kids/{kidId}/grants": {
      "get": {
        "tags": [
          "grants"
        ],
        "summary": "A kid's time adjustments for one day",
        "description": "Both pools, oldest first. `day` is the family-local date; today when left out.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          },
          {
            "schema": {
              "$ref": "#/components/schemas/LocalDate"
            },
            "required": false,
            "name": "day",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "The grants.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Grant"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": [
          "grants"
        ],
        "summary": "Add or remove time for today",
        "description": "Counts for today only. Sending the same `id` again returns the stored grant with 200 and changes nothing.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/GrantCreate"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Already stored with this id.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Grant"
                }
              }
            }
          },
          "201": {
            "description": "Stored.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Grant"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/kids/{kidId}/lock-now": {
      "post": {
        "tags": [
          "grants"
        ],
        "summary": "Lock a pool now",
        "description": "Takes away the time left in the pool, rounded up to a whole minute, as a negative grant. Sending the same `id` again returns the stored grant with 200.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "kidId",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/LockNow"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Already stored with this id.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Grant"
                }
              }
            }
          },
          "201": {
            "description": "Locked.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Grant"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/me/push-token": {
      "put": {
        "tags": [
          "notifications"
        ],
        "summary": "Set this parent app's push token",
        "description": "For the session of the access token. null stops pushes to this app. Signing out also stops them.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PushTokenPut"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Saved."
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/me/notification-prefs": {
      "get": {
        "tags": [
          "notifications"
        ],
        "summary": "Which notifications this parent gets",
        "description": "Every kind, in a fixed order. Essential kinds are always on.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The settings.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/NotificationPref"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "put": {
        "tags": [
          "notifications"
        ],
        "summary": "Turn notification kinds on or off",
        "description": "Kinds left out keep their setting. Turning off an essential kind is refused (422). Muting only stops the push: the history still shows every event.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/NotificationPrefsPut"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Every kind after the change.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/NotificationPref"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/device/push-token": {
      "put": {
        "tags": [
          "device"
        ],
        "summary": "Set this kid device's push token",
        "description": "Android only. null stops pushes to this device.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PushTokenPut"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Saved."
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/events": {
      "get": {
        "tags": [
          "notifications"
        ],
        "summary": "The event history",
        "description": "Newest first, every kind (muted ones too), archived kids included. `limit` defaults to 50. For the next page pass `nextBefore` as `before`.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "kidId",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "maxLength": 64,
              "pattern": "^[a-z_]+(\\.[a-z_]+)*$"
            },
            "required": false,
            "name": "kind",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "before",
            "in": "query"
          },
          {
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            },
            "required": false,
            "name": "limit",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "One page of events.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/EventPage"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/admin/families": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Every family on this server",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "The families, oldest first.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/AdminFamily"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": [
          "admin"
        ],
        "summary": "Create a family with its first parent",
        "description": "Also creates the default message presets and a parent-code secret.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/AdminFamilyCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The new family and parent.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/AdminFamilyCreated"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/admin/families/{id}/parents": {
      "post": {
        "tags": [
          "admin"
        ],
        "summary": "Add a parent to any family",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ParentCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "The new parent.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Parent"
                }
              }
            }
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "409": {
            "description": "Conflicts with existing data.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    },
    "/v1/admin/families/{id}/disable": {
      "post": {
        "tags": [
          "admin"
        ],
        "summary": "Disable a family",
        "description": "Its parents can no longer sign in, and every parent session is signed out.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Disabled."
          },
          "401": {
            "description": "Not signed in, or the code or token is wrong or expired.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "403": {
            "description": "Signed in, but not allowed to do this.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "description": "Not found.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "description": "The request is not valid.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    }
  },
  "webhooks": {}
}
```

## 6. Detailed spec

### 6.1 Notification kinds

| Kind | Event kinds it covers | Essential |
|---|---|---|
| `sos` | every `sos.*` | yes |
| `tamper` | every `tamper.*` | no |
| `parent_mode.request` | `parent_mode.request` | yes |
| `parent_mode.used` | `parent_mode.used` | no |
| `time_request` | `time_request` | yes (James, 25 Oct 2026) |
| `kid_message` | `kid_message` | no |
| `overspend` | `overspend` | no |
| `device.offline` | `device.offline` | no |
| `device.enrolled` | `device.enrolled` | no |
| `grant.by_other_parent` | `grant.added` | no |

Any other event kind is history only (`notificationKindOf` returns null).

### 6.2 Who gets a parent push

For each committed event with a notification kind, one push to every parent session that: is not revoked, has an `fcm_token`, and belongs to an enabled parent of the family. Skip the session when the kind is not essential and that parent has a `notification_prefs` row for the kind with `enabled = false`. For `grant.by_other_parent`, skip the parent who made the grant (`grants.created_by`). The message is `{ v: 1, type: <notification kind>, at: <event at>, data: <the event exactly as GET /v1/events shows it> }`, FCM priority `high` for essential kinds and `normal` for the rest.

### 6.3 Kid device pushes

A new grant (not a repeat of a stored id) also sends `{ v: 1, type: "grant_added", at, data: { grant: { id, minutes, createdAt, byName }, byName } }` to every Android device of that kid in the grant's pool that is not revoked and has an `fcm_token`, priority `high`, time to live = seconds until the family's local midnight (at least 60).

### 6.4 Sending

- Pushes go out **after** the transaction commits, and the HTTP answer waits for them. A push failure is caught and logged (`push to parents failed`, `push to kid devices failed`, `push not sent: <code>`); the request still succeeds.
- Tokens that FCM answers with `registration-token-not-registered` or `invalid-registration-token` are set to null on every parent session and device that has them.
- `FIREBASE_SERVICE_ACCOUNT_JSON` empty: `createPusher(null)` sends nothing, and the server logs `Firebase is not configured: no push notifications are sent` at start. `AppDeps.pusher` left out (most tests): nothing is sent.

### 6.5 Routes

| Route | Auth | Answer |
|---|---|---|
| `PUT /v1/me/push-token` `{ fcmToken \| null }` | parent | 204. Saves the token on the session of the access token, and removes the same token from the family's other sessions. Revoked or unknown session: 401 `Sign in again.` Token 1 to 4096 characters, else 422 |
| `GET /v1/me/notification-prefs` | parent | 200: all 10 kinds in the order of 6.1, each `{ kind, enabled, essential }` |
| `PUT /v1/me/notification-prefs` `[{ kind, enabled }]` | parent | 200 with the full list. 1 to 10 entries, each kind once; kinds left out keep their setting. Turning off an essential kind: 422 `<name> notifications cannot be turned off.` (for example `SOS notifications cannot be turned off.`) |
| `PUT /v1/device/push-token` `{ fcmToken \| null }` | device | 204. Removes the same token from the family's other devices |
| `GET /v1/events?kidId=&kind=&before=&limit=` | parent | 200 `{ events, nextBefore }`, newest first (by `at`, then `id`). `kind` matches the event kind or its start (`sos` matches `sos.started`, not `sosx`); lower case letters, `_` and `.` only, else 422. `limit` 1 to 100, default 50. `nextBefore` is the last event's id when there are more, else null; pass it as `before` |

### 6.6 Offline overspend

After `POST /v1/device/usage` stores at least one segment with `recordedOffline: true`, in the same transaction: run the engine for the kid and **the uploading device's pool** today. If `overspendSec` is at least 60, and it is at least 60 more than the largest `overspendSec` already reported in an `overspend` event for that kid, pool and day, write an event `overspend` with `device_id` = the uploader and `payload` `{ pool, overspendSec, day, deviceName }`. After the commit, notify parents. Uploads with only online segments never write one.

### 6.7 OpenAPI

New operations: `PUT /v1/me/push-token`, `GET` and `PUT /v1/me/notification-prefs`, `GET /v1/events` (all `bearerAuth`, tag `notifications`) and `PUT /v1/device/push-token` (`deviceAuth`, tag `device`). New named schemas: `EventItem`, `EventPage`, `NotificationKind`, `NotificationPref`, `NotificationPrefsPut`, `PushTokenPut`.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-016-push-notifications
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-016-push-notifications.md` must exist after the pull, and `server/package.json` must list `firebase-admin`. If not, you did not pull: run `git fetch origin` and `git pull origin main` again. The install downloads `firebase-admin`; it must not print `ERR_PNPM_IGNORED_BUILDS`.
3. Create 5.1 to 5.3. Run `pnpm --filter @screentime/schemas build` and `pnpm --filter @screentime/schemas test` (`Tests  26 passed (26)`). Commit: `CARD-016: add notification schemas`.
4. Create or replace 5.4 to 5.13. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-016: add push sender, dispatcher and notification routes`.
5. Create or replace 5.14 to 5.17. Commit: `CARD-016: add notification tests`.
6. Replace 5.18 and 5.19. Commit: `CARD-016: add the Firebase setting to the deployment`.
7. Run `pnpm contract` (5.20) and compare. Commit: `CARD-016: regenerate the API contract`.
8. Run the acceptance checks in section 8.
9. Push and open the PR (section 10).
10. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
11. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  26 passed (26)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/admin.test.ts (8 tests | 8 skipped)`, `test/auth.test.ts (15 tests | 15 skipped)`, `test/db.test.ts (12 tests | 12 skipped)`, `test/devices.test.ts (12 tests | 12 skipped)`, `test/family.test.ts (17 tests | 17 skipped)`, `test/grants.test.ts (8 tests | 8 skipped)`, `test/kids.test.ts (10 tests | 10 skipped)`, `test/notify.test.ts (12 tests | 12 skipped)`, `test/sync.test.ts (13 tests | 13 skipped)`, `test/config.test.ts (8 tests)`, `test/tokens.test.ts (7 tests)`, `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (9 tests)`, `test/health.test.ts (2 tests)`, so `Tests  33 passed | 107 skipped (140)`.
- [ ] `contract/openapi.json` matches 5.20 exactly. Running `pnpm contract` again leaves `git status --short contract` empty. `pnpm --filter @screentime/server db:generate` prints `No schema changes, nothing to migrate`.
- [ ] The database tests pass against PostgreSQL 18. Use a local `deploy/.env` with throwaway values (this replaces any `deploy/.env` you have; it is git-ignored):
  ```powershell
  Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db createdb -U screentime screentime_test
  $env:TEST_DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime_test"
  pnpm --filter @screentime/server test
  Remove-Item Env:TEST_DATABASE_URL
  ```
  Output: `test/notify.test.ts (12 tests)`, `test/grants.test.ts (8 tests)`, `test/sync.test.ts (13 tests)` and `Tests  140 passed (140)`.
- [ ] Push tokens, settings and the history work on the real stack (the `db` container from the previous check is still running; no Firebase key, so nothing is really sent). Start the stack and sign in as the super admin:
  ```powershell
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "Firebase is not configured"
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
  Put those 6 digits in place of `123456`, then sign in as the parent's Android app:
  ```powershell
  $p = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"parent@example.com","code":"123456","client":"android","clientLabel":"Pixel 10"}'
  $ph = @{ Authorization = "Bearer $($p.accessToken)" }
  ```
  Then save a push token, mute one kind, try to mute SOS, add a kid, enrol a tablet, save its push token, add 15 minutes and read the history:
  ```powershell
  (Invoke-WebRequest -Method Put http://localhost:8080/v1/me/push-token -Headers $ph -ContentType 'application/json' -Body '{"fcmToken":"test-token-1"}' -UseBasicParsing).StatusCode
  $prefs = Invoke-RestMethod -Method Put http://localhost:8080/v1/me/notification-prefs -Headers $ph -ContentType 'application/json' -Body '[{"kind":"device.enrolled","enabled":false}]'
  ($prefs | Where-Object { -not $_.enabled }).kind
  try { Invoke-RestMethod -Method Put http://localhost:8080/v1/me/notification-prefs -Headers $ph -ContentType 'application/json' -Body '[{"kind":"sos","enabled":false}]' } catch { ($_.ErrorDetails.Message | ConvertFrom-Json).error.message }
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  $c = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/enrolment-codes" -Headers $ph -ContentType 'application/json' -Body '{"form":"tablet"}'
  $d = Invoke-RestMethod -Method Post http://localhost:8080/v1/enrol -ContentType 'application/json' -Body "{`"code`":`"$($c.code)`",`"platform`":`"android`",`"hasCellular`":false,`"model`":`"XPPen`",`"osVersion`":`"Android 14`",`"appVersion`":`"0.1.0`"}"
  $dh = @{ Authorization = "Bearer $($d.deviceToken)" }
  (Invoke-WebRequest -Method Put http://localhost:8080/v1/device/push-token -Headers $dh -ContentType 'application/json' -Body '{"fcmToken":"test-token-2"}' -UseBasicParsing).StatusCode
  (Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/grants" -Headers $ph -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`",`"pool`":`"screens`",`"minutes`":15}").minutes
  (Invoke-RestMethod "http://localhost:8080/v1/events?kidId=$($k.id)" -Headers $ph).events | ForEach-Object { "$($_.kind) $($_.kidName) $($_.deviceName)" }
  (Invoke-RestMethod "http://localhost:8080/v1/events?limit=1" -Headers $ph).nextBefore -ne $null
  ```
  The outputs are: the log line `Firebase is not configured: no push notifications are sent`, then `204`, `device.enrolled`, `SOS notifications cannot be turned off.`, `204`, `15`, `grant.added Alex ` (no device name), `device.enrolled Alex XPPen` and `True`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 20 files (in any order):
  ```
  contract/openapi.json
  deploy/.env.example
  deploy/docker-compose.yml
  packages/schemas/src/index.ts
  packages/schemas/src/notify.ts
  packages/schemas/test/notify.test.ts
  server/src/app.ts
  server/src/config.ts
  server/src/devices/routes.ts
  server/src/grants/routes.ts
  server/src/index.ts
  server/src/notify/dispatch.ts
  server/src/notify/routes.ts
  server/src/push.ts
  server/src/sync/overspend.ts
  server/src/sync/routes.ts
  server/test/config.test.ts
  server/test/helpers.ts
  server/test/notify.test.ts
  server/test/openapi.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/notify.test.ts` | The essential kinds are exactly `sos`, `parent_mode.request` and `time_request`; a prefs update takes each kind once, at least one, and only known kinds; a push token is a non-empty string or null. |
| `server/test/config.test.ts` | As before, plus: `FIREBASE_SERVICE_ACCOUNT_JSON` is read, empty means null, and a value without `project_id`, `client_email` and `private_key` (or not JSON) stops the server. |
| `server/test/notify.test.ts` | Against a real database, with a fake sender that records every push. **Push token:** saved on the caller's session and moved off an older session of the same phone, null clears it; a revoked or unknown session 401, an empty token 422, no token 401. **Prefs:** all 10 kinds on by default with the 3 essential ones marked; turning kinds off and on again only affects that parent; turning off `time_request` is 422 `Ask for more time notifications cannot be turned off.`; an unknown kind 422. **Device token:** saved and moved off another device; a bad device token 401. **History:** newest first, paged by `before` with `nextBefore` null on the last page, filtered by kid and by kind prefix (`sos` but not `sosx`), only the own family; `limit=101` and `kind=SOS` 422; no token 401. **Pushes:** Mum's grant goes to Dad (`grant.by_other_parent`, normal priority) but not to Mum or the other family; the kid's tablet gets `grant_added` (high priority, time to live up to midnight); the phone (other pool) and a revoked tablet get nothing; repeating the grant id pushes nothing. A muted kind is skipped but SOS goes through even with a stored "off" row; an event kind with no notification kind sends nothing; a dead token is cleared. Enrolling a phone notifies Mum, but not Dad, who turned `device.enrolled` off. **Overspend:** 130 minutes recorded offline against 120 writes one `overspend` event of about 600 s and notifies; sending it again writes nothing; 5 more minutes writes a second one of at least 900 s; online use never writes one. |
| `server/test/openapi.test.ts` | As before, plus: the 5 new operations use the right auth and the 6 new schemas are named; the committed file is up to date. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 7). Message format: `CARD-016: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-016-push-notifications`
5. Open a PR into `main` titled `CARD-016: Push notifications and event history`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-016-push-notifications --title "CARD-016: Push notifications and event history" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-016-push-notifications.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] openapi.json matches the card; pnpm contract is stable; db:generate finds no changes
   - [x] database tests — output: `Tests  140 passed (140)`
   - [x] push tokens, settings and history on the real stack — output: `Firebase is not configured...`, `204`, `device.enrolled`, `SOS notifications cannot be turned off.`, `204`, `15`, `grant.added Alex`, `device.enrolled Alex XPPen`, `True`
   - [x] deploy/.env not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 20 files

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

- **`Cannot find module 'firebase-admin/app'`**: you did not install after pulling. Run `pnpm install --frozen-lockfile` from the repo root. Do **not** run `pnpm add`, and do not change `pnpm-lock.yaml` or `pnpm-workspace.yaml`.
- **`ERR_PNPM_IGNORED_BUILDS`** during install: your `pnpm-workspace.yaml` is not the one on `main` (it must list `'@firebase/util': false` and `protobufjs: false` under `allowBuilds`). Pull again; do not edit it yourself.
- **`Module '"@screentime/schemas"' has no exported member 'NotificationKind'`** in the server: run `pnpm build` (the server uses the built schemas package), and check that 5.2 matches the card.
- **`openapi.test.ts` fails with a diff**: run `pnpm contract`. If the new file still differs from 5.20, one of 5.1, 5.2, 5.7 or 5.12 does not match the card. Do not edit `openapi.json` by hand.
- **A test in another file fails with `firebaseServiceAccountJson`** in the message: 5.14 (`helpers.ts`) or 5.15 is not copied exactly.
- **`notify.test.ts` times look off by hours**: the tests choose their own time zone (`middayZone()`); do not change it to your own zone, and do not change the times.
- **You are tempted to get a Firebase key to "test it for real"**: don't. This card never sends a real push; the fake sender in the tests is the check.
- **Different test data**: do not change values in the tests (names, tokens, numbers, minutes), even when another value would also pass. The card's values are what Claude checks against. If you think one is wrong, say so under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-016. Please review and merge if it is good.

CARD: CARD-016 Push notifications and event history
PR: <full PR URL>
Branch: bob/card-016-push-notifications
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
