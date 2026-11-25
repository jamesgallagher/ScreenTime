/**
 * The Searches report (docs/SPEC.md §12.12, CARD-074): every search a kid or shared device's devices sent, newest
 * first, with the same periods and device choice as the Apps and Websites reports (lib/reports.ts). Android reads the
 * search from Chrome's address bar, the Google app and the YouTube app; a PC reads it from the browser's window title.
 */
import type { SearchEngine, SearchReport, SearchReportDevice, SearchReportItem } from '@screentime/schemas';
import { api } from '@/lib/auth';
import { formatTimeOfDay } from '@/lib/format';
import { addDays, type ReportPeriod } from '@/lib/reports';

// ---- The seam: SearchReport types and GET /v1/reports/searches (docs/SPEC.md §12.12, CARD-074). ----

export type {
  SearchCapture,
  SearchEngine,
  SearchReport,
  SearchReportDevice,
  SearchReportItem,
} from '@screentime/schemas';

export interface SearchReportQuery {
  kidId: string;
  period: ReportPeriod;
  date: string;
  deviceId: string | null;
}

/** GET /v1/reports/searches (docs/SPEC.md §12.12). */
export async function fetchSearchReport(query: SearchReportQuery): Promise<SearchReport> {
  const params = new URLSearchParams({ kidId: query.kidId, period: query.period, date: query.date });
  if (query.deviceId !== null) params.set('deviceId', query.deviceId);
  return api.get<SearchReport>(`/v1/reports/searches?${params}`);
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
