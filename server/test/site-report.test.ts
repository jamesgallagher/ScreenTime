import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import {
  deviceApps,
  devicePrograms,
  devices,
  families,
  kids,
  parentSessions,
  parents,
  scheduleVersions,
  siteClasses,
  siteOverrides,
  siteTitles,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('the websites report', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const pusher: Pusher = { async send() { return []; } };
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });

  const FIXED_NOW = new Date('2026-11-12T00:00:00Z');

  let family = '';
  let otherFamily = '';
  let dad = '';
  let dadId = '';
  let otherDad = '';
  let otherDadId = '';
  let kid = '';
  let otherKid = '';
  let otherKidDevice = '';
  let lonelyKid = '';
  const phone = { id: '', token: '' };
  const pc = { id: '', token: '' };
  const tablet = { id: '', token: '' };

  function addDevice(familyId: string, kidId: string, name: string, platform: 'android' | 'windows', form: 'phone' | 'tablet' | 'pc', pool: 'phone' | 'screens', enrolledAt: string) {
    const token = newDeviceToken();
    return db
      .insert(devices)
      .values({ familyId, kidId, platform, form, pool, name, tokenHash: hashDeviceToken(token), enrolledAt: new Date(enrolledAt) })
      .returning()
      .then(([d]) => {
        if (!d) throw new Error('no device');
        return { id: d.id, token };
      });
  }

  async function signIn(familyId: string, parentId: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'web', clientLabel: 'Web' })
      .returning();
    if (!session) throw new Error('no session');
    return signAccessToken(TEST_SECRET, { sessionId: session.id, parentId, familyId, roles: ['parent'] });
  }

  const schedule = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '07:00', bedtime: '20:30' });

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
    const [b] = await db.insert(families).values({ name: 'B', timezone: 'Australia/Sydney', parentCodeSecret: 'B'.repeat(32) }).returning();
    if (!a || !b) throw new Error('no family');
    family = a.id;
    otherFamily = b.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    const [q] = await db.insert(parents).values({ familyId: otherFamily, email: 'bea@example.com', displayName: 'Bea' }).returning();
    if (!p || !q) throw new Error('no parent');
    dadId = p.id;
    otherDadId = q.id;
    dad = await signIn(family, p.id);
    otherDad = await signIn(otherFamily, q.id);
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Sam', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(schedule) });

    Object.assign(phone, await addDevice(family, kid, 'Phone', 'android', 'phone', 'phone', '2026-11-01T00:00:00Z'));
    Object.assign(pc, await addDevice(family, kid, 'PC', 'windows', 'pc', 'screens', '2026-11-01T00:00:01Z'));
    Object.assign(tablet, await addDevice(family, kid, 'Tablet', 'android', 'tablet', 'screens', '2026-11-01T00:00:02Z'));

    await db.insert(deviceApps).values([
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'com.android.chrome', label: 'Chrome', source: 'other', blockable: true, installedAt: new Date('2026-10-01T00:00:00Z'), firstSeenAt: new Date('2026-10-01T00:00:00Z'), baseline: true },
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'com.google.android.youtube', label: 'YouTube', source: 'other', blockable: true, installedAt: new Date('2026-10-01T00:00:00Z'), firstSeenAt: new Date('2026-10-01T00:00:00Z'), baseline: true },
    ]);
    await db.insert(devicePrograms).values({
      familyId: family,
      kidId: kid,
      deviceId: pc.id,
      package: 'msedge.exe',
      label: 'Microsoft Edge',
      firstSeenAt: new Date('2026-10-01T00:00:00Z'),
      lastSeenAt: new Date('2026-10-01T00:00:00Z'),
    });

    // Another kid of family A, for a deviceId that is not Sam's; and a kid with no device at all.
    const [ok] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#7C3AED' }).returning();
    if (!ok) throw new Error('no kid');
    otherKid = ok.id;
    otherKidDevice = (await addDevice(family, otherKid, 'Alex phone', 'android', 'phone', 'phone', '2026-11-02T00:00:00Z')).id;
    const [lk] = await db.insert(kids).values({ familyId: family, name: 'No phone yet', avatarColor: '#EA580C' }).returning();
    if (!lk) throw new Error('no kid');
    lonelyKid = lk.id;
  });

  /** Fixture S: uploads and the revoked tablet. */
  async function loadFixtureS() {
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
    expect((await api.post('/v1/device/site-lookups', phone.token, { lookups: [L1, L3, L5, L8, L9, L10] })).status).toBe(200);
    expect((await api.post('/v1/device/site-lookups', phone.token, { lookups: [L2, L4, L6, L7] })).status).toBe(200);
    expect((await api.post('/v1/device/site-lookups', pc.token, { lookups: [L11, L12] })).status).toBe(200);
    expect((await api.post('/v1/device/site-lookups', tablet.token, { lookups: [L13] })).status).toBe(200);
    await db.update(devices).set({ revokedAt: new Date('2026-11-11T00:00:00Z') }).where(eq(devices.id, tablet.id));
  }

  /** Fixture S's classes (inserted straight in) and the PC's titles. */
  async function loadClassesAndTitles() {
    await db.insert(siteClasses).values([
      { site: 'khanacademy.org', kind: 'website', category: 'education', label: 'Khan Academy', confidence: 0.99, model: 'Qwen3.8-27B', attempts: 1, classifiedAt: new Date('2026-11-11T00:00:00Z') },
      { site: 'kastatic.org', kind: 'cdn', category: 'education', owner: 'khanacademy.org', confidence: 0.95, model: 'Qwen3.8-27B', attempts: 1, classifiedAt: new Date('2026-11-11T00:00:00Z') },
      { site: 'googlevideo.com', kind: 'cdn', category: 'video', owner: 'youtube.com', confidence: 0.95, model: 'Qwen3.8-27B', attempts: 1, classifiedAt: new Date('2026-11-11T00:00:00Z') },
      { site: 'sportsbet.com.au', kind: 'website', category: 'gambling', label: 'Sportsbet', confidence: 0.9, model: 'Qwen3.8-27B', attempts: 1, classifiedAt: new Date('2026-11-11T00:00:00Z') },
      { site: 'roblox.com', kind: 'website', category: 'adult', confidence: 0.9, familyDnsBlocked: true, model: 'Qwen3.8-27B', attempts: 1, classifiedAt: new Date('2026-11-11T00:00:00Z') },
    ]);
    await db.insert(siteTitles).values([
      { familyId: family, kidId: kid, deviceId: pc.id, at: new Date('2026-11-11T02:00:00Z'), sec: 42, package: 'msedge.exe', title: 'how to draw - Search and 2 more pages - [InPrivate] - Microsoft Edge' },
      { familyId: family, kidId: kid, deviceId: pc.id, at: new Date('2026-11-11T02:00:42Z'), sec: 20, package: 'msedge.exe', title: 'how to draw - Search - [InPrivate] - Microsoft Edge' },
      { familyId: family, kidId: kid, deviceId: pc.id, at: new Date('2026-11-11T02:01:10Z'), sec: 300, package: 'msedge.exe', title: 'Wikipedia - Profile 1 - Microsoft Edge' },
      { familyId: family, kidId: kid, deviceId: pc.id, at: new Date('2026-11-11T02:06:10Z'), sec: 30, package: 'msedge.exe', title: 'New tab - Profile 1 - Microsoft Edge' },
      { familyId: family, kidId: kid, deviceId: pc.id, at: new Date('2026-11-11T02:07:00Z'), sec: 15, package: 'firefox.exe', title: 'Wikipedia — Mozilla Firefox Private Browsing' },
      { familyId: family, kidId: kid, deviceId: pc.id, at: new Date('2026-11-11T02:08:00Z'), sec: 50, package: 'chrome.exe', title: 'fortnite skins - Google Search - Google Chrome' },
      { familyId: family, kidId: kid, deviceId: pc.id, at: new Date('2026-11-11T02:09:00Z'), sec: 10, package: 'chrome.exe', title: 'How To Draw - Google Search - Google Chrome' },
      { familyId: family, kidId: kid, deviceId: pc.id, at: new Date('2026-11-11T02:10:00Z'), sec: 5, package: 'msedge.exe', title: 'HOW TO DRAW - Search - Microsoft Edge' },
    ]);
  }

  const report = (query: string, token: string | null = dad) => api.get(`/v1/reports/sites?${query}`, token);

  /** The full khanacademy.org row of criterion 8. */
  const KHAN = () => ({
    site: 'khanacademy.org',
    label: 'Khan Academy',
    kind: 'website',
    category: 'education',
    source: 'classifier',
    owner: null,
    minutes: 4,
    lookups: 5,
    days: 2,
    firstAt: '2026-11-10T01:00:05.000Z',
    lastAt: '2026-11-11T02:00:00.000Z',
    apps: [
      { package: 'com.android.chrome', label: 'Chrome', browser: true, minutes: 3 },
      { package: 'msedge.exe', label: 'Microsoft Edge', browser: true, minutes: 1 },
    ],
    devices: [
      { deviceId: phone.id, minutes: 3 },
      { deviceId: pc.id, minutes: 1 },
    ],
  });

  it('week: the period, today and the device list', async () => {
    await loadFixtureS();
    await loadClassesAndTitles();
    const res = await report(`kidId=${kid}&period=week&date=2026-11-11`);
    expect(res.status).toBe(200);
    expect(res.body.from).toBe('2026-11-09');
    expect(res.body.to).toBe('2026-11-15');
    expect(res.body.today).toBe('2026-11-12');
    expect(res.body.titlesKeptFrom).toBe('2026-08-15');
    expect(res.body.devices).toEqual([
      { deviceId: phone.id, name: 'Phone', form: 'phone', platform: 'android', removedAt: null, sitesRecorded: true },
      { deviceId: pc.id, name: 'PC', form: 'pc', platform: 'windows', removedAt: null, sitesRecorded: true },
      { deviceId: tablet.id, name: 'Tablet', form: 'tablet', platform: 'android', removedAt: '2026-11-11T00:00:00.000Z', sitesRecorded: true },
    ]);
  });

  it('week: the sites in order, Bark left out and removed devices still shown', async () => {
    await loadFixtureS();
    await loadClassesAndTitles();
    const res = await report(`kidId=${kid}&period=week&date=2026-11-11`);
    expect(res.status).toBe(200);
    expect(res.body.sites[0]).toEqual(KHAN());
    expect(res.body.sites).toEqual([
      KHAN(),
      {
        site: 'youtube.com',
        label: null,
        kind: null,
        category: null,
        source: null,
        owner: null,
        minutes: 2,
        lookups: 2,
        days: 2,
        firstAt: '2026-11-10T12:59:30.000Z',
        lastAt: '2026-11-10T13:00:30.000Z',
        apps: [{ package: 'com.google.android.youtube', label: 'YouTube', browser: false, minutes: 2 }],
        devices: [{ deviceId: phone.id, minutes: 2 }],
      },
      {
        site: 'roblox.com',
        label: null,
        kind: 'website',
        category: 'adult',
        source: 'family_dns',
        owner: null,
        minutes: 1,
        lookups: 1,
        days: 1,
        firstAt: '2026-11-10T03:00:00.000Z',
        lastAt: '2026-11-10T03:00:00.000Z',
        apps: [{ package: 'com.roblox.client', label: 'com.roblox.client', browser: false, minutes: 1 }],
        devices: [{ deviceId: tablet.id, minutes: 1 }],
      },
      {
        site: 'sportsbet.com.au',
        label: 'Sportsbet',
        kind: 'website',
        category: 'gambling',
        source: 'classifier',
        owner: null,
        minutes: 1,
        lookups: 1,
        days: 1,
        firstAt: '2026-11-11T02:00:20.000Z',
        lastAt: '2026-11-11T02:00:20.000Z',
        apps: [{ package: 'msedge.exe', label: 'Microsoft Edge', browser: true, minutes: 1 }],
        devices: [{ deviceId: pc.id, minutes: 1 }],
      },
    ]);
    expect(res.body.sites.some((s: { site: string }) => s.site === 'bark.us')).toBe(false);
  });

  it('week: behind the scenes and the categories', async () => {
    await loadFixtureS();
    await loadClassesAndTitles();
    const res = await report(`kidId=${kid}&period=week&date=2026-11-11`);
    expect(res.body.behindTheScenes).toEqual([
      {
        site: 'googlevideo.com',
        label: null,
        kind: 'cdn',
        category: 'video',
        source: 'classifier',
        owner: 'youtube.com',
        minutes: 1,
        lookups: 1,
        days: 1,
        firstAt: '2026-11-10T13:00:45.000Z',
        lastAt: '2026-11-10T13:00:45.000Z',
        apps: [{ package: 'com.google.android.youtube', label: 'YouTube', browser: false, minutes: 1 }],
        devices: [{ deviceId: phone.id, minutes: 1 }],
      },
      {
        site: 'kastatic.org',
        label: null,
        kind: 'cdn',
        category: 'education',
        source: 'classifier',
        owner: 'khanacademy.org',
        minutes: 1,
        lookups: 1,
        days: 1,
        firstAt: '2026-11-10T01:00:40.000Z',
        lastAt: '2026-11-10T01:00:40.000Z',
        apps: [{ package: 'com.android.chrome', label: 'Chrome', browser: true, minutes: 1 }],
        devices: [{ deviceId: phone.id, minutes: 1 }],
      },
    ]);
    expect(res.body.categories).toEqual([
      { category: 'education', minutes: 4, sites: 1 },
      { category: null, minutes: 2, sites: 1 },
      { category: 'adult', minutes: 1, sites: 1 },
      { category: 'gambling', minutes: 1, sites: 1 },
    ]);
  });

  it('week: the searches, pages and browser time of the PC', async () => {
    await loadFixtureS();
    await loadClassesAndTitles();
    const res = await report(`kidId=${kid}&period=week&date=2026-11-11`);
    expect(res.body.browserSec).toBe(472);
    expect(res.body.privateSec).toBe(77);
    expect(res.body.searches).toEqual([
      { engine: 'google', query: 'How To Draw', sec: 10, private: false, firstAt: '2026-11-11T02:09:00.000Z', deviceId: pc.id },
      { engine: 'google', query: 'fortnite skins', sec: 50, private: false, firstAt: '2026-11-11T02:08:00.000Z', deviceId: pc.id },
      { engine: 'bing', query: 'how to draw', sec: 67, private: true, firstAt: '2026-11-11T02:00:00.000Z', deviceId: pc.id },
    ]);
    expect(res.body.pages).toEqual([
      { page: 'Wikipedia', package: 'msedge.exe', sec: 300, private: false },
      { page: 'Wikipedia', package: 'firefox.exe', sec: 15, private: true },
    ]);
  });

  it('day 2026-11-10: the sites, the one CDN and no titles', async () => {
    await loadFixtureS();
    await loadClassesAndTitles();
    const res = await report(`kidId=${kid}&period=day&date=2026-11-10`);
    expect(res.status).toBe(200);
    expect(res.body.sites).toEqual([
      { ...KHAN(), minutes: 3, lookups: 4, days: 1, lastAt: '2026-11-10T01:05:00.000Z', apps: [KHAN().apps[0]], devices: [{ deviceId: phone.id, minutes: 3 }] },
      {
        site: 'roblox.com',
        label: null,
        kind: 'website',
        category: 'adult',
        source: 'family_dns',
        owner: null,
        minutes: 1,
        lookups: 1,
        days: 1,
        firstAt: '2026-11-10T03:00:00.000Z',
        lastAt: '2026-11-10T03:00:00.000Z',
        apps: [{ package: 'com.roblox.client', label: 'com.roblox.client', browser: false, minutes: 1 }],
        devices: [{ deviceId: tablet.id, minutes: 1 }],
      },
      {
        site: 'youtube.com',
        label: null,
        kind: null,
        category: null,
        source: null,
        owner: null,
        minutes: 1,
        lookups: 1,
        days: 1,
        firstAt: '2026-11-10T12:59:30.000Z',
        lastAt: '2026-11-10T12:59:30.000Z',
        apps: [{ package: 'com.google.android.youtube', label: 'YouTube', browser: false, minutes: 1 }],
        devices: [{ deviceId: phone.id, minutes: 1 }],
      },
    ]);
    expect(res.body.behindTheScenes.map((s: { site: string }) => s.site)).toEqual(['kastatic.org']);
    expect(res.body.browserSec).toBe(0);
    expect(res.body.searches).toEqual([]);
    expect(res.body.pages).toEqual([]);
    expect(res.body.devices.map((d: { name: string }) => d.name)).toEqual(['Phone', 'PC', 'Tablet']);
  });

  it('one device: the PC has the titles, the phone none; the device list stays whole', async () => {
    await loadFixtureS();
    await loadClassesAndTitles();
    const onPc = await report(`kidId=${kid}&period=week&date=2026-11-11&deviceId=${pc.id}`);
    expect(onPc.body.sites.map((s: { site: string }) => s.site)).toEqual(['khanacademy.org', 'sportsbet.com.au']);
    expect(onPc.body.sites[0]).toEqual({
      ...KHAN(),
      minutes: 1,
      lookups: 1,
      days: 1,
      firstAt: '2026-11-11T02:00:00.000Z',
      apps: [KHAN().apps[1]],
      devices: [{ deviceId: pc.id, minutes: 1 }],
    });
    expect(onPc.body.behindTheScenes).toEqual([]);
    expect(onPc.body.browserSec).toBe(472);
    expect(onPc.body.searches).toEqual([
      { engine: 'google', query: 'How To Draw', sec: 10, private: false, firstAt: '2026-11-11T02:09:00.000Z', deviceId: pc.id },
      { engine: 'google', query: 'fortnite skins', sec: 50, private: false, firstAt: '2026-11-11T02:08:00.000Z', deviceId: pc.id },
      { engine: 'bing', query: 'how to draw', sec: 67, private: true, firstAt: '2026-11-11T02:00:00.000Z', deviceId: pc.id },
    ]);
    expect(onPc.body.pages).toEqual([
      { page: 'Wikipedia', package: 'msedge.exe', sec: 300, private: false },
      { page: 'Wikipedia', package: 'firefox.exe', sec: 15, private: true },
    ]);
    expect(onPc.body.devices.map((d: { name: string }) => d.name)).toEqual(['Phone', 'PC', 'Tablet']);

    const onPhone = await report(`kidId=${kid}&period=week&date=2026-11-11&deviceId=${phone.id}`);
    expect(onPhone.body.browserSec).toBe(0);
    expect(onPhone.body.searches).toEqual([]);
    expect(onPhone.body.pages).toEqual([]);
  });

  it('empty periods and errors', async () => {
    await loadFixtureS();
    await loadClassesAndTitles();
    const empty = await report(`kidId=${kid}&period=week&date=2026-10-26`);
    expect(empty.status).toBe(200);
    expect(empty.body.sites).toEqual([]);
    expect(empty.body.behindTheScenes).toEqual([]);
    expect(empty.body.categories).toEqual([]);
    expect(empty.body.searches).toEqual([]);
    expect(empty.body.pages).toEqual([]);
    expect(empty.body.browserSec).toBe(0);
    expect(empty.body.privateSec).toBe(0);
    expect(empty.body.devices.map((d: { name: string }) => d.name)).toEqual(['Phone', 'PC']);

    const noDevices = await report(`kidId=${lonelyKid}&period=week&date=2026-11-11`);
    expect(noDevices.status).toBe(200);
    expect(noDevices.body).toMatchObject({
      sites: [],
      behindTheScenes: [],
      categories: [],
      searches: [],
      pages: [],
      browserSec: 0,
      privateSec: 0,
      devices: [],
    });

    expect((await report(`kidId=${kid}&period=week&date=2026-11-13`)).status).toBe(422);
    expect((await report(`kidId=${kid}&period=week&date=2026-02-30`)).status).toBe(422);
    expect((await report(`kidId=${kid}&period=week&date=2026-11-11&deviceId=${otherKidDevice}`)).status).toBe(404);

    const [bk] = await db.insert(kids).values({ familyId: otherFamily, name: 'Ben', avatarColor: '#DB2777' }).returning();
    if (!bk) throw new Error('no kid');
    expect((await report(`kidId=${bk.id}&period=week&date=2026-11-11`)).status).toBe(404);
    expect((await api.get(`/v1/reports/sites?kidId=${kid}&period=week&date=2026-11-11`, null)).status).toBe(401);
  });

  it("a parent's own class replaces the classifier's and can be cleared or replaced", async () => {
    await loadFixtureS();
    await loadClassesAndTitles();
    const put = await api.put(`/v1/sites/youtube.com/class`, dad, { kind: 'website', category: 'video' });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ site: 'youtube.com', kind: 'website', category: 'video' });
    const rows = await db.select().from(siteOverrides).where(eq(siteOverrides.familyId, family));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.parentId).toBe(dadId);

    const week = await report(`kidId=${kid}&period=week&date=2026-11-11`);
    const youtube = week.body.sites.find((s: { site: string }) => s.site === 'youtube.com');
    expect(youtube.kind).toBe('website');
    expect(youtube.category).toBe('video');
    expect(youtube.source).toBe('parent');
    expect(week.body.categories).toEqual([
      { category: 'education', minutes: 4, sites: 1 },
      { category: 'video', minutes: 2, sites: 1 },
      { category: 'adult', minutes: 1, sites: 1 },
      { category: 'gambling', minutes: 1, sites: 1 },
    ]);

    expect((await api.put(`/v1/sites/youtube.com/class`, dad, { kind: 'website', category: 'social' })).status).toBe(200);
    expect(await db.select().from(siteOverrides).where(eq(siteOverrides.familyId, family))).toHaveLength(1);

    expect((await api.del(`/v1/sites/youtube.com/class`, dad)).status).toBe(204);
    const after = await report(`kidId=${kid}&period=week&date=2026-11-11`);
    const cleared = after.body.sites.find((s: { site: string }) => s.site === 'youtube.com');
    expect(cleared.kind).toBeNull();
    expect(cleared.category).toBeNull();
    expect(cleared.source).toBeNull();
    expect((await api.del(`/v1/sites/youtube.com/class`, dad)).status).toBe(204);
  });

  it('refuses a bad site, kind or category, a device token, and another family', async () => {
    await loadFixtureS();
    expect((await api.put(`/v1/sites/${encodeURIComponent('not a site!')}/class`, dad, { kind: 'website', category: 'video' })).status).toBe(422);
    expect((await api.put(`/v1/sites/-bad.com/class`, dad, { kind: 'website', category: 'video' })).status).toBe(422);
    expect((await api.put(`/v1/sites/youtube.com/class`, dad, { kind: 'unknown', category: 'video' })).status).toBe(422);
    expect((await api.put(`/v1/sites/youtube.com/class`, dad, { kind: 'website', category: 'porn' })).status).toBe(422);
    expect((await api.put(`/v1/sites/youtube.com/class`, phone.token, { kind: 'website', category: 'video' })).status).toBe(401);

    // Family B's parent sets its own row; family A's report is unchanged.
    expect((await api.put(`/v1/sites/youtube.com/class`, otherDad, { kind: 'cdn', category: 'other' })).status).toBe(200);
    const week = await report(`kidId=${kid}&period=week&date=2026-11-11`);
    expect(week.body.sites.find((s: { site: string }) => s.site === 'youtube.com').kind).toBeNull();
    const bRows = await db.select().from(siteOverrides).where(and(eq(siteOverrides.familyId, otherFamily), eq(siteOverrides.site, 'youtube.com')));
    expect(bRows[0]?.parentId).toBe(otherDadId);
  });
});
