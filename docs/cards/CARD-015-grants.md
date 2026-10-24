# CARD-015: Grants and lock now

| Field | Value |
|---|---|
| Card | CARD-015 |
| Title | Grants and lock now |
| Size | S |
| Depends on | CARD-014 (merged to `main`) |
| Spec sections | docs/SPEC.md §6.1 (grants), §7.3, §9.2, §13, Q8 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-015-grants` |
| PR title | `CARD-015: Grants and lock now` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`. Request and response shapes are Zod schemas in `packages/schemas` (package `@screentime/schemas`), and `pnpm contract` writes the generated OpenAPI document to `contract/openapi.json`, which is committed; `server/test/openapi.test.ts` fails if it is out of date. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts`.

What exists already:

- Parent routes use `requireFamilyParent` (`server/src/auth/guards.ts`) and run their queries through `withFamily` (`server/src/db/family.ts`), which limits them to the caller's family by row-level security. `findKid` (`server/src/kids/routes.ts`) answers 404 for a kid that is archived or in another family.
- The `grants` table exists (CARD-010): `id` (made by the app), `family_id`, `kid_id`, `pool`, `minutes` (non-zero, may be negative), `day` (the family's local date), `created_at`, `created_by` (parent), `request_id`, `note`.
- CARD-014 added `server/src/sync/day.ts`, with `familyDay` (today's local date and its start and end, from the database clock), `dayGrants`, `daySegments` and `poolStatus` (runs the shared time engine for one kid and pool). Kid devices already see today's grants in their state snapshot, and `GET /v1/today` already counts them.

This card lets parents change today's time (SPEC Q8: today only, plus or minus, in 15-minute steps, no cap):

1. **`POST /v1/kids/{kidId}/grants`**: add or remove time for one pool today. The app makes the grant id, so sending the same request twice (for example after a timeout) stores it once.
2. **`POST /v1/kids/{kidId}/lock-now`**: lock a pool at once. The server runs the engine, takes away the time left rounded up to a whole minute, and stores that as a negative grant (SPEC §7.3).
3. **`GET /v1/kids/{kidId}/grants`**: today's grants for a kid (or another day's), for the history list.

Every new grant also writes a `grant.added` row to `events`, which CARD-016 turns into notifications for the other parent. No database migration and no new package are needed.

## 2. Goal

Parents can add time, remove time and lock a pool now, safely repeatable by id, and list a kid's grants. Devices and the dashboard see the change on their next fetch. All of it is tested against PostgreSQL 18 in CI, and the OpenAPI contract describes the 3 new operations.

## 3. Out of scope

Do **not** do any of these in this card:

- No push or WebSocket message to devices or parents (CARD-016, CARD-017). The event row is written; nothing reads it yet.
- No time requests (approving a kid's request creates a grant later; `requestId` is always null here).
- No change to the engine, the state snapshot or `/v1/today`.
- No new npm packages. `pnpm-lock.yaml` and every `package.json` stay unchanged.
- No database migration. Do not change `server/src/db/schema.ts` or anything in `server/drizzle/`.
- Do not change any file that is not listed in section 5. In particular, leave `server/src/sync/`, `server/src/kids/`, `server/src/devices/`, `server/src/auth/`, `server/src/db/`, `server/test/helpers.ts` and the other existing tests as they are.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key, a device token or any other secret.

## 4. Tech and versions

Nothing new. Everything is unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, Zod ^4.6, hono ^4.13.13, @hono/zod-openapi ^1.6.3, drizzle-orm ^0.45.4, PostgreSQL 18.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character. Some test names contain an apostrophe and so use double quotes (`it("lists today's grants of both pools by default, or another day's", ...)`): keep them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/grants.ts` | create (5.1) |
| `packages/schemas/src/index.ts` | replace (5.2) |
| `packages/schemas/test/grants.test.ts` | create (5.3) |
| `server/src/grants/routes.ts` | create (5.4) |
| `server/src/app.ts` | replace (5.5) |
| `server/test/grants.test.ts` | create (5.6) |
| `server/test/openapi.test.ts` | replace (5.7) |
| `contract/openapi.json` | **generated** by `pnpm contract` (5.8) |

That is 8 files.

### 5.1 `packages/schemas/src/grants.ts`

```typescript
import { z } from 'zod';
import { Pool } from './devices.js';

/** A local date, YYYY-MM-DD. */
export const LocalDate = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'Use YYYY-MM-DD.')
  .meta({ id: 'LocalDate' });

/** A time adjustment for one kid, one pool, one day (docs/SPEC.md §6.1 grants). */
export const Grant = z
  .object({
    id: z.uuid(),
    pool: Pool,
    /** Positive adds time, negative takes it away. */
    minutes: z.int(),
    /** The family's local date the grant counts for. */
    day: LocalDate,
    createdAt: z.iso.datetime(),
    /** Display name of the parent who made it. */
    byName: z.string(),
    note: z.string().nullable(),
    /** Set when the grant answers a kid's time request. */
    requestId: z.uuid().nullable(),
  })
  .meta({ id: 'Grant' });

export type Grant = z.infer<typeof Grant>;

/** Body of POST /v1/kids/{kidId}/grants. The app makes the id, so sending it again is safe. */
export const GrantCreate = z
  .object({
    id: z.uuid(),
    pool: Pool,
    /** From the 15-minute roller: a non-zero multiple of 15, at most a day either way. */
    minutes: z
      .int()
      .min(-1440)
      .max(1440)
      .refine((m) => m !== 0 && m % 15 === 0, 'minutes must be a non-zero multiple of 15.'),
    note: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .meta({ id: 'GrantCreate' });

export type GrantCreate = z.infer<typeof GrantCreate>;

/** Body of POST /v1/kids/{kidId}/lock-now. The server works out how many minutes to take away. */
export const LockNow = z
  .object({
    id: z.uuid(),
    pool: Pool,
  })
  .meta({ id: 'LockNow' });

export type LockNow = z.infer<typeof LockNow>;
```

### 5.2 `packages/schemas/src/index.ts`

The same as on `main`, plus the last line, which exports `./grants.js`.

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
```

### 5.3 `packages/schemas/test/grants.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { GrantCreate } from '../src/index.js';

const grant = { id: '01960000-0000-7000-8000-000000000001', pool: 'screens', minutes: 15 };

describe('grant schemas', () => {
  it('takes non-zero multiples of 15, either way, up to a day', () => {
    for (const minutes of [15, -15, 45, -240, 1440, -1440]) {
      expect(GrantCreate.safeParse({ ...grant, minutes }).success).toBe(true);
    }
    for (const minutes of [0, 10, -20, 1455, 15.5]) {
      expect(GrantCreate.safeParse({ ...grant, minutes }).success).toBe(false);
    }
  });

  it('trims the note and allows none', () => {
    expect(GrantCreate.parse({ ...grant, note: ' Homework done ' }).note).toBe('Homework done');
    expect(GrantCreate.safeParse({ ...grant, note: null }).success).toBe(true);
    expect(GrantCreate.safeParse({ ...grant, note: '   ' }).success).toBe(false);
    expect(GrantCreate.safeParse({ ...grant, note: 'x'.repeat(161) }).success).toBe(false);
  });
});
```

### 5.4 `server/src/grants/routes.ts`

The three routes. They reuse `familyDay`, `dayGrants`, `daySegments` and `poolStatus` from `server/src/sync/day.ts`, and `findKid` and `toSchedule` from `server/src/kids/routes.ts`.

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

  /** Stores a new grant for today and records a `grant.added` event in the same transaction. */
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
    if (inserted.length === 0) return { grant: await existing(tx, values.id, kidId), created: false };
    const [grant] = await selectGrants(tx, eq(grants.id, values.id));
    if (!grant) throw new Error('grant vanished after insert');
    // CARD-016 turns this event into `grant.by_other_parent` notifications.
    await tx.insert(events).values({
      familyId,
      kidId,
      kind: 'grant.added',
      at: new Date(grant.createdAt),
      payload: { grantId: grant.id, pool: grant.pool, minutes: grant.minutes, byName: grant.byName, lockNow },
    });
    return { grant, created: true };
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
      if (stored) return { grant: stored, created: false };
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
    return result.created ? c.json(result.grant, 201) : c.json(result.grant, 200);
  });

  app.openapi(lockNowRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const { id, pool } = c.req.valid('json');
    const result = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const stored = await existing(tx, id, kidId);
      if (stored) return { grant: stored, created: false };
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
    return result.created ? c.json(result.grant, 201) : c.json(result.grant, 200);
  });
}
```

### 5.5 `server/src/app.ts`

The same as on `main`, plus the import of `registerGrantRoutes` and the call `registerGrantRoutes(app, deps);` after `registerSyncRoutes(app, deps);`.

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
  registerGrantRoutes(app, deps);
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

### 5.6 `server/test/grants.test.ts`

Database tests. Like `server/test/sync.test.ts`, they give family A a fixed-offset time zone where it is about midday whenever the tests run (`middayZone()`), and a schedule with no curfew (120 minutes of Screens and 60 of Phone every day), so the results never depend on the hour or the weekday.

```typescript
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { devices, events, families, grants, kids, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** A fixed-offset zone where it is about midday right now, so the test times never cross local midnight. */
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

describe.skipIf(!url)('grant routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const api = client({ db, config: testConfig(url ?? ''), mailer });

  let familyA = '';
  let familyB = '';
  let mumId = '';
  let mum = '';
  let dad = '';
  let bea = '';

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addTablet(familyId: string, kidId: string) {
    const token = newDeviceToken();
    await db.insert(devices).values({
      familyId,
      kidId,
      platform: 'android',
      form: 'tablet',
      pool: 'screens',
      name: 'Tablet',
      tokenHash: hashDeviceToken(token),
    });
    return token;
  }

  /** The kid's pool on the dashboard. */
  async function poolToday(kidId: string, which: 'screens' | 'phone') {
    const res = await api.get('/v1/today', mum);
    const kid = res.body.kids.find((k: { id: string }) => k.id === kidId);
    return kid.pools.find((p: { pool: string }) => p.pool === which);
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
    mum = await tokenFor({ parentId: mumId, familyId: familyA });
    dad = await tokenFor({ parentId: p2?.id ?? '', familyId: familyA });
    bea = await tokenFor({ parentId: p3?.id ?? '', familyId: familyB });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /v1/kids/{kidId}/grants', () => {
    it('adds time for today, records the event and shows on the dashboard', async () => {
      const kidId = await addKid(familyA, 'Alex');
      const id = randomUUID();
      const res = await api.post(`/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 15, note: ' Homework done ' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id,
        pool: 'screens',
        minutes: 15,
        day: localDate(),
        createdAt: expect.any(String),
        byName: 'Mum',
        note: 'Homework done',
        requestId: null,
      });
      const [event] = await db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'grant.added')));
      expect(event?.payload).toEqual({ grantId: id, pool: 'screens', minutes: 15, byName: 'Mum', lockNow: false });
      expect(await poolToday(kidId, 'screens')).toMatchObject({ grantedMin: 15, remainingSec: (120 + 15) * 60 });
    });

    it('removes time with a negative grant', async () => {
      const kidId = await addKid(familyA, 'Blake');
      const res = await api.post(`/v1/kids/${kidId}/grants`, dad, { id: randomUUID(), pool: 'phone', minutes: -45 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ pool: 'phone', minutes: -45, byName: 'Dad', note: null });
      expect(await poolToday(kidId, 'phone')).toMatchObject({ grantedMin: -45, remainingSec: 15 * 60, locked: false });
    });

    it('returns the stored grant when the same id is sent again, and refuses an id used elsewhere', async () => {
      const kidId = await addKid(familyA, 'Casey');
      const otherKid = await addKid(familyA, 'Other');
      const id = randomUUID();
      const first = await api.post(`/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 30 });
      const again = await api.post(`/v1/kids/${kidId}/grants`, dad, { id, pool: 'phone', minutes: 60 });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect(await db.select().from(grants).where(eq(grants.kidId, kidId))).toHaveLength(1);
      expect(await db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'grant.added')))).toHaveLength(1);

      const elsewhere = await api.post(`/v1/kids/${otherKid}/grants`, mum, { id, pool: 'screens', minutes: 30 });
      expect(elsewhere.status).toBe(409);
      expect(elsewhere.body.error.message).toBe('That grant id is already used.');
      const ben = await addKid(familyB, 'Ben');
      expect((await api.post(`/v1/kids/${ben}/grants`, bea, { id, pool: 'screens', minutes: 30 })).status).toBe(409);
    });

    it('needs a parent of the family, a known kid and roller minutes', async () => {
      const kidId = await addKid(familyA, 'Drew');
      const body = { id: randomUUID(), pool: 'screens', minutes: 15 };
      expect((await api.post(`/v1/kids/${kidId}/grants`, null, body)).status).toBe(401);
      const admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
      expect((await api.post(`/v1/kids/${kidId}/grants`, admin, body)).status).toBe(403);
      expect((await api.post(`/v1/kids/${kidId}/grants`, bea, body)).status).toBe(404);
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { ...body, minutes: 0 })).status).toBe(422);
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { ...body, minutes: 10 })).status).toBe(422);
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { ...body, pool: 'tv' })).status).toBe(422);
      await db.update(kids).set({ archivedAt: new Date() }).where(eq(kids.id, kidId));
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, body)).status).toBe(404);
    });
  });

  describe('GET /v1/kids/{kidId}/grants', () => {
    it("lists today's grants of both pools by default, or another day's", async () => {
      const kidId = await addKid(familyA, 'Eli');
      await api.post(`/v1/kids/${kidId}/grants`, mum, { id: randomUUID(), pool: 'screens', minutes: 15 });
      await api.post(`/v1/kids/${kidId}/grants`, dad, { id: randomUUID(), pool: 'phone', minutes: -15 });
      await db.insert(grants).values({ id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 60, day: '2020-01-01', createdBy: mumId });

      const today = await api.get(`/v1/kids/${kidId}/grants`, mum);
      expect(today.status).toBe(200);
      expect(today.body.map((g: { minutes: number; byName: string }) => [g.minutes, g.byName])).toEqual([
        [15, 'Mum'],
        [-15, 'Dad'],
      ]);
      const old = await api.get(`/v1/kids/${kidId}/grants?day=2020-01-01`, mum);
      expect(old.body.map((g: { minutes: number }) => g.minutes)).toEqual([60]);
      expect((await api.get(`/v1/kids/${kidId}/grants?day=1st-jan`, mum)).status).toBe(422);
      expect((await api.get(`/v1/kids/${kidId}/grants`, bea)).status).toBe(404);
    });
  });

  describe('POST /v1/kids/{kidId}/lock-now', () => {
    it('takes away the time left, rounded up to a minute, so the pool locks at once', async () => {
      const kidId = await addKid(familyA, 'Finn');
      const tablet = await addTablet(familyA, kidId);
      // 10.5 minutes used so far and still in use: 120 - 10.5 = 109.5 minutes left, rounded up to 110.
      await api.post('/v1/device/usage', tablet, {
        segments: [{ id: randomUUID(), startedAt: at(-10.5), endedAt: null, recordedOffline: false }],
      });
      const id = randomUUID();
      const res = await api.post(`/v1/kids/${kidId}/lock-now`, mum, { id, pool: 'screens' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id, pool: 'screens', minutes: -110, byName: 'Mum', note: 'Lock now' });
      expect(await poolToday(kidId, 'screens')).toMatchObject({ locked: true, lockReason: 'out_of_time', remainingSec: 0 });
      expect(await poolToday(kidId, 'phone')).toMatchObject({ locked: false, grantedMin: 0 });
      const [event] = await db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'grant.added')));
      expect(event?.payload).toMatchObject({ grantId: id, minutes: -110, lockNow: true });

      // The same request again is answered from the record; a new one finds the pool locked.
      expect((await api.post(`/v1/kids/${kidId}/lock-now`, mum, { id, pool: 'screens' })).status).toBe(200);
      const twice = await api.post(`/v1/kids/${kidId}/lock-now`, dad, { id: randomUUID(), pool: 'screens' });
      expect(twice.status).toBe(409);
      expect(twice.body.error.message).toBe('Screens is already locked.');
    });

    it('locks a pool with no use yet by taking the whole allowance', async () => {
      const kidId = await addKid(familyA, 'Gus');
      const res = await api.post(`/v1/kids/${kidId}/lock-now`, mum, { id: randomUUID(), pool: 'phone' });
      expect(res.body.minutes).toBe(-60);
      expect(await poolToday(kidId, 'phone')).toMatchObject({ locked: true, remainingSec: 0, grantedMin: -60 });
    });

    it('needs a parent of the family and a known kid', async () => {
      const kidId = await addKid(familyA, 'Hana');
      const body = { id: randomUUID(), pool: 'screens' };
      expect((await api.post(`/v1/kids/${kidId}/lock-now`, null, body)).status).toBe(401);
      expect((await api.post(`/v1/kids/${kidId}/lock-now`, bea, body)).status).toBe(404);
      expect((await api.post(`/v1/kids/${kidId}/lock-now`, mum, { ...body, pool: 'tv' })).status).toBe(422);
    });
  });
});
```

### 5.7 `server/test/openapi.test.ts`

The same as on `main`, plus the test `describes the grant routes, all behind bearer auth` before the last test.

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

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.8 `contract/openapi.json` (generated)

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

### 6.1 Callers

All three routes need a parent of an enabled family (`requireFamilyParent`): 401 without a valid token, 403 for a super admin who is not a parent. A kid that is archived or in another family is 404 `No such kid in your family.` OpenAPI security `bearerAuth`. Everything runs in one `withFamily` transaction per request.

### 6.2 `POST /v1/kids/{kidId}/grants`

Request `GrantCreate`: `id` (uuid, made by the app), `pool` (`screens` or `phone`), `minutes`, `note` (optional or null).

- `minutes` is a whole number, not 0, a multiple of 15, from −1440 to 1440. Otherwise 422.
- `note` is trimmed, then 1 to 160 characters. Otherwise 422.

Steps:

1. If a grant with this `id` is already stored for **this kid**: answer **200** with the stored grant and change nothing (even if the new body differs). If it is stored for another kid, or another family has it: 409 `That grant id is already used.`
2. Otherwise insert it with `day` = the family's local today (`familyDay`), `created_by` = the caller, `request_id` null.
3. In the same transaction, write an `events` row: `kind` `grant.added`, the kid, `at` = the grant's `created_at`, `payload` `{ grantId, pool, minutes, byName, lockNow: false }`.
4. Answer **201** with the `Grant`: `{ id, pool, minutes, day, createdAt, byName, note, requestId }`, where `byName` is the caller's display name.

If two requests with the same new id race, the insert of the second one does nothing (`ON CONFLICT DO NOTHING`) and it answers like step 1.

### 6.3 `POST /v1/kids/{kidId}/lock-now`

Request `LockNow`: `id`, `pool`.

1. A stored `id`: as 6.2 step 1.
2. Run the engine for this kid and pool now (`poolStatus` with today's schedule entry, today's grants and segments of that pool), exactly as `GET /v1/today` does.
3. If the pool is already locked: 409 `Screens is already locked.` or `Phone is already locked.`
4. Otherwise store a grant of `minutes = -ceil(remainingSec / 60)` with `note` `Lock now`, write the event with `lockNow: true`, and answer **201** with the grant. Because the minutes are rounded up, the pool ends at or just under zero and the devices lock on their next fetch.

Example: 120 minutes allowed, 10 minutes 30 seconds used: 6570 seconds left, 109.5 minutes, so the grant is −110.

### 6.4 `GET /v1/kids/{kidId}/grants`

Query `day` (optional, `YYYY-MM-DD`, else 422). Without it, the family's local today. Answer 200: the kid's grants for that day, **both pools**, oldest first, each a `Grant`.

### 6.5 OpenAPI

New operations: `GET` and `POST /v1/kids/{kidId}/grants` and `POST /v1/kids/{kidId}/lock-now`, all with `bearerAuth`, tag `grants`. New named schemas: `Grant`, `GrantCreate`, `LocalDate`, `LockNow`.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-015-grants
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-015-grants.md` must exist after the pull. If it does not, you did not pull: run `git fetch origin` and `git pull origin main` again.
3. Create 5.1 to 5.3. Run `pnpm --filter @screentime/schemas build` and `pnpm --filter @screentime/schemas test` (`Tests  23 passed (23)`). Commit: `CARD-015: add grant schemas`.
4. Create or replace 5.4 and 5.5. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-015: add grant and lock-now routes`.
5. Create or replace the tests 5.6 and 5.7. Commit: `CARD-015: add grant tests`.
6. Run `pnpm contract` (5.8) and compare. Commit: `CARD-015: regenerate the API contract`.
7. Run the acceptance checks in section 8.
8. Push and open the PR (section 10).
9. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
10. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  23 passed (23)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/admin.test.ts (8 tests | 8 skipped)`, `test/auth.test.ts (15 tests | 15 skipped)`, `test/db.test.ts (12 tests | 12 skipped)`, `test/devices.test.ts (12 tests | 12 skipped)`, `test/family.test.ts (17 tests | 17 skipped)`, `test/grants.test.ts (8 tests | 8 skipped)`, `test/kids.test.ts (10 tests | 10 skipped)`, `test/sync.test.ts (13 tests | 13 skipped)`, `test/config.test.ts (7 tests)`, `test/tokens.test.ts (7 tests)`, `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (8 tests)`, `test/health.test.ts (2 tests)`, so `Tests  31 passed | 95 skipped (126)`.
- [ ] `contract/openapi.json` matches 5.8 exactly. Running `pnpm contract` again leaves `git status --short contract` empty. `pnpm --filter @screentime/server db:generate` prints `No schema changes, nothing to migrate`.
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
  Output: `test/grants.test.ts (8 tests)`, `test/sync.test.ts (13 tests)` and `Tests  126 passed (126)`.
- [ ] Grants and lock now work on the real stack (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
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
  Put those 6 digits in place of `123456`, then add a kid:
  ```powershell
  $p = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"parent@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $ph = @{ Authorization = "Bearer $($p.accessToken)" }
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  ```
  Then add 30 minutes of Screens, send the same grant again, lock the phone, try to lock it again, and read the dashboard. Run this between 08:00 and 20:30 Sydney time: outside those hours the schedule already locks the phone and the lock-now lines answer 409.
  ```powershell
  $body = "{`"id`":`"$(New-Guid)`",`"pool`":`"screens`",`"minutes`":30}"
  $g = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/grants" -Headers $ph -ContentType 'application/json' -Body $body
  "$($g.pool) $($g.minutes) $($g.byName)"
  (Invoke-WebRequest -Method Post "http://localhost:8080/v1/kids/$($k.id)/grants" -Headers $ph -ContentType 'application/json' -Body $body -UseBasicParsing).StatusCode
  $l = Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/lock-now" -Headers $ph -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`",`"pool`":`"phone`"}"
  "$($l.minutes) $($l.note)"
  try { Invoke-RestMethod -Method Post "http://localhost:8080/v1/kids/$($k.id)/lock-now" -Headers $ph -ContentType 'application/json' -Body "{`"id`":`"$(New-Guid)`",`"pool`":`"phone`"}" } catch { $_.Exception.Response.StatusCode.value__ }
  $t = Invoke-RestMethod http://localhost:8080/v1/today -Headers $ph
  $t.kids[0].pools | ForEach-Object { "$($_.pool) $($_.grantedMin) $($_.locked)" }
  (Invoke-RestMethod "http://localhost:8080/v1/kids/$($k.id)/grants" -Headers $ph).Count
  ```
  The outputs are `screens 30 Dad`, `200`, `-90 Lock now` (`-120 Lock now` on a Saturday or Sunday, Sydney time, because the default schedule gives the phone 120 minutes then), `409`, `screens 30 False`, `phone -90 True` (or `-120`) and `2`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 8 files (in any order):
  ```
  contract/openapi.json
  packages/schemas/src/grants.ts
  packages/schemas/src/index.ts
  packages/schemas/test/grants.test.ts
  server/src/app.ts
  server/src/grants/routes.ts
  server/test/grants.test.ts
  server/test/openapi.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/grants.test.ts` | Grant minutes are non-zero multiples of 15 from −1440 to 1440 (0, 10, −20, 1455 and 15.5 are refused); the note is trimmed, may be null, and is 1 to 160 characters. |
| `server/test/grants.test.ts` | Against a real database. **Add:** a 15-minute grant answers 201 with today's date, the parent's name and the trimmed note, writes a `grant.added` event, and the dashboard shows 135 minutes left; **remove:** −45 minutes of Phone leaves 15 minutes; **same id:** sending it again (even with a different body) answers 200 with the stored grant and stores no second grant or event; the id for another kid or another family is 409; **checks:** no token 401, super admin 403, another family's kid 404, 0 or 10 minutes or an unknown pool 422, an archived kid 404. **List:** today's grants of both pools, oldest first, with names; `?day=2020-01-01` lists that day; a bad day 422; another family 404. **Lock now:** with 10.5 minutes used and still in use, the grant is −110 with note `Lock now`, the Screens pool is locked `out_of_time` and Phone is untouched, the event has `lockNow: true`; the same id again is 200; another lock is 409 `Screens is already locked.`; a pool with no use loses its whole 60 minutes; no token 401, another family 404, unknown pool 422. |
| `server/test/openapi.test.ts` | As before, plus: the three grant operations use `bearerAuth` and the 4 new schemas are named; the committed file is up to date. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 6). Message format: `CARD-015: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-015-grants`
5. Open a PR into `main` titled `CARD-015: Grants and lock now`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-015-grants --title "CARD-015: Grants and lock now" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-015-grants.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] openapi.json matches the card; pnpm contract is stable; db:generate finds no changes
   - [x] database tests — output: `Tests  126 passed (126)`
   - [x] grants and lock now on the real stack — output: `screens 30 Dad`, `200`, `-90 Lock now`, `409`, `screens 30 False`, `phone -90 True`, `2`
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

- **`Module '"@screentime/schemas"' has no exported member 'Grant'`** in the server: run `pnpm build` (the server uses the built schemas package), and check that 5.2 matches the card.
- **`openapi.test.ts` fails with a diff**: run `pnpm contract`. If the new file still differs from 5.8, one of 5.1, 5.2, 5.4 or 5.5 does not match the card. Do not edit `openapi.json` by hand.
- **Lock now answers 409 on the real stack**: check the Sydney time (section 8). Before 08:00 or after 20:30 the default schedule has the phone locked already, so 409 is right. Run the check again in those hours, or write down what you saw in the handback.
- **A `grants.test.ts` time looks off by hours**: the tests choose their own time zone (`middayZone()`); do not change it to your own zone, and do not change the times.
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
Claude, here is Bob's handback for CARD-015. Please review and merge if it is good.

CARD: CARD-015 Grants and lock now
PR: <full PR URL>
Branch: bob/card-015-grants
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

