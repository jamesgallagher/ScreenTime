import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, parentSessions, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('always-allowed apps', () => {
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

  let dad = '';
  let otherDad = '';
  let kid = '';
  let family = '';
  const phone = { id: '', token: '' };
  const tablet = { id: '', token: '' };
  const pc = { id: '', token: '' };

  function app(pkg: string, over: Record<string, unknown> = {}) {
    return { package: pkg, label: pkg.toUpperCase(), source: 'play', installer: null, blockable: true, installedAt: '2026-11-03T06:00:00.000Z', firstUsedAt: null, ...over };
  }

  const put = (device: { token: string }, apps: unknown[]) => api.put('/v1/device/apps', device.token, { apps });
  const allow = (device: { id: string }, pkg: string, on = true, token = dad) =>
    api.put(`/v1/devices/${device.id}/apps/${encodeURIComponent(pkg)}/always-allowed`, token, { alwaysAllowed: on });
  const rule = (pkg: string, mode: string, dailyMinutes: number | null = null) =>
    api.put(`/v1/kids/${kid}/apps/${encodeURIComponent(pkg)}/rule`, dad, { mode, dailyMinutes });
  const allowedOn = async (device: { token: string }) => (await api.get('/v1/device/state', device.token)).body.apps.alwaysAllowed as string[];

  async function addDevice(platform: 'android' | 'windows', form: string, name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId: family,
        kidId: kid,
        platform,
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function signIn(familyId: string, parentId: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'web', clientLabel: 'Web' })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    const [b] = await db.insert(families).values({ name: 'B', timezone: 'Australia/Sydney', parentCodeSecret: 'B'.repeat(32) }).returning();
    if (!a || !b) throw new Error('no family');
    family = a.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    const [q] = await db.insert(parents).values({ familyId: b.id, email: 'bea@example.com', displayName: 'Bea' }).returning();
    if (!p || !q) throw new Error('no parent');
    dad = await signIn(family, p.id);
    otherDad = await signIn(b.id, q.id);
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '07:00', bedtime: '20:30' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(phone, await addDevice('android', 'phone', 'Pixel 7'));
    Object.assign(tablet, await addDevice('android', 'tablet', 'XPPen'));
    Object.assign(pc, await addDevice('windows', 'pc', 'Alex on PC'));
    await put(phone, [app('com.duolingo'), app('com.google.android.deskclock', { source: 'preinstalled' }), app('a.game')]);
    await put(tablet, [app('com.duolingo')]);
  });

  it('is per device: on for the phone, not for the tablet, and the list shows it', async () => {
    expect(await allowedOn(phone)).toEqual([]);
    expect((await allow(phone, 'com.duolingo')).status).toBe(204);
    expect((await allow(phone, 'com.google.android.deskclock')).status).toBe(204);
    expect(await allowedOn(phone)).toEqual(['com.duolingo', 'com.google.android.deskclock']);
    expect(await allowedOn(tablet)).toEqual([]);
    const list = await api.get(`/v1/kids/${kid}/apps`, dad);
    const duolingo = (list.body.apps as { package: string; devices: { deviceName: string; alwaysAllowed: boolean }[] }[]).find((a) => a.package === 'com.duolingo');
    expect(duolingo?.devices.map((d) => [d.deviceName, d.alwaysAllowed])).toEqual([
      ['Pixel 7', true],
      ['XPPen', false],
    ]);
  });

  it('turns off again, and changes the snapshot version both ways', async () => {
    const before = (await api.get('/v1/device/state', phone.token)).body.stateVersion;
    await allow(phone, 'com.duolingo');
    const on = (await api.get('/v1/device/state', phone.token)).body.stateVersion;
    expect(on).not.toBe(before);
    expect((await allow(phone, 'com.duolingo', false)).status).toBe(204);
    expect(await allowedOn(phone)).toEqual([]);
    expect((await api.get('/v1/device/state', phone.token)).body.stateVersion).toBe(before);
  });

  it('lets a block win, and turning it on for a blocked or waiting app is refused', async () => {
    await allow(phone, 'a.game');
    await rule('a.game', 'blocked');
    expect(await allowedOn(phone)).toEqual([]);
    await rule('a.game', 'allowed');
    expect(await allowedOn(phone)).toEqual(['a.game']);
    await rule('a.game', 'blocked');
    expect((await allow(phone, 'a.game')).status).toBe(409);
    // Turning it off is always fine.
    expect((await allow(phone, 'a.game', false)).status).toBe(204);
  });

  it('keeps an app with a daily limit: the device ends it at the limit', async () => {
    await allow(phone, 'com.duolingo');
    await rule('com.duolingo', 'limit', 30);
    expect(await allowedOn(phone)).toEqual(['com.duolingo']);
  });

  it('refuses what cannot be let through, and other families', async () => {
    await put(phone, [app('com.duolingo'), app('com.android.settings', { blockable: false })]);
    expect((await allow(phone, 'com.android.settings')).status).toBe(409);
    expect((await allow(phone, 'not.there')).status).toBe(404);
    expect((await allow(tablet, 'a.game')).status).toBe(404);
    expect((await allow(phone, 'com.duolingo', true, otherDad)).status).toBe(404);
    expect((await api.put(`/v1/devices/${phone.id}/apps/com.duolingo/always-allowed`, null, { alwaysAllowed: true })).status).toBe(401);
    expect((await api.put(`/v1/devices/${phone.id}/apps/com.duolingo/always-allowed`, dad, { alwaysAllowed: 'yes' })).status).toBe(422);
  });

  it('leaves out an app that was removed, and keeps it for when it comes back', async () => {
    await allow(phone, 'com.duolingo');
    await put(phone, [app('a.game')]);
    expect(await allowedOn(phone)).toEqual([]);
    expect((await allow(phone, 'com.duolingo')).status).toBe(404);
    await put(phone, [app('a.game'), app('com.duolingo')]);
    expect(await allowedOn(phone)).toEqual(['com.duolingo']);
  });

  it('gives a PC an empty list, and leaves out a removed device', async () => {
    await allow(phone, 'com.duolingo');
    expect(await allowedOn(pc)).toEqual([]);
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, tablet.id));
    expect((await allow(tablet, 'com.duolingo')).status).toBe(404);
  });

  it('tells the kid devices when it changes', async () => {
    await db.update(devices).set({ fcmToken: 'kid-phone' }).where(eq(devices.id, phone.id));
    sent.length = 0;
    await allow(phone, 'com.duolingo');
    expect(sent.filter((m) => m.token === 'kid-phone')).toHaveLength(1);
  });
});
