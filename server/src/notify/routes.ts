import { createRoute, z } from '@hono/zod-openapi';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  ESSENTIAL_KINDS,
  EventPage,
  NotificationKind,
  NotificationPref,
  NotificationPrefsPut,
  PushTokenPut,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, notificationPrefs, parentSessions } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { bearer, deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { selectEvents } from './dispatch.js';

type Router = ReturnType<typeof createRouter>;

const EventsQuery = z.object({
  kidId: z.uuid().optional(),
  /** An event kind (`overspend`), or the start of one (`sos` matches `sos.started`). */
  kind: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)*$/)
    .max(64)
    .optional(),
  /** `nextBefore` of the previous page. */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const parentPushTokenRoute = createRoute({
  method: 'put',
  path: '/v1/me/push-token',
  tags: ['notifications'],
  summary: "Set this parent app's push token",
  description: 'For the session of the access token. null stops pushes to this app. Signing out also stops them.',
  security: bearer,
  request: { body: jsonBody(PushTokenPut) },
  responses: { 204: { description: 'Saved.' }, ...errorResponses(401, 403, 422) },
});

const getPrefsRoute = createRoute({
  method: 'get',
  path: '/v1/me/notification-prefs',
  tags: ['notifications'],
  summary: 'Which notifications this parent gets',
  description: 'Every kind, in a fixed order. Essential kinds are always on.',
  security: bearer,
  responses: { 200: jsonResponse('The settings.', z.array(NotificationPref)), ...errorResponses(401, 403) },
});

const putPrefsRoute = createRoute({
  method: 'put',
  path: '/v1/me/notification-prefs',
  tags: ['notifications'],
  summary: 'Turn notification kinds on or off',
  description:
    'Kinds left out keep their setting. Turning off an essential kind is refused (422). Muting only stops the push: the history still shows every event.',
  security: bearer,
  request: { body: jsonBody(NotificationPrefsPut) },
  responses: { 200: jsonResponse('Every kind after the change.', z.array(NotificationPref)), ...errorResponses(401, 403, 422) },
});

const devicePushTokenRoute = createRoute({
  method: 'put',
  path: '/v1/device/push-token',
  tags: ['device'],
  summary: "Set this kid device's push token",
  description: 'Android only. null stops pushes to this device.',
  security: deviceBearer,
  request: { body: jsonBody(PushTokenPut) },
  responses: { 204: { description: 'Saved.' }, ...errorResponses(401, 422) },
});

const eventsRoute = createRoute({
  method: 'get',
  path: '/v1/events',
  tags: ['notifications'],
  summary: 'The event history',
  description:
    'Newest first, every kind (muted ones too), archived kids included. `limit` defaults to 50. For the next page pass `nextBefore` as `before`.',
  security: bearer,
  request: { query: EventsQuery },
  responses: { 200: jsonResponse('One page of events.', EventPage), ...errorResponses(401, 403, 422) },
});

const KIND_NAME: Record<NotificationKind, string> = {
  sos: 'SOS',
  tamper: 'Tamper',
  'parent_mode.request': 'Parent mode request',
  'parent_mode.used': 'Parent mode used',
  time_request: 'Ask for more time',
  kid_message: 'Messages',
  overspend: 'Offline overspend',
  'device.offline': 'Device offline',
  'device.enrolled': 'Device added',
  'grant.by_other_parent': 'Time changed by another parent',
};

/** Every kind for one parent: a missing row means on, and essential kinds are always on. */
async function prefsOf(tx: FamilyTx, parentId: string): Promise<NotificationPref[]> {
  const rows = await tx.select().from(notificationPrefs).where(eq(notificationPrefs.parentId, parentId));
  return NotificationKind.options.map((kind) => {
    const essential = ESSENTIAL_KINDS.includes(kind);
    const row = rows.find((r) => r.kind === kind);
    return { kind, enabled: essential || (row?.enabled ?? true), essential };
  });
}

/** Push tokens, notification settings and the event history (docs/SPEC.md §9.2, §9.3, §13). */
export function registerNotifyRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  app.openapi(parentPushTokenRoute, async (c) => {
    const { familyId, parentId, sessionId } = await caller(c);
    const { fcmToken } = c.req.valid('json');
    const saved = await withFamily(db, familyId, async (tx) => {
      if (fcmToken) {
        // The same phone signed in again: only the newest session keeps the token, so it gets each push once.
        await tx
          .update(parentSessions)
          .set({ fcmToken: null })
          .where(and(eq(parentSessions.fcmToken, fcmToken), ne(parentSessions.id, sessionId)));
      }
      return tx
        .update(parentSessions)
        .set({ fcmToken })
        .where(and(eq(parentSessions.id, sessionId), eq(parentSessions.parentId, parentId), isNull(parentSessions.revokedAt)))
        .returning({ id: parentSessions.id });
    });
    if (saved.length === 0) throw new ApiError('unauthorized', 'Sign in again.');
    return c.body(null, 204);
  });

  app.openapi(getPrefsRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const prefs = await withFamily(db, familyId, (tx) => prefsOf(tx, parentId));
    return c.json(prefs, 200);
  });

  app.openapi(putPrefsRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const body = c.req.valid('json');
    const essentialOff = body.find((p) => !p.enabled && ESSENTIAL_KINDS.includes(p.kind));
    if (essentialOff) throw new ApiError('validation_failed', `${KIND_NAME[essentialOff.kind]} notifications cannot be turned off.`);
    const prefs = await withFamily(db, familyId, async (tx) => {
      await tx
        .insert(notificationPrefs)
        .values(body.map((p) => ({ familyId, parentId, kind: p.kind, enabled: p.enabled })))
        .onConflictDoUpdate({
          target: [notificationPrefs.parentId, notificationPrefs.kind],
          set: { enabled: sql`excluded.enabled` },
        });
      return prefsOf(tx, parentId);
    });
    return c.json(prefs, 200);
  });

  app.openapi(devicePushTokenRoute, async (c) => {
    const { familyId, deviceId } = await requireDevice(c, db);
    const { fcmToken } = c.req.valid('json');
    await withFamily(db, familyId, async (tx) => {
      if (fcmToken) {
        await tx
          .update(devices)
          .set({ fcmToken: null })
          .where(and(eq(devices.fcmToken, fcmToken), ne(devices.id, deviceId)));
      }
      await tx.update(devices).set({ fcmToken }).where(eq(devices.id, deviceId));
    });
    return c.body(null, 204);
  });

  app.openapi(eventsRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId, kind, before, limit } = c.req.valid('query');
    const rows = await withFamily(db, familyId, (tx) =>
      selectEvents(
        tx,
        and(
          kidId ? eq(events.kidId, kidId) : undefined,
          kind ? sql`(${events.kind} = ${kind} or starts_with(${events.kind}, ${`${kind}.`}))` : undefined,
          before
            ? sql`(${events.at}, ${events.id}) < (select e.at, e.id from ${events} e where e.id = ${before})`
            : undefined,
        ),
        limit + 1,
      ),
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return c.json({ events: page, nextBefore: rows.length > limit && last ? last.id : null }, 200);
  });
}
