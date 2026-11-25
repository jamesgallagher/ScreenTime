// Prints the searches stored for a development kid. It queries the database directly, so no sign-in is needed.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-searches.ts <kid name>
// Never run this against the production database.
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { devices, kids, searches } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
if (!databaseUrl || !kidName) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-searches.ts <kid name>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db
    .select()
    .from(kids)
    .where(sql`lower(${kids.name}) = lower(${kidName})`)
    .orderBy(asc(kids.createdAt))
    .limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}: run scripts/seed-dev.ts first`);

  const kidDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.kidId, kid.id))
    .orderBy(asc(devices.enrolledAt), asc(devices.id));
  console.log(`kid: ${kid.name}`);
  for (const device of kidDevices) {
    console.log(`device: ${device.name} (${device.id})  search_capture: ${device.searchCapture ?? 'never'}`);
    const rows = await db
      .select()
      .from(searches)
      .where(and(eq(searches.kidId, kid.id), eq(searches.deviceId, device.id)))
      .orderBy(desc(searches.at), asc(searches.package));
    for (const row of rows) {
      console.log(
        `${row.at.toISOString()}  ${row.engine}  ${row.package}  ${row.count}  ${row.private === null ? 'null' : row.private}  ${row.query}`,
      );
    }
  }
} finally {
  await pool.end();
}
