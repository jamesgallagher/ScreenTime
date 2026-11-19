import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { devices, families, grants, kids, parents, scheduleVersions, timeRequests } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('shared devices', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const deps = { db, config: testConfig(url ?? ''), mailer };
  let api = client(deps);
  const app = createApp(deps);

  let familyId = '';
  let mum = '';
  let mumId = '';

  async function addKid(name: string, kind: 'kid' | 'shared' = 'kid', avatarColor = '#0F766E') {
    const res = await api.post('/v1/kids', mum, { name, avatarColor, ...(kind === 'shared' ? { kind } : {}) });
    expect(res.status).toBe(201);
    return res.body as { id: string; name: string; avatarColor: string; kind: string };
  }

  async function addDevice(kidId: string, form: 'phone' | 'tablet' | 'pc', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: form === 'pc' ? 'windows' : 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        hasCellular: form === 'phone',
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function getState(token: string) {
    const res = await app.request('/v1/device/state', { headers: { authorization: `Bearer ${token}` } });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [fam] = await db.insert(families).values({ name: 'Family A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    familyId = fam?.id ?? '';
    const [p1] = await db.insert(parents).values({ familyId, email: 'mum@example.com', displayName: 'Mum' }).returning();
    mumId = p1?.id ?? '';
    mum = await tokenFor({ parentId: mumId, familyId });
  });

  afterAll(async () => {
    await pool.end();
  });

  // Criterion 1: existing kids read kind "kid"
  it('existing kids read kind kid from GET /v1/kids', async () => {
    const res = await api.get('/v1/kids', mum);
    expect(res.status).toBe(200);
    for (const kid of res.body as { kind: string }[]) {
      expect(kid.kind).toBe('kid');
    }
  });

  // Criterion 2: POST /v1/kids with kind shared
  it('creates a shared device with kind shared, newAppApproval true, and 0-minute schedule', async () => {
    const res = await api.post('/v1/kids', mum, { name: 'Mum\'s tablet', avatarColor: '#7C3AED', kind: 'shared' });
    expect(res.status).toBe(201);
    const kid = res.body as { id: string; kind: string };
    expect(kid.kind).toBe('shared');

    // Check newAppApproval
    const [row] = await db.select().from(kids).where(eq(kids.id, kid.id));
    expect(row?.newAppApproval).toBe(true);

    // Check schedule: 0 minutes every day
    const [schedule] = await db.select().from(scheduleVersions).where(eq(scheduleVersions.kidId, kid.id));
    expect(schedule?.version).toBe(1);
    expect(schedule?.warn1Min).toBe(15);
    expect(schedule?.warn2Min).toBe(5);
    for (const day of schedule?.days as { screensMin: number; phoneMin: number }[]) {
      expect(day.screensMin).toBe(0);
      expect(day.phoneMin).toBe(0);
    }
  });

  // Criterion 2 continued: schedule wake/bedtime from other kids
  it('shared device schedule takes latest wake and earliest bedtime from other kids', async () => {
    // Two kids with Monday wakes 07:00 and 07:30, bedtimes 20:30 and 20:00
    const kid1 = await addKid('Alex');
    const kid2 = await addKid('Sam');
    await db.update(scheduleVersions).set({
      days: [1, 2, 3, 4, 5, 6, 7].map((w) => ({
        weekday: w,
        screensMin: 120,
        phoneMin: 60,
        wake: w === 1 ? '07:00' : '07:00',
        bedtime: w === 1 ? '20:30' : '20:30',
      })),
    }).where(eq(scheduleVersions.kidId, kid1.id));
    await db.update(scheduleVersions).set({
      days: [1, 2, 3, 4, 5, 6, 7].map((w) => ({
        weekday: w,
        screensMin: 120,
        phoneMin: 60,
        wake: w === 1 ? '07:30' : '07:00',
        bedtime: w === 1 ? '20:00' : '20:30',
      })),
    }).where(eq(scheduleVersions.kidId, kid2.id));

    const res = await api.post('/v1/kids', mum, { name: 'Shared 2', avatarColor: '#DB2777', kind: 'shared' });
    expect(res.status).toBe(201);
    const [schedule] = await db.select().from(scheduleVersions).where(eq(scheduleVersions.kidId, res.body.id));
    const mon = (schedule?.days as { weekday: number; wake: string; bedtime: string }[]).find((d) => d.weekday === 1);
    expect(mon?.wake).toBe('07:30'); // latest
    expect(mon?.bedtime).toBe('20:00'); // earliest
  });

  // Criterion 2 continued: no other kids → 07:00 and 20:00
  it('shared device with no other kids gets 07:00 and 20:00', async () => {
    // Use a new family with no kids
    const [fam2] = await db.insert(families).values({ name: 'Family B', timezone: 'Australia/Sydney', parentCodeSecret: 'B'.repeat(32) }).returning();
    const [p2] = await db.insert(parents).values({ familyId: fam2?.id ?? '', email: 'dad@example.com', displayName: 'Dad' }).returning();
    const dad = await tokenFor({ parentId: p2?.id ?? '', familyId: fam2?.id ?? '' });
    const res = await api.post('/v1/kids', dad, { name: 'Lone shared', avatarColor: '#2563EB', kind: 'shared' });
    expect(res.status).toBe(201);
    const [schedule] = await db.select().from(scheduleVersions).where(eq(scheduleVersions.kidId, res.body.id));
    for (const day of schedule?.days as { wake: string; bedtime: string }[]) {
      expect(day.wake).toBe('07:00');
      expect(day.bedtime).toBe('20:00');
    }
  });

  // Criterion 3: POST without kind → kid
  it('creates a kid without kind as kind kid with the usual default schedule', async () => {
    const res = await api.post('/v1/kids', mum, { name: 'NoKind', avatarColor: '#EA580C' });
    expect(res.status).toBe(201);
    const kid = res.body as { kind: string };
    expect(kid.kind).toBe('kid');
    const [row] = await db.select().from(kids).where(eq(kids.id, res.body.id));
    expect(row?.newAppApproval).toBe(false);
  });

  // Criterion 4: PATCH with kind does not change the kind
  it('PATCH with kind does not change the kind', async () => {
    const res = await api.post('/v1/kids', mum, { name: 'Patchable', avatarColor: '#16A34A', kind: 'shared' });
    expect(res.status).toBe(201);
    const kidId = res.body.id as string;
    const patch = await api.patch(`/v1/kids/${kidId}`, mum, { name: 'Renamed', kind: 'kid' });
    expect(patch.status).toBe(200);
    const [row] = await db.select().from(kids).where(eq(kids.id, kidId));
    expect(row?.kind).toBe('shared');
    expect(row?.name).toBe('Renamed');
  });

  // Criterion 5: one device at most
  it('refuses a second enrolment code for a shared device with an active device', async () => {
    const shared = await addKid('One Device', 'shared');
    const device1 = await addDevice(shared.id, 'tablet', 'Tablet 1');
    const res = await api.post(`/v1/kids/${shared.id}/enrolment-codes`, mum, { form: 'tablet' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.details).toEqual({ code: 'shared_has_device' });
    expect(res.body.error.message).toBe('This shared device already has a device. Remove it first.');

    // After revoking, a new code works
    await api.del(`/v1/devices/${device1.id}`, mum);
    const res2 = await api.post(`/v1/kids/${shared.id}/enrolment-codes`, mum, { form: 'tablet' });
    expect(res2.status).toBe(201);
  });

  // Criterion 6: phone enrolled into a shared one has pool screens
  it('a phone enrolled into a shared device has pool screens', async () => {
    const shared = await addKid('Phone Shared', 'shared');
    const res = await api.post(`/v1/kids/${shared.id}/enrolment-codes`, mum, { form: 'phone' });
    expect(res.status).toBe(201);
    const code = res.body.code as string;
    const enrol = await api.post('/v1/enrol', null, { code, platform: 'android', hasCellular: true, model: 'Pixel 7', osVersion: 'Android 14', appVersion: '0.1.0' });
    expect(enrol.status).toBe(201);
    const [device] = await db.select().from(devices).where(eq(devices.id, enrol.body.deviceId));
    expect(device?.pool).toBe('screens');
  });

  // Criterion 7: GET /v1/today shows shared with one pool
  it('GET /v1/today shows a shared device with kind shared and one screens pool', async () => {
    const shared = await addKid('Today Shared', 'shared');
    const res = await api.get('/v1/today', mum);
    expect(res.status).toBe(200);
    const kid = (res.body.kids as { id: string; kind: string; pools: { pool: string }[] }[]).find((k) => k.id === shared.id);
    expect(kid?.kind).toBe('shared');
    expect(kid?.pools).toHaveLength(1);
    expect(kid?.pools[0].pool).toBe('screens');

    // A regular kid has both pools
    const kidRow = (res.body.kids as { kind: string; pools: { pool: string }[] }[]).find((k) => k.kind === 'kid');
    expect(kidRow?.pools.map((p) => p.pool)).toEqual(['screens', 'phone']);
  });

  // Criterion 8: contacts
  it('GET contacts for a shared device returns empty, PUT returns 409 shared_device', async () => {
    const shared = await addKid('No Contacts', 'shared');
    const get = await api.get(`/v1/kids/${shared.id}/contacts`, mum);
    expect(get.status).toBe(200);
    expect(get.body).toEqual([]);

    const put = await api.put(`/v1/kids/${shared.id}/contacts`, mum, { contacts: [{ label: 'Grandma', phoneE164: '+61400000001' }] });
    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe('conflict');
    expect(put.body.error.details).toEqual({ code: 'shared_device' });
    expect(put.body.error.message).toBe('A shared device has no contacts.');
  });

  it('snapshot for a shared device has contacts empty and kid.kind shared', async () => {
    const shared = await addKid('Snapshot Shared', 'shared');
    const device = await addDevice(shared.id, 'tablet', 'Tab');
    const res = await getState(device.token);
    expect(res.status).toBe(200);
    expect(res.body.kid.kind).toBe('shared');
    expect(res.body.contacts).toEqual([]);
  });

  // Criterion 9: grant, time request, lock now, app rule, bedtime tonight
  it('a grant works for a shared device', async () => {
    const shared = await addKid('Grant Shared', 'shared');
    const res = await api.post(`/v1/kids/${shared.id}/grants`, mum, { id: randomUUID(), pool: 'screens', minutes: 15 });
    expect(res.status).toBe(201);
    const [grant] = await db.select().from(grants).where(eq(grants.kidId, shared.id));
    expect(grant?.minutes).toBe(15);
  });

  it('a time request and its approval work for a shared device', async () => {
    const shared = await addKid('Request Shared', 'shared');
    const device = await addDevice(shared.id, 'phone', 'Phone');
    const res = await api.post('/v1/device/time-requests', device.token, { id: randomUUID(), minutes: 30, reason: 'Need more' });
    expect(res.status).toBe(201);
    const [req] = await db.select().from(timeRequests).where(eq(timeRequests.kidId, shared.id));
    expect(req?.minutes).toBe(30);
    expect(req?.status).toBe('pending');

    const approve = await api.post(`/v1/requests/${req.id}/approve`, mum, { approved: true });
    expect(approve.status).toBe(200);
    const [updated] = await db.select().from(timeRequests).where(eq(timeRequests.id, req.id));
    expect(updated?.status).toBe('approved');
  });

  it('lock now works for a shared device', async () => {
    const shared = await addKid('Lock Shared', 'shared');
    // Grant 30 minutes first so the pool is not already locked
    await api.post(`/v1/kids/${shared.id}/grants`, mum, { id: randomUUID(), pool: 'screens', minutes: 30 });
    const res = await api.post(`/v1/kids/${shared.id}/lock-now`, mum, { id: randomUUID(), pool: 'screens' });
    expect(res.status).toBe(201);
    const [grant] = await db.select().from(grants).where(eq(grants.id, res.body.id));
    expect(grant?.minutes).toBeLessThan(0);
  });

  it('an app rule works for a shared device', async () => {
    const shared = await addKid('Rule Shared', 'shared');
    const tablet = await addDevice(shared.id, 'tablet', 'Tab');
    const list = await api.put('/v1/device/apps', tablet.token, {
      apps: [
        {
          package: 'com.android.vending',
          label: 'Play Store',
          source: 'preinstalled',
          installer: null,
          blockable: true,
          installedAt: '2026-11-01T00:00:00Z',
          firstUsedAt: null,
        },
      ],
    });
    expect(list.status).toBeLessThan(300);
    const res = await api.put(`/v1/kids/${shared.id}/apps/com.android.vending/rule`, mum, { mode: 'blocked', dailyMinutes: null });
    expect(res.status).toBe(200);
    const apps = await api.get(`/v1/kids/${shared.id}/apps`, mum);
    expect(apps.body.newAppApproval).toBe(true);
  });

  it('bedtime tonight works for a shared device', async () => {
    const shared = await addKid('Bedtime Shared', 'shared');
    // Midnight is later than any default bedtime and than now, at any hour of the run.
    const res = await api.put(`/v1/kids/${shared.id}/bedtime-tonight`, mum, { bedtime: '24:00' });
    expect(res.status).toBe(200);
    expect(res.body.tonight).toBe('24:00');
    expect(res.body.extendedBy).toBe('Mum');
  });
});
