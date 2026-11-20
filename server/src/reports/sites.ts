import { and, asc, eq, gte, inArray, lt, notInArray, sql } from 'drizzle-orm';
import {
  SiteReport as SiteReportSchema,
  type ReportPeriod,
  type SiteCategory,
  type SiteClassSource,
  type SiteKind,
  type SiteReport,
  type SiteReportCategory,
  type SiteReportDevice,
  type SiteReportPage,
  type SiteReportSearch,
  type SiteReportSite,
} from '@screentime/schemas';
import type { FamilyTx } from '../db/family.js';
import {
  deviceApps,
  devicePrograms,
  devices,
  families,
  siteClasses,
  siteDaily,
  siteOverrides,
  siteTitles,
} from '../db/schema.js';
import { ApiError } from '../errors.js';
import { ECHO_PACKAGES, isBrowser } from '../sites/packages.js';
import {
  addDays,
  familyToday,
  findKid,
  isRealDate,
  labelOf,
  periodInstants,
  periodRange,
  reportDeviceList,
} from './apps.js';
import { parseTitle } from './titles.js';

type DeviceRow = typeof devices.$inferSelect;
type SiteDailyRow = typeof siteDaily.$inferSelect;

interface SiteAggregate {
  site: string;
  minutes: number;
  lookups: number;
  days: Set<string>;
  firstAt: Date;
  lastAt: Date;
  apps: Map<string, number>;
  devices: Map<string, number>;
}

/**
 * Builds the websites report of one kid or shared device (docs/SPEC.md §12.10, CARD-070). The only place the
 * numbers are worked out: the route and the dev script call it. No Hono, no request.
 */
export async function buildSiteReport(
  tx: FamilyTx,
  query: { kidId: string; period: ReportPeriod; date: string | null; deviceId: string | null },
): Promise<SiteReport> {
  const [family] = await tx.select({ id: families.id, timezone: families.timezone }).from(families);
  if (!family) throw new Error('no family in the transaction');

  const kid = await findKid(tx, query.kidId);
  const today = await familyToday(tx, family.timezone);
  const date = query.date ?? today;
  if (!isRealDate(date)) throw new ApiError('validation_failed', 'The date is not a real date.');
  if (date > today) throw new ApiError('validation_failed', 'The date is after today.');
  const { from, to } = periodRange(query.period, date);

  const allDevices = await tx
    .select()
    .from(devices)
    .where(eq(devices.kidId, kid.id))
    .orderBy(asc(devices.enrolledAt), asc(devices.id));
  if (query.deviceId !== null && !allDevices.some((d) => d.id === query.deviceId)) {
    throw new ApiError('not_found', "That device is not one of this kid's.");
  }

  const { start, end } = await periodInstants(tx, family.timezone, from, to);
  // The devices list is the report's devices either way, so a page keeps its chips when one is chosen.
  const reportDevices = allDevices.length === 0 ? [] : await siteReportDevices(tx, kid.id, allDevices, from, to, start, end);
  const inReport = query.deviceId !== null ? reportDevices.filter((d) => d.id === query.deviceId) : reportDevices;
  const ids = inReport.map((d) => d.id);

  // Which devices have ever sent a website lookup (a PC on a version before CARD-069 has not).
  const recorded = new Set(
    (await tx.select({ deviceId: siteDaily.deviceId }).from(siteDaily).where(eq(siteDaily.kidId, kid.id))).map(
      (r) => r.deviceId,
    ),
  );
  const deviceList: SiteReportDevice[] = reportDevices.map((d) => ({
    deviceId: d.id,
    name: d.name,
    form: d.form as SiteReportDevice['form'],
    platform: d.platform as SiteReportDevice['platform'],
    removedAt: d.revokedAt?.toISOString() ?? null,
    sitesRecorded: recorded.has(d.id),
  }));

  const aggregates = await siteAggregates(tx, kid.id, ids, from, to);
  const classRows =
    aggregates.length === 0
      ? []
      : await tx.select().from(siteClasses).where(inArray(siteClasses.site, aggregates.map((a) => a.site)));
  const classBySite = new Map(classRows.map((r) => [r.site, r]));
  const overrideRows =
    aggregates.length === 0
      ? []
      : await tx
          .select()
          .from(siteOverrides)
          .where(and(eq(siteOverrides.familyId, family.id), inArray(siteOverrides.site, aggregates.map((a) => a.site))));
  const overrideBySite = new Map(overrideRows.map((r) => [r.site, r]));

  const labels = await packageLabels(tx, kid.id, ids);
  const deviceOrder = new Map(ids.map((id, i) => [id, i]));

  const made: SiteReportSite[] = aggregates.map((a) => {
    const label = classBySite.get(a.site)?.label ?? null;
    const owner = classBySite.get(a.site)?.owner ?? null;
    const override = overrideBySite.get(a.site);
    const state = classBySite.get(a.site);
    const kind: SiteKind | null = override ? (override.kind as SiteKind) : ((state?.kind as SiteKind | null) ?? null);
    const category: SiteCategory | null = override
      ? (override.category as SiteCategory)
      : ((state?.category as SiteCategory | null) ?? null);
    const source: SiteClassSource | null = override ? 'parent' : state?.kind ? (state.familyDnsBlocked ? 'family_dns' : 'classifier') : null;
    const apps = [...a.apps.entries()]
      .map(([pkg, minutes]) => ({ package: pkg, label: labels.get(pkg) ?? pkg, browser: isBrowser(pkg), minutes }))
      .sort((x, y) => y.minutes - x.minutes || x.label.localeCompare(y.label));
    const list = [...a.devices.entries()]
      .sort((x, y) => (deviceOrder.get(x[0]) ?? 0) - (deviceOrder.get(y[0]) ?? 0))
      .map(([deviceId, minutes]) => ({ deviceId, minutes }));
    return {
      site: a.site,
      label,
      kind,
      category,
      source,
      owner,
      minutes: a.minutes,
      lookups: a.lookups,
      days: a.days.size,
      firstAt: a.firstAt.toISOString(),
      lastAt: a.lastAt.toISOString(),
      apps,
      devices: list,
    };
  });

  const order = (x: SiteReportSite, y: SiteReportSite) =>
    y.minutes - x.minutes || y.lookups - x.lookups || x.site.localeCompare(y.site);
  const shown = made.filter((s) => !isBehindTheScenes(s.kind)).sort(order);
  const behind = made.filter((s) => isBehindTheScenes(s.kind)).sort(order);

  const titles = await titleParts(tx, kid.id, ids, start, end);

  return SiteReportSchema.parse({
    kidId: kid.id,
    period: query.period,
    from,
    to,
    today,
    deviceId: query.deviceId,
    devices: deviceList,
    categories: categoryTotals(shown),
    sites: shown,
    behindTheScenes: behind,
    browserSec: titles.browserSec,
    privateSec: titles.privateSec,
    searches: titles.searches,
    pages: titles.pages,
    titlesKeptFrom: addDays(today, -89),
  });
}

/** CDNs, ads and tracking and app services fold away: a lookup of them is not a visit. */
function isBehindTheScenes(kind: SiteKind | null): boolean {
  return kind === 'cdn' || kind === 'ads_tracking' || kind === 'app_service';
}

/** Active minutes per category over `sites` (null: not sorted yet), most minutes first, then by category, null last. */
function categoryTotals(sites: SiteReportSite[]): SiteReportCategory[] {
  const totals = new Map<SiteCategory | null, SiteReportCategory>();
  for (const s of sites) {
    const total = totals.get(s.category) ?? { category: s.category, minutes: 0, sites: 0 };
    total.minutes += s.minutes;
    total.sites += 1;
    totals.set(s.category, total);
  }
  return [...totals.values()].sort((a, b) => {
    if (b.minutes !== a.minutes) return b.minutes - a.minutes;
    if (a.category === b.category) return 0;
    if (a.category === null) return 1;
    if (b.category === null) return -1;
    return a.category.localeCompare(b.category);
  });
}

/**
 * The report's devices when `deviceId` is not given: every one not removed, plus each removed one with a `site_daily`
 * row in `from..to` or a `site_titles` row in the period.
 */
async function siteReportDevices(
  tx: FamilyTx,
  kidId: string,
  allDevices: DeviceRow[],
  from: string,
  to: string,
  start: Date,
  end: Date,
): Promise<DeviceRow[]> {
  const active = allDevices.filter((d) => d.revokedAt === null);
  const removed = allDevices.filter((d) => d.revokedAt !== null);
  if (removed.length === 0) return active;

  const removedIds = removed.map((d) => d.id);
  const withDaily = new Set(
    (
      await tx
        .select({ deviceId: siteDaily.deviceId })
        .from(siteDaily)
        .where(
          and(
            eq(siteDaily.kidId, kidId),
            inArray(siteDaily.deviceId, removedIds),
            sql`${siteDaily.day} between ${from} and ${to}`,
          ),
        )
    ).map((r) => r.deviceId),
  );
  const withTitles = new Set(
    (
      await tx
        .select({ deviceId: siteTitles.deviceId })
        .from(siteTitles)
        .where(
          and(
            eq(siteTitles.kidId, kidId),
            inArray(siteTitles.deviceId, removedIds),
            gte(siteTitles.at, start),
            lt(siteTitles.at, end),
          ),
        )
    ).map((r) => r.deviceId),
  );
  return reportDeviceList(allDevices, new Set([...withDaily, ...withTitles]));
}

/** The `site_daily` rows of the report's devices in `from..to`, echo packages left out, added up per site. */
async function siteAggregates(tx: FamilyTx, kidId: string, ids: string[], from: string, to: string): Promise<SiteAggregate[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select()
    .from(siteDaily)
    .where(
      and(
        eq(siteDaily.kidId, kidId),
        inArray(siteDaily.deviceId, ids),
        sql`${siteDaily.day} between ${from} and ${to}`,
        notInArray(siteDaily.package, ECHO_PACKAGES),
      ),
    );
  const bySite = new Map<string, SiteAggregate>();
  for (const row of rows) {
    const a =
      bySite.get(row.site) ?? aggregateOf(row);
    a.minutes += row.minutes;
    a.lookups += row.lookups;
    a.days.add(row.day);
    if (row.firstAt < a.firstAt) a.firstAt = row.firstAt;
    if (row.lastAt > a.lastAt) a.lastAt = row.lastAt;
    a.apps.set(row.package, (a.apps.get(row.package) ?? 0) + row.minutes);
    a.devices.set(row.deviceId, (a.devices.get(row.deviceId) ?? 0) + row.minutes);
    bySite.set(row.site, a);
  }
  return [...bySite.values()];
}

function aggregateOf(row: SiteDailyRow): SiteAggregate {
  return {
    site: row.site,
    minutes: 0,
    lookups: 0,
    days: new Set(),
    firstAt: row.firstAt,
    lastAt: row.lastAt,
    apps: new Map(),
    devices: new Map(),
  };
}

/**
 * The label of each package, as in the Apps report: `device_apps` on the report's devices, else `device_programs`
 * there, else either on any of the kid's devices, else the package.
 */
async function packageLabels(tx: FamilyTx, kidId: string, ids: string[]): Promise<Map<string, string>> {
  const appRows = ids.length
    ? await tx.select().from(deviceApps).where(and(eq(deviceApps.kidId, kidId), inArray(deviceApps.deviceId, ids)))
    : [];
  const allAppRows = await tx.select().from(deviceApps).where(eq(deviceApps.kidId, kidId));
  const programRows = ids.length
    ? await tx
        .select()
        .from(devicePrograms)
        .where(and(eq(devicePrograms.kidId, kidId), inArray(devicePrograms.deviceId, ids)))
    : [];
  const allProgramRows = await tx.select().from(devicePrograms).where(eq(devicePrograms.kidId, kidId));

  const group = <T extends { package: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.package, [...(map.get(row.package) ?? []), row]);
    return map;
  };
  const onReport = group(appRows);
  const onReportPrograms = group(programRows);
  const onAny = group(allAppRows);
  const onAnyPrograms = group(allProgramRows);

  const labels = new Map<string, string>();
  for (const pkg of new Set([...onReport.keys(), ...onReportPrograms.keys(), ...onAny.keys(), ...onAnyPrograms.keys()])) {
    labels.set(
      pkg,
      labelOf(onReport.get(pkg), onReportPrograms.get(pkg), onAny.get(pkg), onAnyPrograms.get(pkg), pkg),
    );
  }
  return labels;
}

/** The searches, pages and browser time of the report's PCs (docs/SPEC.md §12.10 "Title rules"). */
async function titleParts(
  tx: FamilyTx,
  kidId: string,
  ids: string[],
  start: Date,
  end: Date,
): Promise<{ browserSec: number; privateSec: number; searches: SiteReportSearch[]; pages: SiteReportPage[] }> {
  if (ids.length === 0) return { browserSec: 0, privateSec: 0, searches: [], pages: [] };
  const rows = await tx
    .select()
    .from(siteTitles)
    .where(
      and(
        eq(siteTitles.kidId, kidId),
        inArray(siteTitles.deviceId, ids),
        gte(siteTitles.at, start),
        lt(siteTitles.at, end),
      ),
    );

  let browserSec = 0;
  let privateSec = 0;
  const searches = new Map<string, { engine: SiteReportSearch['engine']; query: string; sec: number; private: boolean; firstAt: Date; deviceId: string }>();
  const pages = new Map<string, SiteReportPage>();
  for (const row of rows) {
    const parsed = parseTitle(row.package, row.title);
    browserSec += row.sec;
    if (parsed.private) privateSec += row.sec;

    if (parsed.search) {
      const key = `${parsed.search.engine}\u0000${parsed.search.query.toLowerCase().trim()}`;
      const found = searches.get(key);
      if (!found) {
        searches.set(key, {
          engine: parsed.search.engine,
          query: parsed.search.query,
          sec: row.sec,
          private: parsed.private,
          firstAt: row.at,
          deviceId: row.deviceId,
        });
      } else {
        found.sec += row.sec;
        found.private ||= parsed.private;
        if (row.at < found.firstAt) {
          found.firstAt = row.at;
          found.deviceId = row.deviceId;
          found.query = parsed.search.query;
        }
      }
    } else if (parsed.page) {
      const key = `${row.package}\u0000${parsed.page}`;
      const found = pages.get(key);
      if (!found) pages.set(key, { page: parsed.page, package: row.package, sec: row.sec, private: parsed.private });
      else {
        found.sec += row.sec;
        found.private ||= parsed.private;
      }
    }
  }

  return {
    browserSec,
    privateSec,
    searches: [...searches.values()]
      .sort((a, b) => b.firstAt.getTime() - a.firstAt.getTime())
      .slice(0, 200)
      .map((s) => ({ ...s, firstAt: s.firstAt.toISOString() })),
    pages: [...pages.values()].sort((a, b) => b.sec - a.sec || a.page.localeCompare(b.page)).slice(0, 50),
  };
}
