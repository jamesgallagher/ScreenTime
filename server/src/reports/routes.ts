import { createRoute } from '@hono/zod-openapi';
import { AppReport, AppReportQuery, SearchReport, SiteReport, SiteReportQuery } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { withFamily } from '../db/family.js';
import { bearer, errorResponses, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { buildAppReport } from './apps.js';
import { buildSearchReport } from './searches.js';
import { buildSiteReport } from './sites.js';

type Router = ReturnType<typeof createRouter>;

const getAppsRoute = createRoute({
  method: 'get',
  path: '/v1/reports/apps',
  tags: ['reports'],
  summary: 'The apps report of a kid or shared device',
  description:
    'Which apps were used and for how long, by day, week (Monday to Sunday) or calendar month, on all devices or one. Removed apps and devices still show. `date` defaults to the family\'s today; one after it, or not a real date, is 422.',
  security: bearer,
  request: { query: AppReportQuery },
  responses: { 200: jsonResponse('The report.', AppReport), ...errorResponses(401, 403, 404, 422) },
});

const getSitesRoute = createRoute({
  method: 'get',
  path: '/v1/reports/sites',
  tags: ['reports'],
  summary: 'The websites report of a kid or shared device',
  description:
    'Which sites the devices looked up and for how long, sorted by the family\'s local LLM, by day, week (Monday to Sunday) or calendar month, on all devices or one. Removed devices still show. `date` defaults to the family\'s today; one after it, or not a real date, is 422.',
  security: bearer,
  request: { query: SiteReportQuery },
  responses: { 200: jsonResponse('The report.', SiteReport), ...errorResponses(401, 403, 404, 422) },
});

const getSearchesRoute = createRoute({
  method: 'get',
  path: '/v1/reports/searches',
  tags: ['reports'],
  summary: 'The searches report of a kid or shared device',
  description:
    'Which completed searches the devices sent, by day, week (Monday to Sunday) or calendar month, on all devices or one. Removed devices with searches still show. `date` defaults to the family\'s today; one after it, or not a real date, is 422.',
  security: bearer,
  request: { query: SiteReportQuery },
  responses: { 200: jsonResponse('The report.', SearchReport), ...errorResponses(401, 403, 404, 422) },
});

/** The apps, websites and searches reports (docs/SPEC.md §§12.9–12.12). */
export function registerReportRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;

  app.openapi(getAppsRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const query = c.req.valid('query');
    const report = await withFamily(db, familyId, (tx) =>
      buildAppReport(tx, {
        kidId: query.kidId,
        period: query.period,
        date: query.date ?? null,
        deviceId: query.deviceId ?? null,
      }),
    );
    return c.json(report, 200);
  });

  app.openapi(getSitesRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const query = c.req.valid('query');
    const report = await withFamily(db, familyId, (tx) =>
      buildSiteReport(tx, {
        kidId: query.kidId,
        period: query.period,
        date: query.date ?? null,
        deviceId: query.deviceId ?? null,
      }),
    );
    return c.json(report, 200);
  });

  app.openapi(getSearchesRoute, async (c) => {
    const { familyId } = await requireFamilyParent(c, db, config.jwtSecret);
    const query = c.req.valid('query');
    const report = await withFamily(db, familyId, (tx) =>
      buildSearchReport(tx, {
        kidId: query.kidId,
        period: query.period,
        date: query.date ?? null,
        deviceId: query.deviceId ?? null,
      }),
    );
    return c.json(report, 200);
  });
}
