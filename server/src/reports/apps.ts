import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppReport as AppReportSchema, type AppReport, type AppReportApp, type AppReportDevice, type AppReportPool, type Pool, type ReportPeriod } from '@screentime/schemas';
import type { FamilyTx } from '../db/family.js';
import { appUsageDaily, deviceApps, devices, families, kids, usageSegments } from '../db/schema.js';
import { ApiError } from '../errors.js';

/**
 * Builds the apps report of one kid or shared device (docs/SPEC.md §12.9, CARD-066). The only place the numbers are
 * worked out: the route and the dev script call it, and a later email phase will too. No Hono, no request.
 */
export async function buildAppReport(
  tx: FamilyTx,
  query: { kidId: string; period: ReportPeriod; date: string | null; deviceId: string | null },
): Promise<AppReport> {
  const [family] = await tx.select({ timezone: families.timezone }).from(families);
  if (!family) throw new Error('no family in the transaction');

  const kid = await findKid(tx, query.kidId);
  const today = await familyToday(tx, family.timezone);
  const date = query.date ?? today;
  if (!isRealDate(date)) throw new ApiError('validation_failed', 'The date is not a real date.');
  if (date > today) throw new ApiError('validation_failed', 'The date is after today.');
  const { from, to } = periodRange(query.period, date);

  // The kid's devices, oldest enrolment first.
  const allDevices = await tx
    .select()
    .from(devices)
    .where(eq(devices.kidId, kid.id))
    .orderBy(asc(devices.enrolledAt), asc(devices.id));
  if (allDevices.length === 0) throw new ApiError('not_found', 'No such kid in your family.');

  // A given deviceId must be one of the kid's devices, removed ones too.
  if (query.deviceId !== null && !allDevices.some((d) => d.id === query.deviceId)) {
    throw new ApiError('not_found', 'That device is not one of this kid\'s.');
  }

  // The period's instants: local midnight of `from` to local midnight after `to`, through the time zone.
  const { start, end } = await periodInstants(tx, family.timezone, from, to);
  const now = new Date();

  // The devices in the report: with a deviceId, just it; without, every not-removed one, plus each removed one
  // that has app time or a segment in the period.
  const inReport = query.deviceId !== null ? allDevices.filter((d) => d.id === query.deviceId) : await reportDevices(tx, kid.id, allDevices, start, end, from, to);
  const inReportIds = new Set(inReport.map((d) => d.id));

  // screenTime: one entry per pool a device in the report belongs to, Screens first, each the union length.
  const screenTime = await poolScreenTime(tx, kid.id, inReport, family.timezone, start, end, now);

  // apps: app_usage_daily rows of the report's devices with day in from..to, summed per package.
  const apps = await reportApps(tx, kid.id, inReport, from, to);

  return AppReportSchema.parse({
    kidId: kid.id,
    period: query.period,
    from,
    to,
    today,
    deviceId: query.deviceId,
    devices: allDevices.map((d) => ({
      deviceId: d.id,
      name: d.name,
      form: d.form as AppReportDevice['form'],
      platform: d.platform as AppReportDevice['platform'],
      removedAt: d.revokedAt?.toISOString() ?? null,
      appsRecorded: d.platform === 'android',
    })),
    screenTime,
    apps,
  });
}

/** The kid, or 404. An archived kid still answers. Row-level security hides other families. */
async function findKid(tx: FamilyTx, kidId: string) {
  const [row] = await tx.select().from(kids).where(eq(kids.id, kidId));
  if (!row) throw new ApiError('not_found', 'No such kid in your family.');
  return row;
}

/** The family's today, YYYY-MM-DD. */
async function familyToday(tx: FamilyTx, timezone: string): Promise<string> {
  const result = await tx.execute<{ date: string }>(sql`
    select to_char((now() at time zone ${timezone})::date, 'YYYY-MM-DD') as date
  `);
  return result.rows[0]?.date ?? '';
}

/** True when `date` is a real YYYY-MM-DD date. */
function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return d.toISOString().slice(0, 10) === date;
}

/** The first and last day of the period holding `date`: the day itself, Monday to Sunday, or the calendar month. */
function periodRange(period: ReportPeriod, date: string): { from: string; to: string } {
  if (period === 'day') return { from: date, to: date };
  if (period === 'week') {
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
    const from = addDays(date, -weekday);
    return { from, to: addDays(from, 6) };
  }
  const from = `${date.slice(0, 8)}01`;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
}

/** `date` plus `days`, YYYY-MM-DD. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The instants of local midnight at the start of `from` and of the day after `to`, through the time zone
 * (daylight saving makes some days 23 or 25 hours).
 */
async function periodInstants(tx: FamilyTx, timezone: string, from: string, to: string): Promise<{ start: Date; end: Date }> {
  const result = await tx.execute<{ start: string; end: string }>(sql`
    select to_json(${from}::date::timestamp at time zone ${timezone}) #>> '{}' as start,
           to_json((${to}::date + 1)::timestamp at time zone ${timezone}) #>> '{}' as end
  `);
  return { start: new Date(result.rows[0]?.start ?? ''), end: new Date(result.rows[0]?.end ?? '') };
}

/**
 * The devices in the report when `deviceId` is not given: every one not removed, plus each removed one with any
 * app time in the period or any segment overlapping it.
 */
async function reportDevices(
  tx: FamilyTx,
  kidId: string,
  allDevices: typeof devices.$inferSelect[],
  start: Date,
  end: Date,
  from: string,
  to: string,
) {
  const active = allDevices.filter((d) => d.revokedAt === null);
  const removed = allDevices.filter((d) => d.revokedAt !== null);
  if (removed.length === 0) return active;

  const removedIds = removed.map((d) => d.id);
  // App time in the period.
  const withAppTime = new Set(
    (
      await tx
        .select({ deviceId: appUsageDaily.deviceId })
        .from(appUsageDaily)
        .where(and(eq(appUsageDaily.kidId, kidId), inArray(appUsageDaily.deviceId, removedIds), sql`${appUsageDaily.day} between ${from} and ${to}`))
    ).map((r) => r.deviceId),
  );
  // A segment overlapping the period.
  const withSegment = new Set(
    (
      await tx
        .select({ deviceId: usageSegments.deviceId })
        .from(usageSegments)
        .where(
          and(
            eq(usageSegments.kidId, kidId),
            inArray(usageSegments.deviceId, removedIds),
            sql`${usageSegments.startedAt} < ${end.toISOString()}::timestamptz`,
            sql`(coalesce(${usageSegments.endedAt}, ${end.toISOString()}::timestamptz) > ${start.toISOString()}::timestamptz)`,
          ),
        )
    ).map((r) => r.deviceId),
  );

  return [...active, ...removed.filter((d) => withAppTime.has(d.id) || withSegment.has(d.id))];
}

/**
 * One entry per pool a device in the report belongs to, Screens first, each the length of the union of the report's
 * devices' segments in that pool, clipped to the period and to now, in whole seconds.
 */
async function poolScreenTime(
  tx: FamilyTx,
  kidId: string,
  inReport: typeof devices.$inferSelect[],
  timezone: string,
  start: Date,
  end: Date,
  now: Date,
): Promise<AppReportPool[]> {
  const pools = [...new Set(inReport.map((d) => d.pool as Pool))].sort((a, b) => (a === 'screens' ? 0 : 1) - (b === 'screens' ? 0 : 1));
  const ids = inReport.map((d) => d.id);
  if (ids.length === 0 || pools.length === 0) return [];

  // An open segment ends at its device's last_seen_at, never before its own start, never after now.
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const rows = await tx
    .select({
      pool: usageSegments.pool,
      startedAt: usageSegments.startedAt,
      endedAt: sql`coalesce(${usageSegments.endedAt}, greatest(${devices.lastSeenAt}, ${usageSegments.startedAt}))`.mapWith(usageSegments.endedAt),
    })
    .from(usageSegments)
    .innerJoin(devices, eq(devices.id, usageSegments.deviceId))
    .where(
      and(
        eq(usageSegments.kidId, kidId),
        inArray(usageSegments.deviceId, ids),
        sql`${usageSegments.startedAt} < ${endIso}::timestamptz`,
        sql`coalesce(${usageSegments.endedAt}, greatest(${devices.lastSeenAt}, ${usageSegments.startedAt})) > ${startIso}::timestamptz`,
      ),
    );

  // Merge the clipped segments per pool into the union length.
  const byPool = new Map<Pool, { start: Date; end: Date }[]>();
  for (const r of rows) {
    // Clip to the period.
    const s = r.startedAt < start ? start : r.startedAt;
    const e = r.endedAt !== null && r.endedAt > end ? end : r.endedAt;
    if (e <= s) continue;
    byPool.set(r.pool as Pool, [...(byPool.get(r.pool as Pool) ?? []), { start: s, end: e }]);
  }
  return pools
    .map((pool) => ({ pool, usedSec: unionSec(byPool.get(pool) ?? []) }))
    .filter((p) => p.usedSec > 0 || true);
}

/** The length of the union of intervals, in whole seconds (rounded down). */
function unionSec(intervals: { start: Date; end: Date }[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  let total = 0;
  let curStart = sorted[0]!.start;
  let curEnd = sorted[0]!.end;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (next.start <= curEnd) {
      curEnd = next.end > curEnd ? next.end : curEnd;
    } else {
      total += (curEnd.getTime() - curStart.getTime()) / 1000;
      curStart = next.start;
      curEnd = next.end;
    }
  }
  total += (curEnd.getTime() - curStart.getTime()) / 1000;
  return Math.floor(total);
}

/**
 * The apps of the report's devices: app_usage_daily rows with day in from..to, summed per package, only packages
 * with a total > 0, ordered by totalSec descending, then label, then package.
 */
async function reportApps(
  tx: FamilyTx,
  kidId: string,
  inReport: typeof devices.$inferSelect[],
  from: string,
  to: string,
): Promise<AppReportApp[]> {
  const ids = inReport.map((d) => d.id);
  if (ids.length === 0) return [];

  const usage = await tx
    .select({
      package: appUsageDaily.package,
      deviceId: appUsageDaily.deviceId,
      sec: sql<number>`sum(${appUsageDaily.seconds})::int`,
    })
    .from(appUsageDaily)
    .where(and(eq(appUsageDaily.kidId, kidId), inArray(appUsageDaily.deviceId, ids), sql`${appUsageDaily.day} between ${from} and ${to}`))
    .groupBy(appUsageDaily.package, appUsageDaily.deviceId);

  const byPackage = new Map<string, { total: number; perDevice: Map<string, number> }>();
  for (const r of usage) {
    const entry = byPackage.get(r.package) ?? { total: 0, perDevice: new Map() };
    entry.total += r.sec;
    entry.perDevice.set(r.deviceId, r.sec);
    byPackage.set(r.package, entry);
  }

  // device_apps rows of the report's devices, for labels, installedAt and removedAt.
  const appRows = await tx
    .select()
    .from(deviceApps)
    .where(and(eq(deviceApps.kidId, kidId), inArray(deviceApps.deviceId, ids)));
  const appByPackage = new Map<string, typeof appRows>();
  for (const r of appRows) {
    appByPackage.set(r.package, [...(appByPackage.get(r.package) ?? []), r]);
  }

  // device_apps rows of any of the kid's devices, for a label when the report's devices have none.
  const allAppRows = await tx.select().from(deviceApps).where(eq(deviceApps.kidId, kidId));
  const allByPackage = new Map<string, typeof allAppRows>();
  for (const r of allAppRows) {
    allByPackage.set(r.package, [...(allByPackage.get(r.package) ?? []), r]);
  }

  const deviceOrder = new Map(ids.map((id, i) => [id, i]));
  const apps: AppReportApp[] = [];
  for (const [pkg, entry] of byPackage) {
    if (entry.total <= 0) continue;
    const label = labelOf(appByPackage.get(pkg), allByPackage.get(pkg), pkg);
    const { installedAt, removedAt } = datesOf(appByPackage.get(pkg) ?? []);
    const perDevice = [...entry.perDevice.entries()]
      .filter(([, sec]) => sec > 0)
      .sort((a, b) => (deviceOrder.get(a[0]) ?? 0) - (deviceOrder.get(b[0]) ?? 0))
      .map(([deviceId, sec]) => ({ deviceId, sec }));
    apps.push({ package: pkg, label, totalSec: entry.total, devices: perDevice, installedAt, removedAt });
  }
  return apps.sort((a, b) => b.totalSec - a.totalSec || a.label.localeCompare(b.label) || a.package.localeCompare(b.package));
}

/** The label of a package on the report's devices (the most recently first-seen row), else on any of the kid's, else the package name. */
function labelOf(
  onReport: typeof deviceApps.$inferSelect[] | undefined,
  onAny: typeof deviceApps.$inferSelect[] | undefined,
  pkg: string,
): string {
  const pick = (rows: typeof deviceApps.$inferSelect[] | undefined) => {
    if (!rows || rows.length === 0) return null;
    return [...rows].sort((a, b) => (b.firstSeenAt > a.firstSeenAt ? 1 : -1))[0]?.label ?? null;
  };
  return pick(onReport) ?? pick(onAny) ?? pkg;
}

/** The earliest installedAt and the removedAt (when every row has one) of a package on the report's devices. */
function datesOf(rows: typeof deviceApps.$inferSelect[]): { installedAt: string | null; removedAt: string | null } {
  if (rows.length === 0) return { installedAt: null, removedAt: null };
  const first = rows[0]!;
  const installedAt = rows.reduce((earliest, r) => (r.installedAt < earliest ? r.installedAt : earliest), first.installedAt);
  const removedAt = rows.every((r) => r.removedAt !== null)
    ? rows.reduce((latest, r) => (r.removedAt! > latest ? r.removedAt! : latest), first.removedAt!)
    : null;
  return { installedAt: installedAt.toISOString(), removedAt: removedAt?.toISOString() ?? null };
}
