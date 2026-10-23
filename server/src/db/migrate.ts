import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.js';

/** server/drizzle, found from both src/db (tsx, tests) and dist/db (built). */
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies every migration in server/drizzle that has not run yet. Safe to call on every start. */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
