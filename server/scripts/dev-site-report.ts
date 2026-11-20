// Prints the websites report (SiteReport JSON) of a kid of the development database, by day, week or month, on all
// devices or one. It calls the server function directly, so no sign-in is needed.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-site-report.ts <kid name> <day|week|month> [YYYY-MM-DD] [device name]
// Never run this against the production database.
import { and, asc, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { withFamily } from '../src/db/family.js';
import { buildSiteReport } from '../src/reports/sites.js';
import { devices, families, kids } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const period = process.argv[3]?.trim();
const date = process.argv[4]?.trim() || null;
const deviceName = process.argv[5]?.trim() || null;
if (!databaseUrl || !kidName || !['day', 'week', 'month'].includes(period ?? '')) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-site-report.ts <kid name> <day|week|month> [YYYY-MM-DD] [device name]');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db.select().from(kids).where(sql`lower(${kids.name}) = lower(${kidName})`).orderBy(asc(kids.createdAt)).limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}: run scripts/seed-dev.ts first`);
  let deviceId: string | null = null;
  if (deviceName) {
    const [device] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.kidId, kid.id), sql`lower(${devices.name}) = lower(${deviceName})`))
      .orderBy(asc(devices.enrolledAt))
      .limit(1);
    if (!device) throw new Error(`no device named ${deviceName} for ${kid.name}`);
    deviceId = device.id;
  }
  const [family] = await db.select().from(families).where(eq(families.id, kid.familyId)).limit(1);
  if (!family) throw new Error(`no family for ${kid.name}`);
  const report = await withFamily(db, family.id, (tx) => buildSiteReport(tx, { kidId: kid.id, period: period as 'day' | 'week' | 'month', date, deviceId }));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
