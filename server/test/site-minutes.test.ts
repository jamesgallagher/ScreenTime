import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, scheduleVersions, siteDaily, siteLookups } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { Pusher } from '../src/push.js';
import { backfillSites } from '../src/sites/backfill.js';
import { client, resetDatabase, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('site active minutes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const pusher: Pusher = { async send() { return []; } };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });

  let family = '';
  let kid = '';
  const phone = { id: '', token: '' };
  const pc = { id: '', token: '' };
  const tablet = { id: '', token: '' };

  /** The card's fixed date (CARD-070, docs/SPEC.md §12.10). */
  const FIXED_NOW = new Date('2026-11-12T00:00:00Z');

  async function addDevice(name: string, platform: 'android' | 'windows', form: 'phone' | 'tablet' | 'pc', pool: 'phone' | 'screens', enrolledAt: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId: family,
        kidId: kid,
        platform,
        form,
        pool,
        name,
        tokenHash: hashDeviceToken(token),
        enrolledAt: new Date(enrolledAt),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
    await resetDatabase(db, pool);
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    if (!a) throw new Error('no family');
    family = a.id;
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Sam', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '07:00', bedtime: '20:30' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(phone, await addDevice('Phone', 'android', 'phone', 'phone', '2026-11-01T00:00:00Z'));
    Object.assign(pc, await addDevice('PC', 'windows', 'pc', 'screens', '2026-11-01T00:00:01Z'));
    Object.assign(tablet, await addDevice('Tablet', 'android', 'tablet', 'screens', '2026-11-01T00:00:02Z'));
  });

  const upload = (token: string, lookups: unknown[]) => api.post('/v1/device/site-lookups', token, { lookups });

  /** Fixture S of CARD-070, in the order the card's devices post it. */
  const L1 = { at: '2026-11-10T01:00:05Z', host: 'www.khanacademy.org', package: 'com.android.chrome' };
  const L2 = { at: '2026-11-10T01:00:30Z', host: 'khanacademy.org', package: 'com.android.chrome' };
  const L3 = { at: '2026-11-10T01:00:40Z', host: 'cdn.kastatic.org', package: 'com.android.chrome' };
  const L4 = { at: '2026-11-10T01:00:50Z', host: 'www.khanacademy.org', package: 'com.pt.bark' };
  const L5 = { at: '2026-11-10T01:01:10Z', host: 'www.khanacademy.org', package: 'com.android.chrome' };
  const L6 = { at: '2026-11-10T01:02:00Z', host: 'api.bark.us', package: 'com.pt.bark' };
  const L7 = { at: '2026-11-10T01:05:00Z', host: 'khanacademy.org', package: 'com.android.chrome' };
  const L8 = { at: '2026-11-10T12:59:30Z', host: 'www.youtube.com', package: 'com.google.android.youtube' };
  const L9 = { at: '2026-11-10T13:00:30Z', host: 'www.youtube.com', package: 'com.google.android.youtube' };
  const L10 = { at: '2026-11-10T13:00:45Z', host: 'rr3---sn-x.googlevideo.com', package: 'com.google.android.youtube' };
  const L11 = { at: '2026-11-11T02:00:00Z', host: 'www.khanacademy.org', package: 'msedge.exe' };
  const L12 = { at: '2026-11-11T02:00:20Z', host: 'www.sportsbet.com.au', package: 'msedge.exe' };
  const L13 = { at: '2026-11-10T03:00:00Z', host: 'www.roblox.com', package: 'com.roblox.client' };

  async function dailyRows(deviceId: string) {
    return db.select().from(siteDaily).where(eq(siteDaily.deviceId, deviceId));
  }

  it('migration 0017 adds site and minutes, and gives site_overrides RLS', async () => {
    const columns = await db.execute<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }>(sql`
      select table_name, column_name, is_nullable, column_default
      from information_schema.columns
      where (table_name = 'site_lookups' and column_name = 'site')
         or (table_name = 'site_daily' and column_name = 'minutes')
      order by table_name, column_name
    `);
    expect(columns.rows).toEqual([
      { table_name: 'site_daily', column_name: 'minutes', is_nullable: 'NO', column_default: '0' },
      { table_name: 'site_lookups', column_name: 'site', is_nullable: 'YES', column_default: null },
    ]);

    const rls = await db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select relname, relrowsecurity from pg_class where relname in ('site_classes', 'site_overrides') order by relname
    `);
    expect(rls.rows).toEqual([
      { relname: 'site_classes', relrowsecurity: false },
      { relname: 'site_overrides', relrowsecurity: true },
    ]);

    const policy = await db.execute<{ policyname: string }>(sql`select policyname from pg_policies where tablename = 'site_overrides'`);
    expect(policy.rows.map((r) => r.policyname)).toEqual(['family_isolation']);
    const pk = await db.execute<{ constraint: string }>(sql`
      select conname as constraint from pg_constraint where contype = 'p' and conrelid = 'site_overrides'::regclass
    `);
    expect(pk.rows.map((r) => r.constraint)).toEqual(['site_overrides_family_id_site_pk']);
  });

  it('counts active minutes from the raw rows: two calls, 2 minutes then 3', async () => {
    expect((await upload(phone.token, [L1, L3, L5, L8, L9, L10])).body).toEqual({ received: 6 });
    let khan = (await dailyRows(phone.id)).find((r) => r.site === 'khanacademy.org' && r.package === 'com.android.chrome');
    expect(khan?.lookups).toBe(2);
    expect(khan?.minutes).toBe(2);

    expect((await upload(phone.token, [L2, L4, L6, L7])).body).toEqual({ received: 4 });
    khan = (await dailyRows(phone.id)).find((r) => r.site === 'khanacademy.org' && r.package === 'com.android.chrome');
    expect(khan?.lookups).toBe(4);
    expect(khan?.minutes).toBe(3);

    // Every raw row has its registrable domain, including a host with a "-" run.
    const raw = await db.select().from(siteLookups).where(eq(siteLookups.deviceId, phone.id));
    expect(raw.every((r) => r.site !== null)).toBe(true);
    expect(raw.find((r) => r.host === 'www.khanacademy.org')?.site).toBe('khanacademy.org');
    expect(raw.find((r) => r.host === 'rr3---sn-x.googlevideo.com')?.site).toBe('googlevideo.com');
  });

  it('after every upload, site_daily is exactly the ten fixture rows', async () => {
    await upload(phone.token, [L1, L3, L5, L8, L9, L10]);
    await upload(phone.token, [L2, L4, L6, L7]);
    await upload(pc.token, [L11, L12]);
    await upload(tablet.token, [L13]);

    const names = new Map([
      [phone.id, 'P'],
      [pc.id, 'W'],
      [tablet.id, 'T'],
    ]);
    const rows = (await db.select().from(siteDaily))
      .map((r) => [names.get(r.deviceId), r.day, r.site, r.package, r.lookups, r.minutes])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2])) || String(a[3]).localeCompare(String(b[3])));
    expect(rows).toEqual([
      ['P', '2026-11-10', 'bark.us', 'com.pt.bark', 1, 1],
      ['P', '2026-11-10', 'kastatic.org', 'com.android.chrome', 1, 1],
      ['P', '2026-11-10', 'khanacademy.org', 'com.android.chrome', 4, 3],
      ['P', '2026-11-10', 'khanacademy.org', 'com.pt.bark', 1, 1],
      ['P', '2026-11-10', 'youtube.com', 'com.google.android.youtube', 1, 1],
      ['P', '2026-11-11', 'googlevideo.com', 'com.google.android.youtube', 1, 1],
      ['P', '2026-11-11', 'youtube.com', 'com.google.android.youtube', 1, 1],
      ['T', '2026-11-10', 'roblox.com', 'com.roblox.client', 1, 1],
      ['W', '2026-11-11', 'khanacademy.org', 'msedge.exe', 1, 1],
      ['W', '2026-11-11', 'sportsbet.com.au', 'msedge.exe', 1, 1],
    ]);

    // Every raw row of fixture S has its site, on every device.
    const raw = await db.select().from(siteLookups);
    expect(raw).toHaveLength(13);
    expect(raw.every((r) => r.site !== null)).toBe(true);
    expect(raw.find((r) => r.host === 'www.roblox.com')?.site).toBe('roblox.com');
    expect(raw.find((r) => r.host === 'www.sportsbet.com.au')?.site).toBe('sportsbet.com.au');
  });

  it('backfill fills site and recounts minutes, then changes nothing the second time', async () => {
    const at = (iso: string) => new Date(iso);
    await db.insert(siteLookups).values([
      { familyId: family, kidId: kid, deviceId: phone.id, at: at(L1.at), host: L1.host, package: L1.package },
      { familyId: family, kidId: kid, deviceId: phone.id, at: at(L2.at), host: L2.host, package: L2.package },
      { familyId: family, kidId: kid, deviceId: phone.id, at: at(L5.at), host: L5.host, package: L5.package },
      { familyId: family, kidId: kid, deviceId: phone.id, at: at(L7.at), host: L7.host, package: L7.package },
    ]);
    await db.insert(siteDaily).values([
      { familyId: family, kidId: kid, deviceId: phone.id, day: '2026-11-10', site: 'khanacademy.org', package: 'com.android.chrome', lookups: 4, minutes: 0, firstAt: at(L1.at), lastAt: at(L7.at) },
      { familyId: family, kidId: kid, deviceId: phone.id, day: '2026-08-01', site: 'khanacademy.org', package: 'com.android.chrome', lookups: 9, minutes: 0, firstAt: at('2026-08-01T01:00:00Z'), lastAt: at('2026-08-01T01:00:00Z') },
    ]);

    const first = await backfillSites(db);
    expect(first.filled).toBe(4);
    expect(first.recounted).toBe(1);
    const raw = await db.select().from(siteLookups).where(eq(siteLookups.deviceId, phone.id));
    expect(raw.every((r) => r.site === 'khanacademy.org')).toBe(true);
    const rows = await dailyRows(phone.id);
    expect(rows.find((r) => r.day === '2026-11-10')?.minutes).toBe(3);
    expect(rows.find((r) => r.day === '2026-08-01')?.minutes).toBe(0);

    const second = await backfillSites(db);
    expect(second.filled).toBe(0);
    expect(second.recounted).toBe(1);
    const again = await dailyRows(phone.id);
    expect(again.find((r) => r.day === '2026-11-10')?.minutes).toBe(3);
    expect(again.find((r) => r.day === '2026-08-01')?.minutes).toBe(0);
  });
});
