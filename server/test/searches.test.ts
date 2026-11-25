import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, searches, siteTitles } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { Pusher } from '../src/push.js';
import { sweep } from '../src/jobs/sweep.js';
import { backfillSearches } from '../src/searches/backfill.js';
import { client, resetDatabase, testConfig } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('search upload and PC titles', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const pusher: Pusher = { async send() { return []; } };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });
  const FIXED_NOW = new Date('2026-11-12T12:00:00Z');

  let family = '';
  let kid = '';
  const android = { id: '', token: '' };
  const pc = { id: '', token: '' };

  async function addDevice(
    familyId: string,
    kidId: string,
    name: string,
    platform: 'android' | 'windows',
    form: 'phone' | 'pc',
    enrolledAt: string,
  ) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform,
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
        enrolledAt: new Date(enrolledAt),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
    await resetDatabase(db, pool);
    const [f] = await db.insert(families).values({ name: 'A', timezone: 'UTC', parentCodeSecret: 'A'.repeat(32) }).returning();
    if (!f) throw new Error('no family');
    family = f.id;
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    Object.assign(android, await addDevice(family, kid, 'Phone', 'android', 'phone', '2026-11-01T00:00:00Z'));
    Object.assign(pc, await addDevice(family, kid, 'PC', 'windows', 'pc', '2026-11-01T00:00:01Z'));
  });

  afterEach(() => vi.useRealTimers());
  afterAll(async () => pool.end());

  const upload = (body: unknown, token = android.token) => api.post('/v1/device/searches', token, body);
  const titleUpload = (titles: unknown[], token = pc.token) => api.post('/v1/device/site-titles', token, { titles });
  const searchRows = (deviceId: string) =>
    db.select().from(searches).where(eq(searches.deviceId, deviceId)).orderBy(asc(searches.at));

  const firstSearch = {
    at: '2026-11-12T05:05:00Z',
    lastAt: '2026-11-12T05:05:00Z',
    count: 1,
    engine: 'google',
    query: 'how to bake a cake',
    package: 'com.android.chrome',
  };

  it('1: uploads a search and marks capture on', async () => {
    const response = await upload({ capture: 'on', searches: [firstSearch] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: 1 });
    const [row] = await searchRows(android.id);
    expect(row).toMatchObject({
      familyId: family,
      kidId: kid,
      deviceId: android.id,
      at: new Date('2026-11-12T05:05:00Z'),
      lastAt: new Date('2026-11-12T05:05:00Z'),
      count: 1,
      engine: 'google',
      query: 'how to bake a cake',
      package: 'com.android.chrome',
      private: null,
      source: 'android',
    });
    const [device] = await db.select().from(devices).where(eq(devices.id, android.id));
    expect(device?.searchCapture).toBe('on');
    const policies = await db.execute<{ policyname: string }>(
      sql`select policyname from pg_policies where tablename = 'searches'`,
    );
    expect(policies.rows.map((row) => row.policyname)).toEqual(['family_isolation']);
  });

  it('2: leaves a row unchanged for an identical upload', async () => {
    await upload({ capture: 'on', searches: [firstSearch] });
    const before = await searchRows(android.id);
    const response = await upload({ capture: 'on', searches: [firstSearch] });
    expect(response.body).toEqual({ received: 0 });
    expect(await searchRows(android.id)).toEqual(before);
  });

  it('3: keeps the later lastAt and higher count on upsert', async () => {
    await upload({ capture: 'on', searches: [firstSearch] });
    const newer = { ...firstSearch, lastAt: '2026-11-12T05:09:00Z', count: 3 };
    expect((await upload({ capture: 'on', searches: [newer] })).body).toEqual({ received: 1 });
    expect((await upload({ capture: 'on', searches: [firstSearch] })).body).toEqual({ received: 0 });
    const [row] = await searchRows(android.id);
    expect(row?.lastAt).toEqual(new Date('2026-11-12T05:09:00Z'));
    expect(row?.count).toBe(3);
  });

  it('4: skips searches outside the accepted time window', async () => {
    const tooOld = { ...firstSearch, at: '2026-10-13T11:59:00Z', lastAt: '2026-10-13T11:59:00Z' };
    const tooNew = { ...firstSearch, at: '2026-11-13T12:01:00Z', lastAt: '2026-11-13T12:01:00Z' };
    expect((await upload({ capture: 'on', searches: [tooOld, tooNew] })).body).toEqual({ received: 0 });
    expect(await searchRows(android.id)).toEqual([]);
    const boundary = { ...firstSearch, at: '2026-10-13T12:01:00Z', lastAt: '2026-10-13T12:01:00Z' };
    expect((await upload({ capture: 'on', searches: [boundary] })).body).toEqual({ received: 1 });
  });

  it('5: rejects each invalid upload payload without storing searches', async () => {
    const invalidBodies = [
      { capture: 'on', searches: [{ ...firstSearch, query: '   ' }] },
      { capture: 'on', searches: [{ ...firstSearch, query: 'a'.repeat(201) }] },
      { capture: 'on', searches: [{ ...firstSearch, engine: 'yahoo' }] },
      { capture: 'on', searches: [{ ...firstSearch, count: 0 }] },
      { capture: 'on', searches: [{ ...firstSearch, lastAt: '2026-11-12T05:04:59Z' }] },
      { capture: 'on', searches: Array.from({ length: 501 }, (_, index) => ({ ...firstSearch, at: new Date(Date.parse(firstSearch.at) + index * 1000).toISOString(), lastAt: new Date(Date.parse(firstSearch.at) + index * 1000).toISOString() })) },
      { capture: 'maybe', searches: [] },
    ];
    for (const body of invalidBodies) {
      const response = await upload(body);
      expect(response.status, JSON.stringify(response.body)).toBe(422);
    }
    expect(await searchRows(android.id)).toEqual([]);
  });

  it('6: updates capture state when the upload has no searches', async () => {
    expect((await upload({ capture: 'off', searches: [] })).body).toEqual({ received: 0 });
    let [device] = await db.select().from(devices).where(eq(devices.id, android.id));
    expect(device?.searchCapture).toBe('off');
    expect((await upload({ capture: 'on', searches: [] })).body).toEqual({ received: 0 });
    [device] = await db.select().from(devices).where(eq(devices.id, android.id));
    expect(device?.searchCapture).toBe('on');
  });

  it('7: requires a device token', async () => {
    expect((await upload({ capture: 'on', searches: [] }, null)).status).toBe(401);
  });

  const pcTitles = [
    { at: '2026-11-12T02:00:00Z', sec: 60, title: 'how to draw - Search - [InPrivate] - Microsoft Edge' },
    { at: '2026-11-12T02:01:00Z', sec: 30, title: 'Wikipedia - Profile 1 - Microsoft Edge' },
    { at: '2026-11-12T02:01:30Z', sec: 20, title: 'How to draw - Search - Microsoft Edge' },
    { at: '2026-11-12T02:20:00Z', sec: 10, title: 'how to draw - Search - Microsoft Edge' },
  ].map((title) => ({ ...title, package: 'msedge.exe' }));

  it('8: creates and groups searches from newly inserted PC titles', async () => {
    expect((await titleUpload(pcTitles)).body).toEqual({ received: 4 });
    const rows = await searchRows(pc.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      at: new Date('2026-11-12T02:00:00Z'),
      lastAt: new Date('2026-11-12T02:01:50Z'),
      count: 2,
      engine: 'bing',
      query: 'how to draw',
      private: true,
      package: 'msedge.exe',
      source: 'title',
    });
    expect(rows[1]).toMatchObject({
      at: new Date('2026-11-12T02:20:00Z'),
      lastAt: new Date('2026-11-12T02:20:10Z'),
      count: 1,
      query: 'how to draw',
      private: false,
    });
    const [device] = await db.select().from(devices).where(eq(devices.id, pc.id));
    expect(device?.searchCapture).toBe('on');
  });

  it('9: does not duplicate searches when PC titles are uploaded again', async () => {
    await titleUpload(pcTitles);
    const before = await searchRows(pc.id);
    expect((await titleUpload(pcTitles)).body).toEqual({ received: 0 });
    expect(await searchRows(pc.id)).toEqual(before);
  });

  it('10: extends a PC search for a later matching title', async () => {
    await titleUpload(pcTitles);
    expect(
      (await titleUpload([{ at: '2026-11-12T02:25:00Z', sec: 5, package: 'msedge.exe', title: 'how to draw - Search - Microsoft Edge' }]))
        .body,
    ).toEqual({ received: 1 });
    const rows = await searchRows(pc.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ lastAt: new Date('2026-11-12T02:25:05Z'), count: 2 });
  });

  it('11: backfills title searches once and is idempotent', async () => {
    await db.insert(siteTitles).values(
      pcTitles.map((title) => ({
        familyId: family,
        kidId: kid,
        deviceId: pc.id,
        at: new Date(title.at),
        sec: title.sec,
        package: title.package,
        title: title.title,
      })),
    );
    const first = await backfillSearches(db);
    expect(first).toEqual({ searches: 2, titles: 4, skipped: false });
    const before = await searchRows(pc.id);
    expect(before).toHaveLength(2);
    expect(before[0]).toMatchObject({
      at: new Date('2026-11-12T02:00:00Z'),
      lastAt: new Date('2026-11-12T02:01:50Z'),
      count: 2,
      engine: 'bing',
      query: 'how to draw',
      private: true,
      source: 'title',
    });
    expect(await backfillSearches(db)).toEqual({ searches: 0, titles: 0, skipped: true });
    expect(await searchRows(pc.id)).toEqual(before);
  });

  it('17: keeps searches older than the sweep retention window', async () => {
    await db.insert(searches).values({
      familyId: family,
      kidId: kid,
      deviceId: android.id,
      at: new Date('2025-10-08T12:00:00Z'),
      lastAt: new Date('2025-10-08T12:00:00Z'),
      count: 1,
      engine: 'google',
      query: 'old search',
      package: 'com.android.chrome',
      private: null,
      source: 'android',
    });
    await sweep({ db, config: testConfig(url ?? ''), mailer, pusher });
    const [row] = await db
      .select()
      .from(searches)
      .where(and(eq(searches.deviceId, android.id), eq(searches.query, 'old search')));
    expect(row?.at).toEqual(new Date('2025-10-08T12:00:00Z'));
  });
});
