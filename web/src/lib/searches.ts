/**
 * The Searches report (docs/SPEC.md §12.12, CARD-074): every search a kid or shared device's devices sent, newest
 * first, with the same periods and device choice as the Apps and Websites reports (lib/reports.ts). Android reads the
 * search from Chrome's address bar, the Google app and the YouTube app; a PC reads it from the browser's window title.
 */
import type { Device, DeviceForm, Family, Platform } from '@screentime/schemas';
import { api } from '@/lib/auth';
import { formatTimeOfDay } from '@/lib/format';
import { addDays, localToday, periodRange, type ReportPeriod } from '@/lib/reports';

// ---- The seam: the SearchReport types and GET /v1/reports/searches. Until the server has them, a fake built from
// the kid's real devices answers, so the page can be seen. CARD-074 moves the types to @screentime/schemas and swaps
// the fake for the call. ----

export type SearchEngine = 'google' | 'bing' | 'duckduckgo' | 'youtube';

/**
 * Whether a device records searches. `on`: it does. `off`: an Android device whose ST Kid accessibility service is not
 * running (turned off in Settings and not turned back on). `never`: the device has never said either way (a version
 * from before CARD-074).
 */
export type SearchCapture = 'on' | 'off' | 'never';

export interface SearchReportDevice {
  deviceId: string;
  name: string;
  form: DeviceForm;
  platform: Platform;
  /** The device's `revoked_at`: removed from the family. */
  removedAt: string | null;
  capture: SearchCapture;
}

/** One search: the same words on one device, repeated within 10 minutes, are one search with a count. */
export interface SearchReportItem {
  query: string;
  engine: SearchEngine;
  /** Where it was typed: `com.android.chrome`, `com.google.android.googlequicksearchbox`, `msedge.exe`… */
  package: string;
  /** "Chrome", "Google", "YouTube", "Edge". */
  appLabel: string;
  deviceId: string;
  /** First seen. */
  at: string;
  /** Last seen (the same as `at` for a search seen once). */
  lastAt: string;
  /** Times it was seen within the 10 minutes. */
  count: number;
  /** A private or incognito window: true or false on a PC, null on Android (Chrome does not show it). */
  private: boolean | null;
}

export interface SearchReport {
  kidId: string;
  period: ReportPeriod;
  from: string;
  to: string;
  /** The family's today. */
  today: string;
  /** The one device, when the report is narrowed to it; null for all devices. */
  deviceId: string | null;
  /** Every device of the report, removed ones too, so the page can show its chips. */
  devices: SearchReportDevice[];
  /** Newest first. */
  searches: SearchReportItem[];
}

export interface SearchReportQuery {
  kidId: string;
  period: ReportPeriod;
  date: string;
  deviceId: string | null;
}

/** GET /v1/reports/searches (docs/SPEC.md §12.12). */
export async function fetchSearchReport(query: SearchReportQuery): Promise<SearchReport> {
  const [devices, family] = await Promise.all([api.get<Device[]>('/v1/devices'), api.get<Family>('/v1/family')]);
  return fakeReport(query, family.timezone, devices);
}

// ---- The fake. ----

interface FakeSearch {
  query: string;
  engine: SearchEngine;
  android: { package: string; appLabel: string };
  pc: { package: string; appLabel: string };
  /** Minutes after midnight. */
  minute: number;
  count?: number;
  private?: boolean;
}

const CHROME = { package: 'com.android.chrome', appLabel: 'Chrome' };
const GOOGLE_APP = { package: 'com.google.android.googlequicksearchbox', appLabel: 'Google' };
const YOUTUBE_APP = { package: 'com.google.android.youtube', appLabel: 'YouTube' };
const EDGE = { package: 'msedge.exe', appLabel: 'Edge' };
const PC_CHROME = { package: 'chrome.exe', appLabel: 'Chrome' };

const FAKE_SEARCHES: FakeSearch[] = [
  { query: 'how to bake a cake', engine: 'google', android: CHROME, pc: PC_CHROME, minute: 16 * 60 + 5 },
  { query: 'how do I bypass Screen Time', engine: 'google', android: CHROME, pc: EDGE, minute: 21 * 60 + 40, private: true },
  { query: 'minecraft cheats', engine: 'google', android: CHROME, pc: EDGE, minute: 17 * 60 + 12, count: 3 },
  { query: 'best minecraft seeds', engine: 'google', android: CHROME, pc: EDGE, minute: 17 * 60 + 14 },
  { query: 'weather tomorrow', engine: 'google', android: GOOGLE_APP, pc: EDGE, minute: 7 * 60 + 35 },
  { query: 'funny cats', engine: 'youtube', android: YOUTUBE_APP, pc: PC_CHROME, minute: 18 * 60 + 2, count: 2 },
  { query: 'how to get extra time on phone', engine: 'google', android: CHROME, pc: EDGE, minute: 20 * 60 + 51 },
  { query: 'is roblox down', engine: 'bing', android: CHROME, pc: EDGE, minute: 15 * 60 + 48 },
  { query: 'year 6 fractions worksheet', engine: 'google', android: CHROME, pc: PC_CHROME, minute: 16 * 60 + 30 },
  { query: 'lego star wars sets 2026', engine: 'duckduckgo', android: CHROME, pc: PC_CHROME, minute: 19 * 60 + 20 },
];

function fakeReport(query: SearchReportQuery, timeZone: string, all: Device[]): SearchReport {
  const today = localToday(timeZone);
  const { from, to } = periodRange(query.period, query.date);
  const real: SearchReportDevice[] = all
    .filter((d) => d.kidId === query.kidId)
    .map((d) => ({ deviceId: d.id, name: d.name, form: d.form, platform: d.platform, removedAt: null, capture: 'on' }));
  const devices = real.length > 0 ? real : FAKE_DEVICES;
  const inReport = devices.filter((d) => (query.deviceId === null || d.deviceId === query.deviceId) && d.capture === 'on');
  const searches: SearchReportItem[] = [];
  const last = to < today ? to : today;
  for (let date = from; date <= last; date = addDays(date, 1)) {
    const seed = hash(`${query.kidId}${date}`);
    FAKE_SEARCHES.forEach((f, i) => {
      // Each search turns up on about half the days; today only up to the current time.
      if ((seed >> i) % 2 === 0) return;
      const device = inReport[(seed + i) % Math.max(1, inReport.length)];
      if (!device) return;
      const at = localInstant(date, f.minute, timeZone);
      if (Date.parse(at) > Date.now()) return;
      const pc = device.platform === 'windows';
      const where = pc ? f.pc : f.android;
      const count = f.count ?? 1;
      searches.push({
        query: f.query,
        engine: pc && f.engine === 'youtube' ? 'google' : f.engine,
        package: where.package,
        appLabel: where.appLabel,
        deviceId: device.deviceId,
        at,
        lastAt: new Date(Date.parse(at) + (count - 1) * 120_000).toISOString(),
        count,
        private: pc ? (f.private ?? false) : null,
      });
    });
  }
  searches.sort((a, b) => b.at.localeCompare(a.at));
  return { kidId: query.kidId, period: query.period, from, to, today, deviceId: query.deviceId, devices, searches };
}

/** For a kid with no device yet, so the fake still shows something. */
const FAKE_DEVICES: SearchReportDevice[] = [
  { deviceId: '00000000-0000-4000-8000-000000000001', name: 'Pixel', form: 'phone', platform: 'android', removedAt: null, capture: 'on' },
  { deviceId: '00000000-0000-4000-8000-000000000002', name: 'Desk PC', form: 'pc', platform: 'windows', removedAt: null, capture: 'on' },
  { deviceId: '00000000-0000-4000-8000-000000000003', name: 'Old tablet', form: 'tablet', platform: 'android', removedAt: null, capture: 'off' },
];

/** A local date and minute in the zone, as a UTC instant (good enough for the fake: the offset at noon). */
function localInstant(date: string, minute: number, timeZone: string): string {
  const noon = new Date(`${date}T12:00:00Z`);
  const local = new Date(noon.toLocaleString('en-US', { timeZone }));
  const utc = new Date(noon.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offset = local.getTime() - utc.getTime();
  return new Date(Date.parse(`${date}T00:00:00Z`) + minute * 60_000 - offset).toISOString();
}

function hash(text: string): number {
  let h = 7;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// ---- Pure helpers. ----

/** A day's searches, newest day first: `label` is "Today", "Yesterday" or "Thu 20 Nov". */
export interface SearchDay {
  date: string;
  label: string;
  searches: SearchReportItem[];
}

/** The local date of an instant in the zone ("2026-11-20"). */
export function localDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

/** Splits newest-first searches into local days, newest day first, keeping the order inside each day. */
export function groupByDay(searches: SearchReportItem[], timeZone: string, today: string): SearchDay[] {
  const days: SearchDay[] = [];
  for (const s of searches) {
    const date = localDate(s.at, timeZone);
    let day = days.find((d) => d.date === date);
    if (!day) {
      day = { date, label: dayHeading(date, today), searches: [] };
      days.push(day);
    }
    day.searches.push(s);
  }
  return days.sort((a, b) => b.date.localeCompare(a.date));
}

/** "Today", "Yesterday", else "Thu 20 Nov". */
export function dayHeading(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${date}T00:00:00Z`))
    .replace(/,/g, '');
}

/** The searches whose words hold `text` (any case, spaces at the ends ignored); all of them for an empty text. */
export function filterSearches(searches: SearchReportItem[], text: string): SearchReportItem[] {
  const needle = text.trim().toLowerCase();
  return needle === '' ? searches : searches.filter((s) => s.query.toLowerCase().includes(needle));
}

const ENGINE_LABELS: Record<SearchEngine, string> = { google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', youtube: 'YouTube' };

export function engineName(engine: SearchEngine): string {
  return ENGINE_LABELS[engine];
}

/** Where it was searched: "Google app", "YouTube app", else "Google in Chrome", "Bing in Edge". */
export function whereLine(s: SearchReportItem): string {
  if (s.package === 'com.google.android.googlequicksearchbox') return 'Google app';
  if (s.package === 'com.google.android.youtube') return 'YouTube app';
  return `${engineName(s.engine)} in ${s.appLabel}`;
}

/** "4:05 pm", or "4:05 pm – 4:09 pm" when it was seen again. */
export function timeLine(s: SearchReportItem, timeZone: string): string {
  const first = formatTimeOfDay(s.at, timeZone);
  const last = formatTimeOfDay(s.lastAt, timeZone);
  return first === last ? first : `${first} – ${last}`;
}

/** The device's name, only in All devices when the report has more than one device; null otherwise. */
export function deviceName(s: SearchReportItem, report: SearchReport): string | null {
  if (report.deviceId !== null || report.devices.length < 2) return null;
  return report.devices.find((d) => d.deviceId === s.deviceId)?.name ?? 'A device';
}

/** The totals on top: searches, different words (any case), and searches in a private window. */
export function searchTotals(searches: SearchReportItem[]): { searches: number; different: number; private: number } {
  return {
    searches: searches.length,
    different: new Set(searches.map((s) => s.query.trim().toLowerCase())).size,
    private: searches.filter((s) => s.private === true).length,
  };
}

/** The report's devices (all, or the chosen one), not removed, that do not record searches, split by why. */
export function notRecording(report: SearchReport): { off: SearchReportDevice[]; never: SearchReportDevice[] } {
  const inReport = report.devices.filter((d) => (report.deviceId === null || d.deviceId === report.deviceId) && d.removedAt === null);
  return { off: inReport.filter((d) => d.capture === 'off'), never: inReport.filter((d) => d.capture === 'never') };
}

/** "Redmi", "Redmi and Desk PC", "Redmi, Tablet and Desk PC". */
export function namesList(devices: { name: string }[]): string {
  const names = devices.map((d) => d.name);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
