import { describe, expect, it } from 'vitest';
import { SosLocationsUpload, SosStart } from '../src/index.js';

const id = '0192f1a0-0000-7000-8000-000000000001';
const at = '2026-10-25T14:00:00+11:00';
const where = { at, lat: -33.87, lng: 151.21, accuracyM: 20, batteryPct: 54, via: 'data' };

describe('SOS schemas', () => {
  it('starts with an id and a start time, with or without a location', () => {
    expect(SosStart.safeParse({ id, startedAt: at }).success).toBe(true);
    expect(SosStart.safeParse({ id, startedAt: at, location: null }).success).toBe(true);
    expect(SosStart.safeParse({ id, startedAt: at, location: where }).success).toBe(true);
    expect(SosStart.safeParse({ id, startedAt: at, location: { ...where, accuracyM: null, batteryPct: null } }).success).toBe(true);
    expect(SosStart.safeParse({ id }).success).toBe(false);
    expect(SosStart.safeParse({ id, startedAt: '2026-10-25 14:00' }).success).toBe(false);
  });

  it('takes 1 to 100 real positions sent by data or SMS', () => {
    expect(SosLocationsUpload.safeParse({ locations: [where, { ...where, via: 'sms' }] }).success).toBe(true);
    for (const bad of [{ lat: 91 }, { lat: -91 }, { lng: 181 }, { batteryPct: 101 }, { batteryPct: 5.5 }, { accuracyM: -1 }, { via: 'wifi' }]) {
      expect(SosLocationsUpload.safeParse({ locations: [{ ...where, ...bad }] }).success).toBe(false);
    }
    expect(SosLocationsUpload.safeParse({ locations: [] }).success).toBe(false);
    expect(SosLocationsUpload.safeParse({ locations: Array(101).fill(where) }).success).toBe(false);
  });
});
