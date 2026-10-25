import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import { notifyParents } from '../src/notify/dispatch.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** A fixed-offset zone where it is about midday right now, so the test times never cross local midnight. */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

const zone = middayZone();
/** Now plus `m` minutes, as ISO 8601. */
const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** Every day the same, with no curfew, so the result does not depend on the weekday or the hour. */
const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

const phone = { platform: 'android', hasCellular: true, model: 'Pixel 7', osVersion: 'Android 14', appVersion: '0.1.0' };

describe.skipIf(!url)('notifications', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };

  /** Records every push. Tokens in `dead` are answered as no longer valid. */
  const sent: PushMessage[] = [];
  let dead: string[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return dead.filter((t) => messages.some((m) => m.token === t));
    },
  };
  const deps = { db, config: testConfig(url ?? ''), mailer, pusher };
  const api = client(deps);
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  let familyA = '';
  let familyB = '';
  let mumId = '';
  let dadId = '';
  let mum = '';
  let dad = '';
  let bea = '';
  let mumSession = '';

  /** A signed-in parent app session with a push token, and an access token for it. */
  async function signIn(familyId: string, parentId: string, fcmToken: string | null) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    const token = await signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
    return { sessionId: session.id, token };
  }

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'tablet' | 'phone', fcmToken: string | null) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name: form === 'phone' ? 'Pixel 7' : 'Tablet',
        tokenHash: hashDeviceToken(token),
        fcmToken,
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function addEvent(familyId: string, kidId: string | null, kind: string, minutesAgo: number) {
    const [event] = await db
      .insert(events)
      .values({ familyId, kidId, kind, at: new Date(Date.now() - minutesAgo * 60_000), payload: { n: minutesAgo } })
      .returning();
    if (!event) throw new Error('no event');
    return event.id;
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: zone, parentCodeSecret: 'A'.repeat(32) },
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
    mumId = p1?.id ?? '';
    dadId = p2?.id ?? '';
    const mumApp = await signIn(familyA, mumId, 'fcm-mum');
    mum = mumApp.token;
    mumSession = mumApp.sessionId;
    dad = (await signIn(familyA, dadId, 'fcm-dad')).token;
    bea = (await signIn(familyB, p3?.id ?? '', 'fcm-bea')).token;
  });

  beforeEach(() => {
    sent.length = 0;
    dead = [];
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('PUT /v1/me/push-token', () => {
    it("saves the token on the caller's session and moves it off older sessions", async () => {
      const older = await signIn(familyA, mumId, 'fcm-shared');
      const newer = await signIn(familyA, mumId, null);
      expect((await api.put('/v1/me/push-token', newer.token, { fcmToken: 'fcm-shared' })).status).toBe(204);
      const [a] = await db.select().from(parentSessions).where(eq(parentSessions.id, older.sessionId));
      const [b] = await db.select().from(parentSessions).where(eq(parentSessions.id, newer.sessionId));
      expect(a?.fcmToken).toBeNull();
      expect(b?.fcmToken).toBe('fcm-shared');

      expect((await api.put('/v1/me/push-token', newer.token, { fcmToken: null })).status).toBe(204);
      const [cleared] = await db.select().from(parentSessions).where(eq(parentSessions.id, newer.sessionId));
      expect(cleared?.fcmToken).toBeNull();
    });

    it('refuses a revoked or unknown session and a bad body', async () => {
      const gone = await signIn(familyA, mumId, null);
      await db.update(parentSessions).set({ revokedAt: new Date() }).where(eq(parentSessions.id, gone.sessionId));
      expect((await api.put('/v1/me/push-token', gone.token, { fcmToken: 'x' })).status).toBe(401);
      const unknown = await tokenFor({ parentId: mumId, familyId: familyA });
      expect((await api.put('/v1/me/push-token', unknown, { fcmToken: 'x' })).status).toBe(401);
      expect((await api.put('/v1/me/push-token', mum, { fcmToken: '' })).status).toBe(422);
      expect((await api.put('/v1/me/push-token', null, { fcmToken: 'x' })).status).toBe(401);
      const [own] = await db.select().from(parentSessions).where(eq(parentSessions.id, mumSession));
      expect(own?.fcmToken).toBe('fcm-mum');
    });
  });

  describe('notification prefs', () => {
    it('lists every kind, all on, with the essential ones marked', async () => {
      const res = await api.get('/v1/me/notification-prefs', dad);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(10);
      expect(res.body.every((p: { enabled: boolean }) => p.enabled)).toBe(true);
      expect(res.body.filter((p: { essential: boolean }) => p.essential).map((p: { kind: string }) => p.kind)).toEqual([
        'sos',
        'parent_mode.request',
        'time_request',
      ]);
    });

    it('turns kinds off and on for one parent only, and refuses essential kinds', async () => {
      const res = await api.put('/v1/me/notification-prefs', dad, [
        { kind: 'device.enrolled', enabled: false },
        { kind: 'kid_message', enabled: false },
      ]);
      expect(res.status).toBe(200);
      expect(res.body).toContainEqual({ kind: 'device.enrolled', enabled: false, essential: false });
      expect(res.body).toContainEqual({ kind: 'kid_message', enabled: false, essential: false });
      const again = await api.put('/v1/me/notification-prefs', dad, [{ kind: 'kid_message', enabled: true }]);
      expect(again.body).toContainEqual({ kind: 'kid_message', enabled: true, essential: false });
      expect(again.body).toContainEqual({ kind: 'device.enrolled', enabled: false, essential: false });
      const mine = (await api.get('/v1/me/notification-prefs', mum)).body;
      expect(mine).toContainEqual({ kind: 'device.enrolled', enabled: true, essential: false });

      const refused = await api.put('/v1/me/notification-prefs', dad, [{ kind: 'time_request', enabled: false }]);
      expect(refused.status).toBe(422);
      expect(refused.body.error.message).toBe('Ask for more time notifications cannot be turned off.');
      expect((await api.put('/v1/me/notification-prefs', dad, [{ kind: 'sos.started', enabled: false }])).status).toBe(422);
      await db.delete(notificationPrefs).where(eq(notificationPrefs.parentId, dadId));
    });
  });

  describe('PUT /v1/device/push-token', () => {
    it('saves the token and takes it off any other device', async () => {
      const kidId = await addKid(familyA, 'Token kid');
      const old = await addDevice(familyA, kidId, 'tablet', 'fcm-tab');
      const fresh = await addDevice(familyA, kidId, 'tablet', null);
      expect((await api.put('/v1/device/push-token', fresh.token, { fcmToken: 'fcm-tab' })).status).toBe(204);
      const [a] = await db.select().from(devices).where(eq(devices.id, old.id));
      const [b] = await db.select().from(devices).where(eq(devices.id, fresh.id));
      expect(a?.fcmToken).toBeNull();
      expect(b?.fcmToken).toBe('fcm-tab');
      expect((await api.put('/v1/device/push-token', 'not-a-token', { fcmToken: 'x' })).status).toBe(401);
    });
  });

  describe('GET /v1/events', () => {
    it('pages newest first, filters by kid and kind, and only shows the own family', async () => {
      const kidId = await addKid(familyA, 'History kid');
      const otherKid = await addKid(familyA, 'Other kid');
      await addEvent(familyA, kidId, 'sos.started', 50);
      await addEvent(familyA, kidId, 'sos.ended', 40);
      await addEvent(familyA, kidId, 'overspend', 30);
      await addEvent(familyA, otherKid, 'overspend', 20);
      await addEvent(familyA, kidId, 'sosx', 10);
      await addEvent(familyB, null, 'overspend', 5);

      const first = await api.get(`/v1/events?kidId=${kidId}&limit=2`, mum);
      expect(first.status).toBe(200);
      expect(first.body.events.map((e: { kind: string }) => e.kind)).toEqual(['sosx', 'overspend']);
      expect(first.body.events[0]).toMatchObject({ kidId, kidName: 'History kid', deviceId: null, deviceName: null, payload: { n: 10 } });
      const second = await api.get(`/v1/events?kidId=${kidId}&limit=2&before=${first.body.nextBefore}`, mum);
      expect(second.body.events.map((e: { kind: string }) => e.kind)).toEqual(['sos.ended', 'sos.started']);
      expect(second.body.nextBefore).toBeNull();

      const sos = await api.get(`/v1/events?kidId=${kidId}&kind=sos`, mum);
      expect(sos.body.events.map((e: { kind: string }) => e.kind)).toEqual(['sos.ended', 'sos.started']);
      expect(sos.body.nextBefore).toBeNull();
      const overspend = await api.get('/v1/events?kind=overspend', mum);
      expect(overspend.body.events).toHaveLength(2);
      expect((await api.get('/v1/events?kind=overspend', bea)).body.events).toHaveLength(1);

      expect((await api.get('/v1/events?limit=101', mum)).status).toBe(422);
      expect((await api.get('/v1/events?kind=SOS', mum)).status).toBe(422);
      expect((await api.get('/v1/events', null)).status).toBe(401);
    });
  });

  describe('pushes', () => {
    it('tells the other parent and the kid devices in the pool about a grant', async () => {
      const kidId = await addKid(familyA, 'Grant kid');
      await addDevice(familyA, kidId, 'tablet', 'fcm-grant-tablet');
      await addDevice(familyA, kidId, 'phone', 'fcm-grant-phone');
      const revoked = await addDevice(familyA, kidId, 'tablet', 'fcm-grant-revoked');
      await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, revoked.id));

      const id = randomUUID();
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 15 })).status).toBe(201);
      expect(sentTo('fcm-mum')).toEqual([]);
      const [toDad] = sentTo('fcm-dad');
      expect(toDad).toMatchObject({
        high: false,
        msg: {
          v: 1,
          type: 'grant.by_other_parent',
          data: { kind: 'grant.added', kidId, kidName: 'Grant kid', payload: { grantId: id, minutes: 15, byName: 'Mum' } },
        },
      });
      const [toTablet] = sentTo('fcm-grant-tablet');
      expect(toTablet).toMatchObject({
        high: true,
        msg: { v: 1, type: 'grant_added', data: { grant: { id, minutes: 15, byName: 'Mum' }, byName: 'Mum' } },
      });
      expect(toTablet?.ttlSec).toBeGreaterThanOrEqual(60);
      expect(toTablet?.ttlSec).toBeLessThanOrEqual(24 * 3600);
      expect(sentTo('fcm-grant-phone')).toEqual([]);
      expect(sentTo('fcm-grant-revoked')).toEqual([]);
      expect(sentTo('fcm-bea')).toEqual([]);

      // Sending the same grant again changes nothing and pushes nothing.
      sent.length = 0;
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 15 })).status).toBe(200);
      expect(sent).toEqual([]);
    });

    it('skips muted kinds but never essential ones', async () => {
      await db
        .insert(notificationPrefs)
        .values([
          { familyId: familyA, parentId: mumId, kind: 'overspend', enabled: false },
          // Cannot be stored through the API; the dispatcher must still ignore it.
          { familyId: familyA, parentId: mumId, kind: 'sos', enabled: false },
        ]);
      const overspend = await addEvent(familyA, null, 'overspend', 0);
      const sos = await addEvent(familyA, null, 'sos.started', 0);
      const unknown = await addEvent(familyA, null, 'state.synced', 0);
      await notifyParents(deps, familyA, [overspend, sos, unknown]);
      expect(sentTo('fcm-mum').map((m) => m.msg.type)).toEqual(['sos']);
      expect(sentTo('fcm-mum')[0]?.high).toBe(true);
      expect(sentTo('fcm-dad').map((m) => m.msg.type).sort()).toEqual(['overspend', 'sos']);
      await db.delete(notificationPrefs).where(eq(notificationPrefs.parentId, mumId));
    });

    it('forgets tokens that FCM says are dead', async () => {
      const gone = await signIn(familyA, dadId, 'fcm-dead');
      dead = ['fcm-dead'];
      await notifyParents(deps, familyA, [await addEvent(familyA, null, 'overspend', 0)]);
      expect(sentTo('fcm-dead')).toHaveLength(1);
      const [row] = await db.select().from(parentSessions).where(eq(parentSessions.id, gone.sessionId));
      expect(row?.fcmToken).toBeNull();
    });

    it('tells parents when a device is enrolled', async () => {
      await api.put('/v1/me/notification-prefs', dad, [{ kind: 'device.enrolled', enabled: false }]);
      const kidId = await addKid(familyA, 'Enrol kid');
      const code = (await api.post(`/v1/kids/${kidId}/enrolment-codes`, mum, { form: 'phone' })).body.code;
      const res = await api.post('/v1/enrol', null, { code, ...phone });
      expect(res.status).toBe(201);
      expect(sentTo('fcm-mum')).toMatchObject([
        { msg: { type: 'device.enrolled', data: { kidId, deviceId: res.body.deviceId, deviceName: 'Pixel 7' } } },
      ]);
      // Dad turned these off.
      expect(sentTo('fcm-dad')).toEqual([]);
      await db.delete(notificationPrefs).where(eq(notificationPrefs.parentId, dadId));
    });
  });

  describe('overspend on usage upload', () => {
    it('reports offline overspend once, and again only when it grows by a minute', async () => {
      const kidId = await addKid(familyA, 'Offline kid');
      const tablet = await addDevice(familyA, kidId, 'tablet', null);
      const overspends = () =>
        db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'overspend')));

      // 130 minutes against 120: 10 minutes over.
      const long = { id: randomUUID(), startedAt: at(-130), endedAt: at(0), recordedOffline: true };
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [long] })).status).toBe(200);
      const [first] = await overspends();
      expect(first).toMatchObject({ deviceId: tablet.id, payload: { pool: 'screens', deviceName: 'Tablet' } });
      const firstSec = (first?.payload as { overspendSec: number }).overspendSec;
      expect(firstSec).toBeGreaterThanOrEqual(600);
      expect(firstSec).toBeLessThan(610);
      expect(sentTo('fcm-mum')).toMatchObject([{ msg: { type: 'overspend', data: { payload: { overspendSec: firstSec } } } }]);

      // The same segment again: nothing new.
      sent.length = 0;
      await api.post('/v1/device/usage', tablet.token, { segments: [long] });
      expect(await overspends()).toHaveLength(1);
      expect(sent).toEqual([]);

      // Five more minutes: a second report.
      const earlier = { id: randomUUID(), startedAt: at(-136), endedAt: at(-131), recordedOffline: true };
      await api.post('/v1/device/usage', tablet.token, { segments: [earlier] });
      const all = await overspends();
      expect(all).toHaveLength(2);
      expect(all.map((e) => (e.payload as { overspendSec: number }).overspendSec).sort((a, b) => a - b)[1]).toBeGreaterThanOrEqual(900);
    });

    it('does not report overspend from online use', async () => {
      const kidId = await addKid(familyA, 'Online kid');
      const tablet = await addDevice(familyA, kidId, 'tablet', null);
      const segment = { id: randomUUID(), startedAt: at(-130), endedAt: at(0), recordedOffline: false };
      await api.post('/v1/device/usage', tablet.token, { segments: [segment] });
      const rows = await db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'overspend')));
      expect(rows).toEqual([]);
      expect(sent).toEqual([]);
    });
  });
});
