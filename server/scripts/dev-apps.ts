// Shows what the server has for a kid's apps, and the app events, from the development database.
// Usage (from the repo root, with DATABASE_URL set): pnpm --filter @screentime/server exec tsx scripts/dev-apps.ts Alex
// Never run this against the production database.
import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { appRules, deviceApps, events, kids } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
if (!databaseUrl || !kidName) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-apps.ts <kid name>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db.select().from(kids).where(sql`lower(${kids.name}) = lower(${kidName})`).limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}`);
  const apps = await db.select().from(deviceApps).where(eq(deviceApps.kidId, kid.id)).orderBy(asc(deviceApps.package));
  console.log(`apps: ${apps.length}`);
  for (const a of apps) {
    console.log(
      `${a.package} | ${a.label} | ${a.source} | installer=${a.installer} | blockable=${a.blockable} | baseline=${a.baseline} | used=${a.firstUsedAt?.toISOString() ?? '-'} | removed=${a.removedAt?.toISOString() ?? '-'}`,
    );
  }
  const rules = await db.select().from(appRules).where(eq(appRules.kidId, kid.id)).orderBy(asc(appRules.package));
  console.log(`approval: ${kid.newAppApproval}`);
  console.log(`rules: ${rules.length}`);
  for (const r of rules) console.log(`rule ${r.package} ${r.mode}`);
  const list = await db
    .select()
    .from(events)
    .where(and(eq(events.kidId, kid.id), like(events.kind, 'app.%')))
    .orderBy(desc(events.createdAt));
  console.log(`events: ${list.length}`);
  for (const e of list) console.log(`${e.kind} | ${(e.payload as { package?: string }).package} | ${JSON.stringify(e.payload)}`);
} finally {
  await pool.end();
}
