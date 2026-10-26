import { NotificationKind } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TEXT, familyErrors, presetErrors, timeZones, zoneLabel } from '../src/lib/settings';

describe('NOTIFICATION_TEXT', () => {
  it('has a title and a detail for every notification kind', () => {
    for (const kind of NotificationKind.options) {
      expect(NOTIFICATION_TEXT[kind].title).not.toBe('');
      expect(NOTIFICATION_TEXT[kind].detail).not.toBe('');
    }
  });
});

describe('presetErrors', () => {
  it('flags empty and too long messages only', () => {
    expect(presetErrors(['Can you call me?', '   ', 'x'.repeat(160), `  ${'x'.repeat(161)}  `])).toEqual([
      undefined,
      'Type a message, or remove it.',
      undefined,
      'Keep it to 160 characters.',
    ]);
  });
});

describe('familyErrors', () => {
  it('needs a name and a 2 to 6 digit emergency number', () => {
    expect(familyErrors({ name: 'Gallagher', timezone: 'Australia/Sydney', emergencyNumber: '000' })).toEqual({
      name: undefined,
      emergencyNumber: undefined,
    });
    expect(familyErrors({ name: ' ', timezone: 'Australia/Sydney', emergencyNumber: '0' })).toEqual({
      name: 'Type a family name.',
      emergencyNumber: 'Use 2 to 6 digits, like 000.',
    });
    expect(familyErrors({ name: 'G', timezone: 'UTC', emergencyNumber: '1234567' }).emergencyNumber).toBeDefined();
    expect(familyErrors({ name: 'G', timezone: 'UTC', emergencyNumber: '11 2' }).emergencyNumber).toBeDefined();
  });
});

describe('timeZones', () => {
  it('lists zones sorted, with the current one even when the runtime lacks it', () => {
    const zones = timeZones('Australia/Sydney');
    expect(zones).toContain('Australia/Sydney');
    expect(zones).toEqual([...zones].sort());
    expect(timeZones('Mars/Olympus_Mons')).toContain('Mars/Olympus_Mons');
  });

  it('reads well', () => {
    expect(zoneLabel('America/New_York')).toBe('America / New York');
  });
});
