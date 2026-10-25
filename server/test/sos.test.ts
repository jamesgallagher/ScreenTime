import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Sos } from '@screentime/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import {
  devices,
  events,
  families,
  kids,
  notificationPrefs,
  parentSessions,
  parents,
  scheduleVersions,
  sosAcks,
  sosIncidents,
  sosLocations,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { sosEmail } from '../src/sos/routes.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

const sample: Sos = {
  id: '0192f1a0-0000-7000-8000-000000000001',
  kidId: '0192f1a0-0000-7000-8000-000000000002',
  kidName: 'Alex',
  deviceId: '0192f1a0-0000-7000-8000-000000000003',
  deviceName: 'Pixel 7',
  status: 'active',
  startedAt: '2026-10-25T04:04:00.000Z',
  autoStopAt: '2026-10-25T06:04:00.000Z',
  endedAt: null,
  endedBy: null,
  endedByName: null,
  lastLocation: { at: '2026-10-25T04:04:00.000Z', lat: -33.87, lng: 151.21, accuracyM: 19.6, batteryPct: 54, via: 'data' },
  acks: [],
};

describe('SOS email text', () => {
  it('names the kid, the local time, the map link and the battery', () => {
    expect(sosEmail(sample, 'Australia/Sydney')).toEqual({
      subject: 'SOS from Alex',
      text: 'Alex pressed SOS at 3:04 pm.\nLocation: https://maps.google.com/?q=-33.87,151.21 (±20 m). Battery 54%.\n\nOpen the ScreenTime app to see where Alex is and to answer.\n',
    });
    expect(sosEmail({ ...sample, startedAt: '2026-10-24T13:30:00.000Z', lastLocation: null }, 'Australia/Sydney').text).toBe(
      'Alex pressed SOS at 12:30 am.\nLocation: not known yet.\n\nOpen the ScreenTime app to see where Alex is and to answer.\n',
    );
    const rough = { ...sample, lastLocation: { ...sample.lastLocation, accuracyM: null, batteryPct: null } as Sos['lastLocation'] };
    expect(sosEmail(rough, 'Australia/Perth').text).toBe(
      'Alex pressed SOS at 12:04 pm.\nLocation: https://maps.google.com/?q=-33.87,151.21.\n\nOpen the ScreenTime app to see where Alex is and to answer.\n',
    );
  });
});

describe.skipIf(!url)('SOS', () => {
  const { db, pool } = createDb(url ?? '');
  const mails: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = {
    async sendSignInCode() {},
    async sendAlert(to, subject, text) {
      mails.push({ to, subject, text });
    },
  };

  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  let familyA = '';
  let mumId = '';
  let dadId = '';
  let mum = '';
  let dad = '';
  let bea = '';
  let alexId = '';
  const phone = { id: '', token: '' };
  const otherPhone = { id: '', token: '' };
  const tablet = { id: '', token: '' };

  async function signIn(familyId: string, parentId: string, fcmToken: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  async function addKid(name: string) {
    const [kid] = await db.insert(kids).values({ familyId: familyA, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId: familyA, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(kidId: string, form: 'tablet' | 'phone', name: string, fcmToken: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId: familyA,
        kidId,
        platform: 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        hasCellular: form === 'phone',
        tokenHash: hashDeviceToken(token),
        fcmToken,
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
  const where = (at: string, lat = -33.87) => ({ at, lat, lng: 151.21, accuracyM: 20, batteryPct: 54, via: 'data' });

  /** The phone starts an SOS; returns it. */
  async function start(device = phone, extra: Record<string, unknown> = {}) {
    const res = await api.post('/v1/device/sos', device.token, { id: randomUUID(), startedAt: ago(5), ...extra });
    expect(res.status).toBe(201);
    sent.length = 0;
    mails.length = 0;
    return res.body as Sos;
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    familyA = a?.id ?? '';
    const [p1, p2, p3, p4] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: familyA, email: 'gone@example.com', displayName: 'Gone', disabledAt: new Date() },
        { familyId: b?.id ?? '', email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mumId = p1?.id ?? '';
    dadId = p2?.id ?? '';
    mum = await signIn(familyA, mumId, 'fcm-mum');
    dad = await signIn(familyA, dadId, 'fcm-dad');
    await signIn(familyA, p3?.id ?? '', 'fcm-gone');
    bea = await signIn(b?.id ?? '', p4?.id ?? '', 'fcm-bea');
    alexId = await addKid('Alex');
    const samId = await addKid('Sam');
    Object.assign(phone, await addDevice(alexId, 'phone', 'Pixel 7', 'fcm-phone'));
    Object.assign(tablet, await addDevice(alexId, 'tablet', 'Tablet', 'fcm-tablet'));
    Object.assign(otherPhone, await addDevice(samId, 'phone', 'Sam phone', 'fcm-sam'));
  });

  beforeEach(async () => {
    sent.length = 0;
    mails.length = 0;
    await db.delete(sosAcks);
    await db.delete(sosLocations);
    await db.delete(sosIncidents);
    await db.delete(events);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /v1/device/sos', () => {
    it('starts an SOS, pushes it to every parent at high priority and emails them', async () => {
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'sos', enabled: false });
      const id = randomUUID();
      const startedAt = ago(30);
      const res = await api.post('/v1/device/sos', phone.token, { id, startedAt, location: where(startedAt) });
      await db.delete(notificationPrefs);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        kidId: alexId,
        kidName: 'Alex',
        deviceId: phone.id,
        deviceName: 'Pixel 7',
        status: 'active',
        startedAt,
        autoStopAt: new Date(Date.parse(startedAt) + 7_200_000).toISOString(),
        endedAt: null,
        endedBy: null,
        endedByName: null,
        lastLocation: { at: startedAt, lat: -33.87, lng: 151.21, accuracyM: 20, batteryPct: 54, via: 'data' },
        acks: [],
      });

      // SOS cannot be muted: Dad turned it off and still gets it.
      for (const token of ['fcm-mum', 'fcm-dad']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(true);
        expect(push?.msg).toMatchObject({
          type: 'sos',
          data: { kind: 'sos.started', kidName: 'Alex', payload: { sosId: id, startedAt, location: { lat: -33.87 } } },
        });
      }
      expect(sentTo('fcm-gone')).toHaveLength(0);
      expect(sentTo('fcm-bea')).toHaveLength(0);
      expect(sentTo('fcm-phone')).toHaveLength(0);

      expect(mails.map((m) => m.to).sort()).toEqual(['dad@example.com', 'mum@example.com']);
      expect(mails[0]?.subject).toBe('SOS from Alex');
      expect(mails[0]?.text).toContain('Location: https://maps.google.com/?q=-33.87,151.21 (±20 m). Battery 54%.');

      const state = await api.get('/v1/device/state', phone.token);
      expect(state.body.activeSos).toEqual({ id, startedAt });
    });

    it('answers the same id again with 200 and sends nothing', async () => {
      const sos = await start();
      const again = await api.post('/v1/device/sos', phone.token, { id: sos.id, startedAt: ago(1) });
      expect(again.status).toBe(200);
      expect(again.body.startedAt).toBe(sos.startedAt);
      expect(sent).toHaveLength(0);
      expect(mails).toHaveLength(0);
      const other = await api.post('/v1/device/sos', otherPhone.token, { id: sos.id, startedAt: ago(1) });
      expect(other.status).toBe(409);
      expect(other.body.error.message).toBe('That SOS id is already used.');
    });

    it('refuses a second SOS while one is on, and SOS on a tablet', async () => {
      await start();
      const second = await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt: ago(1) });
      expect(second.status).toBe(409);
      expect(second.body.error.message).toBe('An SOS is already on.');
      const fromTablet = await api.post('/v1/device/sos', tablet.token, { id: randomUUID(), startedAt: ago(1) });
      expect(fromTablet.status).toBe(409);
      expect(fromTablet.body.error.message).toBe('SOS is only on phones.');
      // Another kid can still raise one.
      expect((await api.post('/v1/device/sos', otherPhone.token, { id: randomUUID(), startedAt: ago(1) })).status).toBe(201);
    });

    it('stores a future start as now, and one from over 2 hours ago as stopped by itself', async () => {
      const before = Date.now();
      const future = await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt: new Date(before + 3_600_000).toISOString() });
      expect(Date.parse(future.body.startedAt)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(future.body.startedAt)).toBeLessThanOrEqual(Date.now() + 1000);
      await db.delete(sosIncidents);

      const startedAt = ago(3 * 3600);
      const old = await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt });
      expect(old.status).toBe(201);
      expect(old.body).toMatchObject({ status: 'ended', endedBy: 'auto', endedAt: old.body.autoStopAt, lastLocation: null });
      expect(mails[0]?.text).toContain('Location: not known yet.');
      expect((await api.get('/v1/device/state', phone.token)).body.activeSos).toBeNull();
      expect((await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt: ago(1) })).status).toBe(201);
    });

    it('refuses bad bodies and unknown devices', async () => {
      expect((await api.post('/v1/device/sos', phone.token, { id: randomUUID() })).status).toBe(422);
      expect((await api.post('/v1/device/sos', phone.token, { id: randomUUID(), startedAt: ago(1), location: { lat: 1 } })).status).toBe(422);
      expect((await api.post('/v1/device/sos', 'not-a-token', { id: randomUUID(), startedAt: ago(1) })).status).toBe(401);
    });
  });

  describe('POST /v1/device/sos/{id}/locations', () => {
    it('stores positions once each and shows the newest as the last location', async () => {
      const sos = await start();
      const [t1, t2, t3] = [ago(90), ago(60), ago(30)];
      const res = await api.post(`/v1/device/sos/${sos.id}/locations`, phone.token, {
        locations: [where(t2, -33.8), where(t1, -33.7), { ...where(t3, -33.9), via: 'sms', accuracyM: null, batteryPct: null }],
      });
      expect(res.status).toBe(204);
      // Sent again: nothing new.
      expect((await api.post(`/v1/device/sos/${sos.id}/locations`, phone.token, { locations: [where(t2, -33.8), where(t2, -33.8)] })).status).toBe(204);
      expect(sent).toHaveLength(0);

      const detail = await api.get(`/v1/sos/${sos.id}`, mum);
      expect(detail.status).toBe(200);
      expect(detail.body.locations.map((l: { lat: number }) => l.lat)).toEqual([-33.7, -33.8, -33.9]);
      expect(detail.body.lastLocation).toEqual({ at: t3, lat: -33.9, lng: 151.21, accuracyM: null, batteryPct: null, via: 'sms' });
    });

    it("refuses another device's SOS and unknown ones", async () => {
      const sos = await start();
      const body = { locations: [where(ago(1))] };
      expect((await api.post(`/v1/device/sos/${sos.id}/locations`, otherPhone.token, body)).status).toBe(404);
      expect((await api.post(`/v1/device/sos/${randomUUID()}/locations`, phone.token, body)).status).toBe(404);
      expect((await api.post(`/v1/device/sos/${sos.id}/locations`, phone.token, { locations: [] })).status).toBe(422);
    });
  });

  describe('ack, extend and end', () => {
    it('"I\'m on it" tells the phone and the parents once per parent', async () => {
      const sos = await start();
      const res = await api.post(`/v1/sos/${sos.id}/ack`, dad, undefined);
      expect(res.status).toBe(200);
      expect(res.body.acks).toEqual([{ parentId: dadId, byName: 'Dad', at: expect.any(String) }]);
      const [toPhone] = sentTo('fcm-phone');
      expect(toPhone?.high).toBe(true);
      expect(toPhone?.msg).toMatchObject({ type: 'sos_ack', data: { sosId: sos.id, byName: 'Dad' } });
      expect(sentTo('fcm-mum')[0]?.msg).toMatchObject({ type: 'sos', data: { kind: 'sos.acked', payload: { sosId: sos.id, byName: 'Dad' } } });
      expect(sentTo('fcm-tablet')).toHaveLength(0);

      sent.length = 0;
      expect((await api.post(`/v1/sos/${sos.id}/ack`, dad, undefined)).status).toBe(200);
      expect(sent).toHaveLength(0);
      const both = await api.post(`/v1/sos/${sos.id}/ack`, mum, undefined);
      expect(both.body.acks.map((a: { byName: string }) => a.byName)).toEqual(['Dad', 'Mum']);
    });

    it('extends by 2 hours and tells the phone', async () => {
      const sos = await start();
      const res = await api.post(`/v1/sos/${sos.id}/extend`, mum, undefined);
      expect(res.status).toBe(200);
      const autoStopAt = new Date(Date.parse(sos.autoStopAt) + 7_200_000).toISOString();
      expect(res.body.autoStopAt).toBe(autoStopAt);
      expect(sentTo('fcm-phone')[0]?.msg).toMatchObject({ type: 'sos_extended', data: { sosId: sos.id, byName: 'Mum', autoStopAt } });
      const [event] = await db.select().from(events).where(eq(events.kind, 'sos.extended'));
      expect(event?.payload).toEqual({ sosId: sos.id, autoStopAt, byName: 'Mum' });
    });

    it('a parent ends it: the phone is told, and only one of two parents ending at once wins', async () => {
      const sos = await start();
      const [first, second] = await Promise.all([
        api.post(`/v1/sos/${sos.id}/end`, mum, undefined),
        api.post(`/v1/sos/${sos.id}/end`, dad, undefined),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const won = first.status === 200 ? first : second;
      const byName = first.status === 200 ? 'Mum' : 'Dad';
      expect(won.body).toMatchObject({ status: 'ended', endedBy: 'parent', endedByName: byName, endedAt: expect.any(String) });
      expect(sentTo('fcm-phone').map((m) => m.msg)).toMatchObject([{ type: 'sos_ended', data: { sosId: sos.id, byName } }]);
      expect(await db.select().from(events).where(eq(events.kind, 'sos.ended'))).toHaveLength(1);
      expect((await api.get('/v1/device/state', phone.token)).body.activeSos).toBeNull();

      for (const action of ['ack', 'extend', 'end']) {
        const late = await api.post(`/v1/sos/${sos.id}/${action}`, mum, undefined);
        expect(late.status).toBe(409);
        expect(late.body.error.message).toBe('This SOS has ended.');
      }
    });

    it('the kid ends it with "I\'m safe", and again is fine', async () => {
      const sos = await start();
      expect((await api.post(`/v1/device/sos/${sos.id}/end`, phone.token)).status).toBe(204);
      expect(sentTo('fcm-mum')[0]?.msg).toMatchObject({ data: { kind: 'sos.ended', payload: { sosId: sos.id, endedBy: 'kid', byName: null } } });
      expect(sentTo('fcm-phone')).toHaveLength(0);
      sent.length = 0;
      expect((await api.post(`/v1/device/sos/${sos.id}/end`, phone.token)).status).toBe(204);
      expect(sent).toHaveLength(0);
      expect((await api.post(`/v1/device/sos/${sos.id}/end`, otherPhone.token)).status).toBe(404);
      const after = await api.get(`/v1/sos/${sos.id}`, mum);
      expect(after.body).toMatchObject({ status: 'ended', endedBy: 'kid', endedByName: null });
    });

    it("refuses another family's SOS and unknown ids", async () => {
      const sos = await start();
      for (const action of ['ack', 'extend', 'end']) {
        expect((await api.post(`/v1/sos/${sos.id}/${action}`, bea, undefined)).status).toBe(404);
      }
      expect((await api.get(`/v1/sos/${sos.id}`, bea)).status).toBe(404);
      expect((await api.get(`/v1/sos/${randomUUID()}`, mum)).status).toBe(404);
      expect((await api.post(`/v1/sos/${sos.id}/ack`, null, undefined)).status).toBe(401);
    });
  });

  describe('GET /v1/sos', () => {
    it('lists newest first, filters by active and kid, own family only', async () => {
      const ended = await start();
      await api.post(`/v1/device/sos/${ended.id}/end`, phone.token);
      const sam = await start(otherPhone);
      const alex = await start();

      const all = await api.get('/v1/sos', mum);
      expect(all.status).toBe(200);
      expect(all.body.map((s: Sos) => s.id)).toEqual([alex.id, sam.id, ended.id]);
      expect((await api.get('/v1/sos?active=true', mum)).body.map((s: Sos) => s.id)).toEqual([alex.id, sam.id]);
      expect((await api.get('/v1/sos?active=false', mum)).body.map((s: Sos) => s.id)).toEqual([ended.id]);
      expect((await api.get(`/v1/sos?kidId=${alexId}&limit=1`, mum)).body.map((s: Sos) => s.id)).toEqual([alex.id]);
      expect((await api.get('/v1/sos', bea)).body).toEqual([]);
      expect((await api.get('/v1/sos?active=yes', mum)).status).toBe(422);
    });
  });
});
