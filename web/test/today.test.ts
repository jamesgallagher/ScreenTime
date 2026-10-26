import type { TodayDevice, TodayKid, TodayPool } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { adjustPreview, clampAdjust, formatAdjust, kidChips, poolView } from '@/lib/today';

const NOW = new Date('2026-10-26T06:00:00Z');

function pool(over: Partial<TodayPool> = {}): TodayPool {
  return {
    pool: 'screens',
    allowanceMin: 120,
    grantedMin: 0,
    usedSec: 75 * 60,
    remainingSec: 45 * 60,
    locked: false,
    lockReason: null,
    nextLockAt: null,
    overspendSec: 0,
    devices: [],
    ...over,
  };
}

function device(over: Partial<TodayDevice> = {}): TodayDevice {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Pixel 7',
    form: 'phone',
    inUse: false,
    lastSeenAt: '2026-10-26T05:59:00Z',
    parentMode: null,
    ...over,
  };
}

describe('poolView', () => {
  it('shows time left, time used and the share left', () => {
    expect(poolView(pool())).toEqual({
      status: '45m left',
      detail: '1h 15m used of 2h 00m',
      fraction: 0.375,
      tone: 'ok',
    });
  });

  it('turns amber at 15 minutes and orange at 5', () => {
    expect(poolView(pool({ remainingSec: 15 * 60 })).tone).toBe('warning');
    expect(poolView(pool({ remainingSec: 5 * 60 + 1 })).tone).toBe('warning');
    expect(poolView(pool({ remainingSec: 5 * 60 })).tone).toBe('critical');
    expect(poolView(pool({ remainingSec: 30 })).status).toBe('less than a minute left');
  });

  it('counts grants in the total and shows why a pool is locked', () => {
    expect(poolView(pool({ grantedMin: 30, usedSec: 0, remainingSec: 150 * 60 })).detail).toBe('Nothing used of 2h 30m');
    expect(poolView(pool({ locked: true, lockReason: 'bedtime', remainingSec: 0 }))).toEqual({
      status: 'Locked · bedtime',
      detail: '1h 15m used of 2h 00m',
      fraction: 0,
      tone: 'locked',
    });
    expect(poolView(pool({ locked: true, lockReason: 'out_of_time', remainingSec: 0 })).status).toBe('Locked · out of time');
    expect(poolView(pool({ locked: true, lockReason: 'before_wake', remainingSec: 0 })).status).toBe(
      'Locked · before wake-up',
    );
    expect(poolView(pool({ allowanceMin: 0, usedSec: 0, remainingSec: 0, locked: true, lockReason: 'out_of_time' })).detail).toBe(
      'No time today',
    );
  });
});

describe('kidChips', () => {
  const kid = (pools: TodayPool[]): TodayKid => ({ id: 'k', name: 'Alex', avatarColor: '#0F766E', pools });

  it('lists devices in use, parent mode, devices silent for 6 hours and overspend', () => {
    const pc = device({ id: 'pc', name: 'Alex on Desktop', form: 'pc', inUse: true });
    const tablet = device({ id: 'tab', name: 'XPPen', form: 'tablet', lastSeenAt: '2026-10-25T23:00:00Z' });
    const phone = device({
      id: 'ph',
      parentMode: { endsAt: '2026-10-26T06:09:30Z', byName: 'Dad' },
    });
    const chips = kidChips(
      kid([pool({ devices: [pc, tablet], overspendSec: 12 * 60 }), pool({ pool: 'phone', devices: [phone] })]),
      NOW,
    );
    expect(chips).toEqual([
      { text: 'Using Alex on Desktop now', tone: 'primary' },
      { text: 'XPPen offline 7h', tone: 'neutral' },
      { text: 'Parent mode on Pixel 7 · 10 min', tone: 'neutral' },
      { text: 'Screens: 12m over (a device was offline)', tone: 'warning' },
    ]);
  });

  it('says nothing about a device seen lately, never seen, or a short overspend', () => {
    const recent = device({ lastSeenAt: '2026-10-26T00:30:30Z' });
    const never = device({ id: 'n', lastSeenAt: null });
    expect(kidChips(kid([pool({ devices: [recent, never], overspendSec: 59 })]), NOW)).toEqual([]);
  });

  it('shows parent mode with no end, and days for a long silence', () => {
    const chips = kidChips(
      kid([
        pool({
          devices: [
            device({ parentMode: { endsAt: null, byName: 'Mum' }, lastSeenAt: '2026-10-23T06:00:00Z' }),
          ],
        }),
      ]),
      NOW,
    );
    expect(chips.map((c) => c.text)).toEqual(['Parent mode on Pixel 7', 'Pixel 7 offline 3d']);
  });
});

describe('adjusting', () => {
  it('keeps to 15-minute steps from −4h to +8h', () => {
    expect(clampAdjust(20)).toBe(15);
    expect(clampAdjust(-300)).toBe(-240);
    expect(clampAdjust(600)).toBe(480);
  });

  it('writes signed amounts', () => {
    expect(formatAdjust(15)).toBe('+15m');
    expect(formatAdjust(60)).toBe('+1h');
    expect(formatAdjust(90)).toBe('+1h 30m');
    expect(formatAdjust(-120)).toBe('−2h');
    expect(formatAdjust(-45)).toBe('−45m');
  });

  it('previews the time left after the change', () => {
    expect(adjustPreview(pool(), 15)).toBe('Now 45m left → 1h 00m left');
    expect(adjustPreview(pool(), -60)).toBe('Now 45m left → locked');
    expect(adjustPreview(pool({ locked: true, lockReason: 'bedtime', remainingSec: 0 }), 30)).toBe('Now locked → 30m left');
  });
});
