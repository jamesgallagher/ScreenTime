import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { families, messagePresets, parentSessions, parents } from '../src/db/schema.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('super admin routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const api = client({ db, config: testConfig(url ?? '', 'boss@example.com'), mailer });
  let admin = '';

  const newFamily = {
    name: 'The Gallaghers',
    timezone: 'Australia/Sydney',
    firstParent: { email: 'James@Example.com', displayName: 'Dad', phoneE164: '+61400000003' },
  };

  beforeAll(async () => {
    await resetDatabase(db, pool);
    admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('refuses anyone but the super admin', async () => {
    expect((await api.get('/v1/admin/families', null)).status).toBe(401);
    const parent = await tokenFor({ parentId: null, familyId: null }, ['parent']);
    const res = await api.get('/v1/admin/families', parent);
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({ code: 'forbidden', message: 'This needs the super admin.' });
  });

  it('refuses a super admin token once SUPER_ADMIN_EMAIL is removed', async () => {
    const noAdmin = client({ db, config: testConfig(url ?? '', null), mailer });
    expect((await noAdmin.get('/v1/admin/families', admin)).status).toBe(403);
  });

  it('creates a family with its first parent, default presets and a secret', async () => {
    const res = await api.post('/v1/admin/families', admin, newFamily);
    expect(res.status).toBe(201);
    expect(res.body.family).toMatchObject({ name: 'The Gallaghers', timezone: 'Australia/Sydney', emergencyNumber: '000' });
    expect(res.body.parent).toMatchObject({ email: 'james@example.com', displayName: 'Dad', phoneE164: '+61400000003' });

    const familyId = res.body.family.id;
    const [family] = await db.select().from(families).where(eq(families.id, familyId));
    expect(family?.parentCodeSecret).toMatch(/^[A-Z2-7]{32}$/);
    const presets = await db.select().from(messagePresets).where(eq(messagePresets.familyId, familyId));
    expect(presets.sort((a, b) => a.sort - b.sort).map((p) => p.text)).toEqual([
      'Can I have more time?',
      "I'm done, you can lock it",
      'Can you call me?',
      "I'm on my way home",
      'I need help with homework',
    ]);
  });

  it("creates nothing when the first parent's email is taken", async () => {
    const before = await db.select().from(families);
    const res = await api.post('/v1/admin/families', admin, { ...newFamily, name: 'Copy' });
    expect(res.status).toBe(409);
    expect(await db.select().from(families)).toHaveLength(before.length);
  });

  it('rejects a bad time zone', async () => {
    expect((await api.post('/v1/admin/families', admin, { ...newFamily, timezone: 'Sydney' })).status).toBe(422);
  });

  it('adds a parent to a family, and 404s for an unknown family', async () => {
    const [family] = await db.select().from(families);
    const res = await api.post(`/v1/admin/families/${family?.id}/parents`, admin, {
      email: 'mum@example.com',
      displayName: 'Mum',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'mum@example.com', displayName: 'Mum', phoneE164: null });
    const unknown = await api.post('/v1/admin/families/00000000-0000-7000-8000-000000000000/parents', admin, {
      email: 'x@example.com',
      displayName: 'X',
    });
    expect(unknown.status).toBe(404);
  });

  it('lists every family with its parent count', async () => {
    await api.post('/v1/admin/families', admin, {
      name: 'Second',
      timezone: 'Europe/London',
      emergencyNumber: '999',
      firstParent: { email: 'second@example.com', displayName: 'Pat' },
    });
    const res = await api.get('/v1/admin/families', admin);
    expect(res.status).toBe(200);
    expect(res.body.map((f: { name: string; parentCount: number }) => [f.name, f.parentCount])).toEqual([
      ['The Gallaghers', 2],
      ['Second', 1],
    ]);
    expect(res.body[0].disabledAt).toBeNull();
  });

  it('disables a family: its parents are signed out and refused', async () => {
    const [family] = await db.select().from(families).where(eq(families.name, 'Second'));
    const [pat] = await db.select().from(parents).where(eq(parents.email, 'second@example.com'));
    await db.insert(parentSessions).values({
      parentId: pat?.id ?? '',
      familyId: family?.id ?? '',
      refreshTokenHash: 'pat-session',
      client: 'web',
      clientLabel: 'Browser',
    });
    const patToken = await tokenFor({ parentId: pat?.id ?? '', familyId: family?.id ?? '' });
    expect((await api.get('/v1/family', patToken)).status).toBe(200);

    expect((await api.post(`/v1/admin/families/${family?.id}/disable`, admin)).status).toBe(204);
    expect((await api.get('/v1/family', patToken)).status).toBe(401);
    const [session] = await db.select().from(parentSessions).where(eq(parentSessions.refreshTokenHash, 'pat-session'));
    expect(session?.revokedAt).toBeInstanceOf(Date);
    const list = (await api.get('/v1/admin/families', admin)).body;
    expect(list[1].disabledAt).toEqual(expect.any(String));
    expect((await api.post('/v1/admin/families/00000000-0000-7000-8000-000000000000/disable', admin)).status).toBe(404);
  });
});
