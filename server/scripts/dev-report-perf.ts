// Criterion 11: inserts one year of app_usage_daily for 3 devices and 60 packages a day (about 65,000 rows)
// and times a month report for All devices. Run three times; all must be under 200 ms.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-report-perf.ts
// Never run this against the production database.
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { withFamily } from '../src/db/family.js';
import { buildAppReport } from '../src/reports/apps.js';
import { hashDeviceToken } from '../src/devices/token.js';
import { appUsageDaily, devices, families, kids } from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);

try {
  // Find the first family and kid.
  const [family] = await db.select().from(families).limit(1);
  if (!family) throw new Error('no family: run scripts/seed-dev.ts first');
  const [kid] = await db.select().from(kids).where(eq(kids.familyId, family.id)).limit(1);
  if (!kid) throw new Error(`no kid in family ${family.id}`);

  // Find or create 3 devices for the kid.
  const existing = await db.select().from(devices).where(eq(devices.kidId, kid.id));
  let deviceIds = existing.map((d) => d.id);
  while (deviceIds.length < 3) {
    const token = `perf-${deviceIds.length + 1}-token`;
    const [d] = await db
      .insert(devices)
      .values({
        familyId: family.id,
        kidId: kid.id,
        name: `Perf device ${deviceIds.length + 1}`,
        platform: 'android',
        form: 'phone',
        pool: 'screens',
        tokenHash: hashDeviceToken(token),
      })
      .returning({ id: devices.id });
    deviceIds.push(d.id);
  }

  // Insert one year of app_usage_daily: 365 days × 3 devices × 60 packages = 65,700 rows.
  const packages = Array.from({ length: 60 }, (_, i) => `com.perf.app${i}`);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Clear any existing perf rows.
  await db
    .delete(appUsageDaily)
    .where(sql`(${inArray(appUsageDaily.deviceId, deviceIds)}) and ${appUsageDaily.package} like 'com.perf.app%'`);

  const batchSize = 1000;
  const rows: { familyId: string; kidId: string; deviceId: string; day: string; package: string; seconds: number }[] = [];
  for (let d = 364; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const day = date.toISOString().slice(0, 10);
    for (const deviceId of deviceIds) {
      for (const pkg of packages) {
        rows.push({ familyId: family.id, kidId: kid.id, deviceId, day, package: pkg, seconds: Math.floor(Math.random() * 3600) + 1 });
      }
    }
  }

  console.log(`Inserting ${rows.length} rows...`);
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.insert(appUsageDaily).values(rows.slice(i, i + batchSize));
  }
  console.log('Done inserting.');

  // Time a month report three times.
  const monthDate = today.slice(0, 8) + '01';
  const timings: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const report = await withFamily(db, family.id, (tx) => buildAppReport(tx, { kidId: kid.id, period: 'month', date: monthDate, deviceId: null }));
    const elapsed = performance.now() - start;
    timings.push(elapsed);
    console.log(`Run ${i + 1}: ${elapsed.toFixed(1)} ms (apps: ${report.apps.length}, screenTime: ${report.screenTime.length})`);
  }

  const max = Math.max(...timings);
  console.log(`\nMax: ${max.toFixed(1)} ms ${max < 200 ? 'PASS' : 'FAIL'} (target: <200 ms)`);
} finally {
  await pool.end();
}
