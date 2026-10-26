// Prints a fresh enrolment code for a kid of the development database, without signing in to the web app.
// Usage (from the repo root, with DATABASE_URL set): pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone
// The kid name is matched without case; the form is phone, tablet or pc. Never run this against the production database.
import { asc, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { enrolmentCodes, kids, parents } from '../src/db/schema.js';
import { newEnrolmentCode } from '../src/devices/token.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const form = process.argv[3]?.trim();
if (!databaseUrl || !kidName || !form || !['phone', 'tablet', 'pc'].includes(form)) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-enrol-code.ts <kid name> <phone|tablet|pc>');
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
  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.familyId, kid.familyId))
    .orderBy(asc(parents.createdAt))
    .limit(1);
  if (!parent) throw new Error(`the family of ${kid.name} has no parent`);
  // Codes are random, so a clash with another live code is one in a million.
  const code = newEnrolmentCode();
  await db.insert(enrolmentCodes).values({
    familyId: kid.familyId,
    kidId: kid.id,
    form,
    code,
    expiresAt: sql`now() + interval '10 minutes'`,
    createdBy: parent.id,
  });
  console.log(`Enrolment code for ${kid.name} (${form}): ${code}, valid for 10 minutes.`);
} finally {
  await pool.end();
}
