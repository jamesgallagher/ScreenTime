import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import {
  devices,
  events,
  families,
  kids,
  notificationPrefs,
  parentSessions,
  parents,
  scheduleVersions,
  sosIncidents,
} from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import { startSweeps, sweep } from '../src/jobs/sweep.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { resetDatabase, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

/** A fixed-offset zone where it is now between 12:00 and 13:00, so the hours below are always the same. */
function middayZone() {
  const k = 12 - new Date().getUTCHours();
  return k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
}

const week = (wake: string, bedtime: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, screensMin: 120, phoneMin: 60, wake, bedtime }));

describe.skipIf(!url)('background sweeps', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };

  const sent: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      sent.push(...messages);
      return [];
    },
  };
  const deps = { db, config: testConfig(url ?? ''), mailer, pusher };
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  let familyA = '';
  let dadId = '';
  const phone = { id: '', kidId: '' };
  const tablet = { id: '', kidId: '' };
  const lateRiser = { id: '', kidId: '' };
  const earlyBed = { id: '', kidId: '' };
  const revoked = { id: '', kidId: '' };
  const disabledFamily = { id: '', kidId: '' };

  async function addKid(familyId: string, name: string, days: ReturnType<typeof week>) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'tablet' | 'phone', name: string) {
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name,
        tokenHash: hashDeviceToken(newDeviceToken()),
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, kidId };
  }

  /** Sets when the device was last seen, `hours` ago (null: never). */
  async function lastSeen(device: { id: string }, hours: number | null) {
    await db
      .update(devices)
      .set({ lastSeenAt: hours === null ? null : sql`now() - make_interval(mins => ${Math.round(hours * 60)})` })
      .where(eq(devices.id, device.id));
  }

  /** An SOS from the phone that started `startedMinAgo` minutes ago and stops by itself `autoStopMin` minutes from now. */
  async function addSos(startedMinAgo: number, autoStopMin: number, endedByKid = false) {
    const id = randomUUID();
    await db.insert(sosIncidents).values({
      id,
      familyId: familyA,
      kidId: phone.kidId,
      deviceId: phone.id,
      startedAt: sql`now() - make_interval(mins => ${startedMinAgo})`,
      autoStopAt: sql`now() + make_interval(mins => ${autoStopMin})`,
      endedAt: endedByKid ? sql`now()` : null,
      endedByKind: endedByKid ? 'kid' : null,
    });
    return id;
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const zone = middayZone();
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: zone, parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: zone, parentCodeSecret: 'B'.repeat(32), disabledAt: new Date() },
      ])
      .returning();
    familyA = a?.id ?? '';
    const [mum, dad] = await db
      .insert(parents)
      .values([
        { familyId: familyA, email: 'mum@example.com', displayName: 'Mum' },
        { familyId: familyA, email: 'dad@example.com', displayName: 'Dad' },
      ])
      .returning();
    dadId = dad?.id ?? '';
    for (const [parentId, fcmToken] of [
      [mum?.id ?? '', 'fcm-mum'],
      [dadId, 'fcm-dad'],
    ]) {
      await db
        .insert(parentSessions)
        .values({ familyId: familyA, parentId, refreshTokenHash: randomUUID(), client: 'android', clientLabel: 'Pixel', fcmToken });
    }

    const alex = await addKid(familyA, 'Alex', week('00:00', '24:00'));
    Object.assign(phone, await addDevice(familyA, alex, 'phone', 'Pixel 7'));
    Object.assign(tablet, await addDevice(familyA, alex, 'tablet', 'Tablet'));
    Object.assign(revoked, await addDevice(familyA, alex, 'tablet', 'Old tablet'));
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, revoked.id));
    // Up at 9: at about 12:30 the last 6 hours started before wake-up.
    Object.assign(lateRiser, await addDevice(familyA, await addKid(familyA, 'Sam', week('09:00', '24:00')), 'phone', 'Sam phone'));
    // In bed at 11: it is past bedtime now.
    Object.assign(earlyBed, await addDevice(familyA, await addKid(familyA, 'Kim', week('00:00', '11:00')), 'tablet', 'Kim tablet'));
    Object.assign(disabledFamily, await addDevice(b?.id ?? '', await addKid(b?.id ?? '', 'Ben', week('00:00', '24:00')), 'phone', 'Ben phone'));
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(events);
    await db.delete(sosIncidents);
    await db.update(devices).set({ lastSeenAt: sql`now()` });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('SOS auto stop', () => {
    it('ends an SOS that ran out, once, and tells the parents', async () => {
      const ranOut = await addSos(180, -60);
      const running = await addSos(10, 110);
      const safe = await addSos(30, 90, true);

      expect(await sweep(deps)).toEqual({ sosStopped: 1, offline: 0 });
      const [row] = await db.select().from(sosIncidents).where(eq(sosIncidents.id, ranOut));
      expect(row?.endedByKind).toBe('auto');
      expect(row?.endedAt?.getTime()).toBe(row?.autoStopAt.getTime());
      const others = await db.select().from(sosIncidents).where(sql`${sosIncidents.id} in (${running}, ${safe})`);
      expect(others.map((s) => s.endedByKind).sort()).toEqual(['kid', null]);

      const [event] = await db.select().from(events);
      expect(event).toMatchObject({ kind: 'sos.ended', deviceId: phone.id, payload: { sosId: ranOut, endedBy: 'auto', byName: null } });
      for (const token of ['fcm-mum', 'fcm-dad']) {
        expect(sentTo(token).map((m) => ({ high: m.high, type: m.msg.type }))).toEqual([{ high: true, type: 'sos' }]);
      }

      sent.length = 0;
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 0 });
      expect(sent).toHaveLength(0);
    });
  });

  describe('device offline', () => {
    it('reports a device silent for 6 hours of allowed time, once per absence', async () => {
      await lastSeen(phone, 7);
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 1 });
      const [device] = await db.select().from(devices).where(eq(devices.id, phone.id));
      const [event] = await db.select().from(events);
      expect(event).toMatchObject({
        kind: 'device.offline',
        kidId: phone.kidId,
        deviceId: phone.id,
        payload: { lastSeenAt: device?.lastSeenAt?.toISOString(), deviceName: 'Pixel 7' },
      });
      const [push] = sentTo('fcm-mum');
      expect(push?.high).toBe(false);
      expect(push?.msg).toMatchObject({ type: 'device.offline', data: { kind: 'device.offline', deviceName: 'Pixel 7' } });

      // Still silent: nothing new.
      sent.length = 0;
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 0 });
      expect(sent).toHaveLength(0);

      // Back for a moment, then silent again: a new absence.
      await lastSeen(phone, 6.5);
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 1 });
      expect(await db.select().from(events).where(eq(events.kind, 'device.offline'))).toHaveLength(2);
    });

    it('leaves out devices seen lately or never, revoked ones, curfew hours and disabled families', async () => {
      await lastSeen(tablet, 5.5);
      await lastSeen(phone, null);
      await lastSeen(revoked, 8);
      await lastSeen(lateRiser, 8);
      await lastSeen(earlyBed, 8);
      await lastSeen(disabledFamily, 8);
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 0 });
      expect(await db.select().from(events)).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it('does not push to a parent who muted offline devices', async () => {
      await db.insert(notificationPrefs).values({ familyId: familyA, parentId: dadId, kind: 'device.offline', enabled: false });
      await lastSeen(tablet, 7);
      expect(await sweep(deps)).toEqual({ sosStopped: 0, offline: 1 });
      await db.delete(notificationPrefs);
      expect(sentTo('fcm-mum')).toHaveLength(1);
      expect(sentTo('fcm-dad')).toHaveLength(0);
    });
  });

  describe('startSweeps', () => {
    it('sweeps on a timer until stopped', async () => {
      const ranOut = await addSos(180, -60);
      const stop = startSweeps(deps, 50);
      await new Promise((resolve) => setTimeout(resolve, 400));
      stop();
      const [row] = await db.select().from(sosIncidents).where(eq(sosIncidents.id, ranOut));
      expect(row?.endedByKind).toBe('auto');

      const later = await addSos(180, -60);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const [untouched] = await db.select().from(sosIncidents).where(eq(sosIncidents.id, later));
      expect(untouched?.endedAt).toBeNull();
    });
  });
});
