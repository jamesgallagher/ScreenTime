import { createRoute } from '@hono/zod-openapi';
import { and, eq, gt, or, sql } from 'drizzle-orm';
import { SearchesReceived, SearchesUpload } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { withFamily } from '../db/family.js';
import { devices, searches } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { deviceBearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const uploadSearchesRoute = createRoute({
  method: 'post',
  path: '/v1/device/searches',
  tags: ['device'],
  summary: 'Upload completed searches',
  description:
    'Completed searches captured on this device. Searches more than 30 days old or more than 1 day ahead are skipped; repeats keep the later time and higher count.',
  security: deviceBearer,
  request: { body: jsonBody(SearchesUpload) },
  responses: { 200: jsonResponse('Stored.', SearchesReceived), ...errorResponses(401, 422) },
});

/** The device's completed searches, plus the state of its search-capture service. */
export function registerSearchRoutes(app: Router, deps: AppDeps) {
  const { db } = deps;

  app.openapi(uploadSearchesRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const body = c.req.valid('json');
    if (body.searches.some((item) => new Date(item.lastAt) < new Date(item.at))) {
      throw new ApiError('validation_failed', 'lastAt must be on or after at.');
    }
    const now = new Date();
    const oldest = new Date(now.getTime() - 30 * 86_400_000);
    const latest = new Date(now.getTime() + 86_400_000);
    const accepted = body.searches.filter((item) => {
      const at = new Date(item.at);
      return at >= oldest && at <= latest;
    });

    const received = await withFamily(db, familyId, async (tx) => {
      await tx
        .update(devices)
        .set({ searchCapture: body.capture, searchCaptureAt: now })
        .where(and(eq(devices.id, deviceId), eq(devices.kidId, kidId)));

      let changed = 0;
      for (const item of accepted) {
        const rows = await tx
          .insert(searches)
          .values({
            familyId,
            kidId,
            deviceId,
            at: new Date(item.at),
            lastAt: new Date(item.lastAt),
            count: item.count,
            engine: item.engine,
            query: item.query,
            package: item.package,
            private: null,
            source: 'android',
          })
          .onConflictDoUpdate({
            target: [searches.deviceId, searches.at, searches.package],
            set: {
              lastAt: sql`greatest(${searches.lastAt}, excluded.last_at)`,
              count: sql`greatest(${searches.count}, excluded.count)`,
            },
            setWhere: or(
              gt(sql`excluded.last_at`, searches.lastAt),
              gt(sql`excluded.count`, searches.count),
            ),
          })
          .returning({ deviceId: searches.deviceId });
        changed += rows.length;
      }
      return changed;
    });
    return c.json({ received }, 200);
  });
}
