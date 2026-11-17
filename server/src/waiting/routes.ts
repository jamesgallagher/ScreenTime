import { createRoute } from '@hono/zod-openapi';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  type TimeRequest,
  TimeRequestStatus,
  WaitingItem,
  WaitingList,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { appRules, devices, events, grants, kidMessages, kids, parentModeSessions, parents, timeRequests } from '../db/schema.js';
import { familyToday } from '../grants/routes.js';
import { bearer, errorResponses, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const getWaitingRoute = createRoute({
  method: 'get',
  path: '/v1/waiting',
  tags: ['waiting'],
  summary: 'Everything that is waiting for a parent',
  description:
    'Pending time requests, pending parent-mode requests, held apps and unseen kid messages, newest first. Archived kids are left out. At most 100 items.',
  security: bearer,
  responses: { 200: jsonResponse('The waiting list.', WaitingList), ...errorResponses(401, 403) },
});

/**
 * A time request that is still pending (after `expireOld` has been run).
 */
async function pendingTimeRequests(tx: FamilyTx, familyId: string): Promise<WaitingItem[]> {
  const { day } = await familyToday(tx, familyId);
  await tx
    .update(timeRequests)
    .set({ status: 'expired' })
    .where(and(eq(timeRequests.status, 'pending'), lt(timeRequests.createdAt, day.dayStart)));

  const rows = await tx
    .select({
      id: timeRequests.id,
      kidId: timeRequests.kidId,
      kidName: kids.name,
      deviceId: timeRequests.deviceId,
      deviceName: devices.name,
      pool: timeRequests.pool,
      minutes: timeRequests.minutes,
      reason: timeRequests.reason,
      status: timeRequests.status,
      createdAt: timeRequests.createdAt,
      resolvedAt: timeRequests.resolvedAt,
      resolvedBy: timeRequests.resolvedBy,
      resolvedByName: parents.displayName,
      grantId: timeRequests.grantId,
      grantedMinutes: grants.minutes,
    })
    .from(timeRequests)
    .innerJoin(kids, eq(kids.id, timeRequests.kidId))
    .innerJoin(devices, eq(devices.id, timeRequests.deviceId))
    .leftJoin(parents, eq(parents.id, timeRequests.resolvedBy))
    .leftJoin(grants, eq(grants.id, timeRequests.grantId))
    .where(and(eq(timeRequests.status, 'pending'), isNull(kids.archivedAt)))
    .orderBy(desc(timeRequests.createdAt), desc(timeRequests.id));

  const requestIds = rows.map((r) => r.id);
  const eventIds = await tx
    .select({ requestId: sql`${events.payload}->>'requestId' as request_id`, eventId: events.id })
    .from(events)
    .where(and(eq(events.kind, 'time_request'), inArray(sql`${events.payload}->>'requestId'`, requestIds)))
    .orderBy(asc(events.at), asc(events.id));
  const eventIdByRequest = new Map(eventIds.map((e) => [e.requestId, e.eventId]));

  return rows.map((r): WaitingItem => ({
    kind: 'time_request',
    id: r.id,
    eventId: eventIdByRequest.get(r.id) ?? null,
    at: r.createdAt.toISOString(),
    kidId: r.kidId,
    kidName: r.kidName,
    deviceId: r.deviceId,
    deviceName: r.deviceName,
    request: {
      id: r.id,
      kidId: r.kidId,
      kidName: r.kidName,
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      pool: r.pool as TimeRequest['pool'],
      minutes: r.minutes,
      reason: r.reason,
      status: r.status as TimeRequestStatus,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedByName: r.resolvedByName,
      grantId: r.grantId,
      grantedMinutes: r.grantedMinutes,
    },
    expiresAt: null,
    package: null,
    label: null,
    source: null,
    body: null,
  }));
}

/**
 * A parent-mode request that is still pending (not started, not ended, requested < 10 minutes ago).
 */
const REQUEST_WAIT = sql`interval '10 minutes'`;

async function pendingParentModeRequests(tx: FamilyTx): Promise<WaitingItem[]> {
  const rows = await tx
    .select({
      id: parentModeSessions.id,
      kidId: parentModeSessions.kidId,
      kidName: kids.name,
      deviceId: parentModeSessions.deviceId,
      deviceName: devices.name,
      requestedAt: parentModeSessions.requestedAt,
    })
    .from(parentModeSessions)
    .innerJoin(kids, eq(kids.id, parentModeSessions.kidId))
    .innerJoin(devices, eq(devices.id, parentModeSessions.deviceId))
    .where(
      and(
        isNull(parentModeSessions.startedAt),
        isNull(parentModeSessions.endedAt),
        gt(parentModeSessions.requestedAt, sql`now() - ${REQUEST_WAIT}`),
        isNull(kids.archivedAt),
      ),
    )
    .orderBy(desc(parentModeSessions.requestedAt), desc(parentModeSessions.id));

  const requestIds = rows.map((r) => r.id);
  const eventIds = await tx
    .select({ requestId: sql`${events.payload}->>'requestId' as request_id`, eventId: events.id })
    .from(events)
    .where(and(eq(events.kind, 'parent_mode.request'), inArray(sql`${events.payload}->>'requestId'`, requestIds)))
    .orderBy(asc(events.at), asc(events.id));
  const eventIdByRequest = new Map(eventIds.map((e) => [e.requestId, e.eventId]));

  return rows.map((r): WaitingItem => ({
    kind: 'parent_mode_request',
    id: r.id,
    eventId: eventIdByRequest.get(r.id) ?? null,
    at: r.requestedAt.toISOString(),
    kidId: r.kidId,
    kidName: r.kidName,
    deviceId: r.deviceId,
    deviceName: r.deviceName,
    request: null,
    // requestedAt + 10 minutes
    expiresAt: new Date(r.requestedAt.getTime() + 10 * 60_000).toISOString(),
    package: null,
    label: null,
    source: null,
    body: null,
  }));
}

/**
 * Apps held for approval (`app_rules.mode = 'held'`).
 */
async function heldApps(tx: FamilyTx): Promise<WaitingItem[]> {
  const rows = await tx
    .select({
      kidId: appRules.kidId,
      kidName: kids.name,
      package: appRules.package,
    })
    .from(appRules)
    .innerJoin(kids, eq(kids.id, appRules.kidId))
    .where(and(eq(appRules.mode, 'held'), isNull(kids.archivedAt)))
    .orderBy(asc(appRules.kidId), asc(appRules.package));

  if (rows.length === 0) return [];

  // One query for the newest `app.approval` event per kid:package.
  const kidIds = [...new Set(rows.map((r) => r.kidId))];
  const events_ = await tx
    .select({
      id: events.id,
      at: events.at,
      kidId: events.kidId,
      deviceId: events.deviceId,
      payload: events.payload,
      package: sql`${events.payload}->>'package'`,
    })
    .from(events)
    .where(and(eq(events.kind, 'app.approval'), inArray(events.kidId, kidIds)))
    .orderBy(desc(events.at), desc(events.id));

  // The newest event per kid:package.
  const eventByKidPackage = new Map<string, typeof events_[number]>();
  for (const e of events_) {
    const pkg = typeof e.package === 'string' ? e.package : null;
    if (!pkg) continue;
    const key = `${e.kidId}:${pkg}`;
    if (!eventByKidPackage.has(key)) eventByKidPackage.set(key, e);
  }

  return rows.map((row): WaitingItem => {
    const event = eventByKidPackage.get(`${row.kidId}:${row.package}`);
    const payload = (event?.payload ?? {}) as Record<string, unknown>;
    const label = typeof payload.label === 'string' ? payload.label : null;
    const source = typeof payload.source === 'string' ? payload.source : null;
    const deviceName = typeof payload.deviceName === 'string' ? payload.deviceName : null;
    const deviceId = event?.deviceId ?? null;
    return {
      kind: 'app_approval',
      id: `${row.kidId}:${row.package}`,
      eventId: event?.id ?? null,
      at: event?.at.toISOString() ?? new Date().toISOString(),
      kidId: row.kidId,
      kidName: row.kidName,
      deviceId,
      deviceName,
      request: null,
      expiresAt: null,
      package: row.package,
      label,
      source,
      body: null,
    };
  });
}

/**
 * Kid messages that have not been seen yet.
 */
async function unseenMessages(tx: FamilyTx): Promise<WaitingItem[]> {
  const rows = await tx
    .select({
      id: kidMessages.id,
      kidId: kidMessages.kidId,
      kidName: kids.name,
      deviceId: kidMessages.deviceId,
      deviceName: devices.name,
      body: kidMessages.body,
      createdAt: kidMessages.createdAt,
    })
    .from(kidMessages)
    .innerJoin(kids, eq(kids.id, kidMessages.kidId))
    .innerJoin(devices, eq(devices.id, kidMessages.deviceId))
    .where(and(isNull(kidMessages.seenAt), isNull(kids.archivedAt)))
    .orderBy(desc(kidMessages.createdAt), desc(kidMessages.id));

  const messageIds = rows.map((r) => r.id);
  const eventIds = await tx
    .select({ messageId: sql`${events.payload}->>'messageId' as message_id`, eventId: events.id })
    .from(events)
    .where(and(eq(events.kind, 'kid_message'), inArray(sql`${events.payload}->>'messageId'`, messageIds)))
    .orderBy(asc(events.at), asc(events.id));
  const eventIdByMessage = new Map(eventIds.map((e) => [e.messageId, e.eventId]));

  return rows.map((r): WaitingItem => ({
    kind: 'kid_message',
    id: r.id,
    eventId: eventIdByMessage.get(r.id) ?? null,
    at: r.createdAt.toISOString(),
    kidId: r.kidId,
    kidName: r.kidName,
    deviceId: r.deviceId,
    deviceName: r.deviceName,
    request: null,
    expiresAt: null,
    package: null,
    label: null,
    source: null,
    body: r.body,
  }));
}

/**
 * "Waiting for you" (docs/SPEC.md §16.4): the server's single call that tells the parent app
 * everything that is waiting for a parent.
 */
export function registerWaitingRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(getWaitingRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const items = await withFamily(db, familyId, async (tx) => {
      const [timeReqs, parentModeReqs, apps, messages] = await Promise.all([
        pendingTimeRequests(tx, familyId),
        pendingParentModeRequests(tx),
        heldApps(tx),
        unseenMessages(tx),
      ]);
      const all = [...timeReqs, ...parentModeReqs, ...apps, ...messages];
      all.sort((a, b) => {
        const cmp = b.at.localeCompare(a.at);
        return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
      });
      return all.slice(0, 100);
    });
    const body = WaitingList.parse({ items });
    return c.json(body, 200);
  });
}
