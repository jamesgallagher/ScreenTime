// Fills an empty development database with one family, so later cards have data to work with.
// Usage (from the repo root, with DATABASE_URL set): pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts you@example.com
// Never run this against the production database.
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { families, kids, messagePresets, parents, scheduleVersions } from '../src/db/schema.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding, as authenticator apps expect. */
function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** ISO weekday 1 = Monday ... 7 = Sunday (docs/SPEC.md §6.1 schedule_versions). */
function week() {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5
      ? { weekday, screensMin: 120, phoneMin: 90, wake: '07:00', bedtime: '20:30' }
      : { weekday, screensMin: 180, phoneMin: 120, wake: '08:00', bedtime: '21:00' },
  );
}

const PRESETS = [
  'Can I have more time?',
  "I'm done, you can lock it",
  'Can you call me?',
  "I'm on my way home",
  'I need help with homework',
];

const databaseUrl = process.env.DATABASE_URL;
const email = process.argv[2]?.trim().toLowerCase();
if (!databaseUrl || !email) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/seed-dev.ts <parent-email>');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  await runMigrations(db);
  const existing = await db.select().from(parents).where(eq(parents.email, email));
  if (existing.length > 0) {
    console.error(`A parent with email ${email} already exists. Nothing changed.`);
    process.exitCode = 1;
  } else {
    await db.transaction(async (tx) => {
      const [family] = await tx
        .insert(families)
        .values({ name: 'Dev family', timezone: 'Australia/Sydney', parentCodeSecret: base32(randomBytes(20)) })
        .returning();
      if (!family) throw new Error('family insert returned nothing');
      const [parent] = await tx
        .insert(parents)
        .values({ familyId: family.id, email, displayName: 'Dad' })
        .returning();
      if (!parent) throw new Error('parent insert returned nothing');
      const kidRows = await tx
        .insert(kids)
        .values([
          { familyId: family.id, name: 'Alex', avatarColor: '#0F766E' },
          { familyId: family.id, name: 'Sam', avatarColor: '#7C3AED' },
        ])
        .returning();
      await tx.insert(scheduleVersions).values(
        kidRows.map((kid) => ({ familyId: family.id, kidId: kid.id, version: 1, days: week(), createdBy: parent.id })),
      );
      await tx
        .insert(messagePresets)
        .values(PRESETS.map((text, sort) => ({ familyId: family.id, text, sort })));
      console.log(`Seeded family ${family.id} with parent ${email} and kids Alex and Sam.`);
    });
  }
} finally {
  await pool.end();
}
