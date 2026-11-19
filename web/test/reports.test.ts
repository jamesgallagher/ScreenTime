import { describe, expect, it } from 'vitest';
import {
  type AppReport,
  type AppReportApp,
  barPercent,
  deviceSplit,
  hasUnrecorded,
  isCurrentPeriod,
  localToday,
  parseReportSearch,
  periodDates,
  periodLabel,
  periodRange,
  removedLine,
  screenTimeLabel,
  shiftPeriod,
  splitOther,
} from '../src/lib/reports';

const SYDNEY = 'Australia/Sydney';
const TODAY = '2026-11-20'; // a Friday

function app(over: Partial<AppReportApp> = {}): AppReportApp {
  return { package: 'a.b', label: 'Game', totalSec: 600, devices: [{ deviceId: 'p', sec: 600 }], installedAt: null, removedAt: null, ...over };
}

function report(over: Partial<AppReport> = {}): AppReport {
  return {
    kidId: 'k',
    period: 'week',
    from: '2026-11-16',
    to: '2026-11-22',
    today: TODAY,
    deviceId: null,
    devices: [
      { deviceId: 'p', name: 'Pixel', form: 'phone', platform: 'android', removedAt: null, appsRecorded: true },
      { deviceId: 't', name: 'XPPen', form: 'tablet', platform: 'android', removedAt: null, appsRecorded: true },
    ],
    screenTime: [],
    apps: [],
    ...over,
  };
}

describe('periods', () => {
  it('runs a week from Monday to Sunday', () => {
    expect(periodRange('week', '2026-11-20')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(periodRange('week', '2026-11-16')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(periodRange('week', '2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
  });

  it('runs a week across a month and a year', () => {
    expect(periodRange('week', '2026-12-31')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });

  it('runs a month from the 1st to its last day, leap years too', () => {
    expect(periodRange('month', '2026-11-20')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('day', TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it('steps to the period before and after', () => {
    expect(shiftPeriod('day', '2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftPeriod('week', '2026-11-20', -1)).toBe('2026-11-09');
    expect(shiftPeriod('week', '2026-11-09', 1)).toBe('2026-11-16');
    expect(shiftPeriod('month', '2026-03-31', -1)).toBe('2026-02-01');
    expect(shiftPeriod('month', '2026-01-15', -1)).toBe('2025-12-01');
  });

  it('knows the period that holds today', () => {
    expect(isCurrentPeriod('week', '2026-11-16', TODAY)).toBe(true);
    expect(isCurrentPeriod('week', '2026-11-15', TODAY)).toBe(false);
    expect(isCurrentPeriod('month', '2026-11-01', TODAY)).toBe(true);
  });

  it('takes today from the family time zone', () => {
    // 20 Nov 14:30 UTC is already 21 Nov in Sydney.
    expect(localToday(SYDNEY, new Date('2026-11-20T14:30:00Z'))).toBe('2026-11-21');
    expect(localToday('UTC', new Date('2026-11-20T14:30:00Z'))).toBe('2026-11-20');
  });
});

describe('period labels', () => {
  it('names days', () => {
    expect(periodLabel('day', TODAY, TODAY)).toBe('Today');
    expect(periodLabel('day', '2026-11-19', TODAY)).toBe('Yesterday');
    expect(periodLabel('day', '2026-11-12', TODAY)).toBe('Thu 12 Nov');
    expect(periodLabel('day', '2025-11-12', TODAY)).toBe('Wed 12 Nov 2025');
  });

  it('names weeks', () => {
    expect(periodLabel('week', TODAY, TODAY)).toBe('This week');
    expect(periodLabel('week', '2026-11-10', TODAY)).toBe('9 – 15 Nov');
    expect(periodLabel('week', '2026-11-01', TODAY)).toBe('26 Oct – 1 Nov');
  });

  it('names months', () => {
    expect(periodLabel('month', TODAY, TODAY)).toBe('This month');
    expect(periodLabel('month', '2026-10-05', TODAY)).toBe('October 2026');
  });

  it('gives the full dates under the label', () => {
    expect(periodDates('day', TODAY)).toBe('Friday 20 November 2026');
    expect(periodDates('week', TODAY)).toBe('Mon 16 Nov – Sun 22 Nov 2026');
    expect(periodDates('month', '2026-02-03')).toBe('1 – 28 Feb 2026');
  });
});

describe('the apps list', () => {
  it('folds apps under a minute into Other', () => {
    const { shown, other, otherSec } = splitOther([app({ totalSec: 600 }), app({ package: 'x', totalSec: 59 }), app({ package: 'y', totalSec: 20 })]);
    expect(shown.map((a) => a.totalSec)).toEqual([600]);
    expect(other.map((a) => a.package)).toEqual(['x', 'y']);
    expect(otherSec).toBe(79);
  });

  it('splits an app by device only in All devices with two devices that record apps', () => {
    const two = app({ devices: [{ deviceId: 'p', sec: 4200 }, { deviceId: 't', sec: 1800 }] });
    expect(deviceSplit(two, report())).toBe('Pixel 1h 10m · XPPen 30m');
    expect(deviceSplit(two, report({ deviceId: 'p' }))).toBeNull();
    const pcAndPhone = report({
      devices: [
        { deviceId: 'p', name: 'Pixel', form: 'phone', platform: 'android', removedAt: null, appsRecorded: true },
        { deviceId: 'pc', name: 'Desk PC', form: 'pc', platform: 'windows', removedAt: null, appsRecorded: false },
      ],
    });
    expect(deviceSplit(app(), pcAndPhone)).toBeNull();
  });

  it('says when a removed app was installed and removed, in the family time zone', () => {
    expect(removedLine(app(), SYDNEY)).toBeNull();
    expect(removedLine(app({ installedAt: '2026-11-02T20:00:00Z', removedAt: '2026-11-04T01:00:00Z' }), SYDNEY)).toBe('Installed 3 Nov · removed 4 Nov');
    expect(removedLine(app({ removedAt: '2026-11-04T01:00:00Z' }), SYDNEY)).toBe('Removed 4 Nov');
  });

  it('draws bars against the most used app, never invisible', () => {
    expect(barPercent(600, 600)).toBe(100);
    expect(barPercent(1, 6000)).toBe(2);
    expect(barPercent(0, 600)).toBe(0);
  });
});

describe('screen time and devices', () => {
  it('names the pools', () => {
    expect(screenTimeLabel('screens', false, null)).toBe('Screens');
    expect(screenTimeLabel('phone', false, null)).toBe('Phone');
    expect(screenTimeLabel('screens', true, null)).toBe('Time');
    expect(screenTimeLabel('phone', false, report().devices[0]!)).toBe('Pixel');
  });

  it('notes a PC in the report, but not a removed one or one left out', () => {
    const pc = { deviceId: 'pc', name: 'Desk PC', form: 'pc' as const, platform: 'windows' as const, removedAt: null, appsRecorded: false };
    expect(hasUnrecorded(report())).toBe(false);
    expect(hasUnrecorded(report({ devices: [...report().devices, pc] }))).toBe(true);
    expect(hasUnrecorded(report({ devices: [...report().devices, pc], deviceId: 'p' }))).toBe(false);
    expect(hasUnrecorded(report({ devices: [{ ...pc, removedAt: '2026-11-01T00:00:00Z' }] }))).toBe(false);
  });
});

describe('the address', () => {
  it('keeps what it understands and drops the rest', () => {
    expect(parseReportSearch({ kid: 'k', device: 'd', period: 'month', date: '2026-11-20' })).toEqual({ kid: 'k', device: 'd', period: 'month', date: '2026-11-20' });
    expect(parseReportSearch({ period: 'year', date: '2026-02-30', kid: '' })).toEqual({ kid: undefined, device: undefined, period: undefined, date: undefined });
  });
});
