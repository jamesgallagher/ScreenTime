// Criterion 11: inserts one year of app_usage_daily for 3 devices and 60 packages a day (about 65,000 rows)
// and times a month report for All devices. Run three times; all must be under 200 ms.
// Usage (from the repo root, with DATABASE_URL set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-report-perf.ts
// Never run this against the production database.
import { eq, inArray } from 'drizzle-orm';
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
const created: string[] = [];

try {
  // Find the first family and kid.
  const [family] = await db.select().from(families).limit(1);
  if (!family) throw new Error('no family: run scripts/seed-dev.ts first');
  const [kid] = await db.select().from(kids).where(eq(kids.familyId, family.id)).limit(1);
  if (!kid) throw new Error(`no kid in family ${family.id}`);

  // Three devices of its own, removed again at the end, so the development database keeps no perf rows.
  const deviceIds: string[] = [];
  for (let n = 1; n <= 3; n++) {
    const [d] = await db
      .insert(devices)
      .values({
        familyId: family.id,
        kidId: kid.id,
        name: `Perf device ${n}`,
        platform: 'android',
        form: 'phone',
        pool: 'screens',
        tokenHash: hashDeviceToken(`perf-${n}-${Date.now()}`),
      })
      .returning({ id: devices.id });
    if (!d) throw new Error('no device');
    deviceIds.push(d.id);
  }
  created.push(...deviceIds);

  // Insert one year of app_usage_daily: 365 days × 3 devices × 60 packages = 65,700 rows.
  const packages = Array.from({ length: 60 }, (_, i) => `com.perf.app${i}`);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

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
  if (created.length > 0) {
    await db.delete(appUsageDaily).where(inArray(appUsageDaily.deviceId, created));
    await db.delete(devices).where(inArray(devices.id, created));
    console.log(`Removed the ${created.length} perf devices and their rows.`);
  }
  await pool.end();
}
