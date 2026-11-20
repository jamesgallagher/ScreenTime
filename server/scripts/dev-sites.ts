// Prints the websites stored by the development database: the site_daily rows of a kid's devices for a day
// (most lookups first), the count of raw site_lookups for that day, and the site_titles rows of that kid's
// devices for that day, oldest first. It queries the database directly, so no sign-in is needed.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-sites.ts <kid name> [YYYY-MM-DD]
// Never run this against the production database.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, siteDaily } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const date = process.argv[3]?.trim() || null;
if (!databaseUrl || !kidName) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-sites.ts <kid name> [YYYY-MM-DD]');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db.select().from(kids).where(sql`lower(${kids.name}) = lower(${kidName})`).orderBy(asc(kids.createdAt)).limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}: run scripts/seed-dev.ts first`);
  const [family] = await db.select().from(families).where(eq(families.id, kid.familyId)).limit(1);
  if (!family) throw new Error(`no family for ${kid.name}`);
  // The day is the local date in the family time zone; default to today.
  const [dayRow] = (await db.execute<{ day: string }>(sql`select coalesce(${date}, to_char(now() at time zone ${family.timezone}, 'YYYY-MM-DD')) as day`)).rows;
  const day = dayRow.day;
  const deviceIds = (await db.select({ id: devices.id }).from(devices).where(eq(devices.kidId, kid.id))).map((d) => d.id);
  const rows =
    deviceIds.length === 0
      ? []
      : await db
          .select({ site: siteDaily.site, package: siteDaily.package, lookups: siteDaily.lookups, firstAt: siteDaily.firstAt, lastAt: siteDaily.lastAt })
          .from(siteDaily)
          .where(and(inArray(siteDaily.deviceId, deviceIds), eq(siteDaily.day, day)))
          .orderBy(desc(siteDaily.lookups), asc(siteDaily.site));
  console.log(`kid: ${kid.name}   day: ${day}`);
  console.log('site | package | lookups | first..last');
  for (const r of rows) {
    console.log(`${r.site} | ${r.package} | ${r.lookups} | ${r.firstAt.toISOString()}..${r.lastAt.toISOString()}`);
  }
  const [rawRow] = (await db.execute<{ count: number }>(sql`
    select count(*) as count from site_lookups
    where device_id = any(${`{${deviceIds.join(',')}}`}::uuid[])
      and to_char(at at time zone ${family.timezone}, 'YYYY-MM-DD') = ${day}
  `)).rows;
  console.log(`raw site_lookups for ${day}: ${rawRow.count}`);
  const titles = (await db.execute<{ time: string; sec: number; package: string; title: string }>(sql`
    select to_char(site_titles.at at time zone ${family.timezone}, 'HH24:MI:SS') as time,
           site_titles.sec, site_titles.package, site_titles.title
    from site_titles
    where device_id = any(${`{${deviceIds.join(',')}}`}::uuid[])
      and to_char(site_titles.at at time zone ${family.timezone}, 'YYYY-MM-DD') = ${day}
    order by site_titles.at
  `)).rows;
  console.log('titles:');
  for (const r of titles) {
    console.log(`${r.time} | ${r.sec} | ${r.package} | ${r.title}`);
  }
} finally {
  await pool.end();
}
