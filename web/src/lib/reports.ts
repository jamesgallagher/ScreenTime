/**
 * Reports (docs/SPEC.md §12.9): which apps a kid or shared device used and for how long, by day, week (Monday to
 * Sunday) or calendar month, on all devices or one. Dates here are the family's local dates as `YYYY-MM-DD`.
 */
import type { Device, DeviceForm, Family, Platform, Pool } from '@screentime/schemas';
import { api } from '@/lib/auth';
import { formatDuration } from '@/lib/format';

export type ReportPeriod = 'day' | 'week' | 'month';

// ---- The seam: the AppReport types and GET /v1/reports/apps. Until the server has the route, a fake built from the
// kid's real devices answers, so the page can be seen. CARD-066 swaps the types for @screentime/schemas and the fake
// for the call. ----

export interface AppReportDevice {
  deviceId: string;
  name: string;
  form: DeviceForm;
  platform: Platform;
  /** The device's `revoked_at`: removed from the family. */
  removedAt: string | null;
  /** False for a PC: its programs are not recorded yet. */
  appsRecorded: boolean;
}

export interface AppReportApp {
  package: string;
  label: string;
  totalSec: number;
  /** Each device with time, in the order of the report's devices. */
  devices: { deviceId: string; sec: number }[];
  installedAt: string | null;
  /** Removed from every device of the report that listed it; null while any still has it. */
  removedAt: string | null;
}

export interface AppReport {
  kidId: string;
  period: ReportPeriod;
  from: string;
  to: string;
  today: string;
  deviceId: string | null;
  devices: AppReportDevice[];
  screenTime: { pool: Pool; usedSec: number }[];
  apps: AppReportApp[];
}

export interface AppReportQuery {
  kidId: string;
  period: ReportPeriod;
  date: string;
  deviceId: string | null;
}

/** GET /v1/reports/apps (docs/SPEC.md §12.9). */
export async function fetchAppReport(query: AppReportQuery): Promise<AppReport> {
  const [devices, family] = await Promise.all([api.get<Device[]>('/v1/devices'), api.get<Family>('/v1/family')]);
  return fakeReport(query, family.timezone, devices);
}

const FAKE_APPS: { package: string; label: string; perDay: number }[] = [
  { package: 'com.google.android.youtube', label: 'YouTube', perDay: 3100 },
  { package: 'com.roblox.client', label: 'Roblox', perDay: 2400 },
  { package: 'com.android.chrome', label: 'Chrome', perDay: 1500 },
  { package: 'com.mojang.minecraftpe', label: 'Minecraft', perDay: 1100 },
  { package: 'com.duolingo', label: 'Duolingo', perDay: 600 },
  { package: 'com.spotify.music', label: 'Spotify', perDay: 420 },
  { package: 'com.google.android.apps.messaging', label: 'Messages', perDay: 300 },
  { package: 'com.google.android.deskclock', label: 'Clock', perDay: 40 },
  { package: 'com.google.android.permissioncontroller', label: 'com.google.android.permissioncontroller', perDay: 20 },
];

/** A made-up but steady report: the same query always gives the same numbers. */
function fakeReport(query: AppReportQuery, timeZone: string, all: Device[]): AppReport {
  const today = localToday(timeZone);
  const { from, to } = periodRange(query.period, query.date);
  const real: AppReportDevice[] = all
    .filter((d) => d.kidId === query.kidId)
    .map((d) => ({
      deviceId: d.id,
      name: d.name,
      form: d.form,
      platform: d.platform,
      removedAt: null,
      appsRecorded: d.platform === 'android',
    }));
  const devices = [...(real.length > 0 ? real : FAKE_DEVICES), FAKE_REMOVED];
  const inReport = devices.filter((d) => query.deviceId === null || d.deviceId === query.deviceId);
  const days = Math.max(0, daysBetween(from, minDate(to, today)) + 1);
  const seed = hash(`${query.kidId}${from}`);
  const apps: AppReportApp[] = [];
  FAKE_APPS.forEach((a, i) => {
    const per = inReport
      .filter((d) => d.appsRecorded)
      .map((d, j) => ({ deviceId: d.deviceId, sec: Math.round(a.perDay * days * (0.4 + ((seed >> (i + j)) % 7) / 10) / (j + 1)) }))
      .filter((d) => d.sec > 0);
    const totalSec = per.reduce((s, d) => s + d.sec, 0);
    if (totalSec > 0) apps.push({ package: a.package, label: a.label, totalSec, devices: per, installedAt: '2026-09-01T00:00:00.000Z', removedAt: null });
  });
  if (inReport.some((d) => d.appsRecorded) && days > 0) {
    const on = inReport.find((d) => d.appsRecorded)!;
    apps.push({
      package: 'com.example.secretchat',
      label: 'Secret Chat',
      totalSec: 2700,
      devices: [{ deviceId: on.deviceId, sec: 2700 }],
      installedAt: `${from}T05:12:00.000Z`,
      removedAt: `${from}T06:01:00.000Z`,
    });
  }
  apps.sort((a, b) => b.totalSec - a.totalSec || a.label.localeCompare(b.label));
  const pools = [...new Set(inReport.map((d) => (d.form === 'phone' ? 'phone' : 'screens')))] as Pool[];
  pools.sort((a, b) => (a === 'screens' ? 0 : 1) - (b === 'screens' ? 0 : 1));
  const appSec = apps.reduce((s, a) => s + a.totalSec, 0);
  return {
    kidId: query.kidId,
    period: query.period,
    from,
    to,
    today,
    deviceId: query.deviceId,
    devices,
    screenTime: pools.map((pool, i) => ({ pool, usedSec: Math.round((appSec * (i === 0 ? 0.7 : 0.45)) + days * 900) })),
    apps,
  };
}

/** For a kid with no device yet, so the fake still shows something. */
const FAKE_DEVICES: AppReportDevice[] = [
  { deviceId: '00000000-0000-4000-8000-000000000001', name: 'Pixel', form: 'phone', platform: 'android', removedAt: null, appsRecorded: true },
  { deviceId: '00000000-0000-4000-8000-000000000002', name: 'Desk PC', form: 'pc', platform: 'windows', removedAt: null, appsRecorded: false },
];

const FAKE_REMOVED: AppReportDevice = {
  deviceId: '00000000-0000-4000-8000-00000000dead',
  name: 'Old tablet',
  form: 'tablet',
  platform: 'android',
  removedAt: '2026-10-20T00:00:00.000Z',
  appsRecorded: true,
};

function hash(text: string): number {
  let h = 7;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// ---- Pure helpers. ----

/** Today's date in the family time zone. */
export function localToday(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

export function isDate(text: string | undefined): text is string {
  return !!text && /^\d{4}-\d{2}-\d{2}$/.test(text) && fromUtc(toUtc(text)) === text;
}

/** The first and last day of the period holding `date`: the day itself, Monday to Sunday, or the calendar month. */
export function periodRange(period: ReportPeriod, date: string): { from: string; to: string } {
  if (period === 'day') return { from: date, to: date };
  if (period === 'week') {
    const weekday = (toUtc(date).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
    const from = addDays(date, -weekday);
    return { from, to: addDays(from, 6) };
  }
  const from = `${date.slice(0, 8)}01`;
  const next = toUtc(from);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(fromUtc(next), -1) };
}

/** A day in the period before (-1) or after (+1): its first day. */
export function shiftPeriod(period: ReportPeriod, date: string, direction: 1 | -1): string {
  const { from, to } = periodRange(period, date);
  if (direction === -1) return periodRange(period, addDays(from, -1)).from;
  return addDays(to, 1);
}

/** The period holds today, so there is nothing after it to step to. */
export function isCurrentPeriod(period: ReportPeriod, date: string, today: string): boolean {
  const { from, to } = periodRange(period, date);
  return from <= today && today <= to;
}

const DAY = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const DAY_MONTH = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const MONTH = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'long', year: 'numeric' });

function clean(text: string): string {
  return text.replace(/,/g, '').replace(/\s+/g, ' ');
}

/**
 * "Today", "Yesterday" or "Thu 20 Nov"; "This week" or "17 – 23 Nov" ("27 Oct – 2 Nov" across months, with the year
 * when it is not this year's); "This month" or "October 2026".
 */
export function periodLabel(period: ReportPeriod, date: string, today: string): string {
  const { from, to } = periodRange(period, date);
  const year = from.slice(0, 4) !== today.slice(0, 4) || to.slice(0, 4) !== today.slice(0, 4);
  if (period === 'day') {
    if (date === today) return 'Today';
    if (date === addDays(today, -1)) return 'Yesterday';
    return clean(DAY.format(toUtc(date))) + (year ? ` ${date.slice(0, 4)}` : '');
  }
  if (period === 'week') {
    if (isCurrentPeriod(period, date, today)) return 'This week';
    const sameMonth = from.slice(0, 7) === to.slice(0, 7);
    const start = sameMonth ? String(Number(from.slice(8))) : clean(DAY_MONTH.format(toUtc(from)));
    return `${start} – ${clean(DAY_MONTH.format(toUtc(to)))}${year ? ` ${to.slice(0, 4)}` : ''}`;
  }
  if (isCurrentPeriod(period, date, today)) return 'This month';
  return MONTH.format(toUtc(from));
}

/** What the jump-back button says for the period holding today. */
export function currentLabel(period: ReportPeriod): string {
  return period === 'day' ? 'Today' : period === 'week' ? 'This week' : 'This month';
}

/** The full dates under the label: "Thursday 20 November 2026", "Mon 17 – Sun 23 Nov 2026", "1 – 30 Nov 2026". */
export function periodDates(period: ReportPeriod, date: string): string {
  const { from, to } = periodRange(period, date);
  if (period === 'day') {
    return clean(new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(toUtc(date)));
  }
  if (period === 'week') return `${clean(DAY.format(toUtc(from)))} – ${clean(DAY.format(toUtc(to)))} ${to.slice(0, 4)}`;
  return `1 – ${Number(to.slice(8))} ${clean(new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(toUtc(to)))}`;
}

/** Apps under a minute in the period go into one Other row. */
export const OTHER_UNDER_SEC = 60;

export function splitOther(apps: AppReportApp[]): { shown: AppReportApp[]; other: AppReportApp[]; otherSec: number } {
  const shown = apps.filter((a) => a.totalSec >= OTHER_UNDER_SEC);
  const other = apps.filter((a) => a.totalSec < OTHER_UNDER_SEC);
  return { shown, other, otherSec: other.reduce((s, a) => s + a.totalSec, 0) };
}

/** A duration that stays short in a line: "<1m" under a minute. */
export function shortDuration(sec: number): string {
  return sec < 60 ? '<1m' : formatDuration(sec);
}

/** "Pixel 1h 10m · XPPen 30m": only in All devices, and only when the report has more than one device with apps. */
export function deviceSplit(app: AppReportApp, report: AppReport): string | null {
  if (report.deviceId !== null) return null;
  if (report.devices.filter((d) => d.appsRecorded).length < 2) return null;
  const names = new Map(report.devices.map((d) => [d.deviceId, d.name]));
  return app.devices.map((d) => `${names.get(d.deviceId) ?? 'A device'} ${shortDuration(d.sec)}`).join(' · ');
}

function shortDay(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone, day: 'numeric', month: 'short' }).format(new Date(instant));
}

/** "Installed 3 Nov · removed 4 Nov" for an app gone from the report's devices; null while it is still there. */
export function removedLine(app: AppReportApp, timeZone: string): string | null {
  if (!app.removedAt) return null;
  const removed = `removed ${shortDay(app.removedAt, timeZone)}`;
  return app.installedAt ? `Installed ${shortDay(app.installedAt, timeZone)} · ${removed}` : `Removed ${shortDay(app.removedAt, timeZone)}`;
}

/** A bar's width against the most used app, at least a sliver so a short one still shows. */
export function barPercent(sec: number, maxSec: number): number {
  if (maxSec <= 0 || sec <= 0) return 0;
  return Math.max(2, Math.round((sec / maxSec) * 100));
}

/** The name of a pool on the Screen time card: Time for a shared device, the device's own name for one device. */
export function screenTimeLabel(pool: Pool, shared: boolean, device: AppReportDevice | null): string {
  if (device) return device.name;
  if (shared) return 'Time';
  return pool === 'screens' ? 'Screens' : 'Phone';
}

/** The report has a PC, whose programs are not recorded yet. */
export function hasUnrecorded(report: AppReport): boolean {
  const inReport = report.devices.filter((d) => report.deviceId === null || d.deviceId === report.deviceId);
  return inReport.some((d) => !d.appsRecorded && d.removedAt === null);
}

/** The address of a report: `/reports?kid=…&device=…&period=…&date=…`. */
export interface ReportSearch {
  kid?: string;
  device?: string;
  period?: ReportPeriod;
  date?: string;
}

export function parseReportSearch(search: Record<string, unknown>): ReportSearch {
  const text = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  const period = text(search.period);
  const date = text(search.date);
  return {
    kid: text(search.kid),
    device: text(search.device),
    period: period === 'day' || period === 'week' || period === 'month' ? period : undefined,
    date: isDate(date) ? date : undefined,
  };
}
