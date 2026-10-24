import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { families, kids, parents, scheduleVersions } from '../src/db/schema.js';
import { defaultWeek } from '../src/kids/schedule.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const week = (screensMin: number) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, screensMin, phoneMin: 60, wake: '06:30', bedtime: '21:00' }));

describe.skipIf(!url)('kid routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const api = client({ db, config: testConfig(url ?? ''), mailer });

  let mum = { id: '', token: '' };
  let bea = { id: '', token: '' };
  let beasKid = '';

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    const rows = await db
      .insert(parents)
      .values([
        { familyId: a?.id ?? '', email: 'mum@example.com', displayName: 'Mum' },
        { familyId: b?.id ?? '', email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mum = { id: rows[0]?.id ?? '', token: await tokenFor({ parentId: rows[0]?.id ?? '', familyId: a?.id ?? '' }) };
    bea = { id: rows[1]?.id ?? '', token: await tokenFor({ parentId: rows[1]?.id ?? '', familyId: b?.id ?? '' }) };
    beasKid = (await api.post('/v1/kids', bea.token, { name: 'Ben', avatarColor: '#2563EB' })).body.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('needs a parent of a family', async () => {
    expect((await api.get('/v1/kids', null)).status).toBe(401);
    const admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
    expect((await api.get('/v1/kids', admin)).status).toBe(403);
  });

  describe('kids', () => {
    it('adds a kid with the default schedule', async () => {
      const res = await api.post('/v1/kids', mum.token, { name: ' Alex ', avatarColor: '#0F766E' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.any(String), name: 'Alex', avatarColor: '#0F766E' });
      const [version] = await db.select().from(scheduleVersions).where(eq(scheduleVersions.kidId, res.body.id));
      expect(version).toMatchObject({ version: 1, warn1Min: 15, warn2Min: 5, days: defaultWeek(), createdBy: mum.id });
    });

    it('refuses a colour that is not one of the 8', async () => {
      const res = await api.post('/v1/kids', mum.token, { name: 'Sam', avatarColor: '#FFFFFF' });
      expect(res.status).toBe(422);
    });

    it("lists the family's kids, oldest first", async () => {
      await api.post('/v1/kids', mum.token, { name: 'Sam', avatarColor: '#7C3AED' });
      const res = await api.get('/v1/kids', mum.token);
      expect(res.status).toBe(200);
      expect(res.body.map((k: { name: string }) => k.name)).toEqual(['Alex', 'Sam']);
      expect((await api.get('/v1/kids', bea.token)).body.map((k: { name: string }) => k.name)).toEqual(['Ben']);
    });

    it("reads and edits one kid, and cannot see other families' kids", async () => {
      const [alex] = (await api.get('/v1/kids', mum.token)).body;
      expect((await api.get(`/v1/kids/${alex.id}`, mum.token)).body).toEqual(alex);
      const res = await api.patch(`/v1/kids/${alex.id}`, mum.token, { avatarColor: '#DB2777' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...alex, avatarColor: '#DB2777' });
      expect((await api.patch(`/v1/kids/${alex.id}`, mum.token, {})).body).toEqual(res.body);

      const theirs = await api.get(`/v1/kids/${beasKid}`, mum.token);
      expect(theirs.status).toBe(404);
      expect(theirs.body.error).toEqual({ code: 'not_found', message: 'No such kid in your family.' });
      expect((await api.patch(`/v1/kids/${beasKid}`, mum.token, { name: 'Taken' })).status).toBe(404);
      expect((await api.get(`/v1/kids/${randomUUID()}`, mum.token)).status).toBe(404);
      expect((await api.get('/v1/kids/not-a-uuid', mum.token)).status).toBe(422);
    });

    it('archives a kid: hidden everywhere, history kept', async () => {
      const added = (await api.post('/v1/kids', mum.token, { name: 'Old', avatarColor: '#475569' })).body;
      expect((await api.del(`/v1/kids/${added.id}`, mum.token)).status).toBe(204);
      expect((await api.get(`/v1/kids/${added.id}`, mum.token)).status).toBe(404);
      expect((await api.get(`/v1/kids/${added.id}/schedule`, mum.token)).status).toBe(404);
      expect((await api.patch(`/v1/kids/${added.id}`, mum.token, { name: 'Back' })).status).toBe(404);
      expect((await api.del(`/v1/kids/${added.id}`, mum.token)).status).toBe(404);
      expect((await api.get('/v1/kids', mum.token)).body.map((k: { name: string }) => k.name)).toEqual(['Alex', 'Sam']);
      const [row] = await db.select().from(kids).where(eq(kids.id, added.id));
      expect(row?.archivedAt).toBeInstanceOf(Date);
      expect((await api.del(`/v1/kids/${beasKid}`, mum.token)).status).toBe(404);
    });
  });

  describe('schedule', () => {
    it('returns the current version and saves new ones, keeping the old', async () => {
      const [alex] = (await api.get('/v1/kids', mum.token)).body;
      const first = await api.get(`/v1/kids/${alex.id}/schedule`, mum.token);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ version: 1, warn1Min: 15, warn2Min: 5, days: defaultWeek() });
      expect(Object.keys(first.body.days[0])).toEqual(['weekday', 'screensMin', 'phoneMin', 'wake', 'bedtime']);

      const saved = await api.put(`/v1/kids/${alex.id}/schedule`, mum.token, { warn1Min: 10, warn2Min: 2, days: week(90) });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({ version: 2, warn1Min: 10, warn2Min: 2, days: week(90) });
      await api.put(`/v1/kids/${alex.id}/schedule`, mum.token, { warn1Min: 10, warn2Min: 2, days: week(60) });
      expect((await api.get(`/v1/kids/${alex.id}/schedule`, mum.token)).body).toEqual({
        version: 3,
        warn1Min: 10,
        warn2Min: 2,
        days: week(60),
      });
      const versions = await db
        .select()
        .from(scheduleVersions)
        .where(eq(scheduleVersions.kidId, alex.id))
        .orderBy(asc(scheduleVersions.version));
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
      expect(versions[2]?.createdBy).toBe(mum.id);
    });

    it("refuses an invalid schedule or another family's kid", async () => {
      const [alex] = (await api.get('/v1/kids', mum.token)).body;
      const late = week(90).map((d) => ({ ...d, wake: '22:00' }));
      expect((await api.put(`/v1/kids/${alex.id}/schedule`, mum.token, { warn1Min: 10, warn2Min: 2, days: late })).status).toBe(422);
      expect((await api.put(`/v1/kids/${alex.id}/schedule`, mum.token, { warn1Min: 2, warn2Min: 10, days: week(90) })).status).toBe(422);
      expect((await api.get(`/v1/kids/${beasKid}/schedule`, mum.token)).status).toBe(404);
      expect((await api.put(`/v1/kids/${beasKid}/schedule`, mum.token, { warn1Min: 10, warn2Min: 2, days: week(90) })).status).toBe(404);
      expect((await api.get(`/v1/kids/${beasKid}/schedule`, bea.token)).body.version).toBe(1);
    });
  });

  describe('contacts', () => {
    it('starts empty and replaces the whole list, in order', async () => {
      const [alex, sam] = (await api.get('/v1/kids', mum.token)).body;
      expect((await api.get(`/v1/kids/${alex.id}/contacts`, mum.token)).body).toEqual([]);
      await api.put(`/v1/kids/${sam.id}/contacts`, mum.token, { contacts: [{ label: 'Coach', phoneE164: '+61400000003' }] });

      const first = await api.put(`/v1/kids/${alex.id}/contacts`, mum.token, {
        contacts: [
          { label: ' Grandma ', phoneE164: '+61400000001' },
          { label: 'Uncle Tom', phoneE164: '+61400000002' },
        ],
      });
      expect(first.status).toBe(200);
      expect(first.body.map((c: { label: string }) => c.label)).toEqual(['Grandma', 'Uncle Tom']);
      const second = await api.put(`/v1/kids/${alex.id}/contacts`, mum.token, {
        contacts: [{ label: 'Uncle Tom', phoneE164: '+61400000002' }],
      });
      expect(second.body).toEqual([{ id: expect.any(String), label: 'Uncle Tom', phoneE164: '+61400000002' }]);
      expect((await api.get(`/v1/kids/${alex.id}/contacts`, mum.token)).body).toEqual(second.body);
      expect((await api.get(`/v1/kids/${sam.id}/contacts`, mum.token)).body.map((c: { label: string }) => c.label)).toEqual([
        'Coach',
      ]);
    });

    it("refuses more than 10, bad numbers, or another family's kid", async () => {
      const [alex] = (await api.get('/v1/kids', mum.token)).body;
      const contact = { label: 'Friend', phoneE164: '+61400000009' };
      expect((await api.put(`/v1/kids/${alex.id}/contacts`, mum.token, { contacts: Array(11).fill(contact) })).status).toBe(422);
      expect(
        (await api.put(`/v1/kids/${alex.id}/contacts`, mum.token, { contacts: [{ ...contact, phoneE164: '0400 000 009' }] }))
          .status,
      ).toBe(422);
      expect((await api.put(`/v1/kids/${beasKid}/contacts`, mum.token, { contacts: [contact] })).status).toBe(404);
      expect((await api.get(`/v1/kids/${beasKid}/contacts`, mum.token)).status).toBe(404);
    });
  });
});
