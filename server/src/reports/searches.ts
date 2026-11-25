import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import {
  SearchReport as SearchReportSchema,
  type SearchReport,
  type SearchReportDevice,
  type SearchReportItem,
  type ReportPeriod,
} from '@screentime/schemas';
import type { FamilyTx } from '../db/family.js';
import { devices, families, searches } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { familyToday, findKid, isRealDate, periodInstants, periodRange } from './apps.js';
import { packageLabels } from './sites.js';

/** Builds the Searches report for one kid or shared device (docs/SPEC.md §12.12). */
export async function buildSearchReport(
  tx: FamilyTx,
  query: { kidId: string; period: ReportPeriod; date: string | null; deviceId: string | null },
): Promise<SearchReport> {
  const [family] = await tx.select({ timezone: families.timezone }).from(families);
  if (!family) throw new Error('no family in the transaction');

  const kid = await findKid(tx, query.kidId);
  const today = await familyToday(tx, family.timezone);
  const date = query.date ?? today;
  if (!isRealDate(date)) throw new ApiError('validation_failed', 'The date is not a real date.');
  if (date > today) throw new ApiError('validation_failed', 'The date is after today.');
  const { from, to } = periodRange(query.period, date);
  const { start, end } = await periodInstants(tx, family.timezone, from, to);

  const allDevices = await tx
    .select()
    .from(devices)
    .where(eq(devices.kidId, kid.id))
    .orderBy(asc(devices.enrolledAt), asc(devices.id));
  if (query.deviceId !== null && !allDevices.some((device) => device.id === query.deviceId)) {
    throw new ApiError('validation_failed', "That device is not one of this kid's.");
  }

  const periodSearches =
    allDevices.length === 0
      ? []
      : await tx
          .select()
          .from(searches)
          .where(and(eq(searches.kidId, kid.id), gte(searches.at, start), lt(searches.at, end)))
          .orderBy(desc(searches.at))
          .limit(5000);
  const removedWithSearches = new Set(periodSearches.map((item) => item.deviceId));
  const reportDevices = allDevices.filter((device) => device.revokedAt === null || removedWithSearches.has(device.id));
  const deviceList: SearchReportDevice[] = reportDevices.map((device) => ({
    deviceId: device.id,
    name: device.name,
    form: device.form as SearchReportDevice['form'],
    platform: device.platform as SearchReportDevice['platform'],
    removedAt: device.revokedAt?.toISOString() ?? null,
    capture: (device.searchCapture ?? 'never') as SearchReportDevice['capture'],
  }));

  const inReport = query.deviceId === null ? reportDevices : reportDevices.filter((device) => device.id === query.deviceId);
  const ids = inReport.map((device) => device.id);
  const labels = await packageLabels(tx, kid.id, ids);
  const rows = periodSearches.filter((item) => ids.includes(item.deviceId));
  const items: SearchReportItem[] = rows.map((item) => ({
    query: item.query,
    engine: item.engine as SearchReportItem['engine'],
    package: item.package,
    appLabel: labels.get(item.package) ?? item.package,
    deviceId: item.deviceId,
    at: item.at.toISOString(),
    lastAt: item.lastAt.toISOString(),
    count: item.count,
    private: item.private,
  }));

  return SearchReportSchema.parse({
    kidId: kid.id,
    period: query.period,
    from,
    to,
    today,
    deviceId: query.deviceId,
    devices: deviceList,
    searches: items,
  });
}
