// Gives a kid two make-believe devices, Report Phone and Report PC, and one family-local day of app, website and
// search data for the reports (CARD-075), straight into the tables. Running it again adds nothing: it removes the
// two devices and every row of theirs first.
// Usage (from the repo root, with DATABASE_URL set): pnpm --filter @screentime/server exec tsx scripts/dev-report-data.ts <kid name> <YYYY-MM-DD>
// Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import {
  appUsageDaily,
  deviceApps,
  deviceGames,
  devicePrograms,
  devices,
  enrolmentCodes,
  events,
  families,
  kidMessages,
  kids,
  parentModeSessions,
  searches,
  siteClasses,
  siteDaily,
  siteLookups,
  siteTitles,
  sosIncidents,
  timeRequests,
  usageSegments,
} from '../src/db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const kidName = process.argv[2]?.trim();
const day = process.argv[3]?.trim();
if (!databaseUrl || !kidName || !day) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-report-data.ts <kid name> <YYYY-MM-DD>');
  process.exit(1);
}
// A real YYYY-MM-DD date only ("2026-13-01" and "2026-02-30" fail).
if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
  console.error(`The date must be a real YYYY-MM-DD date, not '${day}'.`);
  process.exit(1);
}

/** `date` plus `days`, YYYY-MM-DD. Calendar arithmetic on the string only: no zone ever moves a date. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  const [family] = await db.select().from(families).where(eq(families.id, kid.familyId)).limit(1);
  if (!family) throw new Error(`no family for ${kid.name}`);
  const zone = family.timezone;

  /** A wall-clock time on a family-local day, as a UTC instant, converted through the zone (never by adding hours). */
  const localAt = async (localDay: string, localTime: string): Promise<Date> => {
    const result = await db.execute<{ at: string }>(
      sql`select to_json((${localDay}::date + ${localTime}::time) at time zone ${zone}) #>> '{}' as at`,
    );
    return new Date(result.rows[0]!.at);
  };

  // Idempotent: away with the two devices of an earlier run and every row that references them.
  const oldRows = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.kidId, kid.id), inArray(devices.name, ['Report Phone', 'Report PC'])));
  const oldIds = oldRows.map((r) => r.id);
  if (oldIds.length > 0) {
    await db.delete(enrolmentCodes).where(inArray(enrolmentCodes.deviceId, oldIds));
    await db.delete(timeRequests).where(inArray(timeRequests.deviceId, oldIds));
    await db.delete(usageSegments).where(inArray(usageSegments.deviceId, oldIds));
    await db.delete(kidMessages).where(inArray(kidMessages.deviceId, oldIds));
    await db.delete(parentModeSessions).where(inArray(parentModeSessions.deviceId, oldIds));
    await db.delete(sosIncidents).where(inArray(sosIncidents.deviceId, oldIds));
    await db.delete(events).where(inArray(events.deviceId, oldIds));
    await db.delete(deviceApps).where(inArray(deviceApps.deviceId, oldIds));
    await db.delete(appUsageDaily).where(inArray(appUsageDaily.deviceId, oldIds));
    await db.delete(deviceGames).where(inArray(deviceGames.deviceId, oldIds));
    await db.delete(devicePrograms).where(inArray(devicePrograms.deviceId, oldIds));
    await db.delete(siteLookups).where(inArray(siteLookups.deviceId, oldIds));
    await db.delete(siteDaily).where(inArray(siteDaily.deviceId, oldIds));
    await db.delete(siteTitles).where(inArray(siteTitles.deviceId, oldIds));
    await db.delete(searches).where(inArray(searches.deviceId, oldIds));
    await db.delete(devices).where(inArray(devices.id, oldIds));
    console.log(`removed ${oldIds.length} earlier Report device(s) of ${kid.name} and their rows`);
  }

  const before3 = addDays(day, -3); // when the two devices were "enrolled"
  const before2 = addDays(day, -2); // the PC's one site sits on this day, outside the given day
  const enrolledAt = await localAt(before3, '09:00');
  const phoneLastAt = await localAt(day, '21:40');
  const pcLastAt = await localAt(day, '19:20');

  // The sites' classes, set by hand so no classifier is needed (no CLASSIFIER_URL on the dev server).
  await db
    .insert(siteClasses)
    .values({ site: 'youtube.com', kind: 'website', category: 'video', label: 'YouTube', owner: null })
    .onConflictDoUpdate({ target: siteClasses.site, set: { kind: 'website', category: 'video', label: 'YouTube', owner: null } });
  console.log('site_classes youtube.com website video "YouTube"');
  await db
    .insert(siteClasses)
    .values({ site: 'stake.com', kind: 'website', category: 'gambling', label: 'Stake', owner: null })
    .onConflictDoUpdate({ target: siteClasses.site, set: { kind: 'website', category: 'gambling', label: 'Stake', owner: null } });
  console.log('site_classes stake.com website gambling "Stake"');
  await db
    .insert(siteClasses)
    .values({ site: 'ytimg.com', kind: 'cdn', category: null, label: null, owner: 'youtube.com' })
    .onConflictDoUpdate({ target: siteClasses.site, set: { kind: 'cdn', category: null, label: null, owner: 'youtube.com' } });
  console.log('site_classes ytimg.com cdn owner youtube.com');
  await db
    .insert(siteClasses)
    .values({ site: 'example.com', kind: 'website', category: null, label: 'Example', owner: null })
    .onConflictDoUpdate({ target: siteClasses.site, set: { kind: 'website', category: null, label: 'Example', owner: null } });
  console.log('site_classes example.com website "Example"');

  // The two devices. Both record apps (Android always does; the PC has a program), sites and searches.
  const [phone] = await db
    .insert(devices)
    .values({
      familyId: family.id,
      kidId: kid.id,
      platform: 'android',
      form: 'phone',
      pool: 'phone',
      name: 'Report Phone',
      hasCellular: true,
      model: 'Pixel 8',
      osVersion: '15',
      tokenHash: `dev-report-phone-${kid.id}`,
      searchCapture: 'on',
      enrolledAt,
      lastSeenAt: phoneLastAt,
    })
    .returning({ id: devices.id });
  const [pc] = await db
    .insert(devices)
    .values({
      familyId: family.id,
      kidId: kid.id,
      platform: 'windows',
      form: 'pc',
      pool: 'screens',
      name: 'Report PC',
      hasCellular: false,
      model: 'Desk PC 900',
      osVersion: 'Windows 11 Pro',
      tokenHash: `dev-report-pc-${kid.id}`,
      searchCapture: 'on',
      enrolledAt,
      lastSeenAt: pcLastAt,
    })
    .returning({ id: devices.id });
  console.log(`device Report Phone ${phone.id}`);
  console.log(`device Report PC ${pc.id}`);

  // The app labels on the phone (Chrome too, so the Websites report can say "Google in Chrome").
  const appsOnPhone: { package: string; label: string; source: 'preinstalled' | 'play'; installer: string | null; blockable: boolean }[] = [
    { package: 'com.roblox.client', label: 'Roblox', source: 'play', installer: 'com.android.vending', blockable: true },
    { package: 'com.google.android.youtube', label: 'YouTube', source: 'play', installer: 'com.android.vending', blockable: true },
    { package: 'com.android.settings', label: 'Settings', source: 'preinstalled', installer: null, blockable: false },
    { package: 'com.android.chrome', label: 'Chrome', source: 'play', installer: 'com.android.vending', blockable: true },
  ];
  for (const a of appsOnPhone) {
    await db.insert(deviceApps).values({
      familyId: family.id,
      kidId: kid.id,
      deviceId: phone.id,
      package: a.package,
      label: a.label,
      source: a.source,
      installer: a.installer,
      blockable: a.blockable,
      installedAt: enrolledAt,
      firstSeenAt: enrolledAt,
      firstUsedAt: null,
      removedAt: null,
      baseline: false,
    });
    console.log(`device_apps ${a.package} "${a.label}" on Report Phone`);
  }

  // The program label on the PC, and the app seconds of the given day.
  await db.insert(devicePrograms).values({
    familyId: family.id,
    kidId: kid.id,
    deviceId: pc.id,
    package: 'minecraft.exe',
    label: 'Minecraft',
    firstSeenAt: enrolledAt,
    lastSeenAt: pcLastAt,
  });
  console.log('device_programs minecraft.exe "Minecraft" on Report PC');
  const usage: { deviceId: string; package: string; seconds: number; on: string }[] = [
    { deviceId: phone.id, package: 'com.roblox.client', seconds: 3000, on: 'Report Phone' },
    { deviceId: phone.id, package: 'com.google.android.youtube', seconds: 2400, on: 'Report Phone' },
    { deviceId: phone.id, package: 'com.android.settings', seconds: 40, on: 'Report Phone' },
    { deviceId: pc.id, package: 'minecraft.exe', seconds: 1200, on: 'Report PC' },
  ];
  for (const u of usage) {
    await db.insert(appUsageDaily).values({
      familyId: family.id,
      kidId: kid.id,
      deviceId: u.deviceId,
      package: u.package,
      day,
      seconds: u.seconds,
    });
    console.log(`app ${u.package} ${u.seconds} s on ${u.on} (${day})`);
  }

  // The sites of the given day on the phone, plus one site on the PC two days earlier: the PC then counts as
  // recording sites (a site_daily row exists) but adds nothing to the given day's Websites report.
  const siteRows: { deviceId: string; on: string; day: string; site: string; pkg: string; minutes: number; lookups: number; from: string; to: string; note: string }[] = [
    { deviceId: phone.id, on: 'Report Phone', day, site: 'youtube.com', pkg: 'com.android.chrome', minutes: 12, lookups: 30, from: '15:05', to: '21:40', note: '' },
    { deviceId: phone.id, on: 'Report Phone', day, site: 'stake.com', pkg: 'com.android.chrome', minutes: 3, lookups: 8, from: '20:10', to: '20:30', note: '' },
    { deviceId: phone.id, on: 'Report Phone', day, site: 'ytimg.com', pkg: 'com.google.android.youtube', minutes: 5, lookups: 120, from: '16:02', to: '18:34', note: '' },
    { deviceId: pc.id, on: 'Report PC', day: before2, site: 'example.com', pkg: 'msedge.exe', minutes: 1, lookups: 3, from: '10:00', to: '10:20', note: ` (${before2}, outside the given day, so it never reaches ${day}'s Websites report)` },
  ];
  for (const s of siteRows) {
    await db.insert(siteDaily).values({
      familyId: family.id,
      kidId: kid.id,
      deviceId: s.deviceId,
      day: s.day,
      site: s.site,
      package: s.pkg,
      lookups: s.lookups,
      minutes: s.minutes,
      firstAt: await localAt(s.day, s.from),
      lastAt: await localAt(s.day, s.to),
    });
    console.log(`site ${s.site} ${s.minutes} min on ${s.on}${s.note}`);
  }

  // The two searches on the phone, at their family-local times.
  const volcanoAt = await localAt(day, '16:20');
  await db.insert(searches).values({
    familyId: family.id,
    kidId: kid.id,
    deviceId: phone.id,
    at: volcanoAt,
    lastAt: volcanoAt,
    count: 1,
    engine: 'google',
    query: 'volcano facts',
    package: 'com.android.chrome',
    private: false,
    source: 'android',
  });
  console.log(`search "volcano facts" at 16:20 on Report Phone (${volcanoAt.toISOString()})`);
  const robloxAt = await localAt(day, '15:12');
  await db.insert(searches).values({
    familyId: family.id,
    kidId: kid.id,
    deviceId: phone.id,
    at: robloxAt,
    lastAt: robloxAt,
    count: 1,
    engine: 'google',
    query: 'roblox promo codes',
    package: 'com.google.android.googlequicksearchbox',
    private: null,
    source: 'android',
  });
  console.log(`search "roblox promo codes" at 15:12 on Report Phone (${robloxAt.toISOString()})`);

  // Two closed segments, so the Screen time card says 50m of phone and 20m of screens.
  const phoneSeg = { start: await localAt(day, '16:00'), end: await localAt(day, '16:50') };
  await db.insert(usageSegments).values({
    id: randomUUID(),
    familyId: family.id,
    kidId: kid.id,
    deviceId: phone.id,
    pool: 'phone',
    startedAt: phoneSeg.start,
    endedAt: phoneSeg.end,
  });
  console.log('segment Report Phone phone 16:00-16:50 local (3000 s)');
  const pcSeg = { start: await localAt(day, '19:00'), end: await localAt(day, '19:20') };
  await db.insert(usageSegments).values({
    id: randomUUID(),
    familyId: family.id,
    kidId: kid.id,
    deviceId: pc.id,
    pool: 'screens',
    startedAt: pcSeg.start,
    endedAt: pcSeg.end,
  });
  console.log('segment Report PC screens 19:00-19:20 local (1200 s)');

  console.log(`Report Phone ${phone.id}`);
  console.log(`Report PC ${pc.id}`);
} finally {
  await pool.end();
}
