import type { ScheduleDay, ScheduleInput } from '@screentime/schemas';
import { formatDuration } from '@/lib/format';

/** ISO weekday 1 (Monday) to 7 (Sunday), as the schedule stores them. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SCHEDULE_STEP = 15;
/** The longest allowance the editor offers. The API allows up to 24 hours, so a longer saved value is kept as an option. */
export const MAX_ALLOWANCE_MIN = 12 * 60;
export const WARN1_OPTIONS = [10, 15, 20, 30, 45, 60];
export const WARN2_OPTIONS = [1, 2, 3, 5, 10];

export interface Option<T> {
  value: T;
  label: string;
}

function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "7:00 am", "12:30 pm", "midnight" for the end of the day (docs/SPEC.md §16.1, 12-hour). */
export function formatClock(time: string): string {
  const minutes = minutesOf(time);
  if (minutes === 1440) return 'midnight';
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

/** Adds the saved value when it is off the 15-minute grid, so the select still shows it. */
function withCurrent<T extends string | number>(options: Option<T>[], current: T, label: (v: T) => string, key: (v: T) => number) {
  if (options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: label(current) }].sort((a, b) => key(a.value) - key(b.value));
}

/** Wake-up: midnight to 11:45 pm. Bedtime: 12:15 am to midnight (end of day). 15-minute steps. */
export function timeOptions(kind: 'wake' | 'bedtime', current: string): Option<string>[] {
  const first = kind === 'wake' ? 0 : SCHEDULE_STEP;
  const last = kind === 'wake' ? 1440 - SCHEDULE_STEP : 1440;
  const options: Option<string>[] = [];
  for (let m = first; m <= last; m += SCHEDULE_STEP) options.push({ value: timeOf(m), label: formatClock(timeOf(m)) });
  return withCurrent(options, current, formatClock, minutesOf);
}

export function formatAllowance(minutes: number): string {
  return minutes === 0 ? 'No time' : formatDuration(minutes * 60);
}

/** No time, 15m, 30m … 12h 00m. */
export function allowanceOptions(current: number): Option<number>[] {
  const options: Option<number>[] = [];
  for (let m = 0; m <= MAX_ALLOWANCE_MIN; m += SCHEDULE_STEP) options.push({ value: m, label: formatAllowance(m) });
  return withCurrent(options, current, formatAllowance, (v) => v);
}

/** Tuesday to Friday become copies of Monday. */
export function copyMondayToWeekdays(days: ScheduleDay[]): ScheduleDay[] {
  const monday = days.find((d) => d.weekday === 1);
  if (!monday) return days;
  return days.map((day) => (day.weekday >= 2 && day.weekday <= 5 ? { ...monday, weekday: day.weekday } : day));
}

/** Sunday becomes a copy of Saturday. */
export function copySaturdayToWeekend(days: ScheduleDay[]): ScheduleDay[] {
  const saturday = days.find((d) => d.weekday === 6);
  if (!saturday) return days;
  return days.map((day) => (day.weekday === 7 ? { ...saturday, weekday: 7 } : day));
}

export interface ScheduleErrors {
  /** Bedtime message per weekday (1 to 7) with a wake-up at or after bedtime. */
  days: Record<number, string>;
  warnings: string | null;
}

/** The same rules as the API (packages/schemas kids.ts), with words for the form. */
export function scheduleErrors(schedule: ScheduleInput): ScheduleErrors {
  const days: Record<number, string> = {};
  for (const day of schedule.days) {
    if (day.wake >= day.bedtime) days[day.weekday] = 'Bedtime must be after wake-up.';
  }
  const warnings = schedule.warn1Min > schedule.warn2Min ? null : 'The first warning must come before the second.';
  return { days, warnings };
}

export function hasErrors(errors: ScheduleErrors): boolean {
  return Object.keys(errors.days).length > 0 || errors.warnings !== null;
}
