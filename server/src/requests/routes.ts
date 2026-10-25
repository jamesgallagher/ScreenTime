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
