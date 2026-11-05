import type { EventItem } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { appChoice, firstUsedLine, installedLine, isRemoved, type KidApp, type KidAppDevice, sortApps, todayLine } from '../src/lib/apps';
import { eventView, pendingAppApprovals } from '../src/lib/inbox';
import { NOTIFICATION_TEXT } from '../src/lib/settings';

const SYDNEY = 'Australia/Sydney';

function device(over: Partial<KidAppDevice> = {}): KidAppDevice {
  return {
    deviceId: 'phone',
    deviceName: 'Pixel 7',
    installedAt: '2026-11-03T06:00:00Z',
    firstUsedAt: null,
    removedAt: null,
    ...over,
  };
}

function app(over: Partial<KidApp> = {}): KidApp {
  return { package: 'a.b', label: 'Game', source: 'play', blockable: true, todaySeconds: 0, devices: [device()], rule: null, ...over };
}

describe('the lines of an app', () => {
  it('says where it came from, when, and on what', () => {
    expect(installedLine(app(), SYDNEY)).toBe('From Play Store · 3 Nov on Pixel 7');
    expect(installedLine(app({ source: 'other' }), SYDNEY)).toBe('Installed another way · 3 Nov on Pixel 7');
  });

  it('uses the family time zone for the date', () => {
    // 2 Nov 20:00 UTC is already 3 Nov in Sydney.
    expect(installedLine(app({ devices: [device({ installedAt: '2026-11-02T20:00:00Z' })] }), SYDNEY)).toContain('3 Nov');
  });

  it('leaves the date out for a pre-installed app and names every device', () => {
    const two = [device(), device({ deviceId: 'tablet', deviceName: 'XPPen tablet' })];
    expect(installedLine(app({ source: 'preinstalled', devices: two }), SYDNEY)).toBe('Came with Pixel 7 and XPPen tablet');
  });

  it('leaves out a device the app was removed from', () => {
    const two = [device({ removedAt: '2026-11-04T00:00:00Z' }), device({ deviceId: 'tablet', deviceName: 'XPPen tablet' })];
    expect(installedLine(app({ devices: two }), SYDNEY)).toBe('From Play Store · 3 Nov on XPPen tablet');
    expect(isRemoved(app({ devices: two }))).toBe(false);
  });

  it('gives first use as the earliest on any device', () => {
    expect(firstUsedLine(app(), SYDNEY)).toBe('Never opened');
    const two = [
      device({ firstUsedAt: '2026-11-05T00:00:00Z' }),
      device({ deviceId: 'tablet', firstUsedAt: '2026-11-04T00:00:00Z' }),
    ];
    expect(firstUsedLine(app({ devices: two }), SYDNEY)).toBe('First used 4 Nov');
  });

  it("shows today's time from a whole minute", () => {
    expect(todayLine(app({ todaySeconds: 59 }))).toBeNull();
    expect(todayLine(app({ todaySeconds: 720 }))).toBe('Today 12m');
  });
});

describe('the order of the list', () => {
  it('puts newest installs first, then pre-installed by name, then removed', () => {
    const removed = app({ label: 'Old', devices: [device({ removedAt: '2026-11-04T00:00:00Z' })] });
    const older = app({ label: 'Older', devices: [device({ installedAt: '2026-11-01T00:00:00Z' })] });
    const newer = app({ label: 'Newer', devices: [device({ installedAt: '2026-11-04T00:00:00Z' })] });
    const youtube = app({ label: 'YouTube', source: 'preinstalled' });
    const chrome = app({ label: 'chrome', source: 'preinstalled' });
    expect(sortApps([removed, youtube, older, chrome, newer]).map((a) => a.label)).toEqual([
      'Newer',
      'Older',
      'chrome',
      'YouTube',
      'Old',
    ]);
  });
});

function event(kind: string, payload: Record<string, unknown>): EventItem {
  return { id: 'e', kind, at: '2026-11-03T06:00:00Z', kidId: 'k', kidName: 'Alex', deviceId: 'd', deviceName: 'Pixel 7', payload };
}

describe('app events in the history', () => {
  it('says what was installed and where it came from', () => {
    expect(eventView(event('app.installed', { label: 'Block Blast', source: 'play' }), SYDNEY)).toEqual({
      text: 'Alex installed Block Blast',
      detail: 'From Play Store on Pixel 7',
      tone: 'info',
    });
    expect(eventView(event('app.installed', { label: 'Block Blast', source: 'other' }), SYDNEY).detail).toBe(
      'Installed another way on Pixel 7',
    );
  });

  it('says what was used for the first time', () => {
    expect(eventView(event('app.first_used', { label: 'Gemini' }), SYDNEY)).toEqual({
      text: 'Alex opened Gemini for the first time',
      detail: 'On Pixel 7',
      tone: 'info',
    });
  });

  it('still reads when the payload has no label', () => {
    expect(eventView(event('app.installed', {}), SYDNEY).text).toBe('Alex installed an app');
    expect(eventView(event('app.first_used', {}), SYDNEY).text).toBe('Alex opened an app for the first time');
  });
});

describe('the choice on a row', () => {
  it('is allowed without a rule, and follows the rule', () => {
    expect(appChoice(app())).toBe('allowed');
    expect(appChoice(app({ rule: { mode: 'allowed' } }))).toBe('allowed');
    expect(appChoice(app({ rule: { mode: 'blocked' } }))).toBe('blocked');
    expect(appChoice(app({ rule: { mode: 'held' } }))).toBe('waiting');
  });

  it('is never offered for an app that cannot be blocked', () => {
    expect(appChoice(app({ blockable: false }))).toBe('fixed');
    expect(appChoice(app({ blockable: false, rule: { mode: 'blocked' } }))).toBe('fixed');
  });

  it('puts apps waiting for an answer first', () => {
    const newest = app({ label: 'Newest', devices: [device({ installedAt: '2026-11-05T00:00:00Z' })] });
    const waiting = app({ label: 'Waiting', devices: [device({ installedAt: '2026-11-01T00:00:00Z' })], rule: { mode: 'held' } });
    expect(sortApps([newest, waiting]).map((a) => a.label)).toEqual(['Waiting', 'Newest']);
  });
});

describe('new apps waiting for an answer', () => {
  const approval = (pkg: string, at: string) => ({ ...event('app.approval', { package: pkg, label: pkg, source: 'play' }), id: pkg, at });
  const answered = (pkg: string, at: string) => ({ ...event('app.answered', { package: pkg, label: pkg, approved: true, byName: 'Dad' }), at });

  it('waits until a later answer for the same package', () => {
    const events = [approval('a', '2026-11-03T06:00:00Z'), approval('b', '2026-11-03T05:00:00Z'), answered('b', '2026-11-03T05:30:00Z')];
    expect(pendingAppApprovals(events).map((e) => e.id)).toEqual(['a']);
  });

  it('waits again when the app comes back after an old answer', () => {
    expect(pendingAppApprovals([approval('a', '2026-11-04T00:00:00Z'), answered('a', '2026-11-03T00:00:00Z')])).toHaveLength(1);
  });

  it('reads as an install, and the answer says who gave it', () => {
    expect(eventView(event('app.approval', { label: 'Block Blast', source: 'play' }), SYDNEY).text).toBe('Alex installed Block Blast');
    expect(eventView(event('app.answered', { label: 'Block Blast', approved: true, byName: 'Dad' }), SYDNEY).text).toBe('Dad allowed Block Blast for Alex');
    expect(eventView(event('app.answered', { label: 'Block Blast', approved: false, byName: 'Dad' }), SYDNEY).text).toBe('Dad blocked Block Blast for Alex');
  });
});

describe('the notification switches', () => {
  it('have words for the app kinds', () => {
    expect(NOTIFICATION_TEXT['app.installed'].title).toBe('New apps');
    expect(NOTIFICATION_TEXT['app.first_used'].title).toBe('Apps used for the first time');
    expect(NOTIFICATION_TEXT['app.approval'].title).toBe('New apps waiting for approval');
  });
});
