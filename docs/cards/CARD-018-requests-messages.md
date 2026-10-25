# CARD-018: Ask for more time and kid messages

| Field | Value |
|---|---|
| Card | CARD-018 |
| Title | Ask for more time and kid messages |
| Size | M |
| Depends on | CARD-017 (merged to `main`) |
| Spec sections | docs/SPEC.md §6.1 (time_requests, kid_messages), §9.2, §9.3, §10, §13 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-018-requests-messages` |
| PR title | `CARD-018: Ask for more time and kid messages` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts`. Request and response shapes are Zod schemas in `packages/schemas`; `contract/openapi.json` is generated from them with `pnpm contract` and committed.

What exists already:

- Kid devices authenticate with `requireDevice` (`server/src/devices/auth.ts`); parents with `requireFamilyParent` (`server/src/auth/guards.ts`). Every family query runs inside `withFamily` (row-level security).
- The tables `time_requests` and `kid_messages` already exist (`server/src/db/schema.ts`, CARD-010). **No migration in this card.**
- Grants (`server/src/grants/routes.ts`, CARD-015): a grant adds or removes minutes for today and writes a `grant.added` event.
- Pushes (`server/src/notify/dispatch.ts`, CARD-016 and 017): `notifyParents(deps, familyId, eventIds)` pushes events to the parent apps (essential kinds even when muted); `sendToDevices(deps, familyId, target, msg, fcm)` sends an envelope to kid devices by WebSocket and FCM; `stateChanged` tells devices to sync.
- The device state snapshot already has `pendingRequest` (the kid's pending request for the device's pool today).

This card adds the kid's two ways to reach a parent (Q25, Q29):

1. **Ask for more time.** A kid device sends `POST /v1/device/time-requests` (15, 30 or 60 minutes, optional reason). Every parent gets an essential push. A parent answers with `POST /v1/requests/{id}/approve` (a grant for today, possibly a different amount) or `.../deny`. The first answer wins; the kid's devices get `request_resolved`. Parents list requests with `GET /v1/requests`.
2. **Messages.** A kid device sends `POST /v1/device/messages` (a preset or their own text, at most 160 characters). Parents get a push (they can mute it) and list messages with `GET /v1/messages`.

## 2. Goal

The six routes above work as SPEC §9.2 and §9.3 describe, are in the OpenAPI contract, and are tested against PostgreSQL 18: idempotent ids, one pending request per kid and pool, expiry at local midnight, only one answer even when both parents tap at once, and the right pushes to the right parents and devices.

## 3. Out of scope

Do **not** do any of these in this card:

- No device or parent app code. The clients come in later cards.
- No parent mode requests (CARD-019) and no SOS (CARD-020).
- No change to the database schema or migrations. Do not change `server/src/db/` or anything in `server/drizzle/`.
- No new npm packages and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay unchanged.
- Do not change any file that is not listed in section 5. `docs/SPEC.md` was already updated by Claude.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key, a Firebase key, an FCM token or a device token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, hono ^4.13.13, @hono/zod-openapi ^1.6.3, zod ^4.6.7, drizzle-orm ^0.45.4, firebase-admin ^14.5.0, @hono/node-ws ^1.3.1, PostgreSQL 18. Nothing new to install.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character. Some test names contain an apostrophe and so use double quotes: keep them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/requests.ts` | create (5.1) |
| `packages/schemas/src/index.ts` | replace (5.2) |
| `packages/schemas/test/requests.test.ts` | create (5.3) |
| `server/src/grants/routes.ts` | replace (5.4) |
| `server/src/requests/routes.ts` | create (5.5) |
| `server/src/messages/routes.ts` | create (5.6) |
| `server/src/app.ts` | replace (5.7) |
| `server/test/requests.test.ts` | create (5.8) |
| `server/test/messages.test.ts` | create (5.9) |
| `server/test/openapi.test.ts` | replace (5.10) |
| `contract/openapi.json` | replace (5.11) |

That is 11 files.

### 5.1 `packages/schemas/src/requests.ts`

The shapes of requests, answers and messages. `RequestResolved` is the data of the `request_resolved` message to kid devices; no route uses it, so it is not in the contract.

```typescript
import { z } from 'zod';
import { Pool } from './devices.js';
import { StateGrant } from './sync.js';

/** What happened to a time request. A pending request expires at the family's local midnight. */
export const TimeRequestStatus = z.enum(['pending', 'approved', 'denied', 'expired']).meta({ id: 'TimeRequestStatus' });
export type TimeRequestStatus = z.infer<typeof TimeRequestStatus>;

/** Body of POST /v1/device/time-requests: the kid's "Ask for more time" (Q25). The device makes the id. */
export const TimeRequestCreate = z
  .object({
    id: z.uuid(),
    minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    reason: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .meta({ id: 'TimeRequestCreate' });

export type TimeRequestCreate = z.infer<typeof TimeRequestCreate>;

/** A kid's time request, as parents and the asking device see it. */
export const TimeRequest = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    kidName: z.string(),
    deviceId: z.uuid(),
    deviceName: z.string(),
    /** The pool of the device that asked. */
    pool: Pool,
    /** What the kid asked for. */
    minutes: z.int(),
    reason: z.string().nullable(),
    status: TimeRequestStatus,
    createdAt: z.iso.datetime(),
    /** When a parent said yes or no. null while pending, and for expired requests. */
    resolvedAt: z.iso.datetime().nullable(),
    resolvedByName: z.string().nullable(),
    /** The grant made by a yes. */
    grantId: z.uuid().nullable(),
    /** Minutes the yes gave, which may differ from `minutes`. null unless approved. */
    grantedMinutes: z.int().nullable(),
  })
  .meta({ id: 'TimeRequest' });

export type TimeRequest = z.infer<typeof TimeRequest>;

/** Body of POST /v1/requests/{id}/approve. Leave `minutes` out to give what the kid asked for. */
export const TimeRequestApprove = z
  .object({
    minutes: z
      .int()
      .min(15)
      .max(1440)
      .refine((m) => m % 15 === 0, 'minutes must be a multiple of 15.')
      .optional(),
  })
  .meta({ id: 'TimeRequestApprove' });

export type TimeRequestApprove = z.infer<typeof TimeRequestApprove>;

/** Data of the `request_resolved` message to kid devices (docs/SPEC.md §10). */
export const RequestResolved = z
  .object({
    requestId: z.uuid(),
    approved: z.boolean(),
    /** Minutes given; 0 when the answer was no. */
    minutes: z.int(),
    byName: z.string(),
    /** The new grant when the answer was yes, so the device can count it before it syncs. */
    grant: StateGrant.nullable(),
  })
  .meta({ id: 'RequestResolved' });

export type RequestResolved = z.infer<typeof RequestResolved>;

/** Body of POST /v1/device/messages (Q29). The device makes the id. */
export const KidMessageCreate = z
  .object({
    id: z.uuid(),
    body: z.string().trim().min(1).max(160),
    /** The preset the kid tapped, if any. A preset that no longer exists is stored as null. */
    presetId: z.uuid().nullable().optional(),
  })
  .meta({ id: 'KidMessageCreate' });

export type KidMessageCreate = z.infer<typeof KidMessageCreate>;

export const KidMessage = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    kidName: z.string(),
    deviceId: z.uuid(),
    deviceName: z.string(),
    body: z.string(),
    presetId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'KidMessage' });

export type KidMessage = z.infer<typeof KidMessage>;

/** GET /v1/messages. */
export const MessagePage = z
  .object({
    /** Newest first. */
    messages: z.array(KidMessage),
    /** Pass as `before` to get the next, older page. null on the last page. */
    nextBefore: z.uuid().nullable(),
  })
  .meta({ id: 'MessagePage' });

export type MessagePage = z.infer<typeof MessagePage>;
```

### 5.2 `packages/schemas/src/index.ts`

The same as before, plus the exports of 5.1 at the end.

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
export {
  KidMessage,
  KidMessageCreate,
  MessagePage,
  RequestResolved,
  TimeRequest,
  TimeRequestApprove,
  TimeRequestCreate,
  TimeRequestStatus,
} from './requests.js';
```

### 5.3 `packages/schemas/test/requests.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { KidMessageCreate, TimeRequestApprove, TimeRequestCreate } from '../src/index.js';

const id = '0192f1a0-0000-7000-8000-000000000001';

describe('request and message schemas', () => {
  it('asks for 15, 30 or 60 minutes with an optional reason', () => {
    expect(TimeRequestCreate.safeParse({ id, minutes: 30 }).success).toBe(true);
    expect(TimeRequestCreate.safeParse({ id, minutes: 60, reason: 'Finishing a level' }).success).toBe(true);
    expect(TimeRequestCreate.safeParse({ id, minutes: 15, reason: null }).success).toBe(true);
    expect(TimeRequestCreate.safeParse({ id, minutes: 45 }).success).toBe(false);
    expect(TimeRequestCreate.safeParse({ id, minutes: 30, reason: '   ' }).success).toBe(false);
    expect(TimeRequestCreate.safeParse({ id, minutes: 30, reason: 'x'.repeat(161) }).success).toBe(false);
  });

  it('approves with the asked minutes or another multiple of 15', () => {
    expect(TimeRequestApprove.safeParse({}).success).toBe(true);
    expect(TimeRequestApprove.safeParse({ minutes: 45 }).success).toBe(true);
    expect(TimeRequestApprove.safeParse({ minutes: 20 }).success).toBe(false);
    expect(TimeRequestApprove.safeParse({ minutes: 0 }).success).toBe(false);
    expect(TimeRequestApprove.safeParse({ minutes: -15 }).success).toBe(false);
  });

  it('takes a message of 1 to 160 characters', () => {
    const parsed = KidMessageCreate.safeParse({ id, body: '  Can you call me?  ' });
    expect(parsed.success && parsed.data.body).toBe('Can you call me?');
    expect(KidMessageCreate.safeParse({ id, body: 'Hi', presetId: null }).success).toBe(true);
    expect(KidMessageCreate.safeParse({ id, body: '' }).success).toBe(false);
    expect(KidMessageCreate.safeParse({ id, body: 'x'.repeat(161) }).success).toBe(false);
  });
});
```

### 5.4 `server/src/grants/routes.ts`

The same routes as before. `today`, `existing` and `insertGrant` move out of `registerGrantRoutes` to the top level, so that approving a request (5.5) stores its grant the same way; `today` is renamed `familyToday`, and `familyToday`, `insertGrant` and `selectGrants` are exported. `insertGrant` also takes an optional `requestId`. New: the `GrantPushes` type and `secondsToMidnight`.

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
export async function selectGrants(tx: FamilyTx, where: SQL | undefined) {
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

/** The family's time zone and local today. */
export async function familyToday(tx: FamilyTx, familyId: string): Promise<{ timezone: string; day: FamilyDay }> {
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

/** What to push once the transaction that stored a grant has committed. */
export interface GrantPushes {
  eventId: string;
  dayEnd: Date;
  now: Date;
}

/**
 * Stores a new grant for today and records a `grant.added` event in the same transaction. `pushes` says
 * what to send once the transaction has committed; null when nothing new was stored.
 */
export async function insertGrant(
  tx: FamilyTx,
  familyId: string,
  parentId: string,
  kidId: string,
  day: FamilyDay,
  values: { id: string; pool: Pool; minutes: number; note: string | null; requestId?: string },
  lockNow: boolean,
): Promise<{ grant: Grant | null; created: boolean; pushes: GrantPushes | null }> {
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

/** Seconds until local midnight, at least a minute: a push about today's time is worth nothing after it. */
export function secondsToMidnight(dayEnd: Date, now: Date) {
  return Math.max(60, Math.floor((dayEnd.getTime() - now.getTime()) / 1000));
}

/**
 * Parent time adjustments: add, remove and lock now (docs/SPEC.md §7.3, §9.2, Q8).
 * A grant always counts for the family's local today. Devices pick it up on their next sync.
 */
export function registerGrantRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  /** After commit: tell the other parents, and the kid's devices in that pool so they show "Dad added 15 minutes". */
  async function sendPushes(
    familyId: string,
    kidId: string,
    grant: Grant,
    pushes: GrantPushes | null,
  ) {
    if (!pushes) return;
    await notifyParents(deps, familyId, [pushes.eventId]);
    const ttlSec = secondsToMidnight(pushes.dayEnd, pushes.now);
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
      const date = query.day ?? (await familyToday(tx, familyId)).day.date;
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
      const { day } = await familyToday(tx, familyId);
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
      const { timezone, day } = await familyToday(tx, familyId);
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

### 5.5 `server/src/requests/routes.ts`

`POST /v1/device/time-requests`, `GET /v1/requests`, `POST /v1/requests/{id}/approve` and `.../deny`.

```typescript
import { randomUUID } from 'node:crypto';
import { createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, isNull, lt, type SQL, sql } from 'drizzle-orm';
import {
  type Pool,
  type RequestResolved,
  TimeRequest,
  TimeRequestApprove,
  TimeRequestCreate,
  TimeRequestStatus,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, grants, kids, parents, timeRequests } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { familyToday, insertGrant, secondsToMidnight } from '../grants/routes.js';
import { notifyParents, sendToDevices, stateChanged } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import type { FamilyDay } from '../sync/day.js';

type Router = ReturnType<typeof createRouter>;

const IdParam = z.object({ id: z.uuid() });
const RequestsQuery = z.object({
  status: TimeRequestStatus.optional(),
  kidId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createRequestRoute = createRoute({
  method: 'post',
  path: '/v1/device/time-requests',
  tags: ['device'],
  summary: 'Ask for more time',
  description:
    "For this device's pool, today. One request per kid and pool can wait at a time (409 while one is pending). Sending the same `id` again returns the stored request with 200.",
  security: deviceBearer,
  request: { body: jsonBody(TimeRequestCreate) },
  responses: {
    201: jsonResponse('Sent to the parents.', TimeRequest),
    200: jsonResponse('Already stored with this id.', TimeRequest),
    ...errorResponses(401, 409, 422),
  },
});

const listRequestsRoute = createRoute({
  method: 'get',
  path: '/v1/requests',
  tags: ['requests'],
  summary: "Kids' time requests",
  description: 'Newest first. Archived kids are left out. `limit` defaults to 50.',
  security: bearer,
  request: { query: RequestsQuery },
  responses: { 200: jsonResponse('The requests.', z.array(TimeRequest)), ...errorResponses(401, 403, 422) },
});

const approveRoute = createRoute({
  method: 'post',
  path: '/v1/requests/{id}/approve',
  tags: ['requests'],
  summary: 'Say yes to a time request',
  description:
    'Adds a grant for today in the pool of the request: `minutes`, or what the kid asked for when left out. A request that was already answered or has expired gives 409.',
  security: bearer,
  request: { params: IdParam, body: jsonBody(TimeRequestApprove) },
  responses: { 200: jsonResponse('The answered request.', TimeRequest), ...errorResponses(401, 403, 404, 409, 422) },
});

const denyRoute = createRoute({
  method: 'post',
  path: '/v1/requests/{id}/deny',
  tags: ['requests'],
  summary: 'Say no to a time request',
  description: 'A request that was already answered or has expired gives 409.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('The answered request.', TimeRequest), ...errorResponses(401, 403, 404, 409, 422) },
});

const requestNotFound = () => new ApiError('not_found', 'No such request in your family.');

/** Pending requests from before local midnight have expired (docs/SPEC.md §6.1). Run before reading or answering. */
async function expireOld(tx: FamilyTx, day: FamilyDay) {
  await tx
    .update(timeRequests)
    .set({ status: 'expired' })
    .where(and(eq(timeRequests.status, 'pending'), lt(timeRequests.createdAt, day.dayStart)));
}

/** Requests with kid, device and parent names, newest first. Archived kids are left out. */
async function selectRequests(tx: FamilyTx, where: SQL | undefined, limit?: number) {
  const query = tx
    .select({
      request: timeRequests,
      kidName: kids.name,
      deviceName: devices.name,
      resolvedByName: parents.displayName,
      grantedMinutes: grants.minutes,
    })
    .from(timeRequests)
    .innerJoin(kids, eq(kids.id, timeRequests.kidId))
    .innerJoin(devices, eq(devices.id, timeRequests.deviceId))
    .leftJoin(parents, eq(parents.id, timeRequests.resolvedBy))
    .leftJoin(grants, eq(grants.id, timeRequests.grantId))
    .where(and(isNull(kids.archivedAt), where))
    .orderBy(desc(timeRequests.createdAt), desc(timeRequests.id));
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map(
    ({ request: r, kidName, deviceName, resolvedByName, grantedMinutes }): TimeRequest => ({
      id: r.id,
      kidId: r.kidId,
      kidName,
      deviceId: r.deviceId,
      deviceName,
      pool: r.pool as Pool,
      minutes: r.minutes,
      reason: r.reason,
      status: r.status as TimeRequestStatus,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedByName,
      grantId: r.grantId,
      grantedMinutes,
    }),
  );
}

async function selectRequest(tx: FamilyTx, id: string) {
  const [request] = await selectRequests(tx, eq(timeRequests.id, id));
  return request ?? null;
}

/**
 * "Ask for more time" (docs/SPEC.md §9.2, §9.3, Q25): the kid device sends a request, every parent gets an
 * essential push, and the first parent to answer decides. A yes is a grant for today in the request's pool.
 */
export function registerRequestRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  app.openapi(createRequestRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      const [stored] = await tx
        .select({ deviceId: timeRequests.deviceId })
        .from(timeRequests)
        .where(eq(timeRequests.id, body.id));
      if (stored) {
        if (stored.deviceId !== deviceId) throw new ApiError('conflict', 'That request id is already used.');
        return { request: await selectRequest(tx, body.id), eventId: null, pool: null };
      }
      const { day } = await familyToday(tx, familyId);
      await expireOld(tx, day);
      const [device] = await tx.select({ pool: devices.pool }).from(devices).where(eq(devices.id, deviceId));
      if (!device) throw new Error('device vanished after requireDevice');
      const pool = device.pool as Pool;
      const [waiting] = await tx
        .select({ id: timeRequests.id })
        .from(timeRequests)
        .where(and(eq(timeRequests.kidId, kidId), eq(timeRequests.pool, pool), eq(timeRequests.status, 'pending')));
      if (waiting) throw new ApiError('conflict', 'You already asked. Wait for an answer.');
      const reason = body.reason ?? null;
      await tx.insert(timeRequests).values({ id: body.id, familyId, kidId, deviceId, pool, minutes: body.minutes, reason });
      const [event] = await tx
        .insert(events)
        .values({
          familyId,
          kidId,
          deviceId,
          kind: 'time_request',
          at: day.now,
          payload: { requestId: body.id, pool, minutes: body.minutes, reason },
        })
        .returning({ id: events.id });
      if (!event) throw new Error('event insert returned nothing');
      return { request: await selectRequest(tx, body.id), eventId: event.id, pool };
    });
    if (!result.request) throw new Error('request vanished after insert');
    if (!result.eventId || !result.pool) return c.json(result.request, 200);
    await notifyParents(deps, familyId, [result.eventId]);
    // The kid's other devices in the pool show "Waiting for an answer" too.
    await stateChanged(deps, familyId, { kidId, pool: result.pool, exceptDeviceId: deviceId });
    return c.json(result.request, 201);
  });

  app.openapi(listRequestsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { status, kidId, limit } = c.req.valid('query');
    const rows = await withFamily(db, familyId, async (tx) => {
      await expireOld(tx, (await familyToday(tx, familyId)).day);
      return selectRequests(
        tx,
        and(status ? eq(timeRequests.status, status) : undefined, kidId ? eq(timeRequests.kidId, kidId) : undefined),
        limit,
      );
    });
    return c.json(rows, 200);
  });

  /**
   * Answers a pending request: marks it, then (for a yes) adds the grant, and records `time_request.resolved`.
   * Two parents answering at once: the update waits for the first one's row lock and then finds the request
   * answered, so the second gets 409 and no second grant is made. `approve` null means no.
   */
  async function answer(familyId: string, parentId: string, id: string, approve: TimeRequestApprove | null) {
    const approved = approve !== null;
    const result = await withFamily(db, familyId, async (tx) => {
      const { day } = await familyToday(tx, familyId);
      await expireOld(tx, day);
      const before = await selectRequest(tx, id);
      if (!before) throw requestNotFound();
      if (before.status === 'expired') throw new ApiError('conflict', 'This request has expired.');
      const minutes = approve ? (approve.minutes ?? before.minutes) : null;
      const grantId = approved ? randomUUID() : null;
      const [marked] = await tx
        .update(timeRequests)
        .set({
          status: approved ? 'approved' : 'denied',
          resolvedBy: parentId,
          resolvedAt: sql`now()`,
          grantId,
        })
        .where(and(eq(timeRequests.id, id), eq(timeRequests.status, 'pending')))
        .returning({ id: timeRequests.id });
      if (!marked) throw new ApiError('conflict', 'This request was already answered.');

      const eventIds: string[] = [];
      let grant: RequestResolved['grant'] = null;
      if (grantId && minutes !== null) {
        const added = await insertGrant(
          tx,
          familyId,
          parentId,
          before.kidId,
          day,
          { id: grantId, pool: before.pool, minutes, note: 'Asked for more time', requestId: id },
          false,
        );
        if (!added.grant || !added.pushes) throw new Error('approval grant was not stored');
        eventIds.push(added.pushes.eventId);
        grant = { id: added.grant.id, minutes, createdAt: added.grant.createdAt, byName: added.grant.byName };
      }
      const request = await selectRequest(tx, id);
      if (!request?.resolvedByName) throw new Error('request vanished after update');
      const resolved: RequestResolved = {
        requestId: id,
        approved,
        minutes: minutes ?? 0,
        byName: request.resolvedByName,
        grant,
      };
      // History only: no notification kind. Other parents hear about a yes as `grant.by_other_parent`.
      const [event] = await tx
        .insert(events)
        .values({
          familyId,
          kidId: request.kidId,
          deviceId: request.deviceId,
          kind: 'time_request.resolved',
          at: day.now,
          payload: { requestId: id, approved, minutes: resolved.minutes, byName: resolved.byName },
        })
        .returning({ id: events.id });
      if (!event) throw new Error('event insert returned nothing');
      eventIds.push(event.id);
      return { request, resolved, eventIds, ttlSec: secondsToMidnight(day.dayEnd, day.now) };
    });

    await notifyParents(deps, familyId, result.eventIds);
    // "Dad said yes: +15 min" on every device of the kid in that pool. The device then syncs.
    await sendToDevices(
      deps,
      familyId,
      { kidId: result.request.kidId, pool: result.request.pool },
      { v: 1, type: 'request_resolved', at: new Date().toISOString(), data: result.resolved },
      { high: true, ttlSec: result.ttlSec },
    );
    return result.request;
  }

  app.openapi(approveRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    return c.json(await answer(familyId, parentId, id, c.req.valid('json')), 200);
  });

  app.openapi(denyRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    return c.json(await answer(familyId, parentId, id, null), 200);
  });
}
```

### 5.6 `server/src/messages/routes.ts`

`POST /v1/device/messages` and `GET /v1/messages`.

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import { KidMessage, KidMessageCreate, MessagePage } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, kidMessages, kids, messagePresets } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { notifyParents } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const MessagesQuery = z.object({
  kidId: z.uuid().optional(),
  /** `nextBefore` of the previous page. */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const sendMessageRoute = createRoute({
  method: 'post',
  path: '/v1/device/messages',
  tags: ['device'],
  summary: 'Send a message to the parents',
  description: 'Sending the same `id` again returns the stored message with 200.',
  security: deviceBearer,
  request: { body: jsonBody(KidMessageCreate) },
  responses: {
    201: jsonResponse('Sent to the parents.', KidMessage),
    200: jsonResponse('Already stored with this id.', KidMessage),
    ...errorResponses(401, 409, 422),
  },
});

const listMessagesRoute = createRoute({
  method: 'get',
  path: '/v1/messages',
  tags: ['messages'],
  summary: 'Messages from the kids',
  description:
    'Newest first, archived kids included. `limit` defaults to 50. For the next page pass `nextBefore` as `before`.',
  security: bearer,
  request: { query: MessagesQuery },
  responses: { 200: jsonResponse('One page of messages.', MessagePage), ...errorResponses(401, 403, 422) },
});

/** Messages with kid and device names, newest first. */
async function selectMessages(tx: FamilyTx, where: SQL | undefined, limit?: number) {
  const query = tx
    .select({ message: kidMessages, kidName: kids.name, deviceName: devices.name })
    .from(kidMessages)
    .innerJoin(kids, eq(kids.id, kidMessages.kidId))
    .innerJoin(devices, eq(devices.id, kidMessages.deviceId))
    .where(where)
    .orderBy(sql`${kidMessages.createdAt} desc`, sql`${kidMessages.id} desc`);
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map(
    ({ message: m, kidName, deviceName }): KidMessage => ({
      id: m.id,
      kidId: m.kidId,
      kidName,
      deviceId: m.deviceId,
      deviceName,
      body: m.body,
      presetId: m.presetId,
      createdAt: m.createdAt.toISOString(),
    }),
  );
}

/** Kid messages to the parents (docs/SPEC.md §9.2, §9.3, Q29). */
export function registerMessageRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(sendMessageRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      const [stored] = await tx.select({ deviceId: kidMessages.deviceId }).from(kidMessages).where(eq(kidMessages.id, body.id));
      if (stored) {
        if (stored.deviceId !== deviceId) throw new ApiError('conflict', 'That message id is already used.');
        const [message] = await selectMessages(tx, eq(kidMessages.id, body.id));
        return { message, eventId: null };
      }
      // Parents may have changed the presets since the device last synced: the text is what counts.
      let presetId: string | null = null;
      if (body.presetId) {
        const [preset] = await tx
          .select({ id: messagePresets.id })
          .from(messagePresets)
          .where(eq(messagePresets.id, body.presetId));
        presetId = preset?.id ?? null;
      }
      const [row] = await tx
        .insert(kidMessages)
        .values({ id: body.id, familyId, kidId, deviceId, body: body.body, presetId })
        .returning({ createdAt: kidMessages.createdAt });
      if (!row) throw new Error('message insert returned nothing');
      const [event] = await tx
        .insert(events)
        .values({
          familyId,
          kidId,
          deviceId,
          kind: 'kid_message',
          at: row.createdAt,
          payload: { messageId: body.id, body: body.body },
        })
        .returning({ id: events.id });
      if (!event) throw new Error('event insert returned nothing');
      const [message] = await selectMessages(tx, eq(kidMessages.id, body.id));
      return { message, eventId: event.id };
    });
    if (!result.message) throw new Error('message vanished after insert');
    if (!result.eventId) return c.json(result.message, 200);
    await notifyParents(deps, familyId, [result.eventId]);
    return c.json(result.message, 201);
  });

  app.openapi(listMessagesRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const { kidId, before, limit } = c.req.valid('query');
    const rows = await withFamily(db, familyId, (tx) =>
      selectMessages(
        tx,
        and(
          kidId ? eq(kidMessages.kidId, kidId) : undefined,
          before
            ? sql`(${kidMessages.createdAt}, ${kidMessages.id}) < (select m.created_at, m.id from ${kidMessages} m where m.id = ${before})`
            : undefined,
        ),
        limit + 1,
      ),
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return c.json({ messages: page, nextBefore: rows.length > limit && last ? last.id : null }, 200);
  });
}
```

### 5.7 `server/src/app.ts`

The same as before, plus two imports and two `register...Routes` calls after `registerGrantRoutes`.

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
import { registerMessageRoutes } from './messages/routes.js';
import { registerNotifyRoutes } from './notify/routes.js';
import type { Pusher } from './push.js';
import { registerRequestRoutes } from './requests/routes.js';
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
  registerRequestRoutes(app, deps);
  registerMessageRoutes(app, deps);
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

### 5.8 `server/test/requests.test.ts`

```typescript
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import {
  devices,
  events,
  families,
  grants,
  kids,
  notificationPrefs,
  parentSessions,
  parents,
  scheduleVersions,
  timeRequests,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** A fixed-offset zone where it is about midday right now, so the test times never cross local midnight. */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

/** Every day the same, with no curfew, so the result does not depend on the weekday or the hour. */
const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

describe.skipIf(!url)('time requests', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };

  /** Records every push. */
  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  let familyA = '';
  let mumId = '';
  let dadId = '';
  let mum = '';
  let dad = '';
  let bea = '';
  let alexId = '';
  /** Alex's devices: two phones and a tablet, each with a push token. */
  const alex = { phone: { id: '', token: '' }, phone2: { id: '', token: '' }, tablet: { id: '', token: '' } };

  async function signIn(familyId: string, parentId: string, fcmToken: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'tablet' | 'phone', name: string, fcmToken: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
        fcmToken,
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  /** Clears every request (and the grants that answered them) so each test starts with none pending. */
  async function clearRequests() {
    await db.delete(grants);
    await db.delete(timeRequests);
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: middayZone(), parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    familyA = a?.id ?? '';
    const [p1, p2, p3] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: b?.id ?? '', email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mumId = p1?.id ?? '';
    dadId = p2?.id ?? '';
    mum = await signIn(familyA, mumId, 'fcm-mum');
    dad = await signIn(familyA, dadId, 'fcm-dad');
    bea = await signIn(b?.id ?? '', p3?.id ?? '', 'fcm-bea');
    alexId = await addKid(familyA, 'Alex');
    alex.phone = await addDevice(familyA, alexId, 'phone', 'Pixel 7', 'fcm-phone');
    alex.phone2 = await addDevice(familyA, alexId, 'phone', 'Old phone', 'fcm-phone2');
    alex.tablet = await addDevice(familyA, alexId, 'tablet', 'Tablet', 'fcm-tablet');
  });

  beforeEach(async () => {
    sent.length = 0;
    await clearRequests();
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Alex asks from the phone. */
  async function ask(minutes = 30, reason?: string) {
    const id = randomUUID();
    const res = await api.post('/v1/device/time-requests', alex.phone.token, { id, minutes, reason });
    expect(res.status).toBe(201);
    return id;
  }

  describe('POST /v1/device/time-requests', () => {
    it("stores the request for the device's pool and tells both parents at high priority", async () => {
      // Muting does not apply: asking for more time is essential.
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'time_request', enabled: false });
      const id = randomUUID();
      const res = await api.post('/v1/device/time-requests', alex.phone.token, { id, minutes: 30, reason: ' Homework game ' });
      await db.delete(notificationPrefs);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        kidId: alexId,
        kidName: 'Alex',
        deviceId: alex.phone.id,
        deviceName: 'Pixel 7',
        pool: 'phone',
        minutes: 30,
        reason: 'Homework game',
        status: 'pending',
        resolvedAt: null,
        resolvedByName: null,
        grantId: null,
        grantedMinutes: null,
      });

      for (const token of ['fcm-mum', 'fcm-dad']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(true);
        expect(push?.msg.type).toBe('time_request');
        expect(push?.msg.data).toMatchObject({
          kind: 'time_request',
          kidName: 'Alex',
          deviceName: 'Pixel 7',
          payload: { requestId: id, pool: 'phone', minutes: 30, reason: 'Homework game' },
        });
      }
      expect(sentTo('fcm-bea')).toHaveLength(0);
      // The other phone shows "Waiting for an answer" after it syncs; the tablet is another pool.
      expect(sentTo('fcm-phone2').map((m) => [m.msg.type, m.high])).toEqual([['state_changed', false]]);
      expect(sentTo('fcm-phone')).toHaveLength(0);
      expect(sentTo('fcm-tablet')).toHaveLength(0);

      const state = await api.get('/v1/device/state', alex.phone2.token);
      expect(state.body.pendingRequest).toMatchObject({ id, minutes: 30 });
      const tabletState = await api.get('/v1/device/state', alex.tablet.token);
      expect(tabletState.body.pendingRequest).toBeNull();
    });

    it('answers the same id again with 200 and changes nothing', async () => {
      const id = await ask(15);
      sent.length = 0;
      const again = await api.post('/v1/device/time-requests', alex.phone.token, { id, minutes: 60 });
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ id, minutes: 15, status: 'pending' });
      expect(sent).toHaveLength(0);
      const other = await api.post('/v1/device/time-requests', alex.phone2.token, { id, minutes: 15 });
      expect(other.status).toBe(409);
      expect(other.body.error.message).toBe('That request id is already used.');
    });

    it('lets one request per kid and pool wait at a time', async () => {
      await ask(15);
      const second = await api.post('/v1/device/time-requests', alex.phone2.token, { id: randomUUID(), minutes: 30 });
      expect(second.status).toBe(409);
      expect(second.body.error.message).toBe('You already asked. Wait for an answer.');
      // Screens is another pool.
      const tablet = await api.post('/v1/device/time-requests', alex.tablet.token, { id: randomUUID(), minutes: 60 });
      expect(tablet.status).toBe(201);
      expect(tablet.body.pool).toBe('screens');
    });

    it('refuses bad bodies and unknown devices', async () => {
      expect((await api.post('/v1/device/time-requests', alex.phone.token, { id: randomUUID(), minutes: 45 })).status).toBe(422);
      expect(
        (await api.post('/v1/device/time-requests', alex.phone.token, { id: randomUUID(), minutes: 15, reason: 'x'.repeat(161) }))
          .status,
      ).toBe(422);
      expect((await api.post('/v1/device/time-requests', 'not-a-token', { id: randomUUID(), minutes: 15 })).status).toBe(401);
      expect((await api.post('/v1/device/time-requests', mum, { id: randomUUID(), minutes: 15 })).status).toBe(401);
    });
  });

  describe('GET /v1/requests', () => {
    it('lists the family requests newest first, by status and kid', async () => {
      const first = await ask(15);
      const res = await api.post('/v1/device/time-requests', alex.tablet.token, { id: randomUUID(), minutes: 60 });
      const second = res.body.id as string;
      const all = await api.get('/v1/requests', mum);
      expect(all.status).toBe(200);
      expect(all.body.map((r: { id: string }) => r.id)).toEqual([second, first]);
      expect((await api.get('/v1/requests?status=pending&limit=1', dad)).body.map((r: { id: string }) => r.id)).toEqual([second]);
      expect((await api.get('/v1/requests?status=approved', dad)).body).toEqual([]);
      expect((await api.get(`/v1/requests?kidId=${randomUUID()}`, dad)).body).toEqual([]);
      expect((await api.get('/v1/requests', bea)).body).toEqual([]);
      expect((await api.get('/v1/requests?status=waiting', mum)).status).toBe(422);
      expect((await api.get('/v1/requests', null)).status).toBe(401);
    });

    it('shows requests from before local midnight as expired, and they can no longer be answered', async () => {
      const id = randomUUID();
      await db.insert(timeRequests).values({
        id,
        familyId: familyA,
        kidId: alexId,
        deviceId: alex.phone.id,
        pool: 'phone',
        minutes: 30,
        createdAt: new Date(Date.now() - 26 * 3600_000),
      });
      const [listed] = (await api.get('/v1/requests', mum)).body;
      expect(listed).toMatchObject({ id, status: 'expired', resolvedAt: null });
      const late = await api.post(`/v1/requests/${id}/approve`, mum, {});
      expect(late.status).toBe(409);
      expect(late.body.error.message).toBe('This request has expired.');
      // The kid may ask again today.
      await ask(30);
    });
  });

  describe('POST /v1/requests/{id}/approve', () => {
    it('adds a grant for what was asked and tells the kid and the other parent', async () => {
      const id = await ask(30, 'Finishing a level');
      sent.length = 0;
      const res = await api.post(`/v1/requests/${id}/approve`, mum, {});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'approved', resolvedByName: 'Mum', grantedMinutes: 30 });
      expect(res.body.resolvedAt).not.toBeNull();

      const [grant] = await db.select().from(grants).where(eq(grants.requestId, id));
      expect(grant).toMatchObject({ id: res.body.grantId, kidId: alexId, pool: 'phone', minutes: 30, createdBy: mumId });
      expect(grant?.note).toBe('Asked for more time');

      for (const token of ['fcm-phone', 'fcm-phone2']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(true);
        expect(push?.msg.type).toBe('request_resolved');
        expect(push?.msg.data).toEqual({
          requestId: id,
          approved: true,
          minutes: 30,
          byName: 'Mum',
          grant: { id: res.body.grantId, minutes: 30, createdAt: grant?.createdAt.toISOString(), byName: 'Mum' },
        });
      }
      expect(sentTo('fcm-tablet')).toHaveLength(0);
      // Dad hears that Mum changed the time; Mum does not hear about her own answer.
      expect(sentTo('fcm-dad').map((m) => m.msg.type)).toEqual(['grant.by_other_parent']);
      expect(sentTo('fcm-mum')).toHaveLength(0);

      const history = await api.get('/v1/events?kind=time_request&limit=2', dad);
      expect(history.body.events.map((e: { kind: string }) => e.kind)).toEqual(['time_request.resolved', 'time_request']);
      expect(history.body.events[0].payload).toEqual({ requestId: id, approved: true, minutes: 30, byName: 'Mum' });

      const state = await api.get('/v1/device/state', alex.phone.token);
      expect(state.body.pendingRequest).toBeNull();
      expect(state.body.today.grants).toEqual([{ id: res.body.grantId, minutes: 30, createdAt: grant?.createdAt.toISOString(), byName: 'Mum' }]);
    });

    it('gives other minutes when the parent says so', async () => {
      const id = await ask(15);
      const res = await api.post(`/v1/requests/${id}/approve`, dad, { minutes: 45 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ minutes: 15, grantedMinutes: 45, resolvedByName: 'Dad' });
      expect((await api.post(`/v1/requests/${id}/approve`, dad, { minutes: 20 })).status).toBe(422);
    });

    it('answers only once, even when both parents tap yes at the same moment', async () => {
      const id = await ask(30);
      const [a, b] = await Promise.all([
        api.post(`/v1/requests/${id}/approve`, mum, {}),
        api.post(`/v1/requests/${id}/approve`, dad, {}),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect([a, b].find((r) => r.status === 409)?.body.error.message).toBe('This request was already answered.');
      expect(await db.select().from(grants).where(eq(grants.requestId, id))).toHaveLength(1);
      expect((await api.post(`/v1/requests/${id}/deny`, mum)).status).toBe(409);
    });

    it('answers 404 for a request of another family or an archived kid', async () => {
      const id = await ask(30);
      expect((await api.post(`/v1/requests/${id}/approve`, bea, {})).status).toBe(404);
      expect((await api.post(`/v1/requests/${randomUUID()}/approve`, mum, {})).status).toBe(404);

      const samId = await addKid(familyA, 'Sam');
      const samPhone = await addDevice(familyA, samId, 'phone', 'Sam phone', 'fcm-sam');
      const samAsk = randomUUID();
      expect((await api.post('/v1/device/time-requests', samPhone.token, { id: samAsk, minutes: 15 })).status).toBe(201);
      expect((await api.del(`/v1/kids/${samId}`, mum)).status).toBe(204);
      expect((await api.post(`/v1/requests/${samAsk}/approve`, mum, {})).status).toBe(404);
      expect((await api.get('/v1/requests', mum)).body.map((r: { id: string }) => r.id)).toEqual([id]);
    });
  });

  describe('POST /v1/requests/{id}/deny', () => {
    it('says no without a grant and tells the kid', async () => {
      const id = await ask(60);
      sent.length = 0;
      const res = await api.post(`/v1/requests/${id}/deny`, dad);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'denied', resolvedByName: 'Dad', grantId: null, grantedMinutes: null });
      expect(await db.select().from(grants).where(eq(grants.requestId, id))).toHaveLength(0);
      const [push] = sentTo('fcm-phone');
      expect(push?.high).toBe(true);
      expect(push?.msg).toMatchObject({
        type: 'request_resolved',
        data: { requestId: id, approved: false, minutes: 0, byName: 'Dad', grant: null },
      });
      // A no is history only for the parents.
      expect(sentTo('fcm-mum')).toHaveLength(0);
      const resolved = await db.select().from(events).where(eq(events.kind, 'time_request.resolved'));
      const event = resolved.find((e) => (e.payload as { requestId?: string }).requestId === id);
      expect(event?.payload).toEqual({ requestId: id, approved: false, minutes: 0, byName: 'Dad' });
      expect((await api.post(`/v1/requests/${id}/approve`, mum, {})).status).toBe(409);
    });
  });
});
```

### 5.9 `server/test/messages.test.ts`

```typescript
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import {
  devices,
  families,
  kidMessages,
  kids,
  messagePresets,
  notificationPrefs,
  parentSessions,
  parents,
  scheduleVersions,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

describe.skipIf(!url)('kid messages', () => {
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
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  let familyA = '';
  let dadId = '';
  let mum = '';
  let bea = '';
  let alexId = '';
  let samId = '';
  let presetId = '';
  const alexPhone = { id: '', token: '' };
  const samTablet = { id: '', token: '' };

  async function signIn(familyId: string, parentId: string, fcmToken: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  async function addKid(name: string) {
    const [kid] = await db.insert(kids).values({ familyId: familyA, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId: familyA, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(kidId: string, form: 'tablet' | 'phone', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId: familyA,
        kidId,
        platform: 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  /** The kid device sends a message; returns its id. */
  async function send(device: { token: string }, body: string) {
    const id = randomUUID();
    const res = await api.post('/v1/device/messages', device.token, { id, body });
    expect(res.status).toBe(201);
    return id;
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
    const [p1, p2, p3] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: b?.id ?? '', email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    dadId = p2?.id ?? '';
    mum = await signIn(familyA, p1?.id ?? '', 'fcm-mum');
    await signIn(familyA, dadId, 'fcm-dad');
    bea = await signIn(b?.id ?? '', p3?.id ?? '', 'fcm-bea');
    const [preset] = await db
      .insert(messagePresets)
      .values({ familyId: familyA, text: 'Can you call me?', sort: 0 })
      .returning();
    presetId = preset?.id ?? '';
    alexId = await addKid('Alex');
    samId = await addKid('Sam');
    Object.assign(alexPhone, await addDevice(alexId, 'phone', 'Pixel 7'));
    Object.assign(samTablet, await addDevice(samId, 'tablet', 'Tablet'));
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(kidMessages);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /v1/device/messages', () => {
    it('stores the message and pushes it to parents who have not muted messages', async () => {
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'kid_message', enabled: false });
      const id = randomUUID();
      const res = await api.post('/v1/device/messages', alexPhone.token, { id, body: ' Can you call me? ', presetId });
      await db.delete(notificationPrefs);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        kidId: alexId,
        kidName: 'Alex',
        deviceId: alexPhone.id,
        deviceName: 'Pixel 7',
        body: 'Can you call me?',
        presetId,
      });
      const [push] = sentTo('fcm-mum');
      expect(push?.high).toBe(false);
      expect(push?.msg).toMatchObject({
        type: 'kid_message',
        data: { kind: 'kid_message', kidName: 'Alex', payload: { messageId: id, body: 'Can you call me?' } },
      });
      expect(sentTo('fcm-dad')).toHaveLength(0);
      expect(sentTo('fcm-bea')).toHaveLength(0);
    });

    it('keeps the text and drops a preset that no longer exists', async () => {
      const res = await api.post('/v1/device/messages', alexPhone.token, {
        id: randomUUID(),
        body: 'I need help with homework',
        presetId: randomUUID(),
      });
      expect(res.status).toBe(201);
      expect(res.body.presetId).toBeNull();
    });

    it('answers the same id again with 200 and sends nothing', async () => {
      const id = await send(alexPhone, 'On my way home');
      sent.length = 0;
      const again = await api.post('/v1/device/messages', alexPhone.token, { id, body: 'Something else' });
      expect(again.status).toBe(200);
      expect(again.body.body).toBe('On my way home');
      expect(sent).toHaveLength(0);
      const other = await api.post('/v1/device/messages', samTablet.token, { id, body: 'Hi' });
      expect(other.status).toBe(409);
      expect(other.body.error.message).toBe('That message id is already used.');
    });

    it('refuses bad bodies and unknown devices', async () => {
      expect((await api.post('/v1/device/messages', alexPhone.token, { id: randomUUID(), body: '  ' })).status).toBe(422);
      expect((await api.post('/v1/device/messages', alexPhone.token, { id: randomUUID(), body: 'x'.repeat(161) })).status).toBe(422);
      expect((await api.post('/v1/device/messages', 'not-a-token', { id: randomUUID(), body: 'Hi' })).status).toBe(401);
    });
  });

  describe('GET /v1/messages', () => {
    it('lists newest first, by kid, in pages, for the own family only', async () => {
      const first = await send(alexPhone, 'One');
      const second = await send(samTablet, 'Two');
      const third = await send(alexPhone, 'Three');

      const all = await api.get('/v1/messages', mum);
      expect(all.status).toBe(200);
      expect(all.body.messages.map((m: { id: string }) => m.id)).toEqual([third, second, first]);
      expect(all.body.nextBefore).toBeNull();

      const page1 = await api.get('/v1/messages?limit=2', mum);
      expect(page1.body.messages.map((m: { id: string }) => m.id)).toEqual([third, second]);
      expect(page1.body.nextBefore).toBe(second);
      const page2 = await api.get(`/v1/messages?limit=2&before=${page1.body.nextBefore}`, mum);
      expect(page2.body.messages.map((m: { id: string }) => m.id)).toEqual([first]);
      expect(page2.body.nextBefore).toBeNull();

      const alexOnly = await api.get(`/v1/messages?kidId=${alexId}`, mum);
      expect(alexOnly.body.messages.map((m: { body: string }) => m.body)).toEqual(['Three', 'One']);
      expect((await api.get('/v1/messages', bea)).body).toEqual({ messages: [], nextBefore: null });
      expect((await api.get('/v1/messages?limit=0', mum)).status).toBe(422);
      expect((await api.get('/v1/messages', null)).status).toBe(401);
    });

    it('keeps the messages of an archived kid', async () => {
      const id = await send(samTablet, 'Bye');
      expect((await api.del(`/v1/kids/${samId}`, mum)).status).toBe(204);
      const res = await api.get(`/v1/messages?kidId=${samId}`, mum);
      expect(res.body.messages.map((m: { id: string }) => m.id)).toEqual([id]);
      const [row] = await db.select().from(kidMessages).where(eq(kidMessages.id, id));
      expect(row?.body).toBe('Bye');
    });
  });
});
```

### 5.10 `server/test/openapi.test.ts`

The same as before, plus one test before the last one: the new routes and their auth.

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

  it('describes time requests and kid messages, each with the right auth', () => {
    expect(doc.paths?.['/v1/device/time-requests']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/device/messages']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/requests']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/requests/{id}/approve']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/requests/{id}/deny']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/messages']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'KidMessage',
        'KidMessageCreate',
        'MessagePage',
        'TimeRequest',
        'TimeRequestApprove',
        'TimeRequestCreate',
        'TimeRequestStatus',
      ]),
    );
  });

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.11 `contract/openapi.json`

The generated contract. Copy it exactly. After you have copied every file, `pnpm contract` must write the same file again (section 8 checks it).

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
      "TimeRequest": {
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
          "kidName": {
            "type": "string"
          },
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "deviceName": {
            "type": "string"
          },
          "pool": {
            "$ref": "#/components/schemas/Pool"
          },
          "minutes": {
            "type": "integer"
          },
          "reason": {
            "type": [
              "string",
              "null"
            ]
          },
          "status": {
            "$ref": "#/components/schemas/TimeRequestStatus"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "resolvedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "resolvedByName": {
            "type": [
              "string",
              "null"
            ]
          },
          "grantId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "grantedMinutes": {
            "type": [
              "integer",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "pool",
          "minutes",
          "reason",
          "status",
          "createdAt",
          "resolvedAt",
          "resolvedByName",
          "grantId",
          "grantedMinutes"
        ]
      },
      "TimeRequestStatus": {
        "type": "string",
        "enum": [
          "pending",
          "approved",
          "denied",
          "expired"
        ]
      },
      "TimeRequestCreate": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "minutes": {
            "anyOf": [
              {
                "type": "number",
                "enum": [
                  15
                ]
              },
              {
                "type": "number",
                "enum": [
                  30
                ]
              },
              {
                "type": "number",
                "enum": [
                  60
                ]
              }
            ]
          },
          "reason": {
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
          "minutes"
        ]
      },
      "TimeRequestApprove": {
        "type": "object",
        "properties": {
          "minutes": {
            "type": "integer",
            "minimum": 15,
            "maximum": 1440
          }
        }
      },
      "KidMessage": {
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
          "kidName": {
            "type": "string"
          },
          "deviceId": {
            "type": "string",
            "format": "uuid"
          },
          "deviceName": {
            "type": "string"
          },
          "body": {
            "type": "string"
          },
          "presetId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "body",
          "presetId",
          "createdAt"
        ]
      },
      "KidMessageCreate": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "body": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "presetId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          }
        },
        "required": [
          "id",
          "body"
        ]
      },
      "MessagePage": {
        "type": "object",
        "properties": {
          "messages": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/KidMessage"
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
          "messages",
          "nextBefore"
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
    "/v1/device/time-requests": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Ask for more time",
        "description": "For this device's pool, today. One request per kid and pool can wait at a time (409 while one is pending). Sending the same `id` again returns the stored request with 200.",
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
                "$ref": "#/components/schemas/TimeRequestCreate"
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
                  "$ref": "#/components/schemas/TimeRequest"
                }
              }
            }
          },
          "201": {
            "description": "Sent to the parents.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/TimeRequest"
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
          }
        }
      }
    },
    "/v1/requests": {
      "get": {
        "tags": [
          "requests"
        ],
        "summary": "Kids' time requests",
        "description": "Newest first. Archived kids are left out. `limit` defaults to 50.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "$ref": "#/components/schemas/TimeRequestStatus"
            },
            "required": false,
            "name": "status",
            "in": "query"
          },
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
            "description": "The requests.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/TimeRequest"
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
    "/v1/requests/{id}/approve": {
      "post": {
        "tags": [
          "requests"
        ],
        "summary": "Say yes to a time request",
        "description": "Adds a grant for today in the pool of the request: `minutes`, or what the kid asked for when left out. A request that was already answered or has expired gives 409.",
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
                "$ref": "#/components/schemas/TimeRequestApprove"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The answered request.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/TimeRequest"
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
    "/v1/requests/{id}/deny": {
      "post": {
        "tags": [
          "requests"
        ],
        "summary": "Say no to a time request",
        "description": "A request that was already answered or has expired gives 409.",
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
          "200": {
            "description": "The answered request.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/TimeRequest"
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
    "/v1/device/messages": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Send a message to the parents",
        "description": "Sending the same `id` again returns the stored message with 200.",
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
                "$ref": "#/components/schemas/KidMessageCreate"
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
                  "$ref": "#/components/schemas/KidMessage"
                }
              }
            }
          },
          "201": {
            "description": "Sent to the parents.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/KidMessage"
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
          }
        }
      }
    },
    "/v1/messages": {
      "get": {
        "tags": [
          "messages"
        ],
        "summary": "Messages from the kids",
        "description": "Newest first, archived kids included. `limit` defaults to 50. For the next page pass `nextBefore` as `before`.",
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
            "description": "One page of messages.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MessagePage"
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

### 6.1 `POST /v1/device/time-requests` (device)

Body `{ id, minutes, reason? }`: `id` a UUID made by the device, `minutes` 15, 30 or 60, `reason` 1 to 160 characters after trimming (or null, or left out).

1. The same `id` from the same device again: **200** with the stored request, nothing else happens. The `id` of another device's request: **409** `That request id is already used.`
2. Pending requests from before local midnight become `expired` (any kid of the family).
3. The request is for the device's pool. If the kid already has a pending request for that pool (from any device): **409** `You already asked. Wait for an answer.`
4. Stores the request and an event `time_request` (with `deviceId`) with payload `{ requestId, pool, minutes, reason }`.
5. After commit: `notifyParents` (the kind is essential, so every parent app gets it at high priority, even a parent who muted it), then `stateChanged` for `{ kidId, pool, exceptDeviceId: the asking device }`, FCM normal priority.
6. **201** with the request.

### 6.2 `GET /v1/requests` (parent)

Query `status` (`pending`, `approved`, `denied`, `expired`), `kidId`, `limit` (1 to 100, default 50). Marks old pending requests expired first. Newest first; requests of archived kids are left out. Each item: `{ id, kidId, kidName, deviceId, deviceName, pool, minutes, reason, status, createdAt, resolvedAt, resolvedByName, grantId, grantedMinutes }`. `grantedMinutes` comes from the grant, so it is null unless approved.

### 6.3 `POST /v1/requests/{id}/approve` and `/deny` (parent)

Approve body `{ minutes? }`: a multiple of 15 from 15 to 1440; left out means what the kid asked for. Deny has no body.

1. Marks old pending requests expired. Unknown id, another family's request or an archived kid's: **404** `No such request in your family.` Expired: **409** `This request has expired.`
2. `UPDATE ... WHERE id = $1 AND status = 'pending'` sets `status` (`approved` or `denied`), `resolved_by`, `resolved_at` and (approve) a new random `grant_id`. No row updated: **409** `This request was already answered.` When both parents tap at the same moment, the second transaction waits for the first one's row lock, then updates nothing, so only one grant is made.
3. Approve only: `insertGrant` stores the grant for today in the request's pool, `note` `Asked for more time`, `requestId` set. It writes the usual `grant.added` event, so the other parent gets `grant.by_other_parent` and the answering parent does not.
4. Writes an event `time_request.resolved` with payload `{ requestId, approved, minutes, byName }` (`minutes` 0 for a no). It has no notification kind: history only.
5. After commit: `notifyParents` for the new events, then `sendToDevices` for `{ kidId, pool }` with `request_resolved` `{ requestId, approved, minutes, byName, grant }` (`grant` is `{ id, minutes, createdAt, byName }` or null), FCM **high**, time to live until local midnight.
6. **200** with the answered request.

### 6.4 `POST /v1/device/messages` (device)

Body `{ id, body, presetId? }`, `body` 1 to 160 characters after trimming. The same `id` from the same device: **200** with the stored message, nothing else. Another device's id: **409** `That message id is already used.` A `presetId` that is not one of the family's presets is stored as null; the body keeps the text. Stores the message and an event `kid_message` (with `deviceId`) with payload `{ messageId, body }`. After commit: `notifyParents` (not essential: a parent who muted `kid_message` gets nothing). **201** with `{ id, kidId, kidName, deviceId, deviceName, body, presetId, createdAt }`.

### 6.5 `GET /v1/messages` (parent)

Query `kidId`, `before`, `limit` (1 to 100, default 50). `{ messages, nextBefore }`, newest first, archived kids included, paged like `/v1/events`: `nextBefore` is the id of the last message when there are more, otherwise null.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-018-requests-messages
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-018-requests-messages.md` must exist after the pull. If not, you did not pull: run `git fetch origin` and `git pull origin main` again.
3. Create 5.1 and 5.3, replace 5.2. Run `pnpm --filter @screentime/schemas build` and `pnpm --filter @screentime/schemas test`. Commit: `CARD-018: add request and message schemas`.
4. Replace 5.4 and 5.7, create 5.5 and 5.6. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-018: add time request and message routes`.
5. Create 5.8 and 5.9, replace 5.10 and 5.11. Run `pnpm contract`, then `git status --short contract` must print nothing. Commit: `CARD-018: add tests and the contract`.
6. Run the acceptance checks in section 8.
7. Push and open the PR (section 10).
8. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
9. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  29 passed (29)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/requests.test.ts (11 tests | 11 skipped)`, `test/messages.test.ts (6 tests | 6 skipped)`, `test/live.test.ts (8 tests | 5 skipped)`, `test/admin.test.ts (8 tests | 8 skipped)`, `test/auth.test.ts (15 tests | 15 skipped)`, `test/db.test.ts (12 tests | 12 skipped)`, `test/devices.test.ts (12 tests | 12 skipped)`, `test/family.test.ts (17 tests | 17 skipped)`, `test/grants.test.ts (8 tests | 8 skipped)`, `test/kids.test.ts (10 tests | 10 skipped)`, `test/notify.test.ts (12 tests | 12 skipped)`, `test/sync.test.ts (13 tests | 13 skipped)`, `test/config.test.ts (8 tests)`, `test/tokens.test.ts (7 tests)`, `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (10 tests)`, `test/health.test.ts (2 tests)`, so `Tests  37 passed | 129 skipped (166)`.
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
  Both runs: `test/requests.test.ts (11 tests)`, `test/messages.test.ts (6 tests)` and `Tests  166 passed (166)`.
- [ ] Requests and messages work on the real stack (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
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
  Then add a kid, enrol a phone, ask for 30 minutes, list the pending requests, say yes with 45 minutes, try to answer again, read the phone's state, send a message and list the messages:
  ```powershell
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  $c = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/enrolment-codes" -Headers $ph -ContentType 'application/json' -Body '{"form":"phone"}'
  $d = Invoke-RestMethod -Method Post http://localhost:8080/v1/enrol -ContentType 'application/json' -Body "{`"code`":`"$($c.code)`",`"platform`":`"android`",`"hasCellular`":true,`"model`":`"Pixel 7`",`"osVersion`":`"Android 14`",`"appVersion`":`"0.1.0`"}"
  $dh = @{ Authorization = "Bearer $($d.deviceToken)" }
  $q = Invoke-RestMethod -Method Post http://localhost:8080/v1/device/time-requests -Headers $dh -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`",`"minutes`":30,`"reason`":`"Finishing a level`"}"
  "$($q.status) $($q.pool) $($q.minutes)"
  $pending = @(Invoke-RestMethod "http://localhost:8080/v1/requests?status=pending" -Headers $ph)
  "$($pending.Count) $($pending[0].kidName): $($pending[0].reason)"
  $a = Invoke-RestMethod -Method Post "http://localhost:8080/v1/requests/$($q.id)/approve" -Headers $ph -ContentType 'application/json' -Body '{"minutes":45}'
  "$($a.status) $($a.grantedMinutes) $($a.resolvedByName)"
  try { Invoke-RestMethod -Method Post "http://localhost:8080/v1/requests/$($q.id)/deny" -Headers $ph | Out-Null; 'answered twice' } catch { [int]$_.Exception.Response.StatusCode }
  $s = Invoke-RestMethod http://localhost:8080/v1/device/state -Headers $dh
  "$($s.today.grants[0].minutes) $($s.today.grants[0].byName) $($null -eq $s.pendingRequest)"
  Invoke-RestMethod -Method Post http://localhost:8080/v1/device/messages -Headers $dh -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`",`"body`":`"On my way home`"}" | Out-Null
  $msgs = Invoke-RestMethod http://localhost:8080/v1/messages -Headers $ph
  "$($msgs.messages[0].kidName): $($msgs.messages[0].body)"
  ```
  The outputs are `pending phone 30`, `1 Alex: Finishing a level`, `approved 45 Dad`, `409`, `45 Dad True` and `Alex: On my way home`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 11 files (in any order):
  ```
  contract/openapi.json
  packages/schemas/src/index.ts
  packages/schemas/src/requests.ts
  packages/schemas/test/requests.test.ts
  server/src/app.ts
  server/src/grants/routes.ts
  server/src/messages/routes.ts
  server/src/requests/routes.ts
  server/test/messages.test.ts
  server/test/openapi.test.ts
  server/test/requests.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/requests.test.ts` | A request takes 15, 30 or 60 minutes and a trimmed reason of 1 to 160 characters; an approval takes no minutes or a positive multiple of 15; a message body is trimmed and 1 to 160 characters. |
| `server/test/requests.test.ts` | Asking stores the request for the device's pool, pushes `time_request` at high priority to both parents (even one who muted it) and not to another family, sends `state_changed` to the kid's other phone only, and shows in the other phone's `pendingRequest` but not the tablet's. The same id again is 200 with nothing sent; another device's id 409. One pending request per kid and pool (409), but Screens is separate. Bad minutes, a long reason, a bad token and a parent token are refused. The list is newest first and filters by status, kid and limit, and another family sees nothing. A request from yesterday shows as expired, cannot be approved, and the kid may ask again. Approving makes a grant (note, request id, pool), sends `request_resolved` with the grant to both phones at high priority but not the tablet, tells Dad `grant.by_other_parent` and Mum nothing, writes `time_request.resolved`, and the phone's state shows the grant and no pending request. Approving with 45 minutes works; 20 is refused. Two parents approving at once: one 200, one 409, one grant. Another family, an unknown id and an archived kid's request: 404; archived kids are left out of the list. Denying makes no grant, sends `request_resolved` with `approved: false`, pushes nothing to parents, and a later approve is 409. |
| `server/test/messages.test.ts` | A message is stored trimmed with its preset, pushed at normal priority to Mum but not to Dad (muted) or another family; an unknown preset is stored as null; the same id again is 200 with nothing sent, another device's id 409; an empty or too long body and a bad token are refused. The list is newest first, filters by kid, pages with `before`/`nextBefore`, shows nothing to another family, refuses `limit=0` and needs sign-in; an archived kid's messages stay. |
| `server/test/openapi.test.ts` | Adds: the six new routes are in the contract with device or parent auth, and the new schemas are listed. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 5). Message format: `CARD-018: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-018-requests-messages`
5. Open a PR into `main` titled `CARD-018: Ask for more time and kid messages`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-018-requests-messages --title "CARD-018: Ask for more time and kid messages" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-018-requests-messages.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract matches; db:generate finds no changes
   - [x] database tests, twice — output: `Tests  166 passed (166)` both times
   - [x] requests and messages on the real stack — output: `pending phone 30`, `1 Alex: Finishing a level`, `approved 45 Dad`, `409`, `45 Dad True`, `Alex: On my way home`
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

- **`Module '"@screentime/schemas"' has no exported member 'TimeRequest'`** (or another new name): build the schemas package first (`pnpm --filter @screentime/schemas build`), or 5.2 is not copied exactly.
- **`'today' is not defined`** or **`insertGrant` is not exported**: 5.4 (`grants/routes.ts`) is not copied exactly. Replace the whole file.
- **`pnpm contract` changes `contract/openapi.json`**: one of the files in section 5 is not the card's version. Find it with `git diff`; do not commit a contract that differs from 5.11.
- **The openapi drift test fails** (`matches the committed contract/openapi.json`): the same cause as above.
- **The "both parents tap yes" test fails or hangs**: check Docker is running and `TEST_DATABASE_URL` is set; run the tests again once. If it fails twice, report it with its first error lines. Do not change the test.
- **`409` instead of `201` on the real stack when asking for time**: you ran the ask twice. Run `docker compose ... down -v` and start the real-stack check again from the top.
- **Different test data**: do not change values in the tests (names, tokens, numbers, minutes, messages), even when another value would also pass. If you think one is wrong, say so under "Deviations".
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
Claude, here is Bob's handback for CARD-018. Please review and merge if it is good.

CARD: CARD-018 Ask for more time and kid messages
PR: <full PR URL>
Branch: bob/card-018-requests-messages
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
