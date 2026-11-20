/**
 * The Websites report (docs/SPEC.md §12.10, CARD-070): which sites a kid or shared device's devices looked up, sorted
 * by the family's local LLM into kinds and categories, and on PCs the searches, private-window time and page titles
 * read from the browsers' window titles. Same periods and device choice as the Apps report (lib/reports.ts).
 */
import type { Device, DeviceForm, Family, Platform } from '@screentime/schemas';
import { api } from '@/lib/auth';
import { formatDuration, formatTimeOfDay } from '@/lib/format';
import { addDays, localToday, periodRange, type ReportPeriod } from '@/lib/reports';

// ---- The seam: the SiteReport types, GET /v1/reports/sites and PUT/DELETE /v1/sites/{site}/class. Until the server
// has them, a fake built from the kid's real devices answers, so the page can be seen. CARD-070 swaps the types for
// @screentime/schemas and the fake for the calls. ----

export type SiteKind = 'website' | 'cdn' | 'ads_tracking' | 'app_service' | 'unknown';

export type SiteCategory =
  | 'social'
  | 'video'
  | 'games'
  | 'chat'
  | 'search'
  | 'education'
  | 'shopping'
  | 'news'
  | 'adult'
  | 'gambling'
  | 'violence_weapons'
  | 'drugs'
  | 'self_harm'
  | 'other';

/** Who sorted the site: the LLM, Cloudflare's family resolver (blocked = adult or unsafe), or a parent. */
export type SiteClassSource = 'classifier' | 'family_dns' | 'parent';

export type SearchEngine = 'google' | 'bing' | 'duckduckgo';

export interface SiteReportDevice {
  deviceId: string;
  name: string;
  form: DeviceForm;
  platform: Platform;
  /** The device's `revoked_at`: removed from the family. */
  removedAt: string | null;
  /** The device has sent any website lookup, ever. False for a PC on a version before CARD-069. */
  sitesRecorded: boolean;
}

/** An app or program that looked the site up. */
export interface SiteReportApp {
  package: string;
  label: string;
  /** One of the known browsers (SPEC §12.10). */
  browser: boolean;
  minutes: number;
}

export interface SiteReportSite {
  /** The registrable domain (`khanacademy.org`). */
  site: string;
  /** The site's usual name from the classifier ("Khan Academy"), or null. */
  label: string | null;
  /** Null while the site is not sorted yet. */
  kind: SiteKind | null;
  category: SiteCategory | null;
  source: SiteClassSource | null;
  /** For a CDN or app service: the site it serves (`fbcdn.net` → `facebook.com`). */
  owner: string | null;
  /** Active minutes: the minutes in which it was looked up, per app and device, added up. */
  minutes: number;
  lookups: number;
  /** Days in the period with a lookup. */
  days: number;
  firstAt: string;
  lastAt: string;
  /** Most active first. */
  apps: SiteReportApp[];
  /** Each device with a lookup, in the order of the report's devices. */
  devices: { deviceId: string; minutes: number }[];
}

/** Active minutes per category over `sites` (null: not sorted yet), most first. */
export interface SiteReportCategory {
  category: SiteCategory | null;
  minutes: number;
  sites: number;
}

/** A search read from a PC browser's title, the same words on one engine added up. */
export interface SiteReportSearch {
  engine: SearchEngine;
  query: string;
  sec: number;
  /** Any of it in a private window. */
  private: boolean;
  firstAt: string;
  deviceId: string;
}

/** A page title on a PC browser, the browser's own name and markers taken off. */
export interface SiteReportPage {
  page: string;
  package: string;
  sec: number;
  private: boolean;
}

export interface SiteReport {
  kidId: string;
  period: ReportPeriod;
  from: string;
  to: string;
  today: string;
  deviceId: string | null;
  devices: SiteReportDevice[];
  categories: SiteReportCategory[];
  /** Websites, unknown sites and sites not sorted yet: most active first. */
  sites: SiteReportSite[];
  /** CDNs, ads and tracking, app services: most active first. */
  behindTheScenes: SiteReportSite[];
  /** Time a browser was in front on the report's PCs. */
  browserSec: number;
  /** Of that, time in private windows. */
  privateSec: number;
  /** Newest first. */
  searches: SiteReportSearch[];
  /** Most time first, at most 50. */
  pages: SiteReportPage[];
  /** The first local date whose titles are still kept (90 days); searches and pages before it are gone. */
  titlesKeptFrom: string;
}

export interface SiteReportQuery {
  kidId: string;
  period: ReportPeriod;
  date: string;
  deviceId: string | null;
}

/** A parent's own kind and category for a site, for the whole family (PUT /v1/sites/{site}/class). */
export interface SiteClassOverride {
  kind: Exclude<SiteKind, 'unknown'>;
  category: SiteCategory;
}

/** GET /v1/reports/sites (docs/SPEC.md §12.10). */
export async function fetchSiteReport(query: SiteReportQuery): Promise<SiteReport> {
  const [devices, family] = await Promise.all([api.get<Device[]>('/v1/devices'), api.get<Family>('/v1/family')]);
  return fakeReport(query, family.timezone, devices);
}

/** PUT /v1/sites/{site}/class. */
export async function setSiteClass(site: string, override: SiteClassOverride): Promise<void> {
  fakeOverrides.set(site, override);
}

/** DELETE /v1/sites/{site}/class: back to the classifier's. */
export async function clearSiteClass(site: string): Promise<void> {
  fakeOverrides.delete(site);
}

// ---- The fake. ----

const fakeOverrides = new Map<string, SiteClassOverride>();

interface FakeSite {
  site: string;
  label: string | null;
  kind: SiteKind | null;
  category: SiteCategory | null;
  source: SiteClassSource | null;
  owner?: string;
  perDay: number;
  apps: { package: string; label: string; browser: boolean }[];
  pcOnly?: boolean;
}

const CHROME = { package: 'com.android.chrome', label: 'Chrome', browser: true };
const EDGE = { package: 'msedge.exe', label: 'Microsoft Edge', browser: true };
const YOUTUBE = { package: 'com.google.android.youtube', label: 'YouTube', browser: false };
const ROBLOX = { package: 'com.roblox.client', label: 'Roblox', browser: false };

const FAKE_SITES: FakeSite[] = [
  { site: 'youtube.com', label: 'YouTube', kind: 'website', category: 'video', source: 'classifier', perDay: 52, apps: [YOUTUBE, CHROME] },
  { site: 'roblox.com', label: 'Roblox', kind: 'website', category: 'games', source: 'classifier', perDay: 38, apps: [ROBLOX, CHROME] },
  { site: 'coolmathgames.com', label: 'Cool Math Games', kind: 'website', category: 'games', source: 'classifier', perDay: 21, apps: [EDGE], pcOnly: true },
  { site: 'khanacademy.org', label: 'Khan Academy', kind: 'website', category: 'education', source: 'classifier', perDay: 17, apps: [CHROME, EDGE] },
  { site: 'discord.com', label: 'Discord', kind: 'website', category: 'chat', source: 'classifier', perDay: 14, apps: [EDGE], pcOnly: true },
  { site: 'wikipedia.org', label: 'Wikipedia', kind: 'website', category: 'education', source: 'classifier', perDay: 9, apps: [EDGE, CHROME] },
  { site: 'bing.com', label: 'Bing', kind: 'website', category: 'search', source: 'classifier', perDay: 8, apps: [EDGE] },
  { site: 'tiktok.com', label: 'TikTok', kind: 'website', category: 'video', source: 'classifier', perDay: 6, apps: [CHROME] },
  { site: 'abc.net.au', label: 'ABC News', kind: 'website', category: 'news', source: 'classifier', perDay: 3, apps: [CHROME] },
  { site: 'sportsbet.com.au', label: 'Sportsbet', kind: 'website', category: 'gambling', source: 'classifier', perDay: 2, apps: [CHROME] },
  { site: 'zlkj7q.xyz', label: null, kind: 'website', category: 'adult', source: 'family_dns', perDay: 1, apps: [CHROME] },
  { site: 'newgame-hub.io', label: null, kind: null, category: null, source: null, perDay: 2, apps: [CHROME] },
  { site: 'qmx-portal.net', label: null, kind: 'unknown', category: 'other', source: 'classifier', perDay: 1, apps: [CHROME] },
  { site: 'googlevideo.com', label: null, kind: 'cdn', category: 'video', source: 'classifier', owner: 'youtube.com', perDay: 55, apps: [YOUTUBE, CHROME] },
  { site: 'rbxcdn.com', label: null, kind: 'cdn', category: 'games', source: 'classifier', owner: 'roblox.com', perDay: 30, apps: [ROBLOX] },
  { site: 'doubleclick.net', label: null, kind: 'ads_tracking', category: 'other', source: 'classifier', perDay: 24, apps: [CHROME, YOUTUBE] },
  { site: 'facebook.net', label: null, kind: 'app_service', category: 'social', source: 'classifier', owner: 'facebook.com', perDay: 4, apps: [CHROME] },
  { site: 'googleapis.com', label: null, kind: 'app_service', category: 'other', source: 'classifier', owner: 'google.com', perDay: 40, apps: [CHROME, YOUTUBE] },
];

const FAKE_SEARCHES: { engine: SearchEngine; query: string; sec: number; private: boolean }[] = [
  { engine: 'bing', query: 'minecraft cheats', sec: 140, private: true },
  { engine: 'google', query: 'how to draw a dragon', sec: 95, private: false },
  { engine: 'bing', query: 'cool math games run 3', sec: 40, private: false },
  { engine: 'duckduckgo', query: 'fortnite free skins', sec: 62, private: true },
];

const FAKE_PAGES: SiteReportPage[] = [
  { page: 'Run 3 - Play it now at Coolmath Games', package: 'msedge.exe', sec: 2460, private: false },
  { page: 'Discord | #general | Year 7 crew', package: 'msedge.exe', sec: 1320, private: false },
  { page: 'Free Robux generator 2026', package: 'msedge.exe', sec: 300, private: true },
  { page: 'Photosynthesis - Khan Academy', package: 'chrome.exe', sec: 610, private: false },
  { page: 'Dragon - Wikipedia', package: 'msedge.exe', sec: 180, private: false },
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A made-up but steady report: the same query always gives the same numbers. */
function fakeReport(query: SiteReportQuery, timeZone: string, all: Device[]): SiteReport {
  const today = localToday(timeZone);
  const { from, to } = periodRange(query.period, query.date);
  const real: SiteReportDevice[] = all
    .filter((d) => d.kidId === query.kidId)
    .map((d) => ({ deviceId: d.id, name: d.name, form: d.form, platform: d.platform, removedAt: null, sitesRecorded: true }));
  const devices = real.length > 0 ? real : FAKE_DEVICES;
  const inReport = devices.filter((d) => (query.deviceId === null || d.deviceId === query.deviceId) && d.sitesRecorded);
  const last = to < today ? to : today;
  const days = Math.max(0, Math.round((Date.parse(last) - Date.parse(from)) / 86_400_000) + 1);
  const seed = hash(`${query.kidId}${from}`);

  const sites: SiteReportSite[] = [];
  FAKE_SITES.forEach((f, i) => {
    const on = inReport.filter((d) => (f.pcOnly ? d.platform === 'windows' : true));
    const per = on
      .map((d, j) => ({ deviceId: d.deviceId, minutes: Math.round((f.perDay * days * (0.5 + ((seed >> (i + j)) % 6) / 10)) / (j + 1)) }))
      .filter((d) => d.minutes > 0);
    const minutes = per.reduce((s, d) => s + d.minutes, 0);
    if (minutes === 0) return;
    const override = fakeOverrides.get(f.site);
    const apps = f.apps
      .filter((a) => on.some((d) => (d.platform === 'windows') === a.package.endsWith('.exe')))
      .map((a, k) => ({ ...a, minutes: Math.max(1, Math.round(minutes / (k + 1.6))) }));
    if (apps.length === 0) return;
    sites.push({
      site: f.site,
      label: f.label,
      kind: override?.kind ?? f.kind,
      category: override?.category ?? f.category,
      source: override ? 'parent' : f.source,
      owner: f.owner ?? null,
      minutes,
      lookups: minutes * (2 + (i % 4)),
      days: Math.min(days, 1 + ((seed >> i) % Math.max(1, days))),
      firstAt: `${from}T${String(22 + (i % 2)).padStart(2, '0')}:1${i % 10}:00.000Z`,
      lastAt: `${last}T0${(i % 9) + 1}:4${i % 10}:00.000Z`,
      apps,
      devices: per,
    });
  });
  const order = (a: SiteReportSite, b: SiteReportSite) => b.minutes - a.minutes || b.lookups - a.lookups || a.site.localeCompare(b.site);
  const shown = sites.filter((s) => !isBehindTheScenes(s.kind)).sort(order);
  const behind = sites.filter((s) => isBehindTheScenes(s.kind)).sort(order);

  const pc = inReport.find((d) => d.platform === 'windows');
  const scale = Math.max(1, days);
  const searches: SiteReportSearch[] = pc
    ? FAKE_SEARCHES.map((s, i) => ({ ...s, sec: s.sec * Math.min(scale, 3), firstAt: `${last}T0${6 - i}:0${i}:00.000Z`, deviceId: pc.deviceId }))
    : [];
  const pages = pc ? FAKE_PAGES.map((p) => ({ ...p, sec: p.sec * scale })).sort((a, b) => b.sec - a.sec) : [];
  const browserSec = pages.reduce((s, p) => s + p.sec, 0) + searches.reduce((s, x) => s + x.sec, 0) + (pc ? 600 * scale : 0);
  const privateSec = pages.filter((p) => p.private).reduce((s, p) => s + p.sec, 0) + searches.filter((s) => s.private).reduce((s, x) => s + x.sec, 0);

  return {
    kidId: query.kidId,
    period: query.period,
    from,
    to,
    today,
    deviceId: query.deviceId,
    devices,
    categories: categoryTotals(shown),
    sites: shown,
    behindTheScenes: behind,
    browserSec,
    privateSec,
    searches,
    pages,
    titlesKeptFrom: addDays(today, -89),
  };
}

/** What the server works out for `categories`; the fake uses it too. */
export function categoryTotals(sites: SiteReportSite[]): SiteReportCategory[] {
  const totals = new Map<SiteCategory | null, SiteReportCategory>();
  for (const s of sites) {
    const t = totals.get(s.category) ?? { category: s.category, minutes: 0, sites: 0 };
    t.minutes += s.minutes;
    t.sites += 1;
    totals.set(s.category, t);
  }
  return [...totals.values()].sort((a, b) => b.minutes - a.minutes || categoryLabel(a.category).localeCompare(categoryLabel(b.category)));
}

/** For a kid with no device yet, so the fake still shows something. */
const FAKE_DEVICES: SiteReportDevice[] = [
  { deviceId: '00000000-0000-4000-8000-000000000001', name: 'Pixel', form: 'phone', platform: 'android', removedAt: null, sitesRecorded: true },
  { deviceId: '00000000-0000-4000-8000-000000000002', name: 'Desk PC', form: 'pc', platform: 'windows', removedAt: null, sitesRecorded: true },
  { deviceId: '00000000-0000-4000-8000-000000000003', name: 'Old laptop', form: 'pc', platform: 'windows', removedAt: null, sitesRecorded: false },
];

// ---- Pure helpers. ----

export const CATEGORIES: SiteCategory[] = [
  'social',
  'video',
  'games',
  'chat',
  'search',
  'education',
  'shopping',
  'news',
  'adult',
  'gambling',
  'violence_weapons',
  'drugs',
  'self_harm',
  'other',
];

const CATEGORY_LABELS: Record<SiteCategory, string> = {
  social: 'Social',
  video: 'Video',
  games: 'Games',
  chat: 'Chat',
  search: 'Search',
  education: 'Education',
  shopping: 'Shopping',
  news: 'News',
  adult: 'Adult',
  gambling: 'Gambling',
  violence_weapons: 'Violence and weapons',
  drugs: 'Drugs',
  self_harm: 'Self-harm',
  other: 'Other',
};

/** "Video", "Violence and weapons"; "Not sorted yet" for a site the classifier has not reached. */
export function categoryLabel(category: SiteCategory | null): string {
  return category === null ? 'Not sorted yet' : CATEGORY_LABELS[category];
}

/** Categories a parent may want to look at first. Nothing is sent: no alerts yet (SPEC §12.10). */
export const WORTH_A_LOOK: ReadonlySet<SiteCategory> = new Set(['adult', 'gambling', 'violence_weapons', 'drugs', 'self_harm']);

export function isWorthALook(category: SiteCategory | null): boolean {
  return category !== null && WORTH_A_LOOK.has(category);
}

/** The kinds a parent can pick for a site (unknown is the classifier's answer only). */
export const PICKABLE_KINDS: { kind: SiteClassOverride['kind']; label: string }[] = [
  { kind: 'website', label: 'A website' },
  { kind: 'cdn', label: 'Files for another site (CDN)' },
  { kind: 'ads_tracking', label: 'Ads or tracking' },
  { kind: 'app_service', label: 'An app or system service' },
];

const KIND_LABELS: Record<SiteKind, string> = {
  website: 'Website',
  cdn: 'CDN',
  ads_tracking: 'Ads and tracking',
  app_service: 'App service',
  unknown: 'Unknown',
};

export function kindLabel(kind: SiteKind | null): string {
  return kind === null ? 'Not sorted yet' : KIND_LABELS[kind];
}

/** CDNs, ads and tracking and app services fold away: a lookup of them is not a visit. */
export function isBehindTheScenes(kind: SiteKind | null): boolean {
  return kind === 'cdn' || kind === 'ads_tracking' || kind === 'app_service';
}

/** The name on a row: the classifier's label, else the site. */
export function siteName(site: SiteReportSite): string {
  return site.label ?? site.site;
}

/** Active minutes as a duration: "1h 05m", "45m". */
export function activeTime(minutes: number): string {
  return minutes <= 0 ? '0m' : formatDuration(minutes * 60);
}

/** "Chrome, Roblox": the apps that looked it up, most active first, at most three and "+2". */
export function appsLine(site: SiteReportSite): string {
  const names = site.apps.map((a) => a.label);
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

/** Day: "3:10 pm – 8:45 pm"; week or month: "on 4 days". */
export function whenLine(site: SiteReportSite, period: ReportPeriod, timeZone: string): string {
  if (period === 'day') {
    const first = formatTimeOfDay(site.firstAt, timeZone);
    const last = formatTimeOfDay(site.lastAt, timeZone);
    return first === last ? `at ${first}` : `${first} – ${last}`;
  }
  return site.days === 1 ? 'on 1 day' : `on ${site.days} days`;
}

/** "Pixel 40m · Desk PC 12m": only in All devices, and only when more than one device looked it up. */
export function siteDeviceSplit(site: SiteReportSite, report: SiteReport): string | null {
  if (report.deviceId !== null || site.devices.length < 2) return null;
  const names = new Map(report.devices.map((d) => [d.deviceId, d.name]));
  return site.devices.map((d) => `${names.get(d.deviceId) ?? 'A device'} ${activeTime(d.minutes)}`).join(' · ');
}

/** Who sorted it, when it is not the classifier: "Set by you", "Family filter: adult or unsafe". */
export function sourceLine(site: SiteReportSite): string | null {
  if (site.source === 'parent') return 'Set by a parent';
  if (site.source === 'family_dns') return 'Blocked by a family filter: adult or unsafe';
  return null;
}

/** "for youtube.com" under a CDN or app service. */
export function ownerLine(site: SiteReportSite): string | null {
  return site.owner && site.owner !== site.site ? `for ${site.owner}` : null;
}

/** The sites of one category, or all of them. */
export function filterSites(sites: SiteReportSite[], category: SiteCategory | null | 'all'): SiteReportSite[] {
  return category === 'all' ? sites : sites.filter((s) => s.category === category);
}

/** The report's devices (all, or the chosen one) that have not sent any websites: a PC on an older version. */
export function notRecorded(report: SiteReport): SiteReportDevice[] {
  return report.devices.filter((d) => (report.deviceId === null || d.deviceId === report.deviceId) && !d.sitesRecorded && d.removedAt === null);
}

/** The report has a PC (searches, private windows and pages come only from PCs). */
export function hasPc(report: SiteReport): boolean {
  return report.devices.some((d) => d.platform === 'windows' && d.sitesRecorded && (report.deviceId === null || d.deviceId === report.deviceId));
}

/** Searches and pages are kept 90 days: the period starts before the first kept day. */
export function titlesCut(report: SiteReport): boolean {
  return report.from < report.titlesKeptFrom;
}

const ENGINE_LABELS: Record<SearchEngine, string> = { google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo' };

export function engineLabel(engine: SearchEngine): string {
  return ENGINE_LABELS[engine];
}

const BROWSER_LABELS: Record<string, string> = {
  'msedge.exe': 'Edge',
  'chrome.exe': 'Chrome',
  'brave.exe': 'Brave',
  'firefox.exe': 'Firefox',
};

export function browserLabel(pkg: string): string {
  return BROWSER_LABELS[pkg] ?? pkg;
}

/** A short time in a list: "<1m" under a minute. */
export function shortTime(sec: number): string {
  return sec < 60 ? '<1m' : formatDuration(sec);
}

/** When a search was first made: the time on a day report, the day otherwise ("Thu 20 Nov"). */
export function searchWhen(firstAt: string, period: ReportPeriod, timeZone: string): string {
  if (period === 'day') return formatTimeOfDay(firstAt, timeZone);
  return new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(firstAt))
    .replace(/,/g, '');
}

/** How many website rows show before "Show all". */
export const SITES_SHOWN = 25;

/** A local date as "23 Aug". */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
}
