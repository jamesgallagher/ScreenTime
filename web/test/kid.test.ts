import type { ScheduleDay, ScheduleInput } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { countdownText, lastSeenText, normalisePhone, spacedCode } from '../src/lib/kid';
import {
  allowanceOptions,
  copyMondayToWeekdays,
  copySaturdayToWeekend,
  formatClock,
  hasErrors,
  scheduleErrors,
  timeOptions,
} from '../src/lib/schedule';

const NOW = new Date('2026-10-26T01:00:00Z');

function week(): ScheduleDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    screensMin: weekday * 15,
    phoneMin: 60,
    wake: '07:00',
    bedtime: '20:30',
  }));
}

describe('schedule options', () => {
  it('writes times of day in 12-hour form, with midnight for the end of the day', () => {
    expect(formatClock('00:00')).toBe('12:00 am');
    expect(formatClock('07:05')).toBe('7:05 am');
    expect(formatClock('12:30')).toBe('12:30 pm');
    expect(formatClock('20:30')).toBe('8:30 pm');
    expect(formatClock('24:00')).toBe('midnight');
  });

  it('offers wake-up from midnight to 11:45 pm and bedtime from 12:15 am to midnight', () => {
    const wake = timeOptions('wake', '07:00');
    const bedtime = timeOptions('bedtime', '20:30');
    expect(wake).toHaveLength(96);
    expect(wake[0]).toEqual({ value: '00:00', label: '12:00 am' });
    expect(wake.at(-1)).toEqual({ value: '23:45', label: '11:45 pm' });
    expect(bedtime).toHaveLength(96);
    expect(bedtime[0]?.value).toBe('00:15');
    expect(bedtime.at(-1)).toEqual({ value: '24:00', label: 'midnight' });
  });

  it('keeps a saved value that is off the 15-minute grid, in order', () => {
    const options = timeOptions('bedtime', '20:20');
    expect(options).toHaveLength(97);
    const i = options.findIndex((o) => o.value === '20:20');
    expect(options[i - 1]?.value).toBe('20:15');
    expect(options[i + 1]?.value).toBe('20:30');
    expect(allowanceOptions(800).at(-1)).toEqual({ value: 800, label: '13h 20m' });
  });

  it('offers allowances from no time to 12 hours in 15-minute steps', () => {
    const options = allowanceOptions(120);
    expect(options).toHaveLength(49);
    expect(options[0]).toEqual({ value: 0, label: 'No time' });
    expect(options[1]).toEqual({ value: 15, label: '15m' });
    expect(options[6]).toEqual({ value: 90, label: '1h 30m' });
    expect(options.at(-1)).toEqual({ value: 720, label: '12h 00m' });
  });
});

describe('schedule copy buttons', () => {
  it('copies Monday to Tuesday to Friday, keeping their weekdays', () => {
    const days = copyMondayToWeekdays(week());
    expect(days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days.map((d) => d.screensMin)).toEqual([15, 15, 15, 15, 15, 90, 105]);
  });

  it('copies Saturday to Sunday', () => {
    const days = copySaturdayToWeekend(week());
    expect(days.map((d) => d.screensMin)).toEqual([15, 30, 45, 60, 75, 90, 90]);
    expect(days[6]?.weekday).toBe(7);
  });
});

describe('schedule errors', () => {
  it('flags a bedtime at or before wake-up, and warnings in the wrong order', () => {
    const days = week();
    days[2] = { ...days[2]!, wake: '21:00', bedtime: '20:30' };
    const input: ScheduleInput = { warn1Min: 5, warn2Min: 5, days };
    const errors = scheduleErrors(input);
    expect(errors.days).toEqual({ 3: 'Bedtime must be after wake-up.' });
    expect(errors.warnings).toBe('The first warning must come before the second.');
    expect(hasErrors(errors)).toBe(true);
    expect(hasErrors(scheduleErrors({ warn1Min: 15, warn2Min: 5, days: week() }))).toBe(false);
  });
});

describe('device helpers', () => {
  it('says when a device was last seen', () => {
    expect(lastSeenText(null, NOW)).toBe('Never connected');
    expect(lastSeenText('2026-10-26T00:59:30Z', NOW)).toBe('Seen just now');
    expect(lastSeenText('2026-10-26T00:48:00Z', NOW)).toBe('Seen 12 min ago');
    expect(lastSeenText('2026-10-25T22:00:00Z', NOW)).toBe('Seen 3h ago');
    expect(lastSeenText('2026-10-25T00:00:00Z', NOW)).toBe('Seen 1 day ago');
    expect(lastSeenText('2026-10-23T00:00:00Z', NOW)).toBe('Seen 3 days ago');
  });

  it('counts down to the end of an enrolment code', () => {
    expect(countdownText('2026-10-26T01:10:00Z', NOW)).toBe('10:00');
    expect(countdownText('2026-10-26T01:00:59.200Z', NOW)).toBe('1:00');
    expect(countdownText('2026-10-26T01:00:05Z', NOW)).toBe('0:05');
    expect(countdownText('2026-10-26T00:59:00Z', NOW)).toBe('0:00');
    expect(spacedCode('123456')).toBe('123 456');
  });

  it('turns typed phone numbers into international format', () => {
    expect(normalisePhone('0412 345 678')).toBe('+61412345678');
    expect(normalisePhone('(02) 9876-5432')).toBe('+61298765432');
    expect(normalisePhone('+61 412 345 678')).toBe('+61412345678');
    expect(normalisePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalisePhone('0412 345')).toBeNull();
    expect(normalisePhone('412345678')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });
});
