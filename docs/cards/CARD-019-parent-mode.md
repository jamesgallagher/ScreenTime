# CARD-019: Parent mode

| Field | Value |
|---|---|
| Card | CARD-019 |
| Title | Parent mode |
| Size | M |
| Depends on | CARD-018 (merged to `main`) |
| Spec sections | docs/SPEC.md §6.1 (parent_mode_sessions), §9.2, §9.3, §10, §12.3, §13 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-019-parent-mode` |
| PR title | `CARD-019: Parent mode` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts`. Request and response shapes are Zod schemas in `packages/schemas`; `contract/openapi.json` is generated from them with `pnpm contract` and committed.

What exists already:

- Kid devices authenticate with `requireDevice` (`server/src/devices/auth.ts`); parents with `requireFamilyParent` (`server/src/auth/guards.ts`). Every family query runs inside `withFamily` (row-level security).
- The table `parent_mode_sessions` already exists (`server/src/db/schema.ts`, CARD-010): `method` (`push`, `code`, `remote`), `requested_at`, `approved_by`, `duration_min` (2, 5, 15, 60 or null), `started_at`, `ends_at`, `ended_at`, `ended_by`. **No migration in this card.**
- The device state snapshot (`parentMode`) and `/v1/today` (each device's `parentMode`) already show a session that has started, has not ended and whose `ends_at` is null or in the future (`activeParentModes` in `server/src/sync/day.ts`).
- Pushes (`server/src/notify/dispatch.ts`): `notifyParents` (`parent_mode.request` is essential, `parent_mode.used` can be muted) and `sendToDevices` (WebSocket plus FCM to kid devices).

Parent mode unlocks one kid device and stops it counting, for 2, 5 or 15 minutes, an hour, or until a parent ends it (SPEC §12.3, Q15). This card adds its server side, in three ways to start it:

1. **Push:** the kid taps "I'm the parent", the device sends `POST /v1/device/parent-mode-requests`, every parent gets an essential push, and one approves with a duration (`POST /v1/parent-mode-requests/{id}/approve`) or denies. A request waits 10 minutes.
2. **Parent code:** offline, the parent types the 6-digit code on the device; the device starts parent mode itself and reports it with `POST /v1/device/parent-mode`.
3. **Remote:** a parent starts or ends it from the app (`POST` / `DELETE /v1/devices/{id}/parent-mode`), for example on a locked Windows PC.

The kid device can end it with `POST /v1/device/parent-mode/end`. Every start writes `parent_mode.used`, which every parent is told about.

## 2. Goal

The seven routes work as SPEC §9.2, §9.3 and §12.3 describe, are in the OpenAPI contract, and are tested against PostgreSQL 18: idempotent ids, the 10-minute wait, only the newest request approvable, only one answer when both parents tap at once, one active session per device, and the right pushes to the right parents and device.

## 3. Out of scope

Do **not** do any of these in this card:

- No device or parent app code. The parent code itself (TOTP) is checked on the device, not on the server.
- No `POST /v1/device/events` (tamper events are CARD-019b).
- No change to the database schema or migrations. Do not change `server/src/db/` or anything in `server/drizzle/`.
- No new npm packages and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay unchanged.
- Do not change any file that is not listed in section 5. `docs/SPEC.md` and `docs/BUILD-PLAN.md` were already updated by Claude.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key, a Firebase key, an FCM token or a device token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, hono ^4.13.13, @hono/zod-openapi ^1.6.3, zod ^4.6.7, drizzle-orm ^0.45.4, firebase-admin ^14.5.0, @hono/node-ws ^1.3.1, PostgreSQL 18. Nothing new to install. The routes use `alias` from `drizzle-orm/pg-core` to join `parents` twice (who approved, who ended); it is part of drizzle-orm.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character. Some strings contain an apostrophe: one route summary escapes it as `\'` inside single quotes, and some test names contain double quotes inside single quotes. Keep them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/parentmode.ts` | create (5.1) |
| `packages/schemas/src/index.ts` | replace (5.2) |
| `packages/schemas/test/parentmode.test.ts` | create (5.3) |
| `server/src/parentmode/routes.ts` | create (5.4) |
| `server/src/app.ts` | replace (5.5) |
| `server/test/parentmode.test.ts` | create (5.6) |
| `server/test/openapi.test.ts` | replace (5.7) |
| `contract/openapi.json` | replace (5.8) |

That is 8 files.

### 5.1 `packages/schemas/src/parentmode.ts`

The shapes of sessions, requests and starts. `ParentModeMessage` is the data of the `parent_mode` message to kid devices; no route uses it, so it is not in the contract.

```typescript
import { z } from 'zod';

/** How long parent mode lasts: 2, 5 or 15 minutes, an hour, or null for "Until I end it" (Q15). */
export const ParentModeDuration = z
  .union([z.literal(2), z.literal(5), z.literal(15), z.literal(60)])
  .nullable()
  .meta({ id: 'ParentModeDuration' });

export type ParentModeDuration = z.infer<typeof ParentModeDuration>;

/**
 * Where a parent-mode session stands. A push request waits 10 minutes for a parent (`pending`), then
 * `expired`; a newer request from the same device also expires it. `denied` when a parent said no.
 */
export const ParentModeStatus = z
  .enum(['pending', 'active', 'ended', 'denied', 'expired'])
  .meta({ id: 'ParentModeStatus' });

export type ParentModeStatus = z.infer<typeof ParentModeStatus>;

/** One parent-mode session (docs/SPEC.md §6.1 parent_mode_sessions, §12.3). */
export const ParentModeSession = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    kidName: z.string(),
    deviceId: z.uuid(),
    deviceName: z.string(),
    /** `push`: the kid asked and a parent approved. `code`: started on the device with the parent code. `remote`: started from the parent app. */
    method: z.enum(['push', 'code', 'remote']),
    status: ParentModeStatus,
    requestedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    /** null while pending, and for "Until I end it". */
    endsAt: z.iso.datetime().nullable(),
    endedAt: z.iso.datetime().nullable(),
    durationMin: ParentModeDuration,
    /** The parent who approved or started it; null for the parent code. */
    approvedByName: z.string().nullable(),
    /** The parent who ended or denied it; null when the device ended it or the time ran out. */
    endedByName: z.string().nullable(),
  })
  .meta({ id: 'ParentModeSession' });

export type ParentModeSession = z.infer<typeof ParentModeSession>;

/** Body of POST /v1/device/parent-mode-requests ("I'm the parent"). The device makes the id. */
export const ParentModeRequestCreate = z.object({ id: z.uuid() }).meta({ id: 'ParentModeRequestCreate' });

export type ParentModeRequestCreate = z.infer<typeof ParentModeRequestCreate>;

/** Body of POST /v1/parent-mode-requests/{id}/approve and POST /v1/devices/{id}/parent-mode. */
export const ParentModeStart = z.object({ durationMin: ParentModeDuration }).meta({ id: 'ParentModeStart' });

export type ParentModeStart = z.infer<typeof ParentModeStart>;

/** Body of POST /v1/device/parent-mode: parent mode the device started after a correct parent code. */
export const ParentModeByCode = z
  .object({
    id: z.uuid(),
    durationMin: ParentModeDuration,
    /** When it started on the device. It may be in the past if the device was offline. */
    startedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'ParentModeByCode' });

export type ParentModeByCode = z.infer<typeof ParentModeByCode>;

/** Data of the `parent_mode` message to a kid device (docs/SPEC.md §10). */
export const ParentModeMessage = z
  .object({
    active: z.boolean(),
    endsAt: z.iso.datetime().nullable(),
    /** The parent who started, ended or denied it. */
    byName: z.string().nullable(),
    /** Set when this answers the device's request, so the "Hand to a parent" screen can close. */
    requestId: z.uuid().nullable(),
  })
  .meta({ id: 'ParentModeMessage' });

export type ParentModeMessage = z.infer<typeof ParentModeMessage>;
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
export {
  ParentModeByCode,
  ParentModeDuration,
  ParentModeMessage,
  ParentModeRequestCreate,
  ParentModeSession,
  ParentModeStart,
  ParentModeStatus,
} from './parentmode.js';
```

### 5.3 `packages/schemas/test/parentmode.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { ParentModeByCode, ParentModeStart } from '../src/index.js';

const id = '0192f1a0-0000-7000-8000-000000000001';

describe('parent mode schemas', () => {
  it('takes 2, 5, 15 or 60 minutes, or null for "Until I end it"', () => {
    for (const durationMin of [2, 5, 15, 60, null]) expect(ParentModeStart.safeParse({ durationMin }).success).toBe(true);
    for (const durationMin of [0, 1, 10, 30, 120, '5']) expect(ParentModeStart.safeParse({ durationMin }).success).toBe(false);
    expect(ParentModeStart.safeParse({}).success).toBe(false);
  });

  it('takes a code start with an id, a duration and a start time with an offset', () => {
    expect(ParentModeByCode.safeParse({ id, durationMin: 15, startedAt: '2026-10-25T14:00:00+11:00' }).success).toBe(true);
    expect(ParentModeByCode.safeParse({ id, durationMin: null, startedAt: '2026-10-25T03:00:00Z' }).success).toBe(true);
    expect(ParentModeByCode.safeParse({ id, durationMin: 15 }).success).toBe(false);
    expect(ParentModeByCode.safeParse({ id: 'x', durationMin: 15, startedAt: '2026-10-25T03:00:00Z' }).success).toBe(false);
  });
});
```

### 5.4 `server/src/parentmode/routes.ts`

All seven routes. A session's status is worked out in SQL from its times (`statusSql`), so it always uses the database clock.

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { and, eq, gt, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  ParentModeByCode,
  type ParentModeDuration,
  type ParentModeMessage,
  ParentModeRequestCreate,
  ParentModeSession,
  ParentModeStart,
  type ParentModeStatus,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, kids, parentModeSessions, parents } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { notifyParents, sendToDevices } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const IdParam = z.object({ id: z.uuid() });

/** A push request waits this long for a parent (docs/SPEC.md §12.3). The kid is standing next to them. */
const REQUEST_WAIT = sql`interval '10 minutes'`;

const requestRoute = createRoute({
  method: 'post',
  path: '/v1/device/parent-mode-requests',
  tags: ['device'],
  summary: '"I\'m the parent": ask the parents to approve parent mode',
  description:
    'Waits 10 minutes for an answer. A newer request from the same device replaces an older one. Parent mode already on → 409. Sending the same `id` again returns the stored request with 200.',
  security: deviceBearer,
  request: { body: jsonBody(ParentModeRequestCreate) },
  responses: {
    201: jsonResponse('Sent to the parents.', ParentModeSession),
    200: jsonResponse('Already stored with this id.', ParentModeSession),
    ...errorResponses(401, 409, 422),
  },
});

const byCodeRoute = createRoute({
  method: 'post',
  path: '/v1/device/parent-mode',
  tags: ['device'],
  summary: 'Report parent mode started with the parent code',
  description:
    'The device checked the code and started parent mode itself, maybe while offline. A `startedAt` in the future counts as now. Ends any other parent mode on this device. Sending the same `id` again returns the stored session with 200.',
  security: deviceBearer,
  request: { body: jsonBody(ParentModeByCode) },
  responses: {
    201: jsonResponse('Stored.', ParentModeSession),
    200: jsonResponse('Already stored with this id.', ParentModeSession),
    ...errorResponses(401, 409, 422),
  },
});

const deviceEndRoute = createRoute({
  method: 'post',
  path: '/v1/device/parent-mode/end',
  tags: ['device'],
  summary: 'End parent mode on this device ("End now")',
  description: 'Nothing to end is fine too.',
  security: deviceBearer,
  responses: { 204: { description: 'Ended.' }, ...errorResponses(401) },
});

const approveRoute = createRoute({
  method: 'post',
  path: '/v1/parent-mode-requests/{id}/approve',
  tags: ['parent mode'],
  summary: 'Approve a parent-mode request',
  description: 'Starts parent mode on the device that asked. Already answered or expired → 409.',
  security: bearer,
  request: { params: IdParam, body: jsonBody(ParentModeStart) },
  responses: { 200: jsonResponse('Parent mode is on.', ParentModeSession), ...errorResponses(401, 403, 404, 409, 422) },
});

const denyRoute = createRoute({
  method: 'post',
  path: '/v1/parent-mode-requests/{id}/deny',
  tags: ['parent mode'],
  summary: 'Deny a parent-mode request',
  description: 'Already answered or expired → 409.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('Denied.', ParentModeSession), ...errorResponses(401, 403, 404, 409, 422) },
});

const remoteStartRoute = createRoute({
  method: 'post',
  path: '/v1/devices/{id}/parent-mode',
  tags: ['parent mode'],
  summary: 'Start parent mode on a device from the parent app',
  description: 'Ends any other parent mode on the device first.',
  security: bearer,
  request: { params: IdParam, body: jsonBody(ParentModeStart) },
  responses: { 201: jsonResponse('Parent mode is on.', ParentModeSession), ...errorResponses(401, 403, 404, 422) },
});

const remoteEndRoute = createRoute({
  method: 'delete',
  path: '/v1/devices/{id}/parent-mode',
  tags: ['parent mode'],
  summary: 'End parent mode on a device from the parent app',
  description: 'Nothing to end is fine too.',
  security: bearer,
  request: { params: IdParam },
  responses: { 204: { description: 'Ended.' }, ...errorResponses(401, 403, 404, 422) },
});

const sessionNotFound = () => new ApiError('not_found', 'No such parent-mode request in your family.');
const deviceNotFound = () => new ApiError('not_found', 'No such device in your family.');

const approver = alias(parents, 'approver');
const ender = alias(parents, 'ender');

/** The status of a session, worked out from its times with the database clock. */
const statusSql = sql<ParentModeStatus>`case
  when ${parentModeSessions.startedAt} is null and ${parentModeSessions.endedAt} is null
    and ${parentModeSessions.requestedAt} > now() - ${REQUEST_WAIT} then 'pending'
  when ${parentModeSessions.startedAt} is null and ${parentModeSessions.endedBy} is not null then 'denied'
  when ${parentModeSessions.startedAt} is null then 'expired'
  when ${parentModeSessions.endedAt} is null
    and (${parentModeSessions.endsAt} is null or ${parentModeSessions.endsAt} > now()) then 'active'
  else 'ended' end`;

/** Sessions with kid, device and parent names. */
async function selectSessions(tx: FamilyTx, where: SQL | undefined) {
  const rows = await tx
    .select({
      session: parentModeSessions,
      status: statusSql,
      kidName: kids.name,
      deviceName: devices.name,
      approvedByName: approver.displayName,
      endedByName: ender.displayName,
    })
    .from(parentModeSessions)
    .innerJoin(kids, eq(kids.id, parentModeSessions.kidId))
    .innerJoin(devices, eq(devices.id, parentModeSessions.deviceId))
    .leftJoin(approver, eq(approver.id, parentModeSessions.approvedBy))
    .leftJoin(ender, eq(ender.id, parentModeSessions.endedBy))
    .where(where);
  return rows.map(
    ({ session: s, status, kidName, deviceName, approvedByName, endedByName }): ParentModeSession => ({
      id: s.id,
      kidId: s.kidId,
      kidName,
      deviceId: s.deviceId,
      deviceName,
      method: s.method as ParentModeSession['method'],
      status,
      requestedAt: s.requestedAt.toISOString(),
      startedAt: s.startedAt?.toISOString() ?? null,
      endsAt: s.endsAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      durationMin: s.durationMin as ParentModeDuration,
      approvedByName,
      endedByName,
    }),
  );
}

async function selectSession(tx: FamilyTx, id: string) {
  const [session] = await selectSessions(tx, eq(parentModeSessions.id, id));
  if (!session) throw new Error('parent-mode session vanished');
  return session;
}

/** Sessions on the device that are on right now. */
function activeOn(deviceId: string) {
  return and(
    eq(parentModeSessions.deviceId, deviceId),
    isNotNull(parentModeSessions.startedAt),
    isNull(parentModeSessions.endedAt),
    or(isNull(parentModeSessions.endsAt), gt(parentModeSessions.endsAt, sql`now()`)),
  );
}

/** Ends whatever parent mode is on the device. `parentId` null means the device or a newer session ended it. */
async function endActive(tx: FamilyTx, deviceId: string, parentId: string | null) {
  return tx
    .update(parentModeSessions)
    .set({ endedAt: sql`now()`, endedBy: parentId })
    .where(activeOn(deviceId))
    .returning({ id: parentModeSessions.id });
}

/** `now() + duration`, or null for "Until I end it". */
function endsAfter(start: SQL, durationMin: ParentModeDuration) {
  return durationMin === null ? null : sql`${start} + make_interval(mins => ${durationMin})`;
}

/** The `parent_mode.used` event every parent hears about (docs/SPEC.md §12.3 step 7). */
async function usedEvent(tx: FamilyTx, familyId: string, session: ParentModeSession) {
  const [event] = await tx
    .insert(events)
    .values({
      familyId,
      kidId: session.kidId,
      deviceId: session.deviceId,
      kind: 'parent_mode.used',
      at: new Date(session.startedAt ?? session.requestedAt),
      payload: {
        sessionId: session.id,
        method: session.method,
        durationMin: session.durationMin,
        endsAt: session.endsAt,
        byName: session.approvedByName,
      },
    })
    .returning({ id: events.id });
  if (!event) throw new Error('event insert returned nothing');
  return event.id;
}

/** A history-only event: `parent_mode.denied` or `parent_mode.ended`. */
async function historyEvent(
  tx: FamilyTx,
  familyId: string,
  kind: 'parent_mode.denied' | 'parent_mode.ended',
  session: { id: string; kidId: string; deviceId: string },
  byName: string | null,
) {
  await tx.insert(events).values({
    familyId,
    kidId: session.kidId,
    deviceId: session.deviceId,
    kind,
    at: sql`now()`,
    payload: { sessionId: session.id, byName },
  });
}

/**
 * Parent mode (docs/SPEC.md §9.2, §9.3, §12.3, Q15): the kid device asks and a parent approves by push,
 * the device starts it with the offline parent code, or a parent starts it from the app. While a session
 * is active the device is unlocked and counts nothing; the state snapshot and `/v1/today` show it.
 */
export function registerParentModeRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  /** Tells the device at once (WebSocket, and FCM high priority on Android). */
  async function tellDevice(familyId: string, deviceId: string, data: ParentModeMessage) {
    const ttlSec =
      data.active && data.endsAt
        ? Math.max(60, Math.floor((Date.parse(data.endsAt) - Date.now()) / 1000))
        : data.active
          ? 24 * 3600
          : 3600;
    await sendToDevices(
      deps,
      familyId,
      { deviceId },
      { v: 1, type: 'parent_mode', at: new Date().toISOString(), data },
      { high: true, ttlSec },
    );
  }

  /** A parent's device in the family, not revoked, of a kid that is not archived. */
  async function findDevice(tx: FamilyTx, id: string) {
    const [device] = await tx
      .select({ id: devices.id, kidId: devices.kidId })
      .from(devices)
      .innerJoin(kids, eq(kids.id, devices.kidId))
      .where(and(eq(devices.id, id), isNull(devices.revokedAt), isNull(kids.archivedAt)));
    if (!device) throw deviceNotFound();
    return device;
  }

  /** Same id sent again by the same device: the stored session. Another device's id: 409. */
  async function storedForDevice(tx: FamilyTx, id: string, deviceId: string) {
    const [stored] = await tx
      .select({ deviceId: parentModeSessions.deviceId })
      .from(parentModeSessions)
      .where(eq(parentModeSessions.id, id));
    if (!stored) return null;
    if (stored.deviceId !== deviceId) throw new ApiError('conflict', 'That parent-mode id is already used.');
    return selectSession(tx, id);
  }

  app.openapi(requestRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const { id } = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      const stored = await storedForDevice(tx, id, deviceId);
      if (stored) return { session: stored, eventId: null };
      const [active] = await tx.select({ id: parentModeSessions.id }).from(parentModeSessions).where(activeOn(deviceId));
      if (active) throw new ApiError('conflict', 'Parent mode is already on.');
      // Only the newest request can be approved: older ones from this device expire.
      await tx
        .update(parentModeSessions)
        .set({ endedAt: sql`now()` })
        .where(
          and(
            eq(parentModeSessions.deviceId, deviceId),
            isNull(parentModeSessions.startedAt),
            isNull(parentModeSessions.endedAt),
          ),
        );
      await tx.insert(parentModeSessions).values({ id, familyId, kidId, deviceId, method: 'push' });
      const [event] = await tx
        .insert(events)
        .values({ familyId, kidId, deviceId, kind: 'parent_mode.request', at: sql`now()`, payload: { requestId: id } })
        .returning({ id: events.id });
      if (!event) throw new Error('event insert returned nothing');
      return { session: await selectSession(tx, id), eventId: event.id };
    });
    if (!result.eventId) return c.json(result.session, 200);
    await notifyParents(deps, familyId, [result.eventId]);
    return c.json(result.session, 201);
  });

  app.openapi(byCodeRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      const stored = await storedForDevice(tx, body.id, deviceId);
      if (stored) return { session: stored, eventId: null };
      await endActive(tx, deviceId, null);
      const start = sql`least(${body.startedAt}::timestamptz, now())`;
      await tx.insert(parentModeSessions).values({
        id: body.id,
        familyId,
        kidId,
        deviceId,
        method: 'code',
        requestedAt: start,
        durationMin: body.durationMin,
        startedAt: start,
        endsAt: endsAfter(start, body.durationMin),
      });
      const session = await selectSession(tx, body.id);
      return { session, eventId: await usedEvent(tx, familyId, session) };
    });
    if (!result.eventId) return c.json(result.session, 200);
    await notifyParents(deps, familyId, [result.eventId]);
    return c.json(result.session, 201);
  });

  app.openapi(deviceEndRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    await withFamily(db, familyId, async (tx) => {
      for (const ended of await endActive(tx, deviceId, null)) {
        await historyEvent(tx, familyId, 'parent_mode.ended', { id: ended.id, kidId, deviceId }, null);
      }
    });
    return c.body(null, 204);
  });

  /**
   * Answers a pending request. The update only matches a request that is still pending, so when both
   * parents answer at once the second waits for the first one's row lock, matches nothing and gets 409.
   */
  async function answer(familyId: string, parentId: string, id: string, start: ParentModeStart | null) {
    const result = await withFamily(db, familyId, async (tx) => {
      const [before] = await selectSessions(
        tx,
        and(eq(parentModeSessions.id, id), eq(parentModeSessions.method, 'push'), isNull(kids.archivedAt), isNull(devices.revokedAt)),
      );
      if (!before) throw sessionNotFound();
      if (before.status === 'expired') throw new ApiError('conflict', 'This request has expired.');
      if (start) await endActive(tx, before.deviceId, null);
      const [marked] = await tx
        .update(parentModeSessions)
        .set(
          start
            ? {
                approvedBy: parentId,
                durationMin: start.durationMin,
                startedAt: sql`now()`,
                endsAt: endsAfter(sql`now()`, start.durationMin),
              }
            : { endedAt: sql`now()`, endedBy: parentId },
        )
        .where(
          and(
            eq(parentModeSessions.id, id),
            isNull(parentModeSessions.startedAt),
            isNull(parentModeSessions.endedAt),
            gt(parentModeSessions.requestedAt, sql`now() - ${REQUEST_WAIT}`),
          ),
        )
        .returning({ id: parentModeSessions.id });
      if (!marked) throw new ApiError('conflict', 'This request was already answered.');
      const session = await selectSession(tx, id);
      if (start) return { session, eventId: await usedEvent(tx, familyId, session) };
      await historyEvent(tx, familyId, 'parent_mode.denied', session, session.endedByName);
      return { session, eventId: null };
    });
    const { session } = result;
    if (result.eventId) await notifyParents(deps, familyId, [result.eventId]);
    await tellDevice(familyId, session.deviceId, {
      active: start !== null,
      endsAt: session.endsAt,
      byName: start ? session.approvedByName : session.endedByName,
      requestId: id,
    });
    return session;
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

  app.openapi(remoteStartRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id: deviceId } = c.req.valid('param');
    const { durationMin } = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      const device = await findDevice(tx, deviceId);
      await endActive(tx, deviceId, null);
      const [row] = await tx
        .insert(parentModeSessions)
        .values({
          familyId,
          kidId: device.kidId,
          deviceId,
          method: 'remote',
          approvedBy: parentId,
          durationMin,
          startedAt: sql`now()`,
          endsAt: endsAfter(sql`now()`, durationMin),
        })
        .returning({ id: parentModeSessions.id });
      if (!row) throw new Error('parent-mode insert returned nothing');
      const session = await selectSession(tx, row.id);
      return { session, eventId: await usedEvent(tx, familyId, session) };
    });
    await notifyParents(deps, familyId, [result.eventId]);
    await tellDevice(familyId, deviceId, {
      active: true,
      endsAt: result.session.endsAt,
      byName: result.session.approvedByName,
      requestId: null,
    });
    return c.json(result.session, 201);
  });

  app.openapi(remoteEndRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id: deviceId } = c.req.valid('param');
    const ended = await withFamily(db, familyId, async (tx) => {
      const device = await findDevice(tx, deviceId);
      const rows = await endActive(tx, deviceId, parentId);
      const [me] = await tx.select({ name: parents.displayName }).from(parents).where(eq(parents.id, parentId));
      const byName = me?.name ?? null;
      for (const row of rows) {
        await historyEvent(tx, familyId, 'parent_mode.ended', { id: row.id, kidId: device.kidId, deviceId }, byName);
      }
      return { count: rows.length, byName };
    });
    if (ended.count > 0) {
      await tellDevice(familyId, deviceId, { active: false, endsAt: null, byName: ended.byName, requestId: null });
    }
    return c.body(null, 204);
  });
}
```

### 5.5 `server/src/app.ts`

The same as before, plus one import and `registerParentModeRoutes(app, deps)` after `registerMessageRoutes`.

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
import { registerParentModeRoutes } from './parentmode/routes.js';
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
  registerParentModeRoutes(app, deps);
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

### 5.6 `server/test/parentmode.test.ts`

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
  kids,
  notificationPrefs,
  parentModeSessions,
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

/** Minutes between now and an ISO time. */
const minutesFromNow = (iso: string) => (Date.parse(iso) - Date.now()) / 60_000;

describe.skipIf(!url)('parent mode', () => {
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
  let familyB = '';
  let dadId = '';
  let mum = '';
  let dad = '';
  let bea = '';
  let alexId = '';
  const phone = { id: '', token: '' };
  const tablet = { id: '', token: '' };
  const otherKid = { id: '', token: '' };

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

  /** The phone taps "I'm the parent". */
  async function ask() {
    const id = randomUUID();
    const res = await api.post('/v1/device/parent-mode-requests', phone.token, { id });
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
    familyB = b?.id ?? '';
    const [p1, p2, p3] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: familyB, email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    dadId = p2?.id ?? '';
    mum = await signIn(familyA, p1?.id ?? '', 'fcm-mum');
    dad = await signIn(familyA, dadId, 'fcm-dad');
    bea = await signIn(familyB, p3?.id ?? '', 'fcm-bea');
    alexId = await addKid(familyA, 'Alex');
    Object.assign(phone, await addDevice(familyA, alexId, 'phone', 'Pixel 7', 'fcm-phone'));
    Object.assign(tablet, await addDevice(familyA, alexId, 'tablet', 'Tablet', 'fcm-tablet'));
    const samId = await addKid(familyB, 'Sam');
    Object.assign(otherKid, await addDevice(familyB, samId, 'phone', 'Sam phone', 'fcm-sam'));
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(parentModeSessions);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /v1/device/parent-mode-requests', () => {
    it('stores a pending request and tells every parent at high priority, even one who muted it', async () => {
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'parent_mode.request', enabled: false });
      const id = randomUUID();
      const res = await api.post('/v1/device/parent-mode-requests', phone.token, { id });
      await db.delete(notificationPrefs);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        kidId: alexId,
        kidName: 'Alex',
        deviceId: phone.id,
        deviceName: 'Pixel 7',
        method: 'push',
        status: 'pending',
        startedAt: null,
        endsAt: null,
        endedAt: null,
        durationMin: null,
        approvedByName: null,
        endedByName: null,
      });
      for (const token of ['fcm-mum', 'fcm-dad']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(true);
        expect(push?.msg).toMatchObject({
          type: 'parent_mode.request',
          data: { kind: 'parent_mode.request', kidName: 'Alex', deviceName: 'Pixel 7', payload: { requestId: id } },
        });
      }
      expect(sentTo('fcm-bea')).toHaveLength(0);
      expect(sentTo('fcm-phone')).toHaveLength(0);
    });

    it('answers the same id again with 200, and refuses an id of another device', async () => {
      const id = await ask();
      sent.length = 0;
      const again = await api.post('/v1/device/parent-mode-requests', phone.token, { id });
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('pending');
      expect(sent).toHaveLength(0);
      const other = await api.post('/v1/device/parent-mode-requests', tablet.token, { id });
      expect(other.status).toBe(409);
      expect(other.body.error.message).toBe('That parent-mode id is already used.');
    });

    it('lets only the newest request of a device be approved', async () => {
      const older = await ask();
      const newer = await ask();
      const late = await api.post(`/v1/parent-mode-requests/${older}/approve`, mum, { durationMin: 5 });
      expect(late.status).toBe(409);
      expect(late.body.error.message).toBe('This request has expired.');
      expect((await api.post(`/v1/parent-mode-requests/${newer}/approve`, mum, { durationMin: 5 })).status).toBe(200);
    });

    it('refuses a request while parent mode is on, and bad bodies', async () => {
      const id = await ask();
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 15 })).status).toBe(200);
      const res = await api.post('/v1/device/parent-mode-requests', phone.token, { id: randomUUID() });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('Parent mode is already on.');
      expect((await api.post('/v1/device/parent-mode-requests', phone.token, { id: 'nope' })).status).toBe(422);
      expect((await api.post('/v1/device/parent-mode-requests', 'not-a-token', { id: randomUUID() })).status).toBe(401);
    });
  });

  describe('POST /v1/parent-mode-requests/{id}/approve and /deny', () => {
    it('starts parent mode on the device that asked and tells it and the parents', async () => {
      const id = await ask();
      sent.length = 0;
      const res = await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 15 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'active', durationMin: 15, approvedByName: 'Mum', endedAt: null });
      expect(minutesFromNow(res.body.endsAt)).toBeGreaterThan(14.9);
      expect(minutesFromNow(res.body.endsAt)).toBeLessThan(15.1);

      const [toPhone] = sentTo('fcm-phone');
      expect(toPhone?.high).toBe(true);
      expect(toPhone?.msg.type).toBe('parent_mode');
      expect(toPhone?.msg.data).toEqual({ active: true, endsAt: res.body.endsAt, byName: 'Mum', requestId: id });
      expect(sentTo('fcm-tablet')).toHaveLength(0);
      for (const token of ['fcm-mum', 'fcm-dad']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(false);
        expect(push?.msg).toMatchObject({
          type: 'parent_mode.used',
          data: { payload: { sessionId: id, method: 'push', durationMin: 15, endsAt: res.body.endsAt, byName: 'Mum' } },
        });
      }

      const state = await api.get('/v1/device/state', phone.token);
      expect(state.body.parentMode).toEqual({ active: true, endsAt: res.body.endsAt, byName: 'Mum' });
      expect((await api.get('/v1/device/state', tablet.token)).body.parentMode.active).toBe(false);
      const today = await api.get('/v1/today', dad);
      const phonePool = today.body.kids[0].pools.find((p: { pool: string }) => p.pool === 'phone');
      expect(phonePool.devices[0].parentMode).toEqual({ endsAt: res.body.endsAt, byName: 'Mum' });
    });

    it('starts "Until I end it" with no end time', async () => {
      const id = await ask();
      const res = await api.post(`/v1/parent-mode-requests/${id}/approve`, dad, { durationMin: null });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'active', durationMin: null, endsAt: null, approvedByName: 'Dad' });
      expect((await api.get('/v1/device/state', phone.token)).body.parentMode).toEqual({ active: true, endsAt: null, byName: 'Dad' });
    });

    it('answers only once, even when both parents tap at the same moment', async () => {
      const id = await ask();
      const [a, b] = await Promise.all([
        api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 5 }),
        api.post(`/v1/parent-mode-requests/${id}/deny`, dad),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect([a, b].find((r) => r.status === 409)?.body.error.message).toBe('This request was already answered.');
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 5 })).status).toBe(409);
    });

    it('denies, tells the device, and only writes history for the parents', async () => {
      const id = await ask();
      sent.length = 0;
      const res = await api.post(`/v1/parent-mode-requests/${id}/deny`, dad);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'denied', startedAt: null, endedByName: 'Dad' });
      const [toPhone] = sentTo('fcm-phone');
      expect(toPhone?.msg).toMatchObject({
        type: 'parent_mode',
        data: { active: false, endsAt: null, byName: 'Dad', requestId: id },
      });
      expect(sentTo('fcm-mum')).toHaveLength(0);
      const history = await api.get('/v1/events?kind=parent_mode&limit=2', mum);
      expect(history.body.events.map((e: { kind: string }) => e.kind)).toEqual(['parent_mode.denied', 'parent_mode.request']);
      expect(history.body.events[0].payload).toEqual({ sessionId: id, byName: 'Dad' });
    });

    it('lets a request expire after 10 minutes', async () => {
      const id = await ask();
      await db
        .update(parentModeSessions)
        .set({ requestedAt: new Date(Date.now() - 11 * 60_000) })
        .where(eq(parentModeSessions.id, id));
      const res = await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 5 });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('This request has expired.');
      expect((await api.post(`/v1/parent-mode-requests/${id}/deny`, mum)).status).toBe(409);
    });

    it('answers 404 for another family, an unknown id and a revoked device, and 422 for a bad duration', async () => {
      const id = await ask();
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, bea, { durationMin: 5 })).status).toBe(404);
      expect((await api.post(`/v1/parent-mode-requests/${randomUUID()}/deny`, mum)).status).toBe(404);
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 10 })).status).toBe(422);
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, {})).status).toBe(422);

      const spare = await addDevice(familyA, alexId, 'tablet', 'Spare tablet', 'fcm-spare');
      const spareAsk = randomUUID();
      expect((await api.post('/v1/device/parent-mode-requests', spare.token, { id: spareAsk })).status).toBe(201);
      expect((await api.del(`/v1/devices/${spare.id}`, mum)).status).toBe(204);
      expect((await api.post(`/v1/parent-mode-requests/${spareAsk}/approve`, mum, { durationMin: 5 })).status).toBe(404);
    });
  });

  describe('POST /v1/device/parent-mode (parent code)', () => {
    it('stores parent mode the device started, from when it started, and tells the parents', async () => {
      const id = randomUUID();
      const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
      const res = await api.post('/v1/device/parent-mode', tablet.token, { id, durationMin: 15, startedAt });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        deviceId: tablet.id,
        method: 'code',
        status: 'active',
        startedAt,
        durationMin: 15,
        approvedByName: null,
      });
      expect(res.body.endsAt).toBe(new Date(Date.parse(startedAt) + 15 * 60_000).toISOString());
      const [push] = sentTo('fcm-dad');
      expect(push?.msg).toMatchObject({ type: 'parent_mode.used', data: { payload: { sessionId: id, method: 'code', byName: null } } });
      expect(sentTo('fcm-tablet')).toHaveLength(0);
      expect((await api.get('/v1/device/state', tablet.token)).body.parentMode).toEqual({
        active: true,
        endsAt: res.body.endsAt,
        byName: null,
      });

      sent.length = 0;
      const again = await api.post('/v1/device/parent-mode', tablet.token, { id, durationMin: 60, startedAt });
      expect(again.status).toBe(200);
      expect(again.body.durationMin).toBe(15);
      expect(sent).toHaveLength(0);
      expect((await api.post('/v1/device/parent-mode', phone.token, { id, durationMin: 5, startedAt })).status).toBe(409);
    });

    it('counts a start time in the future as now, and one long over as ended', async () => {
      const future = await api.post('/v1/device/parent-mode', tablet.token, {
        id: randomUUID(),
        durationMin: 5,
        startedAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(future.status).toBe(201);
      expect(minutesFromNow(future.body.endsAt)).toBeLessThan(5.1);

      const old = await api.post('/v1/device/parent-mode', tablet.token, {
        id: randomUUID(),
        durationMin: 60,
        startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      });
      expect(old.status).toBe(201);
      expect(old.body.status).toBe('ended');
      // A new session ends the one that was on.
      const [first] = await db.select().from(parentModeSessions).where(eq(parentModeSessions.id, future.body.id));
      expect(first?.endedAt).not.toBeNull();
      expect((await api.get('/v1/device/state', tablet.token)).body.parentMode.active).toBe(false);
    });

    it('refuses bad bodies', async () => {
      const startedAt = new Date().toISOString();
      expect((await api.post('/v1/device/parent-mode', tablet.token, { id: randomUUID(), durationMin: 30, startedAt })).status).toBe(422);
      expect((await api.post('/v1/device/parent-mode', tablet.token, { id: randomUUID(), startedAt })).status).toBe(422);
      expect((await api.post('/v1/device/parent-mode', tablet.token, { id: randomUUID(), durationMin: 5, startedAt: 'now' })).status).toBe(422);
    });
  });

  describe('ending parent mode', () => {
    it('ends it from the device, and nothing to end is fine', async () => {
      const id = await ask();
      await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: null });
      sent.length = 0;
      expect((await api.post('/v1/device/parent-mode/end', phone.token)).status).toBe(204);
      const [row] = await db.select().from(parentModeSessions).where(eq(parentModeSessions.id, id));
      expect(row?.endedAt).not.toBeNull();
      expect(row?.endedBy).toBeNull();
      expect((await api.get('/v1/device/state', phone.token)).body.parentMode.active).toBe(false);
      expect(sent).toHaveLength(0);
      const [ended] = await db.select().from(events).where(eq(events.kind, 'parent_mode.ended'));
      expect(ended?.payload).toEqual({ sessionId: id, byName: null });
      expect((await api.post('/v1/device/parent-mode/end', phone.token)).status).toBe(204);
      expect((await api.post('/v1/device/parent-mode/end', null)).status).toBe(401);
    });
  });

  describe('POST and DELETE /v1/devices/{id}/parent-mode (from the parent app)', () => {
    it('starts parent mode remotely, replacing one that was on, and tells the device', async () => {
      const first = await api.post(`/v1/devices/${phone.id}/parent-mode`, mum, { durationMin: 60 });
      expect(first.status).toBe(201);
      sent.length = 0;
      const res = await api.post(`/v1/devices/${phone.id}/parent-mode`, dad, { durationMin: 2 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ deviceId: phone.id, method: 'remote', status: 'active', durationMin: 2, approvedByName: 'Dad' });
      const [old] = await db.select().from(parentModeSessions).where(eq(parentModeSessions.id, first.body.id));
      expect(old?.endedAt).not.toBeNull();
      const [toPhone] = sentTo('fcm-phone');
      expect(toPhone?.high).toBe(true);
      expect(toPhone?.msg.data).toEqual({ active: true, endsAt: res.body.endsAt, byName: 'Dad', requestId: null });
      expect(sentTo('fcm-mum').map((m) => m.msg.type)).toEqual(['parent_mode.used']);
    });

    it('ends it remotely, tells the device, and nothing to end sends nothing', async () => {
      const start = await api.post(`/v1/devices/${tablet.id}/parent-mode`, mum, { durationMin: null });
      sent.length = 0;
      expect((await api.del(`/v1/devices/${tablet.id}/parent-mode`, dad)).status).toBe(204);
      const [row] = await db.select().from(parentModeSessions).where(eq(parentModeSessions.id, start.body.id));
      expect(row?.endedBy).toBe(dadId);
      const [toTablet] = sentTo('fcm-tablet');
      expect(toTablet?.msg).toMatchObject({ type: 'parent_mode', data: { active: false, endsAt: null, byName: 'Dad', requestId: null } });
      sent.length = 0;
      expect((await api.del(`/v1/devices/${tablet.id}/parent-mode`, dad)).status).toBe(204);
      expect(sent).toHaveLength(0);
    });

    it('answers 404 for another family or a revoked device, and 422 for a bad duration', async () => {
      expect((await api.post(`/v1/devices/${otherKid.id}/parent-mode`, mum, { durationMin: 5 })).status).toBe(404);
      expect((await api.del(`/v1/devices/${otherKid.id}/parent-mode`, mum)).status).toBe(404);
      expect((await api.post(`/v1/devices/${phone.id}/parent-mode`, bea, { durationMin: 5 })).status).toBe(404);
      expect((await api.post(`/v1/devices/${phone.id}/parent-mode`, mum, { durationMin: 1 })).status).toBe(422);
      const spare = await addDevice(familyA, alexId, 'tablet', 'Old tablet', 'fcm-old');
      expect((await api.del(`/v1/devices/${spare.id}`, mum)).status).toBe(204);
      expect((await api.post(`/v1/devices/${spare.id}/parent-mode`, mum, { durationMin: 5 })).status).toBe(404);
      expect((await api.post(`/v1/devices/${phone.id}/parent-mode`, null, { durationMin: 5 })).status).toBe(401);
    });
  });
});
```

### 5.7 `server/test/openapi.test.ts`

The same as before, plus one test before the last one: the parent mode routes and their auth.

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

  it('describes parent mode, each route with the right auth', () => {
    expect(doc.paths?.['/v1/device/parent-mode-requests']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/device/parent-mode']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/device/parent-mode/end']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/parent-mode-requests/{id}/approve']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/parent-mode-requests/{id}/deny']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/devices/{id}/parent-mode']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/devices/{id}/parent-mode']?.delete?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'ParentModeByCode',
        'ParentModeDuration',
        'ParentModeRequestCreate',
        'ParentModeSession',
        'ParentModeStart',
        'ParentModeStatus',
      ]),
    );
  });

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.8 `contract/openapi.json`

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
      "ParentModeSession": {
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
          "method": {
            "type": "string",
            "enum": [
              "push",
              "code",
              "remote"
            ]
          },
          "status": {
            "$ref": "#/components/schemas/ParentModeStatus"
          },
          "requestedAt": {
            "type": "string",
            "format": "date-time"
          },
          "startedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "endsAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "endedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "durationMin": {
            "$ref": "#/components/schemas/ParentModeDuration"
          },
          "approvedByName": {
            "type": [
              "string",
              "null"
            ]
          },
          "endedByName": {
            "type": [
              "string",
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
          "method",
          "status",
          "requestedAt",
          "startedAt",
          "endsAt",
          "endedAt",
          "durationMin",
          "approvedByName",
          "endedByName"
        ]
      },
      "ParentModeStatus": {
        "type": "string",
        "enum": [
          "pending",
          "active",
          "ended",
          "denied",
          "expired"
        ]
      },
      "ParentModeDuration": {
        "anyOf": [
          {
            "type": "number",
            "enum": [
              2
            ]
          },
          {
            "type": "number",
            "enum": [
              5
            ]
          },
          {
            "type": "number",
            "enum": [
              15
            ]
          },
          {
            "type": "number",
            "enum": [
              60
            ]
          },
          {
            "type": "null"
          }
        ]
      },
      "ParentModeRequestCreate": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "id"
        ]
      },
      "ParentModeByCode": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "durationMin": {
            "$ref": "#/components/schemas/ParentModeDuration"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "durationMin",
          "startedAt"
        ]
      },
      "ParentModeStart": {
        "type": "object",
        "properties": {
          "durationMin": {
            "$ref": "#/components/schemas/ParentModeDuration"
          }
        },
        "required": [
          "durationMin"
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
    "/v1/device/parent-mode-requests": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "\"I'm the parent\": ask the parents to approve parent mode",
        "description": "Waits 10 minutes for an answer. A newer request from the same device replaces an older one. Parent mode already on → 409. Sending the same `id` again returns the stored request with 200.",
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
                "$ref": "#/components/schemas/ParentModeRequestCreate"
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
                  "$ref": "#/components/schemas/ParentModeSession"
                }
              }
            }
          },
          "201": {
            "description": "Sent to the parents.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
    "/v1/device/parent-mode": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Report parent mode started with the parent code",
        "description": "The device checked the code and started parent mode itself, maybe while offline. A `startedAt` in the future counts as now. Ends any other parent mode on this device. Sending the same `id` again returns the stored session with 200.",
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
                "$ref": "#/components/schemas/ParentModeByCode"
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
                  "$ref": "#/components/schemas/ParentModeSession"
                }
              }
            }
          },
          "201": {
            "description": "Stored.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
    "/v1/device/parent-mode/end": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "End parent mode on this device (\"End now\")",
        "description": "Nothing to end is fine too.",
        "security": [
          {
            "deviceAuth": []
          }
        ],
        "responses": {
          "204": {
            "description": "Ended."
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
    "/v1/parent-mode-requests/{id}/approve": {
      "post": {
        "tags": [
          "parent mode"
        ],
        "summary": "Approve a parent-mode request",
        "description": "Starts parent mode on the device that asked. Already answered or expired → 409.",
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
                "$ref": "#/components/schemas/ParentModeStart"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Parent mode is on.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
    "/v1/parent-mode-requests/{id}/deny": {
      "post": {
        "tags": [
          "parent mode"
        ],
        "summary": "Deny a parent-mode request",
        "description": "Already answered or expired → 409.",
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
            "description": "Denied.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
    "/v1/devices/{id}/parent-mode": {
      "post": {
        "tags": [
          "parent mode"
        ],
        "summary": "Start parent mode on a device from the parent app",
        "description": "Ends any other parent mode on the device first.",
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
                "$ref": "#/components/schemas/ParentModeStart"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Parent mode is on.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ParentModeSession"
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
          "parent mode"
        ],
        "summary": "End parent mode on a device from the parent app",
        "description": "Nothing to end is fine too.",
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
            "description": "Ended."
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

### 6.1 Session status

Worked out from the row with the database clock:

| Status | When |
|---|---|
| `pending` | not started, not ended, requested less than 10 minutes ago |
| `denied` | not started, ended by a parent (`ended_by` set) |
| `expired` | not started, and older than 10 minutes or replaced by a newer request (`ended_at` set, `ended_by` null) |
| `active` | started, not ended, `ends_at` null or in the future |
| `ended` | started, and ended or past `ends_at` |

"End the active session of a device" means: set `ended_at = now()` and `ended_by` (the parent, or null) on every session of that device that is `active`.

### 6.2 Device routes

- **`POST /v1/device/parent-mode-requests`** `{ id }`. The same id from the same device: **200** with the stored session. Another device's id: **409** `That parent-mode id is already used.` Parent mode active on this device: **409** `Parent mode is already on.` Otherwise it expires the device's older pending requests (`ended_at = now()`), stores a `push` session, and writes an event `parent_mode.request` with payload `{ requestId }`. After commit: `notifyParents` (essential: every parent app at high priority). **201** with the session (`pending`).
- **`POST /v1/device/parent-mode`** `{ id, durationMin, startedAt }`. The same id rules as above (**200** / **409**). It ends the device's active session, then stores a `code` session with `started_at = requested_at = least(startedAt, now())` and `ends_at = started_at + durationMin` (null for null). Writes `parent_mode.used`. After commit: `notifyParents`. Nothing is sent to the device (it started it). **201** with the session (`active`, or `ended` when it is already over).
- **`POST /v1/device/parent-mode/end`**: ends the device's active session (`ended_by` null) and writes `parent_mode.ended` `{ sessionId, byName: null }` for each. **204**, also when nothing was on.

### 6.3 Parent routes

- **`POST /v1/parent-mode-requests/{id}/approve`** `{ durationMin }` and **`.../deny`**. A `push` session of the family, of a kid not archived, on a device not revoked, else **404** `No such parent-mode request in your family.` Status `expired`: **409** `This request has expired.` Approve first ends the device's active session. Then one `UPDATE ... WHERE id = $1 AND started_at IS NULL AND ended_at IS NULL AND requested_at > now() - 10 minutes`: approve sets `approved_by`, `duration_min`, `started_at = now()`, `ends_at`; deny sets `ended_at = now()`, `ended_by`. No row: **409** `This request was already answered.` Approve writes `parent_mode.used` and pushes it to every parent; deny writes `parent_mode.denied` `{ sessionId, byName }` (history only). After commit, the device gets `parent_mode` `{ active, endsAt, byName, requestId: id }`. **200** with the session.
- **`POST /v1/devices/{id}/parent-mode`** `{ durationMin }`. A device of the family, not revoked, of a kid not archived, else **404** `No such device in your family.` Ends the device's active session, stores a `remote` session approved and started by the caller, writes `parent_mode.used`. After commit: `notifyParents`, and `parent_mode` `{ active: true, endsAt, byName, requestId: null }` to the device. **201** with the session.
- **`DELETE /v1/devices/{id}/parent-mode`**. The same 404. Ends the device's active session with `ended_by` = the caller and writes `parent_mode.ended` `{ sessionId, byName }` for each. If something ended, the device gets `parent_mode` `{ active: false, endsAt: null, byName, requestId: null }`. **204** either way.

### 6.4 Pushes to the device

`parent_mode` goes to that one device by WebSocket and FCM at **high** priority. FCM time to live: until `endsAt` (at least 60 s) when it starts with an end; 24 h for "until I end it"; 1 h for an end or a no.

`parent_mode.used` payload: `{ sessionId, method, durationMin, endsAt, byName }` (`byName` null for the code). It is not essential, so a parent who muted it gets nothing; everyone else gets it, also the parent who started it.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-019-parent-mode
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-019-parent-mode.md` must exist after the pull. If not, you did not pull: run `git fetch origin` and `git pull origin main` again.
3. Create 5.1 and 5.3, replace 5.2. Run `pnpm --filter @screentime/schemas build` and `pnpm --filter @screentime/schemas test`. Commit: `CARD-019: add parent mode schemas`.
4. Create 5.4, replace 5.5. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-019: add parent mode routes`.
5. Create 5.6, replace 5.7 and 5.8. Run `pnpm contract`, then `git status --short contract` must print nothing. Commit: `CARD-019: add tests and the contract`.
6. Run the acceptance checks in section 8.
7. Push and open the PR (section 10).
8. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
9. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  31 passed (31)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/parentmode.test.ts (17 tests | 17 skipped)`, `test/openapi.test.ts (11 tests)`, and every other file as before, so `Tests  38 passed | 146 skipped (184)`.
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
  Both runs: `test/parentmode.test.ts (17 tests)` and `Tests  184 passed (184)`.
- [ ] Parent mode works on the real stack (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
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
  Then add a kid, enrol a phone, ask for parent mode, approve 15 minutes, read the phone's state, ask again, end it from the app, start it with the code, and end it from the phone:
  ```powershell
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  $c = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/enrolment-codes" -Headers $ph -ContentType 'application/json' -Body '{"form":"phone"}'
  $d = Invoke-RestMethod -Method Post http://localhost:8080/v1/enrol -ContentType 'application/json' -Body "{`"code`":`"$($c.code)`",`"platform`":`"android`",`"hasCellular`":true,`"model`":`"Pixel 7`",`"osVersion`":`"Android 14`",`"appVersion`":`"0.1.0`"}"
  $dh = @{ Authorization = "Bearer $($d.deviceToken)" }
  $r = Invoke-RestMethod -Method Post http://localhost:8080/v1/device/parent-mode-requests -Headers $dh -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`"}"
  $r.status
  $a = Invoke-RestMethod -Method Post "http://localhost:8080/v1/parent-mode-requests/$($r.id)/approve" -Headers $ph -ContentType 'application/json' -Body '{"durationMin":15}'
  "$($a.status) $($a.durationMin) $($a.approvedByName)"
  $s = Invoke-RestMethod http://localhost:8080/v1/device/state -Headers $dh
  "$($s.parentMode.active) $($s.parentMode.byName)"
  try { Invoke-RestMethod -Method Post http://localhost:8080/v1/device/parent-mode-requests -Headers $dh -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`"}" | Out-Null; 'asked twice' } catch { [int]$_.Exception.Response.StatusCode }
  Invoke-RestMethod -Method Delete "http://localhost:8080/v1/devices/$($d.deviceId)/parent-mode" -Headers $ph | Out-Null
  (Invoke-RestMethod http://localhost:8080/v1/device/state -Headers $dh).parentMode.active
  $b = Invoke-RestMethod -Method Post http://localhost:8080/v1/device/parent-mode -Headers $dh -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`",`"durationMin`":null,`"startedAt`":`"$((Get-Date).ToUniversalTime().ToString('o'))`"}"
  "$($b.method) $($b.status) $($null -eq $b.endsAt)"
  Invoke-RestMethod -Method Post http://localhost:8080/v1/device/parent-mode/end -Headers $dh | Out-Null
  (Invoke-RestMethod http://localhost:8080/v1/device/state -Headers $dh).parentMode.active
  ```
  The outputs are `pending`, `active 15 Dad`, `True Dad`, `409`, `False`, `code active True` and `False`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 8 files (in any order):
  ```
  contract/openapi.json
  packages/schemas/src/index.ts
  packages/schemas/src/parentmode.ts
  packages/schemas/test/parentmode.test.ts
  server/src/app.ts
  server/src/parentmode/routes.ts
  server/test/openapi.test.ts
  server/test/parentmode.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/parentmode.test.ts` | A duration is 2, 5, 15, 60 or null, nothing else, and must be given; a code start needs an id, a duration and an ISO start time. |
| `server/test/parentmode.test.ts` | **Request:** pending, pushed at high priority to both parents (even one who muted it), not to another family or the device; the same id is 200 with nothing sent, another device's id 409; an older request expires when a newer one comes; 409 while parent mode is on; bad bodies and tokens refused. **Approve and deny:** approving 15 minutes makes the session active with the right end time, sends `parent_mode` to that phone only (high), `parent_mode.used` to both parents (normal), and shows in the phone's state and in `/v1/today`; "until I end it" has no end; approve and deny at the same moment give one 200 and one 409; denying tells the device, pushes nothing to parents and writes `parent_mode.denied`; a request older than 10 minutes is expired; another family, an unknown id and a revoked device are 404, bad durations 422. **Parent code:** stored from its start time with the right end, pushed to the parents, not the device, shown in the state; same id 200, another device's 409; a future start counts as now; one long over is `ended`; a new session ends the old one; bad bodies 422. **Ending:** the device ends it (no push, `parent_mode.ended` with `byName` null), and again is fine. **Remote:** a remote start replaces the active session and tells the device and the parents; a remote end records the parent, tells the device, and nothing to end sends nothing; another family or a revoked device is 404, a bad duration 422, no token 401. |
| `server/test/openapi.test.ts` | Adds: the seven routes are in the contract with device or parent auth, and the new schemas are listed. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 5). Message format: `CARD-019: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-019-parent-mode`
5. Open a PR into `main` titled `CARD-019: Parent mode`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-019-parent-mode --title "CARD-019: Parent mode" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-019-parent-mode.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract matches; db:generate finds no changes
   - [x] database tests, twice — output: `Tests  184 passed (184)` both times
   - [x] parent mode on the real stack — output: `pending`, `active 15 Dad`, `True Dad`, `409`, `False`, `code active True`, `False`
   - [x] deploy/.env not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 8 files

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

- **`Module '"@screentime/schemas"' has no exported member 'ParentModeSession'`** (or another new name): build the schemas package first (`pnpm --filter @screentime/schemas build`), or 5.2 is not copied exactly.
- **`pnpm contract` changes `contract/openapi.json`**, or the openapi drift test fails: one of the files in section 5 is not the card's version. Find it with `git diff`; do not commit a contract that differs from 5.8.
- **The "both parents tap at the same moment" test fails or hangs**: check Docker is running and `TEST_DATABASE_URL` is set; run the tests again once. If it fails twice, report it with its first error lines. Do not change the test.
- **`409` instead of `pending` on the real stack**: you ran the request twice. Run `docker compose ... down -v` and start the real-stack check again from the top.
- **Blank lines and formatting**: copy them exactly too. In CARD-016 and CARD-018 a changed quote and a deleted blank line were not reported. Every difference from the card, however small, is a deviation: list it under "Deviations".
- **Different test data**: do not change values in the tests (names, tokens, numbers, durations), even when another value would also pass. If you think one is wrong, say so under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-019. Please review and merge if it is good.

CARD: CARD-019 Parent mode
PR: <full PR URL>
Branch: bob/card-019-parent-mode
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
