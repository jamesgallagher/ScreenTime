import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { devices, events, families, grants, kids, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** A fixed-offset zone where it is about midday right now, so the test times never cross local midnight. */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

const zone = middayZone();
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
/** Now plus `m` minutes, as ISO 8601. */
const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** Every day the same, with no curfew, so the result does not depend on the weekday or the hour. */
const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

describe.skipIf(!url)('grant routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const api = client({ db, config: testConfig(url ?? ''), mailer });

  let familyA = '';
  let familyB = '';
  let mumId = '';
  let mum = '';
  let dad = '';
  let bea = '';

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addTablet(familyId: string, kidId: string) {
    const token = newDeviceToken();
    await db.insert(devices).values({
      familyId,
      kidId,
      platform: 'android',
      form: 'tablet',
      pool: 'screens',
      name: 'Tablet',
      tokenHash: hashDeviceToken(token),
    });
    return token;
  }

  /** The kid's pool on the dashboard. */
  async function poolToday(kidId: string, which: 'screens' | 'phone') {
    const res = await api.get('/v1/today', mum);
    const kid = res.body.kids.find((k: { id: string }) => k.id === kidId);
    return kid.pools.find((p: { pool: string }) => p.pool === which);
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: zone, parentCodeSecret: 'A'.repeat(32) },
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
    mumId = p1?.id ?? '';
    mum = await tokenFor({ parentId: mumId, familyId: familyA });
    dad = await tokenFor({ parentId: p2?.id ?? '', familyId: familyA });
    bea = await tokenFor({ parentId: p3?.id ?? '', familyId: familyB });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /v1/kids/{kidId}/grants', () => {
    it('adds time for today, records the event and shows on the dashboard', async () => {
      const kidId = await addKid(familyA, 'Alex');
      const id = randomUUID();
      const res = await api.post(`/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 15, note: ' Homework done ' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id,
        pool: 'screens',
        minutes: 15,
        day: localDate(),
        createdAt: expect.any(String),
        byName: 'Mum',
        note: 'Homework done',
        requestId: null,
      });
      const [event] = await db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'grant.added')));
      expect(event?.payload).toEqual({ grantId: id, pool: 'screens', minutes: 15, byName: 'Mum', lockNow: false });
      expect(await poolToday(kidId, 'screens')).toMatchObject({ grantedMin: 15, remainingSec: (120 + 15) * 60 });
    });

    it('removes time with a negative grant', async () => {
      const kidId = await addKid(familyA, 'Blake');
      const res = await api.post(`/v1/kids/${kidId}/grants`, dad, { id: randomUUID(), pool: 'phone', minutes: -45 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ pool: 'phone', minutes: -45, byName: 'Dad', note: null });
      expect(await poolToday(kidId, 'phone')).toMatchObject({ grantedMin: -45, remainingSec: 15 * 60, locked: false });
    });

    it('returns the stored grant when the same id is sent again, and refuses an id used elsewhere', async () => {
      const kidId = await addKid(familyA, 'Casey');
      const otherKid = await addKid(familyA, 'Other');
      const id = randomUUID();
      const first = await api.post(`/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 30 });
      const again = await api.post(`/v1/kids/${kidId}/grants`, dad, { id, pool: 'phone', minutes: 60 });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect(await db.select().from(grants).where(eq(grants.kidId, kidId))).toHaveLength(1);
      expect(await db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'grant.added')))).toHaveLength(1);

      const elsewhere = await api.post(`/v1/kids/${otherKid}/grants`, mum, { id, pool: 'screens', minutes: 30 });
      expect(elsewhere.status).toBe(409);
      expect(elsewhere.body.error.message).toBe('That grant id is already used.');
      const ben = await addKid(familyB, 'Ben');
      expect((await api.post(`/v1/kids/${ben}/grants`, bea, { id, pool: 'screens', minutes: 30 })).status).toBe(409);
    });

    it('needs a parent of the family, a known kid and roller minutes', async () => {
      const kidId = await addKid(familyA, 'Drew');
      const body = { id: randomUUID(), pool: 'screens', minutes: 15 };
      expect((await api.post(`/v1/kids/${kidId}/grants`, null, body)).status).toBe(401);
      const admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
      expect((await api.post(`/v1/kids/${kidId}/grants`, admin, body)).status).toBe(403);
      expect((await api.post(`/v1/kids/${kidId}/grants`, bea, body)).status).toBe(404);
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { ...body, minutes: 0 })).status).toBe(422);
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { ...body, minutes: 10 })).status).toBe(422);
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, { ...body, pool: 'tv' })).status).toBe(422);
      await db.update(kids).set({ archivedAt: new Date() }).where(eq(kids.id, kidId));
      expect((await api.post(`/v1/kids/${kidId}/grants`, mum, body)).status).toBe(404);
    });
  });

  describe('GET /v1/kids/{kidId}/grants', () => {
    it("lists today's grants of both pools by default, or another day's", async () => {
      const kidId = await addKid(familyA, 'Eli');
      await api.post(`/v1/kids/${kidId}/grants`, mum, { id: randomUUID(), pool: 'screens', minutes: 15 });
      await api.post(`/v1/kids/${kidId}/grants`, dad, { id: randomUUID(), pool: 'phone', minutes: -15 });
      await db.insert(grants).values({ id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 60, day: '2020-01-01', createdBy: mumId });

      const today = await api.get(`/v1/kids/${kidId}/grants`, mum);
      expect(today.status).toBe(200);
      expect(today.body.map((g: { minutes: number; byName: string }) => [g.minutes, g.byName])).toEqual([
        [15, 'Mum'],
        [-15, 'Dad'],
      ]);
      const old = await api.get(`/v1/kids/${kidId}/grants?day=2020-01-01`, mum);
      expect(old.body.map((g: { minutes: number }) => g.minutes)).toEqual([60]);
      expect((await api.get(`/v1/kids/${kidId}/grants?day=1st-jan`, mum)).status).toBe(422);
      expect((await api.get(`/v1/kids/${kidId}/grants`, bea)).status).toBe(404);
    });
  });

  describe('POST /v1/kids/{kidId}/lock-now', () => {
    it('takes away the time left, rounded up to a minute, so the pool locks at once', async () => {
      const kidId = await addKid(familyA, 'Finn');
      const tablet = await addTablet(familyA, kidId);
      // 10.5 minutes used so far and still in use: 120 - 10.5 = 109.5 minutes left, rounded up to 110.
      await api.post('/v1/device/usage', tablet, {
        segments: [{ id: randomUUID(), startedAt: at(-10.5), endedAt: null, recordedOffline: false }],
      });
      const id = randomUUID();
      const res = await api.post(`/v1/kids/${kidId}/lock-now`, mum, { id, pool: 'screens' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id, pool: 'screens', minutes: -110, byName: 'Mum', note: 'Lock now' });
      expect(await poolToday(kidId, 'screens')).toMatchObject({ locked: true, lockReason: 'out_of_time', remainingSec: 0 });
      expect(await poolToday(kidId, 'phone')).toMatchObject({ locked: false, grantedMin: 0 });
      const [event] = await db.select().from(events).where(and(eq(events.kidId, kidId), eq(events.kind, 'grant.added')));
      expect(event?.payload).toMatchObject({ grantId: id, minutes: -110, lockNow: true });

      // The same request again is answered from the record; a new one finds the pool locked.
      expect((await api.post(`/v1/kids/${kidId}/lock-now`, mum, { id, pool: 'screens' })).status).toBe(200);
      const twice = await api.post(`/v1/kids/${kidId}/lock-now`, dad, { id: randomUUID(), pool: 'screens' });
      expect(twice.status).toBe(409);
      expect(twice.body.error.message).toBe('Screens is already locked.');
    });

    it('locks a pool with no use yet by taking the whole allowance', async () => {
      const kidId = await addKid(familyA, 'Gus');
      const res = await api.post(`/v1/kids/${kidId}/lock-now`, mum, { id: randomUUID(), pool: 'phone' });
      expect(res.body.minutes).toBe(-60);
      expect(await poolToday(kidId, 'phone')).toMatchObject({ locked: true, remainingSec: 0, grantedMin: -60 });
    });

    it('needs a parent of the family and a known kid', async () => {
      const kidId = await addKid(familyA, 'Hana');
      const body = { id: randomUUID(), pool: 'screens' };
      expect((await api.post(`/v1/kids/${kidId}/lock-now`, null, body)).status).toBe(401);
      expect((await api.post(`/v1/kids/${kidId}/lock-now`, bea, body)).status).toBe(404);
      expect((await api.post(`/v1/kids/${kidId}/lock-now`, mum, { ...body, pool: 'tv' })).status).toBe(422);
    });
  });
});
