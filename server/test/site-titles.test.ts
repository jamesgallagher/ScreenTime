import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, parentSessions, parents, scheduleVersions, siteDaily, siteLookups, siteTitles } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { sweep } from '../src/jobs/sweep.js';
import { withFamily } from '../src/db/family.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('browser titles', () => {
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

  // The card's dates are in November 2026; the route skips anything more than 30 days before its clock, so fix "now".
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

  const upload = (token: string, titles: unknown[]) => api.post('/v1/device/site-titles', token, { titles });

  const rawRows = async (deviceId: string) => (await db.select().from(siteTitles).where(eq(siteTitles.deviceId, deviceId)));

  it('migration 0016 creates site_titles with its primary key and RLS', async () => {
    const policies = await db.execute<{ polname: string }>(sql`select policyname as polname from pg_policies where tablename = 'site_titles'`);
    expect(policies.rows.map((r) => r.polname)).toEqual(['family_isolation']);
    const pk = await db.execute<{ constraint: string }>(sql`
      select conname as constraint from pg_constraint where contype = 'p' and conrelid = 'site_titles'::regclass order by conname
    `);
    expect(pk.rows.map((r) => r.constraint)).toEqual(['site_titles_device_id_at_package_pk']);
  });

  it('stores two titles exactly as sent, with the device family, kid and device', async () => {
    const res = await upload(phone.token, [
      { at: '2026-11-10T01:00:00Z', sec: 42, package: 'msedge.exe', title: 'how to draw - Search and 2 more pages - [InPrivate] - Microsoft Edge' },
      { at: '2026-11-10T01:00:42Z', sec: 7, package: 'firefox.exe', title: 'Wikipedia — Mozilla Firefox Private Browsing' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 2 });
    const rows = (await rawRows(phone.id)).sort((a, b) => (a.at < b.at ? -1 : 1));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      familyId: family,
      kidId: kid,
      deviceId: phone.id,
      at: new Date('2026-11-10T01:00:00Z'),
      sec: 42,
      package: 'msedge.exe',
      title: 'how to draw - Search and 2 more pages - [InPrivate] - Microsoft Edge',
    });
    expect(rows[1]).toMatchObject({
      familyId: family,
      kidId: kid,
      deviceId: phone.id,
      at: new Date('2026-11-10T01:00:42Z'),
      sec: 7,
      package: 'firefox.exe',
      title: 'Wikipedia — Mozilla Firefox Private Browsing',
    });
  });

  it('a repeat upload adds nothing, and a newer second with the same start does not change it', async () => {
    const body = [
      { at: '2026-11-10T01:00:00Z', sec: 42, package: 'msedge.exe', title: 'how to draw - Search and 2 more pages - [InPrivate] - Microsoft Edge' },
      { at: '2026-11-10T01:00:42Z', sec: 7, package: 'firefox.exe', title: 'Wikipedia — Mozilla Firefox Private Browsing' },
    ];
    expect((await upload(phone.token, body)).body).toEqual({ received: 2 });
    expect((await upload(phone.token, body)).body).toEqual({ received: 0 });
    expect(await rawRows(phone.id)).toHaveLength(2);
    // The same start again with a different second count: the primary key keeps the first row.
    expect((await upload(phone.token, [{ at: '2026-11-10T01:00:00Z', sec: 50, package: 'msedge.exe', title: 'how to draw - Search and 2 more pages - [InPrivate] - Microsoft Edge' }])).body).toEqual({
      received: 0,
    });
    const first = (await rawRows(phone.id)).find((r) => r.at.toISOString() === '2026-11-10T01:00:00.000Z');
    expect(first?.sec).toBe(42);
    expect(await rawRows(phone.id)).toHaveLength(2);
  });

  it('skips a title more than 30 days old or more than 1 day ahead', async () => {
    const res = await upload(phone.token, [
      { at: '2026-10-12T23:00:00Z', sec: 5, package: 'msedge.exe', title: 'old' },
      { at: '2026-11-11T23:00:00Z', sec: 5, package: 'msedge.exe', title: 'in range' },
      { at: '2026-11-13T01:00:00Z', sec: 5, package: 'msedge.exe', title: 'ahead' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 1 });
    const rows = await rawRows(phone.id);
    expect(rows.map((r) => r.title)).toEqual(['in range']);
  });

  it('refuses invalid titles, storing nothing', async () => {
    const valid = { at: '2026-11-10T01:00:00Z', sec: 42, package: 'msedge.exe', title: 'a title' };
    const sec0 = { ...valid, sec: 0 };
    const secTooBig = { ...valid, sec: 86_401 };
    const secFraction = { ...valid, sec: 1.5 };
    const titleTooLong = { ...valid, title: 'x'.repeat(301) };
    const titleEmpty = { ...valid, title: '' };
    const packageEmpty = { ...valid, package: '' };
    const tooMany = Array.from({ length: 501 }, () => valid);
    for (const [name, titles] of [
      ['sec 0', [sec0]],
      ['sec 86,401', [secTooBig]],
      ['sec 1.5', [secFraction]],
      ['title 301 characters', [titleTooLong]],
      ['empty title', [titleEmpty]],
      ['empty package', [packageEmpty]],
      ['501 titles', tooMany],
      ['empty titles array', []],
    ] as const) {
      const res = await upload(phone.token, titles);
      expect(res.status, name).toBe(422);
    }
    expect(await rawRows(phone.id)).toHaveLength(0);
  });

  it('keeps other families out: writes stay in their own family, reads see only their own', async () => {
    // A device of family B posts: its rows carry family B.
    const res = await upload(otherPhone.token, [{ at: '2026-11-10T01:00:00Z', sec: 5, package: 'firefox.exe', title: 'Ben title' }]);
    expect(res.status).toBe(200);
    const benRows = (await rawRows(otherPhone.id));
    expect(benRows).toHaveLength(1);
    expect(benRows[0]?.familyId).toBe(otherFamily);

    // A parent of family B sees none of family A's rows through RLS.
    await upload(phone.token, [{ at: '2026-11-10T01:00:00Z', sec: 5, package: 'msedge.exe', title: 'Alex title' }]);
    // Querying as family B (row-level security) shows only family B's rows.
    const all = await withFamily(db, otherFamily, (tx) => tx.select().from(siteTitles));
    expect(all.map((r) => r.deviceId)).toEqual([otherPhone.id]);
    // And family A's parent still sees only family A.
    const mine = await withFamily(db, family, (tx) => tx.select().from(siteTitles));
    expect(mine.map((r) => r.deviceId)).toEqual([phone.id]);
  });

  it('the sweep deletes titles older than 90 days and still deletes site_lookups', async () => {
    // The API only stores titles within 30 days (criterion 4), so the test seeds the 89- and 91-day-old rows
    // directly. The sweep compares against Postgres's own clock, so the offsets are from the server's now.
    vi.useRealTimers();
    const now = Date.now();
    const atKept = new Date(now - 89 * 86_400_000);
    const atGone = new Date(now - 91 * 86_400_000);
    await db.insert(siteTitles).values([
      { familyId: family, kidId: kid, deviceId: phone.id, at: atKept, sec: 5, package: 'msedge.exe', title: 'kept' },
      { familyId: family, kidId: kid, deviceId: phone.id, at: atGone, sec: 5, package: 'msedge.exe', title: 'gone' },
    ]);
    await db.insert(siteLookups).values([
      { familyId: family, kidId: kid, deviceId: phone.id, at: atKept, host: 'kept.example.com', package: 'msedge.exe' },
      { familyId: family, kidId: kid, deviceId: phone.id, at: atGone, host: 'gone.example.com', package: 'msedge.exe' },
    ]);
    expect((await rawRows(phone.id))).toHaveLength(2);
    expect((await db.select().from(siteLookups).where(eq(siteLookups.deviceId, phone.id)))).toHaveLength(2);
    await sweep({ db, config: testConfig(url ?? ''), mailer, pusher });
    const titles = (await rawRows(phone.id)).map((r) => r.title);
    expect(titles).toEqual(['kept']);
    const lookups = (await db.select().from(siteLookups).where(eq(siteLookups.deviceId, phone.id))).map((r) => r.host);
    expect(lookups).toEqual(['kept.example.com']);
  });
});
