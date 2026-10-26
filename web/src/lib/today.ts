import type { Pool, TodayDevice, TodayKid, TodayPool } from '@screentime/schemas';
import { formatDuration } from '@/lib/format';

export const POOL_NAMES: Record<Pool, string> = { screens: 'Screens', phone: 'Phone' };

/** Colour of a pool's bar and "left" text (docs/SPEC.md §16.1). */
export type Tone = 'ok' | 'warning' | 'critical' | 'locked';

export interface PoolView {
  /** "45m left", "Locked · bedtime". */
  status: string;
  /** "1h 15m used of 2h 00m". */
  detail: string;
  /** Share of today's time still left, 0 to 1: the bar's filled part. */
  fraction: number;
  tone: Tone;
}

const LOCK_TEXT = {
  out_of_time: 'Locked · out of time',
  bedtime: 'Locked · bedtime',
  before_wake: 'Locked · before wake-up',
} as const;

/** How one pool reads on a kid card: 15 minutes or less is amber, 5 or less orange. */
export function poolView(pool: TodayPool): PoolView {
  const totalSec = Math.max(0, (pool.allowanceMin + pool.grantedMin) * 60);
  const used = pool.usedSec < 60 ? null : `${formatDuration(pool.usedSec)} used`;
  const total = totalSec < 60 ? null : formatDuration(totalSec);
  const detail = total === null ? (used ?? 'No time today') : used === null ? `Nothing used of ${total}` : `${used} of ${total}`;
  if (pool.locked) {
    return { status: LOCK_TEXT[pool.lockReason ?? 'out_of_time'], detail, fraction: 0, tone: 'locked' };
  }
  const fraction = totalSec > 0 ? Math.min(1, Math.max(0, pool.remainingSec / totalSec)) : 0;
  const tone: Tone = pool.remainingSec <= 5 * 60 ? 'critical' : pool.remainingSec <= 15 * 60 ? 'warning' : 'ok';
  return { status: `${formatDuration(pool.remainingSec)} left`, detail, fraction, tone };
}

export interface Chip {
  text: string;
  tone: 'neutral' | 'primary' | 'warning';
}

const FORM_NAMES = { phone: 'phone', tablet: 'tablet', pc: 'PC' } as const;
/** A device silent this long reads as offline, as in the server's sweep (docs/SPEC.md §8.5). */
const OFFLINE_AFTER_MS = 6 * 60 * 60 * 1000;

function hoursText(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 48 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
}

function deviceChips(device: TodayDevice, now: Date): Chip[] {
  const chips: Chip[] = [];
  if (device.inUse) chips.push({ text: `Using ${device.name} now`, tone: 'primary' });
  if (device.parentMode) {
    const { endsAt } = device.parentMode;
    const left = endsAt ? Math.max(1, Math.ceil((new Date(endsAt).getTime() - now.getTime()) / 60_000)) : null;
    chips.push({
      text: left === null ? `Parent mode on ${device.name}` : `Parent mode on ${device.name} · ${left} min`,
      tone: 'neutral',
    });
  }
  if (!device.inUse && device.lastSeenAt) {
    const silent = now.getTime() - new Date(device.lastSeenAt).getTime();
    if (silent >= OFFLINE_AFTER_MS) chips.push({ text: `${device.name} offline ${hoursText(silent)}`, tone: 'neutral' });
  }
  return chips;
}

/**
 * The chips under a kid card (docs/SPEC.md §16.4): what is in use, parent mode, devices silent for 6 hours,
 * and time used beyond the limit while a device was offline. A device in both pools is listed once.
 */
export function kidChips(kid: TodayKid, now: Date): Chip[] {
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const pool of kid.pools) {
    for (const device of pool.devices) {
      if (seen.has(device.id)) continue;
      seen.add(device.id);
      chips.push(...deviceChips(device, now));
    }
  }
  for (const pool of kid.pools) {
    if (pool.overspendSec >= 60) {
      chips.push({
        text: `${POOL_NAMES[pool.pool]}: ${formatDuration(pool.overspendSec)} over (a device was offline)`,
        tone: 'warning',
      });
    }
  }
  return chips;
}

/** Adjustments in 15-minute steps from −4h to +8h, as on the parent app's roller (docs/SPEC.md §16.4). */
export const ADJUST_STEP = 15;
export const ADJUST_MIN = -240;
export const ADJUST_MAX = 480;

export function clampAdjust(minutes: number): number {
  return Math.min(ADJUST_MAX, Math.max(ADJUST_MIN, Math.round(minutes / ADJUST_STEP) * ADJUST_STEP));
}

/** "+15m", "+1h", "+1h 30m", "−45m" (a real minus sign; whole hours without "00m", for short buttons). */
export function formatAdjust(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return abs % 60 === 0 && abs > 0 ? `${sign}${abs / 60}h` : `${sign}${formatDuration(abs * 60)}`;
}

/**
 * "Now 45m left → 1h 00m left". After bedtime or when out of time the pool has nothing left, so a grant
 * gives exactly its own minutes (docs/SPEC.md §7). The server's answer is what counts; this is a preview.
 */
export function adjustPreview(pool: TodayPool, minutes: number): string {
  const now = pool.locked ? 'Now locked' : `Now ${formatDuration(pool.remainingSec)} left`;
  const after = Math.max(0, (pool.locked ? 0 : pool.remainingSec) + minutes * 60);
  return `${now} → ${after < 60 ? 'locked' : `${formatDuration(after)} left`}`;
}
