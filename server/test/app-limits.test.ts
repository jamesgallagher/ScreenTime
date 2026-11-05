import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { appRules, appUsageDaily, devices, families, kids, parentSessions, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('app limits', () => {
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
  let kid = '';
  let family = '';
  const phone = { id: '', token: '' };
  const tablet = { id: '', token: '' };
  const pc = { id: '', token: '' };
  const zone = 'Australia/Sydney';
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());

  function app(pkg: string) {
    return { package: pkg, label: pkg.toUpperCase(), source: 'play', installer: null, blockable: true, installedAt: '2026-11-03T06:00:00.000Z', firstUsedAt: null };
  }

  const rule = (pkg: string, mode: string, dailyMinutes: number | null) =>
    api.put(`/v1/kids/${kid}/apps/${encodeURIComponent(pkg)}/rule`, dad, { mode, dailyMinutes });
  const usage = (device: { token: string }, seconds: number, day = today(), pkg = 'a.game') =>
    api.post('/v1/device/app-usage', device.token, { days: [{ day, apps: [{ package: pkg, seconds }] }] });

  async function addDevice(platform: 'android' | 'windows', form: 'phone' | 'tablet' | 'pc', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({ familyId: family, kidId: kid, platform, form, pool: form === 'phone' ? 'phone' : 'screens', name, tokenHash: hashDeviceToken(token) })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    const [a] = await db.insert(families).values({ name: 'A', timezone: zone, parentCodeSecret: 'A'.repeat(32) }).returning();
    if (!a) throw new Error('no family');
    family = a.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    if (!p) throw new Error('no parent');
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId: family, parentId: p.id, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken: 'dad-phone' })
      .returning();
    if (!session) throw new Error('no session');
    dad = await signAccessToken(TEST_SECRET, { sessionId: session.id, parentId: p.id, familyId: family, roles: ['parent'] });
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '00:00', bedtime: '24:00' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(phone, await addDevice('android', 'phone', 'Pixel 7'));
    Object.assign(tablet, await addDevice('android', 'tablet', 'XPPen'));
    Object.assign(pc, await addDevice('windows', 'pc', 'Alex on PC'));
    await api.put('/v1/device/apps', phone.token, { apps: [app('a.game'), app('b.game')] });
  });

  it('stores a limit, and the list shows it', async () => {
    const saved = await rule('a.game', 'limit', 30);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ mode: 'limit', dailyMinutes: 30 });
    const list = await api.get(`/v1/kids/${kid}/apps`, dad);
    const row = (list.body.apps as { package: string; rule: unknown }[]).find((a) => a.package === 'a.game');
    expect(row?.rule).toEqual({ mode: 'limit', dailyMinutes: 30 });
  });

  it('refuses a limit it cannot use', async () => {
    expect((await rule('a.game', 'limit', null)).status).toBe(422);
    expect((await rule('a.game', 'limit', 0)).status).toBe(422);
    expect((await rule('a.game', 'limit', 7)).status).toBe(422);
    expect((await rule('a.game', 'limit', 485)).status).toBe(422);
    expect((await rule('a.game', 'blocked', 30)).status).toBe(422);
    expect((await rule('a.game', 'limit', 5)).status).toBe(200);
    expect((await rule('a.game', 'limit', 480)).status).toBe(200);
  });

  it('forgets the minutes when the rule stops being a limit', async () => {
    await rule('a.game', 'limit', 30);
    await rule('a.game', 'allowed', null);
    const [row] = await db.select().from(appRules).where(eq(appRules.package, 'a.game'));
    expect(row?.dailyMinutes).toBeNull();
  });

  it('never lowers a value', async () => {
    expect((await usage(phone, 100)).status).toBe(204);
    await usage(phone, 60);
    const [row] = await db.select().from(appUsageDaily);
    expect(row?.seconds).toBe(100);
    await usage(phone, 160);
    const [again] = await db.select().from(appUsageDaily);
    expect(again?.seconds).toBe(160);
  });

  it('refuses a PC, a bad day and no token', async () => {
    expect((await usage(pc, 100)).status).toBe(409);
    expect((await usage(phone, 100, 'yesterday')).status).toBe(422);
    expect((await usage(phone, -1)).status).toBe(422);
    expect((await api.post('/v1/device/app-usage', null, { days: [{ day: today(), apps: [] }] })).status).toBe(401);
  });

  it("adds up today across the kid's devices for a parent, and leaves out other days", async () => {
    await usage(phone, 100);
    await usage(tablet, 50);
    await usage(phone, 999, '2020-01-01');
    const list = await api.get(`/v1/kids/${kid}/apps`, dad);
    const rows = list.body.apps as { package: string; todaySeconds: number }[];
    expect(rows.find((a) => a.package === 'a.game')?.todaySeconds).toBe(150);
    expect(rows.find((a) => a.package === 'b.game')?.todaySeconds).toBe(0);
  });

  it("gives a device the others' seconds for limited apps only, and never its own", async () => {
    await rule('a.game', 'limit', 30);
    await usage(phone, 100);
    await usage(tablet, 50);
    await usage(tablet, 70, today(), 'b.game');
    const state = await api.get('/v1/device/state', phone.token);
    expect(state.body.today.appUsage).toEqual([{ package: 'a.game', deviceId: tablet.id, seconds: 50 }]);
    expect(state.body.apps.rules).toEqual([{ package: 'a.game', mode: 'limit', dailyMinutes: 30 }]);
    const other = await api.get('/v1/device/state', tablet.token);
    expect(other.body.today.appUsage).toEqual([{ package: 'a.game', deviceId: phone.id, seconds: 100 }]);
  });

  it('gives a PC nothing', async () => {
    await rule('a.game', 'limit', 30);
    await usage(tablet, 50);
    const state = await api.get('/v1/device/state', pc.token);
    expect(state.body.today.appUsage).toEqual([]);
    expect(state.body.apps.rules).toEqual([]);
  });

  it('does not push for usage, even of a limited app', async () => {
    await db.update(devices).set({ fcmToken: 'tablet-token' }).where(eq(devices.id, tablet.id));
    await rule('a.game', 'limit', 30);
    sent.length = 0;
    await usage(phone, 100);
    expect(sent).toEqual([]);
  });

  it('counts answering a waiting app with a limit as a yes', async () => {
    await api.put(`/v1/kids/${kid}/app-settings`, dad, { newAppApproval: true });
    await api.put('/v1/device/apps', phone.token, { apps: [app('a.game'), app('b.game'), app('c.game')] });
    await rule('c.game', 'limit', 30);
    const list = await api.get('/v1/events', dad);
    const answered = (list.body.events as { kind: string; payload: { approved: boolean } }[]).find((e) => e.kind === 'app.answered');
    expect(answered?.payload.approved).toBe(true);
  });
});
