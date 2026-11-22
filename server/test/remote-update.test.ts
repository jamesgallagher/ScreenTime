import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, parentSessions, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import { LiveHub } from '../src/live/hub.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** Every day the same, with no curfew, so the result does not depend on the weekday or the hour. */
const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

describe.skipIf(!url)('remote update now', () => {
  const FIXED = new Date('2026-11-21T10:00:00Z');
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const hub = new LiveHub();
  const hubSent: { ids: string[]; msg: { type: string } }[] = [];
  const originalSend = hub.send.bind(hub);
  hub.send = (ids, msg) => {
    hubSent.push({ ids: [...ids], msg });
    return originalSend(ids, msg);
  };
  const releases = mkdtempSync(join(tmpdir(), 'screentime-releases-'));
  const deps = { db, config: { ...testConfig(url ?? ''), releasesDir: releases }, mailer, pusher, hub };
  const api = client(deps);
  const app = createApp(deps);

  let familyId = '';
  let parentId = '';
  let parentToken = '';
  let kidId = '';
  let pc = { id: '', token: '' };
  let phone = { id: '', token: '' };
  let otherFamilyId = '';
  let otherFamilyDeviceId = '';

  async function addDevice(platform: 'android' | 'windows', form: 'phone' | 'pc', name: string, family = familyId, kid = kidId) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId: family,
        kidId: kid,
        platform,
        form,
        pool: platform === 'android' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  function publishWindows(versionCode: number, versionName: string, over: Record<string, unknown> = {}) {
    writeFileSync(join(releases, `ScreenTime-${versionName}.msi`), 'msi');
    writeFileSync(
      join(releases, 'windows.json'),
      JSON.stringify({
        versionCode,
        versionName,
        sha256: 'b'.repeat(64),
        sizeBytes: 3,
        file: `ScreenTime-${versionName}.msi`,
        ...over,
      }),
    );
  }

  function publishKid(versionCode: number, versionName: string, over: Record<string, unknown> = {}) {
    writeFileSync(join(releases, `kid-${versionCode}.apk`), 'apk');
    writeFileSync(
      join(releases, 'kid.json'),
      JSON.stringify({
        versionCode,
        versionName,
        sha256: 'a'.repeat(64),
        sizeBytes: 3,
        file: `kid-${versionCode}.apk`,
        ...over,
      }),
    );
  }

  const checkPc = (versionCode: number, versionName: string, token = pc.token) =>
    api.post('/v1/device/app-update/check', token, { versionCode, versionName });
  const checkPhone = (versionCode: number, versionName: string, token = phone.token) =>
    api.post('/v1/device/app-update/check', token, { versionCode, versionName });
  const requestUpdate = (deviceId: string, token = parentToken) =>
    api.post(`/v1/devices/${deviceId}/app-update`, token);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: FIXED });
    await resetDatabase(db, pool);
    sent.length = 0;
    hubSent.length = 0;
    rmSync(join(releases, 'windows.json'), { force: true });
    rmSync(join(releases, 'kid.json'), { force: true });
    for (const f of ['ScreenTime-0.1.130.msi', 'ScreenTime-0.1.131.msi', 'kid-900.apk', 'kid-901.apk']) {
      rmSync(join(releases, f), { force: true });
    }

    const [fam] = await db.insert(families).values({ name: 'F', timezone: 'UTC', parentCodeSecret: 'X'.repeat(32) }).returning();
    if (!fam) throw new Error('no family');
    familyId = fam.id;
    const [p] = await db.insert(parents).values({ familyId, email: 'dad@example.com', displayName: 'Dad' }).returning();
    if (!p) throw new Error('no parent');
    parentId = p.id;
    parentToken = await tokenFor({ parentId, familyId });
    await db.insert(parentSessions).values({
      familyId,
      parentId,
      refreshTokenHash: randomUUID(),
      client: 'android',
      clientLabel: 'Pixel',
    });
    const [k] = await db.insert(kids).values({ familyId, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kidId = k.id;
    await db.insert(scheduleVersions).values({ familyId, kidId, version: 1, days: flatWeek });

    Object.assign(pc, await addDevice('windows', 'pc', 'Alex on PC'));
    Object.assign(phone, await addDevice('android', 'phone', 'Pixel 7'));

    // Another family, with its own device (for the "other family" 404 check).
    const [fam2] = await db.insert(families).values({ name: 'G', timezone: 'UTC', parentCodeSecret: 'Y'.repeat(32) }).returning();
    otherFamilyId = fam2.id;
    const [p2] = await db.insert(parents).values({ familyId: otherFamilyId, email: 'mum@example.com', displayName: 'Mum' }).returning();
    if (!p2) throw new Error('no parent');
    await db.insert(parentSessions).values({
      familyId: otherFamilyId,
      parentId: p2.id,
      refreshTokenHash: randomUUID(),
      client: 'android',
      clientLabel: 'Pixel',
    });
    const [k2] = await db.insert(kids).values({ familyId: otherFamilyId, name: 'Ben', avatarColor: '#2563EB' }).returning();
    if (!k2) throw new Error('no kid');
    const other = await addDevice('windows', 'pc', 'Ben on PC', otherFamilyId, k2.id);
    otherFamilyDeviceId = other.id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. Criterion 1: request -> 202, row updated, one hub message to the device, no FCM for a PC.
  it('requests a Windows update and tells that device only', async () => {
    // First report the current code via the check route (this is how app_version_code is stored).
    await checkPc(130, '0.1.130');
    publishWindows(131, '0.1.131');

    const res = await requestUpdate(pc.id);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ versionName: '0.1.131', requestedAt: '2026-11-21T10:00:00.000Z' });

    const [row] = await db.select().from(devices).where(eq(devices.id, pc.id));
    expect(row?.updateRequestedCode).toBe(131);
    expect(row?.updateRequestedAt).toEqual(new Date('2026-11-21T10:00:00.000Z'));

    // Exactly one hub message, to that device only, with type 'app_update'.
    expect(hubSent).toHaveLength(1);
    expect(hubSent[0]?.ids).toEqual([pc.id]);
    expect(hubSent[0]?.msg.type).toBe('app_update');
    // No FCM push for a PC.
    expect(sent).toHaveLength(0);
  });

  // 2. Criterion 2: nothing newer -> 409 no_update, nothing stored, nothing sent.
  it('returns 409 when nothing newer is offered', async () => {
    await checkPc(131, '0.1.131');
    publishWindows(131, '0.1.131');

    const before = await db.select().from(devices).where(eq(devices.id, pc.id));
    const res = await requestUpdate(pc.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details?.code).toBe('no_update');

    const after = await db.select().from(devices).where(eq(devices.id, pc.id));
    expect(after[0]?.updateRequestedAt).toBeNull();
    expect(after[0]?.updateRequestedCode).toBeNull();
    expect(hubSent).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  // 3. Criterion 3: deviceIds in the release must be honoured by the shared function.
  it('honours deviceIds from the shared offer function', async () => {
    await checkPc(130, '0.1.130');
    const other = randomUUID();
    publishWindows(131, '0.1.131', { deviceIds: [other] });
    expect((await requestUpdate(pc.id)).status).toBe(409);

    publishWindows(131, '0.1.131', { deviceIds: [pc.id] });
    const res = await requestUpdate(pc.id);
    expect(res.status).toBe(202);
  });

  // 4. Criterion 4: revoked device -> 404; other family -> 404; kid device token -> 401.
  it('refuses revoked, other-family, and device-token callers', async () => {
    publishWindows(131, '0.1.131');
    await checkPc(130, '0.1.130');

    // Revoked device:
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, pc.id));
    expect((await requestUpdate(pc.id)).status).toBe(404);
    await db.update(devices).set({ revokedAt: null }).where(eq(devices.id, pc.id));

    // Other family's device:
    expect((await requestUpdate(otherFamilyDeviceId)).status).toBe(404);

    // Kid device token on a route that needs a parent:
    expect((await api.post(`/v1/devices/${pc.id}/app-update`, pc.token)).status).toBe(401);
  });

  // 5. Criterion 5: snapshot appUpdate tracks the request, clears when the device reaches the code.
  it('snapshot shows appUpdate then clears when the device reports the requested code', async () => {
    await checkPc(130, '0.1.130');
    publishWindows(131, '0.1.131');
    await requestUpdate(pc.id);

    let snap = await app.request('/v1/device/state', { headers: { authorization: `Bearer ${pc.token}` } });
    let body = JSON.parse(await snap.text());
    expect(body.appUpdate).toEqual({ versionCode: 131, requestedAt: '2026-11-21T10:00:00.000Z' });

    // Device reports 131 -> snapshot null.
    await checkPc(131, '0.1.131');
    snap = await app.request('/v1/device/state', { headers: { authorization: `Bearer ${pc.token}` } });
    body = JSON.parse(await snap.text());
    expect(body.appUpdate).toBeNull();

    // Device reports 130 again -> snapshot shows the request again.
    await checkPc(130, '0.1.130');
    snap = await app.request('/v1/device/state', { headers: { authorization: `Bearer ${pc.token}` } });
    body = JSON.parse(await snap.text());
    expect(body.appUpdate).toEqual({ versionCode: 131, requestedAt: '2026-11-21T10:00:00.000Z' });
  });

  // 6. Criterion 6: GET /v1/devices appUpdate field moves through its states.
  it('GET /v1/devices shows appUpdate null, available, requested, then null again', async () => {
    const list = async () => (await api.get('/v1/devices', parentToken)).body;

    // No offer yet -> null.
    expect((await list()).find((d: { id: string }) => d.id === pc.id).appUpdate).toBeNull();

    publishWindows(131, '0.1.131');
    await checkPc(130, '0.1.130');

    // Offer present, not requested -> available.
    const avail = (await list()).find((d: { id: string }) => d.id === pc.id);
    expect(avail.appUpdate).toEqual({ versionName: '0.1.131', state: 'available', requestedAt: null });

    await requestUpdate(pc.id);
    // After request -> requested with requestedAt.
    const req = (await list()).find((d: { id: string }) => d.id === pc.id);
    expect(req.appUpdate).toEqual({ versionName: '0.1.131', state: 'requested', requestedAt: '2026-11-21T10:00:00.000Z' });

    await checkPc(131, '0.1.131');
    // After device reports 131 -> null.
    const after = (await list()).find((d: { id: string }) => d.id === pc.id);
    expect(after.appUpdate).toBeNull();
  });

  // 7. Criterion 7: second request replaces the first.
  it('a second request replaces requestedAt', async () => {
    await checkPc(130, '0.1.130');
    publishWindows(131, '0.1.131');
    expect((await requestUpdate(pc.id)).status).toBe(202);

    vi.setSystemTime(new Date('2026-11-21T10:30:00Z'));
    // The original token was signed at 10:00 and expires at 10:15, so re-sign.
    const fresh = await tokenFor({ parentId, familyId });
    const res = await api.post(`/v1/devices/${pc.id}/app-update`, fresh);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ versionName: '0.1.131', requestedAt: '2026-11-21T10:30:00.000Z' });

    const [row] = await db.select().from(devices).where(eq(devices.id, pc.id));
    expect(row?.updateRequestedAt).toEqual(new Date('2026-11-21T10:30:00.000Z'));
    expect(row?.updateRequestedCode).toBe(131);
  });

  // 8. Criterion 8: Android phone with kid.json 901 offered to 900.
  it('requests an Android update and FCM-pushes that device only', async () => {
    await checkPhone(900, '0.9.0');
    publishKid(901, '0.9.1');

    const res = await requestUpdate(phone.id);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ versionName: '0.9.1', requestedAt: '2026-11-21T10:00:00.000Z' });

    // FCM push went to the phone's fcmToken (we have none by default, so give it one).
    await db.update(devices).set({ fcmToken: 'phone-fcm' }).where(eq(devices.id, phone.id));
    sent.length = 0;
    hubSent.length = 0;
    await requestUpdate(phone.id);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.token).toBe('phone-fcm');
    expect(sent[0]?.msg.type).toBe('app_update');
    expect(hubSent).toHaveLength(1);
    expect(hubSent[0]?.ids).toEqual([phone.id]);

    // Snapshot shows it.
    const snap = await app.request('/v1/device/state', { headers: { authorization: `Bearer ${phone.token}` } });
    const body = JSON.parse(await snap.text());
    expect(body.appUpdate).toEqual({ versionCode: 901, requestedAt: '2026-11-21T10:00:00.000Z' });

    // After the phone reports 901, snapshot null.
    await checkPhone(901, '0.9.1');
    const snap2 = await app.request('/v1/device/state', { headers: { authorization: `Bearer ${phone.token}` } });
    const body2 = JSON.parse(await snap2.text());
    expect(body2.appUpdate).toBeNull();
  });

  // 8b. A device that never reported a version code -> POST gives 409, GET shows null.
  it('a device that never reported a version code gets null and 409', async () => {
    // Insert a fresh device with no app_version_code and do NOT call check.
    const token = newDeviceToken();
    const [d] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: 'windows',
        form: 'pc',
        pool: 'screens',
        name: 'New PC',
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!d) throw new Error('no device');

    publishWindows(131, '0.1.131');

    const res = await requestUpdate(d.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details?.code).toBe('no_update');

    // Nothing stored, nothing sent.
    const [row] = await db.select().from(devices).where(eq(devices.id, d.id));
    expect(row?.updateRequestedAt).toBeNull();
    expect(row?.updateRequestedCode).toBeNull();
    expect(hubSent).toHaveLength(0);

    const list = (await api.get('/v1/devices', parentToken)).body;
    const shown = list.find((x: { id: string }) => x.id === d.id);
    // Offer is null because currentCode is null; so appUpdate is null.
    expect(shown.appUpdate).toBeNull();

    // After its first check reports 130 against the 131 offer -> becomes available.
    await api.post('/v1/device/app-update/check', token, { versionCode: 130, versionName: '0.1.130' });
    const list2 = (await api.get('/v1/devices', parentToken)).body;
    const shown2 = list2.find((x: { id: string }) => x.id === d.id);
    expect(shown2.appUpdate).toEqual({ versionName: '0.1.131', state: 'available', requestedAt: null });
  });

  // Extra: the check route stores the version code (part of 8b/fixture).
  it('the check route stores the app version code', async () => {
    await checkPc(130, '0.1.130');
    const [row] = await db.select().from(devices).where(eq(devices.id, pc.id));
    expect(row?.appVersionCode).toBe(130);
  });
});
