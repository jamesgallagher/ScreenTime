import { describe, expect, it } from 'vitest';
import { DeviceEventUpload } from '../src/index.js';

const id = '0192f1a0-0000-7000-8000-000000000001';
const at = '2026-10-25T14:00:00+11:00';

describe('device event schemas', () => {
  it('takes the tamper kinds a device can see, with an optional flat payload', () => {
    for (const kind of ['tamper.clock', 'tamper.timezone', 'tamper.tray_killed', 'tamper.policy', 'tamper.call_blocked']) {
      expect(DeviceEventUpload.safeParse({ events: [{ id, kind, at }] }).success).toBe(true);
    }
    const payload = { from: 'Australia/Sydney', to: 'UTC', exits: 3, cellular: true, number: null };
    expect(DeviceEventUpload.safeParse({ events: [{ id, kind: 'tamper.timezone', at, payload }] }).success).toBe(true);
    for (const kind of ['tamper.offline_usage', 'sos.started', 'tamper', 'overspend']) {
      expect(DeviceEventUpload.safeParse({ events: [{ id, kind, at }] }).success).toBe(false);
    }
  });

  it('refuses nested or oversized payloads, and empty or oversized uploads', () => {
    const one = (payload: unknown) => DeviceEventUpload.safeParse({ events: [{ id, kind: 'tamper.clock', at, payload }] });
    expect(one({ nested: { a: 1 } }).success).toBe(false);
    expect(one({ list: [1, 2] }).success).toBe(false);
    expect(one({ note: 'x'.repeat(201) }).success).toBe(false);
    expect(one(Object.fromEntries([...Array(11).keys()].map((k) => [`k${k}`, k]))).success).toBe(false);
    expect(DeviceEventUpload.safeParse({ events: [{ id, kind: 'tamper.clock', at: '2026-10-25 14:00' }] }).success).toBe(false);
    expect(DeviceEventUpload.safeParse({ events: [] }).success).toBe(false);
    const many = [...Array(51).keys()].map(() => ({ id, kind: 'tamper.clock', at }));
    expect(DeviceEventUpload.safeParse({ events: many }).success).toBe(false);
  });
});
