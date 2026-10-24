import type { ScheduleDay } from '@screentime/schemas';

/** Minutes before a lock for the first and second warning (docs/SPEC.md §6.1 schedule_versions). */
export const DEFAULT_WARN1_MIN = 15;
export const DEFAULT_WARN2_MIN = 5;

/**
 * The schedule a new kid starts with: school days 2 h Screens and 1.5 h Phone, 7:00 to 20:30;
 * weekends 3 h and 2 h, 8:00 to 21:00. Parents change it in the app.
 */
export function defaultWeek(): ScheduleDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5
      ? { weekday, screensMin: 120, phoneMin: 90, wake: '07:00', bedtime: '20:30' }
      : { weekday, screensMin: 180, phoneMin: 120, wake: '08:00', bedtime: '21:00' },
  );
}
