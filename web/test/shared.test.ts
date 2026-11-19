import type { Device, EventItem } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { eventView } from '../src/lib/inbox';
import { isShared, kindOf, poolLabel, poolsShown, sharedForm, sharedSubtitle, splitByKind } from '../src/lib/shared';

const KID = { id: 'k1', kind: 'kid' as const };
const TABLET = { id: 's1', kind: 'shared' as const };

function device(over: Partial<Device>): Device {
  return {
    id: 'd1',
    kidId: 's1',
    platform: 'android',
    form: 'tablet',
    pool: 'screens',
    name: 'Lenovo Tab P11',
    hasCellular: false,
    model: null,
    osVersion: null,
    appVersion: null,
    enrolledAt: '2026-11-19T00:00:00Z',
    lastSeenAt: null,
    ...over,
  } as Device;
}

describe('shared devices (docs/SPEC.md §12.8)', () => {
  it('reads kind from the server, and a row without it is a kid', () => {
    expect(kindOf(TABLET)).toBe('shared');
    expect(kindOf(KID)).toBe('kid');
    expect(kindOf({ id: 'old' })).toBe('kid');
    expect(isShared(TABLET)).toBe(true);
  });

  it('splits kids from shared devices, keeping the order', () => {
    const k2 = { id: 'k2', kind: 'kid' as const };
    expect(splitByKind([TABLET, KID, k2])).toEqual({ kids: [KID, k2], shared: [TABLET] });
  });

  it('calls the one pool Time on a shared device', () => {
    expect(poolLabel('screens', true)).toBe('Time');
    expect(poolLabel('screens', false)).toBe('Screens');
    expect(poolLabel('phone', false)).toBe('Phone');
  });

  it('shows only the Screens pool of a shared device', () => {
    const pools = [{ pool: 'screens' as const }, { pool: 'phone' as const }];
    expect(poolsShown({ ...TABLET, pools })).toEqual([{ pool: 'screens' }]);
    expect(poolsShown({ ...KID, pools })).toEqual(pools);
  });

  it('uses its device for the icon and the line under it', () => {
    expect(sharedForm([device({ form: 'pc' })], 's1')).toBe('pc');
    expect(sharedForm([], 's1')).toBe('tablet');
    expect(sharedSubtitle([device({})], 's1')).toBe('Lenovo Tab P11');
    expect(sharedSubtitle([], 's1')).toBe('No device connected yet');
  });

  it('says time, not Screens, in the inbox', () => {
    const event = {
      id: 'e1',
      kind: 'time_request',
      at: '2026-11-19T08:00:00Z',
      kidId: 's1',
      kidName: "Mum's tablet",
      deviceId: 'd1',
      deviceName: 'Lenovo Tab P11',
      payload: { minutes: 30, pool: 'screens' },
    } as unknown as EventItem;
    expect(eventView(event, 'Australia/Sydney', true).text).toBe("Mum's tablet asked for 30m more time");
    expect(eventView(event, 'Australia/Sydney').text).toBe("Mum's tablet asked for 30m more Screens");
  });
});
