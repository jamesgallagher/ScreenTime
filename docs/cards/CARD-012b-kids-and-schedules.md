# CARD-012b: Kids, schedules and contacts

| Field | Value |
|---|---|
| Card | CARD-012b |
| Title | Kids, schedules and contacts |
| Size | M |
| Depends on | CARD-012 (merged to `main`) |
| Spec sections | docs/SPEC.md §6.1, §9.2 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-012b-kids-and-schedules` |
| PR title | `CARD-012b: Kids, schedules and contacts` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, package `@screentime/server`) is a Hono app built with `@hono/zod-openapi`. `server/src/app.ts` exports `createApp(deps)`. Request and response shapes are Zod schemas in `packages/schemas` (package `@screentime/schemas`), and `pnpm contract` writes the generated OpenAPI document to `contract/openapi.json`, which is committed; `server/test/openapi.test.ts` fails if it is out of date. Errors always have the shape `{ "error": { "code", "message", "details"? } }`: a handler throws `new ApiError(code, message)` from `server/src/errors.ts`.

CARD-012 added the family routes (`server/src/family/routes.ts`) and the helpers this card reuses:

- `requireFamilyParent(c, db, jwtSecret)` in `server/src/auth/guards.ts`: the signed-in parent, with `parentId` and `familyId`. It answers 401 or 403 by itself.
- `withFamily(db, familyId, fn)` in `server/src/db/family.ts`: runs `fn` in a transaction that can only see the caller's family (row-level security). `FamilyTx` is the type of its transaction handle.
- `bearer`, `errorResponses`, `jsonBody` and `jsonResponse` in `server/src/openapi.ts`, for route definitions.
- `isUniqueViolation(err)` in `server/src/db/errors.ts`.
- `client`, `resetDatabase`, `testConfig` and `tokenFor` in `server/test/helpers.ts`, for tests.

The tables `kids`, `schedule_versions` and `kid_contacts` already exist (CARD-010). This card adds the routes for them, so a parent can:

1. List, add, read, edit and archive their kids. A new kid starts with a default weekly schedule.
2. Read a kid's current schedule and save a new version of it. Schedules are never changed in place: every save adds a version, and the highest version is the current one.
3. Read and replace a kid's always-callable contact list (people the kid can phone even when the phone is locked).

No database migration is needed.

## 2. Goal

A parent can manage kids, their weekly schedules and their contact lists through the API, all tested against PostgreSQL 18 in CI, with the OpenAPI contract describing the 9 new operations.

## 3. Out of scope

Do **not** do any of these in this card:

- No devices, enrolment codes or device tokens (CARD-013). Archiving a kid does not touch devices yet.
- No grants, usage or `/v1/today` (CARD-014 and later). Do not use `packages/engine` here.
- No web or Android UI.
- No new npm packages. `pnpm-lock.yaml` and every `package.json` stay unchanged.
- No database migration. Do not change `server/src/db/schema.ts` or anything in `server/drizzle/`.
- Do not change any file that is not listed in section 5. In particular, leave `server/src/family/`, `server/src/admin/`, `server/src/auth/`, `server/src/openapi.ts`, `server/src/router.ts`, `server/src/errors.ts`, `server/src/db/`, `server/test/helpers.ts` and the other existing tests as they are.
- Never commit `deploy/.env`, a real JWT secret, an SMTP key or any other password.

## 4. Tech and versions

Nothing new. Everything is unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, Zod ^4.6, hono ^4.13.13, @hono/zod-openapi ^1.6.3, drizzle-orm ^0.45.4, PostgreSQL 18.

Docker Desktop must be running for the database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character. Some test names contain an apostrophe and so use double quotes (`it("lists the family's kids, oldest first", ...)`): keep them exactly as written.

| File | Action |
|---|---|
| `packages/schemas/src/kids.ts` | create (5.1) |
| `packages/schemas/src/index.ts` | replace (5.2) |
| `packages/schemas/test/kids.test.ts` | create (5.3) |
| `server/src/kids/schedule.ts` | create (5.4) |
| `server/src/kids/routes.ts` | create (5.5) |
| `server/src/app.ts` | replace (5.6) |
| `server/scripts/seed-dev.ts` | replace (5.7) |
| `server/test/kids.test.ts` | create (5.8) |
| `server/test/openapi.test.ts` | replace (5.9) |
| `contract/openapi.json` | **generated** by `pnpm contract` (5.10) |

That is 10 files.

### 5.1 `packages/schemas/src/kids.ts`

The shapes for the kid routes. `ScheduleDay` matches the `days` entries described in SPEC §6.1 (`schedule_versions`). Times are `HH:MM`; `wake` may be `00:00` and `bedtime` may be `24:00` (no limit on that side), and `wake` must be before `bedtime`. Because both are zero-padded, comparing the two strings compares the times.

```ts
import { z } from 'zod';
import { PhoneE164 } from './family.js';

/** The 8 kid avatar colours (docs/SPEC.md §16.1). */
export const AvatarColor = z
  .enum(['#0F766E', '#7C3AED', '#DB2777', '#2563EB', '#EA580C', '#16A34A', '#CA8A04', '#475569'])
  .meta({ id: 'AvatarColor' });

export type AvatarColor = z.infer<typeof AvatarColor>;

export const Kid = z
  .object({
    id: z.uuid(),
    name: z.string(),
    avatarColor: AvatarColor,
  })
  .meta({ id: 'Kid' });

export type Kid = z.infer<typeof Kid>;

/** Body of POST /v1/kids. The kid starts with the default schedule. */
export const KidCreate = z
  .object({
    name: z.string().trim().min(1).max(40),
    avatarColor: AvatarColor,
  })
  .meta({ id: 'KidCreate' });

export type KidCreate = z.infer<typeof KidCreate>;

/** Body of PATCH /v1/kids/{kidId}. Send only the fields to change. */
export const KidPatch = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    avatarColor: AvatarColor.optional(),
  })
  .meta({ id: 'KidPatch' });

export type KidPatch = z.infer<typeof KidPatch>;

/** Local time `HH:MM`, 24-hour. `24:00` means the end of the day. */
const LocalTime = z.string().regex(/^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/, 'Use HH:MM, 00:00 to 24:00.');

/** Whole minutes in a day, 0 to 1440. */
const DayMinutes = z.number().int().min(0).max(1440);

export const ScheduleDay = z
  .object({
    weekday: z.number().int().min(1).max(7),
    screensMin: DayMinutes,
    phoneMin: DayMinutes,
    wake: LocalTime,
    bedtime: LocalTime,
  })
  // Both are zero-padded HH:MM, so comparing the strings compares the times.
  .refine((day) => day.wake < day.bedtime, { message: 'Wake-up must be before bedtime.', path: ['bedtime'] })
  .meta({ id: 'ScheduleDay' });

export type ScheduleDay = z.infer<typeof ScheduleDay>;

/** Body of PUT /v1/kids/{kidId}/schedule (docs/SPEC.md §6.1 schedule_versions). */
export const ScheduleInput = z
  .object({
    warn1Min: z.number().int().min(2).max(60),
    warn2Min: z.number().int().min(1).max(59),
    days: z
      .array(ScheduleDay)
      .length(7)
      .refine((days) => days.every((day, i) => day.weekday === i + 1), {
        message: 'Days must be Monday (1) to Sunday (7), in order.',
      }),
  })
  .refine((s) => s.warn1Min > s.warn2Min, {
    message: 'The first warning must come before the second.',
    path: ['warn2Min'],
  })
  .meta({ id: 'ScheduleInput' });

export type ScheduleInput = z.infer<typeof ScheduleInput>;

export const Schedule = z
  .object({
    version: z.number().int(),
    warn1Min: z.number().int(),
    warn2Min: z.number().int(),
    days: z.array(ScheduleDay),
  })
  .meta({ id: 'Schedule' });

export type Schedule = z.infer<typeof Schedule>;

export const KidContact = z
  .object({
    id: z.uuid(),
    label: z.string(),
    phoneE164: z.string(),
  })
  .meta({ id: 'KidContact' });

export type KidContact = z.infer<typeof KidContact>;

/** Body of PUT /v1/kids/{kidId}/contacts. Replaces the whole list, in this order. */
export const KidContactsPut = z
  .object({
    contacts: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(40),
          phoneE164: PhoneE164,
        }),
      )
      .max(10),
  })
  .meta({ id: 'KidContactsPut' });

export type KidContactsPut = z.infer<typeof KidContactsPut>;
```

### 5.2 `packages/schemas/src/index.ts`

Replace the whole file. New: the exports from `kids.ts`.

```ts
export { AuthResponse, Me, OtpRequest, OtpVerifyRequest, RefreshRequest, Role } from './auth.js';
export { ErrorCode, ErrorResponse } from './errors.js';
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
```

### 5.3 `packages/schemas/test/kids.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { KidContactsPut, KidCreate, ScheduleInput } from '../src/index.js';

const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 90, wake: '07:00', bedtime: '20:30' });
const week = () => [1, 2, 3, 4, 5, 6, 7].map(day);

describe('kid schemas', () => {
  it('needs a trimmed name and one of the 8 avatar colours', () => {
    expect(KidCreate.parse({ name: ' Alex ', avatarColor: '#0F766E' }).name).toBe('Alex');
    expect(KidCreate.safeParse({ name: 'Alex', avatarColor: '#000000' }).success).toBe(false);
    expect(KidCreate.safeParse({ name: ' ', avatarColor: '#0F766E' }).success).toBe(false);
  });

  it('accepts a full week from Monday to Sunday only', () => {
    expect(ScheduleInput.safeParse({ warn1Min: 15, warn2Min: 5, days: week() }).success).toBe(true);
    expect(ScheduleInput.safeParse({ warn1Min: 15, warn2Min: 5, days: week().slice(0, 6) }).success).toBe(false);
    expect(ScheduleInput.safeParse({ warn1Min: 15, warn2Min: 5, days: week().reverse() }).success).toBe(false);
  });

  it('checks allowances, times and warnings', () => {
    const withDay = (patch: object) => ({ warn1Min: 15, warn2Min: 5, days: [{ ...day(1), ...patch }, ...week().slice(1)] });
    expect(ScheduleInput.safeParse(withDay({ wake: '00:00', bedtime: '24:00', screensMin: 1440 })).success).toBe(true);
    expect(ScheduleInput.safeParse(withDay({ screensMin: 1441 })).success).toBe(false);
    expect(ScheduleInput.safeParse(withDay({ phoneMin: 30.5 })).success).toBe(false);
    expect(ScheduleInput.safeParse(withDay({ wake: '7:00' })).success).toBe(false);
    expect(ScheduleInput.safeParse(withDay({ wake: '21:00', bedtime: '20:30' })).success).toBe(false);
    expect(ScheduleInput.safeParse(withDay({ bedtime: '24:30' })).success).toBe(false);
    expect(ScheduleInput.safeParse({ warn1Min: 5, warn2Min: 5, days: week() }).success).toBe(false);
    expect(ScheduleInput.safeParse({ warn1Min: 61, warn2Min: 5, days: week() }).success).toBe(false);
    expect(ScheduleInput.safeParse({ warn1Min: 15, warn2Min: 0, days: week() }).success).toBe(false);
  });

  it('allows up to 10 contacts with international numbers', () => {
    const contact = { label: 'Grandma', phoneE164: '+61412345678' };
    expect(KidContactsPut.safeParse({ contacts: Array(10).fill(contact) }).success).toBe(true);
    expect(KidContactsPut.safeParse({ contacts: Array(11).fill(contact) }).success).toBe(false);
    expect(KidContactsPut.safeParse({ contacts: [{ ...contact, phoneE164: '0412345678' }] }).success).toBe(false);
  });
});
```

### 5.4 `server/src/kids/schedule.ts`

The schedule a new kid starts with. The seed script (5.7) uses it too.

```ts
import type { ScheduleDay } from '@screentime/schemas';

/** Minutes before a lock for the first and second warning (docs/SPEC.md §6.1 schedule_versions). */
export const DEFAULT_WARN1_MIN = 15;
export const DEFAULT_WARN2_MIN = 5;

/**
 * The schedule a new kid starts with: school days 2 h Screens and 1.5 h Phone, 7:00 to 20:30;
 * weekends 3 h and 2 h, 8:00 to 21:00. Parents change it in the app.
 */
export function defaultWeek(): ScheduleDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5
      ? { weekday, screensMin: 120, phoneMin: 90, wake: '07:00', bedtime: '20:30' }
      : { weekday, screensMin: 180, phoneMin: 120, wake: '08:00', bedtime: '21:00' },
  );
}
```

### 5.5 `server/src/kids/routes.ts`

The nine kid operations. Every database statement runs inside `withFamily`. `findKid` answers 404 for a kid that does not exist, is archived, or belongs to another family (row-level security hides those rows, so they look the same).

```ts
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
import { kidContacts, kids, scheduleVersions } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { bearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { DEFAULT_WARN1_MIN, DEFAULT_WARN2_MIN, defaultWeek } from './schedule.js';

type Router = ReturnType<typeof createRouter>;

const KidParam = z.object({ kidId: z.uuid() });

function toKid(row: typeof kids.$inferSelect): Kid {
  return { id: row.id, name: row.name, avatarColor: row.avatarColor as Kid['avatarColor'] };
}

function toSchedule(row: typeof scheduleVersions.$inferSelect): Schedule {
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
async function findKid(tx: FamilyTx, kidId: string) {
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
  description: 'The kid disappears from lists; their history stays.',
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

### 5.6 `server/src/app.ts`

Replace the whole file. New: it registers the kid routes (two lines).

```ts
import { createRoute } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { ErrorResponse, HealthResponse } from '@screentime/schemas';
import { registerAdminRoutes } from './admin/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { registerFamilyRoutes } from './family/routes.js';
import { registerKidRoutes } from './kids/routes.js';
import type { Mailer } from './mailer.js';
import { createRouter } from './router.js';

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

### 5.7 `server/scripts/seed-dev.ts`

Replace the whole file. The only change: the seed's own `week()` function is replaced by `defaultWeek()` from 5.4 (the same schedule).

```ts
// Fills an empty development database with one family, so later cards have data to work with.
// Usage (from the repo root, with DATABASE_URL set): pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts you@example.com
// Never run this against the production database.
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { families, kids, messagePresets, parents, scheduleVersions } from '../src/db/schema.js';
import { DEFAULT_MESSAGE_PRESETS, newParentCodeSecret } from '../src/family/secret.js';
import { defaultWeek } from '../src/kids/schedule.js';

const databaseUrl = process.env.DATABASE_URL;
const email = process.argv[2]?.trim().toLowerCase();
if (!databaseUrl || !email) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/seed-dev.ts <parent-email>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  await runMigrations(db);
  const existing = await db.select().from(parents).where(eq(parents.email, email));
  if (existing.length > 0) {
    console.error(`A parent with email ${email} already exists. Nothing changed.`);
    process.exitCode = 1;
  } else {
    await db.transaction(async (tx) => {
      const [family] = await tx
        .insert(families)
        .values({ name: 'Dev family', timezone: 'Australia/Sydney', parentCodeSecret: newParentCodeSecret() })
        .returning();
      if (!family) throw new Error('family insert returned nothing');
      const [parent] = await tx
        .insert(parents)
        .values({ familyId: family.id, email, displayName: 'Dad' })
        .returning();
      if (!parent) throw new Error('parent insert returned nothing');
      const kidRows = await tx
        .insert(kids)
        .values([
          { familyId: family.id, name: 'Alex', avatarColor: '#0F766E' },
          { familyId: family.id, name: 'Sam', avatarColor: '#7C3AED' },
        ])
        .returning();
      await tx.insert(scheduleVersions).values(
        kidRows.map((kid) => ({ familyId: family.id, kidId: kid.id, version: 1, days: defaultWeek(), createdBy: parent.id })),
      );
      await tx
        .insert(messagePresets)
        .values(DEFAULT_MESSAGE_PRESETS.map((text, sort) => ({ familyId: family.id, text, sort })));
      console.log(`Seeded family ${family.id} with parent ${email} and kids Alex and Sam.`);
    });
  }
} finally {
  await pool.end();
}
```

### 5.8 `server/test/kids.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { families, kids, parents, scheduleVersions } from '../src/db/schema.js';
import { defaultWeek } from '../src/kids/schedule.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const week = (screensMin: number) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, screensMin, phoneMin: 60, wake: '06:30', bedtime: '21:00' }));

describe.skipIf(!url)('kid routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const api = client({ db, config: testConfig(url ?? ''), mailer });

  let mum = { id: '', token: '' };
  let bea = { id: '', token: '' };
  let beasKid = '';

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    const rows = await db
      .insert(parents)
      .values([
        { familyId: a?.id ?? '', email: 'mum@example.com', displayName: 'Mum' },
        { familyId: b?.id ?? '', email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mum = { id: rows[0]?.id ?? '', token: await tokenFor({ parentId: rows[0]?.id ?? '', familyId: a?.id ?? '' }) };
    bea = { id: rows[1]?.id ?? '', token: await tokenFor({ parentId: rows[1]?.id ?? '', familyId: b?.id ?? '' }) };
    beasKid = (await api.post('/v1/kids', bea.token, { name: 'Ben', avatarColor: '#2563EB' })).body.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('needs a parent of a family', async () => {
    expect((await api.get('/v1/kids', null)).status).toBe(401);
    const admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
    expect((await api.get('/v1/kids', admin)).status).toBe(403);
  });

  describe('kids', () => {
    it('adds a kid with the default schedule', async () => {
      const res = await api.post('/v1/kids', mum.token, { name: ' Alex ', avatarColor: '#0F766E' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.any(String), name: 'Alex', avatarColor: '#0F766E' });
      const [version] = await db.select().from(scheduleVersions).where(eq(scheduleVersions.kidId, res.body.id));
      expect(version).toMatchObject({ version: 1, warn1Min: 15, warn2Min: 5, days: defaultWeek(), createdBy: mum.id });
    });

    it('refuses a colour that is not one of the 8', async () => {
      const res = await api.post('/v1/kids', mum.token, { name: 'Sam', avatarColor: '#FFFFFF' });
      expect(res.status).toBe(422);
    });

    it("lists the family's kids, oldest first", async () => {
      await api.post('/v1/kids', mum.token, { name: 'Sam', avatarColor: '#7C3AED' });
      const res = await api.get('/v1/kids', mum.token);
      expect(res.status).toBe(200);
      expect(res.body.map((k: { name: string }) => k.name)).toEqual(['Alex', 'Sam']);
      expect((await api.get('/v1/kids', bea.token)).body.map((k: { name: string }) => k.name)).toEqual(['Ben']);
    });

    it("reads and edits one kid, and cannot see other families' kids", async () => {
      const [alex] = (await api.get('/v1/kids', mum.token)).body;
      expect((await api.get(`/v1/kids/${alex.id}`, mum.token)).body).toEqual(alex);
      const res = await api.patch(`/v1/kids/${alex.id}`, mum.token, { avatarColor: '#DB2777' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...alex, avatarColor: '#DB2777' });
      expect((await api.patch(`/v1/kids/${alex.id}`, mum.token, {})).body).toEqual(res.body);

      const theirs = await api.get(`/v1/kids/${beasKid}`, mum.token);
      expect(theirs.status).toBe(404);
      expect(theirs.body.error).toEqual({ code: 'not_found', message: 'No such kid in your family.' });
      expect((await api.patch(`/v1/kids/${beasKid}`, mum.token, { name: 'Taken' })).status).toBe(404);
      expect((await api.get(`/v1/kids/${randomUUID()}`, mum.token)).status).toBe(404);
      expect((await api.get('/v1/kids/not-a-uuid', mum.token)).status).toBe(422);
    });

    it('archives a kid: hidden everywhere, history kept', async () => {
      const added = (await api.post('/v1/kids', mum.token, { name: 'Old', avatarColor: '#475569' })).body;
      expect((await api.del(`/v1/kids/${added.id}`, mum.token)).status).toBe(204);
      expect((await api.get(`/v1/kids/${added.id}`, mum.token)).status).toBe(404);
      expect((await api.get(`/v1/kids/${added.id}/schedule`, mum.token)).status).toBe(404);
      expect((await api.patch(`/v1/kids/${added.id}`, mum.token, { name: 'Back' })).status).toBe(404);
      expect((await api.del(`/v1/kids/${added.id}`, mum.token)).status).toBe(404);
      expect((await api.get('/v1/kids', mum.token)).body.map((k: { name: string }) => k.name)).toEqual(['Alex', 'Sam']);
      const [row] = await db.select().from(kids).where(eq(kids.id, added.id));
      expect(row?.archivedAt).toBeInstanceOf(Date);
      expect((await api.del(`/v1/kids/${beasKid}`, mum.token)).status).toBe(404);
    });
  });

  describe('schedule', () => {
    it('returns the current version and saves new ones, keeping the old', async () => {
      const [alex] = (await api.get('/v1/kids', mum.token)).body;
      const first = await api.get(`/v1/kids/${alex.id}/schedule`, mum.token);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ version: 1, warn1Min: 15, warn2Min: 5, days: defaultWeek() });
      expect(Object.keys(first.body.days[0])).toEqual(['weekday', 'screensMin', 'phoneMin', 'wake', 'bedtime']);

      const saved = await api.put(`/v1/kids/${alex.id}/schedule`, mum.token, { warn1Min: 10, warn2Min: 2, days: week(90) });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({ version: 2, warn1Min: 10, warn2Min: 2, days: week(90) });
      await api.put(`/v1/kids/${alex.id}/schedule`, mum.token, { warn1Min: 10, warn2Min: 2, days: week(60) });
      expect((await api.get(`/v1/kids/${alex.id}/schedule`, mum.token)).body).toEqual({
        version: 3,
        warn1Min: 10,
        warn2Min: 2,
        days: week(60),
      });
      const versions = await db
        .select()
        .from(scheduleVersions)
        .where(eq(scheduleVersions.kidId, alex.id))
        .orderBy(asc(scheduleVersions.version));
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
      expect(versions[2]?.createdBy).toBe(mum.id);
    });

    it("refuses an invalid schedule or another family's kid", async () => {
      const [alex] = (await api.get('/v1/kids', mum.token)).body;
      const late = week(90).map((d) => ({ ...d, wake: '22:00' }));
      expect((await api.put(`/v1/kids/${alex.id}/schedule`, mum.token, { warn1Min: 10, warn2Min: 2, days: late })).status).toBe(422);
      expect((await api.put(`/v1/kids/${alex.id}/schedule`, mum.token, { warn1Min: 2, warn2Min: 10, days: week(90) })).status).toBe(422);
      expect((await api.get(`/v1/kids/${beasKid}/schedule`, mum.token)).status).toBe(404);
      expect((await api.put(`/v1/kids/${beasKid}/schedule`, mum.token, { warn1Min: 10, warn2Min: 2, days: week(90) })).status).toBe(404);
      expect((await api.get(`/v1/kids/${beasKid}/schedule`, bea.token)).body.version).toBe(1);
    });
  });

  describe('contacts', () => {
    it('starts empty and replaces the whole list, in order', async () => {
      const [alex, sam] = (await api.get('/v1/kids', mum.token)).body;
      expect((await api.get(`/v1/kids/${alex.id}/contacts`, mum.token)).body).toEqual([]);
      await api.put(`/v1/kids/${sam.id}/contacts`, mum.token, { contacts: [{ label: 'Coach', phoneE164: '+61400000003' }] });

      const first = await api.put(`/v1/kids/${alex.id}/contacts`, mum.token, {
        contacts: [
          { label: ' Grandma ', phoneE164: '+61400000001' },
          { label: 'Uncle Tom', phoneE164: '+61400000002' },
        ],
      });
      expect(first.status).toBe(200);
      expect(first.body.map((c: { label: string }) => c.label)).toEqual(['Grandma', 'Uncle Tom']);
      const second = await api.put(`/v1/kids/${alex.id}/contacts`, mum.token, {
        contacts: [{ label: 'Uncle Tom', phoneE164: '+61400000002' }],
      });
      expect(second.body).toEqual([{ id: expect.any(String), label: 'Uncle Tom', phoneE164: '+61400000002' }]);
      expect((await api.get(`/v1/kids/${alex.id}/contacts`, mum.token)).body).toEqual(second.body);
      expect((await api.get(`/v1/kids/${sam.id}/contacts`, mum.token)).body.map((c: { label: string }) => c.label)).toEqual([
        'Coach',
      ]);
    });

    it("refuses more than 10, bad numbers, or another family's kid", async () => {
      const [alex] = (await api.get('/v1/kids', mum.token)).body;
      const contact = { label: 'Friend', phoneE164: '+61400000009' };
      expect((await api.put(`/v1/kids/${alex.id}/contacts`, mum.token, { contacts: Array(11).fill(contact) })).status).toBe(422);
      expect(
        (await api.put(`/v1/kids/${alex.id}/contacts`, mum.token, { contacts: [{ ...contact, phoneE164: '0400 000 009' }] }))
          .status,
      ).toBe(422);
      expect((await api.put(`/v1/kids/${beasKid}/contacts`, mum.token, { contacts: [contact] })).status).toBe(404);
      expect((await api.get(`/v1/kids/${beasKid}/contacts`, mum.token)).status).toBe(404);
    });
  });
});
```

### 5.9 `server/test/openapi.test.ts`

Replace the whole file. New: the fourth test, for the kid routes.

```ts
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

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.10 `contract/openapi.json` (generated)

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
        "description": "The kid disappears from lists; their history stays.",
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

### 6.1 Who may call

Every route needs the Bearer access token of a parent of an enabled family, exactly like the family routes: 401 without a valid token, 403 for a super admin who is not a parent, 401 for a parent who was removed. A parent only ever sees their own family's kids.

### 6.2 Kids

| Operation | Request | Answer | Errors |
|---|---|---|---|
| `GET /v1/kids` | | 200 list of `Kid` `{ id, name, avatarColor }`, oldest first; archived kids are left out | |
| `POST /v1/kids` | `KidCreate`: `name` (trimmed, 1 to 40), `avatarColor` (one of the 8 colours) | 201 `Kid`. In the same transaction, schedule version 1 with the default week (6.3), created by the caller. No contacts. | 422 |
| `GET /v1/kids/{kidId}` | | 200 `Kid` | 404 `No such kid in your family.` (unknown, archived, or another family's), 422 (not a UUID) |
| `PATCH /v1/kids/{kidId}` | `KidPatch`: any of `name`, `avatarColor`. An empty object changes nothing. | 200 `Kid` | 404, 422 |
| `DELETE /v1/kids/{kidId}` | | 204. Sets `archived_at`; nothing is deleted. Every route for this kid then answers 404. | 404, 422 |

### 6.3 Schedule

The default week: Monday (1) to Friday (5) `screensMin` 120, `phoneMin` 90, `wake` `07:00`, `bedtime` `20:30`; Saturday (6) and Sunday (7) 180, 120, `08:00`, `21:00`. Warnings `warn1Min` 15 and `warn2Min` 5.

| Operation | Request | Answer | Errors |
|---|---|---|---|
| `GET /v1/kids/{kidId}/schedule` | | 200 `Schedule` `{ version, warn1Min, warn2Min, days }`: the highest version. Each day has its keys in the order `weekday, screensMin, phoneMin, wake, bedtime`. | 404 |
| `PUT /v1/kids/{kidId}/schedule` | `ScheduleInput` `{ warn1Min, warn2Min, days }`: `warn1Min` 2 to 60 and greater than `warn2Min`; `warn2Min` 1 to 59; exactly 7 days, weekday 1 to 7 in order; minutes are whole numbers 0 to 1440; `wake` before `bedtime`. | 200 `Schedule` with the next version number. Old versions stay in the table. | 404, 409 `The schedule was changed at the same time. Try again.` (two saves raced for one version number), 422 |

### 6.4 Contacts

| Operation | Request | Answer | Errors |
|---|---|---|---|
| `GET /v1/kids/{kidId}/contacts` | | 200 list of `KidContact` `{ id, label, phoneE164 }`, in order | 404 |
| `PUT /v1/kids/{kidId}/contacts` | `KidContactsPut` `{ contacts: [{ label, phoneE164 }] }`: 0 to 10 contacts, `label` trimmed 1 to 40, `phoneE164` like `+61412345678` | 200 the new list, in the order given. The kid's old contacts are deleted; other kids' contacts are not touched. | 404, 422 |

Parents with a phone number are always callable too; they are not stored in this list (SPEC §6.1).

### 6.5 OpenAPI

Every new operation has `security: [{ bearerAuth: [] }]` and lists its error responses, under the tag `kids`. New named schemas: `AvatarColor`, `Kid`, `KidContact`, `KidContactsPut`, `KidCreate`, `KidPatch`, `Schedule`, `ScheduleDay`, `ScheduleInput`.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Check Docker is running (`docker version`). If not, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-012b-kids-and-schedules
   pnpm install --frozen-lockfile
   ```
   `docs/cards/CARD-012b-kids-and-schedules.md` must exist after the pull. If it does not, you did not pull: run `git fetch origin` and `git pull origin main` again.
3. Create 5.1 to 5.3. Run `pnpm --filter @screentime/schemas test` (`Tests  15 passed (15)`). Commit: `CARD-012b: add kid, schedule and contact schemas`.
4. Create or replace 5.4 to 5.7. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-012b: add kid, schedule and contact routes`.
5. Create or replace the tests 5.8 and 5.9. Commit: `CARD-012b: add kid tests`.
6. Run `pnpm contract` (5.10) and compare. Commit: `CARD-012b: regenerate the API contract`.
7. Run the acceptance checks in section 8.
8. Push and open the PR (section 10).
9. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret or SMTP key in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  15 passed (15)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/admin.test.ts (8 tests | 8 skipped)`, `test/auth.test.ts (15 tests | 15 skipped)`, `test/db.test.ts (12 tests | 12 skipped)`, `test/family.test.ts (17 tests | 17 skipped)`, `test/kids.test.ts (10 tests | 10 skipped)`, `test/config.test.ts (7 tests)`, `test/tokens.test.ts (7 tests)`, `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (5 tests)`, `test/health.test.ts (2 tests)`, so `Tests  28 passed | 62 skipped (90)`.
- [ ] `contract/openapi.json` matches 5.10 exactly. Running `pnpm contract` again leaves `git status --short contract` empty. `pnpm --filter @screentime/server db:generate` prints `No schema changes, nothing to migrate` (this card has no migration).
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
  Output: `test/kids.test.ts (10 tests)`, `test/family.test.ts (17 tests)`, `test/admin.test.ts (8 tests)` and `Tests  90 passed (90)`.
- [ ] The routes work on the real stack (the `db` container from the previous check is still running). Start the stack and sign in as the super admin:
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
  Put those 6 digits in place of `123456`, then add a kid, read the schedule and set a contact:
  ```powershell
  $p = Invoke-RestMethod -Method Post http://localhost:8080/v1/auth/otp/verify -ContentType 'application/json' -Body '{"email":"parent@example.com","code":"123456","client":"web","clientLabel":"PowerShell"}'
  $ph = @{ Authorization = "Bearer $($p.accessToken)" }
  $k = Invoke-RestMethod -Method Post http://localhost:8080/v1/kids -Headers $ph -ContentType 'application/json' -Body '{"name":"Alex","avatarColor":"#0F766E"}'
  "$($k.name) $($k.avatarColor)"
  $s = Invoke-RestMethod "http://localhost:8080/v1/kids/$($k.id)/schedule" -Headers $ph
  "$($s.version) $($s.days.Count) $($s.days[0].screensMin) $($s.days[5].bedtime)"
  (Invoke-RestMethod -Method Put "http://localhost:8080/v1/kids/$($k.id)/contacts" -Headers $ph -ContentType 'application/json' -Body '{"contacts":[{"label":"Grandma","phoneE164":"+61400000001"}]}').label
  ```
  The three outputs are `Alex #0F766E`, `1 7 120 21:00` and `Grandma`.
- [ ] Stop the stack and delete the local data: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v`.
- [ ] `git status` does **not** list `deploy/.env`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. They start after you push and take about a minute; wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 10 files (in any order):
  ```
  contract/openapi.json
  packages/schemas/src/index.ts
  packages/schemas/src/kids.ts
  packages/schemas/test/kids.test.ts
  server/scripts/seed-dev.ts
  server/src/app.ts
  server/src/kids/routes.ts
  server/src/kids/schedule.ts
  server/test/kids.test.ts
  server/test/openapi.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/kids.test.ts` | Kid names are trimmed and the colour is one of the 8; a schedule has exactly 7 days, Monday to Sunday in order; minutes are whole numbers 0 to 1440; times are `HH:MM` up to `24:00` and wake is before bedtime; warnings are in range and the first is larger; at most 10 contacts, E.164 numbers only. |
| `server/test/kids.test.ts` | Against a real database: no token 401, super admin 403; adding a kid (201, trimmed name) creates schedule version 1 with the default week; a bad colour is 422; kids are listed oldest first, per family; read and edit a kid (an empty patch changes nothing), another family's kid is 404, an unknown kid 404, a bad id 422; archiving hides the kid from every route and the list but keeps the row; the schedule starts at version 1 with keys in contract order, each PUT adds a version (old ones kept, `created_by` is the parent); invalid schedules are 422 and another family's kid 404; contacts start empty, PUT replaces only that kid's list, in order; 11 contacts or a bad number is 422, another family's kid 404. |
| `server/test/openapi.test.ts` | As before, plus: all 9 kid operations exist with bearer auth, and the 9 new schemas are named; the committed file is up to date. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 6). Message format: `CARD-012b: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-012b-kids-and-schedules`
5. Open a PR into `main` titled `CARD-012b: Kids, schedules and contacts`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-012b-kids-and-schedules --title "CARD-012b: Kids, schedules and contacts" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-012b-kids-and-schedules.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] openapi.json matches the card; pnpm contract is stable; db:generate finds no changes
   - [x] database tests — output: `Tests  90 passed (90)`
   - [x] routes on the real stack — output: `Alex #0F766E`, `1 7 120 21:00`, `Grandma`
   - [x] deploy/.env not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 10 files

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

- **`Module '"@screentime/schemas"' has no exported member 'Kid'`** in the server: run `pnpm build` (the server uses the built schemas package), and check that 5.2 matches the card.
- **`openapi.test.ts` fails with a diff**: run `pnpm contract`. If the new file still differs from 5.10, one of 5.1, 5.2, 5.5 or 5.6 does not match the card. Do not edit `openapi.json` by hand.
- **TypeScript complains about a test name** (`',' expected`): an apostrophe inside a single-quoted string. Copy the line again from the card; those names use double quotes.
- **`db:generate` wants to create a migration**: you changed `server/src/db/schema.ts`. Undo that change (`git checkout main -- server/src/db/schema.ts`) and delete the generated files.
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-012b. Please review and merge if it is good.

CARD: CARD-012b Kids, schedules and contacts
PR: <full PR URL>
Branch: bob/card-012b-kids-and-schedules
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
