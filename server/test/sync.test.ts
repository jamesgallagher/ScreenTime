import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import {
  devices,
  families,
  grants,
  kidContacts,
  kids,
  messagePresets,
  parentModeSessions,
  parents,
  scheduleVersions,
  sosIncidents,
  timeRequests,
  usageSegments,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import { client, resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/**
 * A fixed-offset zone where it is about midday right now, so the times these tests use (at most two
 * hours either side of now) never cross local midnight, whenever the tests run.
 */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

const zone = middayZone();
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
/** Now plus `m` minutes, as ISO 8601. */
const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** Every day the same, with no curfew, so the result does not depend on the weekday or the hour. */
const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

describe.skipIf(!url)('sync routes', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const deps = { db, config: testConfig(url ?? ''), mailer };
  const api = client(deps);
  const app = createApp(deps);

  let familyA = '';
  let familyB = '';
  let mumId = '';
  let mum = '';
  let bea = '';

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'phone' | 'tablet' | 'pc', name: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: form === 'pc' ? 'windows' : 'android',
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

  async function getState(token: string | null, ifNoneMatch?: string) {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
    const res = await app.request('/v1/device/state', { headers });
    const text = await res.text();
    return { status: res.status, etag: res.headers.get('etag'), body: text ? JSON.parse(text) : null };
  }

  const segment = (startMin: number, endMin: number | null, recordedOffline = false) => ({
    id: randomUUID(),
    startedAt: at(startMin),
    endedAt: endMin === null ? null : at(endMin),
    recordedOffline,
  });

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: zone, parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    familyA = a?.id ?? '';
    familyB = b?.id ?? '';
    const [p1, , p3] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum', phoneE164: '+61400000001' },
        { familyId: familyA, email: 'old@example.com', displayName: 'Old', disabledAt: new Date() },
        { familyId: familyB, email: 'bea@example.com', displayName: 'Bea' },
      ])
      .returning();
    mumId = p1?.id ?? '';
    mum = await tokenFor({ parentId: mumId, familyId: familyA });
    bea = await tokenFor({ parentId: p3?.id ?? '', familyId: familyB });
    await db.insert(messagePresets).values([
      { familyId: familyA, text: 'Can I have more time?', sort: 0 },
      { familyId: familyB, text: 'Family B preset', sort: 0 },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('GET /v1/device/state', () => {
    it('needs a device token', async () => {
      expect((await getState(null)).status).toBe(401);
      expect((await getState('not-a-token')).status).toBe(401);
      expect((await api.get('/v1/device/state', mum)).status).toBe(401);
    });

    it('returns the whole snapshot with the version as the ETag', async () => {
      const kidId = await addKid(familyA, 'Alex');
      await db.insert(kidContacts).values({ familyId: familyA, kidId, label: 'Grandma', phoneE164: '+61400000009' });
      const phone = await addDevice(familyA, kidId, 'phone', 'Pixel 7');
      const res = await getState(phone.token);
      expect(res.status).toBe(200);
      expect(res.etag).toBe(`"${res.body.stateVersion}"`);
      expect(res.body.stateVersion).toMatch(/^[0-9a-f]{32}$/);
      expect(Math.abs(Date.parse(res.body.serverTime) - Date.now())).toBeLessThan(60_000);
      expect(res.body).toMatchObject({
        device: { id: phone.id, name: 'Pixel 7', form: 'phone', pool: 'phone', hasCellular: true },
        kid: { id: kidId, name: 'Alex' },
        family: { timezone: zone, emergencyNumber: '000', parentCodeSecret: 'A'.repeat(32) },
        parents: [{ id: mumId, displayName: 'Mum', phoneE164: '+61400000001' }],
        contacts: [{ label: 'Grandma', phoneE164: '+61400000009' }],
        messagePresets: [{ id: expect.any(String), text: 'Can I have more time?' }],
        schedule: { version: 1, warn1Min: 15, warn2Min: 5, days: flatWeek },
        today: { date: localDate(), grants: [], poolSegments: [] },
        parentMode: { active: false, endsAt: null, byName: null },
        pendingRequest: null,
        activeSos: null,
      });
    });

    it('answers 304 while nothing changed, and a new version once something does', async () => {
      const kidId = await addKid(familyA, 'Casey');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'XPPen');
      const first = await getState(tablet.token);
      const tag = first.etag ?? '';

      const same = await getState(tablet.token, tag);
      expect(same.status).toBe(304);
      expect(same.body).toBeNull();
      expect(same.etag).toBe(tag);
      // Cloudflare may weaken the tag when it compresses the response.
      expect((await getState(tablet.token, `W/${tag}`)).status).toBe(304);
      expect((await getState(tablet.token, `"other", ${tag}`)).status).toBe(304);

      await db.insert(grants).values({ id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 15, day: localDate(), createdBy: mumId });
      const changed = await getState(tablet.token, tag);
      expect(changed.status).toBe(200);
      expect(changed.body.stateVersion).not.toBe(first.body.stateVersion);
      expect(changed.body.today.grants).toEqual([
        { id: expect.any(String), minutes: 15, createdAt: expect.any(String), byName: 'Mum' },
      ]);
    });

    it("shows today's grants and segments of this device's pool only", async () => {
      const kidId = await addKid(familyA, 'Drew');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const pc = await addDevice(familyA, kidId, 'pc', 'PC');
      const phone = await addDevice(familyA, kidId, 'phone', 'Phone');
      const otherKid = await addKid(familyA, 'Other');
      const otherTablet = await addDevice(familyA, otherKid, 'tablet', 'Other tablet');
      await db.insert(grants).values([
        { id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 30, day: localDate(), createdBy: mumId },
        { id: randomUUID(), familyId: familyA, kidId, pool: 'phone', minutes: 15, day: localDate(), createdBy: mumId },
        { id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 60, day: '2020-01-01', createdBy: mumId },
      ]);
      expect((await api.post('/v1/device/usage', pc.token, { segments: [segment(-60, -30)] })).body).toEqual({ received: 1 });
      expect((await api.post('/v1/device/usage', phone.token, { segments: [segment(-20, -10)] })).status).toBe(200);
      expect((await api.post('/v1/device/usage', otherTablet.token, { segments: [segment(-20, -10)] })).status).toBe(200);
      // Yesterday's segment is left out.
      await db.insert(usageSegments).values({
        id: randomUUID(),
        familyId: familyA,
        kidId,
        deviceId: pc.id,
        pool: 'screens',
        startedAt: new Date(Date.now() - 30 * 3600_000),
        endedAt: new Date(Date.now() - 29 * 3600_000),
      });

      const res = await getState(tablet.token);
      expect(res.body.today.grants.map((g: { minutes: number }) => g.minutes)).toEqual([30]);
      expect(res.body.today.poolSegments).toEqual([
        { id: expect.any(String), deviceId: pc.id, startedAt: expect.any(String), endedAt: expect.any(String) },
      ]);
    });

    it('shows an open segment as ending when its device was last seen, once that is 10 minutes ago', async () => {
      const kidId = await addKid(familyA, 'Eli');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const pc = await addDevice(familyA, kidId, 'pc', 'PC');
      await api.post('/v1/device/usage', pc.token, { segments: [segment(-30, null)] });
      expect((await getState(tablet.token)).body.today.poolSegments[0].endedAt).toBeNull();

      const lastSeen = new Date(Date.now() - 20 * 60_000);
      await db.update(devices).set({ lastSeenAt: lastSeen }).where(eq(devices.id, pc.id));
      expect((await getState(tablet.token)).body.today.poolSegments[0].endedAt).toBe(lastSeen.toISOString());
    });

    it('shows parent mode, a pending request and an active SOS', async () => {
      const kidId = await addKid(familyA, 'Finn');
      const phone = await addDevice(familyA, kidId, 'phone', 'Phone');
      const endsAt = new Date(Date.now() + 15 * 60_000);
      await db.insert(parentModeSessions).values({
        familyId: familyA,
        kidId,
        deviceId: phone.id,
        method: 'remote',
        approvedBy: mumId,
        durationMin: 15,
        startedAt: new Date(),
        endsAt,
      });
      const requestId = randomUUID();
      await db.insert(timeRequests).values({ id: requestId, familyId: familyA, kidId, deviceId: phone.id, pool: 'phone', minutes: 30 });
      const sosId = randomUUID();
      await db.insert(sosIncidents).values({
        id: sosId,
        familyId: familyA,
        kidId,
        deviceId: phone.id,
        startedAt: new Date(),
        autoStopAt: new Date(Date.now() + 2 * 3600_000),
      });

      const res = await getState(phone.token);
      expect(res.body.parentMode).toEqual({ active: true, endsAt: endsAt.toISOString(), byName: 'Mum' });
      expect(res.body.pendingRequest).toEqual({ id: requestId, minutes: 30, createdAt: expect.any(String) });
      expect(res.body.activeSos).toEqual({ id: sosId, startedAt: expect.any(String) });

      await db.update(parentModeSessions).set({ endedAt: new Date() }).where(eq(parentModeSessions.deviceId, phone.id));
      expect((await getState(phone.token)).body.parentMode).toEqual({ active: false, endsAt: null, byName: null });
    });
  });

  describe('POST /v1/device/usage', () => {
    it('stores segments and keeps the first start and the latest end when one is sent again', async () => {
      const kidId = await addKid(familyA, 'Gus');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const open = segment(-30, null);
      const closed = segment(-60, -40, true);
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [open, closed] })).body).toEqual({ received: 2 });

      // Closing the open one, with a different start that must be ignored.
      await api.post('/v1/device/usage', tablet.token, { segments: [{ ...open, startedAt: at(-25), endedAt: at(-5) }] });
      // An open copy or an earlier end never shortens or reopens a closed segment; offline stays flagged.
      await api.post('/v1/device/usage', tablet.token, {
        segments: [
          { ...closed, endedAt: null, recordedOffline: false },
          { ...closed, endedAt: at(-50), recordedOffline: false },
        ],
      });

      const rows = await db.select().from(usageSegments).where(eq(usageSegments.deviceId, tablet.id));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(open.id)).toMatchObject({ kidId, pool: 'screens', startedAt: new Date(open.startedAt), recordedOffline: false });
      expect(byId.get(open.id)?.endedAt?.getTime()).toBeGreaterThan(Date.parse(at(-6)));
      expect(byId.get(closed.id)).toMatchObject({ endedAt: new Date(closed.endedAt ?? ''), recordedOffline: true });
    });

    it('joins repeats of one id in a single upload', async () => {
      const kidId = await addKid(familyA, 'Hana');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const s = segment(-30, null);
      const end = at(-10);
      const res = await api.post('/v1/device/usage', tablet.token, { segments: [s, { ...s, endedAt: end }, s] });
      expect(res.body).toEqual({ received: 1 });
      const [row] = await db.select().from(usageSegments).where(eq(usageSegments.id, s.id));
      expect(row?.endedAt).toEqual(new Date(end));
    });

    it("never changes another device's segment", async () => {
      const kidId = await addKid(familyA, 'Ivy');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const pc = await addDevice(familyA, kidId, 'pc', 'PC');
      const s = segment(-30, null);
      await api.post('/v1/device/usage', tablet.token, { segments: [s] });
      const res = await api.post('/v1/device/usage', pc.token, { segments: [{ ...s, endedAt: at(-1) }] });
      expect(res.body).toEqual({ received: 0 });
      const [row] = await db.select().from(usageSegments).where(eq(usageSegments.id, s.id));
      expect(row).toMatchObject({ deviceId: tablet.id, endedAt: null });
    });

    it('needs a device token and valid segments', async () => {
      const kidId = await addKid(familyA, 'Jo');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      expect((await api.post('/v1/device/usage', null, { segments: [segment(-2, -1)] })).status).toBe(401);
      expect((await api.post('/v1/device/usage', mum, { segments: [segment(-2, -1)] })).status).toBe(401);
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [] })).status).toBe(422);
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [segment(-1, -2)] })).status).toBe(422);
      expect((await api.post('/v1/device/usage', tablet.token, { segments: [{ ...segment(-2, -1), id: 'x' }] })).status).toBe(422);
    });
  });

  describe('GET /v1/today', () => {
    it('works out used and remaining time per kid and pool with the engine', async () => {
      const kidId = await addKid(familyA, 'Kai');
      const tablet = await addDevice(familyA, kidId, 'tablet', 'Tablet');
      const pc = await addDevice(familyA, kidId, 'pc', 'PC');
      const phone = await addDevice(familyA, kidId, 'phone', 'Phone');
      const gone = await addDevice(familyA, kidId, 'tablet', 'Old tablet');
      await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, gone.id));
      // Screens: 20 min on the tablet and 20 min on the PC, 10 of them at the same time: 30 min used.
      await api.post('/v1/device/usage', tablet.token, { segments: [segment(-60, -40)] });
      await api.post('/v1/device/usage', pc.token, { segments: [segment(-50, -30)] });
      // Phone: in use for 5 minutes after Mum took all 60 minutes away.
      await api.post('/v1/device/usage', phone.token, { segments: [segment(-5, null)] });
      await db.insert(grants).values([
        { id: randomUUID(), familyId: familyA, kidId, pool: 'screens', minutes: 15, day: localDate(), createdBy: mumId },
        { id: randomUUID(), familyId: familyA, kidId, pool: 'phone', minutes: -60, day: localDate(), createdBy: mumId },
      ]);

      const res = await api.get('/v1/today', mum);
      expect(res.status).toBe(200);
      expect(res.body.date).toBe(localDate());
      const kai = res.body.kids.find((k: { id: string }) => k.id === kidId);
      expect(kai.name).toBe('Kai');
      expect(kai.pools.map((p: { pool: string }) => p.pool)).toEqual(['screens', 'phone']);

      const [screens, phonePool] = kai.pools;
      expect(screens).toMatchObject({
        allowanceMin: 120,
        grantedMin: 15,
        usedSec: 1800,
        remainingSec: (120 + 15) * 60 - 1800,
        locked: false,
        lockReason: null,
        overspendSec: 0,
      });
      expect(screens.nextLockAt).toBe(new Date(Date.parse(res.body.serverTime) + screens.remainingSec * 1000).toISOString());
      expect(screens.devices).toEqual([
        { id: tablet.id, name: 'Tablet', form: 'tablet', inUse: false, lastSeenAt: expect.any(String), parentMode: null },
        { id: pc.id, name: 'PC', form: 'pc', inUse: false, lastSeenAt: expect.any(String), parentMode: null },
      ]);

      expect(phonePool).toMatchObject({ allowanceMin: 60, grantedMin: -60, remainingSec: 0, locked: true, lockReason: 'out_of_time', nextLockAt: null });
      expect(phonePool.usedSec).toBeGreaterThanOrEqual(300);
      expect(phonePool.usedSec).toBeLessThan(330);
      expect(phonePool.overspendSec).toBe(phonePool.usedSec);
      expect(phonePool.devices).toEqual([
        { id: phone.id, name: 'Phone', form: 'phone', inUse: true, lastSeenAt: expect.any(String), parentMode: null },
      ]);
    });

    it("lists only the caller's family, without archived kids", async () => {
      const archived = await addKid(familyA, 'Archived');
      await db.update(kids).set({ archivedAt: new Date() }).where(eq(kids.id, archived));
      const ben = await addKid(familyB, 'Ben');
      const mine = (await api.get('/v1/today', mum)).body.kids.map((k: { id: string }) => k.id);
      expect(mine).not.toContain(archived);
      expect(mine).not.toContain(ben);
      const theirs = await api.get('/v1/today', bea);
      expect(theirs.body.kids.map((k: { id: string }) => k.id)).toEqual([ben]);
      expect(theirs.body.kids[0].pools[0]).toMatchObject({ usedSec: 0, remainingSec: expect.any(Number), devices: [] });
    });

    it('needs a parent of a family', async () => {
      expect((await api.get('/v1/today', null)).status).toBe(401);
      const admin = await tokenFor({ parentId: null, familyId: null }, ['superadmin']);
      expect((await api.get('/v1/today', admin)).status).toBe(403);
    });
  });
});
