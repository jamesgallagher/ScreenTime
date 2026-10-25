import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import {
  devices,
  events,
  families,
  grants,
  kids,
  notificationPrefs,
  parentSessions,
  parents,
  scheduleVersions,
  timeRequests,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** A fixed-offset zone where it is about midday right now, so the test times never cross local midnight. */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

/** Every day the same, with no curfew, so the result does not depend on the weekday or the hour. */
const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

describe.skipIf(!url)('time requests', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };

  /** Records every push. */
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
  /** Alex's devices: two phones and a tablet, each with a push token. */
  const alex = { phone: { id: '', token: '' }, phone2: { id: '', token: '' }, tablet: { id: '', token: '' } };

  async function signIn(familyId: string, parentId: string, fcmToken: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'tablet' | 'phone', name: string, fcmToken: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
        fcmToken,
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  /** Clears every request (and the grants that answered them) so each test starts with none pending. */
  async function clearRequests() {
    await db.delete(grants);
    await db.delete(timeRequests);
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: middayZone(), parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    familyA = a?.id ?? '';
    const [p1, p2, p3] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: b?.id ?? '', email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mumId = p1?.id ?? '';
    dadId = p2?.id ?? '';
    mum = await signIn(familyA, mumId, 'fcm-mum');
    dad = await signIn(familyA, dadId, 'fcm-dad');
    bea = await signIn(b?.id ?? '', p3?.id ?? '', 'fcm-bea');
    alexId = await addKid(familyA, 'Alex');
    alex.phone = await addDevice(familyA, alexId, 'phone', 'Pixel 7', 'fcm-phone');
    alex.phone2 = await addDevice(familyA, alexId, 'phone', 'Old phone', 'fcm-phone2');
    alex.tablet = await addDevice(familyA, alexId, 'tablet', 'Tablet', 'fcm-tablet');
  });

  beforeEach(async () => {
    sent.length = 0;
    await clearRequests();
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Alex asks from the phone. */
  async function ask(minutes = 30, reason?: string) {
    const id = randomUUID();
    const res = await api.post('/v1/device/time-requests', alex.phone.token, { id, minutes, reason });
    expect(res.status).toBe(201);
    return id;
  }

  describe('POST /v1/device/time-requests', () => {
    it("stores the request for the device's pool and tells both parents at high priority", async () => {
      // Muting does not apply: asking for more time is essential.
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'time_request', enabled: false });
      const id = randomUUID();
      const res = await api.post('/v1/device/time-requests', alex.phone.token, { id, minutes: 30, reason: ' Homework game ' });
      await db.delete(notificationPrefs);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        kidId: alexId,
        kidName: 'Alex',
        deviceId: alex.phone.id,
        deviceName: 'Pixel 7',
        pool: 'phone',
        minutes: 30,
        reason: 'Homework game',
        status: 'pending',
        resolvedAt: null,
        resolvedByName: null,
        grantId: null,
        grantedMinutes: null,
      });

      for (const token of ['fcm-mum', 'fcm-dad']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(true);
        expect(push?.msg.type).toBe('time_request');
        expect(push?.msg.data).toMatchObject({
          kind: 'time_request',
          kidName: 'Alex',
          deviceName: 'Pixel 7',
          payload: { requestId: id, pool: 'phone', minutes: 30, reason: 'Homework game' },
        });
      }
      expect(sentTo('fcm-bea')).toHaveLength(0);
      // The other phone shows "Waiting for an answer" after it syncs; the tablet is another pool.
      expect(sentTo('fcm-phone2').map((m) => [m.msg.type, m.high])).toEqual([['state_changed', false]]);
      expect(sentTo('fcm-phone')).toHaveLength(0);
      expect(sentTo('fcm-tablet')).toHaveLength(0);

      const state = await api.get('/v1/device/state', alex.phone2.token);
      expect(state.body.pendingRequest).toMatchObject({ id, minutes: 30 });
      const tabletState = await api.get('/v1/device/state', alex.tablet.token);
      expect(tabletState.body.pendingRequest).toBeNull();
    });

    it('answers the same id again with 200 and changes nothing', async () => {
      const id = await ask(15);
      sent.length = 0;
      const again = await api.post('/v1/device/time-requests', alex.phone.token, { id, minutes: 60 });
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ id, minutes: 15, status: 'pending' });
      expect(sent).toHaveLength(0);
      const other = await api.post('/v1/device/time-requests', alex.phone2.token, { id, minutes: 15 });
      expect(other.status).toBe(409);
      expect(other.body.error.message).toBe('That request id is already used.');
    });

    it('lets one request per kid and pool wait at a time', async () => {
      await ask(15);
      const second = await api.post('/v1/device/time-requests', alex.phone2.token, { id: randomUUID(), minutes: 30 });
      expect(second.status).toBe(409);
      expect(second.body.error.message).toBe('You already asked. Wait for an answer.');
      // Screens is another pool.
      const tablet = await api.post('/v1/device/time-requests', alex.tablet.token, { id: randomUUID(), minutes: 60 });
      expect(tablet.status).toBe(201);
      expect(tablet.body.pool).toBe('screens');
    });

    it('refuses bad bodies and unknown devices', async () => {
      expect((await api.post('/v1/device/time-requests', alex.phone.token, { id: randomUUID(), minutes: 45 })).status).toBe(422);
      expect(
        (await api.post('/v1/device/time-requests', alex.phone.token, { id: randomUUID(), minutes: 15, reason: 'x'.repeat(161) }))
          .status,
      ).toBe(422);
      expect((await api.post('/v1/device/time-requests', 'not-a-token', { id: randomUUID(), minutes: 15 })).status).toBe(401);
      expect((await api.post('/v1/device/time-requests', mum, { id: randomUUID(), minutes: 15 })).status).toBe(401);
    });
  });

  describe('GET /v1/requests', () => {
    it('lists the family requests newest first, by status and kid', async () => {
      const first = await ask(15);
      const res = await api.post('/v1/device/time-requests', alex.tablet.token, { id: randomUUID(), minutes: 60 });
      const second = res.body.id as string;
      const all = await api.get('/v1/requests', mum);
      expect(all.status).toBe(200);
      expect(all.body.map((r: { id: string }) => r.id)).toEqual([second, first]);
      expect((await api.get('/v1/requests?status=pending&limit=1', dad)).body.map((r: { id: string }) => r.id)).toEqual([second]);
      expect((await api.get('/v1/requests?status=approved', dad)).body).toEqual([]);
      expect((await api.get(`/v1/requests?kidId=${randomUUID()}`, dad)).body).toEqual([]);
      expect((await api.get('/v1/requests', bea)).body).toEqual([]);
      expect((await api.get('/v1/requests?status=waiting', mum)).status).toBe(422);
      expect((await api.get('/v1/requests', null)).status).toBe(401);
    });

    it('shows requests from before local midnight as expired, and they can no longer be answered', async () => {
      const id = randomUUID();
      await db.insert(timeRequests).values({
        id,
        familyId: familyA,
        kidId: alexId,
        deviceId: alex.phone.id,
        pool: 'phone',
        minutes: 30,
        createdAt: new Date(Date.now() - 26 * 3600_000),
      });
      const [listed] = (await api.get('/v1/requests', mum)).body;
      expect(listed).toMatchObject({ id, status: 'expired', resolvedAt: null });
      const late = await api.post(`/v1/requests/${id}/approve`, mum, {});
      expect(late.status).toBe(409);
      expect(late.body.error.message).toBe('This request has expired.');
      // The kid may ask again today.
      await ask(30);
    });
  });

  describe('POST /v1/requests/{id}/approve', () => {
    it('adds a grant for what was asked and tells the kid and the other parent', async () => {
      const id = await ask(30, 'Finishing a level');
      sent.length = 0;
      const res = await api.post(`/v1/requests/${id}/approve`, mum, {});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'approved', resolvedByName: 'Mum', grantedMinutes: 30 });
      expect(res.body.resolvedAt).not.toBeNull();

      const [grant] = await db.select().from(grants).where(eq(grants.requestId, id));
      expect(grant).toMatchObject({ id: res.body.grantId, kidId: alexId, pool: 'phone', minutes: 30, createdBy: mumId });
      expect(grant?.note).toBe('Asked for more time');

      for (const token of ['fcm-phone', 'fcm-phone2']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(true);
        expect(push?.msg.type).toBe('request_resolved');
        expect(push?.msg.data).toEqual({
          requestId: id,
          approved: true,
          minutes: 30,
          byName: 'Mum',
          grant: { id: res.body.grantId, minutes: 30, createdAt: grant?.createdAt.toISOString(), byName: 'Mum' },
        });
      }
      expect(sentTo('fcm-tablet')).toHaveLength(0);
      // Dad hears that Mum changed the time; Mum does not hear about her own answer.
      expect(sentTo('fcm-dad').map((m) => m.msg.type)).toEqual(['grant.by_other_parent']);
      expect(sentTo('fcm-mum')).toHaveLength(0);

      const history = await api.get('/v1/events?kind=time_request&limit=2', dad);
      expect(history.body.events.map((e: { kind: string }) => e.kind)).toEqual(['time_request.resolved', 'time_request']);
      expect(history.body.events[0].payload).toEqual({ requestId: id, approved: true, minutes: 30, byName: 'Mum' });

      const state = await api.get('/v1/device/state', alex.phone.token);
      expect(state.body.pendingRequest).toBeNull();
      expect(state.body.today.grants).toEqual([{ id: res.body.grantId, minutes: 30, createdAt: grant?.createdAt.toISOString(), byName: 'Mum' }]);
    });

    it('gives other minutes when the parent says so', async () => {
      const id = await ask(15);
      const res = await api.post(`/v1/requests/${id}/approve`, dad, { minutes: 45 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ minutes: 15, grantedMinutes: 45, resolvedByName: 'Dad' });
      expect((await api.post(`/v1/requests/${id}/approve`, dad, { minutes: 20 })).status).toBe(422);
    });

    it('answers only once, even when both parents tap yes at the same moment', async () => {
      const id = await ask(30);
      const [a, b] = await Promise.all([
        api.post(`/v1/requests/${id}/approve`, mum, {}),
        api.post(`/v1/requests/${id}/approve`, dad, {}),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect([a, b].find((r) => r.status === 409)?.body.error.message).toBe('This request was already answered.');
      expect(await db.select().from(grants).where(eq(grants.requestId, id))).toHaveLength(1);
      expect((await api.post(`/v1/requests/${id}/deny`, mum)).status).toBe(409);
    });

    it('answers 404 for a request of another family or an archived kid', async () => {
      const id = await ask(30);
      expect((await api.post(`/v1/requests/${id}/approve`, bea, {})).status).toBe(404);
      expect((await api.post(`/v1/requests/${randomUUID()}/approve`, mum, {})).status).toBe(404);
      const samId = await addKid(familyA, 'Sam');
      const samPhone = await addDevice(familyA, samId, 'phone', 'Sam phone', 'fcm-sam');
      const samAsk = randomUUID();
      expect((await api.post('/v1/device/time-requests', samPhone.token, { id: samAsk, minutes: 15 })).status).toBe(201);
      expect((await api.del(`/v1/kids/${samId}`, mum)).status).toBe(204);
      expect((await api.post(`/v1/requests/${samAsk}/approve`, mum, {})).status).toBe(404);
      expect((await api.get('/v1/requests', mum)).body.map((r: { id: string }) => r.id)).toEqual([id]);
    });
  });

  describe('POST /v1/requests/{id}/deny', () => {
    it('says no without a grant and tells the kid', async () => {
      const id = await ask(60);
      sent.length = 0;
      const res = await api.post(`/v1/requests/${id}/deny`, dad);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'denied', resolvedByName: 'Dad', grantId: null, grantedMinutes: null });
      expect(await db.select().from(grants).where(eq(grants.requestId, id))).toHaveLength(0);
      const [push] = sentTo('fcm-phone');
      expect(push?.high).toBe(true);
      expect(push?.msg).toMatchObject({
        type: 'request_resolved',
        data: { requestId: id, approved: false, minutes: 0, byName: 'Dad', grant: null },
      });
      // A no is history only for the parents.
      expect(sentTo('fcm-mum')).toHaveLength(0);
      const resolved = await db.select().from(events).where(eq(events.kind, 'time_request.resolved'));
      const event = resolved.find((e) => (e.payload as { requestId?: string }).requestId === id);
      expect(event?.payload).toEqual({ requestId: id, approved: false, minutes: 0, byName: 'Dad' });
      expect((await api.post(`/v1/requests/${id}/approve`, mum, {})).status).toBe(409);
    });
  });
});
