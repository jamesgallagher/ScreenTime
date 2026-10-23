import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

/** The transaction handle that `withFamily` passes to its callback. */
export type FamilyTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Runs `fn` in a transaction that can only see and write rows of one family (row-level security,
 * drizzle/0002_rls.sql). Every family-scoped request handler uses this. Both settings end with the
 * transaction, so a pooled connection never leaks one family's scope into the next request.
 */
export async function withFamily<T>(db: Db, familyId: string, fn: (tx: FamilyTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE screentime_app`);
    await tx.execute(sql`SELECT set_config('app.family_id', ${familyId}, true)`);
    return fn(tx);
  });
}
