import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { appUsageDaily, deviceApps, devices, families, kids, parentSessions, parents, usageSegments } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('reports', () => {
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
  const tablet = { id: '', token: '' };
  const pc = { id: '', token: '' };

  /** A fixed zone where it is about midday right now, so the times never cross local midnight. */
  function middayZone() {
    const k = 12 - new Date().getUTCHours();
    return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
  }
  const zone = middayZone();
  const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());

  async function addDevice(familyId: string, kidId: string, platform: 'android' | 'windows', form: 'phone' | 'tablet' | 'pc', name: string) {
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
        hasCellular: form === 'phone',
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

  beforeAll(async () => {
    await resetDatabase(db, pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    const [a] = await db.insert(families).values({ name: 'A', timezone: zone, parentCodeSecret: 'A'.repeat(32) }).returning();
    const [b] = await db.insert(families).values({ name: 'B', timezone: zone, parentCodeSecret: 'B'.repeat(32) }).returning();
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
    Object.assign(phone, await addDevice(family, kid, 'android', 'phone', 'Pixel 7'));
    Object.assign(tablet, await addDevice(family, kid, 'android', 'tablet', 'XPPen'));
    Object.assign(pc, await addDevice(family, kid, 'windows', 'pc', 'Alex on PC'));
  });

  // Criterion 1: period ranges
  it('a week runs Monday to Sunday, a month from the 1st, a day from and to the date', async () => {
    // Use a date that is today or before, so the date-after-today check doesn't fire.
    const today = localDate();
    // 2026-11-20 is a Friday.
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=week&date=2026-11-20`, dad);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: '2026-11-16', to: '2026-11-22' });

    // date=2026-11-16 (Monday) and 2026-11-20 (the date in the week) give the same week.
    const mon = await api.get(`/v1/reports/apps?kidId=${kid}&period=week&date=2026-11-16`, dad);
    const fri = await api.get(`/v1/reports/apps?kidId=${kid}&period=week&date=2026-11-20`, dad);
    expect(mon.body).toMatchObject({ from: '2026-11-16', to: '2026-11-22' });
    expect(fri.body).toMatchObject({ from: '2026-11-16', to: '2026-11-22' });

    // A month: from the 1st to the last day.
    const month = await api.get(`/v1/reports/apps?kidId=${kid}&period=month&date=${today}`, dad);
    expect(month.status).toBe(200);
    expect(month.body).toMatchObject({ from: `${today.slice(0, 8)}01` });

    // A day: from = to = date.
    const day = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=2026-11-20`, dad);
    expect(day.body).toMatchObject({ from: '2026-11-20', to: '2026-11-20' });
  });

  it('without date, the family today is used', async () => {
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day`, dad);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: localDate(), to: localDate(), today: localDate() });
  });

  // Criterion 2: validation and 404s
  it('a date after today is 422', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(tomorrow);
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${date}`, dad);
    expect(res.status).toBe(422);
  });

  it('a date that is not a real date is 422', async () => {
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=2026-02-30`, dad);
    expect(res.status).toBe(422);
  });

  it('a period that is not day, week or month is 422', async () => {
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=year&date=2026-11-20`, dad);
    expect(res.status).toBe(422);
  });

  it('a kid of another family is 404', async () => {
    const [otherKid] = await db.insert(kids).values({ familyId: otherFamily, name: 'Ben', avatarColor: '#7C3AED' }).returning();
    if (!otherKid) throw new Error('no kid');
    const res = await api.get(`/v1/reports/apps?kidId=${otherKid.id}&period=day`, dad);
    expect(res.status).toBe(404);
  });

  it('an unknown deviceId is 404', async () => {
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&deviceId=${randomUUID()}`, dad);
    expect(res.status).toBe(404);
  });

  it('a device of another kid of the same family is 404', async () => {
    const [otherKid] = await db.insert(kids).values({ familyId: family, name: 'Sam', avatarColor: '#7C3AED' }).returning();
    if (!otherKid) throw new Error('no kid');
    const otherPhone = await addDevice(family, otherKid.id, 'android', 'phone', 'Sam Phone');
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&deviceId=${otherPhone.id}`, dad);
    expect(res.status).toBe(404);
  });

  it('a revoked device of this kid answers 200', async () => {
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, tablet.id));
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&deviceId=${tablet.id}`, dad);
    expect(res.status).toBe(200);
    expect(res.body.deviceId).toBe(tablet.id);
  });

  // Criterion 3: apps
  it('sums app time per package across devices, ordered by totalSec descending', async () => {
    const today = localDate();
    const tomorrow = new Date(Date.now() + 86_400_000);
    const tomorrowDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(tomorrow);
    // YouTube: 4200 s on the phone today, 1800 s on the tablet today, 300 s on the phone tomorrow.
    await db.insert(appUsageDaily).values([
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'com.google.android.youtube', day: today, seconds: 4200 },
      { familyId: family, kidId: kid, deviceId: tablet.id, package: 'com.google.android.youtube', day: today, seconds: 1800 },
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'com.google.android.youtube', day: tomorrowDate, seconds: 300 },
      // Roblox: 3000 s on the tablet today.
      { familyId: family, kidId: kid, deviceId: tablet.id, package: 'com.roblox.client', day: today, seconds: 3000 },
    ]);

    // Week report: YouTube 6300 (4200 + 1800 + 300), Roblox 3000.
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=week&date=${today}`, dad);
    expect(res.status).toBe(200);
    const apps = res.body as { apps: { package: string; totalSec: number; devices: { deviceId: string; sec: number }[] }[] };
    expect(apps.apps.map((a) => a.package)).toEqual(['com.google.android.youtube', 'com.roblox.client']);
    expect(apps.apps[0]).toMatchObject({ package: 'com.google.android.youtube', totalSec: 6300 });
    expect(apps.apps[0].devices).toEqual([
      { deviceId: phone.id, sec: 4500 },
      { deviceId: tablet.id, sec: 1800 },
    ]);
    expect(apps.apps[1]).toMatchObject({ package: 'com.roblox.client', totalSec: 3000 });
  });

  it('a row outside the period is not counted', async () => {
    const today = localDate();
    const yesterday = new Date(Date.now() - 86_400_000);
    const yesterdayDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(yesterday);
    await db.insert(appUsageDaily).values([
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'a.game', day: today, seconds: 1000 },
      // Outside the day period.
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'a.game', day: yesterdayDate, seconds: 5000 },
    ]);
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${today}`, dad);
    const apps = res.body as { apps: { package: string; totalSec: number }[] };
    expect(apps.apps).toEqual([{ package: 'a.game', totalSec: 1000, label: 'a.game', devices: [{ deviceId: phone.id, sec: 1000 }], installedAt: null, removedAt: null }]);
  });

  it('with deviceId, the report is that device only, ordered by totalSec', async () => {
    const today = localDate();
    await db.insert(appUsageDaily).values([
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'com.google.android.youtube', day: today, seconds: 4200 },
      { familyId: family, kidId: kid, deviceId: tablet.id, package: 'com.google.android.youtube', day: today, seconds: 1800 },
      { familyId: family, kidId: kid, deviceId: tablet.id, package: 'com.roblox.client', day: today, seconds: 3000 },
    ]);
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${today}&deviceId=${tablet.id}`, dad);
    expect(res.status).toBe(200);
    const body = res.body as { deviceId: string; apps: { package: string; totalSec: number }[] };
    expect(body.deviceId).toBe(tablet.id);
    // Roblox 3000 first, YouTube 1800 second.
    expect(body.apps.map((a) => [a.package, a.totalSec])).toEqual([
      ['com.roblox.client', 3000],
      ['com.google.android.youtube', 1800],
    ]);
  });

  // Criterion 4: labels and removed apps
  it('a package with no device_apps row has label = package name and both dates null', async () => {
    const today = localDate();
    await db.insert(appUsageDaily).values({ familyId: family, kidId: kid, deviceId: phone.id, package: 'com.no.icon', day: today, seconds: 600 });
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${today}`, dad);
    const apps = res.body as { apps: { package: string; label: string; installedAt: string | null; removedAt: string | null }[] };
    expect(apps.apps[0]).toMatchObject({ package: 'com.no.icon', label: 'com.no.icon', installedAt: null, removedAt: null });
  });

  it('a removed app has removedAt and installedAt from the device_apps row', async () => {
    const today = localDate();
    const installed = new Date('2026-11-01T00:00:00Z');
    const removed = new Date('2026-11-05T00:00:00Z');
    await db.insert(deviceApps).values({
      familyId: family,
      kidId: kid,
      deviceId: phone.id,
      package: 'a.game',
      label: 'Game',
      source: 'play',
      blockable: true,
      installedAt: installed,
      firstSeenAt: installed,
      baseline: false,
      removedAt: removed,
    });
    await db.insert(appUsageDaily).values({ familyId: family, kidId: kid, deviceId: phone.id, package: 'a.game', day: today, seconds: 600 });
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${today}`, dad);
    const apps = res.body as { apps: { package: string; label: string; installedAt: string | null; removedAt: string | null }[] };
    expect(apps.apps[0]).toMatchObject({ package: 'a.game', label: 'Game', installedAt: installed.toISOString(), removedAt: removed.toISOString() });
  });

  it('on two devices with one still installed, removedAt is null', async () => {
    const today = localDate();
    const installed = new Date('2026-11-01T00:00:00Z');
    const removed = new Date('2026-11-05T00:00:00Z');
    await db.insert(deviceApps).values([
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'a.game', label: 'Game', source: 'play', blockable: true, installedAt: installed, firstSeenAt: installed, baseline: false, removedAt: removed },
      { familyId: family, kidId: kid, deviceId: tablet.id, package: 'a.game', label: 'Game', source: 'play', blockable: true, installedAt: installed, firstSeenAt: installed, baseline: false, removedAt: null },
    ]);
    await db.insert(appUsageDaily).values([
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'a.game', day: today, seconds: 600 },
      { familyId: family, kidId: kid, deviceId: tablet.id, package: 'a.game', day: today, seconds: 300 },
    ]);
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${today}`, dad);
    const apps = res.body as { apps: { removedAt: string | null }[] };
    expect(apps.apps[0].removedAt).toBeNull();
  });

  it('the label is the most recently first-seen row', async () => {
    const today = localDate();
    await db.insert(deviceApps).values([
      { familyId: family, kidId: kid, deviceId: phone.id, package: 'a.game', label: 'Old Name', source: 'play', blockable: true, installedAt: new Date('2026-11-01T00:00:00Z'), firstSeenAt: new Date('2026-11-01T00:00:00Z'), baseline: false },
      { familyId: family, kidId: kid, deviceId: tablet.id, package: 'a.game', label: 'New Name', source: 'play', blockable: true, installedAt: new Date('2026-11-01T00:00:00Z'), firstSeenAt: new Date('2026-11-10T00:00:00Z'), baseline: false },
    ]);
    await db.insert(appUsageDaily).values({ familyId: family, kidId: kid, deviceId: phone.id, package: 'a.game', day: today, seconds: 600 });
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${today}`, dad);
    const apps = res.body as { apps: { label: string }[] };
    expect(apps.apps[0].label).toBe('New Name');
  });

  // Criterion 5: devices
  it('a revoked device with app time in the period is listed with removedAt and its time counted', async () => {
    const today = localDate();
    await db.update(devices).set({ revokedAt: new Date('2026-11-10T00:00:00Z') }).where(eq(devices.id, tablet.id));
    await db.insert(appUsageDaily).values({ familyId: family, kidId: kid, deviceId: tablet.id, package: 'a.game', day: today, seconds: 600 });
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${today}`, dad);
    expect(res.status).toBe(200);
    const body = res.body as { devices: { deviceId: string; removedAt: string | null }[]; apps: { package: string; devices: { deviceId: string }[] }[] };
    const tabletDevice = body.devices.find((d) => d.deviceId === tablet.id);
    expect(tabletDevice?.removedAt).toBe('2026-11-10T00:00:00.000Z');
    expect(body.apps[0]?.devices.some((d) => d.deviceId === tablet.id)).toBe(true);
  });

  it('a revoked device with nothing in the period is not listed', async () => {
    await db.update(devices).set({ revokedAt: new Date('2026-11-10T00:00:00Z') }).where(eq(devices.id, tablet.id));
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=2026-11-20`, dad);
    expect(res.status).toBe(200);
    const body = res.body as { devices: { deviceId: string }[]; screenTime: { pool: string; usedSec: number }[]; apps: { package: string; devices: { deviceId: string }[] }[] };
    // The device has no app time or segments in the period, so it is not listed.
    expect(body.devices.some((d) => d.deviceId === tablet.id)).toBe(false);
    expect(body.apps.every((a) => !a.devices.some((d) => d.deviceId === tablet.id))).toBe(true);
  });

  it('a PC is listed with appsRecorded false', async () => {
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${localDate()}`, dad);
    const body = res.body as { devices: { deviceId: string; appsRecorded: boolean }[] };
    const pcDevice = body.devices.find((d) => d.deviceId === pc.id);
    expect(pcDevice?.appsRecorded).toBe(false);
  });

  it('devices are ordered by enrolment', async () => {
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${localDate()}`, dad);
    const body = res.body as { devices: { deviceId: string }[] };
    expect(body.devices.map((d) => d.deviceId)).toEqual([phone.id, tablet.id, pc.id]);
  });

  // Criterion 6: screen time (union of segments)
  // Fixed date: 2026-11-20 (a Friday). The week is 2026-11-16 to 2026-11-22.
  // The test zone is midday, so local midnight is about 12 hours away.
  // All segments are in the past (before 2026-11-20), so they are not clipped by now.

  it('two devices in the same pool give the union length', async () => {
    // Two tablets (both screens pool) on 2026-11-10:
    // Tablet 1: 2026-11-09T12:00:00Z to 2026-11-09T13:00:00Z (10:00–11:00 local in midday zone).
    // Tablet 2: 2026-11-09T12:30:00Z to 2026-11-09T13:30:00Z (10:30–11:30 local).
    // Union: 12:00–13:30 = 90 min = 5400 s.
    const tablet2 = await addDevice(family, kid, 'android', 'tablet', 'Tablet 2');
    await db.insert(usageSegments).values([
      { id: randomUUID(), familyId: family, kidId: kid, deviceId: tablet.id, pool: 'screens', startedAt: new Date('2026-11-09T12:00:00Z'), endedAt: new Date('2026-11-09T13:00:00Z') },
      { id: randomUUID(), familyId: family, kidId: kid, deviceId: tablet2.id, pool: 'screens', startedAt: new Date('2026-11-09T12:30:00Z'), endedAt: new Date('2026-11-09T13:30:00Z') },
    ]);
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=2026-11-10`, dad);
    const body = res.body as { screenTime: { pool: string; usedSec: number }[] };
    const screensPool = body.screenTime.find((p) => p.pool === 'screens');
    expect(screensPool?.usedSec).toBe(5400);
  });

  it('a segment across the week last midnight counts only the part in the week', async () => {
    // The week holding 2026-11-09 is 2026-11-09 to 2026-11-15.
    // In the midday zone, local midnight of 2026-11-15 is 2026-11-14T12:00:00Z.
    // A segment from 2026-11-14T11:30:00Z to 2026-11-14T12:30:00Z crosses that midnight.
    // Only the part from 11:30 to 12:00 (30 min = 1800 s) is in the week.
    await db.insert(usageSegments).values({
      id: randomUUID(),
      familyId: family,
      kidId: kid,
      deviceId: phone.id,
      pool: 'phone',
      startedAt: new Date('2026-11-14T11:30:00Z'),
      endedAt: new Date('2026-11-14T12:30:00Z'),
    });
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=week&date=2026-11-09`, dad);
    const body = res.body as { screenTime: { pool: string; usedSec: number }[] };
    const phonePool = body.screenTime.find((p) => p.pool === 'phone');
    expect(phonePool?.usedSec).toBe(1800);
  });

  it('a segment that starts before the period first midnight counts only the part inside', async () => {
    // The day is 2026-11-10. In the midday zone, local midnight of 2026-11-10 is 2026-11-09T12:00:00Z.
    // A segment from 2026-11-09T11:00:00Z to 2026-11-09T13:00:00Z crosses that midnight.
    // Only the part from 12:00 to 13:00 (60 min = 3600 s) is in the day.
    await db.insert(usageSegments).values({
      id: randomUUID(),
      familyId: family,
      kidId: kid,
      deviceId: phone.id,
      pool: 'phone',
      startedAt: new Date('2026-11-09T11:00:00Z'),
      endedAt: new Date('2026-11-09T13:00:00Z'),
    });
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=2026-11-10`, dad);
    const body = res.body as { screenTime: { pool: string; usedSec: number }[] };
    const phonePool = body.screenTime.find((p) => p.pool === 'phone');
    expect(phonePool?.usedSec).toBe(3600);
  });

  // Criterion 7: open segments
  it('an open segment ends at the device last_seen_at, not now', async () => {
    // An open segment that started 30 min before now, with last_seen_at 20 min after the start.
    const s = new Date(Date.now() - 30 * 60_000);
    await db.insert(usageSegments).values({
      id: randomUUID(),
      familyId: family,
      kidId: kid,
      deviceId: phone.id,
      pool: 'phone',
      startedAt: s,
      endedAt: null,
    });
    // last_seen_at is 20 minutes after the start.
    await db.update(devices).set({ lastSeenAt: new Date(Date.now() - 10 * 60_000) }).where(eq(devices.id, phone.id));
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${localDate()}`, dad);
    const body = res.body as { screenTime: { pool: string; usedSec: number }[] };
    const phonePool = body.screenTime.find((p) => p.pool === 'phone');
    // 20 min = 1200 s, allow a few seconds for the clock.
    expect(phonePool?.usedSec).toBeGreaterThanOrEqual(1190);
    expect(phonePool?.usedSec).toBeLessThanOrEqual(1210);
  });

  it('an open segment with last_seen_at before the start gives 0', async () => {
    // An open segment that started 1 hour ago, with last_seen_at 2 hours ago (before the start).
    const s = new Date(Date.now() - 1 * 3600_000);
    await db.insert(usageSegments).values({
      id: randomUUID(),
      familyId: family,
      kidId: kid,
      deviceId: phone.id,
      pool: 'phone',
      startedAt: s,
      endedAt: null,
    });
    // last_seen_at is before the start.
    await db.update(devices).set({ lastSeenAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(devices.id, phone.id));
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${localDate()}`, dad);
    const body = res.body as { screenTime: { pool: string; usedSec: number }[] };
    const phonePool = body.screenTime.find((p) => p.pool === 'phone');
    expect(phonePool?.usedSec).toBe(0);
  });

  // Criterion 8: time zone (daylight saving)
  it('in Australia/Sydney, a day report clips at local midnights', async () => {
    // Use a family in Australia/Sydney.
    const [syd] = await db.insert(families).values({ name: 'Sydney', timezone: 'Australia/Sydney', parentCodeSecret: 'S'.repeat(32) }).returning();
    if (!syd) throw new Error('no family');
    const [p] = await db.insert(parents).values({ familyId: syd.id, email: 'syd@example.com', displayName: 'Syd' }).returning();
    if (!p) throw new Error('no parent');
    const [k] = await db.insert(kids).values({ familyId: syd.id, name: 'Syd Kid', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    const token = newDeviceToken();
    const [dev] = await db.insert(devices).values({ familyId: syd.id, kidId: k.id, platform: 'android', form: 'phone', pool: 'phone', name: 'Phone', tokenHash: hashDeviceToken(token) }).returning();
    if (!dev) throw new Error('no device');
    const token2 = await signIn(syd.id, p.id);

    // 2026-04-05 is the day clocks go back (25 hours) in Australia.
    // A segment from 00:00 to 01:00 local on 6 April is NOT in 5 April.
    // 2026-04-05 local midnight in Sydney is 2026-04-04T14:00:00Z (UTC+10).
    // 2026-04-06 local midnight is 2026-04-05T14:00:00Z (UTC+11, after the change).
    // A segment at 2026-04-05T14:00:00Z (00:00 on 6 April) to 2026-04-05T15:00:00Z (01:00 on 6 April)
    // is entirely in 6 April, not 5 April.
    await db.insert(usageSegments).values({
      id: randomUUID(),
      familyId: syd.id,
      kidId: k.id,
      deviceId: dev.id,
      pool: 'phone',
      startedAt: new Date('2026-04-05T14:00:00Z'),
      endedAt: new Date('2026-04-05T15:00:00Z'),
    });
    const res = await api.get(`/v1/reports/apps?kidId=${k.id}&period=day&date=2026-04-05`, token2);
    expect(res.status).toBe(200);
    const body = res.body as { screenTime: { pool: string; usedSec: number }[] };
    // The segment is on 6 April, not 5 April: 0 seconds on 5 April.
    expect(body.screenTime.find((p) => p.pool === 'phone')?.usedSec).toBe(0);
  });

  // Criterion 9: shared device
  it('a shared device answers with only a screens entry', async () => {
    const [shared] = await db.insert(kids).values({ familyId: family, name: 'Mums Tablet', avatarColor: '#7C3AED', kind: 'shared' }).returning();
    if (!shared) throw new Error('no shared');
    const token = newDeviceToken();
    const [dev] = await db.insert(devices).values({ familyId: family, kidId: shared.id, platform: 'android', form: 'tablet', pool: 'screens', name: 'Mums Tablet', tokenHash: hashDeviceToken(token) }).returning();
    if (!dev) throw new Error('no device');
    // A segment entirely in the past on 2026-11-20.
    await db.insert(usageSegments).values({
      id: randomUUID(),
      familyId: family,
      kidId: shared.id,
      deviceId: dev.id,
      pool: 'screens',
      startedAt: new Date('2026-11-20T00:00:00Z'),
      endedAt: new Date('2026-11-20T01:00:00Z'),
    });
    const res = await api.get(`/v1/reports/apps?kidId=${shared.id}&period=day&date=2026-11-20`, dad);
    expect(res.status).toBe(200);
    const body = res.body as { screenTime: { pool: string; usedSec: number }[] };
    expect(body.screenTime).toEqual([{ pool: 'screens', usedSec: 3600 }]);
  });

  // Criterion 10: family isolation
  it('another family parent gets 404', async () => {
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day`, otherDad);
    expect(res.status).toBe(404);
  });

  // A kid with no devices answers 200 with empty lists.
  it('a kid with no devices answers 200 with empty lists', async () => {
    const [noDeviceKid] = await db.insert(kids).values({ familyId: family, name: 'No Devices', avatarColor: '#0F766E' }).returning();
    if (!noDeviceKid) throw new Error('no kid');
    const res = await api.get(`/v1/reports/apps?kidId=${noDeviceKid.id}&period=day&date=2026-11-20`, dad);
    expect(res.status).toBe(200);
    const body = res.body as { devices: unknown[]; screenTime: unknown[]; apps: unknown[] };
    expect(body.devices).toEqual([]);
    expect(body.screenTime).toEqual([]);
    expect(body.apps).toEqual([]);
  });

  // A shared device with no devices answers 200 with empty lists.
  it('a shared device with no devices answers 200 with empty lists', async () => {
    const [shared] = await db.insert(kids).values({ familyId: family, name: 'Empty Shared', avatarColor: '#7C3AED', kind: 'shared' }).returning();
    if (!shared) throw new Error('no shared');
    const res = await api.get(`/v1/reports/apps?kidId=${shared.id}&period=day&date=2026-11-20`, dad);
    expect(res.status).toBe(200);
    const body = res.body as { devices: unknown[]; screenTime: unknown[]; apps: unknown[] };
    expect(body.devices).toEqual([]);
    expect(body.screenTime).toEqual([]);
    expect(body.apps).toEqual([]);
  });
});
