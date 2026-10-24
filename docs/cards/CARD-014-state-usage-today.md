# CARD-014: Device state, usage upload and today

| Field | Value |
|---|---|
| Card | CARD-014 |
| Title | Device state, usage upload and today |
| Size | M |
| Depends on | CARD-003 and CARD-013 (both merged to `main`) |
| Spec sections | docs/SPEC.md §7, §8.1, §8.2, §9.2, §9.3 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-014-state-usage-today` |
| PR title | `CARD-014: Device state, usage upload and today` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`. Request and response shapes are Zod schemas in `packages/schemas` (package `@screentime/schemas`), and `pnpm contract` writes the generated OpenAPI document to `contract/openapi.json`, which is committed; `server/test/openapi.test.ts` fails if it is out of date. Errors always have the shape `{ "error": { "code", "message", "details"? } }`.

What exists already:

- Parents sign in (CARD-011) and manage the family, kids and schedules (CARD-012, CARD-012b). Parent routes use `requireFamilyParent` and run their queries through `withFamily` (`server/src/db/family.ts`), which limits them to one family by row-level security.
- Kid devices enrol and get a device token (CARD-013). Device routes use `requireDevice` (`server/src/devices/auth.ts`).
- The time engine (CARD-003) is the package `packages/engine` (`@screentime/engine`). Its `evaluate(input)` works out, for one kid, one pool and one day, how much time is used and left and whether the pool is locked (SPEC §7). It passes 27 test vectors.
- The tables `grants`, `usage_segments`, `time_requests`, `parent_mode_sessions` and `sos_incidents` exist (CARD-010). No route writes most of them yet; this card only reads them, except `usage_segments`.

This card adds the three routes that make the system work end to end (SPEC §8):

1. **`GET /v1/device/state`** (device token): one snapshot with everything a kid device needs to enforce: its schedule, today's grants, today's usage of every device in its pool, the parents and contacts it may call, and so on. The snapshot has a `stateVersion`, also sent as the `ETag` header. A device that sends `If-None-Match` with the version it has gets `304 Not Modified` with no body when nothing changed.
2. **`POST /v1/device/usage`** (device token): the device uploads its usage segments (from-to times when the screen was on and unlocked). Sending the same segment again is safe.
3. **`GET /v1/today`** (parent): the parent dashboard. For every kid and both pools it runs the engine and returns used time, remaining time, lock state and the devices.

The server now depends on `@screentime/engine`. That is the only package change. No database migration is needed.

## 2. Goal

Kid devices can fetch their state (with ETag and 304) and upload usage, and parents can see used and remaining time per kid and pool worked out by the shared engine. All of it is tested against PostgreSQL 18 in CI, and the OpenAPI contract describes the 3 new operations.

## 3. Out of scope

Do **not** do any of these in this card:

- No grants routes (CARD-015), no push notifications or `overspend` events (CARD-016), no WebSocket (CARD-017), no time requests, messages, parent mode or SOS routes. The snapshot only **reads** those tables.
- No Android or Windows app code.
- No new npm packages from the internet. The only package change is the workspace link to `@screentime/engine` in `server/package.json` (5.5), and the 3 lines `pnpm install` adds to `pnpm-lock.yaml` for it (5.12).
- No database migration. Do not change `server/src/db/schema.ts` or anything in `server/drizzle/`.
- Do not change `packages/engine` or `test-vectors/`.
- Do not change any file that is not listed in section 5. In particular, leave `server/src/devices/`, `server/src/auth/`, `server/src/family/`, `server/src/admin/`, `server/src/db/`, `server/src/openapi.ts`, `server/test/helpers.ts` and the other existing tests as they are.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key, a device token or any other secret.

## 4. Tech and versions

Nothing new from the internet. Everything is unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, Zod ^4.6, hono ^4.13.13, @hono/zod-openapi ^1.6.3, drizzle-orm ^0.45.4, PostgreSQL 18. New: the server uses the workspace package `@screentime/engine` (`"workspace:*"`), which already uses luxon ^3.7.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character. Some test names contain an apostrophe and so use double quotes (`it("never changes another device's segment", ...)`): keep them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/sync.ts` | create (5.1) |
| `packages/schemas/src/index.ts` | replace (5.2) |
| `packages/schemas/test/sync.test.ts` | create (5.3) |
| `server/src/kids/routes.ts` | replace (5.4) |
| `server/package.json` | replace (5.5) |
| `server/src/sync/day.ts` | create (5.6) |
| `server/src/sync/routes.ts` | create (5.7) |
| `server/src/app.ts` | replace (5.8) |
| `server/test/sync.test.ts` | create (5.9) |
| `server/test/openapi.test.ts` | replace (5.10) |
| `contract/openapi.json` | **generated** by `pnpm contract` (5.11) |
| `pnpm-lock.yaml` | **updated** by `pnpm install` (5.12) |

That is 12 files.

### 5.1 `packages/schemas/src/sync.ts`

The shapes of the snapshot, the usage upload and the dashboard. Times the server sends are UTC (`...Z`); times a device sends may have an offset.

```typescript
import { z } from 'zod';
import { DeviceForm, Pool } from './devices.js';
import { AvatarColor, Schedule } from './kids.js';

/** Why a pool is locked (docs/SPEC.md §7.3). */
export const LockReason = z.enum(['out_of_time', 'bedtime', 'before_wake']).meta({ id: 'LockReason' });
export type LockReason = z.infer<typeof LockReason>;

/** A grant as devices see it. `minutes` is negative for a removal or "lock now". */
export const StateGrant = z
  .object({
    id: z.uuid(),
    minutes: z.int(),
    createdAt: z.iso.datetime(),
    byName: z.string(),
  })
  .meta({ id: 'StateGrant' });

export type StateGrant = z.infer<typeof StateGrant>;

/**
 * A usage segment of any device in the pool. `endedAt` null means still in use. An open segment of a
 * device that has not been heard from for 10 minutes is shown as ending when it was last seen.
 */
export const PoolSegment = z
  .object({
    id: z.uuid(),
    deviceId: z.uuid(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'PoolSegment' });

export type PoolSegment = z.infer<typeof PoolSegment>;

/** GET /v1/device/state: everything a kid device needs to enforce today and the rest of the week (docs/SPEC.md §8.2). */
export const DeviceState = z
  .object({
    serverTime: z.iso.datetime(),
    /** Changes whenever anything below changes. Also sent as the ETag. */
    stateVersion: z.string(),
    device: z.object({
      id: z.uuid(),
      name: z.string(),
      form: DeviceForm,
      pool: Pool,
      hasCellular: z.boolean(),
    }),
    kid: z.object({ id: z.uuid(), name: z.string() }),
    family: z.object({ timezone: z.string(), emergencyNumber: z.string(), parentCodeSecret: z.string() }),
    /** Every parent of the family, oldest first. Only those with a phone number can be called. */
    parents: z.array(z.object({ id: z.uuid(), displayName: z.string(), phoneE164: z.string().nullable() })),
    contacts: z.array(z.object({ label: z.string(), phoneE164: z.string() })),
    messagePresets: z.array(z.object({ id: z.uuid(), text: z.string() })),
    schedule: Schedule,
    today: z.object({
      /** The family's local date, YYYY-MM-DD. */
      date: z.string(),
      /** Grants for this kid and this device's pool today, oldest first. */
      grants: z.array(StateGrant),
      /** Segments of every device in this pool (this one too) that overlap today, oldest first. */
      poolSegments: z.array(PoolSegment),
    }),
    parentMode: z.object({
      active: z.boolean(),
      endsAt: z.iso.datetime().nullable(),
      byName: z.string().nullable(),
    }),
    /** The kid's pending "ask for more time" for this pool today, if any. */
    pendingRequest: z.object({ id: z.uuid(), minutes: z.int(), createdAt: z.iso.datetime() }).nullable(),
    activeSos: z.object({ id: z.uuid(), startedAt: z.iso.datetime() }).nullable(),
  })
  .meta({ id: 'DeviceState' });

export type DeviceState = z.infer<typeof DeviceState>;

/** One usage segment as a device sends it. The device makes the id, so sending it again is safe. */
export const UsageSegmentIn = z
  .object({
    id: z.uuid(),
    startedAt: z.iso.datetime({ offset: true }),
    /** null while the segment is still open. Send it again with the end time when it closes. */
    endedAt: z.iso.datetime({ offset: true }).nullable(),
    /** The device had no contact with the server while recording. */
    recordedOffline: z.boolean(),
  })
  .refine((s) => s.endedAt === null || Date.parse(s.endedAt) >= Date.parse(s.startedAt), {
    message: 'endedAt must not be before startedAt.',
    path: ['endedAt'],
  })
  .meta({ id: 'UsageSegmentIn' });

export type UsageSegmentIn = z.infer<typeof UsageSegmentIn>;

/** Body of POST /v1/device/usage. */
export const UsageUpload = z
  .object({ segments: z.array(UsageSegmentIn).min(1).max(500) })
  .meta({ id: 'UsageUpload' });

export type UsageUpload = z.infer<typeof UsageUpload>;

export const UsageReceipt = z
  .object({
    /** Segments stored or updated. A segment id that belongs to another device is ignored. */
    received: z.int(),
  })
  .meta({ id: 'UsageReceipt' });

export type UsageReceipt = z.infer<typeof UsageReceipt>;

/** A device on the parent dashboard. */
export const TodayDevice = z
  .object({
    id: z.uuid(),
    name: z.string(),
    form: DeviceForm,
    /** The device has an open usage segment. */
    inUse: z.boolean(),
    lastSeenAt: z.iso.datetime().nullable(),
    /** Set while parent mode is on for this device. `endsAt` null means until a parent ends it. */
    parentMode: z.object({ endsAt: z.iso.datetime().nullable(), byName: z.string().nullable() }).nullable(),
  })
  .meta({ id: 'TodayDevice' });

export type TodayDevice = z.infer<typeof TodayDevice>;

/** One pool of one kid today, worked out by the time engine (docs/SPEC.md §7). */
export const TodayPool = z
  .object({
    pool: Pool,
    /** Today's allowance from the schedule. */
    allowanceMin: z.int(),
    /** Sum of today's grants; negative when more was taken away than added. */
    grantedMin: z.int(),
    usedSec: z.int(),
    remainingSec: z.int(),
    locked: z.boolean(),
    lockReason: LockReason.nullable(),
    nextLockAt: z.iso.datetime().nullable(),
    overspendSec: z.int(),
    /** The kid's devices in this pool, oldest first. */
    devices: z.array(TodayDevice),
  })
  .meta({ id: 'TodayPool' });

export type TodayPool = z.infer<typeof TodayPool>;

export const TodayKid = z
  .object({
    id: z.uuid(),
    name: z.string(),
    avatarColor: AvatarColor,
    /** Always both pools, Screens first. */
    pools: z.array(TodayPool),
  })
  .meta({ id: 'TodayKid' });

export type TodayKid = z.infer<typeof TodayKid>;

/** GET /v1/today: the parent dashboard. */
export const Today = z
  .object({
    serverTime: z.iso.datetime(),
    /** The family's local date, YYYY-MM-DD. */
    date: z.string(),
    /** Kids oldest first; archived kids are left out. */
    kids: z.array(TodayKid),
  })
  .meta({ id: 'Today' });

export type Today = z.infer<typeof Today>;
```

### 5.2 `packages/schemas/src/index.ts`

The same as on `main`, plus the export block for `./sync.js` at the end.

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
```

### 5.3 `packages/schemas/test/sync.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { UsageUpload } from '../src/index.js';

const segment = {
  id: '01960000-0000-7000-8000-000000000001',
  startedAt: '2026-10-22T09:00:00+11:00',
  endedAt: '2026-10-22T09:30:00+11:00',
  recordedOffline: false,
};

describe('usage schemas', () => {
  it('takes closed and open segments, with or without an offset', () => {
    expect(UsageUpload.safeParse({ segments: [segment] }).success).toBe(true);
    expect(UsageUpload.safeParse({ segments: [{ ...segment, endedAt: null }] }).success).toBe(true);
    expect(UsageUpload.safeParse({ segments: [{ ...segment, startedAt: '2026-10-21T22:00:00Z' }] }).success).toBe(true);
  });

  it('refuses a segment that ends before it starts', () => {
    expect(UsageUpload.safeParse({ segments: [{ ...segment, endedAt: '2026-10-22T08:59:59+11:00' }] }).success).toBe(false);
  });

  it('takes 1 to 500 segments', () => {
    expect(UsageUpload.safeParse({ segments: [] }).success).toBe(false);
    expect(UsageUpload.safeParse({ segments: Array(500).fill(segment) }).success).toBe(true);
    expect(UsageUpload.safeParse({ segments: Array(501).fill(segment) }).success).toBe(false);
  });
});
```

### 5.4 `server/src/kids/routes.ts`

The only change from `main` is one word: `function toSchedule(` becomes `export function toSchedule(` (line 31), so the snapshot can reuse it. Replace the file with this:

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
    return c.json(toKid(row), 200);
  });

  app.openapi(archiveKidRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    await withFamily(db, familyId, async (tx) => {
      const [archived] = await tx
        .update(kids)
        .set({ archivedAt: sql`now()` })
        .where(and(eq(kids.id, kidId), isNull(kids.archivedAt)))
        .returning({ id: kids.id });
      if (!archived) throw kidNotFound();
      await tx
        .update(devices)
        .set({ revokedAt: sql`now()`, fcmToken: null })
        .where(and(eq(devices.kidId, kidId), isNull(devices.revokedAt)));
    });
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
    return c.json(rows.map(({ id, label, phoneE164 }) => ({ id, label, phoneE164 })), 200);
  });
}
```

### 5.5 `server/package.json`

One new line under `dependencies`: `"@screentime/engine": "workspace:*",` (above `@screentime/schemas`).

```json
{
  "name": "@screentime/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "contract": "tsx scripts/export-openapi.ts"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.0",
    "@hono/zod-openapi": "^1.6.3",
    "@screentime/engine": "workspace:*",
    "@screentime/schemas": "workspace:*",
    "drizzle-orm": "^0.45.4",
    "hono": "^4.13.13",
    "nodemailer": "^10.2.1",
    "pg": "^8.23.1",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/pg": "^8.23.1",
    "drizzle-kit": "^0.31.11",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

### 5.6 `server/src/sync/day.ts`

Shared helpers: today's date and its start and end in the family time zone (worked out by PostgreSQL, which handles daylight saving), today's segments and grants, active parent-mode sessions, and the call into the engine.

```typescript
import { and, asc, eq, gt, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { evaluate, type EngineResult } from '@screentime/engine';
import type { Pool, Schedule } from '@screentime/schemas';
import type { FamilyTx } from '../db/family.js';
import { devices, grants, parentModeSessions, parents, usageSegments } from '../db/schema.js';

/** Today in the family's time zone (docs/SPEC.md §7.2). */
export interface FamilyDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Local midnight at the start and end of `date`, as instants. Daylight saving is handled by PostgreSQL. */
  dayStart: Date;
  dayEnd: Date;
  /** The database clock. Every request uses this one clock, so the date and the engine agree. */
  now: Date;
}

/** An open segment counts as still running only while its device keeps in touch (docs/SPEC.md §8.2). */
const OPEN_SEGMENT_STALE = sql`interval '10 minutes'`;

export async function familyDay(tx: FamilyTx, timezone: string): Promise<FamilyDay> {
  const result = await tx.execute<{ date: string; day_start: string; day_end: string; now: string }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as date,
           to_json(d.day::timestamp at time zone ${timezone}) #>> '{}' as day_start,
           to_json((d.day + 1)::timestamp at time zone ${timezone}) #>> '{}' as day_end,
           to_json(now()) #>> '{}' as now
    from (select (now() at time zone ${timezone})::date as day) d
  `);
  const row = result.rows[0];
  if (!row) throw new Error('familyDay returned nothing');
  return { date: row.date, dayStart: new Date(row.day_start), dayEnd: new Date(row.day_end), now: new Date(row.now) };
}

export interface DaySegment {
  id: string;
  kidId: string;
  deviceId: string;
  pool: Pool;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * Usage segments that overlap `day`, oldest first, with `where` added. An open segment whose device has
 * not been seen for 10 minutes ends when the device was last seen, so a phone that died mid-use does not
 * keep using up the pool.
 */
export async function daySegments(tx: FamilyTx, day: FamilyDay, where?: SQL): Promise<DaySegment[]> {
  const endedAt = sql`coalesce(${usageSegments.endedAt}, case when ${devices.lastSeenAt} < now() - ${OPEN_SEGMENT_STALE} then greatest(${devices.lastSeenAt}, ${usageSegments.startedAt}) end)`;
  const rows = await tx
    .select({
      id: usageSegments.id,
      kidId: usageSegments.kidId,
      deviceId: usageSegments.deviceId,
      pool: usageSegments.pool,
      startedAt: usageSegments.startedAt,
      endedAt: endedAt.mapWith(usageSegments.endedAt),
    })
    .from(usageSegments)
    .innerJoin(devices, eq(devices.id, usageSegments.deviceId))
    .where(
      and(
        lt(usageSegments.startedAt, day.dayEnd),
        or(sql`${endedAt} is null`, sql`${endedAt} > ${day.dayStart.toISOString()}::timestamptz`),
        where,
      ),
    )
    .orderBy(asc(usageSegments.startedAt), asc(usageSegments.id));
  return rows.map((r) => ({ ...r, pool: r.pool as Pool }));
}

export interface DayGrant {
  id: string;
  kidId: string;
  pool: Pool;
  minutes: number;
  createdAt: Date;
  byName: string;
}

/** Grants of `day`, oldest first, with `where` added. */
export async function dayGrants(tx: FamilyTx, day: FamilyDay, where?: SQL): Promise<DayGrant[]> {
  const rows = await tx
    .select({
      id: grants.id,
      kidId: grants.kidId,
      pool: grants.pool,
      minutes: grants.minutes,
      createdAt: grants.createdAt,
      byName: parents.displayName,
    })
    .from(grants)
    .innerJoin(parents, eq(parents.id, grants.createdBy))
    .where(and(eq(grants.day, day.date), where))
    .orderBy(asc(grants.createdAt), asc(grants.id));
  return rows.map((r) => ({ ...r, pool: r.pool as Pool }));
}

export interface ActiveParentMode {
  deviceId: string;
  endsAt: Date | null;
  byName: string | null;
}

/** Parent-mode sessions that are on right now, with `where` added. */
export async function activeParentModes(tx: FamilyTx, where?: SQL): Promise<ActiveParentMode[]> {
  return tx
    .select({ deviceId: parentModeSessions.deviceId, endsAt: parentModeSessions.endsAt, byName: parents.displayName })
    .from(parentModeSessions)
    .leftJoin(parents, eq(parents.id, parentModeSessions.approvedBy))
    .where(
      and(
        isNotNull(parentModeSessions.startedAt),
        isNull(parentModeSessions.endedAt),
        or(isNull(parentModeSessions.endsAt), gt(parentModeSessions.endsAt, sql`now()`)),
        where,
      ),
    )
    .orderBy(asc(parentModeSessions.startedAt));
}

/** The schedule entry for the weekday of `date` (ISO weekday, 1 = Monday). */
export function scheduleDay(schedule: Schedule, date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  const day = schedule.days.find((d) => d.weekday === weekday);
  if (!day) throw new Error(`schedule version ${schedule.version} has no weekday ${weekday}`);
  return day;
}

/** Runs the time engine for one kid and one pool today. Pass only that kid's grants and segments for that pool. */
export function poolStatus(
  timezone: string,
  day: FamilyDay,
  schedule: Schedule,
  pool: Pool,
  poolGrants: DayGrant[],
  poolSegments: DaySegment[],
): EngineResult & { allowanceMin: number } {
  const entry = scheduleDay(schedule, day.date);
  const allowanceMin = pool === 'screens' ? entry.screensMin : entry.phoneMin;
  const result = evaluate({
    tz: timezone,
    date: day.date,
    now: day.now.toISOString(),
    day: { allowanceMin, wake: entry.wake, bedtime: entry.bedtime },
    grants: poolGrants.map((g) => ({ minutes: g.minutes, createdAt: g.createdAt.toISOString() })),
    segments: poolSegments.map((s) => ({ start: s.startedAt.toISOString(), end: s.endedAt?.toISOString() ?? null })),
  });
  return { ...result, allowanceMin };
}
```

### 5.7 `server/src/sync/routes.ts`

The three routes.

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
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { activeParentModes, dayGrants, daySegments, familyDay, poolStatus } from './day.js';

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
      return tx
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
    });
    return c.json({ received: stored.length }, 200);
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

### 5.8 `server/src/app.ts`

The same as on `main`, plus the import of `registerSyncRoutes` and the call `registerSyncRoutes(app, deps);` after `registerDeviceRoutes(app, deps);`.

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
import { registerKidRoutes } from './kids/routes.js';
import type { Mailer } from './mailer.js';
import { createRouter } from './router.js';
import { registerSyncRoutes } from './sync/routes.js';

/** What the routes need at request time. Tests pass their own. */
export interface AppDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
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
  registerAdminRoutes(app, deps);

  return app;
}

/** The OpenAPI 3.1 document for every route (written to contract/openapi.json). */
export function openApiDocument(): ReturnType<ReturnType<typeof createApp>['getOpenAPI31Document']> {
  // Building the document never runs a handler, so the routes need no real database, settings or mailer.
  const app = createApp({} as AppDeps);
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'Screen Time API', version: '0.1.0' },
  });
}
```

### 5.9 `server/test/sync.test.ts`

Database tests for the three routes. They give family A a fixed-offset time zone where it is about midday whenever the tests run (`middayZone()`), and a schedule with no curfew, so the results never depend on the hour or the weekday.

```typescript
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
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
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/**
 * A fixed-offset zone where it is about midday right now, so the times these tests use (at most two
 * hours either side of now) never cross local midnight, whenever the tests run.
 */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

const zone = middayZone();
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
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

describe.skipIf(!url)('sync routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const deps = { db, config: testConfig(url ?? ''), mailer };
  const api = client(deps);
  const app = createApp(deps);

  let familyA = '';
  let familyB = '';
  let mumId = '';
  let mum = '';
  let bea = '';

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'phone' | 'tablet' | 'pc', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: form === 'pc' ? 'windows' : 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        hasCellular: form === 'phone',
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function getState(token: string | null, ifNoneMatch?: string) {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
    const res = await app.request('/v1/device/state', { headers });
    const text = await res.text();
    return { status: res.status, etag: res.headers.get('etag'), body: text ? JSON.parse(text) : null };
  }

  const segment = (startMin: number, endMin: number | null, recordedOffline = false) => ({
    id: randomUUID(),
    startedAt: at(startMin),
    endedAt: endMin === null ? null : at(endMin),
    recordedOffline,
  });

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
    const [p1, , p3] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum', phoneE164: '+61400000001' },
        { familyId: familyA, email: 'old@example.com', displayName: 'Old', disabledAt: new Date() },
        { familyId: familyB, email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mumId = p1?.id ?? '';
    mum = await tokenFor({ parentId: mumId, familyId: familyA });
    bea = await tokenFor({ parentId: p3?.id ?? '', familyId: familyB });
    await db.insert(messagePresets).values([
      { familyId: familyA, text: 'Can I have more time?', sort: 0 },
      { familyId: familyB, text: 'Family B preset', sort: 0 },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('GET /v1/device/state', () => {
    it('needs a device token', async () => {
      expect((await getState(null)).status).toBe(401);
      expect((await getState('not-a-token')).status).toBe(401);
      expect((await api.get('/v1/device/state', mum)).status).toBe(401);
    });

    it('returns the whole snapshot with the version as the ETag', async () => {
      const kidId = await addKid(familyA, 'Alex');
      await db.insert(kidContacts).values({ familyId: familyA, kidId, label: 'Grandma', phoneE164: '+61400000009' });
      const phone = await addDevice(familyA, kidId, 'phone', 'Pixel 7');
      const res = await getState(phone.token);
      expect(res.status).toBe(200);
      expect(res.etag).toBe(`"${res.body.stateVersion}"`);
      expect(res.body.stateVersion).toMatch(/^[0-9a-f]{32}$/);
      expect(Math.abs(Date.parse(res.body.serverTime) - Date.now())).toBeLessThan(60_000);
      expect(res.body).toMatchObject({
        device: { id: phone.id, name: 'Pixel 7', form: 'phone', pool: 'phone', hasCellular: true },
        kid: { id: kidId, name: 'Alex' },
        family: { timezone: zone, emergencyNumber: '000', parentCodeSecret: 'A'.repeat(32) },
        parents: [{ id: mumId, displayName: 'Mum', phoneE164: '+61400000001' }],
        contacts: [{ label: 'Grandma', phoneE164: '+61400000009' }],
        messagePresets: [{ id: expect.any(String), text: 'Can I have more time?' }],
        schedule: { version: 1, warn1Min: 15, warn2Min: 5, days: flatWeek },
        today: { date: localDate(), grants: [], poolSegments: [] },
        parentMode: { active: false, endsAt: null, byName: null },
        pendingRequest: null,
        activeSos: null,
      });
    });

    it('answers 304 while nothing changed, and a new version once something does', async () => {
      const kidId = await addKid(familyA, 'Casey');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'XPPen');
      const first = await getState(tablet.token);
      const tag = first.etag ?? '';

      const same = await getState(tablet.token, tag);
      expect(same.status).toBe(304);
      expect(same.body).toBeNull();
      expect(same.etag).toBe(tag);
      // Cloudflare may weaken the tag when it compresses the response.
      expect((await getState(tablet.token, `W/${tag}`)).status).toBe(304);
      expect((await getState(tablet.token, `"other", ${tag}`)).status).toBe(304);

      await db.insert(grants).values({ id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 15, day: localDate(), createdBy: mumId });
      const changed = await getState(tablet.token, tag);
      expect(changed.status).toBe(200);
      expect(changed.body.stateVersion).not.toBe(first.body.stateVersion);
      expect(changed.body.today.grants).toEqual([
        { id: expect.any(String), minutes: 15, createdAt: expect.any(String), byName: 'Mum' },
      ]);
    });

    it("shows today's grants and segments of this device's pool only", async () => {
      const kidId = await addKid(familyA, 'Drew');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const pc = await addDevice(familyA, kidId, 'pc', 'PC');
      const phone = await addDevice(familyA, kidId, 'phone', 'Phone');
      const otherKid = await addKid(familyA, 'Other');
      const otherTablet = await addDevice(familyA, otherKid, 'tablet', 'Other tablet');
      await db.insert(grants).values([
        { id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 30, day: localDate(), createdBy: mumId },
        { id: randomUUID(), familyId: familyA, kidId, pool: 'phone', minutes: 15, day: localDate(), createdBy: mumId },
        { id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 60, day: '2020-01-01', createdBy: mumId },
      ]);
      expect((await api.post('/v1/device/usage', pc.token, { segments: [segment(-60, -30)] })).body).toEqual({ received: 1 });
      expect((await api.post('/v1/device/usage', phone.token, { segments: [segment(-20, -10)] })).status).toBe(200);
      expect((await api.post('/v1/device/usage', otherTablet.token, { segments: [segment(-20, -10)] })).status).toBe(200);
      // Yesterday's segment is left out.
      await db.insert(usageSegments).values({
        id: randomUUID(),
        familyId: familyA,
        kidId,
        deviceId: pc.id,
        pool: 'screens',
        startedAt: new Date(Date.now() - 30 * 3600_000),
        endedAt: new Date(Date.now() - 29 * 3600_000),
      });

      const res = await getState(tablet.token);
      expect(res.body.today.grants.map((g: { minutes: number }) => g.minutes)).toEqual([30]);
      expect(res.body.today.poolSegments).toEqual([
        { id: expect.any(String), deviceId: pc.id, startedAt: expect.any(String), endedAt: expect.any(String) },
      ]);
    });

    it('shows an open segment as ending when its device was last seen, once that is 10 minutes ago', async () => {
      const kidId = await addKid(familyA, 'Eli');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const pc = await addDevice(familyA, kidId, 'pc', 'PC');
      await api.post('/v1/device/usage', pc.token, { segments: [segment(-30, null)] });
      expect((await getState(tablet.token)).body.today.poolSegments[0].endedAt).toBeNull();

      const lastSeen = new Date(Date.now() - 20 * 60_000);
      await db.update(devices).set({ lastSeenAt: lastSeen }).where(eq(devices.id, pc.id));
      expect((await getState(tablet.token)).body.today.poolSegments[0].endedAt).toBe(lastSeen.toISOString());
    });

    it('shows parent mode, a pending request and an active SOS', async () => {
      const kidId = await addKid(familyA, 'Finn');
      const phone = await addDevice(familyA, kidId, 'phone', 'Phone');
      const endsAt = new Date(Date.now() + 15 * 60_000);
      await db.insert(parentModeSessions).values({
        familyId: familyA,
        kidId,
        deviceId: phone.id,
        method: 'remote',
        approvedBy: mumId,
        durationMin: 15,
        startedAt: new Date(),
        endsAt,
      });
      const requestId = randomUUID();
      await db.insert(timeRequests).values({ id: requestId, familyId: familyA, kidId, deviceId: phone.id, pool: 'phone', minutes: 30 });
      const sosId = randomUUID();
      await db.insert(sosIncidents).values({
        id: sosId,
        familyId: familyA,
        kidId,
        deviceId: phone.id,
        startedAt: new Date(),
        autoStopAt: new Date(Date.now() + 2 * 3600_000),
      });

      const res = await getState(phone.token);
      expect(res.body.parentMode).toEqual({ active: true, endsAt: endsAt.toISOString(), byName: 'Mum' });
      expect(res.body.pendingRequest).toEqual({ id: requestId, minutes: 30, createdAt: expect.any(String) });
      expect(res.body.activeSos).toEqual({ id: sosId, startedAt: expect.any(String) });

      await db.update(parentModeSessions).set({ endedAt: new Date() }).where(eq(parentModeSessions.deviceId, phone.id));
      expect((await getState(phone.token)).body.parentMode).toEqual({ active: false, endsAt: null, byName: null });
    });
  });

  describe('POST /v1/device/usage', () => {
    it('stores segments and keeps the first start and the latest end when one is sent again', async () => {
      const kidId = await addKid(familyA, 'Gus');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const open = segment(-30, null);
      const closed = segment(-60, -40, true);
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [open, closed] })).body).toEqual({ received: 2 });

      // Closing the open one, with a different start that must be ignored.
      await api.post('/v1/device/usage', tablet.token, { segments: [{ ...open, startedAt: at(-25), endedAt: at(-5) }] });
      // An open copy or an earlier end never shortens or reopens a closed segment; offline stays flagged.
      await api.post('/v1/device/usage', tablet.token, {
        segments: [
          { ...closed, endedAt: null, recordedOffline: false },
          { ...closed, endedAt: at(-50), recordedOffline: false },
        ],
      });

      const rows = await db.select().from(usageSegments).where(eq(usageSegments.deviceId, tablet.id));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(open.id)).toMatchObject({ kidId, pool: 'screens', startedAt: new Date(open.startedAt), recordedOffline: false });
      expect(byId.get(open.id)?.endedAt?.getTime()).toBeGreaterThan(Date.parse(at(-6)));
      expect(byId.get(closed.id)).toMatchObject({ endedAt: new Date(closed.endedAt ?? ''), recordedOffline: true });
    });

    it('joins repeats of one id in a single upload', async () => {
      const kidId = await addKid(familyA, 'Hana');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const s = segment(-30, null);
      const end = at(-10);
      const res = await api.post('/v1/device/usage', tablet.token, { segments: [s, { ...s, endedAt: end }, s] });
      expect(res.body).toEqual({ received: 1 });
      const [row] = await db.select().from(usageSegments).where(eq(usageSegments.id, s.id));
      expect(row?.endedAt).toEqual(new Date(end));
    });

    it("never changes another device's segment", async () => {
      const kidId = await addKid(familyA, 'Ivy');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const pc = await addDevice(familyA, kidId, 'pc', 'PC');
      const s = segment(-30, null);
      await api.post('/v1/device/usage', tablet.token, { segments: [s] });
      const res = await api.post('/v1/device/usage', pc.token, { segments: [{ ...s, endedAt: at(-1) }] });
      expect(res.body).toEqual({ received: 0 });
      const [row] = await db.select().from(usageSegments).where(eq(usageSegments.id, s.id));
      expect(row).toMatchObject({ deviceId: tablet.id, endedAt: null });
    });

    it('needs a device token and valid segments', async () => {
      const kidId = await addKid(familyA, 'Jo');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      expect((await api.post('/v1/device/usage', null, { segments: [segment(-2, -1)] })).status).toBe(401);
      expect((await api.post('/v1/device/usage', mum, { segments: [segment(-2, -1)] })).status).toBe(401);
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [] })).status).toBe(422);
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [segment(-1, -2)] })).status).toBe(422);
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [{ ...segment(-2, -1), id: 'x' }] })).status).toBe(422);
    });
  });

  describe('GET /v1/today', () => {
    it('works out used and remaining time per kid and pool with the engine', async () => {
      const kidId = await addKid(familyA, 'Kai');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const pc = await addDevice(familyA, kidId, 'pc', 'PC');
      const phone = await addDevice(familyA, kidId, 'phone', 'Phone');
      const gone = await addDevice(familyA, kidId, 'tablet', 'Old tablet');
      await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, gone.id));
      // Screens: 20 min on the tablet and 20 min on the PC, 10 of them at the same time: 30 min used.
      await api.post('/v1/device/usage', tablet.token, { segments: [segment(-60, -40)] });
      await api.post('/v1/device/usage', pc.token, { segments: [segment(-50, -30)] });
      // Phone: in use for 5 minutes after Mum took all 60 minutes away.
      await api.post('/v1/device/usage', phone.token, { segments: [segment(-5, null)] });
      await db.insert(grants).values([
        { id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 15, day: localDate(), createdBy: mumId },
        { id: randomUUID(), familyId: familyA, kidId, pool: 'phone', minutes: -60, day: localDate(), createdBy: mumId },
      ]);

      const res = await api.get('/v1/today', mum);
      expect(res.status).toBe(200);
      expect(res.body.date).toBe(localDate());
      const kai = res.body.kids.find((k: { id: string }) => k.id === kidId);
      expect(kai.name).toBe('Kai');
      expect(kai.pools.map((p: { pool: string }) => p.pool)).toEqual(['screens', 'phone']);

      const [screens, phonePool] = kai.pools;
      expect(screens).toMatchObject({
        allowanceMin: 120,
        grantedMin: 15,
        usedSec: 1800,
        remainingSec: (120 + 15) * 60 - 1800,
        locked: false,
        lockReason: null,
        overspendSec: 0,
      });
      expect(screens.nextLockAt).toBe(new Date(Date.parse(res.body.serverTime) + screens.remainingSec * 1000).toISOString());
      expect(screens.devices).toEqual([
        { id: tablet.id, name: 'Tablet', form: 'tablet', inUse: false, lastSeenAt: expect.any(String), parentMode: null },
        { id: pc.id, name: 'PC', form: 'pc', inUse: false, lastSeenAt: expect.any(String), parentMode: null },
      ]);

      expect(phonePool).toMatchObject({ allowanceMin: 60, grantedMin: -60, remainingSec: 0, locked: true, lockReason: 'out_of_time', nextLockAt: null });
      expect(phonePool.usedSec).toBeGreaterThanOrEqual(300);
      expect(phonePool.usedSec).toBeLessThan(330);
      expect(phonePool.overspendSec).toBe(phonePool.usedSec);
      expect(phonePool.devices).toEqual([
        { id: phone.id, name: 'Phone', form: 'phone', inUse: true, lastSeenAt: expect.any(String), parentMode: null },
      ]);
    });

    it("lists only the caller's family, without archived kids", async () => {
      const archived = await addKid(familyA, 'Archived');
      await db.update(kids).set({ archivedAt: new Date() }).where(eq(kids.id, archived));
      const ben = await addKid(familyB, 'Ben');
      const mine = (await api.get('/v1/today', mum)).body.kids.map((k: { id: string }) => k.id);
      expect(mine).not.toContain(archived);
      expect(mine).not.toContain(ben);
      const theirs = await api.get('/v1/today', bea);
      expect(theirs.body.kids.map((k: { id: string }) => k.id)).toEqual([ben]);
      expect(theirs.body.kids[0].pools[0]).toMatchObject({ usedSec: 0, remainingSec: expect.any(Number), devices: [] });
    });

    it('needs a parent of a family', async () => {
      expect((await api.get('/v1/today', null)).status).toBe(401);
      const admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
      expect((await api.get('/v1/today', admin)).status).toBe(403);
    });
  });
});
```

### 5.10 `server/test/openapi.test.ts`

The same as on `main`, plus the test `describes the state snapshot, usage upload and the dashboard` before the last test.

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

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.11 `contract/openapi.json` (generated)

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

### 5.12 `pnpm-lock.yaml` (updated by pnpm)

Do **not** edit this by hand. After replacing `server/package.json` (5.5), run from the repo root:

```powershell
pnpm install
```

(Not `--frozen-lockfile` this one time: the lockfile must learn the new workspace link.) `git diff pnpm-lock.yaml` must then show exactly these 3 added lines and nothing else:

```diff
       '@hono/zod-openapi':
         specifier: ^1.6.3
         version: 1.6.3(hono@4.13.13)(zod@4.6.7)
+      '@screentime/engine':
+        specifier: workspace:*
+        version: link:../packages/engine
       '@screentime/schemas':
         specifier: workspace:*
         version: link:../packages/schemas
```

If it shows anything else (other packages, changed versions), stop: run `git checkout pnpm-lock.yaml`, check 5.5 matches the card, and try again. Do not use `pnpm add`.

## 6. Detailed spec

### 6.1 Callers

- `GET /v1/device/state` and `POST /v1/device/usage` need a Bearer **device token** (`requireDevice`): otherwise 401 `This device is not enrolled.` A parent's access token is not a device token (401). OpenAPI security `deviceAuth`.
- `GET /v1/today` needs a **parent** of an enabled family (`requireFamilyParent`): 401 without a valid token, 403 for a super admin who is not a parent. OpenAPI security `bearerAuth`.
- Every query runs inside `withFamily`. Device routes take the family from the device row.

### 6.2 One clock and one day

All three routes use the database clock (`now()`), read once per request by `familyDay(tx, timezone)` in 5.6, which returns:

- `date`: the family's local date, `YYYY-MM-DD`;
- `dayStart` and `dayEnd`: local midnight at the start and end of that date, as instants (PostgreSQL `AT TIME ZONE`, so a daylight-saving day is 23 or 25 hours long);
- `now`: the database clock. `serverTime` in the answers is this value.

A segment **overlaps today** when it starts before `dayEnd` and its end (see 6.3) is null or after `dayStart`.

### 6.3 Open segments of silent devices

A segment with `ended_at` null is still in use. When its device's `last_seen_at` is more than 10 minutes ago, the routes treat it as ending at `last_seen_at` (or at its start, if that is later). This keeps a phone that died while in use from using up the pool forever. The stored row is not changed. Devices upload at least every 5 minutes while in use (SPEC §8.3), so a working device never looks silent.

### 6.4 `GET /v1/device/state`

200 `DeviceState` (5.1):

| Field | Content |
|---|---|
| `serverTime` | the database clock, UTC |
| `stateVersion` | the first 32 hex characters of the SHA-256 of the JSON of every field below (everything except `serverTime` and `stateVersion`) |
| `device` | `id`, `name`, `form`, `pool`, `hasCellular` |
| `kid` | `id`, `name` |
| `family` | `timezone`, `emergencyNumber`, `parentCodeSecret` |
| `parents` | every enabled parent, oldest first: `id`, `displayName`, `phoneE164` (null if none) |
| `contacts` | the kid's contacts in order: `label`, `phoneE164` |
| `messagePresets` | the family's presets in order: `id`, `text` |
| `schedule` | the kid's highest schedule version, as `GET /v1/kids/{kidId}/schedule` returns it |
| `today.date` | the family's local date |
| `today.grants` | grants for this kid and **this device's pool** with `day` = today, oldest first: `id`, `minutes`, `createdAt`, `byName` (the parent's display name) |
| `today.poolSegments` | segments of every device of this kid in this pool (this device too) that overlap today, oldest first: `id`, `deviceId`, `startedAt`, `endedAt` (6.3 applied) |
| `parentMode` | the parent-mode session of this device that has started, has not ended and has not passed `ends_at` (null `ends_at` = no end): `{ active: true, endsAt, byName }` (`byName` = the approving parent, null for a code). None: `{ active: false, endsAt: null, byName: null }` |
| `pendingRequest` | the newest `pending` time request of this kid for this pool made today (since `dayStart`): `{ id, minutes, createdAt }`, or null |
| `activeSos` | the kid's newest SOS with no `ended_at` and `auto_stop_at` in the future: `{ id, startedAt }`, or null |

Headers and 304:

- Every 200 and 304 has the header `ETag: "<stateVersion>"` (in double quotes).
- If the request header `If-None-Match` names the current version, the answer is **304 with no body**. The header may list several tags separated by commas, and a tag may be weak (`W/"..."`, which Cloudflare can produce when it compresses); any match counts.
- A 304 has the standard `Date` header, which devices use as the server time.

### 6.5 `POST /v1/device/usage`

Request `UsageUpload`: `{ segments: [...] }`, 1 to 500 segments, each `{ id (uuid), startedAt, endedAt | null, recordedOffline }`. `endedAt` before `startedAt` is 422.

1. Repeats of one id in the same call are joined first (the same rules as step 3).
2. Each segment is stored with this device's kid and **current** pool. A segment keeps the pool it got when it first arrived.
3. A segment id that is already stored **for this device** is updated by these rules: `started_at` never changes; `ended_at` becomes the later of the two, and once it is set it never goes back to null (a closed segment never reopens); `recorded_offline` once true stays true; `received_at` becomes now.
4. A segment id that is already stored **for another device** is left alone.
5. Answer 200 `{ received }`: how many segments were stored or updated (step 4 does not count).

### 6.6 `GET /v1/today`

200 `Today` (5.1): `{ serverTime, date, kids }`. `kids` holds every kid that is not archived, oldest first: `{ id, name, avatarColor, pools }`. `pools` always has both pools, `screens` first, then `phone`, each:

| Field | Content |
|---|---|
| `allowanceMin` | from the kid's current schedule for today's weekday (`screensMin` or `phoneMin`) |
| `grantedMin` | sum of the minutes of today's grants for this kid and pool (may be negative) |
| `usedSec`, `remainingSec`, `locked`, `lockReason`, `nextLockAt`, `overspendSec` | straight from the engine's `evaluate` (`@screentime/engine`), with the family time zone, today's date, the database clock, today's schedule entry, today's grants and the overlapping segments of all the kid's devices in the pool (6.3 applied) |
| `devices` | the kid's devices in this pool that are not revoked, oldest first: `id`, `name`, `form`, `inUse` (it has an open segment today after 6.3), `lastSeenAt`, `parentMode` (`{ endsAt, byName }` while parent mode is on, otherwise null) |

### 6.7 OpenAPI

New operations: `GET /v1/device/state` (responses 200 with an `ETag` header, 304, 401), `POST /v1/device/usage`, `GET /v1/today`. New named schemas: `DeviceState`, `LockReason`, `PoolSegment`, `StateGrant`, `Today`, `TodayDevice`, `TodayKid`, `TodayPool`, `UsageReceipt`, `UsageSegmentIn`, `UsageUpload`.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-014-state-usage-today
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-014-state-usage-today.md` must exist after the pull. If it does not, you did not pull: run `git fetch origin` and `git pull origin main` again.
3. Create 5.1 to 5.3. Run `pnpm --filter @screentime/schemas build` and `pnpm --filter @screentime/schemas test` (`Tests  21 passed (21)`). Commit: `CARD-014: add sync schemas`.
4. Replace 5.5 (`server/package.json`) and run `pnpm install` (5.12). Check `git diff pnpm-lock.yaml` shows exactly the 3 lines. Commit both files: `CARD-014: link the time engine into the server`.
5. Replace or create 5.4, 5.6, 5.7 and 5.8. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-014: add state, usage and today routes`.
6. Create or replace the tests 5.9 and 5.10. Commit: `CARD-014: add sync tests`.
7. Run `pnpm contract` (5.11) and compare. Commit: `CARD-014: regenerate the API contract`.
8. Run the acceptance checks in section 8.
9. Push and open the PR (section 10).
10. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
11. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  21 passed (21)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/admin.test.ts (8 tests | 8 skipped)`, `test/auth.test.ts (15 tests | 15 skipped)`, `test/db.test.ts (12 tests | 12 skipped)`, `test/devices.test.ts (12 tests | 12 skipped)`, `test/family.test.ts (17 tests | 17 skipped)`, `test/kids.test.ts (10 tests | 10 skipped)`, `test/sync.test.ts (13 tests | 13 skipped)`, `test/config.test.ts (7 tests)`, `test/tokens.test.ts (7 tests)`, `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (7 tests)`, `test/health.test.ts (2 tests)`, so `Tests  30 passed | 87 skipped (117)`.
- [ ] `contract/openapi.json` matches 5.11 exactly. Running `pnpm contract` again leaves `git status --short contract` empty. `pnpm --filter @screentime/server db:generate` prints `No schema changes, nothing to migrate`.
- [ ] `git diff main...HEAD -- pnpm-lock.yaml` shows exactly the 3 added lines of 5.12.
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
  Output: `test/sync.test.ts (13 tests)`, `test/devices.test.ts (12 tests)` and `Tests  117 passed (117)`.
- [ ] State, usage and today work on the real stack (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
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
  Put those 6 digits in place of `123456`, then add a kid and enrol a phone:
  ```powershell
  $p = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"parent@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $ph = @{ Authorization = "Bearer $($p.accessToken)" }
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  $c = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/enrolment-codes" -Headers $ph -ContentType 'application/json' -Body '{"form":"phone"}'
  $e = Invoke-RestMethod -Method Post http://localhost:8080/v1/enrol -ContentType 'application/json' -Body "{`"code`":`"$($c.code)`",`"platform`":`"android`",`"hasCellular`":true,`"model`":`"Pixel 7`",`"osVersion`":`"Android 14`",`"appVersion`":`"0.1.0`"}"
  $dh = @{ Authorization = "Bearer $($e.deviceToken)" }
  ```
  Then fetch the state, fetch it again with its version, upload 20 minutes of use, fetch again with the old version, and read the dashboard:
  ```powershell
  $s = Invoke-RestMethod http://localhost:8080/v1/device/state -Headers $dh
  "$($s.device.pool) $($s.schedule.version) $($s.parents[0].displayName) $($s.today.poolSegments.Count)"
  $nh = @{ Authorization = "Bearer $($e.deviceToken)"; 'If-None-Match' = "`"$($s.stateVersion)`"" }
  try { (Invoke-WebRequest http://localhost:8080/v1/device/state -Headers $nh -UseBasicParsing).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
  $from = (Get-Date).ToUniversalTime().AddMinutes(-20).ToString('o')
  $to = (Get-Date).ToUniversalTime().ToString('o')
  $u = Invoke-RestMethod -Method Post http://localhost:8080/v1/device/usage -Headers $dh -ContentType 'application/json' -Body "{`"segments`":[{`"id`":`"$(New-Guid)`",`"startedAt`":`"$from`",`"endedAt`":`"$to`",`"recordedOffline`":false}]}"
  "received $($u.received)"
  try { (Invoke-WebRequest http://localhost:8080/v1/device/state -Headers $nh -UseBasicParsing).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
  $t = Invoke-RestMethod http://localhost:8080/v1/today -Headers $ph
  $t.kids[0].pools | ForEach-Object { "$($_.pool) $($_.usedSec) $($_.devices.Count)" }
  ```
  The outputs are `phone 1 Dad 0`, `304`, `received 1`, `200`, `screens 0 0` and `phone 1200 1`. (If you run this in the first 20 minutes after midnight, Sydney time, the last number before `1` is smaller: the segment started yesterday. Run it again later. Do not paste the device token anywhere.)
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 12 files (in any order):
  ```
  contract/openapi.json
  packages/schemas/src/index.ts
  packages/schemas/src/sync.ts
  packages/schemas/test/sync.test.ts
  pnpm-lock.yaml
  server/package.json
  server/src/app.ts
  server/src/kids/routes.ts
  server/src/sync/day.ts
  server/src/sync/routes.ts
  server/test/openapi.test.ts
  server/test/sync.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/sync.test.ts` | Usage segments may be closed or open and may have an offset; a segment that ends before it starts is refused; an upload has 1 to 500 segments. |
| `server/test/sync.test.ts` | Against a real database. **State:** needs a device token (none, garbage and a parent token are 401); returns every part of the snapshot (device, kid, family with the parent-code secret, enabled parents only, contacts, presets, schedule, today's date, empty grants and segments, no parent mode, no request, no SOS) with the version as the ETag; answers 304 for the same version, a weak tag and a list of tags, and 200 with a new version after a grant; shows today's grants and segments of this device's pool only (not the other pool, another kid or yesterday); shows an open segment as ending at its device's `last_seen_at` once that is 10 minutes ago; shows active parent mode with the parent's name, a pending request and an active SOS, and parent mode off once it ended. **Usage:** stores segments, keeps the first start and the latest end, never reopens or shortens a closed segment, keeps `recordedOffline`; joins repeats in one upload; never changes another device's segment (`received: 0`); refuses no token, a parent token, an empty list, a wrong order and a bad id. **Today:** 20 + 20 minutes with 10 overlapping is 30 minutes used, a 15-minute grant adds to the remaining time, `nextLockAt` is now plus remaining; a phone with all its time taken away is locked `out_of_time` with overspend equal to its use and shows `inUse`; revoked devices are left out; only the caller's family, no archived kids; a super admin who is not a parent is 403. |
| `server/test/openapi.test.ts` | As before, plus: state and usage use `deviceAuth`, state has a 304 response, today uses `bearerAuth`, and the 11 new schemas are named; the committed file is up to date. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 7). Message format: `CARD-014: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-014-state-usage-today`
5. Open a PR into `main` titled `CARD-014: Device state, usage upload and today`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-014-state-usage-today --title "CARD-014: Device state, usage upload and today" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-014-state-usage-today.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] openapi.json matches the card; pnpm contract is stable; db:generate finds no changes
   - [x] pnpm-lock.yaml has only the 3 added lines
   - [x] database tests — output: `Tests  117 passed (117)`
   - [x] state, usage and today on the real stack — output: `phone 1 Dad 0`, `304`, `received 1`, `200`, `screens 0 0`, `phone 1200 1`
   - [x] deploy/.env not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 12 files

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

- **`Cannot find module '@screentime/engine'`** in the server: you skipped `pnpm install` after 5.5, or 5.5 does not match the card. Then run `pnpm build` (the server uses the built packages).
- **`Module '"@screentime/schemas"' has no exported member 'DeviceState'`**: run `pnpm build`, and check that 5.2 matches the card.
- **`pnpm-lock.yaml` changed more than 3 lines**: you used `pnpm add`, or a different pnpm version. Undo it (`git checkout pnpm-lock.yaml`), check `pnpm --version` is 11.x, and run `pnpm install` again.
- **`openapi.test.ts` fails with a diff**: run `pnpm contract`. If the new file still differs from 5.11, one of 5.1, 5.2, 5.4, 5.7 or 5.8 does not match the card. Do not edit `openapi.json` by hand.
- **A `sync.test.ts` time looks off by hours**: the tests choose their own time zone (`middayZone()`); do not change it to your own zone, and do not change the times.
- **TypeScript complains about a test name** (`',' expected`): an apostrophe inside a single-quoted string. Copy the line again from the card; those names use double quotes.
- **Different test data**: do not change values in the tests (names, numbers, minutes), even when another value would also pass. The card's values are what Claude checks against. If you think one is wrong, say so under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-014. Please review and merge if it is good.

CARD: CARD-014 Device state, usage upload and today
PR: <full PR URL>
Branch: bob/card-014-state-usage-today
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

