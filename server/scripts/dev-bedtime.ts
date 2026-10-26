// Moves today's bedtime of a kid of the development database to a few minutes from now, to try the warnings and
// the lock on the emulator. Today also starts at 00:00 and allows 12 hours of each pool, so bedtime is what locks.
// Usage (from the repo root, with DATABASE_URL set): pnpm --filter @screentime/server exec tsx scripts/dev-bedtime.ts Alex 16
// It saves a new schedule version, as a parent's change would. Never run this against the production database.
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { ScheduleDay } from '@screentime/schemas';
import { createDb } from '../src/db/client.js';
import { families, kids, scheduleVersions } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const minutes = Number(process.argv[3]);
if (!databaseUrl || !kidName || !Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-bedtime.ts <kid name> <minutes from now, 1 to 120>');
  process.exit(1);
}

/** The weekday (1 = Monday) and the time of day in the time zone [tz]. */
function localNow(tz: string, at: Date): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(part('weekday')) + 1;
  return { weekday, hour: Number(part('hour')), minute: Number(part('minute')) };
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
  const [family] = await db.select().from(families).where(eq(families.id, kid.familyId));
  if (!family) throw new Error(`the family of ${kid.name} is missing`);
  const [latest] = await db
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.kidId, kid.id))
    .orderBy(desc(scheduleVersions.version))
    .limit(1);
  if (!latest) throw new Error(`${kid.name} has no schedule`);

  // Bedtime at the start of a whole minute, at least [minutes] from now.
  const now = localNow(family.timezone, new Date());
  const total = now.hour * 60 + now.minute + minutes + 1;
  if (total >= 24 * 60) throw new Error('that bedtime would be after midnight: try a smaller number, or after midnight');
  const bedtime = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

  const days = (latest.days as ScheduleDay[]).map((day) =>
    day.weekday === now.weekday ? { ...day, screensMin: 720, phoneMin: 720, wake: '00:00', bedtime } : day,
  );
  await db.insert(scheduleVersions).values({
    familyId: kid.familyId,
    kidId: kid.id,
    version: latest.version + 1,
    warn1Min: latest.warn1Min,
    warn2Min: latest.warn2Min,
    days,
    createdBy: latest.createdBy,
  });
  console.log(`Bedtime for ${kid.name} today is now ${bedtime} (${family.timezone}), schedule version ${latest.version + 1}.`);
} finally {
  await pool.end();
}
