import type { EventItem } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { eventView, mapUrl, pendingParentModeRequests, whenText } from '../src/lib/inbox';

const TZ = 'Australia/Sydney';
// 12:00 pm on Monday 26 October 2026 in Sydney (UTC+11).
const NOW = new Date('2026-10-26T01:00:00Z');

let n = 0;
function event(kind: string, payload: Record<string, unknown>, extra: Partial<EventItem> = {}): EventItem {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    kind,
    at: '2026-10-26T00:55:00Z',
    kidId: '10000000-0000-4000-8000-000000000001',
    kidName: 'Alex',
    deviceId: '20000000-0000-4000-8000-000000000001',
    deviceName: 'Pixel 7',
    payload,
    ...extra,
  };
}

describe('eventView', () => {
  it('reads requests, answers and messages', () => {
    expect(eventView(event('time_request', { pool: 'phone', minutes: 30, reason: 'finishing homework video' }), TZ)).toEqual({
      text: 'Alex asked for 30m more Phone',
      detail: '“finishing homework video”',
      tone: 'request',
    });
    expect(eventView(event('time_request', { pool: 'screens', minutes: 60, reason: null }), TZ).detail).toBeNull();
    expect(eventView(event('time_request.resolved', { approved: true, minutes: 45, byName: 'Mum' }), TZ).text).toBe(
      'Mum said yes to Alex: 45m more',
    );
    expect(eventView(event('time_request.resolved', { approved: false, minutes: 0, byName: 'Dad' }), TZ).text).toBe(
      "Dad said no to Alex's request",
    );
    expect(eventView(event('kid_message', { body: 'Can I stay at Sam’s?' }), TZ)).toEqual({
      text: 'Message from Alex',
      detail: '“Can I stay at Sam’s?”',
      tone: 'message',
    });
  });

  it('reads grants, lock now and overspend', () => {
    expect(eventView(event('grant.added', { pool: 'screens', minutes: 90, byName: 'Dad', lockNow: false }), TZ).text).toBe(
      'Dad added 1h 30m of Screens for Alex',
    );
    expect(eventView(event('grant.added', { pool: 'phone', minutes: -15, byName: 'Mum', lockNow: false }), TZ).text).toBe(
      'Mum took away 15m of Phone from Alex',
    );
    expect(eventView(event('grant.added', { pool: 'phone', minutes: -45, byName: 'Mum', lockNow: true }), TZ).text).toBe(
      "Mum locked Alex's Phone",
    );
    const over = eventView(event('overspend', { pool: 'screens', overspendSec: 720, deviceName: 'XPPen Pad' }, { deviceName: null }), TZ);
    expect(over.text).toBe('Alex went 12m over on Screens');
    expect(over.detail).toBe('XPPen Pad was offline, so it could not know the time had run out');
    expect(over.tone).toBe('alert');
  });

  it('reads parent mode', () => {
    expect(eventView(event('parent_mode.request', { requestId: 'r' }), TZ).text).toBe('Alex asked for parent mode on Pixel 7');
    expect(eventView(event('parent_mode.used', { sessionId: 's', durationMin: 15, byName: 'Dad' }), TZ)).toEqual({
      text: 'Parent mode on Pixel 7 for 15 min',
      detail: 'Started by Dad',
      tone: 'info',
    });
    expect(eventView(event('parent_mode.used', { sessionId: 's', durationMin: 60, byName: null }), TZ)).toMatchObject({
      text: 'Parent mode on Pixel 7 for 1 hour',
      detail: 'Started with the parent code',
    });
    expect(eventView(event('parent_mode.used', { sessionId: 's', durationMin: null, byName: 'Mum' }), TZ).text).toBe(
      'Parent mode on Pixel 7 until ended',
    );
    expect(eventView(event('parent_mode.ended', { sessionId: 's', byName: null }), TZ)).toMatchObject({
      text: 'Parent mode ended on Pixel 7',
      detail: null,
    });
  });

  it('reads SOS events', () => {
    expect(eventView(event('sos.started', { sosId: 'x' }), TZ)).toEqual({ text: 'SOS from Alex', detail: 'On Pixel 7', tone: 'sos' });
    expect(eventView(event('sos.acked', { sosId: 'x', byName: 'Mum' }), TZ).text).toBe("Mum is on Alex's SOS");
    expect(eventView(event('sos.extended', { sosId: 'x', byName: 'Dad', autoStopAt: '2026-10-26T05:00:00Z' }), TZ).detail).toBe(
      'Until 4:00 pm',
    );
    expect(eventView(event('sos.ended', { sosId: 'x', endedBy: 'kid', byName: null }), TZ).text).toBe('Alex ended the SOS: safe');
    expect(eventView(event('sos.ended', { sosId: 'x', endedBy: 'parent', byName: 'Dad' }), TZ).text).toBe("Dad ended Alex's SOS");
    expect(eventView(event('sos.ended', { sosId: 'x', endedBy: 'auto', byName: null }), TZ).text).toBe("Alex's SOS stopped by itself");
  });

  it('reads devices, tamper and unknown kinds', () => {
    expect(eventView(event('device.enrolled', { name: 'XPPen Pad', form: 'tablet', platform: 'android' }), TZ).text).toBe(
      'XPPen Pad was added for Alex',
    );
    expect(eventView(event('device.offline', { lastSeenAt: '2026-10-25T23:30:00Z', deviceName: 'Pixel 7' }), TZ)).toEqual({
      text: 'Pixel 7 is offline',
      detail: 'Last seen at 10:30 am',
      tone: 'info',
    });
    expect(eventView(event('tamper.clock', { skewSec: 3600 }), TZ)).toEqual({
      text: 'Pixel 7: the clock was changed',
      detail: null,
      tone: 'alert',
    });
    expect(eventView(event('tamper.call_blocked', { number: '0400111222' }), TZ).detail).toBe('Number: 0400111222');
    expect(eventView(event('tamper.something_new', {}), TZ).text).toBe('Pixel 7: something was tampered with');
    expect(eventView(event('mystery.kind', {}, { kidName: null }), TZ)).toEqual({ text: 'mystery.kind', detail: null, tone: 'info' });
  });
});

describe('pendingParentModeRequests', () => {
  it('keeps requests from the last 10 minutes with no answer, newest first', () => {
    const waiting = event('parent_mode.request', { requestId: 'a' }, { at: '2026-10-26T00:58:00Z' });
    const answered = event('parent_mode.request', { requestId: 'b' }, { at: '2026-10-26T00:57:00Z' });
    const used = event('parent_mode.used', { sessionId: 'b', durationMin: 5, byName: 'Mum' }, { at: '2026-10-26T00:57:30Z' });
    const denied = event('parent_mode.request', { requestId: 'c' }, { at: '2026-10-26T00:56:00Z' });
    const no = event('parent_mode.denied', { sessionId: 'c', byName: 'Dad' }, { at: '2026-10-26T00:56:30Z' });
    const old = event('parent_mode.request', { requestId: 'd' }, { at: '2026-10-26T00:49:59Z' });
    const events = [waiting, used, answered, no, denied, old];
    expect(pendingParentModeRequests(events, NOW).map((e) => e.payload.requestId)).toEqual(['a']);
  });
});

describe('whenText', () => {
  it('shows the time today, "Yesterday", then the date, in the family time zone', () => {
    expect(whenText('2026-10-25T22:15:00Z', NOW, TZ)).toBe('9:15 am');
    // 11:30 pm on Sunday in Sydney, though it is still Sunday in UTC too.
    expect(whenText('2026-10-25T12:30:00Z', NOW, TZ)).toBe('Yesterday, 11:30 pm');
    // 10:59 am on Sunday in Sydney is Saturday 23:59 in UTC: Sydney's date counts.
    expect(whenText('2026-10-24T23:59:00Z', NOW, TZ)).toBe('Yesterday, 10:59 am');
    expect(whenText('2026-10-24T04:42:00Z', NOW, TZ)).toBe('Sat 24 Oct, 3:42 pm');
  });
});

describe('mapUrl', () => {
  it('links to Google Maps', () => {
    expect(mapUrl({ lat: -33.8688, lng: 151.2093 })).toBe('https://www.google.com/maps/search/?api=1&query=-33.8688,151.2093');
  });
});
