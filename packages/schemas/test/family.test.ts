import { describe, expect, it } from 'vitest';
import { FamilyPatch, MessagePresetsPut, ParentCreate } from '../src/index.js';

describe('family schemas', () => {
  it('accepts IANA time zones only', () => {
    expect(FamilyPatch.safeParse({ timezone: 'Australia/Sydney' }).success).toBe(true);
    expect(FamilyPatch.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('accepts short emergency numbers only', () => {
    expect(FamilyPatch.safeParse({ emergencyNumber: '000' }).success).toBe(true);
    expect(FamilyPatch.safeParse({ emergencyNumber: '0' }).success).toBe(false);
    expect(FamilyPatch.safeParse({ emergencyNumber: '+61000' }).success).toBe(false);
  });

  it('needs international phone numbers and a trimmed display name', () => {
    const ok = { email: 'dad@example.com', displayName: ' Dad ', phoneE164: '+61412345678' };
    expect(ParentCreate.parse(ok).displayName).toBe('Dad');
    expect(ParentCreate.safeParse({ ...ok, phoneE164: '0412 345 678' }).success).toBe(false);
    expect(ParentCreate.safeParse({ ...ok, displayName: '   ' }).success).toBe(false);
  });

  it('allows up to 10 presets of 1 to 160 characters', () => {
    const preset = { text: 'Can I have more time?' };
    expect(MessagePresetsPut.safeParse({ presets: Array(10).fill(preset) }).success).toBe(true);
    expect(MessagePresetsPut.safeParse({ presets: Array(11).fill(preset) }).success).toBe(false);
    expect(MessagePresetsPut.safeParse({ presets: [{ text: 'x'.repeat(161) }] }).success).toBe(false);
    expect(MessagePresetsPut.safeParse({ presets: [{ text: ' ' }] }).success).toBe(false);
  });
});
