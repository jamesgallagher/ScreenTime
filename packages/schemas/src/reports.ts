import { z } from 'zod';
import { DeviceForm, Platform, Pool } from './devices.js';
import { LocalDate } from './grants.js';

/** By day, week (Monday to Sunday) or calendar month (docs/SPEC.md §12.9). */
export const ReportPeriod = z.enum(['day', 'week', 'month']).meta({ id: 'ReportPeriod' });
export type ReportPeriod = z.infer<typeof ReportPeriod>;

/** Query of GET /v1/reports/apps. `date` defaults to the family's today. */
export const AppReportQuery = z
  .object({
    kidId: z.uuid(),
    period: ReportPeriod,
    date: LocalDate.optional(),
    deviceId: z.uuid().optional(),
  })
  .meta({ id: 'AppReportQuery' });
export type AppReportQuery = z.infer<typeof AppReportQuery>;

/** One of the kid's devices, as the report shows it. */
export const AppReportDevice = z
  .object({
    deviceId: z.uuid(),
    name: z.string(),
    form: DeviceForm,
    platform: Platform,
    /** The device's `revoked_at`: removed from the family. */
    removedAt: z.iso.datetime().nullable(),
    /** False for a PC: its programs are not recorded yet. */
    appsRecorded: z.boolean(),
  })
  .meta({ id: 'AppReportDevice' });
export type AppReportDevice = z.infer<typeof AppReportDevice>;

/** The union length of the report's devices' segments in one pool. */
export const AppReportPool = z
  .object({
    pool: Pool,
    usedSec: z.int().min(0),
  })
  .meta({ id: 'AppReportPool' });
export type AppReportPool = z.infer<typeof AppReportPool>;

/** One device's seconds in one app, in the order of the report's devices. */
export const AppReportAppDevice = z
  .object({
    deviceId: z.uuid(),
    sec: z.int().positive(),
  })
  .meta({ id: 'AppReportAppDevice' });
export type AppReportAppDevice = z.infer<typeof AppReportAppDevice>;

/** One app across the report's devices (docs/SPEC.md §12.9). */
export const AppReportApp = z
  .object({
    package: z.string(),
    label: z.string(),
    totalSec: z.int().positive(),
    devices: z.array(AppReportAppDevice),
    installedAt: z.iso.datetime().nullable(),
    /** Removed from every device of the report that listed it; null while any still has it. */
    removedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'AppReportApp' });
export type AppReportApp = z.infer<typeof AppReportApp>;

/** The apps report of a kid or shared device (docs/SPEC.md §12.9, CARD-066). */
export const AppReport = z
  .object({
    kidId: z.uuid(),
    period: ReportPeriod,
    from: LocalDate,
    to: LocalDate,
    /** The family's today, so the page can tell when the period holds it. */
    today: LocalDate,
    /** The one device, when the report is narrowed to it; null for all devices. */
    deviceId: z.uuid().nullable(),
    /** Every one of the kid's devices, removed ones too, so the page can show its chips. */
    devices: z.array(AppReportDevice),
    /** One entry per pool a device in the report belongs to, Screens first. */
    screenTime: z.array(AppReportPool),
    /** Packages with more than 0 seconds, most used first, then by label, then by package. */
    apps: z.array(AppReportApp),
  })
  .meta({ id: 'AppReport' });
export type AppReport = z.infer<typeof AppReport>;
