import { and, desc, eq, sql } from 'drizzle-orm';
import type { Pool } from '@screentime/schemas';
import type { FamilyTx } from '../db/family.js';
import { devices, events, families, grants, scheduleVersions, usageSegments } from '../db/schema.js';
import { toSchedule } from '../kids/routes.js';
import { dayGrants, daySegments, familyDay, poolStatus } from './day.js';

/** Less than this is not worth telling a parent about, and is the least a new report must add. */
const STEP_SEC = 60;

/**
 * Called after a device uploads segments it recorded offline (docs/SPEC.md §8.4, Q27). If the device's
 * pool is now over today's time, writes an `overspend` event, unless an earlier one today already
 * reported nearly as much. Returns the new event's id, or null.
 */
export async function recordOverspend(tx: FamilyTx, kidId: string, deviceId: string): Promise<string | null> {
  const [row] = await tx
    .select({ device: devices, timezone: families.timezone })
    .from(devices)
    .innerJoin(families, eq(families.id, devices.familyId))
    .where(eq(devices.id, deviceId));
  if (!row) throw new Error('device vanished after requireDevice');
  const pool = row.device.pool as Pool;
  const day = await familyDay(tx, row.timezone);
  const [scheduleRow] = await tx
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.kidId, kidId))
    .orderBy(desc(scheduleVersions.version))
    .limit(1);
  if (!scheduleRow) throw new Error(`kid ${kidId} has no schedule`);
  const status = poolStatus(
    row.timezone,
    day,
    toSchedule(scheduleRow),
    pool,
    await dayGrants(tx, day, and(eq(grants.kidId, kidId), eq(grants.pool, pool))),
    await daySegments(tx, day, and(eq(usageSegments.kidId, kidId), eq(usageSegments.pool, pool))),
  );
  if (status.overspendSec < STEP_SEC) return null;

  const [reported] = await tx
    .select({ max: sql`max((${events.payload} ->> 'overspendSec')::int)`.mapWith(Number) })
    .from(events)
    .where(
      and(
        eq(events.kidId, kidId),
        eq(events.kind, 'overspend'),
        sql`${events.payload} ->> 'pool' = ${pool}`,
        sql`${events.payload} ->> 'day' = ${day.date}`,
      ),
    );
  // max() of no rows is null.
  if (reported?.max && status.overspendSec < reported.max + STEP_SEC) return null;

  const [event] = await tx
    .insert(events)
    .values({
      familyId: row.device.familyId,
      kidId,
      deviceId,
      kind: 'overspend',
      at: sql`now()`,
      payload: { pool, overspendSec: status.overspendSec, day: day.date, deviceName: row.device.name },
    })
    .returning({ id: events.id });
  if (!event) throw new Error('event insert returned nothing');
  return event.id;
}
