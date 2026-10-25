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
