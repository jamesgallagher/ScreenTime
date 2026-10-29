// Makes a kid of the development database ask for more time from a phone, for the parent app's Inbox: it enrols a
// pretend Android phone through the API and sends one "Ask for more time" from it, so the parents get a pending
// request in the phone pool. One request per kid and pool can wait at a time: answer it before asking again.
// With `parent-mode` in place of the minutes, the pretend phone asks for parent mode instead (CARD-042); with `sos`,
// it starts an SOS at a Sydney position, so every parent app rings (CARD-044). End it with scripts/dev-sos.ts.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-ask.ts Alex 30 Finishing my homework video
//   pnpm --filter @screentime/server exec tsx scripts/dev-ask.ts Alex parent-mode
//   pnpm --filter @screentime/server exec tsx scripts/dev-ask.ts Alex sos
// Minutes are 15, 30 or 60; every word after them is the reason (none: no reason). The API is at
// http://localhost:8080 unless API_URL says otherwise. Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { enrolmentCodes, kids, parents } from '../src/db/schema.js';
import { newEnrolmentCode } from '../src/devices/token.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const parentMode = process.argv[3] === 'parent-mode';
const sos = process.argv[3] === 'sos';
const minutes = Number(process.argv[3]);
const reason = process.argv.slice(4).join(' ').trim() || null;
const apiUrl = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
if (!databaseUrl || !kidName || !(parentMode || sos || [15, 30, 60].includes(minutes))) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-ask.ts <kid name> <15, 30, 60, parent-mode or sos> [reason words]');
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
    form: 'phone',
    code,
    expiresAt: sql`now() + interval '10 minutes'`,
    createdBy: parent.id,
  });

  const phone = `${kid.name}'s Dev Phone`;
  const enrolled = (await post('/v1/enrol', {
    code,
    platform: 'android',
    hasCellular: true,
    model: phone,
    osVersion: 'Android 14',
    appVersion: 'dev',
  })) as { deviceToken: string };
  if (sos) {
    const at = new Date().toISOString();
    const location = { at, lat: -33.8688, lng: 151.2093, accuracyM: 20, batteryPct: 54, via: 'data' };
    await post('/v1/device/sos', { id: randomUUID(), startedAt: at, location }, enrolled.deviceToken);
    console.log(`${kid.name} started an SOS from "${phone}".`);
  } else if (parentMode) {
    await post('/v1/device/parent-mode-requests', { id: randomUUID() }, enrolled.deviceToken);
    console.log(`${kid.name} asked for parent mode from "${phone}".`);
  } else {
    await post('/v1/device/time-requests', { id: randomUUID(), minutes, reason }, enrolled.deviceToken);
    console.log(`${kid.name} asked for ${minutes} min more Phone from "${phone}"${reason ? `: "${reason}"` : '.'}`);
  }
} finally {
  await pool.end();
}
