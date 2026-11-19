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

/**
 * The schedule a new shared device starts with (docs/SPEC.md §12.8): 0 minutes every day, with each day's
 * wake-up the latest and bedtime the earliest of the family's other kids' current schedules for that weekday
 * (07:00 and 20:00 when there are no such kids).
 */
export function sharedWeek(otherKids: { days: ScheduleDay[] }[]): ScheduleDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const wakes = otherKids.map((k) => k.days.find((d) => d.weekday === weekday)?.wake).filter((w): w is string => w !== undefined);
    const bedtimes = otherKids.map((k) => k.days.find((d) => d.weekday === weekday)?.bedtime).filter((b): b is string => b !== undefined);
    return {
      weekday,
      screensMin: 0,
      phoneMin: 0,
      wake: wakes.length > 0 ? wakes.reduce((a, b) => (a > b ? a : b)) : '07:00',
      bedtime: bedtimes.length > 0 ? bedtimes.reduce((a, b) => (a < b ? a : b)) : '20:00',
    };
  });
}
