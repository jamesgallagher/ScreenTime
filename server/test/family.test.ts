import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { devices, families, kidMessages, kids, messagePresets, parentSessions, parents } from '../src/db/schema.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('family routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const api = client({ db, config: testConfig(url ?? '', 'boss@example.com'), mailer });

  let familyA = '';
  let familyB = '';
  let mum = { id: '', token: '' };
  let dad = { id: '', token: '' };
  let bea = { id: '', token: '' };

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
    const rows = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
        { familyId: familyA, email: 'old@example.com', displayName: 'Old', disabledAt: new Date() },
        { familyId: familyB, email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    const login = async (i: number, familyId: string) => {
      const id = rows[i]?.id ?? '';
      return { id, token: await tokenFor({ parentId: id, familyId }) };
    };
    mum = await login(0, familyA);
    dad = await login(1, familyA);
    bea = await login(3, familyB);
    await db.insert(messagePresets).values([
      { familyId: familyA, text: 'Can I have more time?', sort: 0 },
      { familyId: familyA, text: 'Can you call me?', sort: 1 },
      { familyId: familyB, text: 'Family B preset', sort: 0 },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('access', () => {
    it('needs a token', async () => {
      expect((await api.get('/v1/family', null)).status).toBe(401);
    });

    it('refuses a super admin who is not a parent with 403', async () => {
      const admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
      const res = await api.get('/v1/family', admin);
      expect(res.status).toBe(403);
      expect(res.body.error).toEqual({ code: 'forbidden', message: 'This needs a parent account.' });
    });

    it('refuses a token whose parent no longer exists', async () => {
      const ghost = await tokenFor({ parentId: randomUUID(), familyId: familyA });
      expect((await api.get('/v1/family', ghost)).status).toBe(401);
    });
  });

  describe('GET and PATCH /v1/family', () => {
    it("returns only the caller's family", async () => {
      expect((await api.get('/v1/family', mum.token)).body).toEqual({
        id: familyA,
        name: 'Family A',
        timezone: 'Australia/Sydney',
        emergencyNumber: '000',
      });
      expect((await api.get('/v1/family', bea.token)).body.name).toBe('Family B');
    });

    it('changes only the fields sent', async () => {
      const res = await api.patch('/v1/family', mum.token, { name: '  The As ', timezone: 'Australia/Brisbane' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'The As', timezone: 'Australia/Brisbane', emergencyNumber: '000' });
      expect((await api.patch('/v1/family', mum.token, {})).body.name).toBe('The As');
      expect((await api.get('/v1/family', bea.token)).body.name).toBe('Family B');
    });

    it('rejects an unknown time zone or a bad emergency number', async () => {
      expect((await api.patch('/v1/family', mum.token, { timezone: 'Mars/Olympus' })).status).toBe(422);
      expect((await api.patch('/v1/family', mum.token, { emergencyNumber: 'help' })).status).toBe(422);
    });
  });

  describe('parents', () => {
    it("lists the family's enabled parents, oldest first", async () => {
      const res = await api.get('/v1/family/parents', mum.token);
      expect(res.status).toBe(200);
      expect(res.body.map((p: { displayName: string }) => p.displayName)).toEqual(['Mum', 'Dad']);
    });

    it('adds a parent with a lower-case email', async () => {
      const res = await api.post('/v1/family/parents', mum.token, {
        email: 'Gran@Example.com',
        displayName: 'Gran',
        phoneE164: '+61400000001',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: 'gran@example.com', displayName: 'Gran', phoneE164: '+61400000001' });
    });

    it('refuses an email that any family already uses', async () => {
      const res = await api.post('/v1/family/parents', mum.token, { email: 'bea@example.com', displayName: 'Copy' });
      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({ code: 'conflict', message: 'That email already belongs to a parent.' });
    });

    it("edits a parent of the family, and cannot see other families' parents", async () => {
      const res = await api.patch(`/v1/family/parents/${dad.id}`, mum.token, { phoneE164: '+61400000002' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ displayName: 'Dad', phoneE164: '+61400000002' });
      expect((await api.patch(`/v1/family/parents/${dad.id}`, mum.token, { phoneE164: null })).body.phoneE164).toBeNull();
      expect((await api.patch(`/v1/family/parents/${dad.id}`, mum.token, { phoneE164: '0400' })).status).toBe(422);
      expect((await api.patch(`/v1/family/parents/${bea.id}`, mum.token, { displayName: 'Hacked' })).status).toBe(404);
      expect((await api.patch('/v1/family/parents/not-a-uuid', mum.token, { displayName: 'X' })).status).toBe(422);
    });

    it("cannot remove yourself or another family's parent", async () => {
      expect((await api.del(`/v1/family/parents/${mum.id}`, mum.token)).status).toBe(409);
      expect((await api.del(`/v1/family/parents/${bea.id}`, mum.token)).status).toBe(404);
    });

    it('removes a parent: disabled, signed out everywhere, and refused at once', async () => {
      await db.insert(parentSessions).values({
        parentId: dad.id,
        familyId: familyA,
        refreshTokenHash: 'dad-session',
        client: 'android',
        clientLabel: 'Dad phone',
      });
      expect((await api.del(`/v1/family/parents/${dad.id}`, mum.token)).status).toBe(204);
      const [session] = await db.select().from(parentSessions).where(eq(parentSessions.parentId, dad.id));
      expect(session?.revokedAt).toBeInstanceOf(Date);
      expect((await api.get('/v1/family', dad.token)).status).toBe(401);
      const names = (await api.get('/v1/family/parents', mum.token)).body.map((p: { displayName: string }) => p.displayName);
      expect(names).toEqual(['Mum', 'Gran']);
      expect((await api.del(`/v1/family/parents/${dad.id}`, mum.token)).status).toBe(404);
    });
  });

  describe('message presets', () => {
    it("lists the family's presets in order", async () => {
      const res = await api.get('/v1/family/message-presets', mum.token);
      expect(res.status).toBe(200);
      expect(res.body.map((p: { text: string }) => p.text)).toEqual(['Can I have more time?', 'Can you call me?']);
    });

    it('replaces the whole list, keeping old kid messages', async () => {
      const [kid] = await db.insert(kids).values({ familyId: familyA, name: 'Alex', avatarColor: '#0F766E' }).returning();
      const [device] = await db
        .insert(devices)
        .values({
          familyId: familyA,
          kidId: kid?.id ?? '',
          platform: 'android',
          form: 'phone',
          pool: 'phone',
          name: 'Pixel 7',
          tokenHash: 'device-token',
        })
        .returning();
      const before = (await api.get('/v1/family/message-presets', mum.token)).body;
      const messageId = randomUUID();
      await db.insert(kidMessages).values({
        id: messageId,
        familyId: familyA,
        kidId: kid?.id ?? '',
        deviceId: device?.id ?? '',
        body: 'Can you call me?',
        presetId: before[1].id,
      });

      const res = await api.put('/v1/family/message-presets', mum.token, {
        presets: [{ text: ' Pick me up please ' }, { text: 'Can I have more time?' }],
      });
      expect(res.status).toBe(200);
      expect(res.body.map((p: { text: string }) => p.text)).toEqual(['Pick me up please', 'Can I have more time?']);
      expect((await api.get('/v1/family/message-presets', mum.token)).body).toEqual(res.body);

      const [message] = await db.select().from(kidMessages).where(eq(kidMessages.id, messageId));
      expect(message?.body).toBe('Can you call me?');
      expect(message?.presetId).toBeNull();
      const others = (await api.get('/v1/family/message-presets', bea.token)).body;
      expect(others.map((p: { text: string }) => p.text)).toEqual(['Family B preset']);
    });

    it('accepts an empty list and refuses more than 10', async () => {
      expect((await api.put('/v1/family/message-presets', mum.token, { presets: [] })).body).toEqual([]);
      const eleven = { presets: Array.from({ length: 11 }, (_, i) => ({ text: `Preset ${i}` })) };
      expect((await api.put('/v1/family/message-presets', mum.token, eleven)).status).toBe(422);
    });
  });

  describe('parent-code secret', () => {
    it('returns the secret and rotates it', async () => {
      expect((await api.get('/v1/family/parent-code', mum.token)).body).toEqual({ secret: 'A'.repeat(32) });
      const rotated = await api.post('/v1/family/parent-code/rotate', mum.token);
      expect(rotated.status).toBe(200);
      expect(rotated.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(rotated.body.secret).not.toBe('A'.repeat(32));
      expect((await api.get('/v1/family/parent-code', mum.token)).body).toEqual(rotated.body);
      expect((await api.get('/v1/family/parent-code', bea.token)).body).toEqual({ secret: 'B'.repeat(32) });
    });
  });

  it('refuses every parent of a disabled family', async () => {
    await db.execute(sql`update families set disabled_at = now() where id = ${familyB}`);
    expect((await api.get('/v1/family', bea.token)).status).toBe(401);
  });
});
