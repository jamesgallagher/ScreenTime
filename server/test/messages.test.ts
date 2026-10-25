import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import {
  devices,
  families,
  kidMessages,
  kids,
  messagePresets,
  notificationPrefs,
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

describe.skipIf(!url)('kid messages', () => {
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
  let dadId = '';
  let mum = '';
  let bea = '';
  let alexId = '';
  let samId = '';
  let presetId = '';
  const alexPhone = { id: '', token: '' };
  const samTablet = { id: '', token: '' };

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

  async function addDevice(kidId: string, form: 'tablet' | 'phone', name: string) {
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
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  /** The kid device sends a message; returns its id. */
  async function send(device: { token: string }, body: string) {
    const id = randomUUID();
    const res = await api.post('/v1/device/messages', device.token, { id, body });
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
    const [p1, p2, p3] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: b?.id ?? '', email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    dadId = p2?.id ?? '';
    mum = await signIn(familyA, p1?.id ?? '', 'fcm-mum');
    await signIn(familyA, dadId, 'fcm-dad');
    bea = await signIn(b?.id ?? '', p3?.id ?? '', 'fcm-bea');
    const [preset] = await db
      .insert(messagePresets)
      .values({ familyId: familyA, text: 'Can you call me?', sort: 0 })
      .returning();
    presetId = preset?.id ?? '';
    alexId = await addKid('Alex');
    samId = await addKid('Sam');
    Object.assign(alexPhone, await addDevice(alexId, 'phone', 'Pixel 7'));
    Object.assign(samTablet, await addDevice(samId, 'tablet', 'Tablet'));
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(kidMessages);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /v1/device/messages', () => {
    it('stores the message and pushes it to parents who have not muted messages', async () => {
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'kid_message', enabled: false });
      const id = randomUUID();
      const res = await api.post('/v1/device/messages', alexPhone.token, { id, body: ' Can you call me? ', presetId });
      await db.delete(notificationPrefs);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id,
        kidId: alexId,
        kidName: 'Alex',
        deviceId: alexPhone.id,
        deviceName: 'Pixel 7',
        body: 'Can you call me?',
        presetId,
      });
      const [push] = sentTo('fcm-mum');
      expect(push?.high).toBe(false);
      expect(push?.msg).toMatchObject({
        type: 'kid_message',
        data: { kind: 'kid_message', kidName: 'Alex', payload: { messageId: id, body: 'Can you call me?' } },
      });
      expect(sentTo('fcm-dad')).toHaveLength(0);
      expect(sentTo('fcm-bea')).toHaveLength(0);
    });

    it('keeps the text and drops a preset that no longer exists', async () => {
      const res = await api.post('/v1/device/messages', alexPhone.token, {
        id: randomUUID(),
        body: 'I need help with homework',
        presetId: randomUUID(),
      });
      expect(res.status).toBe(201);
      expect(res.body.presetId).toBeNull();
    });

    it('answers the same id again with 200 and sends nothing', async () => {
      const id = await send(alexPhone, 'On my way home');
      sent.length = 0;
      const again = await api.post('/v1/device/messages', alexPhone.token, { id, body: 'Something else' });
      expect(again.status).toBe(200);
      expect(again.body.body).toBe('On my way home');
      expect(sent).toHaveLength(0);
      const other = await api.post('/v1/device/messages', samTablet.token, { id, body: 'Hi' });
      expect(other.status).toBe(409);
      expect(other.body.error.message).toBe('That message id is already used.');
    });

    it('refuses bad bodies and unknown devices', async () => {
      expect((await api.post('/v1/device/messages', alexPhone.token, { id: randomUUID(), body: '  ' })).status).toBe(422);
      expect((await api.post('/v1/device/messages', alexPhone.token, { id: randomUUID(), body: 'x'.repeat(161) })).status).toBe(422);
      expect((await api.post('/v1/device/messages', 'not-a-token', { id: randomUUID(), body: 'Hi' })).status).toBe(401);
    });
  });

  describe('GET /v1/messages', () => {
    it('lists newest first, by kid, in pages, for the own family only', async () => {
      const first = await send(alexPhone, 'One');
      const second = await send(samTablet, 'Two');
      const third = await send(alexPhone, 'Three');

      const all = await api.get('/v1/messages', mum);
      expect(all.status).toBe(200);
      expect(all.body.messages.map((m: { id: string }) => m.id)).toEqual([third, second, first]);
      expect(all.body.nextBefore).toBeNull();

      const page1 = await api.get('/v1/messages?limit=2', mum);
      expect(page1.body.messages.map((m: { id: string }) => m.id)).toEqual([third, second]);
      expect(page1.body.nextBefore).toBe(second);
      const page2 = await api.get(`/v1/messages?limit=2&before=${page1.body.nextBefore}`, mum);
      expect(page2.body.messages.map((m: { id: string }) => m.id)).toEqual([first]);
      expect(page2.body.nextBefore).toBeNull();

      const alexOnly = await api.get(`/v1/messages?kidId=${alexId}`, mum);
      expect(alexOnly.body.messages.map((m: { body: string }) => m.body)).toEqual(['Three', 'One']);
      expect((await api.get('/v1/messages', bea)).body).toEqual({ messages: [], nextBefore: null });
      expect((await api.get('/v1/messages?limit=0', mum)).status).toBe(422);
      expect((await api.get('/v1/messages', null)).status).toBe(401);
    });

    it('keeps the messages of an archived kid', async () => {
      const id = await send(samTablet, 'Bye');
      expect((await api.del(`/v1/kids/${samId}`, mum)).status).toBe(204);
      const res = await api.get(`/v1/messages?kidId=${samId}`, mum);
      expect(res.body.messages.map((m: { id: string }) => m.id)).toEqual([id]);
      const [row] = await db.select().from(kidMessages).where(eq(kidMessages.id, id));
      expect(row?.body).toBe('Bye');
    });
  });
});
