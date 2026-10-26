import type { NotificationKind } from '@screentime/schemas';

/** What each notification switch means, in the words of docs/SPEC.md §13. The server sends the order. */
export const NOTIFICATION_TEXT: Record<NotificationKind, { title: string; detail: string }> = {
  sos: { title: 'SOS', detail: 'When a kid presses SOS on their phone, and every update after.' },
  'parent_mode.request': { title: 'Parent mode requests', detail: 'When a kid asks a parent to unlock a device.' },
  time_request: { title: 'Requests for more time', detail: 'When a kid asks for more time.' },
  kid_message: { title: 'Messages from kids', detail: 'When a kid sends you a message.' },
  tamper: {
    title: 'Tampering',
    detail: 'When a device sees its clock, time zone or protection changed, or blocks a call.',
  },
  'parent_mode.used': { title: 'Parent mode started', detail: 'Each time parent mode starts on a device.' },
  overspend: { title: 'Went over while offline', detail: 'When an offline device used more time than was left.' },
  'device.offline': { title: 'Device offline', detail: "When a kid's device has not been seen for 6 hours." },
  'device.enrolled': { title: 'Device added', detail: 'When a new device is added for a kid.' },
  'grant.by_other_parent': { title: 'Time changed by another parent', detail: 'When another parent adds or takes away time.' },
};

/** The API's limits (packages/schemas family.ts MessagePresetsPut). */
export const MAX_PRESETS = 10;
export const PRESET_MAX_LENGTH = 160;

/** One error per preset, or undefined when it is fine. */
export function presetErrors(texts: string[]): (string | undefined)[] {
  return texts.map((text) => {
    const trimmed = text.trim();
    if (!trimmed) return 'Type a message, or remove it.';
    if (trimmed.length > PRESET_MAX_LENGTH) return `Keep it to ${PRESET_MAX_LENGTH} characters.`;
    return undefined;
  });
}

export interface FamilyDraft {
  name: string;
  timezone: string;
  emergencyNumber: string;
}

export function familyErrors(draft: FamilyDraft): { name?: string; emergencyNumber?: string } {
  return {
    name: draft.name.trim() ? undefined : 'Type a family name.',
    emergencyNumber: /^[0-9]{2,6}$/.test(draft.emergencyNumber.trim()) ? undefined : 'Use 2 to 6 digits, like 000.',
  };
}

/** Every IANA time zone this browser knows, sorted, always including `current`. */
export function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // An old browser: offer only the current zone.
  }
  return [...new Set([...zones, current])].sort();
}

/** "Australia/Sydney" reads as "Australia / Sydney"; "America/New_York" as "America / New York". */
export function zoneLabel(zone: string): string {
  return zone.replaceAll('_', ' ').replaceAll('/', ' / ');
}
