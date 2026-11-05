// Plays the parent's side of app rules in the development database, through the API, as a parent would in the app.
// It signs a short-lived parent token with JWT_SECRET for the family's first parent; the server must use the same secret.
// Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-app-rule.ts Alex rule com.android.chrome blocked
//   pnpm --filter @screentime/server exec tsx scripts/dev-app-rule.ts Alex approval on
// It prints the HTTP status. Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { kids, parents } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const [kidName, what, first, second] = process.argv.slice(2);
if (!databaseUrl || !jwtSecret || !kidName || !first || (what !== 'rule' && what !== 'approval')) {
  console.error('Usage: tsx scripts/dev-app-rule.ts <kid name> rule <package> <allowed|blocked> | approval <on|off>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const [kid] = await db.select().from(kids).where(sql`lower(${kids.name}) = lower(${kidName})`).orderBy(asc(kids.createdAt)).limit(1);
  if (!kid) throw new Error(`no kid named ${kidName}`);
  const [parent] = await db
    .select()
    .from(parents)
    .where(and(eq(parents.familyId, kid.familyId), isNull(parents.disabledAt)))
    .orderBy(asc(parents.createdAt))
    .limit(1);
  if (!parent) throw new Error(`the family of ${kid.name} has no parent`);
  const token = await signAccessToken(jwtSecret, { sessionId: randomUUID(), parentId: parent.id, familyId: kid.familyId, roles: ['parent'] });
  const path = what === 'rule' ? `/v1/kids/${kid.id}/apps/${encodeURIComponent(first)}/rule` : `/v1/kids/${kid.id}/app-settings`;
  const body = what === 'rule' ? { mode: second } : { newAppApproval: first === 'on' };
  const response = await fetch(`http://localhost:8080${path}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log(`${what} ${first} ${second ?? ''}: ${response.status}`);
} finally {
  await pool.end();
}
