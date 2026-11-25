import { describe, expect, it } from 'vitest';
import {
  activeTime,
  appsLine,
  categoryLabel,
  categoryTotals,
  dayLabel,
  filterSites,
  hasPc,
  isBehindTheScenes,
  isWorthALook,
  notRecorded,
  ownerLine,
  siteDeviceSplit,
  siteName,
  type SiteReport,
  type SiteReportSite,
  sourceLine,
  titlesCut,
  whenLine,
} from '../src/lib/sites';

const SYDNEY = 'Australia/Sydney';

function site(over: Partial<SiteReportSite> = {}): SiteReportSite {
  return {
    site: 'khanacademy.org',
    label: 'Khan Academy',
    kind: 'website',
    category: 'education',
    source: 'classifier',
    owner: null,
    minutes: 17,
    lookups: 40,
    days: 3,
    firstAt: '2026-11-19T22:10:00.000Z', // 9:10 am in Sydney on 20 Nov
    lastAt: '2026-11-20T07:45:00.000Z', // 6:45 pm
    apps: [{ package: 'com.android.chrome', label: 'Chrome', browser: true, minutes: 17 }],
    devices: [{ deviceId: 'p', minutes: 17 }],
    ...over,
  };
}

function report(over: Partial<SiteReport> = {}): SiteReport {
  return {
    kidId: 'k',
    period: 'week',
    from: '2026-11-16',
    to: '2026-11-22',
    today: '2026-11-20',
    deviceId: null,
    devices: [
      { deviceId: 'p', name: 'Redmi', form: 'phone', platform: 'android', removedAt: null, sitesRecorded: true },
      { deviceId: 'w', name: 'Gaming PC', form: 'pc', platform: 'windows', removedAt: null, sitesRecorded: true },
    ],
    categories: [],
    sites: [],
    behindTheScenes: [],
    browserSec: 0,
    privateSec: 0,
    pages: [],
    titlesKeptFrom: '2026-08-23',
    ...over,
  };
}

describe('categories', () => {
  it('names each category, and a site not sorted yet', () => {
    expect(categoryLabel('violence_weapons')).toBe('Violence and weapons');
    expect(categoryLabel('self_harm')).toBe('Self-harm');
    expect(categoryLabel(null)).toBe('Not sorted yet');
  });

  it('marks the five categories worth a look, and nothing else', () => {
    expect(['adult', 'gambling', 'violence_weapons', 'drugs', 'self_harm'].every((c) => isWorthALook(c as never))).toBe(true);
    expect(isWorthALook('games')).toBe(false);
    expect(isWorthALook('other')).toBe(false);
    expect(isWorthALook(null)).toBe(false);
  });

  it('adds up active minutes and sites per category, most first, not sorted yet as its own entry', () => {
    const totals = categoryTotals([
      site({ site: 'a.com', category: 'games', minutes: 10 }),
      site({ site: 'b.com', category: 'video', minutes: 30 }),
      site({ site: 'c.com', category: 'games', minutes: 25 }),
      site({ site: 'd.com', kind: null, category: null, source: null, minutes: 2 }),
    ]);
    expect(totals).toEqual([
      { category: 'games', minutes: 35, sites: 2 },
      { category: 'video', minutes: 30, sites: 1 },
      { category: null, minutes: 2, sites: 1 },
    ]);
    expect(categoryTotals([])).toEqual([]);
  });

  it('filters the list by category, or not at all', () => {
    const sites = [site({ site: 'a.com', category: 'games' }), site({ site: 'b.com', category: null, kind: null })];
    expect(filterSites(sites, 'all').map((s) => s.site)).toEqual(['a.com', 'b.com']);
    expect(filterSites(sites, 'games').map((s) => s.site)).toEqual(['a.com']);
    expect(filterSites(sites, null).map((s) => s.site)).toEqual(['b.com']);
    expect(filterSites(sites, 'adult')).toEqual([]);
  });
});

describe('a row', () => {
  it('folds CDNs, ads and app services away; websites, unknown and unsorted stay', () => {
    expect(isBehindTheScenes('cdn')).toBe(true);
    expect(isBehindTheScenes('ads_tracking')).toBe(true);
    expect(isBehindTheScenes('app_service')).toBe(true);
    expect(isBehindTheScenes('website')).toBe(false);
    expect(isBehindTheScenes('unknown')).toBe(false);
    expect(isBehindTheScenes(null)).toBe(false);
  });

  it('uses the label, else the site', () => {
    expect(siteName(site())).toBe('Khan Academy');
    expect(siteName(site({ label: null }))).toBe('khanacademy.org');
  });

  it('shows active minutes as a duration', () => {
    expect(activeTime(0)).toBe('0m');
    expect(activeTime(45)).toBe('45m');
    expect(activeTime(65)).toBe('1h 05m');
  });

  it('lists at most three apps, then how many more', () => {
    const app = (label: string) => ({ package: label, label, browser: false, minutes: 1 });
    expect(appsLine(site({ apps: [app('Chrome'), app('Roblox')] }))).toBe('Chrome, Roblox');
    expect(appsLine(site({ apps: ['A', 'B', 'C', 'D', 'E'].map(app) }))).toBe('A, B, C +2');
  });

  it('gives the first and last time on a day, the number of days otherwise', () => {
    expect(whenLine(site(), 'day', SYDNEY)).toBe('9:10 am – 6:45 pm');
    expect(whenLine(site({ lastAt: '2026-11-19T22:10:00.000Z' }), 'day', SYDNEY)).toBe('at 9:10 am');
    expect(whenLine(site(), 'week', SYDNEY)).toBe('on 3 days');
    expect(whenLine(site({ days: 1 }), 'month', SYDNEY)).toBe('on 1 day');
  });

  it('splits by device only in All devices with more than one device', () => {
    const two = site({ devices: [{ deviceId: 'p', minutes: 40 }, { deviceId: 'w', minutes: 12 }] });
    expect(siteDeviceSplit(two, report())).toBe('Redmi 40m · Gaming PC 12m');
    expect(siteDeviceSplit(two, report({ deviceId: 'p' }))).toBeNull();
    expect(siteDeviceSplit(site(), report())).toBeNull();
  });

  it('says who sorted it when it was not the classifier', () => {
    expect(sourceLine(site())).toBeNull();
    expect(sourceLine(site({ source: 'parent' }))).toBe('Set by a parent');
    expect(sourceLine(site({ source: 'family_dns' }))).toBe('Blocked by a family filter: adult or unsafe');
    expect(sourceLine(site({ source: null, kind: null, category: null }))).toBeNull();
  });

  it('names the site a CDN serves, not itself', () => {
    expect(ownerLine(site({ site: 'googlevideo.com', kind: 'cdn', owner: 'youtube.com' }))).toBe('for youtube.com');
    expect(ownerLine(site({ site: 'bark.us', kind: 'app_service', owner: 'bark.us' }))).toBeNull();
    expect(ownerLine(site())).toBeNull();
  });
});

describe('the report', () => {
  it('names the devices in the report that have sent no websites, not removed ones', () => {
    const r = report({
      devices: [
        { deviceId: 'p', name: 'Redmi', form: 'phone', platform: 'android', removedAt: null, sitesRecorded: true },
        { deviceId: 'w', name: 'Gaming PC', form: 'pc', platform: 'windows', removedAt: null, sitesRecorded: false },
        { deviceId: 'o', name: 'Old PC', form: 'pc', platform: 'windows', removedAt: '2026-10-01T00:00:00.000Z', sitesRecorded: false },
      ],
    });
    expect(notRecorded(r).map((d) => d.name)).toEqual(['Gaming PC']);
    expect(notRecorded({ ...r, deviceId: 'p' })).toEqual([]);
  });

  it('has a PC part only when a PC in the report sends websites', () => {
    expect(hasPc(report())).toBe(true);
    expect(hasPc(report({ deviceId: 'p' }))).toBe(false);
    expect(hasPc(report({ devices: [report().devices[0]!] }))).toBe(false);
  });

  it('says when pages before the period are gone', () => {
    expect(titlesCut(report())).toBe(false);
    expect(titlesCut(report({ period: 'month', from: '2026-08-01', to: '2026-08-31' }))).toBe(true);
    expect(dayLabel('2026-08-23')).toBe('23 Aug');
  });

});
