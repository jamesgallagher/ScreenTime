import { createRoute } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { DeviceEventUpload } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { withFamily } from '../db/family.js';
import { events } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { notifyParents } from '../notify/dispatch.js';
import { deviceBearer, errorResponses, jsonBody } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const uploadEventsRoute = createRoute({
  method: 'post',
  path: '/v1/device/events',
  tags: ['device'],
  summary: 'Report tamper attempts',
  description:
    'Every event is stored in the history. Parents get one push per kind per upload, for the latest one. An `id` that is already stored is skipped, so sending a queue again is safe.',
  security: deviceBearer,
  request: { body: jsonBody(DeviceEventUpload) },
  responses: { 204: { description: 'Stored.' }, ...errorResponses(401, 422) },
});

/** Tamper events from kid devices (docs/SPEC.md §14, Q20). The device shows the caught screen itself. */
export function registerTamperRoutes(app: Router, deps: AppDeps) {
  const { db } = deps;

  app.openapi(uploadEventsRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    const stored = await withFamily(db, familyId, (tx) =>
      tx
        .insert(events)
        .values(
          body.events.map((e) => ({
            id: e.id,
            familyId,
            kidId,
            deviceId,
            kind: e.kind,
            // A device clock can be ahead; nothing is stored as happening in the future.
            at: sql`least(${e.at}::timestamptz, now())`,
            payload: e.payload ?? {},
          })),
        )
        // An id already stored, by this device or any other, is skipped.
        .onConflictDoNothing({ target: events.id })
        .returning({ id: events.id, kind: events.kind, at: events.at }),
    );
    // Three tray kills in a row are one push, not three: the latest of each kind.
    const latest = new Map<string, { id: string; at: Date }>();
    for (const e of stored) {
      const seen = latest.get(e.kind);
      if (!seen || e.at >= seen.at) latest.set(e.kind, e);
    }
    await notifyParents(deps, familyId, [...latest.values()].map((e) => e.id));
    return c.body(null, 204);
  });
}
