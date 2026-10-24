import { and, asc, eq, gt, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { evaluate, type EngineResult } from '@screentime/engine';
import type { Pool, Schedule } from '@screentime/schemas';
import type { FamilyTx } from '../db/family.js';
import { devices, grants, parentModeSessions, parents, usageSegments } from '../db/schema.js';

/** Today in the family's time zone (docs/SPEC.md §7.2). */
export interface FamilyDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Local midnight at the start and end of `date`, as instants. Daylight saving is handled by PostgreSQL. */
  dayStart: Date;
  dayEnd: Date;
  /** The database clock. Every request uses this one clock, so the date and the engine agree. */
  now: Date;
}

/** An open segment counts as still running only while its device keeps in touch (docs/SPEC.md §8.2). */
const OPEN_SEGMENT_STALE = sql`interval '10 minutes'`;

export async function familyDay(tx: FamilyTx, timezone: string): Promise<FamilyDay> {
  const result = await tx.execute<{ date: string; day_start: string; day_end: string; now: string }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as date,
           to_json(d.day::timestamp at time zone ${timezone}) #>> '{}' as day_start,
           to_json((d.day + 1)::timestamp at time zone ${timezone}) #>> '{}' as day_end,
           to_json(now()) #>> '{}' as now
    from (select (now() at time zone ${timezone})::date as day) d
  `);
  const row = result.rows[0];
  if (!row) throw new Error('familyDay returned nothing');
  return { date: row.date, dayStart: new Date(row.day_start), dayEnd: new Date(row.day_end), now: new Date(row.now) };
}

export interface DaySegment {
  id: string;
  kidId: string;
  deviceId: string;
  pool: Pool;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * Usage segments that overlap `day`, oldest first, with `where` added. An open segment whose device has
 * not been seen for 10 minutes ends when the device was last seen, so a phone that died mid-use does not
 * keep using up the pool.
 */
export async function daySegments(tx: FamilyTx, day: FamilyDay, where?: SQL): Promise<DaySegment[]> {
  const endedAt = sql`coalesce(${usageSegments.endedAt}, case when ${devices.lastSeenAt} < now() - ${OPEN_SEGMENT_STALE} then greatest(${devices.lastSeenAt}, ${usageSegments.startedAt}) end)`;
  const rows = await tx
    .select({
      id: usageSegments.id,
      kidId: usageSegments.kidId,
      deviceId: usageSegments.deviceId,
      pool: usageSegments.pool,
      startedAt: usageSegments.startedAt,
      endedAt: endedAt.mapWith(usageSegments.endedAt),
    })
    .from(usageSegments)
    .innerJoin(devices, eq(devices.id, usageSegments.deviceId))
    .where(
      and(
        lt(usageSegments.startedAt, day.dayEnd),
        or(sql`${endedAt} is null`, sql`${endedAt} > ${day.dayStart.toISOString()}::timestamptz`),
        where,
      ),
    )
    .orderBy(asc(usageSegments.startedAt), asc(usageSegments.id));
  return rows.map((r) => ({ ...r, pool: r.pool as Pool }));
}

export interface DayGrant {
  id: string;
  kidId: string;
  pool: Pool;
  minutes: number;
  createdAt: Date;
  byName: string;
}

/** Grants of `day`, oldest first, with `where` added. */
export async function dayGrants(tx: FamilyTx, day: FamilyDay, where?: SQL): Promise<DayGrant[]> {
  const rows = await tx
    .select({
      id: grants.id,
      kidId: grants.kidId,
      pool: grants.pool,
      minutes: grants.minutes,
      createdAt: grants.createdAt,
      byName: parents.displayName,
    })
    .from(grants)
    .innerJoin(parents, eq(parents.id, grants.createdBy))
    .where(and(eq(grants.day, day.date), where))
    .orderBy(asc(grants.createdAt), asc(grants.id));
  return rows.map((r) => ({ ...r, pool: r.pool as Pool }));
}

export interface ActiveParentMode {
  deviceId: string;
  endsAt: Date | null;
  byName: string | null;
}

/** Parent-mode sessions that are on right now, with `where` added. */
export async function activeParentModes(tx: FamilyTx, where?: SQL): Promise<ActiveParentMode[]> {
  return tx
    .select({ deviceId: parentModeSessions.deviceId, endsAt: parentModeSessions.endsAt, byName: parents.displayName })
    .from(parentModeSessions)
    .leftJoin(parents, eq(parents.id, parentModeSessions.approvedBy))
    .where(
      and(
        isNotNull(parentModeSessions.startedAt),
        isNull(parentModeSessions.endedAt),
        or(isNull(parentModeSessions.endsAt), gt(parentModeSessions.endsAt, sql`now()`)),
        where,
      ),
    )
    .orderBy(asc(parentModeSessions.startedAt));
}

/** The schedule entry for the weekday of `date` (ISO weekday, 1 = Monday). */
export function scheduleDay(schedule: Schedule, date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  const day = schedule.days.find((d) => d.weekday === weekday);
  if (!day) throw new Error(`schedule version ${schedule.version} has no weekday ${weekday}`);
  return day;
}

/** Runs the time engine for one kid and one pool today. Pass only that kid's grants and segments for that pool. */
export function poolStatus(
  timezone: string,
  day: FamilyDay,
  schedule: Schedule,
  pool: Pool,
  poolGrants: DayGrant[],
  poolSegments: DaySegment[],
): EngineResult & { allowanceMin: number } {
  const entry = scheduleDay(schedule, day.date);
  const allowanceMin = pool === 'screens' ? entry.screensMin : entry.phoneMin;
  const result = evaluate({
    tz: timezone,
    date: day.date,
    now: day.now.toISOString(),
    day: { allowanceMin, wake: entry.wake, bedtime: entry.bedtime },
    grants: poolGrants.map((g) => ({ minutes: g.minutes, createdAt: g.createdAt.toISOString() })),
    segments: poolSegments.map((s) => ({ start: s.startedAt.toISOString(), end: s.endedAt?.toISOString() ?? null })),
  });
  return { ...result, allowanceMin };
}
