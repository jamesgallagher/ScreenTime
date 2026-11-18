import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq } from 'drizzle-orm';
import { BedtimeTonightPut, type Pool, TodayBedtime } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireFamilyParent } from '../auth/guards.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { bedtimeExtensions, events, families, parents, scheduleVersions } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { findKid } from '../kids/routes.js';
import { notifyParents, sendToDevices } from '../notify/dispatch.js';
import { bearer, errorResponses, jsonBody, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';
import { type FamilyDay, familyDay, tonightBedtime } from '../sync/day.js';
import { secondsToMidnight } from '../grants/routes.js';

type Router = ReturnType<typeof createRouter>;

const KidParam = z.object({ kidId: z.uuid() });

const putRoute = createRoute({
  method: 'put',
  path: '/v1/kids/{kidId}/bedtime-tonight',
  tags: ['bedtime'],
  summary: 'Extend bedtime tonight',
  description:
    'Moves the kid\u2019s bedtime later for today only. The kid keeps any time that is left until the new bedtime; with none left, the always-allowed apps keep working until then.',
  security: bearer,
  request: { params: KidParam, body: jsonBody(BedtimeTonightPut) },
  responses: {
    200: jsonResponse('Tonight\u2019s bedtime.', TodayBedtime),
    ...errorResponses(401, 403, 404, 422),
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/kids/{kidId}/bedtime-tonight',
  tags: ['bedtime'],
  summary: 'Back to the usual bedtime',
  description: 'Deletes tonight\u2019s extension; the device locks for bedtime at once if the usual bedtime has passed.',
  security: bearer,
  request: { params: KidParam },
  responses: {
    200: jsonResponse('Tonight\u2019s bedtime.', TodayBedtime),
    ...errorResponses(401, 403, 404),
  },
});

interface BedtimeChange {
  bedtime: TodayBedtime;
  changed: boolean;
  eventId: string | null;
  dayEnd: Date;
  now: Date;
}

/**
 * Stores or replaces tonight\u2019s bedtime extension and records a `bedtime.extended` event in the same
 * transaction. `pushes` says what to send once the transaction has committed; null when nothing changed.
 */
async function upsertBedtime(
  tx: FamilyTx,
  familyId: string,
  parentId: string,
  kidId: string,
  day: FamilyDay,
  bedtime: string,
): Promise<BedtimeChange> {
  const [scheduleRow] = await tx
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.kidId, kidId))
    .orderBy(desc(scheduleVersions.version))
    .limit(1);
  if (!scheduleRow) throw new Error(`kid ${kidId} has no schedule`);

  // Find today's weekday entry.
  const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay() || 7;
  const days = (scheduleRow.days as { weekday: number; bedtime: string }[]).map((d) => ({
    weekday: d.weekday,
    bedtime: d.bedtime,
  }));
  const entry = days.find((d) => d.weekday === weekday);
  if (!entry) throw new Error(`schedule has no weekday ${weekday}`);
  const scheduled = entry.bedtime;

  if (bedtime <= scheduled) {
    throw new ApiError('validation_failed', 'Pick a time after the usual bedtime.');
  }

  // Earliest: first quarter hour later than both `scheduled` and now.
  const schedMin = hms(scheduled);
  const nowMin = localMinutes(day.timezone, day.now);
  const first = Math.max(schedMin, nowMin - (nowMin % 15)) + 15;
  if (first <= 1440) {
    const earliest = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
    if (bedtime < earliest) {
      throw new ApiError('validation_failed', 'That time has already passed. Pick a later one.');
    }
  }

  // Check if the stored time was already `bedtime`.
  const [existing] = await tx
    .select({ bedtime: bedtimeExtensions.bedtime })
    .from(bedtimeExtensions)
    .where(and(eq(bedtimeExtensions.kidId, kidId), eq(bedtimeExtensions.day, day.date)));
  if (existing && existing.bedtime === bedtime) {
    const result = await tonightBedtime(tx, kidId, day);
    return { bedtime: result, changed: false, eventId: null, dayEnd: day.dayEnd, now: day.now };
  }

  // Upsert the row.
  await tx
    .insert(bedtimeExtensions)
    .values({ familyId, kidId, day: day.date, bedtime, createdBy: parentId })
    .onConflictDoUpdate({
      target: [bedtimeExtensions.kidId, bedtimeExtensions.day],
      set: { bedtime, createdBy: parentId, updatedAt: new Date() },
    });

  // Write the event.
  const [parent] = await tx.select({ displayName: parents.displayName }).from(parents).where(eq(parents.id, parentId));
  if (!parent) throw new Error('parent vanished after requireFamilyParent');
  const [event] = await tx
    .insert(events)
    .values({
      familyId,
      kidId,
      kind: 'bedtime.extended',
      at: new Date(),
      payload: { day: day.date, scheduled, bedtime, byName: parent.displayName, parentId },
    })
    .returning({ id: events.id });
  if (!event) throw new Error('event insert returned nothing');

  const result = await tonightBedtime(tx, kidId, day);
  return { bedtime: result, changed: true, eventId: event.id, dayEnd: day.dayEnd, now: day.now };
}

/**
 * Deletes tonight's bedtime extension and records a `bedtime.extended` event with `bedtime: null` in the
 * same transaction. `pushes` says what to send once the transaction has committed; null when nothing changed.
 */
async function deleteBedtime(
  tx: FamilyTx,
  familyId: string,
  kidId: string,
  day: FamilyDay,
): Promise<BedtimeChange> {
  const [existing] = await tx
    .select({ bedtime: bedtimeExtensions.bedtime })
    .from(bedtimeExtensions)
    .where(and(eq(bedtimeExtensions.kidId, kidId), eq(bedtimeExtensions.day, day.date)));
  if (!existing) {
    const result = await tonightBedtime(tx, kidId, day);
    return { bedtime: result, changed: false, eventId: null, dayEnd: day.dayEnd, now: day.now };
  }

  await tx.delete(bedtimeExtensions).where(and(eq(bedtimeExtensions.kidId, kidId), eq(bedtimeExtensions.day, day.date)));

  // Write the event.
  const [scheduleRow] = await tx
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.kidId, kidId))
    .orderBy(desc(scheduleVersions.version))
    .limit(1);
  if (!scheduleRow) throw new Error(`kid ${kidId} has no schedule`);
  const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay() || 7;
  const days = (scheduleRow.days as { weekday: number; bedtime: string }[]).map((d) => ({
    weekday: d.weekday,
    bedtime: d.bedtime,
  }));
  const entry = days.find((d) => d.weekday === weekday);
  if (!entry) throw new Error(`schedule has no weekday ${weekday}`);

  const [event] = await tx
    .insert(events)
    .values({
      familyId,
      kidId,
      kind: 'bedtime.extended',
      at: new Date(),
      payload: { day: day.date, scheduled: entry.bedtime, bedtime: null, byName: null, parentId: null },
    })
    .returning({ id: events.id });
  if (!event) throw new Error('event insert returned nothing');

  const result = await tonightBedtime(tx, kidId, day);
  return { bedtime: result, changed: true, eventId: event.id, dayEnd: day.dayEnd, now: day.now };
}

/**
 * Parent bedtime extensions: extend and back to usual (docs/SPEC.md §7.5).
 * The extension covers both pools and every device of the kid.
 */
export function registerBedtimeRoutes(app: Router, deps: AppDeps) {
  const { db, config } = deps;
  const caller = (c: Parameters<typeof requireFamilyParent>[0]) => requireFamilyParent(c, db, config.jwtSecret);

  /** After commit: tell the other parents and the kid's devices so they show the new bedtime. */
  async function sendPushes(familyId: string, kidId: string, change: BedtimeChange) {
    if (!change.changed || !change.eventId) return;
    await notifyParents(deps, familyId, [change.eventId]);
    const ttlSec = secondsToMidnight(change.dayEnd, change.now);
    await sendToDevices(
      deps,
      familyId,
      { kidId },
      { v: 1, type: 'state_changed', at: new Date().toISOString(), data: {} },
      { high: true, ttlSec },
    );
  }

  app.openapi(putRoute, async (c) => {
    const { familyId, parentId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const { bedtime } = c.req.valid('json');
    const change = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const day = await familyDay(tx, (await familyTimezone(tx, familyId)));
      return upsertBedtime(tx, familyId, parentId, kidId, day, bedtime);
    });
    await sendPushes(familyId, kidId, change);
    return c.json(change.bedtime, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { familyId } = await caller(c);
    const { kidId } = c.req.valid('param');
    const change = await withFamily(db, familyId, async (tx) => {
      await findKid(tx, kidId);
      const day = await familyDay(tx, (await familyTimezone(tx, familyId)));
      return deleteBedtime(tx, familyId, kidId, day);
    });
    await sendPushes(familyId, kidId, change);
    return c.json(change.bedtime, 200);
  });
}

async function familyTimezone(tx: FamilyTx, familyId: string): Promise<string> {
  const [family] = await tx.select({ timezone: families.timezone }).from(families).where(eq(families.id, familyId));
  if (!family) throw new Error('family vanished after requireFamilyParent');
  return family.timezone;
}

/** Minutes of an "HH:MM" time. */
function hms(t: string): number {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Local minutes of `now` in the family time zone. */
function localMinutes(timezone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}
