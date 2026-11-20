import { createRoute } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { getDomain } from 'tldts';
import { SiteLookupsReceived, SiteLookupsUpload } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { siteDaily, siteLookups } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { errorResponses, deviceBearer, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

const siteLookupsRoute = createRoute({
  method: 'post',
  path: '/v1/device/site-lookups',
  tags: ['device'],
  summary: 'Upload website lookups',
  description:
    'The DNS lookups this device\'s browsers and apps made. A lookup more than 30 days old or more than 1 day ahead is skipped; a repeat adds nothing.',
  security: deviceBearer,
  request: { body: jsonBody(SiteLookupsUpload) },
  responses: { 200: jsonResponse('Stored.', SiteLookupsReceived), ...errorResponses(401, 422) },
});

/** The family's local date of an instant, worked out through the zone (never by adding hours). */
async function localDay(tx: FamilyTx, timezone: string, at: Date): Promise<string> {
  const result = await tx.execute<{ day: string }>(sql`select to_char(${at} at time zone ${timezone}, 'YYYY-MM-DD') as day`);
  return result.rows[0]?.day ?? '';
}

/** Websites of a kid device (docs/SPEC.md §12.10). Any device kind may send them. */
export function registerSiteRoutes(app: Router, deps: AppDeps) {
  const { db } = deps;

  app.openapi(siteLookupsRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const { lookups } = c.req.valid('json');
    // The server's own clock decides what is in range (docs/SPEC.md §9.3).
    const now = new Date();
    const inRange = lookups.filter((l) => {
      const at = new Date(l.at);
      return at >= new Date(now.getTime() - 30 * 86_400_000) && at <= new Date(now.getTime() + 86_400_000);
    });
    const received = await withFamily(db, familyId, async (tx) => {
      const timezone = await timezoneOf(tx, familyId);
      const rows = await tx
        .insert(siteLookups)
        .values(
          inRange.map((l) => ({
            familyId,
            kidId,
            deviceId,
            at: new Date(l.at),
            host: l.host,
            package: l.package,
          })),
        )
        .onConflictDoNothing()
        .returning({ at: siteLookups.at, host: siteLookups.host, package: siteLookups.package });
      // Only the new rows add to the daily totals, in the same transaction (docs/SPEC.md §12.10).
      for (const row of rows) {
        const site = getDomain(row.host) ?? row.host;
        const day = await localDay(tx, timezone, row.at);
        await tx
          .insert(siteDaily)
          .values({
            familyId,
            kidId,
            deviceId,
            day,
            site,
            package: row.package,
            lookups: 1,
            firstAt: row.at,
            lastAt: row.at,
          })
          .onConflictDoUpdate({
            target: [siteDaily.deviceId, siteDaily.day, siteDaily.site, siteDaily.package],
            set: {
              lookups: sql`${siteDaily.lookups} + 1`,
              firstAt: sql`least(${siteDaily.firstAt}, ${row.at})`,
              lastAt: sql`greatest(${siteDaily.lastAt}, ${row.at})`,
            },
          });
      }
      return rows.length;
    });
    return c.json({ received }, 200);
  });
}

/** The family's time zone, read inside the family's transaction. */
async function timezoneOf(tx: FamilyTx, familyId: string): Promise<string> {
  const result = await tx.execute<{ tz: string }>(sql`select timezone as tz from families where id = ${familyId}`);
  if (!result.rows[0]) throw new Error('family vanished after requireDevice');
  return result.rows[0].tz;
}
