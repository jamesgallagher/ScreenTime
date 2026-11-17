/**
 * Extend bedtime tonight (docs/SPEC.md §7.5): a parent moves one kid's bedtime later for today only. The kid keeps
 * any time that is left until the new bedtime; with none left, the always-allowed apps keep working until then.
 *
 * This file is the seam between the Today page and the server. Until CARD-062 wires it, it answers from memory:
 * every kid's bedtime is 8:30 pm and an extension lasts until the page reloads.
 */
import type { TodayKid } from '@screentime/schemas';
import { formatDuration } from '@/lib/format';
import { formatClock } from '@/lib/schedule';

/** Tonight's bedtime of one kid, as `GET /v1/today` will send it in `TodayKid.bedtime`. Times are "HH:MM", local. */
export interface TodayBedtime {
  /** Today's bedtime from the schedule; "24:00" means none. */
  scheduled: string;
  /** The bedtime that counts tonight: the extension, or `scheduled` when there is none. */
  tonight: string;
  /** The parent who extended it, or null when tonight is the scheduled bedtime. */
  extendedBy: string | null;
  /** The earliest bedtime a parent can pick now (a quarter hour after both `scheduled` and now), or null for none. */
  earliest: string | null;
}

export const BEDTIME_STEP = 15;
/** The bedtime the dialog starts at when there is no extension yet: an hour later than usual. */
export const DEFAULT_EXTRA_MIN = 60;
export const QUICK_EXTRA_MIN = [30, 60, 120];

function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// ---- The seam: CARD-062 replaces these three with kid.bedtime and the two routes. ----

const fake = new Map<string, { tonight: string; by: string }>();
const FAKE_SCHEDULED = '20:30';

/** The fake's earliest: the next quarter hour after the browser's clock, and after the scheduled bedtime. */
function fakeEarliest(scheduled: string): string | null {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const first = Math.max(minutesOf(scheduled), nowMin - (nowMin % BEDTIME_STEP)) + BEDTIME_STEP;
  return first > 1440 || minutesOf(scheduled) >= 1440 ? null : timeOf(first);
}

/** Tonight's bedtime for a kid on the Today page. */
export function bedtimeOf(kid: TodayKid): TodayBedtime {
  const ext = fake.get(kid.id);
  return {
    scheduled: FAKE_SCHEDULED,
    tonight: ext?.tonight ?? FAKE_SCHEDULED,
    extendedBy: ext?.by ?? null,
    earliest: fakeEarliest(FAKE_SCHEDULED),
  };
}

/** PUT /v1/kids/{kidId}/bedtime-tonight `{ bedtime }`: tonight's bedtime becomes `bedtime`. */
export async function extendBedtime(kidId: string, bedtime: string): Promise<TodayBedtime> {
  await new Promise((r) => setTimeout(r, 400));
  fake.set(kidId, { tonight: bedtime, by: 'You' });
  return { scheduled: FAKE_SCHEDULED, tonight: bedtime, extendedBy: 'You', earliest: fakeEarliest(FAKE_SCHEDULED) };
}

/** DELETE /v1/kids/{kidId}/bedtime-tonight: back to the scheduled bedtime. */
export async function endBedtimeExtension(kidId: string): Promise<TodayBedtime> {
  await new Promise((r) => setTimeout(r, 400));
  fake.delete(kidId);
  return { scheduled: FAKE_SCHEDULED, tonight: FAKE_SCHEDULED, extendedBy: null, earliest: fakeEarliest(FAKE_SCHEDULED) };
}

// ---- Pure helpers, used by the row and the dialog. ----

/** The row under the pools: "Bedtime 8:30 pm", or "Bedtime 9:30 pm tonight" with who and the usual time. */
export function bedtimeLine(b: TodayBedtime): { text: string; detail: string | null } {
  if (b.extendedBy !== null) {
    return {
      text: `Bedtime ${formatClock(b.tonight)} tonight`,
      detail: `Extended by ${b.extendedBy} · usually ${formatClock(b.scheduled)}`,
    };
  }
  if (minutesOf(b.scheduled) >= 1440) return { text: 'No bedtime today', detail: null };
  return { text: `Bedtime ${formatClock(b.scheduled)}`, detail: null };
}

/** The row's button: "Extend" or "Change", or null when there is nothing a parent can do now. */
export function bedtimeAction(b: TodayBedtime): 'Extend' | 'Change' | null {
  if (b.extendedBy !== null) return 'Change';
  return b.earliest === null ? null : 'Extend';
}

/** Every bedtime the dialog offers: `earliest` to midnight in 15-minute steps, plus tonight's when it is earlier. */
export function bedtimeChoices(b: TodayBedtime): string[] {
  const out: string[] = [];
  if (b.earliest !== null) {
    for (let m = minutesOf(b.earliest); m <= 1440; m += BEDTIME_STEP) out.push(timeOf(m));
  }
  // An extension that is already under way stays pickable, so the dialog can open on it.
  if (b.extendedBy !== null && !out.includes(b.tonight)) out.unshift(b.tonight);
  return out;
}

/** Where the dialog starts: tonight's extension, else an hour later than usual (kept inside the choices). */
export function startChoice(b: TodayBedtime): string | null {
  const choices = bedtimeChoices(b);
  if (choices.length === 0) return null;
  if (b.extendedBy !== null) return b.tonight;
  const want = minutesOf(b.scheduled) + DEFAULT_EXTRA_MIN;
  return choices.find((c) => minutesOf(c) >= want) ?? choices[choices.length - 1] ?? null;
}

/** One step later (1) or earlier (-1) through the choices; stays put at either end. */
export function stepChoice(choices: string[], value: string, direction: 1 | -1): string {
  const i = choices.indexOf(value);
  if (i < 0) return choices[0] ?? value;
  return choices[Math.min(choices.length - 1, Math.max(0, i + direction))] ?? value;
}

/** "+30m", "+1h", "+2h" from the scheduled bedtime, each with its time or null when it cannot be picked. */
export function quickChoices(b: TodayBedtime): { label: string; value: string | null }[] {
  const choices = bedtimeChoices(b);
  return QUICK_EXTRA_MIN.map((extra) => {
    const value = timeOf(minutesOf(b.scheduled) + extra);
    return { label: `+${extra < 60 ? `${extra}m` : `${extra / 60}h`}`, value: choices.includes(value) ? value : null };
  });
}

/** "1h 00m later than usual", under the time in the dialog. */
export function laterText(b: TodayBedtime, value: string): string {
  return `${formatDuration((minutesOf(value) - minutesOf(b.scheduled)) * 60)} later than usual`;
}

/** The time as the dialog's big number and button show it: "9:30 pm", "Midnight". */
export function bedtimeClock(value: string): string {
  const text = formatClock(value);
  return text === 'midnight' ? 'Midnight' : text;
}
