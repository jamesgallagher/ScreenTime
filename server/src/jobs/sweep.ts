import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { AppDeps } from '../app.js';
import { type FamilyTx, withFamily } from '../db/family.js';
import { devices, events, families, kids, scheduleVersions, sosIncidents } from '../db/schema.js';
import { familyToday } from '../grants/routes.js';
import { toSchedule } from '../kids/routes.js';
import { notifyParents } from '../notify/dispatch.js';
import { scheduleDay } from '../sync/day.js';

/** A device not seen for this long during allowed hours is reported (docs/SPEC.md §8.4, §14). */
const OFFLINE_AFTER = sql`interval '6 hours'`;

export interface SweepResult {
  /** SOS alerts that ran out and were marked ended by `auto`. */
  sosStopped: number;
  /** New `device.offline` events. */
  offline: number;
}

/**
 * Ends every SOS whose auto stop has passed: `ended_at` = `auto_stop_at`, `ended_by_kind` = `auto`, and a
 * `sos.ended` event. The phone stops sharing by itself at that time, so nothing is sent to it.
 */
async function stopExpiredSos(tx: FamilyTx, familyId: string) {
  const stopped = await tx
    .update(sosIncidents)
    .set({ endedAt: sql`${sosIncidents.autoStopAt}`, endedByKind: 'auto' })
    .where(and(isNull(sosIncidents.endedAt), sql`${sosIncidents.autoStopAt} <= now()`))
    .returning({ id: sosIncidents.id, kidId: sosIncidents.kidId, deviceId: sosIncidents.deviceId });
  if (stopped.length === 0) return [];
  return tx
    .insert(events)
    .values(
      stopped.map((s) => ({
        familyId,
        kidId: s.kidId,
        deviceId: s.deviceId,
        kind: 'sos.ended',
        at: sql`now()`,
        payload: { sosId: s.id, endedBy: 'auto', byName: null },
      })),
    )
    .returning({ id: events.id });
}

/**
 * Writes `device.offline` for each device that has not been seen for 6 hours, when all of those 6 hours fall
 * in today's allowed hours of its kid (from wake-up to bedtime). A device that is off overnight is not
 * reported in the morning. One event per absence: the payload keeps the `lastSeenAt` it was about.
 */
async function reportOfflineDevices(tx: FamilyTx, familyId: string) {
  const { timezone, day } = await familyToday(tx, familyId);
  const quiet = await tx
    .select({ id: devices.id, kidId: devices.kidId, name: devices.name, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .innerJoin(kids, eq(kids.id, devices.kidId))
    .where(
      and(
        isNull(devices.revokedAt),
        isNull(kids.archivedAt),
        isNotNull(devices.lastSeenAt),
        lt(devices.lastSeenAt, sql`now() - ${OFFLINE_AFTER}`),
      ),
    );
  const ids: { id: string }[] = [];
  for (const device of quiet) {
    const lastSeenAt = device.lastSeenAt?.toISOString();
    if (!lastSeenAt) continue;
    const [reported] = await tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.deviceId, device.id),
          eq(events.kind, 'device.offline'),
          sql`${events.payload} ->> 'lastSeenAt' = ${lastSeenAt}`,
        ),
      )
      .limit(1);
    if (reported) continue;

    const [scheduleRow] = await tx
      .select()
      .from(scheduleVersions)
      .where(eq(scheduleVersions.kidId, device.kidId))
      .orderBy(desc(scheduleVersions.version))
      .limit(1);
    if (!scheduleRow) throw new Error(`kid ${device.kidId} has no schedule`);
    const entry = scheduleDay(toSchedule(scheduleRow), day.date);
    // `24:00` is a valid time in PostgreSQL: the next midnight.
    const window = await tx.execute<{ allowed: boolean }>(sql`
      select now() - ${OFFLINE_AFTER} >= (${day.date}::date + ${entry.wake}::time) at time zone ${timezone}
         and now() < (${day.date}::date + ${entry.bedtime}::time) at time zone ${timezone} as allowed
    `);
    if (!window.rows[0]?.allowed) continue;

    const [event] = await tx
      .insert(events)
      .values({
        familyId,
        kidId: device.kidId,
        deviceId: device.id,
        kind: 'device.offline',
        at: sql`now()`,
        payload: { lastSeenAt, deviceName: device.name },
      })
      .returning({ id: events.id });
    if (event) ids.push(event);
  }
  return ids;
}

/** One pass over every family that is not disabled. Pushes go out after each family's transaction commits. */
export async function sweep(deps: AppDeps): Promise<SweepResult> {
  const result: SweepResult = { sosStopped: 0, offline: 0 };
  const rows = await deps.db.select({ id: families.id }).from(families).where(isNull(families.disabledAt));
  for (const { id: familyId } of rows) {
    const found = await withFamily(deps.db, familyId, async (tx) => ({
      sos: await stopExpiredSos(tx, familyId),
      offline: await reportOfflineDevices(tx, familyId),
    }));
    result.sosStopped += found.sos.length;
    result.offline += found.offline.length;
    await notifyParents(deps, familyId, [...found.sos, ...found.offline].map((e) => e.id));
  }
  return result;
}

/**
 * Runs `sweep` every `everyMs` (one minute by default) in this process. A pass that is still running when
 * the next is due is not doubled up. A failed pass is logged and the next one tries again. Returns a stop function.
 */
export function startSweeps(deps: AppDeps, everyMs = 60_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweep(deps);
    } catch (err) {
      console.error('background sweep failed', err);
    } finally {
      running = false;
    }
  }, everyMs);
  // The timer alone does not keep the process alive.
  timer.unref();
  return () => clearInterval(timer);
}
