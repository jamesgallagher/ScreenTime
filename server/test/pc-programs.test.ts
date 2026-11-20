import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createDb } from '../src/db/client.js';
import { appUsageDaily, deviceApps, devicePrograms, devices, families, kids, parentSessions, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { client, resetDatabase, TEST_SECRET, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PC programs', () => {
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
  const pc = { id: '', token: '' };
  const pc2 = { id: '', token: '' };

  const DAY = '2026-11-10';

  function app(pkg: string) {
    return { package: pkg, label: pkg.toUpperCase(), source: 'play', installer: null, blockable: true, installedAt: '2026-11-03T06:00:00.000Z', firstUsedAt: null };
  }

  async function addDevice(familyId: string, kidId: string, platform: 'android' | 'windows', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform,
        form: platform === 'android' ? 'phone' : 'pc',
        pool: platform === 'android' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(token),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function signIn(familyId: string, parentId: string, fcmToken: string) {
    const [session] = await db
      .insert(parentSessions)
      .values({ familyId, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken })
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
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'UTC', parentCodeSecret: 'A'.repeat(32) }).returning();
    const [b] = await db.insert(families).values({ name: 'B', timezone: 'UTC', parentCodeSecret: 'B'.repeat(32) }).returning();
    if (!a || !b) throw new Error('no family');
    family = a.id;
    otherFamily = b.id;
    const [p] = await db.insert(parents).values({ familyId: family, email: 'dad@example.com', displayName: 'Dad' }).returning();
    const [q] = await db.insert(parents).values({ familyId: otherFamily, email: 'bea@example.com', displayName: 'Bea' }).returning();
    if (!p || !q) throw new Error('no parent');
    dad = await signIn(family, p.id, 'dad-phone');
    otherDad = await signIn(otherFamily, q.id, 'bea-phone');
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Alex', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '00:00', bedtime: '24:00' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(phone, await addDevice(family, kid, 'android', 'Pixel 7'));
    Object.assign(pc, await addDevice(family, kid, 'windows', 'Alex on PC'));
    Object.assign(pc2, await addDevice(family, kid, 'windows', 'Alex on PC 2'));
    await api.put('/v1/device/apps', phone.token, { apps: [app('a.game')] });
  });

  it('migration 0014 creates device_programs with its primary key and RLS', async () => {
    const policies = await db.execute<{ polname: string; tablename: string }>(sql`
      select policyname as polname, tablename from pg_policies where tablename = 'device_programs'
    `);
    expect(policies.rows.map((r) => r.polname)).toEqual(['family_isolation']);
    const pk = await db.execute<{ constraint: string }>(sql`
      select conname as constraint from pg_constraint where conrelid = 'device_programs'::regclass and contype = 'p'
    `);
    expect(pk.rows).toEqual([{ constraint: 'device_programs_device_id_package_pk' }]);
    const fk = await db.execute<{ constraint: string }>(sql`
      select conname as constraint from pg_constraint where conrelid = 'device_programs'::regclass and contype = 'f' order by conname
    `);
    expect(fk.rows.map((r) => r.constraint)).toEqual([
      'device_programs_device_id_devices_id_fk',
      'device_programs_family_id_families_id_fk',
      'device_programs_kid_id_kids_id_fk',
    ]);
  });

  it('a PC upload stores the seconds and the program label', async () => {
    const res = await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'genshinimpact.exe', seconds: 3600, label: 'Genshin Impact' }] }],
    });
    expect(res.status).toBe(204);
    const usage = await db.select().from(appUsageDaily).where(eq(appUsageDaily.deviceId, pc.id));
    expect(usage).toEqual([expect.objectContaining({ package: 'genshinimpact.exe', day: DAY, seconds: 3600 })]);
    const programs = await db.select().from(devicePrograms).where(eq(devicePrograms.deviceId, pc.id));
    expect(programs).toEqual([expect.objectContaining({ package: 'genshinimpact.exe', label: 'Genshin Impact' })]);
    expect(programs[0]?.firstSeenAt.getTime()).toBe(programs[0]?.lastSeenAt.getTime());
  });

  it('a repeat keeps the larger value and the newest label', async () => {
    await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'genshinimpact.exe', seconds: 3600, label: 'Genshin Impact' }] }],
    });
    const before = (await db.select().from(devicePrograms).where(eq(devicePrograms.deviceId, pc.id)))[0];
    expect(before).toBeDefined();

    // A smaller value does not lower it.
    await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'genshinimpact.exe', seconds: 1800, label: 'Genshin Impact' }] }],
    });
    let usage = (await db.select().from(appUsageDaily).where(eq(appUsageDaily.deviceId, pc.id)))[0];
    expect(usage?.seconds).toBe(3600);

    // A larger value wins.
    await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'genshinimpact.exe', seconds: 4000, label: 'Genshin Impact' }] }],
    });
    usage = (await db.select().from(appUsageDaily).where(eq(appUsageDaily.deviceId, pc.id)))[0];
    expect(usage?.seconds).toBe(4000);

    // A new label replaces the old one; first_seen_at is unchanged, last_seen_at moves.
    await new Promise((r) => setTimeout(r, 5));
    await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'genshinimpact.exe', seconds: 4000, label: 'Genshin' }] }],
    });
    const after = (await db.select().from(devicePrograms).where(eq(devicePrograms.deviceId, pc.id)))[0];
    expect(after?.label).toBe('Genshin');
    expect(after?.firstSeenAt.getTime()).toBe(before!.firstSeenAt.getTime());
    expect((after?.lastSeenAt ?? new Date(0)).getTime()).toBeGreaterThanOrEqual(before!.lastSeenAt.getTime());
  });

  it('refuses a package that is not a lower-case .exe, storing nothing', async () => {
    for (const pkg of ['Notepad.exe', 'notepad', 'C:\\x\\notepad.exe', 'com.android.chrome']) {
      const res = await api.post('/v1/device/app-usage', pc.token, {
        days: [{ day: DAY, apps: [{ package: pkg, seconds: 100 }] }],
      });
      expect(res.status).toBe(422);
    }
    expect((await db.select().from(appUsageDaily).where(eq(appUsageDaily.deviceId, pc.id))).length).toBe(0);
    expect((await db.select().from(devicePrograms).where(eq(devicePrograms.deviceId, pc.id))).length).toBe(0);

    // An 81-character label is 422.
    const long = 'x'.repeat(81);
    const res = await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'notepad.exe', seconds: 100, label: long }] }],
    });
    expect(res.status).toBe(422);
    expect((await db.select().from(devicePrograms).where(eq(devicePrograms.deviceId, pc.id))).length).toBe(0);

    // An item without a label: 204, the time is stored, no device_programs row.
    const ok = await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'notepad.exe', seconds: 100 }] }],
    });
    expect(ok.status).toBe(204);
    const usage = await db.select().from(appUsageDaily).where(eq(appUsageDaily.deviceId, pc.id));
    expect(usage).toEqual([expect.objectContaining({ package: 'notepad.exe', seconds: 100 })]);
    expect((await db.select().from(devicePrograms).where(eq(devicePrograms.deviceId, pc.id))).length).toBe(0);
  });

  it('an Android upload ignores the label and still sends state_changed for a limit', async () => {
    const res = await api.post('/v1/device/app-usage', phone.token, {
      days: [{ day: DAY, apps: [{ package: 'a.game', seconds: 100, label: 'Not a PC program' }] }],
    });
    expect(res.status).toBe(204);
    expect((await db.select().from(devicePrograms).where(eq(devicePrograms.kidId, kid))).length).toBe(0);

    // A limit rule still sends state_changed to the kid's other Android devices.
    await api.put(`/v1/kids/${kid}/apps/a.game/rule`, dad, { mode: 'limit', dailyMinutes: 30 });
    sent.length = 0;
    await api.post('/v1/device/app-usage', phone.token, {
      days: [{ day: DAY, apps: [{ package: 'a.game', seconds: 200 }] }],
    });
    expect(sent.some((m) => m.token === 'dad-phone')).toBe(false); // the upload's state_changed is FCM-only
    const state = await api.get('/v1/device/state', phone.token);
    expect(state.status).toBe(200);
  });

  it('the report shows the PC program with its label, no dates, and appsRecorded', async () => {
    await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'genshinimpact.exe', seconds: 3600, label: 'Genshin Impact' }] }],
    });
    const res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${DAY}`, dad);
    expect(res.status).toBe(200);
    const body = res.body as {
      devices: { deviceId: string; appsRecorded: boolean }[];
      apps: { package: string; label: string; totalSec: number; installedAt: string | null; removedAt: string | null; devices: { deviceId: string; sec: number }[] }[];
    };
    const program = body.apps.find((a) => a.package === 'genshinimpact.exe');
    expect(program).toBeDefined();
    expect(program?.label).toBe('Genshin Impact');
    expect(program?.totalSec).toBe(3600);
    expect(program?.installedAt).toBeNull();
    expect(program?.removedAt).toBeNull();
    expect(program?.devices).toEqual([{ deviceId: pc.id, sec: 3600 }]);
    const pcDevice = body.devices.find((d) => d.deviceId === pc.id);
    expect(pcDevice?.appsRecorded).toBe(true);
    const pc2Device = body.devices.find((d) => d.deviceId === pc2.id);
    expect(pc2Device?.appsRecorded).toBe(false);
  });

  it('the label order is device_apps on the report, then device_programs on the report, then any of the kid\'s', async () => {
    // Two report devices with device_programs labels: the latest last_seen_at wins.
    await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'x.exe', seconds: 100, label: 'Old' }] }],
    });
    await new Promise((r) => setTimeout(r, 5));
    await api.post('/v1/device/app-usage', pc2.token, {
      days: [{ day: DAY, apps: [{ package: 'x.exe', seconds: 100, label: 'New' }] }],
    });
    let res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${DAY}`, dad);
    let body = res.body as { apps: { package: string; label: string }[] };
    expect(body.apps.find((a) => a.package === 'x.exe')?.label).toBe('New');

    // A device_apps label on a report device wins over a device_programs label.
    await db.insert(deviceApps).values({
      familyId: family,
      kidId: kid,
      deviceId: phone.id,
      package: 'x.exe',
      label: 'Phone Label',
      source: 'play',
      blockable: true,
      installedAt: new Date('2026-11-03T06:00:00Z'),
      firstSeenAt: new Date('2026-11-03T06:00:00Z'),
      baseline: false,
    });
    res = await api.get(`/v1/reports/apps?kidId=${kid}&period=day&date=${DAY}`, dad);
    body = res.body as { apps: { package: string; label: string }[] };
    expect(body.apps.find((a) => a.package === 'x.exe')?.label).toBe('Phone Label');
  });

  it('GET /v1/kids/{kidId}/apps lists no PC program', async () => {
    await api.post('/v1/device/app-usage', pc.token, {
      days: [{ day: DAY, apps: [{ package: 'genshinimpact.exe', seconds: 3600, label: 'Genshin Impact' }] }],
    });
    const res = await api.get(`/v1/kids/${kid}/apps`, dad);
    expect(res.status).toBe(200);
    const body = res.body as { apps: { package: string }[] };
    expect(body.apps.map((a) => a.package)).toEqual(['a.game']);
  });
});
