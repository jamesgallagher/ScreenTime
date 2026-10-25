import { describe, expect, it } from 'vitest';
import { formatDuration, formatTimeOfDay } from '@/lib/format';

describe('formatDuration', () => {
  it('writes hours and minutes the way docs/SPEC.md §16.1 shows them', () => {
    expect(formatDuration(0)).toBe('less than a minute');
    expect(formatDuration(59)).toBe('less than a minute');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(45 * 60 + 59)).toBe('45m');
    expect(formatDuration(60 * 60)).toBe('1h 00m');
    expect(formatDuration(72 * 60)).toBe('1h 12m');
    expect(formatDuration(8 * 3600 + 5 * 60)).toBe('8h 05m');
  });

  it('treats a negative amount as nothing left', () => {
    expect(formatDuration(-300)).toBe('less than a minute');
  });
});

describe('formatTimeOfDay', () => {
  it('shows 12-hour times with am and pm in the family time zone', () => {
    // Sydney is UTC+11 in late October (daylight saving).
    expect(formatTimeOfDay('2026-10-25T09:30:00Z', 'Australia/Sydney')).toBe('8:30 pm');
    expect(formatTimeOfDay('2026-10-25T13:00:00Z', 'Australia/Sydney')).toBe('12:00 am');
    expect(formatTimeOfDay(new Date('2026-10-25T01:05:00Z'), 'Australia/Perth')).toBe('9:05 am');
  });
});
