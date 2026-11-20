import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, parentSessions, parents, scheduleVersions, siteDaily, siteLookups } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { sweep } from '../src/jobs/sweep.js';
import { withFamily } from '../src/db/family.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('website lookups', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });

  let family = '';
  let otherFamily = '';
  let dad = '';
  let otherDad = '';
  let kid = '';
  const phone = { id: '', token: '' };
  const otherPhone = { id: '', token: '' };

  /** The card's fixed date (docs/SPEC.md §12.10). */
  const DAY = '2026-11-10';

  async function addDevice(familyId: string, kidId: string, name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: 'android',
        form: 'phone',
        pool: 'phone',
        name,
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function signIn(familyId: string, parentId: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'web', clientLabel: 'Web' })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  /** The card's dates are in November 2026; the route skips anything more than 30 days before its clock, so fix "now". */
  const FIXED_NOW = new Date('2026-11-12T00:00:00Z');

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
    await resetDatabase(db, pool);
    sent.length = 0;
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    const [b] = await db.insert(families).values({ name: 'B', timezone: 'Australia/Sydney', parentCodeSecret: 'B'.repeat(32) }).returning();
    if (!a || !b) throw new Error('no family');
    family = a.id;
    otherFamily = b.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    const [q] = await db.insert(parents).values({ familyId: otherFamily, email: 'bea@example.com', displayName: 'Bea' }).returning();
    if (!p || !q) throw new Error('no parent');
    dad = await signIn(family, p.id);
    otherDad = await signIn(otherFamily, q.id);
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '07:00', bedtime: '20:30' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(phone, await addDevice(family, kid, 'Pixel 7'));
    // Family B has its own kid and device, so the isolation test can post with its own token.
    const [bk] = await db.insert(kids).values({ familyId: otherFamily, name: 'Ben', avatarColor: '#7C3AED' }).returning();
    if (!bk) throw new Error('no kid');
    const bday = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '07:00', bedtime: '20:30' });
    await db.insert(scheduleVersions).values({ familyId: otherFamily, kidId: bk.id, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(bday) });
    Object.assign(otherPhone, await addDevice(otherFamily, bk.id, 'Ben phone'));
  });

  const upload = (token: string, lookups: unknown[]) => api.post('/v1/device/site-lookups', token, { lookups });

  const dailyRows = async (deviceId: string) => (await db.select().from(siteDaily).where(eq(siteDaily.deviceId, deviceId)));

  const rawCount = async (deviceId: string) => (await db.select().from(siteLookups).where(eq(siteLookups.deviceId, deviceId))).length;

  it('migration 0015 creates both tables with their primary keys and RLS', async () => {
    for (const table of ['site_lookups', 'site_daily']) {
      const policies = await db.execute<{ polname: string }>(sql`select policyname as polname from pg_policies where tablename = ${table}`);
      expect(policies.rows.map((r) => r.polname), table).toEqual(['family_isolation']);
    }
    const pk = await db.execute<{ constraint: string }>(sql`
      select conname as constraint from pg_constraint where contype = 'p' and conrelid in ('site_lookups'::regclass, 'site_daily'::regclass) order by conname
    `);
    expect(pk.rows.map((r) => r.constraint)).toEqual(['site_daily_device_id_day_site_package_pk', 'site_lookups_device_id_at_host_package_pk']);
  });

  it('stores two lookups and adds them up per site', async () => {
    const res = await upload(phone.token, [
      { at: '2026-11-10T01:00:00Z', host: 'www.khanacademy.org', package: 'com.android.chrome' },
      { at: '2026-11-10T01:00:05Z', host: 'cdn.kastatic.org', package: 'com.android.chrome' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 2 });
    expect(await rawCount(phone.id)).toBe(2);
    const rows = await dailyRows(phone.id);
    expect(rows).toHaveLength(2);
    const khan = rows.find((r) => r.site === 'khanacademy.org');
    const kastatic = rows.find((r) => r.site === 'kastatic.org');
    expect(khan?.lookups).toBe(1);
    expect(khan?.package).toBe('com.android.chrome');
    expect(khan?.day).toBe(DAY);
    expect(khan?.firstAt.toISOString()).toBe('2026-11-10T01:00:00.000Z');
    expect(khan?.lastAt.toISOString()).toBe('2026-11-10T01:00:00.000Z');
    expect(kastatic?.lookups).toBe(1);
    expect(kastatic?.firstAt.toISOString()).toBe('2026-11-10T01:00:05.000Z');
    expect(kastatic?.lastAt.toISOString()).toBe('2026-11-10T01:00:05.000Z');
  });

  it('a repeat upload changes nothing', async () => {
    const body = [
      { at: '2026-11-10T01:00:00Z', host: 'www.khanacademy.org', package: 'com.android.chrome' },
      { at: '2026-11-10T01:00:05Z', host: 'cdn.kastatic.org', package: 'com.android.chrome' },
    ];
    expect((await upload(phone.token, body)).body).toEqual({ received: 2 });
    const before = await dailyRows(phone.id);
    expect((await upload(phone.token, body)).body).toEqual({ received: 0 });
    expect(await rawCount(phone.id)).toBe(2);
    expect(await dailyRows(phone.id)).toEqual(before);
  });

  it('the site is the registrable domain, or the host when there is none', async () => {
    expect((await upload(phone.token, [{ at: '2026-11-10T01:00:00Z', host: 'www.abc.net.au', package: 'com.android.chrome' }])).body).toEqual({ received: 1 });
    expect((await upload(phone.token, [{ at: '2026-11-10T01:00:01Z', host: 'localhost', package: 'com.android.chrome' }])).body).toEqual({ received: 1 });
    expect((await upload(phone.token, [{ at: '2026-11-10T01:00:02Z', host: 'printer', package: 'com.android.chrome' }])).body).toEqual({ received: 1 });
    const sites = (await dailyRows(phone.id)).map((r) => r.site).sort();
    expect(sites).toEqual(['abc.net.au', 'localhost', 'printer']);
  });

  it('the local day is worked out through the family time zone', async () => {
    // 2026-11-10T13:30:00Z is 2026-11-11 00:30 in Australia/Sydney (UTC+11 in November).
    expect((await upload(phone.token, [{ at: '2026-11-10T13:30:00Z', host: 'late.khanacademy.org', package: 'com.android.chrome' }])).body).toEqual({ received: 1 });
    expect((await upload(phone.token, [{ at: '2026-11-10T12:30:00Z', host: 'early.khanacademy.org', package: 'com.android.chrome' }])).body).toEqual({ received: 1 });
    const rows = await dailyRows(phone.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.site === 'khanacademy.org' && r.lastAt.toISOString() === '2026-11-10T13:30:00.000Z')?.day).toBe('2026-11-11');
    expect(rows.find((r) => r.site === 'khanacademy.org' && r.lastAt.toISOString() === '2026-11-10T12:30:00.000Z')?.day).toBe('2026-11-10');
  });

  it('two lookups of one site become one row with lookups 2', async () => {
    // Posted in two calls, the later one first.
    expect((await upload(phone.token, [{ at: '2026-11-10T03:00:00Z', host: 'www.coolmathgames.com', package: 'com.android.chrome' }])).body).toEqual({ received: 1 });
    expect((await upload(phone.token, [{ at: '2026-11-10T01:00:00Z', host: 'www.coolmathgames.com', package: 'com.android.chrome' }])).body).toEqual({ received: 1 });
    const rows = await dailyRows(phone.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.site).toBe('coolmathgames.com');
    expect(rows[0]?.lookups).toBe(2);
    expect(rows[0]?.firstAt.toISOString()).toBe('2026-11-10T01:00:00.000Z');
    expect(rows[0]?.lastAt.toISOString()).toBe('2026-11-10T03:00:00.000Z');
  });

  it('skips a lookup more than 30 days old or more than 1 day ahead', async () => {
    vi.useRealTimers();
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const res = await upload(phone.token, [
      { at: iso(now - 31 * 86_400_000), host: 'old.example.com', package: 'com.android.chrome' },
      { at: iso(now - 3_600_000), host: 'recent.example.com', package: 'com.android.chrome' },
      { at: iso(now + 2 * 86_400_000), host: 'future.example.com', package: 'com.android.chrome' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 1 });
    const hosts = (await db.select().from(siteLookups).where(eq(siteLookups.deviceId, phone.id))).map((r) => r.host);
    expect(hosts).toEqual(['recent.example.com']);
  });

  it('answers 0 and stores nothing when every lookup is out of range (a phone offline for a month)', async () => {
    vi.useRealTimers();
    const now = Date.now();
    const res = await upload(phone.token, [
      { at: new Date(now - 40 * 86_400_000).toISOString(), host: 'old.example.com', package: 'com.android.chrome' },
      { at: new Date(now - 35 * 86_400_000).toISOString(), host: 'older.example.com', package: 'com.android.chrome' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 0 });
    expect(await rawCount(phone.id)).toBe(0);
    expect(await dailyRows(phone.id)).toEqual([]);
  });

  it('refuses an invalid host, too many lookups, an empty list or an empty package, storing nothing', async () => {
    for (const host of ['Www.Example.com', 'example.com.', 'exa mple.com', 'x'.repeat(254)]) {
      const res = await upload(phone.token, [{ at: '2026-11-10T01:00:00Z', host, package: 'com.android.chrome' }]);
      expect(res.status, host).toBe(422);
    }
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ at: `2026-11-10T0${i % 10}:00:00Z`, host: `host${i}.example.com`, package: 'com.android.chrome' }));
    expect((await upload(phone.token, tooMany)).status).toBe(422);
    expect((await upload(phone.token, [])).status).toBe(422);
    expect((await upload(phone.token, [{ at: '2026-11-10T01:00:00Z', host: 'ok.example.com', package: '' }])).status).toBe(422);
    expect(await rawCount(phone.id)).toBe(0);
  });

  it('keeps other families out: writes stay in their own family, reads see only their own', async () => {
    // A device of family B posts: its rows carry family B.
    const res = await upload(otherPhone.token, [{ at: '2026-11-10T01:00:00Z', host: 'ben.example.com', package: 'com.android.chrome' }]);
    expect(res.status).toBe(200);
    const benRows = await db.select().from(siteLookups).where(eq(siteLookups.deviceId, otherPhone.id));
    expect(benRows).toHaveLength(1);
    expect(benRows[0]?.familyId).toBe(otherFamily);

    // A parent of family B sees none of family A's rows.
    await upload(phone.token, [{ at: '2026-11-10T01:00:00Z', host: 'alex.khanacademy.org', package: 'com.android.chrome' }]);
    // Querying as family B (row-level security) shows only family B's rows.
    const all = await withFamily(db, otherFamily, (tx) => tx.select().from(siteLookups));
    expect(all.map((r) => r.deviceId)).toEqual([otherPhone.id]);
    const daily = await withFamily(db, otherFamily, (tx) => tx.select().from(siteDaily));
    expect(daily.map((r) => r.deviceId)).toEqual([otherPhone.id]);
    // And family A's parent still sees only family A.
    const mine = await withFamily(db, family, (tx) => tx.select().from(siteLookups));
    expect(mine.map((r) => r.deviceId)).toEqual([phone.id]);
  });

  it('the sweep deletes raw lookups older than 90 days and keeps the daily totals', async () => {
    // The API only stores lookups within 30 days (criterion 7), so the test seeds the 89- and 91-day-old rows directly.
    vi.useRealTimers();
    const now = Date.now();
    const dayFor = async (at: Date) =>
      (await db.execute<{ day: string }>(sql`select to_char(${at} at time zone 'Australia/Sydney', 'YYYY-MM-DD') as day`)).rows[0]?.day ?? '';
    const atKept = new Date(now - 89 * 86_400_000);
    const atGone = new Date(now - 91 * 86_400_000);
    await db.insert(siteLookups).values([
      { familyId: family, kidId: kid, deviceId: phone.id, at: atKept, host: 'kept.example.com', package: 'com.android.chrome' },
      { familyId: family, kidId: kid, deviceId: phone.id, at: atGone, host: 'gone.example.com', package: 'com.android.chrome' },
    ]);
    await db.insert(siteDaily).values([
      { familyId: family, kidId: kid, deviceId: phone.id, day: await dayFor(atKept), site: 'kept.example.com', package: 'com.android.chrome', lookups: 1, firstAt: atKept, lastAt: atKept },
      { familyId: family, kidId: kid, deviceId: phone.id, day: await dayFor(atGone), site: 'gone.example.com', package: 'com.android.chrome', lookups: 1, firstAt: atGone, lastAt: atGone },
    ]);
    expect(await rawCount(phone.id)).toBe(2);
    expect((await dailyRows(phone.id)).map((r) => r.site).sort()).toEqual(['gone.example.com', 'kept.example.com']);
    await sweep({ db, config: testConfig(url ?? ''), mailer, pusher });
    const hosts = (await db.select().from(siteLookups).where(eq(siteLookups.deviceId, phone.id))).map((r) => r.host);
    expect(hosts).toEqual(['kept.example.com']);
    expect((await dailyRows(phone.id)).map((r) => r.site).sort()).toEqual(['gone.example.com', 'kept.example.com']);
  });
});
