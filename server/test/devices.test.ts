import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { devices, enrolmentCodes, events, families, kids, parents } from '../src/db/schema.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const phone = { platform: 'android', hasCellular: true, model: 'Pixel 7', osVersion: 'Android 14', appVersion: '0.1.0' };
const pc = {
  platform: 'windows',
  hasCellular: false,
  model: 'Dell XPS 13',
  osVersion: 'Windows 11 Pro',
  appVersion: '0.1.0',
  machineId: 'machine-guid-1',
  windowsUserSid: 'S-1-5-21-1-2-3-1001',
  windowsUserName: 'alex',
};

describe.skipIf(!url)('device routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const deps = { db, config: testConfig(url ?? ''), mailer };
  // A new app for each test, so the per-IP enrolment limit starts again.
  let api = client(deps);

  let familyA = '';
  let familyB = '';
  let mum = '';
  let bea = '';
  let alex = '';
  let ben = '';

  /** A fresh code for a kid, made by a parent. */
  async function code(token: string, kidId: string, form: string) {
    const res = await api.post(`/v1/kids/${kidId}/enrolment-codes`, token, { form });
    expect(res.status).toBe(201);
    return res.body.code as string;
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
    familyB = b?.id ?? '';
    const [p1, p2] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyB, email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mum = await tokenFor({ parentId: p1?.id ?? '', familyId: familyA });
    bea = await tokenFor({ parentId: p2?.id ?? '', familyId: familyB });
    const [k1, k2] = await db
      .insert(kids)
      .values([
        { familyId: familyA, name: 'Alex', avatarColor: '#0F766E' },
        { familyId: familyB, name: 'Ben', avatarColor: '#2563EB' },
      ])
      .returning();
    alex = k1?.id ?? '';
    ben = k2?.id ?? '';
  });

  beforeEach(() => {
    api = client(deps);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('enrolment codes', () => {
    it('makes a 6-digit code with a QR payload, valid for 10 minutes', async () => {
      const res = await api.post(`/v1/kids/${alex}/enrolment-codes`, mum, { form: 'phone' });
      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(/^[0-9]{6}$/);
      expect(res.body.qrPayload).toBe(`screentime://enrol?host=localhost&code=${res.body.code}`);
      const minutes = (Date.parse(res.body.expiresAt) - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(9);
      expect(minutes).toBeLessThanOrEqual(10);
    });

    it("needs a parent, a known form, and a kid of the caller's family", async () => {
      expect((await api.post(`/v1/kids/${alex}/enrolment-codes`, null, { form: 'phone' })).status).toBe(401);
      expect((await api.post(`/v1/kids/${alex}/enrolment-codes`, mum, { form: 'tv' })).status).toBe(422);
      expect((await api.post(`/v1/kids/${ben}/enrolment-codes`, mum, { form: 'phone' })).status).toBe(404);
    });
  });

  describe('POST /v1/enrol', () => {
    it('enrols a phone once, records the event and lists the device', async () => {
      const c = await code(mum, alex, 'phone');
      const res = await api.post('/v1/enrol', null, { code: c, ...phone });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        deviceId: expect.any(String),
        deviceToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        kid: { id: alex, name: 'Alex' },
        family: { name: 'Family A', timezone: 'Australia/Sydney' },
      });
      const [used] = await db.select().from(enrolmentCodes).where(eq(enrolmentCodes.code, c));
      expect(used?.consumedAt).toBeInstanceOf(Date);
      expect(used?.deviceId).toBe(res.body.deviceId);
      const [event] = await db.select().from(events).where(eq(events.deviceId, res.body.deviceId));
      expect(event).toMatchObject({ kind: 'device.enrolled', kidId: alex, payload: { name: 'Pixel 7', form: 'phone' } });

      const again = await api.post('/v1/enrol', null, { code: c, ...phone });
      expect(again.status).toBe(401);
      expect(again.body.error.message).toBe('That code is wrong or has expired. Ask a parent for a new one.');

      const listed = (await api.get('/v1/devices', mum)).body;
      expect(listed).toEqual([
        expect.objectContaining({ id: res.body.deviceId, kidId: alex, form: 'phone', pool: 'phone', name: 'Pixel 7' }),
      ]);
      expect(listed[0].lastSeenAt).not.toBeNull();
      expect((await api.get('/v1/devices', bea)).body).toEqual([]);
    });

    it('refuses an expired code', async () => {
      const c = await code(mum, alex, 'tablet');
      await db.execute(sql`update enrolment_codes set expires_at = now() - interval '1 second' where code = ${c}`);
      expect((await api.post('/v1/enrol', null, { code: c, ...phone })).status).toBe(401);
    });

    it('refuses a code made for another kind of device, and keeps the code', async () => {
      const c = await code(mum, alex, 'pc');
      const wrong = await api.post('/v1/enrol', null, { code: c, ...phone });
      expect(wrong.status).toBe(409);
      expect(wrong.body.error.message).toBe('This code is for a Windows PC.');
      const right = await api.post('/v1/enrol', null, { code: c, ...pc });
      expect(right.status).toBe(201);
      const [row] = await db.select().from(devices).where(eq(devices.id, right.body.deviceId));
      expect(row).toMatchObject({ form: 'pc', pool: 'screens', name: 'alex on Dell XPS 13', windowsUserSid: pc.windowsUserSid });
    });

    it('replaces the old device when the same PC account enrols again', async () => {
      const before = (await api.get('/v1/devices', mum)).body.filter((d: { form: string }) => d.form === 'pc');
      expect(before).toHaveLength(1);
      const res = await api.post('/v1/enrol', null, { code: await code(mum, alex, 'pc'), ...pc });
      expect(res.status).toBe(201);
      const after = (await api.get('/v1/devices', mum)).body.filter((d: { form: string }) => d.form === 'pc');
      expect(after.map((d: { id: string }) => d.id)).toEqual([res.body.deviceId]);
    });

    it('limits attempts per IP', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await api.post('/v1/enrol', null, { code: '000000', ...phone })).status).toBe(401);
      }
      expect((await api.post('/v1/enrol', null, { code: '000000', ...phone })).status).toBe(429);
    });
  });

  describe('device token', () => {
    it('identifies the device on GET /v1/device/me', async () => {
      const { deviceToken, deviceId } = (await api.post('/v1/enrol', null, { code: await code(mum, alex, 'phone'), ...phone }))
        .body;
      const res = await api.get('/v1/device/me', deviceToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        device: { id: deviceId, name: 'Pixel 7', form: 'phone', pool: 'phone', hasCellular: true },
        kid: { id: alex, name: 'Alex' },
        family: { timezone: 'Australia/Sydney', emergencyNumber: '000' },
      });
      expect((await api.get('/v1/device/me', null)).status).toBe(401);
      expect((await api.get('/v1/device/me', 'not-a-token')).status).toBe(401);
      expect((await api.get('/v1/device/me', mum)).status).toBe(401);
    });
  });

  describe('managing devices', () => {
    it("renames a device and moves its pool, but not another family's", async () => {
      const { deviceId } = (await api.post('/v1/enrol', null, { code: await code(mum, alex, 'tablet'), ...phone })).body;
      const res = await api.patch(`/v1/devices/${deviceId}`, mum, { name: ' Drawing pad ', pool: 'phone' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: deviceId, name: 'Drawing pad', form: 'tablet', pool: 'phone' });
      expect((await api.patch(`/v1/devices/${deviceId}`, mum, {})).body).toEqual(res.body);
      expect((await api.patch(`/v1/devices/${deviceId}`, bea, { name: 'Mine' })).status).toBe(404);
    });

    it('revokes a device: its token stops working at once', async () => {
      const { deviceToken, deviceId } = (await api.post('/v1/enrol', null, { code: await code(mum, alex, 'phone'), ...phone }))
        .body;
      expect((await api.del(`/v1/devices/${deviceId}`, bea)).status).toBe(404);
      expect((await api.del(`/v1/devices/${deviceId}`, mum)).status).toBe(204);
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(401);
      expect((await api.get('/v1/devices', mum)).body.map((d: { id: string }) => d.id)).not.toContain(deviceId);
      expect((await api.del(`/v1/devices/${deviceId}`, mum)).status).toBe(404);
      expect((await api.patch(`/v1/devices/${deviceId}`, mum, { name: 'Back' })).status).toBe(404);
    });

    it("revokes a kid's devices when the kid is archived", async () => {
      const [sam] = await db.insert(kids).values({ familyId: familyA, name: 'Sam', avatarColor: '#7C3AED' }).returning();
      const samId = sam?.id ?? '';
      const { deviceToken } = (await api.post('/v1/enrol', null, { code: await code(mum, samId, 'phone'), ...phone })).body;
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(200);
      expect((await api.del(`/v1/kids/${samId}`, mum)).status).toBe(204);
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(401);
      const rows = await db.select().from(devices).where(eq(devices.kidId, samId));
      expect(rows.every((d) => d.revokedAt instanceof Date)).toBe(true);
    });

    it('refuses the devices of a disabled family', async () => {
      const { deviceToken } = (await api.post('/v1/enrol', null, { code: await code(bea, ben, 'phone'), ...phone })).body;
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(200);
      await db.execute(sql`update families set disabled_at = now() where id = ${familyB}`);
      expect((await api.get('/v1/device/me', deviceToken)).status).toBe(401);
    });
  });
});
