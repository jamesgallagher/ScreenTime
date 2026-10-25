import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { devices, events, families, kids, notificationPrefs, parentSessions, parents } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('tamper events', () => {
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
  let bea = '';
  const alexPhone = { id: '', token: '' };
  const benPc = { id: '', token: '' };

  async function signIn(familyId: string, parentId: string, fcmToken: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  async function addDevice(familyId: string, kidName: string, platform: 'android' | 'windows', name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name: kidName, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId: kid.id,
        platform,
        form: platform === 'android' ? 'phone' : 'pc',
        pool: platform === 'android' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
  const upload = (device: { token: string }, list: unknown[]) => api.post('/v1/device/events', device.token, { events: list });

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
    await signIn(familyA, dadId, 'fcm-dad');
    bea = await signIn(familyB, p3?.id ?? '', 'fcm-bea');
    Object.assign(alexPhone, await addDevice(familyA, 'Alex', 'android', 'Pixel 7'));
    Object.assign(benPc, await addDevice(familyB, 'Ben', 'windows', 'Ben PC'));
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(events);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('stores the event and pushes it to parents who have not muted tamper', async () => {
    await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'tamper', enabled: false });
    const id = randomUUID();
    const at = ago(30);
    const res = await upload(alexPhone, [{ id, kind: 'tamper.call_blocked', at, payload: { number: '+61400000009' } }]);
    await db.delete(notificationPrefs);
    expect(res.status).toBe(204);

    const history = await api.get('/v1/events?kind=tamper', mum);
    expect(history.body.events).toEqual([
      {
        id,
        kind: 'tamper.call_blocked',
        at,
        kidId: expect.any(String),
        kidName: 'Alex',
        deviceId: alexPhone.id,
        deviceName: 'Pixel 7',
        payload: { number: '+61400000009' },
      },
    ]);
    const [push] = sentTo('fcm-mum');
    expect(push?.high).toBe(false);
    expect(push?.msg).toMatchObject({ type: 'tamper', data: { id, kind: 'tamper.call_blocked', kidName: 'Alex' } });
    expect(sentTo('fcm-dad')).toHaveLength(0);
    expect(sentTo('fcm-bea')).toHaveLength(0);
  });

  it('stores every event of an upload but pushes only the latest of each kind', async () => {
    const kills = [ago(300), ago(200), ago(100)].map((at) => ({ id: randomUUID(), kind: 'tamper.tray_killed', at }));
    const zone = { id: randomUUID(), kind: 'tamper.timezone', at: ago(250), payload: { from: 'Australia/Sydney', to: 'UTC' } };
    expect((await upload(benPc, [...kills, zone])).status).toBe(204);

    const history = await api.get('/v1/events', bea);
    expect(history.body.events.map((e: { id: string }) => e.id)).toEqual([kills[2]?.id, kills[1]?.id, zone.id, kills[0]?.id]);
    const pushed = sentTo('fcm-bea').map((m) => (m.msg.data as { id: string }).id);
    expect(pushed.sort()).toEqual([kills[2]?.id, zone.id].sort());
    expect(sentTo('fcm-mum')).toHaveLength(0);
  });

  it('skips ids it already has, so a queue sent again stores and pushes nothing new', async () => {
    const first = { id: randomUUID(), kind: 'tamper.clock', at: ago(60), payload: { skewSec: 3600 } };
    expect((await upload(alexPhone, [first])).status).toBe(204);
    sent.length = 0;
    const second = { id: randomUUID(), kind: 'tamper.policy', at: ago(10), payload: { policy: 'safe_boot' } };
    expect((await upload(alexPhone, [{ ...first, payload: { skewSec: 1 } }, second])).status).toBe(204);

    const rows = await db.select().from(events).where(inArray(events.id, [first.id, second.id]));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first.id)?.payload).toEqual({ skewSec: 3600 });
    expect(sentTo('fcm-mum').map((m) => (m.msg.data as { id: string }).id)).toEqual([second.id]);
  });

  it("never touches another family's event with the same id", async () => {
    const id = randomUUID();
    expect((await upload(alexPhone, [{ id, kind: 'tamper.clock', at: ago(60) }])).status).toBe(204);
    sent.length = 0;
    expect((await upload(benPc, [{ id, kind: 'tamper.timezone', at: ago(5) }])).status).toBe(204);
    const [row] = await db.select().from(events).where(eq(events.id, id));
    expect(row).toMatchObject({ familyId: familyA, deviceId: alexPhone.id, kind: 'tamper.clock' });
    expect((await api.get('/v1/events', bea)).body.events).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it('stores a time from the future as now', async () => {
    const id = randomUUID();
    const before = Date.now();
    expect((await upload(alexPhone, [{ id, kind: 'tamper.clock', at: new Date(before + 3_600_000).toISOString() }])).status).toBe(204);
    const [row] = await db.select().from(events).where(eq(events.id, id));
    expect(row?.at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row?.at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('refuses kinds a device may not send, bad bodies and unknown devices', async () => {
    const at = ago(5);
    expect((await upload(alexPhone, [{ id: randomUUID(), kind: 'tamper.offline_usage', at }])).status).toBe(422);
    expect((await upload(alexPhone, [{ id: randomUUID(), kind: 'sos.started', at }])).status).toBe(422);
    expect((await upload(alexPhone, [{ id: randomUUID(), kind: 'tamper.clock', at, payload: { a: { b: 1 } } }])).status).toBe(422);
    expect((await upload(alexPhone, [])).status).toBe(422);
    expect((await upload({ token: 'not-a-token' }, [{ id: randomUUID(), kind: 'tamper.clock', at }])).status).toBe(401);
    expect(await db.select().from(events)).toHaveLength(0);
  });
});
