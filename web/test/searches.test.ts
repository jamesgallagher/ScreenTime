import { describe, expect, it } from 'vitest';
import {
  dayHeading,
  deviceName,
  filterSearches,
  groupByDay,
  localDate,
  namesList,
  notRecording,
  type SearchReport,
  type SearchReportDevice,
  type SearchReportItem,
  searchTotals,
  timeLine,
  whereLine,
} from '../src/lib/searches';

const SYDNEY = 'Australia/Sydney';
const PHONE = '00000000-0000-4000-8000-000000000001';
const PC = '00000000-0000-4000-8000-000000000002';

function item(over: Partial<SearchReportItem> = {}): SearchReportItem {
  return {
    query: 'how to bake a cake',
    engine: 'google',
    package: 'com.android.chrome',
    appLabel: 'Chrome',
    deviceId: PHONE,
    at: '2026-11-20T05:05:00Z',
    lastAt: '2026-11-20T05:05:00Z',
    count: 1,
    private: null,
    ...over,
  };
}

function device(over: Partial<SearchReportDevice> = {}): SearchReportDevice {
  return { deviceId: PHONE, name: 'Redmi', form: 'phone', platform: 'android', removedAt: null, capture: 'on', ...over };
}

function report(over: Partial<SearchReport> = {}): SearchReport {
  return {
    kidId: '00000000-0000-4000-8000-0000000000aa',
    period: 'week',
    from: '2026-11-16',
    to: '2026-11-22',
    today: '2026-11-20',
    deviceId: null,
    devices: [device(), device({ deviceId: PC, name: 'Desk PC', form: 'pc', platform: 'windows' })],
    searches: [],
    ...over,
  };
}

describe('localDate', () => {
  it('uses the family zone, not UTC', () => {
    // 20 Nov 14:30 UTC is 21 Nov 01:30 in Sydney (UTC+11).
    expect(localDate('2026-11-20T14:30:00Z', SYDNEY)).toBe('2026-11-21');
    expect(localDate('2026-11-20T12:59:00Z', SYDNEY)).toBe('2026-11-20');
  });
});

describe('dayHeading', () => {
  it('says Today, Yesterday, else the weekday and date', () => {
    expect(dayHeading('2026-11-20', '2026-11-20')).toBe('Today');
    expect(dayHeading('2026-11-19', '2026-11-20')).toBe('Yesterday');
    expect(dayHeading('2026-11-17', '2026-11-20')).toBe('Tue 17 Nov');
  });
});

describe('groupByDay', () => {
  it('splits by local day, newest day first, keeping the order within a day', () => {
    const late = item({ query: 'c', at: '2026-11-20T14:30:00Z' }); // 21 Nov 01:30 Sydney
    const evening = item({ query: 'b', at: '2026-11-20T09:00:00Z' }); // 20 Nov 20:00
    const morning = item({ query: 'a', at: '2026-11-19T21:00:00Z' }); // 20 Nov 08:00
    const before = item({ query: 'z', at: '2026-11-18T03:00:00Z' }); // 18 Nov 14:00
    const days = groupByDay([late, evening, morning, before], SYDNEY, '2026-11-21');
    expect(days.map((d) => [d.date, d.label, d.searches.map((s) => s.query)])).toEqual([
      ['2026-11-21', 'Today', ['c']],
      ['2026-11-20', 'Yesterday', ['b', 'a']],
      ['2026-11-18', 'Wed 18 Nov', ['z']],
    ]);
  });

  it('is empty for no searches', () => {
    expect(groupByDay([], SYDNEY, '2026-11-20')).toEqual([]);
  });
});

describe('filterSearches', () => {
  const list = [item({ query: 'How do I bypass Screen Time' }), item({ query: 'minecraft cheats' }), item({ query: 'weather tomorrow' })];

  it('matches any case and ignores spaces at the ends', () => {
    expect(filterSearches(list, '  BYPASS ').map((s) => s.query)).toEqual(['How do I bypass Screen Time']);
  });

  it('keeps all for an empty or blank text', () => {
    expect(filterSearches(list, '')).toHaveLength(3);
    expect(filterSearches(list, '   ')).toHaveLength(3);
  });

  it('is empty when nothing matches', () => {
    expect(filterSearches(list, 'roblox')).toEqual([]);
  });
});

describe('whereLine', () => {
  it('names the Google and YouTube apps, else engine in browser', () => {
    expect(whereLine(item({ package: 'com.google.android.googlequicksearchbox', appLabel: 'Google' }))).toBe('Google app');
    expect(whereLine(item({ engine: 'youtube', package: 'com.google.android.youtube', appLabel: 'YouTube' }))).toBe('YouTube app');
    expect(whereLine(item())).toBe('Google in Chrome');
    expect(whereLine(item({ engine: 'bing', package: 'msedge.exe', appLabel: 'Edge' }))).toBe('Bing in Edge');
    expect(whereLine(item({ engine: 'duckduckgo', package: 'firefox.exe', appLabel: 'Firefox' }))).toBe('DuckDuckGo in Firefox');
  });
});

describe('timeLine', () => {
  it('shows one time when seen once, a range when seen again', () => {
    expect(timeLine(item(), SYDNEY)).toBe('4:05 pm');
    expect(timeLine(item({ lastAt: '2026-11-20T05:09:00Z', count: 3 }), SYDNEY)).toBe('4:05 pm – 4:09 pm');
  });
});

describe('deviceName', () => {
  it('names the device only in All devices with more than one device', () => {
    expect(deviceName(item({ deviceId: PC }), report())).toBe('Desk PC');
    expect(deviceName(item(), report({ deviceId: PHONE }))).toBeNull();
    expect(deviceName(item(), report({ devices: [device()] }))).toBeNull();
  });
});

describe('searchTotals', () => {
  it('counts searches, different words in any case, and private ones (null is not private)', () => {
    const list = [
      item({ query: 'Minecraft cheats', private: true }),
      item({ query: 'minecraft cheats ', private: false }),
      item({ query: 'weather tomorrow', private: null }),
    ];
    expect(searchTotals(list)).toEqual({ searches: 3, different: 2, private: 1 });
  });

  it('is all zero for no searches', () => {
    expect(searchTotals([])).toEqual({ searches: 0, different: 0, private: 0 });
  });
});

describe('notRecording', () => {
  const devices = [
    device({ capture: 'off' }),
    device({ deviceId: PC, name: 'Desk PC', form: 'pc', platform: 'windows', capture: 'never' }),
    device({ deviceId: '00000000-0000-4000-8000-000000000003', name: 'Old tablet', capture: 'off', removedAt: '2026-11-01T00:00:00Z' }),
    device({ deviceId: '00000000-0000-4000-8000-000000000004', name: 'Pixel', capture: 'on' }),
  ];

  it('splits the report devices by why, leaving out removed ones and those recording', () => {
    const r = notRecording(report({ devices }));
    expect(r.off.map((d) => d.name)).toEqual(['Redmi']);
    expect(r.never.map((d) => d.name)).toEqual(['Desk PC']);
  });

  it('looks only at the chosen device', () => {
    const r = notRecording(report({ devices, deviceId: PC }));
    expect(r.off).toEqual([]);
    expect(r.never.map((d) => d.name)).toEqual(['Desk PC']);
  });
});

describe('namesList', () => {
  it('joins with commas and "and"', () => {
    expect(namesList([])).toBe('');
    expect(namesList([{ name: 'Redmi' }])).toBe('Redmi');
    expect(namesList([{ name: 'Redmi' }, { name: 'Desk PC' }])).toBe('Redmi and Desk PC');
    expect(namesList([{ name: 'Redmi' }, { name: 'Tablet' }, { name: 'Desk PC' }])).toBe('Redmi, Tablet and Desk PC');
  });
});
