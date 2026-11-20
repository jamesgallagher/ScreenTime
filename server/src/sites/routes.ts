import { createRoute } from '@hono/zod-openapi';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDomain } from 'tldts';
import {
  SiteClassOverride,
  SiteClassSaved,
  SiteLookupIn,
  SiteLookupsReceived,
  SiteLookupsUpload,
  SiteTitlesReceived,
  SiteTitlesUpload,
} from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { siteDaily, siteLookups, siteOverrides, siteTitles } from '../db/schema.js';
import { requireDevice } from '../devices/auth.js';
import { ApiError } from '../errors.js';
import { bearer, errorResponses, deviceBearer, jsonBody, jsonResponse } from '../openapi.js';
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

const siteTitlesRoute = createRoute({
  method: 'post',
  path: '/v1/device/site-titles',
  tags: ['device'],
  summary: 'Upload browser titles',
  description:
    'The page titles this device\'s browser windows were showing. A title more than 30 days old or more than 1 day ahead is skipped; a repeat adds nothing.',
  security: deviceBearer,
  request: { body: jsonBody(SiteTitlesUpload) },
  responses: { 200: jsonResponse('Stored.', SiteTitlesReceived), ...errorResponses(401, 422) },
});

const SiteParam = z.object({ site: z.string() });

const siteClassPutRoute = createRoute({
  method: 'put',
  path: '/v1/sites/{site}/class',
  tags: ['reports'],
  summary: "A family's own kind and category for a site",
  description: "Replaces the classifier's kind and category for the whole family. `site` must be a host name.",
  security: bearer,
  request: { params: SiteParam, body: jsonBody(SiteClassOverride) },
  responses: { 200: jsonResponse('Saved.', SiteClassSaved), ...errorResponses(401, 403, 422) },
});

const siteClassDeleteRoute = createRoute({
  method: 'delete',
  path: '/v1/sites/{site}/class',
  tags: ['reports'],
  summary: 'Back to the classifier for a site',
  description: "Removes the family's own kind and category, so the classifier's answer shows again. 204 also when there was none.",
  security: bearer,
  request: { params: SiteParam },
  responses: { 204: { description: 'Cleared.' }, ...errorResponses(401, 403, 422) },
});

/** The family's local date of an instant, worked out through the zone (never by adding hours). */
async function localDay(tx: FamilyTx, timezone: string, at: Date): Promise<string> {
  const result = await tx.execute<{ day: string }>(sql`select to_char(${at} at time zone ${timezone}, 'YYYY-MM-DD') as day`);
  return result.rows[0]?.day ?? '';
}

/** 422 unless `site` is the host rule of SiteLookupIn: lower case, no trailing dot, not an IP address. */
function checkSite(site: string): void {
  if (!SiteLookupIn.shape.host.safeParse(site).success) {
    throw new ApiError('validation_failed', 'The site is not a host name.');
  }
}

/** Websites of a kid device (docs/SPEC.md §12.10). Any device kind may send them. */
export function registerSiteRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(siteLookupsRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const { lookups } = c.req.valid('json');
    // The server's own clock decides what is in range (docs/SPEC.md §9.3).
    const now = new Date();
    const inRange = lookups.filter((l) => {
      const at = new Date(l.at);
      return at >= new Date(now.getTime() - 30 * 86_400_000) && at <= new Date(now.getTime() + 86_400_000);
    });
    // Nothing in range (say a phone that was offline for a month): nothing to store. Answering 200 lets the device
    // delete them; an error would make it send the same batch again at every sync, for ever.
    if (inRange.length === 0) return c.json({ received: 0 }, 200);
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
            site: getDomain(l.host) ?? l.host,
            package: l.package,
          })),
        )
        .onConflictDoNothing()
        .returning({ at: siteLookups.at, host: siteLookups.host, site: siteLookups.site, package: siteLookups.package });
      // Only the new rows add to the daily totals, in the same transaction (docs/SPEC.md §12.10).
      const touched = new Map<string, { day: string; site: string; package: string }>();
      for (const row of rows) {
        const site = row.site ?? getDomain(row.host) ?? row.host;
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
            minutes: 0,
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
        touched.set(`${day}\u0000${site}\u0000${row.package}`, { day, site, package: row.package });
      }
      // Active minutes: the distinct minutes of the local day in which this device looked the site up, counted from
      // the raw rows so a minute split across two uploads is still one (docs/SPEC.md §12.10).
      for (const t of touched.values()) {
        await tx.execute(sql`
          update site_daily set minutes = (
            select count(distinct date_trunc('minute', l.at))::int
            from site_lookups l
            where l.device_id = ${deviceId} and l.site = ${t.site} and l.package = ${t.package}
              and l.at >= (${t.day}::date::timestamp at time zone ${timezone})
              and l.at < ((${t.day}::date + 1)::timestamp at time zone ${timezone})
          )
          where device_id = ${deviceId} and day = ${t.day}::date and site = ${t.site} and package = ${t.package}
        `);
      }
      return rows.length;
    });
    return c.json({ received }, 200);
  });

  app.openapi(siteTitlesRoute, async (c) => {
    const { deviceId, kidId, familyId } = await requireDevice(c, db);
    const { titles } = c.req.valid('json');
    // The server's own clock decides what is in range (docs/SPEC.md §9.3).
    const now = new Date();
    const inRange = titles.filter((t) => {
      const at = new Date(t.at);
      return at >= new Date(now.getTime() - 30 * 86_400_000) && at <= new Date(now.getTime() + 86_400_000);
    });
    // Nothing in range: nothing to store. Answering 200 lets the device delete them; an error would make it send
    // the same batch again at every sync, for ever.
    if (inRange.length === 0) return c.json({ received: 0 }, 200);
    const received = await withFamily(db, familyId, async (tx) => {
      const rows = await tx
        .insert(siteTitles)
        .values(
          inRange.map((t) => ({
            familyId,
            kidId,
            deviceId,
            at: new Date(t.at),
            sec: t.sec,
            package: t.package,
            title: t.title,
          })),
        )
        .onConflictDoNothing()
        .returning({ at: siteTitles.at });
      return rows.length;
    });
    return c.json({ received }, 200);
  });

  app.openapi(siteClassPutRoute, async (c) => {
    const { familyId, parentId } = await requireFamilyParent(c, db, config.jwtSecret);
    const site = c.req.param('site');
    checkSite(site);
    const body = c.req.valid('json');
    await withFamily(db, familyId, (tx) =>
      tx
        .insert(siteOverrides)
        .values({ familyId, site, kind: body.kind, category: body.category, parentId })
        .onConflictDoUpdate({
          target: [siteOverrides.familyId, siteOverrides.site],
          set: { kind: body.kind, category: body.category, parentId, setAt: sql`now()` },
        }),
    );
    return c.json({ site, kind: body.kind, category: body.category }, 200);
  });

  app.openapi(siteClassDeleteRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const site = c.req.param('site');
    checkSite(site);
    await withFamily(db, familyId, (tx) =>
      tx.delete(siteOverrides).where(and(eq(siteOverrides.familyId, familyId), eq(siteOverrides.site, site))),
    );
    return c.body(null, 204);
  });
}

/** The family's time zone, read inside the family's transaction. */
async function timezoneOf(tx: FamilyTx, familyId: string): Promise<string> {
  const result = await tx.execute<{ tz: string }>(sql`select timezone as tz from families where id = ${familyId}`);
  if (!result.rows[0]) throw new Error('family vanished after requireDevice');
  return result.rows[0].tz;
}
