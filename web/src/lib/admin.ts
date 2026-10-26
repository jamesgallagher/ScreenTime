import type { AdminFamily } from '@screentime/schemas';
import { normalisePhone } from '@/lib/kid';
import { zoneLabel } from '@/lib/settings';

/** "Australia / Sydney · 2 parents · Since 26 Oct 2026", the date in the family's own time zone. */
export function familyFacts(family: AdminFamily): string {
  const since = new Intl.DateTimeFormat('en-AU', {
    timeZone: family.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(family.createdAt));
  const parents = family.parentCount === 1 ? '1 parent' : `${family.parentCount} parents`;
  return [zoneLabel(family.timezone), parents, `Since ${since}`].join(' · ');
}

/** The browser's own time zone, for a new family; Sydney when the browser does not say. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney';
  } catch {
    return 'Australia/Sydney';
  }
}

export interface NewFamilyDraft {
  name: string;
  timezone: string;
  emergencyNumber: string;
  email: string;
  displayName: string;
  phone: string;
}

export type NewFamilyErrors = Partial<Record<'name' | 'emergencyNumber' | 'email' | 'displayName' | 'phone', string>>;

/** The checks the server makes (packages/schemas family.ts AdminFamilyCreate), in plain words. */
export function newFamilyErrors(draft: NewFamilyDraft): NewFamilyErrors {
  const errors: NewFamilyErrors = {};
  if (!draft.name.trim()) errors.name = 'Type a family name.';
  if (!/^[0-9]{2,6}$/.test(draft.emergencyNumber.trim())) errors.emergencyNumber = 'Use 2 to 6 digits, like 000.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = 'Type an email address.';
  if (!draft.displayName.trim()) errors.displayName = 'Type a name, like Mum or Dad.';
  if (draft.phone.trim() && !normalisePhone(draft.phone)) errors.phone = 'Type a number like 0412 345 678 or +61412345678.';
  return errors;
}

/** Body of POST /v1/admin/families. */
export function newFamilyBody(draft: NewFamilyDraft) {
  return {
    name: draft.name.trim(),
    timezone: draft.timezone,
    emergencyNumber: draft.emergencyNumber.trim(),
    firstParent: {
      email: draft.email.trim(),
      displayName: draft.displayName.trim(),
      phoneE164: draft.phone.trim() ? normalisePhone(draft.phone) : null,
    },
  };
}
