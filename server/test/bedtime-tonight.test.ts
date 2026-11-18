import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { bedtimeExtensions, devices, events, families, kids, parentSessions, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** A fixed-offset zone where it is about midday right now. */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

const zone = middayZone();

/**
 * Rounds a Date down to the current quarter hour in the given time zone,
 * returning the local "HH:MM" string and the minutes-of-day.
 */
function quarterHourNow(timezone: string): { time: string; min: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const nowMin = h * 60 + m;
  const qMin = nowMin - (nowMin % 15); // round down to quarter hour
  const time = `${String(Math.floor(qMin / 60)).padStart(2, '0')}:${String(qMin % 60).padStart(2, '0')}`;
  return { time, min: qMin };
}

/**
 * A schedule where today's bedtime is a set number of minutes before the quarter hour.
 * This makes the tests independent of the exact time of day they run.
 */
function scheduleWithBedtimeAt(minutesBeforeQuarter: number) {
  const { min } = quarterHourNow(zone);
  const bedMin = min - minutesBeforeQuarter;
  // If the bedtime would be before 00:00, clamp to 00:00 (the test will skip steps that need it).
  const clamped = Math.max(0, bedMin);
  const bedtime = `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    screensMin: 120,
    phoneMin: 60,
    wake: '00:00',
    bedtime,
  }));
}

describe.skipIf(!url)('extend bedtime tonight', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });

  let family = '';
  let dadId = '';
  let mumId = '';
  let kid = '';
  let phone = { id: '', token: '' };
  let tablet = { id: '', token: '' };

  async function signIn(parentId: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId: family, parentId, refreshTokenHash: randomUUID(), client: 'web', clientLabel: 'Web' })
      .returning();
    if (!session) throw new Error('no session');
    return tokenFor({ parentId, familyId: family });
  }

  async function addDevice(form: 'phone' | 'tablet', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId: family,
        kidId: kid,
        platform: 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    const [f] = await db.insert(families).values({ name: 'A', timezone: zone, parentCodeSecret: 'A'.repeat(32) }).returning();
    if (!f) throw new Error('no family');
    family = f.id;
    const [d, m] = await db
      .insert(parents)
      .values([
        { familyId: family, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: family, email: 'mum@example.com', displayName: 'Mum' },
      ])
      .returning();
    if (!d || !m) throw new Error('no parent');
    dadId = d.id;
    mumId = m.id;
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    // Bedtime 30 minutes before the quarter hour (so it is in the past).
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: scheduleWithBedtimeAt(30) });
    Object.assign(phone, await addDevice('phone', 'Pixel 7'));
    Object.assign(tablet, await addDevice('tablet', 'Tablet'));
    // Set FCM tokens so the test can see the pushes.
    await db.update(devices).set({ fcmToken: 'fcm-phone' }).where(eq(devices.id, phone.id));
    await db.update(devices).set({ fcmToken: 'fcm-tablet' }).where(eq(devices.id, tablet.id));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('PUT with a valid later time stores the row, writes one event, and answers 200', async () => {
    const token = await signIn(dadId);
    const { min } = quarterHourNow(zone);
    // Scheduled is 30 min before the quarter hour.
    const schedMin = min - 30;
    // The first valid later time is the quarter hour itself (later than scheduled).
    const first = Math.max(schedMin, min) + 15;
    if (first > 1440) return; // would be after 24:00, skip
    const bedtime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;

    const res = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scheduled: expect.any(String), tonight: bedtime, extendedBy: 'Dad' });
    expect(res.body.earliest).toBe(bedtime);

    // One row stored.
    const [row] = await db.select().from(bedtimeExtensions).where(eq(bedtimeExtensions.kidId, kid));
    expect(row).toBeDefined();
    expect(row?.bedtime).toBe(bedtime);
    expect(row?.createdBy).toBe(dadId);

    // Exactly one event.
    const eventRows = await db.select().from(events).where(eq(events.kind, 'bedtime.extended'));
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0].payload).toMatchObject({ day: expect.any(String), scheduled: expect.any(String), bedtime, byName: 'Dad', parentId: dadId });

    // Push to devices.
    const devicePushes = sent.filter((m) => m.msg.type === 'state_changed');
    expect(devicePushes.length).toBeGreaterThanOrEqual(2);
    for (const p of devicePushes) expect(p.high).toBe(true);
  });

  it('PUT the same time again answers 200 with no new event or push', async () => {
    const token = await signIn(dadId);
    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const first = Math.max(schedMin, min) + 15;
    if (first > 1440) return;
    const bedtime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;

    const res1 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });
    expect(res1.status).toBe(200);
    const eventsAfter1 = await db.select().from(events).where(eq(events.kind, 'bedtime.extended'));
    expect(eventsAfter1).toHaveLength(1);

    const res2 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });
    expect(res2.status).toBe(200);
    const eventsAfter2 = await db.select().from(events).where(eq(events.kind, 'bedtime.extended'));
    expect(eventsAfter2).toHaveLength(1); // still one
  });

  it('PUT another valid time replaces it and writes a new event', async () => {
    const token = await signIn(dadId);
    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const first = Math.max(schedMin, min) + 15;
    if (first + 15 > 1440) return;
    const bedtime1 = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
    const bedtime2 = `${String(Math.floor((first + 15) / 60)).padStart(2, '0')}:${String((first + 15) % 60).padStart(2, '0')}`;

    await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime: bedtime1 });
    await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime: bedtime2 });

    const [row] = await db.select().from(bedtimeExtensions).where(eq(bedtimeExtensions.kidId, kid));
    expect(row?.bedtime).toBe(bedtime2);
    const eventRows = await db.select().from(events).where(eq(events.kind, 'bedtime.extended'));
    expect(eventRows).toHaveLength(2);
  });

  it('422 with the exact messages for invalid times', async () => {
    const token = await signIn(dadId);
    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const schedTime = `${String(Math.floor(schedMin / 60)).padStart(2, '0')}:${String(schedMin % 60).padStart(2, '0')}`;

    // Equal to scheduled → "Pick a time after the usual bedtime."
    const res1 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime: schedTime });
    expect(res1.status).toBe(422);
    expect(res1.body?.error?.message).toBe('Pick a time after the usual bedtime.');

    // Earlier than scheduled → "Pick a time after the usual bedtime."
    const earlierMin = schedMin - 15;
    if (earlierMin >= 0) {
      const earlierTime = `${String(Math.floor(earlierMin / 60)).padStart(2, '0')}:${String(earlierMin % 60).padStart(2, '0')}`;
      const res2 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime: earlierTime });
      expect(res2.status).toBe(422);
      expect(res2.body?.error?.message).toBe('Pick a time after the usual bedtime.');
    }

    // A quarter hour that is later than scheduled but not later than now → "That time has already passed. Pick a later one."
    // The quarter hour itself (min) is later than scheduled but not later than now.
    const quarterTime = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    if (quarterTime > schedTime) {
      const res3 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime: quarterTime });
      expect(res3.status).toBe(422);
      expect(res3.body?.error?.message).toBe('That time has already passed. Pick a later one.');
    }
  });

  it('422 for non-quarter-hour times from the schema', async () => {
    const token = await signIn(dadId);
    const res1 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime: '21:10' });
    expect(res1.status).toBe(422);
    expect(res1.body?.error?.code).toBe('validation_failed');
    const res2 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime: '25:00' });
    expect(res2.status).toBe(422);
    const res3 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime: '9:30' });
    expect(res3.status).toBe(422);
    const res4 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime: '20:300' });
    expect(res4.status).toBe(422);
  });

  it('DELETE with a row answers 200 with tonight = scheduled, row gone, one event with bedtime null', async () => {
    const token = await signIn(dadId);
    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const first = Math.max(schedMin, min) + 15;
    if (first > 1440) return;
    const bedtime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
    const schedTime = `${String(Math.floor(schedMin / 60)).padStart(2, '0')}:${String(schedMin % 60).padStart(2, '0')}`;

    await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });
    const res = await api.del(`/v1/kids/${kid}/bedtime-tonight`, token);
    expect(res.status).toBe(200);
    expect(res.body?.tonight).toBe(schedTime);
    expect(res.body?.extendedBy).toBeNull();

    const rows = await db.select().from(bedtimeExtensions).where(eq(bedtimeExtensions.kidId, kid));
    expect(rows).toHaveLength(0);

    const eventRows = await db.select().from(events).where(eq(events.kind, 'bedtime.extended'));
    expect(eventRows).toHaveLength(2); // one from PUT, one from DELETE
    expect(eventRows[1].payload).toMatchObject({ bedtime: null });
  });

  it('DELETE with no row answers 200 with no event or push', async () => {
    const token = await signIn(dadId);
    const res = await api.del(`/v1/kids/${kid}/bedtime-tonight`, token);
    expect(res.status).toBe(200);
    const eventRows = await db.select().from(events).where(eq(events.kind, 'bedtime.extended'));
    expect(eventRows).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('unknown kid → 404; no token → 401', async () => {
    const token = await signIn(dadId);
    const res1 = await api.put('/v1/kids/00000000-0000-0000-0000-000000000000/bedtime-tonight', token, { bedtime: '21:00' });
    expect(res1.status).toBe(404);
    const res2 = await api.put(`/v1/kids/${kid}/bedtime-tonight`, null, { bedtime: '21:00' });
    expect(res2.status).toBe(401);
  });

  it('GET /v1/today shows bedtime for every kid', async () => {
    const token = await signIn(dadId);
    const res = await api.get('/v1/today', token);
    expect(res.status).toBe(200);
    const today = res.body as { kids: { bedtime: { scheduled: string; tonight: string; extendedBy: string | null; earliest: string | null } }[] };
    expect(today.kids).toHaveLength(1);
    expect(today.kids[0].bedtime).toBeDefined();
    // Scheduled is 30 min before the quarter hour, so earliest should be a time (not null).
    expect(today.kids[0].bedtime.earliest).not.toBeNull();
  });

  it('GET /v1/today pools use tonight\'s bedtime', async () => {
    const token = await signIn(dadId);
    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const first = Math.max(schedMin, min) + 15;
    if (first > 1440) return;
    const bedtime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
    await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });

    const res = await api.get('/v1/today', token);
    expect(res.status).toBe(200);
    const today = res.body as {
      kids: {
        pools: { locked: boolean; lockReason: string | null }[];
        bedtime: { tonight: string; extendedBy: string | null };
      }[];
    };
    expect(today.kids[0].bedtime.tonight).toBe(bedtime);
    expect(today.kids[0].bedtime.extendedBy).toBe('Dad');
    // With no usage, the pools are not locked.
    for (const pool of today.kids[0].pools) {
      expect(pool.locked).toBe(false);
      expect(pool.lockReason).toBeNull();
    }
  });

  it('the device snapshot carries tonight\'s bedtime in today\'s weekday entry', async () => {
    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const first = Math.max(schedMin, min) + 15;
    if (first > 1440) return;
    const bedtime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;

    // Get the snapshot before the extension.
    const before = await api.get('/v1/device/state', phone.token);
    expect(before.status).toBe(200);
    const beforeBody = before.body as { stateVersion: string; schedule: { days: { weekday: number; bedtime: string }[] } };

    // Extend bedtime.
    const token = await signIn(dadId);
    await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });

    // Get the snapshot after.
    const after = await api.get('/v1/device/state', phone.token);
    expect(after.status).toBe(200);
    const afterBody = after.body as { stateVersion: string; schedule: { days: { weekday: number; bedtime: string }[] } };

    // stateVersion changed.
    expect(afterBody.stateVersion).not.toBe(beforeBody.stateVersion);

    // Today's weekday entry has the new bedtime.
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
    const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay() || 7;
    const beforeEntry = beforeBody.schedule.days.find((d) => d.weekday === weekday);
    const afterEntry = afterBody.schedule.days.find((d) => d.weekday === weekday);
    expect(afterEntry?.bedtime).toBe(bedtime);
    expect(beforeEntry?.bedtime).not.toBe(bedtime);

    // Other entries unchanged.
    for (let w = 1; w <= 7; w++) {
      if (w === weekday) continue;
      const b = beforeBody.schedule.days.find((d) => d.weekday === w);
      const a = afterBody.schedule.days.find((d) => d.weekday === w);
      expect(a?.bedtime).toBe(b?.bedtime);
    }
  });

  it('a row whose day is yesterday does not change the snapshot or Today', async () => {
    const token = await signIn(dadId);
    const now = new Date();
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(yesterday);

    // Insert a row for yesterday directly.
    await db.insert(bedtimeExtensions).values({ familyId: family, kidId: kid, day: yesterdayDate, bedtime: '23:00', createdBy: dadId });

    // The snapshot should not change.
    const res = await api.get('/v1/device/state', phone.token);
    expect(res.status).toBe(200);
    const body = res.body as { schedule: { days: { weekday: number; bedtime: string }[] } };
    // All entries should have the scheduled bedtime (30 min before the quarter hour).
    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const schedTime = `${String(Math.floor(schedMin / 60)).padStart(2, '0')}:${String(schedMin % 60).padStart(2, '0')}`;
    for (const entry of body.schedule.days) {
      expect(entry.bedtime).toBe(schedTime);
    }
  });

  it('lock now during the extension stores a negative grant of the remaining minutes', async () => {
    const token = await signIn(dadId);
    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const first = Math.max(schedMin, min) + 15;
    if (first > 1440) return;
    const bedtime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
    await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });

    // Lock now on the phone pool.
    const res = await api.post(`/v1/kids/${kid}/lock-now`, token, { id: randomUUID(), pool: 'phone' });
    expect(res.status).toBe(201);
    const grant = res.body as { minutes: number };
    expect(grant.minutes).toBeLessThan(0);
    // The grant is the remaining allowance in the pool, rounded up to a whole minute.
    // The phone pool has a 60-minute allowance, so the grant should be at most 60 minutes.
    expect(Math.abs(grant.minutes)).toBeLessThanOrEqual(60);
  });

  it('GET /v1/kids/{kidId}/schedule still shows the usual bedtime after a PUT', async () => {
    const token = await signIn(dadId);
    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const first = Math.max(schedMin, min) + 15;
    if (first > 1440) return;
    const bedtime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
    await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });

    const res = await api.get(`/v1/kids/${kid}/schedule`, token);
    expect(res.status).toBe(200);
    const schedule = res.body as { days: { weekday: number; bedtime: string }[] };
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
    const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay() || 7;
    const entry = schedule.days.find((d) => d.weekday === weekday);
    expect(entry?.bedtime).not.toBe(bedtime); // still the usual bedtime
  });

  it('pushes the event to other parents but not the author', async () => {
    const token = await signIn(dadId);
    // Give mum a push token.
    await db.insert(parentSessions).values({
      familyId: family,
      parentId: mumId,
      refreshTokenHash: randomUUID(),
      client: 'android',
      clientLabel: 'Pixel',
      fcmToken: 'fcm-mum',
    });
    // Give dad a push token too.
    await db.insert(parentSessions).values({
      familyId: family,
      parentId: dadId,
      refreshTokenHash: randomUUID(),
      client: 'android',
      clientLabel: 'Phone',
      fcmToken: 'fcm-dad',
    });

    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const first = Math.max(schedMin, min) + 15;
    if (first > 1440) return;
    const bedtime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
    await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });

    const mumPushes = sent.filter((m) => m.token === 'fcm-mum');
    const dadPushes = sent.filter((m) => m.token === 'fcm-dad');
    // Mum gets the grant.by_other_parent push.
    expect(mumPushes.some((m) => m.msg.type === 'grant.by_other_parent')).toBe(true);
    // Dad does NOT get it.
    expect(dadPushes.some((m) => m.msg.type === 'grant.by_other_parent')).toBe(false);
  });

  it('a muted grant.by_other_parent is not sent', async () => {
    const token = await signIn(dadId);
    await db.insert(parentSessions).values({
      familyId: family,
      parentId: mumId,
      refreshTokenHash: randomUUID(),
      client: 'android',
      clientLabel: 'Pixel',
      fcmToken: 'fcm-mum',
    });
    // Mute grant.by_other_parent for mum.
    const { notificationPrefs } = await import('../src/db/schema.js');
    await db.insert(notificationPrefs).values({ familyId: family, parentId: mumId, kind: 'grant.by_other_parent', enabled: false });

    const { min } = quarterHourNow(zone);
    const schedMin = min - 30;
    const first = Math.max(schedMin, min) + 15;
    if (first > 1440) return;
    const bedtime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
    await api.put(`/v1/kids/${kid}/bedtime-tonight`, token, { bedtime });

    const mumPushes = sent.filter((m) => m.token === 'fcm-mum');
    expect(mumPushes.some((m) => m.msg.type === 'grant.by_other_parent')).toBe(false);
  });
});
