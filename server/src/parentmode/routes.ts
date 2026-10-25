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
