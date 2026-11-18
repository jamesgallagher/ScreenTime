import { and, asc, desc, eq, gt, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { evaluate, type EngineResult } from '@screentime/engine';
import type { Pool, Schedule, TodayBedtime } from '@screentime/schemas';
import type { FamilyTx } from '../db/family.js';
import { bedtimeExtensions, devices, grants, parentModeSessions, parents, scheduleVersions, usageSegments } from '../db/schema.js';
import { toSchedule } from '../kids/routes.js';

/** Today in the family's time zone (docs/SPEC.md §7.2). */
export interface FamilyDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Local midnight at the start and end of `date`, as instants. Daylight saving is handled by PostgreSQL. */
  dayStart: Date;
  dayEnd: Date;
  /** The database clock. Every request uses this one clock, so the date and the engine agree. */
  now: Date;
  /** The family's time zone. */
  timezone: string;
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
  return { date: row.date, dayStart: new Date(row.day_start), dayEnd: new Date(row.day_end), now: new Date(row.now), timezone };
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

/**
 * Loads a kid's schedule for today with tonight's bedtime already put into today's weekday entry
 * (docs/SPEC.md §7.5). The schedule's `version` is unchanged.
 */
export async function scheduleWithTonightBedtime(
  tx: FamilyTx,
  kidId: string,
  day: FamilyDay,
): Promise<Schedule> {
  const [scheduleRow] = await tx
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.kidId, kidId))
    .orderBy(desc(scheduleVersions.version))
    .limit(1);
  if (!scheduleRow) throw new Error(`kid ${kidId} has no schedule`);
  const schedule = toSchedule(scheduleRow);
  const [ext] = await tx
    .select({ bedtime: bedtimeExtensions.bedtime })
    .from(bedtimeExtensions)
    .where(and(eq(bedtimeExtensions.kidId, kidId), eq(bedtimeExtensions.day, day.date)));
  if (!ext) return schedule;
  const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay() || 7;
  const entry = schedule.days.find((d) => d.weekday === weekday);
  if (!entry) throw new Error(`schedule version ${schedule.version} has no weekday ${weekday}`);
  const scheduled = entry.bedtime;
  const tonight = ext.bedtime > scheduled ? ext.bedtime : scheduled;
  if (tonight === scheduled) return schedule;
  return {
    ...schedule,
    days: schedule.days.map((d) => (d.weekday === weekday ? { ...d, bedtime: tonight } : d)),
  };
}

/**
 * The first quarter hour that is later than both `scheduled` and the local time now (strictly: at 20:45:00
 * the earliest is 21:00). Null when that would be after 24:00 (also when `scheduled` is `24:00`).
 */
export function earliestQuarterHour(scheduled: string, timezone: string, nowIso: string): string | null {
  if (scheduled === '24:00') return null;
  const schedMin = hms(scheduled);
  const nowMin = localMinutes(timezone, nowIso);
  const first = Math.max(schedMin, nowMin - (nowMin % 15)) + 15;
  if (first >= 1440) return null;
  return `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
}

/**
 * Tonight's bedtime for a kid (docs/SPEC.md §7.5): the later of the schedule's and the extension row's.
 * `extendedBy` is the parent's display name only when the extension row is later than the schedule.
 */
export async function tonightBedtime(
  tx: FamilyTx,
  kidId: string,
  day: FamilyDay,
): Promise<TodayBedtime> {
  // Get the original schedule (without the extension).
  const [scheduleRow] = await tx
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.kidId, kidId))
    .orderBy(desc(scheduleVersions.version))
    .limit(1);
  if (!scheduleRow) throw new Error(`kid ${kidId} has no schedule`);
  const originalSchedule = toSchedule(scheduleRow);
  const entry = scheduleDay(originalSchedule, day.date);
  const scheduled = entry.bedtime;

  const [ext] = await tx
    .select({ bedtime: bedtimeExtensions.bedtime, byName: parents.displayName })
    .from(bedtimeExtensions)
    .innerJoin(parents, eq(parents.id, bedtimeExtensions.createdBy))
    .where(and(eq(bedtimeExtensions.kidId, kidId), eq(bedtimeExtensions.day, day.date)));
  const tonight = ext && ext.bedtime > scheduled ? ext.bedtime : scheduled;
  const extendedBy = ext && ext.bedtime > scheduled ? ext.byName : null;

  const earliest = earliestQuarterHour(scheduled, day.timezone, day.now.toISOString());

  return { scheduled, tonight, extendedBy, earliest };
}

/** Minutes of an "HH:MM" time. */
function hms(t: string): number {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Local minutes of `nowIso` in the family time zone. */
function localMinutes(timezone: string, nowIso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowIso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}
