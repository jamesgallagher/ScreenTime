import type { DeviceForm } from '@screentime/schemas';

export const FORM_NAMES: Record<DeviceForm, string> = { phone: 'Phone', tablet: 'Tablet', pc: 'PC' };

/** "Seen just now", "Seen 12 min ago", "Seen 3h ago", "Seen 2 days ago", "Never connected". */
export function lastSeenText(lastSeenAt: string | null, now: Date): string {
  if (!lastSeenAt) return 'Never connected';
  const minutes = Math.floor((now.getTime() - new Date(lastSeenAt).getTime()) / 60_000);
  if (minutes < 1) return 'Seen just now';
  if (minutes < 60) return `Seen ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Seen ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** "9:41" until the code expires, "0:00" after. */
export function countdownText(expiresAt: string, now: Date): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "123 456": easier to read out and type. */
export function spacedCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * A typed phone number in international format, or null when it is not one. Spaces, dashes, dots and
 * brackets are dropped, and an Australian number starting with 0 gets +61 (the family locale is en-AU).
 */
export function normalisePhone(text: string): string | null {
  const compact = text.replace(/[\s\-.()]/g, '');
  const phone = /^0[1-9][0-9]{8}$/.test(compact) ? `+61${compact.slice(1)}` : compact;
  return E164.test(phone) ? phone : null;
}
