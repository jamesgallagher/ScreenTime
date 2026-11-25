/**
 * The Websites report (docs/SPEC.md §12.10, CARD-070): which sites a kid or shared device's devices looked up, sorted
 * by the family's local LLM into kinds and categories, and on PCs the searches, private-window time and page titles
 * read from the browsers' window titles. Same periods and device choice as the Apps report (lib/reports.ts).
 */
import type {
  SiteCategory,
  SiteClassOverride,
  SiteKind,
  SiteReport,
  SiteReportCategory,
  SiteReportDevice,
  SiteReportSite,
} from '@screentime/schemas';
import { api } from '@/lib/auth';
import { formatDuration, formatTimeOfDay } from '@/lib/format';
import type { ReportPeriod } from '@/lib/reports';

// ---- The seam: the SiteReport types (from @screentime/schemas), GET /v1/reports/sites and
// PUT/DELETE /v1/sites/{site}/class (docs/SPEC.md §12.10, CARD-070). ----

export type {
  SiteCategory,
  SiteClassOverride,
  SiteClassSource,
  SiteKind,
  SiteReport,
  SiteReportApp,
  SiteReportCategory,
  SiteReportDevice,
  SiteReportPage,
  SiteReportSite,
} from '@screentime/schemas';

export interface SiteReportQuery {
  kidId: string;
  period: ReportPeriod;
  date: string;
  deviceId: string | null;
}

/** GET /v1/reports/sites (docs/SPEC.md §12.10). */
export async function fetchSiteReport(query: SiteReportQuery): Promise<SiteReport> {
  const params = new URLSearchParams({ kidId: query.kidId, period: query.period, date: query.date });
  if (query.deviceId !== null) params.set('deviceId', query.deviceId);
  return api.get<SiteReport>(`/v1/reports/sites?${params}`);
}

/** PUT /v1/sites/{site}/class. */
export async function setSiteClass(site: string, override: SiteClassOverride): Promise<void> {
  await api.put(`/v1/sites/${encodeURIComponent(site)}/class`, override);
}

/** DELETE /v1/sites/{site}/class: back to the classifier's. */
export async function clearSiteClass(site: string): Promise<void> {
  await api.delete(`/v1/sites/${encodeURIComponent(site)}/class`);
}

/** What the server works out for `categories`. */
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

/** Pages are kept 90 days: the period starts before the first kept day. */
export function titlesCut(report: SiteReport): boolean {
  return report.from < report.titlesKeptFrom;
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

/** How many website rows show before "Show all". */
export const SITES_SHOWN = 25;

/** A local date as "23 Aug". */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
}
