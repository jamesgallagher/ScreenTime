import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { families } from '../src/db/schema.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
// CI sets TEST_DATABASE_URL; locally see deploy/README.md.
const url = process.env.TEST_DATABASE_URL;

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
    expect(result.rows.map((r) => r.table_name)).toContain('families');
  });

  it('is safe to run migrations again', async () => {
    await expect(runMigrations(db)).resolves.toBeUndefined();
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
});
