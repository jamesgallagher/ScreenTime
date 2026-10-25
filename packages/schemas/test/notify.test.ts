import { describe, expect, it } from 'vitest';
import { ESSENTIAL_KINDS, NotificationKind, NotificationPrefsPut, PushTokenPut } from '../src/index.js';

describe('notification schemas', () => {
  it('makes SOS and requests that wait for a parent essential', () => {
    expect([...ESSENTIAL_KINDS].sort()).toEqual(['parent_mode.request', 'sos', 'time_request']);
    for (const kind of ESSENTIAL_KINDS) expect(NotificationKind.options).toContain(kind);
  });

  it('takes each kind once in a prefs update', () => {
    expect(NotificationPrefsPut.safeParse([{ kind: 'overspend', enabled: false }]).success).toBe(true);
    expect(NotificationPrefsPut.safeParse([]).success).toBe(false);
    expect(
      NotificationPrefsPut.safeParse([
        { kind: 'overspend', enabled: false },
        { kind: 'overspend', enabled: true },
      ]).success,
    ).toBe(false);
    expect(NotificationPrefsPut.safeParse([{ kind: 'sos.started', enabled: false }]).success).toBe(false);
  });

  it('takes a push token or null', () => {
    expect(PushTokenPut.safeParse({ fcmToken: 'abc' }).success).toBe(true);
    expect(PushTokenPut.safeParse({ fcmToken: null }).success).toBe(true);
    expect(PushTokenPut.safeParse({ fcmToken: '' }).success).toBe(false);
    expect(PushTokenPut.safeParse({}).success).toBe(false);
  });
});
