import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { devices, events, families, kids, parentSessions, parents } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('app updates and removal', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const releases = mkdtempSync(join(tmpdir(), 'screentime-releases-'));
  const deps = { db, config: { ...testConfig(url ?? ''), releasesDir: releases }, mailer, pusher };
  const api = client(deps);
  const app = createApp(deps);

  let family = '';
  let kid = '';
  const phone = { id: '', token: '' };
  const pc = { id: '', token: '' };

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

  const offer = { versionCode: 5, versionName: '1.4.0', sha256: 'a'.repeat(64), sizeBytes: 5 };
  const publish = (over: Record<string, unknown> = {}) => {
    writeFileSync(join(releases, 'kid-5.apk'), 'hello');
    writeFileSync(join(releases, 'kid.json'), JSON.stringify({ ...offer, file: 'kid-5.apk', ...over }));
  };
  const check = (versionCode: number, token = phone.token) =>
    api.post('/v1/device/app-update/check', token, { versionCode, versionName: `v${versionCode}` });
  const apk = (token: string) => app.request('/v1/device/app-update/apk', { headers: { authorization: `Bearer ${token}` } });

  afterAll(async () => {
    rmSync(releases, { recursive: true, force: true });
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    rmSync(join(releases, 'kid.json'), { force: true });
    rmSync(join(releases, 'kid-5.apk'), { force: true });
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    if (!a) throw new Error('no family');
    family = a.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    if (!p) throw new Error('no parent');
    await db.insert(parentSessions).values({ familyId: family, parentId: p.id, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken: 'dad-phone' });
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    Object.assign(phone, await addDevice('android', 'Pixel 7'));
    Object.assign(pc, await addDevice('windows', 'Alex on PC'));
  });

  it('offers nothing when nothing is published, and stores the version', async () => {
    const res = await check(1);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ offer: null });
    const [row] = await db.select().from(devices).where(eq(devices.id, phone.id));
    expect(row?.appVersion).toBe('v1');
  });

  it('offers a newer version, without the file name or the device list', async () => {
    publish();
    const res = await check(4);
    expect(res.body).toEqual({ offer });
  });

  it('offers nothing for the same or an older version', async () => {
    publish();
    expect((await check(5)).body).toEqual({ offer: null });
    expect((await check(6)).body).toEqual({ offer: null });
  });

  it('offers nothing to a device that is not Android', async () => {
    publish();
    expect((await check(1, pc.token)).body).toEqual({ offer: null });
  });

  it('offers a version for chosen devices only to them', async () => {
    publish({ deviceIds: [randomUUID()] });
    expect((await check(1)).body).toEqual({ offer: null });
    publish({ deviceIds: [phone.id] });
    expect((await check(1)).body).toEqual({ offer });
  });

  it('offers nothing when kid.json is not valid', async () => {
    writeFileSync(join(releases, 'kid.json'), '{ not json');
    expect((await check(1)).body).toEqual({ offer: null });
    publish({ file: '../secrets.apk' });
    expect((await check(1)).body).toEqual({ offer: null });
  });

  it('needs a device token', async () => {
    expect((await api.post('/v1/device/app-update/check', null, { versionCode: 1, versionName: 'x' })).status).toBe(401);
    expect((await app.request('/v1/device/app-update/apk')).status).toBe(401);
    expect((await api.post('/v1/device/removed', null)).status).toBe(401);
  });

  it('serves the file to a device it is for, and to no other', async () => {
    publish({ deviceIds: [phone.id] });
    const res = await apk(phone.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('5');
    expect(await res.text()).toBe('hello');
    expect((await apk(pc.token)).status).toBe(404);
  });

  it('says 404 when kid.json names a file that is not there', async () => {
    publish();
    rmSync(join(releases, 'kid-5.apk'));
    expect((await apk(phone.token)).status).toBe(404);
  });

  it('revokes a removed device and tells the parents', async () => {
    const res = await api.post('/v1/device/removed', phone.token);
    expect(res.status).toBe(204);
    const [row] = await db.select().from(devices).where(eq(devices.id, phone.id));
    expect(row?.revokedAt).not.toBeNull();
    const rows = await db.select().from(events).where(eq(events.kind, 'device.removed'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceId).toBe(phone.id);
    expect(rows[0]?.payload).toEqual({ deviceName: 'Pixel 7' });
    expect((await check(1)).status).toBe(401);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.token).toBe('dad-phone');
  });
});
