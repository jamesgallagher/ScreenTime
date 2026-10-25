import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import {
  devices,
  events,
  families,
  kids,
  notificationPrefs,
  parentModeSessions,
  parentSessions,
  parents,
  scheduleVersions,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
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

/** Minutes between now and an ISO time. */
const minutesFromNow = (iso: string) => (Date.parse(iso) - Date.now()) / 60_000;

describe.skipIf(!url)('parent mode', () => {
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
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  let familyA = '';
  let familyB = '';
  let dadId = '';
  let mum = '';
  let dad = '';
  let bea = '';
  let alexId = '';
  const phone = { id: '', token: '' };
  const tablet = { id: '', token: '' };
  const otherKid = { id: '', token: '' };

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

  /** The phone taps "I'm the parent". */
  async function ask() {
    const id = randomUUID();
    const res = await api.post('/v1/device/parent-mode-requests', phone.token, { id });
    expect(res.status).toBe(201);
    return id;
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
    familyB = b?.id ?? '';
    const [p1, p2, p3] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: familyB, email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    dadId = p2?.id ?? '';
    mum = await signIn(familyA, p1?.id ?? '', 'fcm-mum');
    dad = await signIn(familyA, dadId, 'fcm-dad');
    bea = await signIn(familyB, p3?.id ?? '', 'fcm-bea');
    alexId = await addKid(familyA, 'Alex');
    Object.assign(phone, await addDevice(familyA, alexId, 'phone', 'Pixel 7', 'fcm-phone'));
    Object.assign(tablet, await addDevice(familyA, alexId, 'tablet', 'Tablet', 'fcm-tablet'));
    const samId = await addKid(familyB, 'Sam');
    Object.assign(otherKid, await addDevice(familyB, samId, 'phone', 'Sam phone', 'fcm-sam'));
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(parentModeSessions);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /v1/device/parent-mode-requests', () => {
    it('stores a pending request and tells every parent at high priority, even one who muted it', async () => {
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'parent_mode.request', enabled: false });
      const id = randomUUID();
      const res = await api.post('/v1/device/parent-mode-requests', phone.token, { id });
      await db.delete(notificationPrefs);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        kidId: alexId,
        kidName: 'Alex',
        deviceId: phone.id,
        deviceName: 'Pixel 7',
        method: 'push',
        status: 'pending',
        startedAt: null,
        endsAt: null,
        endedAt: null,
        durationMin: null,
        approvedByName: null,
        endedByName: null,
      });
      for (const token of ['fcm-mum', 'fcm-dad']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(true);
        expect(push?.msg).toMatchObject({
          type: 'parent_mode.request',
          data: { kind: 'parent_mode.request', kidName: 'Alex', deviceName: 'Pixel 7', payload: { requestId: id } },
        });
      }
      expect(sentTo('fcm-bea')).toHaveLength(0);
      expect(sentTo('fcm-phone')).toHaveLength(0);
    });

    it('answers the same id again with 200, and refuses an id of another device', async () => {
      const id = await ask();
      sent.length = 0;
      const again = await api.post('/v1/device/parent-mode-requests', phone.token, { id });
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('pending');
      expect(sent).toHaveLength(0);
      const other = await api.post('/v1/device/parent-mode-requests', tablet.token, { id });
      expect(other.status).toBe(409);
      expect(other.body.error.message).toBe('That parent-mode id is already used.');
    });

    it('lets only the newest request of a device be approved', async () => {
      const older = await ask();
      const newer = await ask();
      const late = await api.post(`/v1/parent-mode-requests/${older}/approve`, mum, { durationMin: 5 });
      expect(late.status).toBe(409);
      expect(late.body.error.message).toBe('This request has expired.');
      expect((await api.post(`/v1/parent-mode-requests/${newer}/approve`, mum, { durationMin: 5 })).status).toBe(200);
    });

    it('refuses a request while parent mode is on, and bad bodies', async () => {
      const id = await ask();
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 15 })).status).toBe(200);
      const res = await api.post('/v1/device/parent-mode-requests', phone.token, { id: randomUUID() });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('Parent mode is already on.');
      expect((await api.post('/v1/device/parent-mode-requests', phone.token, { id: 'nope' })).status).toBe(422);
      expect((await api.post('/v1/device/parent-mode-requests', 'not-a-token', { id: randomUUID() })).status).toBe(401);
    });
  });

  describe('POST /v1/parent-mode-requests/{id}/approve and /deny', () => {
    it('starts parent mode on the device that asked and tells it and the parents', async () => {
      const id = await ask();
      sent.length = 0;
      const res = await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 15 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'active', durationMin: 15, approvedByName: 'Mum', endedAt: null });
      expect(minutesFromNow(res.body.endsAt)).toBeGreaterThan(14.9);
      expect(minutesFromNow(res.body.endsAt)).toBeLessThan(15.1);

      const [toPhone] = sentTo('fcm-phone');
      expect(toPhone?.high).toBe(true);
      expect(toPhone?.msg.type).toBe('parent_mode');
      expect(toPhone?.msg.data).toEqual({ active: true, endsAt: res.body.endsAt, byName: 'Mum', requestId: id });
      expect(sentTo('fcm-tablet')).toHaveLength(0);
      for (const token of ['fcm-mum', 'fcm-dad']) {
        const [push] = sentTo(token);
        expect(push?.high).toBe(false);
        expect(push?.msg).toMatchObject({
          type: 'parent_mode.used',
          data: { payload: { sessionId: id, method: 'push', durationMin: 15, endsAt: res.body.endsAt, byName: 'Mum' } },
        });
      }

      const state = await api.get('/v1/device/state', phone.token);
      expect(state.body.parentMode).toEqual({ active: true, endsAt: res.body.endsAt, byName: 'Mum' });
      expect((await api.get('/v1/device/state', tablet.token)).body.parentMode.active).toBe(false);
      const today = await api.get('/v1/today', dad);
      const phonePool = today.body.kids[0].pools.find((p: { pool: string }) => p.pool === 'phone');
      expect(phonePool.devices[0].parentMode).toEqual({ endsAt: res.body.endsAt, byName: 'Mum' });
    });

    it('starts "Until I end it" with no end time', async () => {
      const id = await ask();
      const res = await api.post(`/v1/parent-mode-requests/${id}/approve`, dad, { durationMin: null });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'active', durationMin: null, endsAt: null, approvedByName: 'Dad' });
      expect((await api.get('/v1/device/state', phone.token)).body.parentMode).toEqual({ active: true, endsAt: null, byName: 'Dad' });
    });

    it('answers only once, even when both parents tap at the same moment', async () => {
      const id = await ask();
      const [a, b] = await Promise.all([
        api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 5 }),
        api.post(`/v1/parent-mode-requests/${id}/deny`, dad),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect([a, b].find((r) => r.status === 409)?.body.error.message).toBe('This request was already answered.');
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 5 })).status).toBe(409);
    });

    it('denies, tells the device, and only writes history for the parents', async () => {
      const id = await ask();
      sent.length = 0;
      const res = await api.post(`/v1/parent-mode-requests/${id}/deny`, dad);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'denied', startedAt: null, endedByName: 'Dad' });
      const [toPhone] = sentTo('fcm-phone');
      expect(toPhone?.msg).toMatchObject({
        type: 'parent_mode',
        data: { active: false, endsAt: null, byName: 'Dad', requestId: id },
      });
      expect(sentTo('fcm-mum')).toHaveLength(0);
      const history = await api.get('/v1/events?kind=parent_mode&limit=2', mum);
      expect(history.body.events.map((e: { kind: string }) => e.kind)).toEqual(['parent_mode.denied', 'parent_mode.request']);
      expect(history.body.events[0].payload).toEqual({ sessionId: id, byName: 'Dad' });
    });

    it('lets a request expire after 10 minutes', async () => {
      const id = await ask();
      await db
        .update(parentModeSessions)
        .set({ requestedAt: new Date(Date.now() - 11 * 60_000) })
        .where(eq(parentModeSessions.id, id));
      const res = await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 5 });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('This request has expired.');
      expect((await api.post(`/v1/parent-mode-requests/${id}/deny`, mum)).status).toBe(409);
    });

    it('answers 404 for another family, an unknown id and a revoked device, and 422 for a bad duration', async () => {
      const id = await ask();
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, bea, { durationMin: 5 })).status).toBe(404);
      expect((await api.post(`/v1/parent-mode-requests/${randomUUID()}/deny`, mum)).status).toBe(404);
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 10 })).status).toBe(422);
      expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, {})).status).toBe(422);

      const spare = await addDevice(familyA, alexId, 'tablet', 'Spare tablet', 'fcm-spare');
      const spareAsk = randomUUID();
      expect((await api.post('/v1/device/parent-mode-requests', spare.token, { id: spareAsk })).status).toBe(201);
      expect((await api.del(`/v1/devices/${spare.id}`, mum)).status).toBe(204);
      expect((await api.post(`/v1/parent-mode-requests/${spareAsk}/approve`, mum, { durationMin: 5 })).status).toBe(404);
    });
  });

  describe('POST /v1/device/parent-mode (parent code)', () => {
    it('stores parent mode the device started, from when it started, and tells the parents', async () => {
      const id = randomUUID();
      const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
      const res = await api.post('/v1/device/parent-mode', tablet.token, { id, durationMin: 15, startedAt });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        deviceId: tablet.id,
        method: 'code',
        status: 'active',
        startedAt,
        durationMin: 15,
        approvedByName: null,
      });
      expect(res.body.endsAt).toBe(new Date(Date.parse(startedAt) + 15 * 60_000).toISOString());
      const [push] = sentTo('fcm-dad');
      expect(push?.msg).toMatchObject({ type: 'parent_mode.used', data: { payload: { sessionId: id, method: 'code', byName: null } } });
      expect(sentTo('fcm-tablet')).toHaveLength(0);
      expect((await api.get('/v1/device/state', tablet.token)).body.parentMode).toEqual({
        active: true,
        endsAt: res.body.endsAt,
        byName: null,
      });

      sent.length = 0;
      const again = await api.post('/v1/device/parent-mode', tablet.token, { id, durationMin: 60, startedAt });
      expect(again.status).toBe(200);
      expect(again.body.durationMin).toBe(15);
      expect(sent).toHaveLength(0);
      expect((await api.post('/v1/device/parent-mode', phone.token, { id, durationMin: 5, startedAt })).status).toBe(409);
    });

    it('counts a start time in the future as now, and one long over as ended', async () => {
      const future = await api.post('/v1/device/parent-mode', tablet.token, {
        id: randomUUID(),
        durationMin: 5,
        startedAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(future.status).toBe(201);
      expect(minutesFromNow(future.body.endsAt)).toBeLessThan(5.1);

      const old = await api.post('/v1/device/parent-mode', tablet.token, {
        id: randomUUID(),
        durationMin: 60,
        startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      });
      expect(old.status).toBe(201);
      expect(old.body.status).toBe('ended');
      // A new session ends the one that was on.
      const [first] = await db.select().from(parentModeSessions).where(eq(parentModeSessions.id, future.body.id));
      expect(first?.endedAt).not.toBeNull();
      expect((await api.get('/v1/device/state', tablet.token)).body.parentMode.active).toBe(false);
    });

    it('refuses bad bodies', async () => {
      const startedAt = new Date().toISOString();
      expect((await api.post('/v1/device/parent-mode', tablet.token, { id: randomUUID(), durationMin: 30, startedAt })).status).toBe(422);
      expect((await api.post('/v1/device/parent-mode', tablet.token, { id: randomUUID(), startedAt })).status).toBe(422);
      expect((await api.post('/v1/device/parent-mode', tablet.token, { id: randomUUID(), durationMin: 5, startedAt: 'now' })).status).toBe(422);
    });
  });

  describe('ending parent mode', () => {
    it('ends it from the device, and nothing to end is fine', async () => {
      const id = await ask();
      await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: null });
      sent.length = 0;
      expect((await api.post('/v1/device/parent-mode/end', phone.token)).status).toBe(204);
      const [row] = await db.select().from(parentModeSessions).where(eq(parentModeSessions.id, id));
      expect(row?.endedAt).not.toBeNull();
      expect(row?.endedBy).toBeNull();
      expect((await api.get('/v1/device/state', phone.token)).body.parentMode.active).toBe(false);
      expect(sent).toHaveLength(0);
      const [ended] = await db.select().from(events).where(eq(events.kind, 'parent_mode.ended'));
      expect(ended?.payload).toEqual({ sessionId: id, byName: null });
      expect((await api.post('/v1/device/parent-mode/end', phone.token)).status).toBe(204);
      expect((await api.post('/v1/device/parent-mode/end', null)).status).toBe(401);
    });
  });

  describe('POST and DELETE /v1/devices/{id}/parent-mode (from the parent app)', () => {
    it('starts parent mode remotely, replacing one that was on, and tells the device', async () => {
      const first = await api.post(`/v1/devices/${phone.id}/parent-mode`, mum, { durationMin: 60 });
      expect(first.status).toBe(201);
      sent.length = 0;
      const res = await api.post(`/v1/devices/${phone.id}/parent-mode`, dad, { durationMin: 2 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ deviceId: phone.id, method: 'remote', status: 'active', durationMin: 2, approvedByName: 'Dad' });
      const [old] = await db.select().from(parentModeSessions).where(eq(parentModeSessions.id, first.body.id));
      expect(old?.endedAt).not.toBeNull();
      const [toPhone] = sentTo('fcm-phone');
      expect(toPhone?.high).toBe(true);
      expect(toPhone?.msg.data).toEqual({ active: true, endsAt: res.body.endsAt, byName: 'Dad', requestId: null });
      expect(sentTo('fcm-mum').map((m) => m.msg.type)).toEqual(['parent_mode.used']);
    });

    it('ends it remotely, tells the device, and nothing to end sends nothing', async () => {
      const start = await api.post(`/v1/devices/${tablet.id}/parent-mode`, mum, { durationMin: null });
      sent.length = 0;
      expect((await api.del(`/v1/devices/${tablet.id}/parent-mode`, dad)).status).toBe(204);
      const [row] = await db.select().from(parentModeSessions).where(eq(parentModeSessions.id, start.body.id));
      expect(row?.endedBy).toBe(dadId);
      const [toTablet] = sentTo('fcm-tablet');
      expect(toTablet?.msg).toMatchObject({ type: 'parent_mode', data: { active: false, endsAt: null, byName: 'Dad', requestId: null } });
      sent.length = 0;
      expect((await api.del(`/v1/devices/${tablet.id}/parent-mode`, dad)).status).toBe(204);
      expect(sent).toHaveLength(0);
    });

    it('answers 404 for another family or a revoked device, and 422 for a bad duration', async () => {
      expect((await api.post(`/v1/devices/${otherKid.id}/parent-mode`, mum, { durationMin: 5 })).status).toBe(404);
      expect((await api.del(`/v1/devices/${otherKid.id}/parent-mode`, mum)).status).toBe(404);
      expect((await api.post(`/v1/devices/${phone.id}/parent-mode`, bea, { durationMin: 5 })).status).toBe(404);
      expect((await api.post(`/v1/devices/${phone.id}/parent-mode`, mum, { durationMin: 1 })).status).toBe(422);
      const spare = await addDevice(familyA, alexId, 'tablet', 'Old tablet', 'fcm-old');
      expect((await api.del(`/v1/devices/${spare.id}`, mum)).status).toBe(204);
      expect((await api.post(`/v1/devices/${spare.id}/parent-mode`, mum, { durationMin: 5 })).status).toBe(404);
      expect((await api.post(`/v1/devices/${phone.id}/parent-mode`, null, { durationMin: 5 })).status).toBe(401);
    });
  });
});
