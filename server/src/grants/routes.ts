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
