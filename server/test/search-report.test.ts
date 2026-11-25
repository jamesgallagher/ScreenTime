import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { deviceApps, devices, families, kids, parentSessions, parents, searches } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('searches report', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const pusher: Pusher = { async send() { return []; } };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });
  const FIXED_NOW = new Date('2026-11-12T12:00:00Z');

  let family = '';
  let otherFamily = '';
  let dad = '';
  let kid = '';
  let otherKid = '';
  let emptyKid = '';
  const android = { id: '', token: '' };
  const pc = { id: '', token: '' };

  async function addDevice(
    familyId: string,
    kidId: string,
    name: string,
    platform: 'android' | 'windows',
    form: 'phone' | 'pc',
    enrolledAt: string,
    revokedAt: string | null = null,
    searchCapture: 'on' | 'off' | null = null,
  ) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform,
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
        enrolledAt: new Date(enrolledAt),
        revokedAt: revokedAt ? new Date(revokedAt) : null,
        searchCapture,
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

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
    await resetDatabase(db, pool);
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'UTC', parentCodeSecret: 'A'.repeat(32) }).returning();
    const [b] = await db.insert(families).values({ name: 'B', timezone: 'UTC', parentCodeSecret: 'B'.repeat(32) }).returning();
    if (!a || !b) throw new Error('no family');
    family = a.id;
    otherFamily = b.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    if (!p) throw new Error('no parent');
    dad = await signIn(family, p.id);
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    const [ok] = await db.insert(kids).values({ familyId: otherFamily, name: 'Ben', avatarColor: '#7C3AED' }).returning();
    const [ek] = await db.insert(kids).values({ familyId: family, name: 'No devices', avatarColor: '#EA580C' }).returning();
    if (!k || !ok || !ek) throw new Error('no kid');
    kid = k.id;
    otherKid = ok.id;
    emptyKid = ek.id;
    Object.assign(android, await addDevice(family, kid, 'D', 'android', 'phone', '2026-11-01T00:00:00Z'));
    Object.assign(pc, await addDevice(family, kid, 'P', 'windows', 'pc', '2026-11-01T00:00:01Z'));
  });

  afterEach(() => vi.useRealTimers());
  afterAll(async () => pool.end());

  const report = (query: string, token: string | null = dad) => api.get(`/v1/reports/searches?${query}`, token);

  async function addSearch(
    deviceId: string,
    input: {
      at: string;
      query: string;
      package: string;
      engine?: string;
      lastAt?: string;
      count?: number;
      private?: boolean | null;
      source?: 'android' | 'title';
    },
  ) {
    await db.insert(searches).values({
      familyId: family,
      kidId: kid,
      deviceId,
      at: new Date(input.at),
      lastAt: new Date(input.lastAt ?? input.at),
      count: input.count ?? 1,
      engine: input.engine ?? 'google',
      query: input.query,
      package: input.package,
      private: input.private ?? null,
      source: input.source ?? 'android',
    });
  }

  it('12: uses family-local period edges', async () => {
    await db.update(families).set({ timezone: 'Australia/Sydney' }).where(eq(families.id, family));
    for (const at of [
      '2026-11-11T12:59:00Z',
      '2026-11-11T13:00:00Z',
      '2026-11-12T12:59:00Z',
      '2026-11-12T13:00:00Z',
    ]) {
      await addSearch(android.id, { at, query: at, package: 'com.android.chrome' });
    }
    const response = await report(`kidId=${kid}&period=day&date=2026-11-12`);
    expect(response.status).toBe(200);
    expect(response.body.searches.map((item: { at: string }) => item.at)).toEqual([
      '2026-11-12T12:59:00.000Z',
      '2026-11-11T13:00:00.000Z',
    ]);
  });

  it('13: returns active and removed devices with capture state and package labels', async () => {
    await db.update(devices).set({ searchCapture: 'on' }).where(eq(devices.id, android.id));
    const removed = await addDevice(family, kid, 'R', 'android', 'phone', '2026-11-02T00:00:00Z', '2026-11-10T00:00:00Z', 'off');
    const emptyRemoved = await addDevice(family, kid, 'S', 'android', 'phone', '2026-11-03T00:00:00Z', '2026-11-10T00:00:00Z');
    await db.insert(deviceApps).values({
      familyId: family,
      kidId: kid,
      deviceId: android.id,
      package: 'com.android.chrome',
      label: 'Chrome',
      source: 'other',
      blockable: true,
      installedAt: new Date('2026-10-01T00:00:00Z'),
      firstSeenAt: new Date('2026-10-01T00:00:00Z'),
      baseline: true,
    });
    await addSearch(android.id, { at: '2026-11-12T05:00:00Z', query: 'phone query', package: 'com.android.chrome' });
    await addSearch(pc.id, { at: '2026-11-12T06:00:00Z', query: 'PC query', package: 'msedge.exe', source: 'title' });
    await addSearch(removed.id, { at: '2026-11-12T07:00:00Z', query: 'removed query', package: 'unknown.exe' });

    const response = await report(`kidId=${kid}&period=day&date=2026-11-12`);
    expect(response.status).toBe(200);
    expect(response.body.devices).toEqual([
      { deviceId: android.id, name: 'D', form: 'phone', platform: 'android', removedAt: null, capture: 'on' },
      { deviceId: pc.id, name: 'P', form: 'pc', platform: 'windows', removedAt: null, capture: 'never' },
      { deviceId: removed.id, name: 'R', form: 'phone', platform: 'android', removedAt: '2026-11-10T00:00:00.000Z', capture: 'off' },
    ]);
    expect(response.body.searches).toEqual([
      expect.objectContaining({ query: 'removed query', appLabel: 'unknown.exe', private: null }),
      expect.objectContaining({ query: 'PC query', appLabel: 'msedge.exe', private: null }),
      expect.objectContaining({ query: 'phone query', appLabel: 'Chrome', private: null }),
    ]);
    expect(response.body.devices.some((device: { deviceId: string }) => device.deviceId === emptyRemoved.id)).toBe(false);
  });

  it('14: filters searches by device while retaining the report device list', async () => {
    await db.update(devices).set({ searchCapture: 'on' }).where(eq(devices.id, android.id));
    const removed = await addDevice(family, kid, 'R', 'android', 'phone', '2026-11-02T00:00:00Z', '2026-11-10T00:00:00Z', 'off');
    await addSearch(android.id, { at: '2026-11-12T05:00:00Z', query: 'phone query', package: 'com.android.chrome' });
    await addSearch(pc.id, { at: '2026-11-12T06:00:00Z', query: 'PC query', package: 'msedge.exe', source: 'title' });
    await addSearch(removed.id, { at: '2026-11-12T07:00:00Z', query: 'removed query', package: 'unknown.exe' });

    const response = await report(`kidId=${kid}&period=day&date=2026-11-12&deviceId=${android.id}`);
    expect(response.status).toBe(200);
    expect(response.body.searches.map((item: { query: string }) => item.query)).toEqual(['phone query']);
    expect(response.body.devices.map((device: { deviceId: string }) => device.deviceId)).toEqual([
      android.id,
      pc.id,
      removed.id,
    ]);
  });

  it('15: handles empty, unknown, cross-family, and invalid report requests', async () => {
    expect((await report(`kidId=${emptyKid}&period=day&date=2026-11-12`)).body).toMatchObject({
      devices: [],
      searches: [],
    });
    expect((await report(`kidId=${randomUUID()}&period=day&date=2026-11-12`)).status).toBe(404);
    expect((await report(`kidId=${otherKid}&period=day&date=2026-11-12`)).status).toBe(404);
    expect((await report(`kidId=${kid}&period=year&date=2026-11-12`)).status).toBe(422);
    expect((await report(`kidId=${kid}&period=day&date=2026-13-01`)).status).toBe(422);
    expect((await report(`kidId=${kid}&period=day&date=2026-11-12&deviceId=${randomUUID()}`)).status).toBe(422);
  });

  it('16: does not include searches in the sites report', async () => {
    const response = await api.get(`/v1/reports/sites?kidId=${kid}&period=day&date=2026-11-12`, dad);
    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('searches');
  });
});
