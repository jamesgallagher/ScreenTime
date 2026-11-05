import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { deviceApps, devices, events, families, kids, parentSessions, parents } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('apps', () => {
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
  let otherFamily = '';
  let dad = '';
  let otherDad = '';
  let kid = '';
  const phone = { id: '', token: '' };
  const tablet = { id: '', token: '' };
  const pc = { id: '', token: '' };

  const INSTALLED = '2026-11-03T06:00:00.000Z';

  function app(pkg: string, over: Record<string, unknown> = {}) {
    return { package: pkg, label: pkg.toUpperCase(), source: 'play', installer: null, blockable: true, installedAt: INSTALLED, firstUsedAt: null, ...over };
  }

  const put = (device: { token: string }, apps: unknown[]) => api.put('/v1/device/apps', device.token, { apps });

  async function kinds() {
    const rows = await db.select().from(events).where(eq(events.familyId, family));
    return rows.filter((e) => e.kind.startsWith('app.')).map((e) => ({ kind: e.kind, payload: e.payload, deviceId: e.deviceId, at: e.at }));
  }

  async function addDevice(familyId: string, kidId: string, platform: 'android' | 'windows', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
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

  async function signIn(familyId: string, parentId: string, fcmToken: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
  });

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
    otherFamily = b.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    const [q] = await db.insert(parents).values({ familyId: otherFamily, email: 'bea@example.com', displayName: 'Bea' }).returning();
    if (!p || !q) throw new Error('no parent');
    dad = await signIn(family, p.id, 'dad-phone');
    otherDad = await signIn(otherFamily, q.id, 'bea-phone');
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    Object.assign(phone, await addDevice(family, kid, 'android', 'Pixel 7'));
    Object.assign(tablet, await addDevice(family, kid, 'android', 'XPPen'));
    Object.assign(pc, await addDevice(family, kid, 'windows', 'Alex on PC'));
  });

  it('takes the first list as a baseline: stored, with no event and no push', async () => {
    const res = await put(phone, [app('a.game'), app('b.used', { firstUsedAt: '2026-11-01T00:00:00Z', source: 'preinstalled' })]);
    expect(res.status).toBe(204);
    expect(await kinds()).toEqual([]);
    expect(sent).toEqual([]);
    const rows = await db.select().from(deviceApps).where(eq(deviceApps.deviceId, phone.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.baseline)).toBe(true);
    expect(rows.find((r) => r.package === 'b.used')?.firstUsedAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('writes app.installed and pushes it for an app new to the device', async () => {
    await put(phone, [app('a.game')]);
    await put(phone, [app('a.game'), app('b.game', { label: 'Block Blast' })]);
    const list = await kinds();
    expect(list).toHaveLength(1);
    expect(list[0]?.kind).toBe('app.installed');
    expect(list[0]?.deviceId).toBe(phone.id);
    expect(list[0]?.at.toISOString()).toBe(INSTALLED);
    expect(list[0]?.payload).toEqual({ package: 'b.game', label: 'Block Blast', source: 'play', deviceName: 'Pixel 7' });
    expect(sent.map((m) => m.token)).toEqual(['dad-phone']);
    const rows = await db.select().from(deviceApps).where(eq(deviceApps.package, 'b.game'));
    expect(rows[0]?.baseline).toBe(false);
  });

  it('writes app.first_used once, also for a pre-installed app of the baseline', async () => {
    await put(phone, [app('a.game', { source: 'preinstalled' })]);
    await put(phone, [app('a.game', { source: 'preinstalled', firstUsedAt: '2026-11-04T01:00:00Z' })]);
    await put(phone, [app('a.game', { source: 'preinstalled', firstUsedAt: '2026-11-04T01:00:00Z' })]);
    const list = await kinds();
    expect(list.map((e) => e.kind)).toEqual(['app.first_used']);
    expect(list[0]?.at.toISOString()).toBe('2026-11-04T01:00:00.000Z');
    expect(list[0]?.payload).toEqual({ package: 'a.game', label: 'A.GAME', deviceName: 'Pixel 7' });
  });

  it('writes both when a new app arrives already opened', async () => {
    await put(phone, [app('a.game')]);
    await put(phone, [app('a.game'), app('b.game', { firstUsedAt: '2026-11-04T01:00:00Z' })]);
    expect((await kinds()).map((e) => e.kind).sort()).toEqual(['app.first_used', 'app.installed']);
  });

  it('marks a missing app removed without an event, and alerts when it comes back, but not first use again', async () => {
    await put(phone, [app('a.game'), app('b.game', { firstUsedAt: '2026-11-01T00:00:00Z' })]);
    await put(phone, [app('a.game')]);
    expect(await kinds()).toEqual([]);
    const gone = await db.select().from(deviceApps).where(eq(deviceApps.package, 'b.game'));
    expect(gone[0]?.removedAt).not.toBeNull();

    await put(phone, [app('a.game'), app('b.game', { firstUsedAt: '2026-11-06T00:00:00Z', installedAt: '2026-11-05T00:00:00Z' })]);
    expect((await kinds()).map((e) => e.kind)).toEqual(['app.installed']);
    const back = await db.select().from(deviceApps).where(eq(deviceApps.package, 'b.game'));
    expect(back[0]?.removedAt).toBeNull();
    expect(back[0]?.firstUsedAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(back[0]?.installedAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
  });

  it('stores nothing as happening in the future', async () => {
    await put(phone, [app('a.game')]);
    await put(phone, [app('a.game'), app('b.game', { installedAt: '2099-01-01T00:00:00Z' })]);
    const list = await kinds();
    expect(list[0]?.at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('refuses a PC, a bad list and a missing token', async () => {
    expect((await put(pc, [app('a.game')])).status).toBe(409);
    expect((await put(phone, [])).status).toBe(422);
    expect((await put(phone, [app('a.game'), app('a.game')])).status).toBe(422);
    expect((await put(phone, [app('a.game', { source: 'pirate' })])).status).toBe(422);
    expect((await api.put('/v1/device/apps', null, { apps: [app('a.game')] })).status).toBe(401);
  });

  it('lists an app once across devices, for parents of the family only', async () => {
    await put(phone, [app('a.game', { firstUsedAt: '2026-11-04T01:00:00Z' }), app('com.android.settings', { blockable: false, source: 'preinstalled' })]);
    await put(tablet, [app('a.game')]);
    const res = await api.get(`/v1/kids/${kid}/apps`, dad);
    expect(res.status).toBe(200);
    const body = res.body as {
      newAppApproval: boolean;
      apps: { package: string; blockable: boolean; todaySeconds: number; devices: { deviceName: string; firstUsedAt: string | null }[] }[];
    };
    expect(body.newAppApproval).toBe(false);
    expect(body.apps.map((a) => a.package)).toEqual(['a.game', 'com.android.settings']);
    expect(body.apps[0]?.devices.map((d) => [d.deviceName, d.firstUsedAt])).toEqual([
      ['Pixel 7', '2026-11-04T01:00:00.000Z'],
      ['XPPen', null],
    ]);
    expect(body.apps[0]?.todaySeconds).toBe(0);
    expect(body.apps[1]?.blockable).toBe(false);
    expect((await api.get(`/v1/kids/${kid}/apps`, otherDad)).status).toBe(404);
    expect((await api.get(`/v1/kids/${randomUUID()}/apps`, dad)).status).toBe(404);
    expect((await api.get(`/v1/kids/${kid}/apps`, null)).status).toBe(401);
  });

  it('leaves out a revoked device', async () => {
    await put(phone, [app('a.game')]);
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, phone.id));
    const res = await api.get(`/v1/kids/${kid}/apps`, dad);
    expect((res.body as { apps: unknown[] }).apps).toEqual([]);
  });

  it('respects a muted kind: stored, not pushed', async () => {
    const muted = await api.put('/v1/me/notification-prefs', dad, [{ kind: 'app.installed', enabled: false }]);
    expect(muted.status).toBe(200);
    await put(phone, [app('a.game')]);
    await put(phone, [app('a.game'), app('b.game')]);
    expect((await kinds()).map((e) => e.kind)).toEqual(['app.installed']);
    expect(sent).toEqual([]);
  });
});
