# CARD-020: SOS

| Field | Value |
|---|---|
| Card | CARD-020 |
| Title | SOS |
| Size | M |
| Depends on | CARD-019b (merged to `main`) |
| Spec sections | docs/SPEC.md §6.1 (sos_incidents, sos_locations, sos_acks), §9.2, §9.3, §10, §13, §15 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-020-sos` |
| PR title | `CARD-020: SOS` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts`. Request and response shapes are Zod schemas in `packages/schemas`; `contract/openapi.json` is generated from them with `pnpm contract` and committed.

What exists already:

- Kid devices authenticate with `requireDevice` (`server/src/devices/auth.ts`); parents with `requireFamilyParent` (`server/src/auth/guards.ts`). Every family query runs inside `withFamily` (row-level security).
- The tables `sos_incidents`, `sos_locations` and `sos_acks` already exist (`server/src/db/schema.ts`, CARD-010). **No migration in this card.**
- The device state snapshot already shows `activeSos` (`server/src/sync/routes.ts`): the kid's newest SOS that has not ended and whose `auto_stop_at` is in the future.
- Pushes (`server/src/notify/dispatch.ts`): `notifyParents` maps every `sos.*` event to the notification kind `sos`, which is essential (high priority, cannot be muted). `sendToDevices` sends to kid devices by WebSocket and FCM.
- Email (`server/src/mailer.ts`): the `Mailer` sends sign-in codes over SMTP, or logs them when SMTP is not configured.

SOS is the kid's emergency button, on phones only (SPEC §15, Q31). The phone itself texts the parents at once (no server needed). This card adds the server side:

1. The phone sends **`POST /v1/device/sos`**: every parent app gets a critical push (`sos.started`) and every parent an email as backup.
2. The phone sends its position every 30 s to **`POST /v1/device/sos/{id}/locations`**. Positions are not pushed: the parent app reads **`GET /v1/sos/{id}`** while its SOS screen is open.
3. A parent taps **"I'm on it"** (`POST /v1/sos/{id}/ack`), **extend** (+2 h) or **End SOS**; the phone is told each time (`sos_ack`, `sos_extended`, `sos_ended`).
4. The kid holds **"I'm safe"** (`POST /v1/device/sos/{id}/end`).
5. An SOS stops by itself 2 hours after it starts (plus 2 hours per extend). Nothing runs for that: an SOS whose `auto_stop_at` has passed simply reads as ended, by `auto`.

## 2. Goal

The eight routes work as SPEC §9.2, §9.3 and §15 describe, are in the OpenAPI contract, and are tested against PostgreSQL 18: idempotent ids, one active SOS per kid, phones only, positions stored once, the email text, one winner when two parents end it at once, and the right pushes to the right parents and phone.

## 3. Out of scope

Do **not** do any of these in this card:

- No device or parent app code. The SMS from the phone is the phone's job.
- No job that marks auto-stopped SOS rows (`ended_by_kind` stays null for them; the API shows them as `auto`).
- No change to the database schema or migrations. Do not change `server/src/db/` or anything in `server/drizzle/`.
- No new npm packages and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay unchanged.
- Do not change any file that is not listed in section 5. Do not change the other test files: `sendAlert` is optional on `Mailer` so their test mailers stay as they are. `docs/SPEC.md` and `docs/BUILD-PLAN.md` were already updated by Claude.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key, a Firebase key, an FCM token or a device token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, hono ^4.13.13, @hono/zod-openapi ^1.6.3, zod ^4.6.7, drizzle-orm ^0.45.4, nodemailer ^10.2.1, firebase-admin ^14.5.0, @hono/node-ws ^1.3.1, PostgreSQL 18. Nothing new to install. The last position of each SOS uses `selectDistinctOn` (PostgreSQL `DISTINCT ON`), part of drizzle-orm.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Some strings contain an apostrophe: route summaries and test names escape it as `\'` inside single quotes (`'"I\'m on it"'`), and some test names are in double quotes because of it. The tests and the email text contain `±`: save every file as UTF-8. Keep all of them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/sos.ts` | create (5.1) |
| `packages/schemas/src/index.ts` | replace (5.2) |
| `packages/schemas/test/sos.test.ts` | create (5.3) |
| `server/src/mailer.ts` | replace (5.4) |
| `server/src/sos/routes.ts` | create (5.5) |
| `server/src/app.ts` | replace (5.6) |
| `server/test/sos.test.ts` | create (5.7) |
| `server/test/openapi.test.ts` | replace (5.8) |
| `contract/openapi.json` | replace (5.9) |

That is 9 files.

### 5.1 `packages/schemas/src/sos.ts`

The shapes of an SOS, its positions and acks. `SosMessage` is the data of the `sos_ack`, `sos_extended` and `sos_ended` messages to the phone; no route uses it, so it is not in the contract.

```typescript
import { z } from 'zod';

/** One position from the phone during an SOS (docs/SPEC.md §15). `via` says how it reached the parents first. */
export const SosLocationIn = z
  .object({
    at: z.iso.datetime({ offset: true }),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** Radius in metres. */
    accuracyM: z.number().min(0).max(100000).nullable().optional(),
    batteryPct: z.int().min(0).max(100).nullable().optional(),
    via: z.enum(['data', 'sms']),
  })
  .meta({ id: 'SosLocationIn' });

export type SosLocationIn = z.infer<typeof SosLocationIn>;

/** Body of POST /v1/device/sos. The phone makes the id; `startedAt` is when the countdown finished. */
export const SosStart = z
  .object({
    id: z.uuid(),
    startedAt: z.iso.datetime({ offset: true }),
    /** The position sent in the first SMS, when the phone had one. */
    location: SosLocationIn.nullable().optional(),
  })
  .meta({ id: 'SosStart' });

export type SosStart = z.infer<typeof SosStart>;

/** Body of POST /v1/device/sos/{id}/locations: every 30 s over data, or what the phone queued. */
export const SosLocationsUpload = z
  .object({ locations: z.array(SosLocationIn).min(1).max(100) })
  .meta({ id: 'SosLocationsUpload' });

export type SosLocationsUpload = z.infer<typeof SosLocationsUpload>;

export const SosLocation = z
  .object({
    at: z.iso.datetime(),
    lat: z.number(),
    lng: z.number(),
    accuracyM: z.number().nullable(),
    batteryPct: z.int().nullable(),
    via: z.enum(['data', 'sms']),
  })
  .meta({ id: 'SosLocation' });

export type SosLocation = z.infer<typeof SosLocation>;

/** A parent who tapped "I'm on it". */
export const SosAck = z
  .object({ parentId: z.uuid(), byName: z.string(), at: z.iso.datetime() })
  .meta({ id: 'SosAck' });

export type SosAck = z.infer<typeof SosAck>;

/** An SOS is active until the kid or a parent ends it, or until `autoStopAt` passes. */
export const SosStatus = z.enum(['active', 'ended']).meta({ id: 'SosStatus' });
export type SosStatus = z.infer<typeof SosStatus>;

export const Sos = z
  .object({
    id: z.uuid(),
    kidId: z.uuid(),
    kidName: z.string(),
    deviceId: z.uuid(),
    deviceName: z.string(),
    status: SosStatus,
    startedAt: z.iso.datetime(),
    /** Two hours after the start, plus two hours for each extend. */
    autoStopAt: z.iso.datetime(),
    /** null while active. `autoStopAt` when it stopped by itself. */
    endedAt: z.iso.datetime().nullable(),
    endedBy: z.enum(['kid', 'parent', 'auto']).nullable(),
    endedByName: z.string().nullable(),
    /** The newest position, by its `at`. */
    lastLocation: SosLocation.nullable(),
    /** Oldest first. */
    acks: z.array(SosAck),
  })
  .meta({ id: 'Sos' });

export type Sos = z.infer<typeof Sos>;

/** GET /v1/sos/{id}: the SOS and every position, oldest first. */
export const SosDetail = Sos.extend({ locations: z.array(SosLocation) }).meta({ id: 'SosDetail' });

export type SosDetail = z.infer<typeof SosDetail>;

/** Data of the `sos_ack`, `sos_extended` and `sos_ended` messages to the phone (docs/SPEC.md §10). */
export const SosMessage = z
  .object({
    sosId: z.uuid(),
    byName: z.string(),
    /** Set on `sos_extended`. */
    autoStopAt: z.iso.datetime().optional(),
  })
  .meta({ id: 'SosMessage' });

export type SosMessage = z.infer<typeof SosMessage>;
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
export { DeviceEventIn, DeviceEventKind, DeviceEventUpload } from './tamper.js';
export {
  Sos,
  SosAck,
  SosDetail,
  SosLocation,
  SosLocationIn,
  SosLocationsUpload,
  SosMessage,
  SosStart,
  SosStatus,
} from './sos.js';
```

### 5.3 `packages/schemas/test/sos.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { SosLocationsUpload, SosStart } from '../src/index.js';

const id = '0192f1a0-0000-7000-8000-000000000001';
const at = '2026-10-25T14:00:00+11:00';
const where = { at, lat: -33.87, lng: 151.21, accuracyM: 20, batteryPct: 54, via: 'data' };

describe('SOS schemas', () => {
  it('starts with an id and a start time, with or without a location', () => {
    expect(SosStart.safeParse({ id, startedAt: at }).success).toBe(true);
    expect(SosStart.safeParse({ id, startedAt: at, location: null }).success).toBe(true);
    expect(SosStart.safeParse({ id, startedAt: at, location: where }).success).toBe(true);
    expect(SosStart.safeParse({ id, startedAt: at, location: { ...where, accuracyM: null, batteryPct: null } }).success).toBe(true);
    expect(SosStart.safeParse({ id }).success).toBe(false);
    expect(SosStart.safeParse({ id, startedAt: '2026-10-25 14:00' }).success).toBe(false);
  });

  it('takes 1 to 100 real positions sent by data or SMS', () => {
    expect(SosLocationsUpload.safeParse({ locations: [where, { ...where, via: 'sms' }] }).success).toBe(true);
    for (const bad of [{ lat: 91 }, { lat: -91 }, { lng: 181 }, { batteryPct: 101 }, { batteryPct: 5.5 }, { accuracyM: -1 }, { via: 'wifi' }]) {
      expect(SosLocationsUpload.safeParse({ locations: [{ ...where, ...bad }] }).success).toBe(false);
    }
    expect(SosLocationsUpload.safeParse({ locations: [] }).success).toBe(false);
    expect(SosLocationsUpload.safeParse({ locations: Array(101).fill(where) }).success).toBe(false);
  });
});
```

### 5.4 `server/src/mailer.ts`

The same as before, plus an optional `sendAlert(to, subject, text)`: over SMTP it sends a plain-text email; without SMTP it logs `SMTP not configured: alert for <email>: <subject>`.

```typescript
import nodemailer from 'nodemailer';
import type { SmtpConfig } from './config.js';

export interface Mailer {
  sendSignInCode(to: string, code: string): Promise<void>;
  /** A plain-text alert, such as the SOS email backup. Optional, so test mailers that only sign in can leave it out. */
  sendAlert?(to: string, subject: string, text: string): Promise<void>;
}

/** Sends email over SMTP (docs/SPEC.md §11.1), or logs the code when SMTP is not configured (dev and tests only). */
export function createMailer(smtp: SmtpConfig | null): Mailer {
  if (!smtp) {
    return {
      async sendSignInCode(to, code) {
        console.log(`SMTP not configured: sign-in code for ${to} is ${code}`);
      },
      async sendAlert(to, subject) {
        console.log(`SMTP not configured: alert for ${to}: ${subject}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // 465 is implicit TLS; any other port (587) upgrades with STARTTLS.
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  return {
    async sendSignInCode(to, code) {
      await transport.sendMail({
        from: { name: smtp.fromName, address: smtp.from },
        to,
        subject: `Your ScreenTime sign-in code: ${code}`,
        text: `Your ScreenTime sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not ask for it, ignore this email.\n`,
      });
    },
    async sendAlert(to, subject, text) {
      await transport.sendMail({ from: { name: smtp.fromName, address: smtp.from }, to, subject, text });
    },
  };
}
```

### 5.5 `server/src/sos/routes.ts`

All eight routes, and `sosEmail` (exported for its test). An SOS's status is worked out in SQL with the database clock (`statusSql`, `isActive`).

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, gt, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import {
  Sos,
  type SosAck,
  SosDetail,
  SosLocation,
  SosLocationsUpload,
  type SosMessage,
  SosStart,
  type SosStatus,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, families, kids, parents, sosAcks, sosIncidents, sosLocations } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { notifyParents, sendToDevices } from '../notify/dispatch.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const IdParam = z.object({ id: z.uuid() });
const SosQuery = z.object({
  active: z.enum(['true', 'false']).optional(),
  kidId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** An SOS stops by itself this long after it starts; each extend adds the same again (docs/SPEC.md §15). */
const RUN_FOR = sql`interval '2 hours'`;
/** FCM keeps trying to reach the phone for this long. */
const PHONE_TTL_SEC = 7200;

const startRoute = createRoute({
  method: 'post',
  path: '/v1/device/sos',
  tags: ['device'],
  summary: 'Start an SOS',
  description:
    'Phones only. Every parent app gets a critical push and every parent an email. While the kid has an active SOS → 409. Sending the same `id` again returns the stored SOS with 200.',
  security: deviceBearer,
  request: { body: jsonBody(SosStart) },
  responses: {
    201: jsonResponse('The parents are being told.', Sos),
    200: jsonResponse('Already stored with this id.', Sos),
    ...errorResponses(401, 409, 422),
  },
});

const locationsRoute = createRoute({
  method: 'post',
  path: '/v1/device/sos/{id}/locations',
  tags: ['device'],
  summary: 'Add positions to an SOS',
  description: 'Also after it ended, for positions that were queued. A position with the same `at` as a stored one is skipped.',
  security: deviceBearer,
  request: { params: IdParam, body: jsonBody(SosLocationsUpload) },
  responses: { 204: { description: 'Stored.' }, ...errorResponses(401, 404, 422) },
});

const deviceEndRoute = createRoute({
  method: 'post',
  path: '/v1/device/sos/{id}/end',
  tags: ['device'],
  summary: '"I\'m safe": end an SOS',
  description: 'An SOS that has already ended is fine too.',
  security: deviceBearer,
  request: { params: IdParam },
  responses: { 204: { description: 'Ended.' }, ...errorResponses(401, 404, 422) },
});

const listRoute = createRoute({
  method: 'get',
  path: '/v1/sos',
  tags: ['sos'],
  summary: 'SOS alerts',
  description: 'Newest first, archived kids included. `active=true` gives only the ones still on. `limit` defaults to 50.',
  security: bearer,
  request: { query: SosQuery },
  responses: { 200: jsonResponse('The SOS alerts.', z.array(Sos)), ...errorResponses(401, 403, 422) },
});

const getRoute = createRoute({
  method: 'get',
  path: '/v1/sos/{id}',
  tags: ['sos'],
  summary: 'One SOS with every position',
  description: 'Parent apps read this every 30 seconds while the SOS screen is open.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('The SOS.', SosDetail), ...errorResponses(401, 403, 404, 422) },
});

const ackRoute = createRoute({
  method: 'post',
  path: '/v1/sos/{id}/ack',
  tags: ['sos'],
  summary: '"I\'m on it"',
  description: 'The phone shows "Dad has seen your SOS". Tapping it again changes nothing. An SOS that has ended → 409.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('The SOS.', Sos), ...errorResponses(401, 403, 404, 409, 422) },
});

const extendRoute = createRoute({
  method: 'post',
  path: '/v1/sos/{id}/extend',
  tags: ['sos'],
  summary: 'Keep an SOS on for 2 more hours',
  description: 'Moves `autoStopAt` 2 hours later. An SOS that has ended → 409.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('The SOS.', Sos), ...errorResponses(401, 403, 404, 409, 422) },
});

const endRoute = createRoute({
  method: 'post',
  path: '/v1/sos/{id}/end',
  tags: ['sos'],
  summary: 'End an SOS',
  description: 'An SOS that has already ended → 409.',
  security: bearer,
  request: { params: IdParam },
  responses: { 200: jsonResponse('The SOS.', Sos), ...errorResponses(401, 403, 404, 409, 422) },
});

const sosNotFound = () => new ApiError('not_found', 'No such SOS in your family.');
const sosEnded = () => new ApiError('conflict', 'This SOS has ended.');

/** Not ended, and not past its auto stop, by the database clock. */
const isActive = and(isNull(sosIncidents.endedAt), gt(sosIncidents.autoStopAt, sql`now()`));
const statusSql = sql<SosStatus>`case when ${sosIncidents.endedAt} is null and ${sosIncidents.autoStopAt} > now()
  then 'active' else 'ended' end`;

function toLocation(l: typeof sosLocations.$inferSelect): SosLocation {
  return {
    at: l.at.toISOString(),
    lat: l.lat,
    lng: l.lng,
    accuracyM: l.accuracyM,
    batteryPct: l.batteryPct,
    via: l.via as SosLocation['via'],
  };
}

/** SOS alerts with names, newest position and acks, newest first. */
async function selectIncidents(tx: FamilyTx, where: SQL | undefined, limit?: number): Promise<Sos[]> {
  const query = tx
    .select({
      sos: sosIncidents,
      status: statusSql,
      kidName: kids.name,
      deviceName: devices.name,
      endedByName: parents.displayName,
    })
    .from(sosIncidents)
    .innerJoin(kids, eq(kids.id, sosIncidents.kidId))
    .innerJoin(devices, eq(devices.id, sosIncidents.deviceId))
    .leftJoin(parents, eq(parents.id, sosIncidents.endedByParent))
    .where(where)
    .orderBy(desc(sosIncidents.startedAt), desc(sosIncidents.id));
  const rows = await (limit === undefined ? query : query.limit(limit));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.sos.id);
  const last = await tx
    .selectDistinctOn([sosLocations.sosId])
    .from(sosLocations)
    .where(inArray(sosLocations.sosId, ids))
    .orderBy(sosLocations.sosId, desc(sosLocations.at), desc(sosLocations.id));
  const acks = await tx
    .select({ sosId: sosAcks.sosId, parentId: sosAcks.parentId, byName: parents.displayName, at: sosAcks.at })
    .from(sosAcks)
    .innerJoin(parents, eq(parents.id, sosAcks.parentId))
    .where(inArray(sosAcks.sosId, ids))
    .orderBy(asc(sosAcks.at), asc(parents.displayName));
  return rows.map(({ sos: s, status, kidName, deviceName, endedByName }): Sos => {
    const location = last.find((l) => l.sosId === s.id);
    return {
      id: s.id,
      kidId: s.kidId,
      kidName,
      deviceId: s.deviceId,
      deviceName,
      status,
      startedAt: s.startedAt.toISOString(),
      autoStopAt: s.autoStopAt.toISOString(),
      // Nobody ended an SOS that ran out: it ended at its auto stop.
      endedAt: s.endedAt?.toISOString() ?? (status === 'ended' ? s.autoStopAt.toISOString() : null),
      endedBy: (s.endedByKind as Sos['endedBy']) ?? (status === 'ended' ? 'auto' : null),
      endedByName,
      lastLocation: location ? toLocation(location) : null,
      acks: acks
        .filter((a) => a.sosId === s.id)
        .map((a): SosAck => ({ parentId: a.parentId, byName: a.byName, at: a.at.toISOString() })),
    };
  });
}

async function selectIncident(tx: FamilyTx, id: string) {
  const [sos] = await selectIncidents(tx, eq(sosIncidents.id, id));
  return sos ?? null;
}

/** The family's SOS with this id, or 404. */
async function findIncident(tx: FamilyTx, id: string) {
  const sos = await selectIncident(tx, id);
  if (!sos) throw sosNotFound();
  return sos;
}

/** This device's SOS with this id, or 404 (another device's SOS is not its business). */
async function ownIncident(tx: FamilyTx, id: string, deviceId: string) {
  const [row] = await tx.select({ deviceId: sosIncidents.deviceId }).from(sosIncidents).where(eq(sosIncidents.id, id));
  if (!row || row.deviceId !== deviceId) throw new ApiError('not_found', 'No such SOS on this device.');
}

async function writeEvent(tx: FamilyTx, familyId: string, sos: Sos, kind: string, payload: Record<string, unknown>) {
  const [event] = await tx
    .insert(events)
    .values({ familyId, kidId: sos.kidId, deviceId: sos.deviceId, kind, at: sql`now()`, payload })
    .returning({ id: events.id });
  if (!event) throw new Error('event insert returned nothing');
  return event.id;
}

async function parentName(tx: FamilyTx, parentId: string) {
  const [row] = await tx.select({ name: parents.displayName }).from(parents).where(eq(parents.id, parentId));
  if (!row) throw new Error('parent vanished after requireFamilyParent');
  return row.name;
}

/** "3:04 pm" in the family's time zone. */
function clockTime(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(
    new Date(iso),
  );
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`;
}

/** The text of the SOS email backup (docs/SPEC.md §15 step 3). */
export function sosEmail(sos: Sos, timeZone: string) {
  const loc = sos.lastLocation;
  const where = loc
    ? `Location: https://maps.google.com/?q=${loc.lat},${loc.lng}${loc.accuracyM === null ? '' : ` (±${Math.round(loc.accuracyM)} m)`}.`
    : 'Location: not known yet.';
  const battery = loc?.batteryPct == null ? '' : ` Battery ${loc.batteryPct}%.`;
  return {
    subject: `SOS from ${sos.kidName}`,
    text: `${sos.kidName} pressed SOS at ${clockTime(sos.startedAt, timeZone)}.\n${where}${battery}\n\nOpen the ScreenTime app to see where ${sos.kidName} is and to answer.\n`,
  };
}

/**
 * SOS (docs/SPEC.md §15, Q31): the phone has already texted the parents; the server adds a critical push and an
 * email, keeps the positions, and passes "I'm on it", extend and end between parents and the phone.
 */
export function registerSosRoutes(app: Router, deps: AppDeps) {
  const { db, config, mailer } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  /** Emails every enabled parent. A failed email is logged: the push and the phone's SMS went too. */
  async function emailParents(familyId: string, sos: Sos) {
    if (!mailer.sendAlert) return;
    const { to, timezone } = await withFamily(db, familyId, async (tx) => {
      const [family] = await tx.select({ timezone: families.timezone }).from(families).where(eq(families.id, familyId));
      const rows = await tx.select({ email: parents.email }).from(parents).where(isNull(parents.disabledAt));
      return { to: rows.map((r) => r.email), timezone: family?.timezone ?? 'UTC' };
    });
    const { subject, text } = sosEmail(sos, timezone);
    for (const email of to) {
      try {
        await mailer.sendAlert(email, subject, text);
      } catch (err) {
        console.error('SOS email failed', err);
      }
    }
  }

  /** Tells the phone that raised the SOS, at high priority. */
  async function tellPhone(familyId: string, sos: Sos, type: string, data: SosMessage) {
    await sendToDevices(
      deps,
      familyId,
      { deviceId: sos.deviceId },
      { v: 1, type, at: new Date().toISOString(), data },
      { high: true, ttlSec: PHONE_TTL_SEC },
    );
  }

  app.openapi(startRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      const [stored] = await tx.select({ deviceId: sosIncidents.deviceId }).from(sosIncidents).where(eq(sosIncidents.id, body.id));
      if (stored) {
        if (stored.deviceId !== deviceId) throw new ApiError('conflict', 'That SOS id is already used.');
        return { sos: await findIncident(tx, body.id), eventId: null };
      }
      const [device] = await tx.select({ form: devices.form }).from(devices).where(eq(devices.id, deviceId));
      if (!device) throw new Error('device vanished after requireDevice');
      if (device.form !== 'phone') throw new ApiError('conflict', 'SOS is only on phones.');
      const [active] = await tx
        .select({ id: sosIncidents.id })
        .from(sosIncidents)
        .where(and(eq(sosIncidents.kidId, kidId), isActive));
      if (active) throw new ApiError('conflict', 'An SOS is already on.');

      const start = sql`least(${body.startedAt}::timestamptz, now())`;
      await tx
        .insert(sosIncidents)
        .values({ id: body.id, familyId, kidId, deviceId, startedAt: start, autoStopAt: sql`${start} + ${RUN_FOR}` });
      const loc = body.location;
      if (loc) {
        await tx.insert(sosLocations).values({
          familyId,
          sosId: body.id,
          at: new Date(loc.at),
          lat: loc.lat,
          lng: loc.lng,
          accuracyM: loc.accuracyM ?? null,
          batteryPct: loc.batteryPct ?? null,
          via: loc.via,
        });
      }
      const sos = await findIncident(tx, body.id);
      const eventId = await writeEvent(tx, familyId, sos, 'sos.started', {
        sosId: sos.id,
        startedAt: sos.startedAt,
        location: sos.lastLocation,
      });
      return { sos, eventId };
    });
    if (!result.eventId) return c.json(result.sos, 200);
    await notifyParents(deps, familyId, [result.eventId]);
    await emailParents(familyId, result.sos);
    return c.json(result.sos, 201);
  });

  app.openapi(locationsRoute, async (c) => {
    const { deviceId, familyId } = await requireDevice(c, db);
    const { id } = c.req.valid('param');
    const { locations } = c.req.valid('json');
    await withFamily(db, familyId, async (tx) => {
      await ownIncident(tx, id, deviceId);
      // A phone that retries an upload sends the same positions again.
      const have = await tx
        .select({ at: sosLocations.at })
        .from(sosLocations)
        .where(and(eq(sosLocations.sosId, id), inArray(sosLocations.at, locations.map((l) => new Date(l.at)))));
      const seen = new Set(have.map((h) => h.at.getTime()));
      const fresh = locations.filter((l) => {
        const t = new Date(l.at).getTime();
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      });
      if (fresh.length === 0) return;
      await tx.insert(sosLocations).values(
        fresh.map((l) => ({
          familyId,
          sosId: id,
          at: new Date(l.at),
          lat: l.lat,
          lng: l.lng,
          accuracyM: l.accuracyM ?? null,
          batteryPct: l.batteryPct ?? null,
          via: l.via,
        })),
      );
    });
    return c.body(null, 204);
  });

  app.openapi(deviceEndRoute, async (c) => {
    const { deviceId, familyId } = await requireDevice(c, db);
    const { id } = c.req.valid('param');
    const eventId = await withFamily(db, familyId, async (tx) => {
      await ownIncident(tx, id, deviceId);
      const [ended] = await tx
        .update(sosIncidents)
        .set({ endedAt: sql`now()`, endedByKind: 'kid' })
        .where(and(eq(sosIncidents.id, id), isActive))
        .returning({ id: sosIncidents.id });
      if (!ended) return null;
      return writeEvent(tx, familyId, await findIncident(tx, id), 'sos.ended', { sosId: id, endedBy: 'kid', byName: null });
    });
    if (eventId) await notifyParents(deps, familyId, [eventId]);
    return c.body(null, 204);
  });

  app.openapi(listRoute, async (c) => {
    const { familyId } = await caller(c);
    const { active, kidId, limit } = c.req.valid('query');
    const rows = await withFamily(db, familyId, (tx) =>
      selectIncidents(
        tx,
        and(
          active === 'true' ? isActive : undefined,
          active === 'false' ? sql`not (${isActive})` : undefined,
          kidId ? eq(sosIncidents.kidId, kidId) : undefined,
        ),
        limit,
      ),
    );
    return c.json(rows, 200);
  });

  app.openapi(getRoute, async (c) => {
    const { familyId } = await caller(c);
    const { id } = c.req.valid('param');
    const detail = await withFamily(db, familyId, async (tx) => {
      const sos = await findIncident(tx, id);
      const rows = await tx
        .select()
        .from(sosLocations)
        .where(eq(sosLocations.sosId, id))
        .orderBy(asc(sosLocations.at), asc(sosLocations.id));
      return { ...sos, locations: rows.map(toLocation) };
    });
    return c.json(detail, 200);
  });

  app.openapi(ackRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    const result = await withFamily(db, familyId, async (tx) => {
      const before = await findIncident(tx, id);
      if (before.status === 'ended') throw sosEnded();
      const [added] = await tx
        .insert(sosAcks)
        .values({ familyId, sosId: id, parentId })
        .onConflictDoNothing()
        .returning({ at: sosAcks.at });
      const sos = await findIncident(tx, id);
      if (!added) return { sos, eventId: null, byName: '' };
      const byName = await parentName(tx, parentId);
      return { sos, eventId: await writeEvent(tx, familyId, sos, 'sos.acked', { sosId: id, byName }), byName };
    });
    if (result.eventId) {
      // The other parent knows someone is on it; the phone shows "Dad has seen your SOS".
      await notifyParents(deps, familyId, [result.eventId]);
      await tellPhone(familyId, result.sos, 'sos_ack', { sosId: id, byName: result.byName });
    }
    return c.json(result.sos, 200);
  });

  app.openapi(extendRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    const result = await withFamily(db, familyId, async (tx) => {
      await findIncident(tx, id);
      const [moved] = await tx
        .update(sosIncidents)
        .set({ autoStopAt: sql`${sosIncidents.autoStopAt} + ${RUN_FOR}` })
        .where(and(eq(sosIncidents.id, id), isActive))
        .returning({ id: sosIncidents.id });
      if (!moved) throw sosEnded();
      const sos = await findIncident(tx, id);
      const byName = await parentName(tx, parentId);
      const eventId = await writeEvent(tx, familyId, sos, 'sos.extended', { sosId: id, autoStopAt: sos.autoStopAt, byName });
      return { sos, eventId, byName };
    });
    await notifyParents(deps, familyId, [result.eventId]);
    await tellPhone(familyId, result.sos, 'sos_extended', { sosId: id, byName: result.byName, autoStopAt: result.sos.autoStopAt });
    return c.json(result.sos, 200);
  });

  app.openapi(endRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { id } = c.req.valid('param');
    const result = await withFamily(db, familyId, async (tx) => {
      await findIncident(tx, id);
      // Two parents ending at once: the second waits for the first one's row lock, then matches nothing.
      const [ended] = await tx
        .update(sosIncidents)
        .set({ endedAt: sql`now()`, endedByKind: 'parent', endedByParent: parentId })
        .where(and(eq(sosIncidents.id, id), isActive))
        .returning({ id: sosIncidents.id });
      if (!ended) throw sosEnded();
      const sos = await findIncident(tx, id);
      const byName = sos.endedByName ?? (await parentName(tx, parentId));
      const eventId = await writeEvent(tx, familyId, sos, 'sos.ended', { sosId: id, endedBy: 'parent', byName });
      return { sos, eventId, byName };
    });
    await notifyParents(deps, familyId, [result.eventId]);
    await tellPhone(familyId, result.sos, 'sos_ended', { sosId: id, byName: result.byName });
    return c.json(result.sos, 200);
  });
}
```

### 5.6 `server/src/app.ts`

The same as before, plus one import and `registerSosRoutes(app, deps)` after `registerTamperRoutes`.

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
import { registerSosRoutes } from './sos/routes.js';
import { registerSyncRoutes } from './sync/routes.js';
import { registerTamperRoutes } from './tamper/routes.js';

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
  registerTamperRoutes(app, deps);
  registerSosRoutes(app, deps);
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

### 5.7 `server/test/sos.test.ts`

The first `describe` (the email text) runs without a database too.

```typescript
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Sos } from '@screentime/schemas';
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
  sosAcks,
  sosIncidents,
  sosLocations,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { sosEmail } from '../src/sos/routes.js';
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

const sample: Sos = {
  id: '0192f1a0-0000-7000-8000-000000000001',
  kidId: '0192f1a0-0000-7000-8000-000000000002',
  kidName: 'Alex',
  deviceId: '0192f1a0-0000-7000-8000-000000000003',
  deviceName: 'Pixel 7',
  status: 'active',
  startedAt: '2026-10-25T04:04:00.000Z',
  autoStopAt: '2026-10-25T06:04:00.000Z',
  endedAt: null,
  endedBy: null,
  endedByName: null,
  lastLocation: { at: '2026-10-25T04:04:00.000Z', lat: -33.87, lng: 151.21, accuracyM: 19.6, batteryPct: 54, via: 'data' },
  acks: [],
};

describe('SOS email text', () => {
  it('names the kid, the local time, the map link and the battery', () => {
    expect(sosEmail(sample, 'Australia/Sydney')).toEqual({
      subject: 'SOS from Alex',
      text: 'Alex pressed SOS at 3:04 pm.\nLocation: https://maps.google.com/?q=-33.87,151.21 (±20 m). Battery 54%.\n\nOpen the ScreenTime app to see where Alex is and to answer.\n',
    });
    expect(sosEmail({ ...sample, startedAt: '2026-10-24T13:30:00.000Z', lastLocation: null }, 'Australia/Sydney').text).toBe(
      'Alex pressed SOS at 12:30 am.\nLocation: not known yet.\n\nOpen the ScreenTime app to see where Alex is and to answer.\n',
    );
    const rough = { ...sample, lastLocation: { ...sample.lastLocation, accuracyM: null, batteryPct: null } as Sos['lastLocation'] };
    expect(sosEmail(rough, 'Australia/Perth').text).toBe(
      'Alex pressed SOS at 12:04 pm.\nLocation: https://maps.google.com/?q=-33.87,151.21.\n\nOpen the ScreenTime app to see where Alex is and to answer.\n',
    );
  });
});

describe.skipIf(!url)('SOS', () => {
  const { db, pool } = createDb(url ?? '');
  const mails: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = {
    async sendSignInCode() {},
    async sendAlert(to, subject, text) {
      mails.push({ to, subject, text });
    },
  };

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
  const phone = { id: '', token: '' };
  const otherPhone = { id: '', token: '' };
  const tablet = { id: '', token: '' };

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

  async function addDevice(kidId: string, form: 'tablet' | 'phone', name: string, fcmToken: string) {
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
        hasCellular: form === 'phone',
        tokenHash: hashDeviceToken(token),
        fcmToken,
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
  const where = (at: string, lat = -33.87) => ({ at, lat, lng: 151.21, accuracyM: 20, batteryPct: 54, via: 'data' });

  /** The phone starts an SOS; returns it. */
  async function start(device = phone, extra: Record<string, unknown> = {}) {
    const res = await api.post('/v1/device/sos', device.token, { id: randomUUID(), startedAt: ago(5), ...extra });
    expect(res.status).toBe(201);
    sent.length = 0;
    mails.length = 0;
    return res.body as Sos;
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
    const [p1, p2, p3, p4] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: familyA, email: 'gone@example.com', displayName: 'Gone', disabledAt: new Date() },
        { familyId: b?.id ?? '', email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mumId = p1?.id ?? '';
    dadId = p2?.id ?? '';
    mum = await signIn(familyA, mumId, 'fcm-mum');
    dad = await signIn(familyA, dadId, 'fcm-dad');
    await signIn(familyA, p3?.id ?? '', 'fcm-gone');
    bea = await signIn(b?.id ?? '', p4?.id ?? '', 'fcm-bea');
    alexId = await addKid('Alex');
    const samId = await addKid('Sam');
    Object.assign(phone, await addDevice(alexId, 'phone', 'Pixel 7', 'fcm-phone'));
    Object.assign(tablet, await addDevice(alexId, 'tablet', 'Tablet', 'fcm-tablet'));
    Object.assign(otherPhone, await addDevice(samId, 'phone', 'Sam phone', 'fcm-sam'));
  });

  beforeEach(async () => {
    sent.length = 0;
    mails.length = 0;
    await db.delete(sosAcks);
    await db.delete(sosLocations);
    await db.delete(sosIncidents);
    await db.delete(events);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /v1/device/sos', () => {
    it('starts an SOS, pushes it to every parent at high priority and emails them', async () => {
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'sos', enabled: false });
      const id = randomUUID();
      const startedAt = ago(30);
      const res = await api.post('/v1/device/sos', phone.token, { id, startedAt, location: where(startedAt) });
      await db.delete(notificationPrefs);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        kidId: alexId,
        kidName: 'Alex',
        deviceId: phone.id,
        deviceName: 'Pixel 7',
        status: 'active',
        startedAt,
        autoStopAt: new Date(Date.parse(startedAt) + 7_200_000).toISOString(),
        endedAt: null,
        endedBy: null,
        endedByName: null,
        lastLocation: { at: startedAt, lat: -33.87, lng: 151.21, accuracyM: 20, batteryPct: 54, via: 'data' },
        acks: [],
      });

      // SOS cannot be muted: Dad turned it off and still gets it.
      for (const token of ['fcm-mum', 'fcm-dad']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(true);
        expect(push?.msg).toMatchObject({
          type: 'sos',
          data: { kind: 'sos.started', kidName: 'Alex', payload: { sosId: id, startedAt, location: { lat: -33.87 } } },
        });
      }
      expect(sentTo('fcm-gone')).toHaveLength(0);
      expect(sentTo('fcm-bea')).toHaveLength(0);
      expect(sentTo('fcm-phone')).toHaveLength(0);

      expect(mails.map((m) => m.to).sort()).toEqual(['dad@example.com', 'mum@example.com']);
      expect(mails[0]?.subject).toBe('SOS from Alex');
      expect(mails[0]?.text).toContain('Location: https://maps.google.com/?q=-33.87,151.21 (±20 m). Battery 54%.');

      const state = await api.get('/v1/device/state', phone.token);
      expect(state.body.activeSos).toEqual({ id, startedAt });
    });

    it('answers the same id again with 200 and sends nothing', async () => {
      const sos = await start();
      const again = await api.post('/v1/device/sos', phone.token, { id: sos.id, startedAt: ago(1) });
      expect(again.status).toBe(200);
      expect(again.body.startedAt).toBe(sos.startedAt);
      expect(sent).toHaveLength(0);
      expect(mails).toHaveLength(0);
      const other = await api.post('/v1/device/sos', otherPhone.token, { id: sos.id, startedAt: ago(1) });
      expect(other.status).toBe(409);
      expect(other.body.error.message).toBe('That SOS id is already used.');
    });

    it('refuses a second SOS while one is on, and SOS on a tablet', async () => {
      await start();
      const second = await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt: ago(1) });
      expect(second.status).toBe(409);
      expect(second.body.error.message).toBe('An SOS is already on.');
      const fromTablet = await api.post('/v1/device/sos', tablet.token, { id: randomUUID(), startedAt: ago(1) });
      expect(fromTablet.status).toBe(409);
      expect(fromTablet.body.error.message).toBe('SOS is only on phones.');
      // Another kid can still raise one.
      expect((await api.post('/v1/device/sos', otherPhone.token, { id: randomUUID(), startedAt: ago(1) })).status).toBe(201);
    });

    it('stores a future start as now, and one from over 2 hours ago as stopped by itself', async () => {
      const before = Date.now();
      const future = await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt: new Date(before + 3_600_000).toISOString() });
      expect(Date.parse(future.body.startedAt)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(future.body.startedAt)).toBeLessThanOrEqual(Date.now() + 1000);
      await db.delete(sosIncidents);

      const startedAt = ago(3 * 3600);
      const old = await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt });
      expect(old.status).toBe(201);
      expect(old.body).toMatchObject({ status: 'ended', endedBy: 'auto', endedAt: old.body.autoStopAt, lastLocation: null });
      expect(mails[0]?.text).toContain('Location: not known yet.');
      expect((await api.get('/v1/device/state', phone.token)).body.activeSos).toBeNull();
      expect((await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt: ago(1) })).status).toBe(201);
    });

    it('refuses bad bodies and unknown devices', async () => {
      expect((await api.post('/v1/device/sos', phone.token, { id: randomUUID() })).status).toBe(422);
      expect((await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt: ago(1), location: { lat: 1 } })).status).toBe(422);
      expect((await api.post('/v1/device/sos', 'not-a-token', { id: randomUUID(), startedAt: ago(1) })).status).toBe(401);
    });
  });

  describe('POST /v1/device/sos/{id}/locations', () => {
    it('stores positions once each and shows the newest as the last location', async () => {
      const sos = await start();
      const [t1, t2, t3] = [ago(90), ago(60), ago(30)];
      const res = await api.post(`/v1/device/sos/${sos.id}/locations`, phone.token, {
        locations: [where(t2, -33.8), where(t1, -33.7), { ...where(t3, -33.9), via: 'sms', accuracyM: null, batteryPct: null }],
      });
      expect(res.status).toBe(204);
      // Sent again: nothing new.
      expect((await api.post(`/v1/device/sos/${sos.id}/locations`, phone.token, { locations: [where(t2, -33.8), where(t2, -33.8)] })).status).toBe(204);
      expect(sent).toHaveLength(0);

      const detail = await api.get(`/v1/sos/${sos.id}`, mum);
      expect(detail.status).toBe(200);
      expect(detail.body.locations.map((l: { lat: number }) => l.lat)).toEqual([-33.7, -33.8, -33.9]);
      expect(detail.body.lastLocation).toEqual({ at: t3, lat: -33.9, lng: 151.21, accuracyM: null, batteryPct: null, via: 'sms' });
    });

    it("refuses another device's SOS and unknown ones", async () => {
      const sos = await start();
      const body = { locations: [where(ago(1))] };
      expect((await api.post(`/v1/device/sos/${sos.id}/locations`, otherPhone.token, body)).status).toBe(404);
      expect((await api.post(`/v1/device/sos/${randomUUID()}/locations`, phone.token, body)).status).toBe(404);
      expect((await api.post(`/v1/device/sos/${sos.id}/locations`, phone.token, { locations: [] })).status).toBe(422);
    });
  });

  describe('ack, extend and end', () => {
    it('"I\'m on it" tells the phone and the parents once per parent', async () => {
      const sos = await start();
      const res = await api.post(`/v1/sos/${sos.id}/ack`, dad, undefined);
      expect(res.status).toBe(200);
      expect(res.body.acks).toEqual([{ parentId: dadId, byName: 'Dad', at: expect.any(String) }]);
      const [toPhone] = sentTo('fcm-phone');
      expect(toPhone?.high).toBe(true);
      expect(toPhone?.msg).toMatchObject({ type: 'sos_ack', data: { sosId: sos.id, byName: 'Dad' } });
      expect(sentTo('fcm-mum')[0]?.msg).toMatchObject({ type: 'sos', data: { kind: 'sos.acked', payload: { sosId: sos.id, byName: 'Dad' } } });
      expect(sentTo('fcm-tablet')).toHaveLength(0);

      sent.length = 0;
      expect((await api.post(`/v1/sos/${sos.id}/ack`, dad, undefined)).status).toBe(200);
      expect(sent).toHaveLength(0);
      const both = await api.post(`/v1/sos/${sos.id}/ack`, mum, undefined);
      expect(both.body.acks.map((a: { byName: string }) => a.byName)).toEqual(['Dad', 'Mum']);
    });

    it('extends by 2 hours and tells the phone', async () => {
      const sos = await start();
      const res = await api.post(`/v1/sos/${sos.id}/extend`, mum, undefined);
      expect(res.status).toBe(200);
      const autoStopAt = new Date(Date.parse(sos.autoStopAt) + 7_200_000).toISOString();
      expect(res.body.autoStopAt).toBe(autoStopAt);
      expect(sentTo('fcm-phone')[0]?.msg).toMatchObject({ type: 'sos_extended', data: { sosId: sos.id, byName: 'Mum', autoStopAt } });
      const [event] = await db.select().from(events).where(eq(events.kind, 'sos.extended'));
      expect(event?.payload).toEqual({ sosId: sos.id, autoStopAt, byName: 'Mum' });
    });

    it('a parent ends it: the phone is told, and only one of two parents ending at once wins', async () => {
      const sos = await start();
      const [first, second] = await Promise.all([
        api.post(`/v1/sos/${sos.id}/end`, mum, undefined),
        api.post(`/v1/sos/${sos.id}/end`, dad, undefined),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const won = first.status === 200 ? first : second;
      const byName = first.status === 200 ? 'Mum' : 'Dad';
      expect(won.body).toMatchObject({ status: 'ended', endedBy: 'parent', endedByName: byName, endedAt: expect.any(String) });
      expect(sentTo('fcm-phone').map((m) => m.msg)).toMatchObject([{ type: 'sos_ended', data: { sosId: sos.id, byName } }]);
      expect(await db.select().from(events).where(eq(events.kind, 'sos.ended'))).toHaveLength(1);
      expect((await api.get('/v1/device/state', phone.token)).body.activeSos).toBeNull();

      for (const action of ['ack', 'extend', 'end']) {
        const late = await api.post(`/v1/sos/${sos.id}/${action}`, mum, undefined);
        expect(late.status).toBe(409);
        expect(late.body.error.message).toBe('This SOS has ended.');
      }
    });

    it('the kid ends it with "I\'m safe", and again is fine', async () => {
      const sos = await start();
      expect((await api.post(`/v1/device/sos/${sos.id}/end`, phone.token)).status).toBe(204);
      expect(sentTo('fcm-mum')[0]?.msg).toMatchObject({ data: { kind: 'sos.ended', payload: { sosId: sos.id, endedBy: 'kid', byName: null } } });
      expect(sentTo('fcm-phone')).toHaveLength(0);
      sent.length = 0;
      expect((await api.post(`/v1/device/sos/${sos.id}/end`, phone.token)).status).toBe(204);
      expect(sent).toHaveLength(0);
      expect((await api.post(`/v1/device/sos/${sos.id}/end`, otherPhone.token)).status).toBe(404);
      const after = await api.get(`/v1/sos/${sos.id}`, mum);
      expect(after.body).toMatchObject({ status: 'ended', endedBy: 'kid', endedByName: null });
    });

    it("refuses another family's SOS and unknown ids", async () => {
      const sos = await start();
      for (const action of ['ack', 'extend', 'end']) {
        expect((await api.post(`/v1/sos/${sos.id}/${action}`, bea, undefined)).status).toBe(404);
      }
      expect((await api.get(`/v1/sos/${sos.id}`, bea)).status).toBe(404);
      expect((await api.get(`/v1/sos/${randomUUID()}`, mum)).status).toBe(404);
      expect((await api.post(`/v1/sos/${sos.id}/ack`, null, undefined)).status).toBe(401);
    });
  });

  describe('GET /v1/sos', () => {
    it('lists newest first, filters by active and kid, own family only', async () => {
      const ended = await start();
      await api.post(`/v1/device/sos/${ended.id}/end`, phone.token);
      const sam = await start(otherPhone);
      const alex = await start();

      const all = await api.get('/v1/sos', mum);
      expect(all.status).toBe(200);
      expect(all.body.map((s: Sos) => s.id)).toEqual([alex.id, sam.id, ended.id]);
      expect((await api.get('/v1/sos?active=true', mum)).body.map((s: Sos) => s.id)).toEqual([alex.id, sam.id]);
      expect((await api.get('/v1/sos?active=false', mum)).body.map((s: Sos) => s.id)).toEqual([ended.id]);
      expect((await api.get(`/v1/sos?kidId=${alexId}&limit=1`, mum)).body.map((s: Sos) => s.id)).toEqual([alex.id]);
      expect((await api.get('/v1/sos', bea)).body).toEqual([]);
      expect((await api.get('/v1/sos?active=yes', mum)).status).toBe(422);
    });
  });
});
```

### 5.8 `server/test/openapi.test.ts`

The same as before, plus one test before the last one: the SOS routes and their auth.

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

  it('describes the tamper upload, behind device auth', () => {
    expect(doc.paths?.['/v1/device/events']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['DeviceEventIn', 'DeviceEventKind', 'DeviceEventUpload']),
    );
  });

  it('describes SOS, each route with the right auth', () => {
    expect(doc.paths?.['/v1/device/sos']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/device/sos/{id}/locations']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/device/sos/{id}/end']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/sos']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/sos/{id}']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/sos/{id}/ack']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/sos/{id}/extend']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/sos/{id}/end']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['Sos', 'SosAck', 'SosDetail', 'SosLocation', 'SosLocationIn', 'SosLocationsUpload', 'SosStart', 'SosStatus']),
    );
  });

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.9 `contract/openapi.json`

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
      "DeviceEventUpload": {
        "type": "object",
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/DeviceEventIn"
            },
            "minItems": 1,
            "maxItems": 50
          }
        },
        "required": [
          "events"
        ]
      },
      "DeviceEventIn": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "kind": {
            "$ref": "#/components/schemas/DeviceEventKind"
          },
          "at": {
            "type": "string",
            "format": "date-time"
          },
          "payload": {
            "type": "object",
            "additionalProperties": {
              "anyOf": [
                {
                  "type": "string",
                  "maxLength": 200
                },
                {
                  "type": "number"
                },
                {
                  "type": "boolean"
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "required": [
          "id",
          "kind",
          "at"
        ]
      },
      "DeviceEventKind": {
        "type": "string",
        "enum": [
          "tamper.clock",
          "tamper.timezone",
          "tamper.tray_killed",
          "tamper.policy",
          "tamper.call_blocked"
        ]
      },
      "Sos": {
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
          "status": {
            "$ref": "#/components/schemas/SosStatus"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "autoStopAt": {
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
          "endedBy": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "kid",
              "parent",
              "auto",
              null
            ]
          },
          "endedByName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastLocation": {
            "$ref": "#/components/schemas/SosLocation"
          },
          "acks": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SosAck"
            }
          }
        },
        "required": [
          "id",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "status",
          "startedAt",
          "autoStopAt",
          "endedAt",
          "endedBy",
          "endedByName",
          "lastLocation",
          "acks"
        ]
      },
      "SosStatus": {
        "type": "string",
        "enum": [
          "active",
          "ended"
        ]
      },
      "SosLocation": {
        "type": [
          "object",
          "null"
        ],
        "properties": {
          "at": {
            "type": "string",
            "format": "date-time"
          },
          "lat": {
            "type": "number"
          },
          "lng": {
            "type": "number"
          },
          "accuracyM": {
            "type": [
              "number",
              "null"
            ]
          },
          "batteryPct": {
            "type": [
              "integer",
              "null"
            ]
          },
          "via": {
            "type": "string",
            "enum": [
              "data",
              "sms"
            ]
          }
        },
        "required": [
          "at",
          "lat",
          "lng",
          "accuracyM",
          "batteryPct",
          "via"
        ]
      },
      "SosAck": {
        "type": "object",
        "properties": {
          "parentId": {
            "type": "string",
            "format": "uuid"
          },
          "byName": {
            "type": "string"
          },
          "at": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "parentId",
          "byName",
          "at"
        ]
      },
      "SosStart": {
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
          "location": {
            "$ref": "#/components/schemas/SosLocationIn"
          }
        },
        "required": [
          "id",
          "startedAt"
        ]
      },
      "SosLocationIn": {
        "type": [
          "object",
          "null"
        ],
        "properties": {
          "at": {
            "type": "string",
            "format": "date-time"
          },
          "lat": {
            "type": "number",
            "minimum": -90,
            "maximum": 90
          },
          "lng": {
            "type": "number",
            "minimum": -180,
            "maximum": 180
          },
          "accuracyM": {
            "type": [
              "number",
              "null"
            ],
            "minimum": 0,
            "maximum": 100000
          },
          "batteryPct": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 100
          },
          "via": {
            "type": "string",
            "enum": [
              "data",
              "sms"
            ]
          }
        },
        "required": [
          "at",
          "lat",
          "lng",
          "via"
        ]
      },
      "SosLocationsUpload": {
        "type": "object",
        "properties": {
          "locations": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SosLocationIn"
            },
            "minItems": 1,
            "maxItems": 100
          }
        },
        "required": [
          "locations"
        ]
      },
      "SosDetail": {
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
          "status": {
            "$ref": "#/components/schemas/SosStatus"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "autoStopAt": {
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
          "endedBy": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "kid",
              "parent",
              "auto",
              null
            ]
          },
          "endedByName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastLocation": {
            "$ref": "#/components/schemas/SosLocation"
          },
          "acks": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SosAck"
            }
          },
          "locations": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SosLocation"
            }
          }
        },
        "required": [
          "id",
          "kidId",
          "kidName",
          "deviceId",
          "deviceName",
          "status",
          "startedAt",
          "autoStopAt",
          "endedAt",
          "endedBy",
          "endedByName",
          "lastLocation",
          "acks",
          "locations"
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
    "/v1/device/events": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Report tamper attempts",
        "description": "Every event is stored in the history. Parents get one push per kind per upload, for the latest one. An `id` that is already stored is skipped, so sending a queue again is safe.",
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
                "$ref": "#/components/schemas/DeviceEventUpload"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Stored."
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
    "/v1/device/sos": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Start an SOS",
        "description": "Phones only. Every parent app gets a critical push and every parent an email. While the kid has an active SOS → 409. Sending the same `id` again returns the stored SOS with 200.",
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
                "$ref": "#/components/schemas/SosStart"
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
                  "$ref": "#/components/schemas/Sos"
                }
              }
            }
          },
          "201": {
            "description": "The parents are being told.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sos"
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
    "/v1/device/sos/{id}/locations": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "Add positions to an SOS",
        "description": "Also after it ended, for positions that were queued. A position with the same `at` as a stored one is skipped.",
        "security": [
          {
            "deviceAuth": []
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
                "$ref": "#/components/schemas/SosLocationsUpload"
              }
            }
          }
        },
        "responses": {
          "204": {
            "description": "Stored."
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
    "/v1/device/sos/{id}/end": {
      "post": {
        "tags": [
          "device"
        ],
        "summary": "\"I'm safe\": end an SOS",
        "description": "An SOS that has already ended is fine too.",
        "security": [
          {
            "deviceAuth": []
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
    "/v1/sos": {
      "get": {
        "tags": [
          "sos"
        ],
        "summary": "SOS alerts",
        "description": "Newest first, archived kids included. `active=true` gives only the ones still on. `limit` defaults to 50.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "enum": [
                "true",
                "false"
              ]
            },
            "required": false,
            "name": "active",
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
            "description": "The SOS alerts.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Sos"
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
    "/v1/sos/{id}": {
      "get": {
        "tags": [
          "sos"
        ],
        "summary": "One SOS with every position",
        "description": "Parent apps read this every 30 seconds while the SOS screen is open.",
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
            "description": "The SOS.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SosDetail"
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
    "/v1/sos/{id}/ack": {
      "post": {
        "tags": [
          "sos"
        ],
        "summary": "\"I'm on it\"",
        "description": "The phone shows \"Dad has seen your SOS\". Tapping it again changes nothing. An SOS that has ended → 409.",
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
            "description": "The SOS.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sos"
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
    "/v1/sos/{id}/extend": {
      "post": {
        "tags": [
          "sos"
        ],
        "summary": "Keep an SOS on for 2 more hours",
        "description": "Moves `autoStopAt` 2 hours later. An SOS that has ended → 409.",
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
            "description": "The SOS.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sos"
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
    "/v1/sos/{id}/end": {
      "post": {
        "tags": [
          "sos"
        ],
        "summary": "End an SOS",
        "description": "An SOS that has already ended → 409.",
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
            "description": "The SOS.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sos"
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

### 6.1 Status

`active` when `ended_at` is null and `auto_stop_at > now()`, else `ended`. For an ended SOS with no `ended_at` (it ran out), the API shows `endedAt` = `autoStopAt` and `endedBy` = `auto`. `lastLocation` is the position with the newest `at`. `acks` are oldest first.

### 6.2 Phone routes

- **`POST /v1/device/sos`** `{ id, startedAt, location? }`. The same id from the same device: **200** with the stored SOS, nothing sent. Another device's id: **409** `That SOS id is already used.` A device whose form is not `phone`: **409** `SOS is only on phones.` The kid already has an active SOS: **409** `An SOS is already on.` Otherwise it stores the SOS with `started_at = least(startedAt, now())` and `auto_stop_at = started_at + 2 hours`, stores `location` if given, and writes the event `sos.started` `{ sosId, startedAt, location }` (`location` is `lastLocation`, or null). After commit: `notifyParents` (critical push to every parent app, muted or not), then an email to every enabled parent (6.4). **201** with the SOS.
- **`POST /v1/device/sos/{id}/locations`** `{ locations }` (1 to 100). Not this device's SOS: **404** `No such SOS on this device.` Positions whose `at` is already stored for this SOS (or repeated in the upload) are skipped. Stored also after the SOS ended. Nothing is pushed. **204**.
- **`POST /v1/device/sos/{id}/end`**. The same 404. If active: `ended_at = now()`, `ended_by_kind = 'kid'`, event `sos.ended` `{ sosId, endedBy: 'kid', byName: null }`, and after commit `notifyParents`. **204**, also when it had already ended.

### 6.3 Parent routes

- **`GET /v1/sos`** `?active=true|false&kidId=&limit=` (limit 1 to 100, default 50): newest first by `startedAt`, archived kids included.
- **`GET /v1/sos/{id}`**: the SOS plus `locations`, oldest first. Not in the family: **404** `No such SOS in your family.`
- **`POST /v1/sos/{id}/ack`**. 404 as above. Ended: **409** `This SOS has ended.` Adds the caller to `sos_acks` (`ON CONFLICT DO NOTHING`). Only when the row is new: event `sos.acked` `{ sosId, byName }`, `notifyParents`, and `sos_ack` `{ sosId, byName }` to the phone. **200** with the SOS.
- **`POST /v1/sos/{id}/extend`**. 404 as above. `UPDATE ... SET auto_stop_at = auto_stop_at + 2 hours WHERE id = $1 AND active`; no row: **409** `This SOS has ended.` Event `sos.extended` `{ sosId, autoStopAt, byName }`, `notifyParents`, and `sos_extended` `{ sosId, byName, autoStopAt }` to the phone. **200**.
- **`POST /v1/sos/{id}/end`**. 404 as above. `UPDATE ... SET ended_at = now(), ended_by_kind = 'parent', ended_by_parent = caller WHERE id = $1 AND active`; no row: **409** `This SOS has ended.` Two parents ending at once: the second waits for the first one's row lock, matches nothing and gets 409. Event `sos.ended` `{ sosId, endedBy: 'parent', byName }`, `notifyParents`, and `sos_ended` `{ sosId, byName }` to the phone. **200**.

Every message to the phone goes to that one device by WebSocket and FCM at **high** priority, FCM time to live 2 hours. Every `sos.*` event goes to every parent app (the parent who acted too); the parent app only rings the alarm for `sos.started`.

### 6.4 The email

To every parent of the family that is not disabled, through `mailer.sendAlert` (skipped when the mailer has none). Subject `SOS from <kid>`. Text, with the time in the family's time zone (`3:04 pm`, `12:30 am`):

```text
Alex pressed SOS at 3:04 pm.
Location: https://maps.google.com/?q=-33.87,151.21 (±20 m). Battery 54%.

Open the ScreenTime app to see where Alex is and to answer.
```

Without a position the second line is `Location: not known yet.`; without accuracy the ` (±20 m)` part is left out; without battery the ` Battery 54%.` part. A failed email is logged and the next parent still gets theirs.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-020-sos
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-020-sos.md` and `server/src/tamper/routes.ts` (CARD-019b) must exist after the pull. If not, you did not pull, or CARD-019b is not merged yet: run `git fetch origin` and `git pull origin main` again, and if `server/src/tamper/routes.ts` is still missing, stop and ask James.
3. Create 5.1 and 5.3, replace 5.2. Run `pnpm --filter @screentime/schemas build` and `pnpm --filter @screentime/schemas test`. Commit: `CARD-020: add SOS schemas`.
4. Replace 5.4 and 5.6, create 5.5. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-020: add SOS routes and the alert email`.
5. Create 5.7, replace 5.8 and 5.9. Run `pnpm contract`, then `git status --short contract` must print nothing. Commit: `CARD-020: add tests and the contract`.
6. Run the acceptance checks in section 8.
7. Push and open the PR (section 10).
8. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
9. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  35 passed (35)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/sos.test.ts (14 tests | 13 skipped)`, `test/openapi.test.ts (13 tests)`, and every other file as before, so `Tests  41 passed | 165 skipped (206)`.
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
  Both runs: `test/sos.test.ts (14 tests)` and `Tests  206 passed (206)`.
- [ ] SOS works on the real stack (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
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
  Then add a kid, enrol a phone, start an SOS with a position, send one more position, say "I'm on it", extend it, count the active ones, end it from the phone, and read it back:
  ```powershell
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  $c = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/enrolment-codes" -Headers $ph -ContentType 'application/json' -Body '{"form":"phone"}'
  $d = Invoke-RestMethod -Method Post http://localhost:8080/v1/enrol -ContentType 'application/json' -Body "{`"code`":`"$($c.code)`",`"platform`":`"android`",`"hasCellular`":true,`"model`":`"Pixel 7`",`"osVersion`":`"Android 14`",`"appVersion`":`"0.1.0`"}"
  $dh = @{ Authorization = "Bearer $($d.deviceToken)" }
  $now = (Get-Date).ToUniversalTime()
  $body = @{ id = "$(New-Guid)"; startedAt = $now.ToString('o'); location = @{ at = $now.ToString('o'); lat = -33.87; lng = 151.21; accuracyM = 20; batteryPct = 54; via = 'data' } } | ConvertTo-Json -Depth 4
  $s = Invoke-RestMethod -Method Post http://localhost:8080/v1/device/sos -Headers $dh -ContentType 'application/json' -Body $body
  "$($s.status) $($s.kidName) $($s.lastLocation.batteryPct)"
  $loc = @{ locations = @(@{ at = $now.AddSeconds(30).ToString('o'); lat = -33.88; lng = 151.22; accuracyM = 10; batteryPct = 53; via = 'data' }) } | ConvertTo-Json -Depth 4
  (Invoke-WebRequest -Method Post "http://localhost:8080/v1/device/sos/$($s.id)/locations" -Headers $dh -ContentType 'application/json' -Body $loc).StatusCode
  $a = Invoke-RestMethod -Method Post "http://localhost:8080/v1/sos/$($s.id)/ack" -Headers $ph
  "$($a.acks.Count) $($a.acks[0].byName) $($a.lastLocation.lat)"
  $e = Invoke-RestMethod -Method Post "http://localhost:8080/v1/sos/$($s.id)/extend" -Headers $ph
  ([datetime]$e.autoStopAt - [datetime]$s.autoStopAt).TotalHours
  (Invoke-RestMethod 'http://localhost:8080/v1/sos?active=true' -Headers $ph).Count
  (Invoke-WebRequest -Method Post "http://localhost:8080/v1/device/sos/$($s.id)/end" -Headers $dh).StatusCode
  $g = Invoke-RestMethod "http://localhost:8080/v1/sos/$($s.id)" -Headers $ph
  "$($g.status) $($g.endedBy) $($g.locations.Count)"
  ```
  The outputs are `active Alex 54`, `204`, `1 Dad -33.88`, `2`, `1`, `204` and `ended kid 2`. Then check the email backup (SMTP is not configured locally, so it is logged):
  ```powershell
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | Select-String "alert for"
  ```
  It prints one line ending in `SMTP not configured: alert for parent@example.com: SOS from Alex`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 9 files (in any order):
  ```
  contract/openapi.json
  packages/schemas/src/index.ts
  packages/schemas/src/sos.ts
  packages/schemas/test/sos.test.ts
  server/src/app.ts
  server/src/mailer.ts
  server/src/sos/routes.ts
  server/test/openapi.test.ts
  server/test/sos.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/sos.test.ts` | A start needs an id and an ISO start time, the location is optional (accuracy and battery may be null); positions need a real latitude and longitude, battery a whole 0 to 100, accuracy not negative, `via` data or sms; an upload has 1 to 100 positions. |
| `server/test/sos.test.ts` | **Email text:** kid, local time (Sydney and Perth), map link, rounded accuracy, battery, and the "not known yet" line. **Start:** active with the right auto stop and last position; a high-priority `sos` push to both parents (also the one who muted SOS), not to a disabled parent, another family or the phone; an email to both enabled parents; shown as `activeSos` in the state; the same id 200 with nothing sent, another device's id 409; a second SOS for the same kid 409, a tablet 409, another kid's phone fine; a future start counts as now; a start over 2 hours ago is ended by `auto` and a new one can start; bad bodies 422, unknown token 401. **Positions:** stored once each (also repeats in one upload), oldest first in the detail, newest as `lastLocation`, nothing pushed; another device's or an unknown SOS 404; empty 422. **Ack, extend, end:** ack tells the phone (`sos_ack`, high) and the parents once per parent, acks oldest first; extend adds 2 hours and tells the phone; two parents ending at once give one 200 and one 409, one `sos.ended`, `sos_ended` to the phone, `activeSos` gone, and ack, extend and end after that are 409; the kid's end pushes `sos.ended` with `endedBy: 'kid'` to parents, not the phone, and again is fine; another family is 404, no token 401. **List:** newest first, `active=true`, `active=false`, by kid with a limit, empty for another family, a bad `active` 422. |
| `server/test/openapi.test.ts` | Adds: the eight routes are in the contract with device or parent auth, and the new schemas are listed. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 5). Message format: `CARD-020: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-020-sos`
5. Open a PR into `main` titled `CARD-020: SOS`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-020-sos --title "CARD-020: SOS" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-020-sos.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract matches; db:generate finds no changes
   - [x] database tests, twice — output: `Tests  206 passed (206)` both times
   - [x] SOS on the real stack — output: `active Alex 54`, `204`, `1 Dad -33.88`, `2`, `1`, `204`, `ended kid 2`, and the alert log line
   - [x] deploy/.env not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 9 files

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

- **`Module '"@screentime/schemas"' has no exported member 'SosStart'`** (or another new name): build the schemas package first (`pnpm --filter @screentime/schemas build`), or 5.2 is not copied exactly.
- **`server/src/tamper/routes.ts` does not exist**, or `registerTamperRoutes` is not found: CARD-019b is not on your `main` yet. Stop and ask James; do not copy 5.6 without it.
- **`pnpm contract` changes `contract/openapi.json`**, or the openapi drift test fails: one of the files in section 5 is not the card's version. Find it with `git diff`; do not commit a contract that differs from 5.9.
- **The email test fails on `±` or shows `Â±`**: the file was not saved as UTF-8. Save it as UTF-8 (without changing anything else) and run it again.
- **The "two parents ending at once" test fails or hangs**: check Docker is running and `TEST_DATABASE_URL` is set; run the tests again once. If it fails twice, report it with its first error lines. Do not change the test.
- **`409` instead of `active Alex 54` on the real stack**: you ran the check twice. Run `docker compose ... down -v` and start the real-stack check again from the top.
- **Blank lines and formatting**: copy them exactly too. In CARD-016 and CARD-018 a changed quote and a deleted blank line were not reported. Every difference from the card, however small, is a deviation: list it under "Deviations".
- **Different test data**: do not change values in the tests (names, tokens, numbers, coordinates, times), even when another value would also pass. If you think one is wrong, say so under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-020. Please review and merge if it is good.

CARD: CARD-020 SOS
PR: <full PR URL>
Branch: bob/card-020-sos
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
