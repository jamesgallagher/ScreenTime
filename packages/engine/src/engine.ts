import { DateTime } from 'luxon';

export type LockReason = 'out_of_time' | 'bedtime' | 'before_wake';

export interface EngineInput {
  /** Family IANA time zone, e.g. "Australia/Sydney". */
  tz: string;
  /** Local date being evaluated, "YYYY-MM-DD". */
  date: string;
  /** Trusted current instant, ISO 8601 with offset. */
  now: string;
  /** Today's schedule for this pool. */
  day: { allowanceMin: number; wake: string; bedtime: string };
  /** Grants for this kid + pool + date. minutes may be negative. */
  grants: { minutes: number; createdAt: string }[];
  /** Usage segments of ALL devices in this pool. end null = still open (read as now). */
  segments: { start: string; end: string | null }[];
}

export interface EngineResult {
  locked: boolean;
  lockReason: LockReason | null;
  remainingSec: number;
  /** ISO 8601 UTC (Date.toISOString()), or null if no lock before the end of the day. */
  nextLockAt: string | null;
  /** ISO 8601 UTC (Date.toISOString()). */
  reevaluateAt: string;
  usedSec: number;
  overspendSec: number;
}

type Period = 'morning' | 'allowed' | 'evening';

/** Local "date at HH:MM" in the family time zone, as epoch milliseconds. */
function localMs(date: string, time: string, tz: string): number {
  return DateTime.fromISO(`${date}T${time}`, { zone: tz }).toMillis();
}

export function evaluate(input: EngineInput): EngineResult {
  const tz = input.tz;

  // Step 1: key instants.
  const nowMs = Date.parse(input.now);
  const dayStart = localMs(input.date, '00:00', tz);
  const dayEnd = DateTime.fromISO(input.date, { zone: tz })
    .plus({ days: 1 })
    .startOf('day')
    .toMillis();
  const wakeAt = localMs(input.date, input.day.wake, tz);
  const bedAt = input.day.bedtime === '24:00' ? dayEnd : localMs(input.date, input.day.bedtime, tz);

  // Step 2: periods. morning = [dayStart, wakeAt), allowed = [wakeAt, bedAt), evening = [bedAt, dayEnd).
  const periodOf = (t: number): Period =>
    t < wakeAt ? 'morning' : t < bedAt ? 'allowed' : 'evening';

  // Step 3: used time. Union length (seconds) of segments clipped to [from, to).
  const used = (from: number, to: number): number => {
    const pieces: [number, number][] = [];
    for (const seg of input.segments) {
      const start = Date.parse(seg.start);
      const end = seg.end === null ? nowMs : Date.parse(seg.end);
      const cs = Math.max(start, Math.max(from, dayStart));
      const ce = Math.min(end, Math.min(to, nowMs, dayEnd));
      if (ce > cs) pieces.push([cs, ce]);
    }
    pieces.sort((a, b) => a[0] - b[0]);
    let totalMs = 0;
    let curStart = 0;
    let curEnd = 0;
    let hasCur = false;
    for (const [s, e] of pieces) {
      if (!hasCur || s > curEnd) {
        if (hasCur) totalMs += curEnd - curStart;
        curStart = s;
        curEnd = e;
        hasCur = true;
      } else {
        curEnd = Math.max(curEnd, e);
      }
    }
    if (hasCur) totalMs += curEnd - curStart;
    return Math.floor(totalMs / 1000);
  };

  const usedMorning = used(dayStart, wakeAt);
  const usedAllowed = used(wakeAt, bedAt);
  const usedEvening = used(bedAt, dayEnd);

  // Step 4: grants.
  const grantSec = (p: Period): number =>
    input.grants.reduce(
      (sum, g) => (periodOf(Date.parse(g.createdAt)) === p ? sum + g.minutes * 60 : sum),
      0,
    );

  // Step 5: allowance.
  const allowanceLeft = input.day.allowanceMin * 60 + grantSec('allowed') - usedAllowed;

  const capToDay = (x: number | null): number | null => (x === null || x >= dayEnd ? null : x);

  // Step 6: state, by the period that contains now.
  let locked: boolean;
  let lockReason: LockReason | null;
  let remainingSec: number;
  let nextLockAtMs: number | null;

  const nowPeriod = periodOf(nowMs);

  if (nowPeriod === 'allowed') {
    remainingSec = Math.max(0, allowanceLeft);
    locked = allowanceLeft <= 0;
    lockReason = locked ? 'out_of_time' : null;
    nextLockAtMs = locked ? null : Math.min(nowMs + remainingSec * 1000, bedAt);
  } else {
    const P = nowPeriod; // 'morning' | 'evening'
    const curfewLeft = grantSec(P) - (P === 'morning' ? usedMorning : usedEvening);
    remainingSec = Math.max(0, curfewLeft);
    locked = curfewLeft <= 0;
    lockReason = locked ? (P === 'morning' ? 'before_wake' : 'bedtime') : null;
    if (locked) {
      nextLockAtMs = null;
    } else {
      const t = nowMs + remainingSec * 1000;
      if (P === 'morning' && t >= wakeAt) {
        nextLockAtMs =
          allowanceLeft > 0 ? Math.min(wakeAt + allowanceLeft * 1000, bedAt) : wakeAt;
      } else {
        nextLockAtMs = t;
      }
    }
  }

  nextLockAtMs = capToDay(nextLockAtMs);

  // Step 7: reevaluateAt.
  const candidates: number[] = [dayEnd];
  if (nextLockAtMs !== null) candidates.push(nextLockAtMs);
  if (nowMs < wakeAt && wakeAt < dayEnd) candidates.push(wakeAt);
  if (nowMs < bedAt && bedAt < dayEnd) candidates.push(bedAt);
  const reevaluateAt = Math.min(...candidates);

  // Step 8: result.
  const usedSec = usedMorning + usedAllowed + usedEvening;
  const overspendSec = Math.max(0, -allowanceLeft);

  return {
    locked,
    lockReason,
    remainingSec,
    nextLockAt: nextLockAtMs === null ? null : new Date(nextLockAtMs).toISOString(),
    reevaluateAt: new Date(reevaluateAt).toISOString(),
    usedSec,
    overspendSec,
  };
}
