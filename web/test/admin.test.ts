import type { AdminFamily } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { type NewFamilyDraft, familyFacts, newFamilyBody, newFamilyErrors } from '../src/lib/admin';

function family(extra: Partial<AdminFamily> = {}): AdminFamily {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Gallagher family',
    timezone: 'Australia/Sydney',
    // 10:30 pm on 25 October 2026 in UTC is already 26 October in Sydney.
    createdAt: '2026-10-25T22:30:00Z',
    disabledAt: null,
    parentCount: 2,
    ...extra,
  };
}

const DRAFT: NewFamilyDraft = {
  name: ' Gallagher family ',
  timezone: 'Australia/Sydney',
  emergencyNumber: '000',
  email: ' james@example.com ',
  displayName: ' Dad ',
  phone: '0412 345 678',
};

describe('familyFacts', () => {
  it('gives the zone, the parents and the start date in the family time zone', () => {
    expect(familyFacts(family())).toBe('Australia / Sydney · 2 parents · Since 26 Oct 2026');
    expect(familyFacts(family({ parentCount: 1, timezone: 'UTC' }))).toBe('UTC · 1 parent · Since 25 Oct 2026');
    expect(familyFacts(family({ parentCount: 0 }))).toContain('0 parents');
  });
});

describe('newFamilyErrors', () => {
  it('accepts a full draft, with or without a mobile', () => {
    expect(newFamilyErrors(DRAFT)).toEqual({});
    expect(newFamilyErrors({ ...DRAFT, phone: '' })).toEqual({});
  });

  it('names every missing or wrong field', () => {
    expect(
      newFamilyErrors({ name: ' ', timezone: 'UTC', emergencyNumber: '9', email: 'james', displayName: '', phone: '12' }),
    ).toEqual({
      name: 'Type a family name.',
      emergencyNumber: 'Use 2 to 6 digits, like 000.',
      email: 'Type an email address.',
      displayName: 'Type a name, like Mum or Dad.',
      phone: 'Type a number like 0412 345 678 or +61412345678.',
    });
  });
});

describe('newFamilyBody', () => {
  it('trims, nests the first parent and stores the mobile in international form', () => {
    expect(newFamilyBody(DRAFT)).toEqual({
      name: 'Gallagher family',
      timezone: 'Australia/Sydney',
      emergencyNumber: '000',
      firstParent: { email: 'james@example.com', displayName: 'Dad', phoneE164: '+61412345678' },
    });
    expect(newFamilyBody({ ...DRAFT, phone: ' ' }).firstParent.phoneE164).toBeNull();
  });
});
