import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { withFamily } from '../src/db/family.js';
import { runMigrations } from '../src/db/migrate.js';
import { families, kids, otpCodes } from '../src/db/schema.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
// CI sets TEST_DATABASE_URL; locally see deploy/README.md.
// The row-level security tests live in this file too, because files run in parallel and both need a clean database.
const url = process.env.TEST_DATABASE_URL;

/** Drizzle wraps the PostgreSQL error; 42501 is insufficient_privilege, which includes row-level security violations. */
const denied = { cause: { code: '42501' } };

describe.skipIf(!url)('database', () => {
  const { db, pool } = createDb(url ?? '');

  beforeAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies migrations to an empty database', async () => {
    await runMigrations(db);
    const result = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(result.rows.map((r) => r.table_name).sort()).toEqual([
      'devices',
      'enrolment_codes',
      'events',
      'families',
      'grants',
      'kid_contacts',
      'kid_messages',
      'kids',
      'message_presets',
      'notification_prefs',
      'otp_codes',
      'parent_mode_sessions',
      'parent_sessions',
      'parents',
      'schedule_versions',
      'sos_acks',
      'sos_incidents',
      'sos_locations',
      'time_requests',
      'usage_segments',
    ]);
  });

  it('is safe to run migrations again', async () => {
    await expect(runMigrations(db)).resolves.toBeUndefined();
  });

  it('turns on row-level security for every table except otp_codes', async () => {
    const result = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'",
    );
    for (const row of result.rows) {
      expect({ table: row.relname, rls: row.relrowsecurity }).toEqual({
        table: row.relname,
        rls: row.relname !== 'otp_codes',
      });
    }
  });

  it('creates a family with server defaults', async () => {
    const [row] = await db
      .insert(families)
      .values({ name: 'Test family', timezone: 'Australia/Sydney', parentCodeSecret: 'JBSWY3DPEHPK3PXP' })
      .returning();
    expect(row).toBeDefined();
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row?.emergencyNumber).toBe('000');
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.disabledAt).toBeNull();
  });

  describe('row-level security', () => {
    let familyA = '';
    let familyB = '';

    beforeAll(async () => {
      const rows = await db
        .insert(families)
        .values([
          { name: 'Family A', timezone: 'Australia/Sydney', parentCodeSecret: 'AAAAAAAAAAAAAAAA' },
          { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'BBBBBBBBBBBBBBBB' },
        ])
        .returning();
      familyA = rows[0]?.id ?? '';
      familyB = rows[1]?.id ?? '';
      await db.insert(kids).values([
        { familyId: familyA, name: 'Alex', avatarColor: '#0F766E' },
        { familyId: familyB, name: 'Bea', avatarColor: '#7C3AED' },
      ]);
    });

    it('shows a family only its own rows', async () => {
      const seen = await withFamily(db, familyA, async (tx) => ({
        families: await tx.select().from(families),
        kids: await tx.select().from(kids),
      }));
      expect(seen.families.map((f) => f.name)).toEqual(['Family A']);
      expect(seen.kids.map((k) => k.name)).toEqual(['Alex']);
    });

    it('lets a family write its own rows', async () => {
      const [kid] = await withFamily(db, familyA, (tx) =>
        tx.insert(kids).values({ familyId: familyA, name: 'Sam', avatarColor: '#2563EB' }).returning(),
      );
      expect(kid?.familyId).toBe(familyA);
    });

    it('refuses to write a row for another family', async () => {
      await expect(
        withFamily(db, familyA, (tx) =>
          tx.insert(kids).values({ familyId: familyB, name: 'Intruder', avatarColor: '#2563EB' }),
        ),
      ).rejects.toMatchObject(denied);
    });

    it('cannot move a row to another family', async () => {
      await expect(
        withFamily(db, familyA, (tx) => tx.update(kids).set({ familyId: familyB }).where(sql`true`)),
      ).rejects.toMatchObject(denied);
    });

    it("cannot change or delete another family's rows", async () => {
      const changed = await withFamily(db, familyA, async (tx) => ({
        updated: await tx.update(kids).set({ name: 'Hacked' }).where(sql`family_id = ${familyB}`).returning(),
        deleted: await tx.delete(kids).where(sql`family_id = ${familyB}`).returning(),
      }));
      expect(changed).toEqual({ updated: [], deleted: [] });
      const [bea] = await db.select().from(kids).where(sql`family_id = ${familyB}`);
      expect(bea?.name).toBe('Bea');
    });

    it('sees nothing when no family is set', async () => {
      const seen = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE screentime_app`);
        return tx.select().from(kids);
      });
      expect(seen).toEqual([]);
    });

    it('does not leak the family to the next transaction on the same connection', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE screentime_app');
        await client.query("SELECT set_config('app.family_id', $1, true)", [familyA]);
        await client.query('COMMIT');
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE screentime_app');
        const result = await client.query('SELECT name FROM kids');
        await client.query('COMMIT');
        expect(result.rows).toEqual([]);
      } finally {
        client.release();
      }
    });

    it('keeps sign-in codes away from the family role', async () => {
      await expect(withFamily(db, familyA, (tx) => tx.select().from(otpCodes))).rejects.toMatchObject(
        denied,
      );
    });
  });
});
