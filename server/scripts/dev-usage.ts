// Makes a kid of the development database look busy on a PC, for the parent app's Today screen: it enrols a pretend
// Windows PC through the API and uploads one usage segment that started some minutes ago and is still open, so Today
// shows the time as used and the PC as in use. The PC counts as in use for 10 minutes, as a real one that stops
// syncing would. Run it once per kid: a second run adds the minutes again.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-usage.ts Alex 140 [http://localhost:8080]
// Minutes are 1 to 720. Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { enrolmentCodes, kids, parents } from '../src/db/schema.js';
import { newEnrolmentCode } from '../src/devices/token.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const minutes = Number(process.argv[3]);
const apiUrl = (process.argv[4] ?? 'http://localhost:8080').replace(/\/+$/, '');
if (!databaseUrl || !kidName || !Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-usage.ts <kid name> <minutes, 1 to 720> [api url]');
  process.exit(1);
}

async function post(path: string, body: unknown, token?: string): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: the API said ${response.status}: ${await response.text()}`);
  return response.json();
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
  const code = newEnrolmentCode();
  await db.insert(enrolmentCodes).values({
    familyId: kid.familyId,
    kidId: kid.id,
    form: 'pc',
    code,
    expiresAt: sql`now() + interval '10 minutes'`,
    createdBy: parent.id,
  });

  const user = kid.name.toLowerCase();
  const enrolled = (await post('/v1/enrol', {
    code,
    platform: 'windows',
    hasCellular: false,
    model: 'Dev PC',
    osVersion: 'Windows 11',
    appVersion: 'dev',
    machineId: `dev-pc-${kid.id}`,
    windowsUserSid: `S-1-5-21-dev-${kid.id}`,
    windowsUserName: user,
  })) as { deviceToken: string };
  const startedAt = new Date(Date.now() - minutes * 60_000).toISOString();
  await post(
    '/v1/device/usage',
    { segments: [{ id: randomUUID(), startedAt, endedAt: null, recordedOffline: false }] },
    enrolled.deviceToken,
  );
  console.log(`${kid.name} has been using "${user} on Dev PC" for ${minutes} min, and still is.`);
} finally {
  await pool.end();
}
