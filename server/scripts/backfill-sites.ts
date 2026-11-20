// Fills site_lookups.site and recounts site_daily.minutes once, after the CARD-070 deploy (docs/SPEC.md §12.10).
// Running it again changes no value. It works over every family, as the database owner.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/backfill-sites.ts
// Never run this against the production database.
import { createDb } from '../src/db/client.js';
import { backfillSites } from '../src/sites/backfill.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/backfill-sites.ts');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const { filled, recounted } = await backfillSites(db);
  console.log(`sites: backfill filled ${filled} rows, recounted ${recounted} days`);
} finally {
  await pool.end();
}
