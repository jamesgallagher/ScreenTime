import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { appRules, devices, events, families, kids, parentSessions, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('app rules', () => {
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
  let dad = '';
  let otherDad = '';
  let kid = '';
  const phone = { id: '', token: '' };
  const pc = { id: '', token: '' };

  function app(pkg: string, over: Record<string, unknown> = {}) {
    return { package: pkg, label: pkg.toUpperCase(), source: 'play', installer: null, blockable: true, installedAt: '2026-11-03T06:00:00.000Z', firstUsedAt: null, ...over };
  }

  const put = (apps: unknown[]) => api.put('/v1/device/apps', phone.token, { apps });
  const rule = (pkg: string, mode: string, token = dad, dailyMinutes: number | null = null) =>
    api.put(`/v1/kids/${kid}/apps/${encodeURIComponent(pkg)}/rule`, token, { mode, dailyMinutes });
  const settings = (on: boolean, token = dad) => api.put(`/v1/kids/${kid}/app-settings`, token, { newAppApproval: on });

  async function kinds() {
    const rows = await db.select().from(events).where(eq(events.familyId, family));
    return rows.filter((e) => e.kind.startsWith('app.')).map((e) => e.kind).sort();
  }

  async function addDevice(platform: 'android' | 'windows', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId: family,
        kidId: kid,
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
    dad = await signIn(family, p.id, 'dad-phone');
    otherDad = await signIn(b.id, q.id, 'bea-phone');
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '07:00', bedtime: '20:30' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(phone, await addDevice('android', 'Pixel 7'));
    Object.assign(pc, await addDevice('windows', 'Alex on PC'));
  });

  it('blocks and allows an app, and the list shows the rule', async () => {
    await put([app('a.game'), app('b.game')]);
    const blocked = await rule('a.game', 'blocked');
    expect(blocked.status).toBe(200);
    expect(blocked.body).toEqual({ mode: 'blocked', dailyMinutes: null });
    const list = await api.get(`/v1/kids/${kid}/apps`, dad);
    const rows = list.body.apps as { package: string; rule: { mode: string } | null }[];
    expect(rows.find((a) => a.package === 'a.game')?.rule).toEqual({ mode: 'blocked', dailyMinutes: null });
    expect(rows.find((a) => a.package === 'b.game')?.rule).toBeNull();
    expect((await rule('a.game', 'allowed')).body).toEqual({ mode: 'allowed', dailyMinutes: null });
  });

  it('refuses what a parent cannot do', async () => {
    await put([app('a.game'), app('com.android.settings', { blockable: false })]);
    expect((await rule('com.android.settings', 'blocked')).status).toBe(409);
    expect((await rule('not.there', 'blocked')).status).toBe(404);
    expect((await rule('a.game', 'held')).status).toBe(422);
    expect((await rule('a.game', 'blocked', otherDad)).status).toBe(404);
    expect((await settings(true, otherDad)).status).toBe(404);
    expect((await api.put(`/v1/kids/${kid}/app-settings`, null, { newAppApproval: true })).status).toBe(401);
  });

  it('puts the rules and the switch in the snapshot, and changes its version', async () => {
    await put([app('a.game')]);
    const before = await api.get('/v1/device/state', phone.token);
    expect(before.body.apps).toEqual({ newAppApproval: false, rules: [] });
    await rule('a.game', 'blocked');
    await settings(true);
    const after = await api.get('/v1/device/state', phone.token);
    expect(after.body.apps).toEqual({ newAppApproval: true, rules: [{ package: 'a.game', mode: 'blocked', dailyMinutes: null }] });
    expect(after.body.stateVersion).not.toBe(before.body.stateVersion);
  });

  it('gives a PC an empty apps part', async () => {
    await put([app('a.game')]);
    await rule('a.game', 'blocked');
    await settings(true);
    const state = await api.get('/v1/device/state', pc.token);
    expect(state.body.apps).toEqual({ newAppApproval: false, rules: [] });
  });

  it('tells the devices when a rule or the switch changes', async () => {
    await db.update(devices).set({ fcmToken: 'kid-phone' }).where(eq(devices.id, phone.id));
    await put([app('a.game')]);
    sent.length = 0;
    await rule('a.game', 'blocked');
    expect(sent.filter((m) => m.token === 'kid-phone')).toHaveLength(1);
    await settings(true);
    expect(sent.filter((m) => m.token === 'kid-phone')).toHaveLength(2);
  });

  it('with approval off a new app only raises app.installed', async () => {
    await put([app('a.game')]);
    await put([app('a.game'), app('b.game')]);
    expect(await kinds()).toEqual(['app.installed']);
    expect(await db.select().from(appRules)).toEqual([]);
  });

  it('with approval on a new app is held, and the essential alert is pushed even when muted', async () => {
    await put([app('a.game')]);
    await settings(true);
    await db.update(devices).set({ fcmToken: 'kid-phone' }).where(eq(devices.id, phone.id));
    sent.length = 0;
    await put([app('a.game'), app('b.game', { label: 'Block Blast' })]);
    expect(await kinds()).toEqual(['app.approval']);
    const [held] = await db.select().from(appRules).where(eq(appRules.package, 'b.game'));
    expect(held?.mode).toBe('held');
    expect(held?.updatedBy).toBeNull();
    expect(sent.some((m) => m.token === 'dad-phone')).toBe(true);
    expect(sent.some((m) => m.token === 'kid-phone')).toBe(true);
    // The first list of a second device is still its baseline: nothing is held.
    const tablet = await addDevice('android', 'XPPen');
    await api.put('/v1/device/apps', tablet.token, { apps: [app('c.game')] });
    expect((await db.select().from(appRules).where(eq(appRules.package, 'c.game')))).toEqual([]);
  });

  it('an app with a rule is not held again: reinstalling a blocked or allowed app keeps its rule', async () => {
    await put([app('a.game'), app('b.game'), app('z.game')]);
    await rule('a.game', 'blocked');
    await rule('b.game', 'allowed');
    await settings(true);
    await put([app('z.game')]);
    await put([app('z.game'), app('a.game'), app('b.game')]);
    expect((await kinds()).filter((k) => k === 'app.approval')).toEqual([]);
    const rows = await db.select().from(appRules).where(and(eq(appRules.kidId, kid), eq(appRules.package, 'a.game')));
    expect(rows[0]?.mode).toBe('blocked');
  });

  it('an answer writes app.answered with who gave it, once', async () => {
    await put([app('a.game')]);
    await settings(true);
    await put([app('a.game'), app('b.game', { label: 'Block Blast' })]);
    await rule('b.game', 'allowed');
    await rule('b.game', 'blocked');
    const rows = await db.select().from(events).where(eq(events.kind, 'app.answered'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ package: 'b.game', label: 'Block Blast', approved: true, byName: 'Dad' });
  });

  it('turning approval off leaves waiting apps waiting', async () => {
    await put([app('a.game')]);
    await settings(true);
    await put([app('a.game'), app('b.game')]);
    await settings(false);
    const [held] = await db.select().from(appRules).where(eq(appRules.package, 'b.game'));
    expect(held?.mode).toBe('held');
  });
});
