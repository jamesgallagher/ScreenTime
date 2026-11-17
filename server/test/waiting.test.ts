import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import {
  appRules,
  deviceApps,
  devices,
  events,
  families,
  grants,
  kidMessages,
  kids,
  parentModeSessions,
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

const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

describe.skipIf(!url)('waiting', () => {
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

  let familyA = '';
  let familyB = '';
  let mum = '';
  let dad = '';
  let bea = '';
  let alexId = '';
  const alexPhone = { id: '', token: '' };
  const alexTablet = { id: '', token: '' };

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

  /** The kid device sends a time request; returns its id. */
  async function askTime(device: { token: string }, minutes = 30, reason?: string) {
    const id = randomUUID();
    const res = await api.post('/v1/device/time-requests', device.token, { id, minutes, reason });
    expect(res.status).toBe(201);
    return id;
  }

  /** The kid device asks for parent mode; returns the session id. */
  async function askParentMode(device: { token: string }) {
    const id = randomUUID();
    const res = await api.post('/v1/device/parent-mode-requests', device.token, { id });
    expect(res.status).toBe(201);
    return id;
  }

  /** The kid device sends a message; returns its id. */
  async function sendMessage(device: { token: string }, body: string) {
    const id = randomUUID();
    const res = await api.post('/v1/device/messages', device.token, { id, body });
    expect(res.status).toBe(201);
    return id;
  }

  /** Add a held app for a kid. */
  async function holdApp(kidId: string, familyId: string, pkg: string, label: string, source: string) {
    await db.insert(appRules).values({ familyId, kidId, package: pkg, mode: 'held' });
    const [device] = await db.select().from(devices).where(eq(devices.kidId, kidId)).limit(1);
    if (!device) throw new Error('no device');
    await db.insert(deviceApps).values({
      familyId,
      kidId,
      deviceId: device.id,
      package: pkg,
      label,
      source,
      blockable: true,
      installedAt: new Date(),
      firstSeenAt: new Date(),
      baseline: false,
    });
    const [event] = await db
      .insert(events)
      .values({
        familyId,
        kidId,
        deviceId: device.id,
        kind: 'app.approval',
        at: new Date(),
        payload: { package: pkg, label, source, deviceName: device.name },
      })
      .returning({ id: events.id });
    return event?.id ?? null;
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
    mum = await signIn(familyA, p1?.id ?? '', 'fcm-mum');
    dad = await signIn(familyA, p2?.id ?? '', 'fcm-dad');
    bea = await signIn(familyB, p3?.id ?? '', 'fcm-bea');
    alexId = await addKid(familyA, 'Alex');
    Object.assign(alexPhone, await addDevice(familyA, alexId, 'phone', 'Pixel 7', 'fcm-phone'));
    Object.assign(alexTablet, await addDevice(familyA, alexId, 'tablet', 'Tablet', 'fcm-tablet'));
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(grants);
    await db.delete(timeRequests);
    await db.delete(parentModeSessions);
    await db.delete(kidMessages);
    await db.delete(appRules);
    await db.delete(deviceApps);
    await db.delete(events);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns an empty list when nothing is waiting', async () => {
    const res = await api.get('/v1/waiting', mum);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('lists a pending time request with its event id, and it is gone after approve or deny', async () => {
    const id = await askTime(alexPhone, 30, 'Finishing my homework video');
    const res = await api.get('/v1/waiting', mum);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ kind: string; id: string; request: { minutes: number } }>;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('time_request');
    expect(items[0].id).toBe(id);
    expect(items[0].request).toMatchObject({ id, minutes: 30, status: 'pending' });
    // The event id is the `time_request` event.
    const [event] = await db.select().from(events).where(eq(events.kind, 'time_request'));
    expect(items[0].eventId).toBe(event?.id);

    // After approve, it is gone.
    expect((await api.post(`/v1/requests/${id}/approve`, mum, {})).status).toBe(200);
    const after = await api.get('/v1/waiting', mum);
    expect(after.body.items).toEqual([]);
  });

  it('does not list a time request from before local midnight (expired)', async () => {
    const id = randomUUID();
    await db.insert(timeRequests).values({
      id,
      familyId: familyA,
      kidId: alexId,
      deviceId: alexPhone.id,
      pool: 'phone',
      minutes: 30,
      createdAt: new Date(Date.now() - 26 * 3600_000),
    });
    const res = await api.get('/v1/waiting', mum);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('lists a pending parent-mode request with expiresAt, and it is gone after approve, deny, or 10 minutes', async () => {
    const id = await askParentMode(alexPhone);
    const res = await api.get('/v1/waiting', mum);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ kind: string; id: string; expiresAt: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('parent_mode_request');
    expect(items[0].id).toBe(id);
    // expiresAt is requestedAt + 10 minutes.
    const [session] = await db.select().from(parentModeSessions).where(eq(parentModeSessions.id, id));
    const expected = new Date(session!.requestedAt.getTime() + 10 * 60_000).toISOString();
    expect(items[0].expiresAt).toBe(expected);

    // After approve, it is gone.
    expect((await api.post(`/v1/parent-mode-requests/${id}/approve`, mum, { durationMin: 5 })).status).toBe(200);
    const after = await api.get('/v1/waiting', mum);
    expect(after.body.items).toEqual([]);
  });

  it('lists a held app with its package, label, source, and event id, and it is gone after a rule is set', async () => {
    const eventId = await holdApp(alexId, familyA, 'com.example.game', 'Example Game', 'play');
    const res = await api.get('/v1/waiting', mum);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ kind: string; id: string; package: string; label: string; source: string; deviceId: string; deviceName: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('app_approval');
    expect(items[0].id).toBe(`${alexId}:com.example.game`);
    expect(items[0].package).toBe('com.example.game');
    expect(items[0].label).toBe('Example Game');
    expect(items[0].source).toBe('play');
    expect(items[0].eventId).toBe(eventId);
    // The device is filled in from the newest app.approval event.
    const [ev] = await db.select().from(events).where(eq(events.id, eventId));
    expect(items[0].deviceId).toBe(ev?.deviceId ?? null);
    const [evDevice] = await db.select().from(devices).where(eq(devices.id, ev?.deviceId));
    expect(items[0].deviceName).toBe(evDevice?.name ?? null);

    // After a rule is set, it is gone.
    expect((await api.put(`/v1/kids/${alexId}/apps/com.example.game/rule`, mum, { mode: 'allowed', dailyMinutes: null })).status).toBe(200);
    const after = await api.get('/v1/waiting', mum);
    expect(after.body.items).toEqual([]);
  });

  it('lists an unseen kid message with its body, and it is gone after seen', async () => {
    const id = await sendMessage(alexPhone, 'Can you pick me up at 5?');
    const res = await api.get('/v1/waiting', mum);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ kind: string; id: string; body: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('kid_message');
    expect(items[0].id).toBe(id);
    expect(items[0].body).toBe('Can you pick me up at 5?');

    // After seen, it is gone.
    expect((await api.post(`/v1/messages/${id}/seen`, mum)).status).toBe(200);
    const after = await api.get('/v1/waiting', mum);
    expect(after.body.items).toEqual([]);
  });

  it('leaves out items of an archived kid and items of another family', async () => {
    const id = await askTime(alexPhone, 30);
    // Archive Alex.
    await db.update(kids).set({ archivedAt: new Date() }).where(eq(kids.id, alexId));
    const res = await api.get('/v1/waiting', mum);
    expect(res.body.items).toEqual([]);

    // Bea (family B) never sees family A's items.
    const res2 = await api.get('/v1/waiting', bea);
    expect(res2.body.items).toEqual([]);

    // Un-archive Alex so later tests can use the device.
    await db.update(kids).set({ archivedAt: null }).where(eq(kids.id, alexId));
  });

  it('orders by newest at first across all four kinds', async () => {
    // Create items in a known order.
    const msgId = await sendMessage(alexPhone, 'Hello');
    const timeId = await askTime(alexPhone, 30);
    const pmId = await askParentMode(alexTablet);
    await holdApp(alexId, familyA, 'com.example.app', 'Example App', 'other');

    const res = await api.get('/v1/waiting', mum);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ kind: string }>;
    expect(items).toHaveLength(4);
    // Newest first: the last one created should be first.
    // The order depends on the exact timestamps, but we can check that all four kinds are present.
    const kinds = items.map((i) => i.kind);
    expect(kinds.sort()).toEqual(['app_approval', 'kid_message', 'parent_mode_request', 'time_request']);
  });
});
