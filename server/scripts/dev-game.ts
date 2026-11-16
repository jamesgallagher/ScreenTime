// Plays the parent's side of games on a PC in the development database, through the API, as a parent would in the app.
// It signs a short-lived parent token with JWT_SECRET for the family's first parent; the server must use the same secret.
// It works on the kid's newest Windows device.
// Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-game.ts Sam list
//   pnpm --filter @screentime/server exec tsx scripts/dev-game.ts Sam shortcut starrail on
//   pnpm --filter @screentime/server exec tsx scripts/dev-game.ts Sam add "Notepad" "C:\Windows\System32\notepad.exe"
//   pnpm --filter @screentime/server exec tsx scripts/dev-game.ts Sam remove custom-<uuid>
// It prints the HTTP status, and for "list" one line per game. SERVER_URL overrides http://localhost:8080.
// Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { devices, kids, parents } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const server = process.env.SERVER_URL ?? 'http://localhost:8080';
const [kidName, what, first, second] = process.argv.slice(2);
const ok =
  what === 'list' ||
  (what === 'shortcut' && first && (second === 'on' || second === 'off')) ||
  (what === 'add' && first && second) ||
  (what === 'remove' && first);
if (!databaseUrl || !jwtSecret || !kidName || !ok) {
  console.error('Usage: tsx scripts/dev-game.ts <kid name> list | shortcut <game id> <on|off> | add <label> <exe path> | remove <game id>');
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
  const [pc] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.kidId, kid.id), eq(devices.platform, 'windows'), isNull(devices.revokedAt)))
    .orderBy(desc(devices.enrolledAt))
    .limit(1);
  if (!pc) throw new Error(`${kid.name} has no Windows device`);
  const token = await signAccessToken(jwtSecret, { sessionId: randomUUID(), parentId: parent.id, familyId: kid.familyId, roles: ['parent'] });
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${server}/v1/devices/${pc.id}/games${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let response: Response;
  if (what === 'list') {
    response = await call('GET', '');
    if (response.ok) {
      const { games } = (await response.json()) as { games: { id: string; label: string; exePath: string; source: string; shortcut: boolean; removedAt: string | null }[] };
      for (const g of games) console.log(`${g.id} | ${g.label} | ${g.source} | shortcut ${g.shortcut ? 'on' : 'off'} | ${g.removedAt ? 'gone' : g.exePath}`);
    }
  } else if (what === 'shortcut') {
    response = await call('PUT', `/${first}/shortcut`, { shortcut: second === 'on' });
  } else if (what === 'add') {
    response = await call('POST', '', { label: first, exePath: second });
    if (response.ok) console.log(((await response.json()) as { id: string }).id);
  } else {
    response = await call('DELETE', `/${first}`);
  }
  console.log(`${what} ${first ?? ''} ${what === 'add' ? '' : (second ?? '')}`.trim() + `: ${response.status}`);
  process.exitCode = response.ok ? 0 : 1;
} finally {
  await pool.end();
}
