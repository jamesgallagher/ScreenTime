import type { EventItem, Pool, SosLocation } from '@screentime/schemas';
import { formatDuration, formatTimeOfDay } from '@/lib/format';
import { POOL_NAMES } from '@/lib/today';

/** How an event reads in the history: the icon group and colour come from `tone`. */
export type EventTone = 'sos' | 'alert' | 'request' | 'message' | 'time' | 'info';

export interface EventView {
  text: string;
  /** A second line: the kid's own words, or a detail. */
  detail: string | null;
  tone: EventTone;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function num(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' ? value : null;
}

function poolName(payload: Record<string, unknown>): string {
  const pool = str(payload, 'pool');
  return pool === 'screens' || pool === 'phone' ? POOL_NAMES[pool as Pool] : 'time';
}

function minutesText(minutes: number): string {
  return formatDuration(Math.abs(minutes) * 60);
}

/** “text” in curly quotes. */
function quoted(text: string): string {
  return `“${text}”`;
}

const TAMPER: Record<string, string> = {
  'tamper.clock': 'the clock was changed',
  'tamper.timezone': 'the time zone was changed',
  'tamper.tray_killed': 'the ScreenTime tray app was closed',
  'tamper.policy': 'a protected setting was changed',
  'tamper.call_blocked': 'a call was blocked',
};

/**
 * One line of the event history (docs/SPEC.md §13) in plain words. Payload fields are read defensively:
 * an event from a newer server, or with a missing field, still reads as something sensible.
 */
export function eventView(event: EventItem, timeZone: string): EventView {
  const p = event.payload;
  const kid = event.kidName ?? 'A kid';
  const device = event.deviceName ?? str(p, 'deviceName') ?? 'a device';
  const by = str(p, 'byName');
  switch (event.kind) {
    case 'time_request': {
      const reason = str(p, 'reason');
      return {
        text: `${kid} asked for ${minutesText(num(p, 'minutes') ?? 0)} more ${poolName(p)}`,
        detail: reason ? quoted(reason) : null,
        tone: 'request',
      };
    }
    case 'time_request.resolved':
      return p.approved === true
        ? { text: `${by ?? 'A parent'} said yes to ${kid}: ${minutesText(num(p, 'minutes') ?? 0)} more`, detail: null, tone: 'time' }
        : { text: `${by ?? 'A parent'} said no to ${kid}'s request`, detail: null, tone: 'info' };
    case 'grant.added': {
      const minutes = num(p, 'minutes') ?? 0;
      const who = by ?? 'A parent';
      if (p.lockNow === true) return { text: `${who} locked ${kid}'s ${poolName(p)}`, detail: null, tone: 'time' };
      return minutes >= 0
        ? { text: `${who} added ${minutesText(minutes)} of ${poolName(p)} for ${kid}`, detail: null, tone: 'time' }
        : { text: `${who} took away ${minutesText(minutes)} of ${poolName(p)} from ${kid}`, detail: null, tone: 'time' };
    }
    case 'kid_message':
      return { text: `Message from ${kid}`, detail: quoted(str(p, 'body') ?? ''), tone: 'message' };
    case 'parent_mode.request':
      return { text: `${kid} asked for parent mode on ${device}`, detail: null, tone: 'request' };
    case 'parent_mode.used': {
      const duration = num(p, 'durationMin');
      const length = duration === null ? 'until ended' : duration === 60 ? 'for 1 hour' : `for ${duration} min`;
      return {
        text: `Parent mode on ${device} ${length}`,
        detail: by ? `Started by ${by}` : 'Started with the parent code',
        tone: 'info',
      };
    }
    case 'parent_mode.denied':
      return { text: `${by ?? 'A parent'} said no to parent mode on ${device}`, detail: null, tone: 'info' };
    case 'parent_mode.ended':
      return { text: `Parent mode ended on ${device}`, detail: by ? `Ended by ${by}` : null, tone: 'info' };
    case 'sos.started':
      return { text: `SOS from ${kid}`, detail: `On ${device}`, tone: 'sos' };
    case 'sos.acked':
      return { text: `${by ?? 'A parent'} is on ${kid}'s SOS`, detail: null, tone: 'sos' };
    case 'sos.extended': {
      const until = str(p, 'autoStopAt');
      return {
        text: `${by ?? 'A parent'} kept ${kid}'s SOS on`,
        detail: until ? `Until ${formatTimeOfDay(until, timeZone)}` : null,
        tone: 'sos',
      };
    }
    case 'sos.ended': {
      const endedBy = str(p, 'endedBy');
      const text =
        endedBy === 'kid'
          ? `${kid} ended the SOS: safe`
          : endedBy === 'auto'
            ? `${kid}'s SOS stopped by itself`
            : `${by ?? 'A parent'} ended ${kid}'s SOS`;
      return { text, detail: null, tone: 'sos' };
    }
    case 'overspend':
      return {
        text: `${kid} went ${formatDuration(num(p, 'overspendSec') ?? 0)} over on ${poolName(p)}`,
        detail: `${device} was offline, so it could not know the time had run out`,
        tone: 'alert',
      };
    case 'device.offline': {
      const lastSeenAt = str(p, 'lastSeenAt');
      return {
        text: `${device} is offline`,
        detail: lastSeenAt ? `Last seen at ${formatTimeOfDay(lastSeenAt, timeZone)}` : null,
        tone: 'info',
      };
    }
    case 'device.enrolled':
      return { text: `${str(p, 'name') ?? device} was added for ${kid}`, detail: null, tone: 'info' };
    default:
      if (event.kind.startsWith('tamper.')) {
        const number = str(p, 'number');
        return {
          text: `${device}: ${TAMPER[event.kind] ?? 'something was tampered with'}`,
          detail: number ? `Number: ${number}` : null,
          tone: 'alert',
        };
      }
      return { text: event.kind, detail: null, tone: 'info' };
  }
}

/** Parent mode waits this long for an answer (docs/SPEC.md §12.3). */
const PARENT_MODE_WAIT_MS = 10 * 60_000;

/**
 * Parent-mode requests still waiting for an answer, newest first: a `parent_mode.request` from the last
 * 10 minutes with no later `parent_mode.used`, `.denied` or `.ended` for the same session. The server
 * keeps the real state, so an answer to a request that just ran out gets a 409 with a message.
 */
export function pendingParentModeRequests(events: EventItem[], now: Date): EventItem[] {
  const answered = new Set<string>();
  for (const e of events) {
    if (e.kind === 'parent_mode.used' || e.kind === 'parent_mode.denied' || e.kind === 'parent_mode.ended') {
      const id = str(e.payload, 'sessionId');
      if (id) answered.add(id);
    }
  }
  return events.filter((e) => {
    if (e.kind !== 'parent_mode.request') return false;
    const id = str(e.payload, 'requestId');
    return id !== null && !answered.has(id) && now.getTime() - new Date(e.at).getTime() < PARENT_MODE_WAIT_MS;
  });
}

function dayKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** "3:42 pm" today, "Yesterday, 3:42 pm", then "Sat 24 Oct, 3:42 pm", in the family time zone. */
export function whenText(at: string, now: Date, timeZone: string): string {
  const instant = new Date(at);
  const time = formatTimeOfDay(instant, timeZone);
  const day = dayKey(instant, timeZone);
  if (day === dayKey(now, timeZone)) return time;
  if (day === dayKey(new Date(now.getTime() - 86_400_000), timeZone)) return `Yesterday, ${time}`;
  const date = new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })
    .format(instant)
    .replace(',', '');
  return `${date}, ${time}`;
}

/** A Google Maps link to a position; it opens the Maps app on phones. */
export function mapUrl(location: Pick<SosLocation, 'lat' | 'lng'>): string {
  return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
}
