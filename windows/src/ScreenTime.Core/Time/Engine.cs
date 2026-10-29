using System.Globalization;

namespace ScreenTime.Core.Time;

/// <summary>Why a pool is locked (docs/SPEC.md §7.3).</summary>
public enum LockReason
{
    OutOfTime,
    Bedtime,
    BeforeWake,
}

/// <summary>API words for lock reasons.</summary>
public static class LockReasonExtensions
{
    /// <summary>The exact text used in the API and the test vectors.</summary>
    public static string ToApiValue(this LockReason reason) => reason switch
    {
        LockReason.OutOfTime => "out_of_time",
        LockReason.Bedtime => "bedtime",
        LockReason.BeforeWake => "before_wake",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };
}

/// <summary>Today's schedule for one pool. Wake and Bedtime are "HH:mm"; Bedtime may be "24:00" (the end of the day).</summary>
public sealed record DaySchedule(int AllowanceMin, string Wake, string Bedtime);

/// <summary>Extra minutes from a parent, negative to take time away.</summary>
public sealed record Grant(int Minutes, DateTimeOffset CreatedAt);

/// <summary>Time a device of the pool was in use. End null means still open: it is read as Now.</summary>
public sealed record Segment(DateTimeOffset Start, DateTimeOffset? End);

/// <summary>Everything the engine needs for one kid, one pool and one local date (docs/SPEC.md §7.1).</summary>
public sealed record EngineInput(TimeZoneInfo Tz, DateOnly Date, DateTimeOffset Now, DaySchedule Day, IReadOnlyList<Grant> Grants, IReadOnlyList<Segment> Segments);

/// <summary>The engine's answer for one kid, one pool and one local date (docs/SPEC.md §7.2).</summary>
public sealed record EngineResult(bool Locked, LockReason? LockReason, long RemainingSec, DateTimeOffset? NextLockAt, DateTimeOffset ReevaluateAt, long UsedSec, long OverspendSec);

/// <summary>
/// The time engine of docs/SPEC.md §7: the same steps as Engine.kt and engine.ts, and it must pass every case in
/// test-vectors/engine/. Instants are epoch milliseconds inside; used time is rounded down to whole seconds.
/// </summary>
public static class Engine
{
    private enum Period { Morning, Allowed, Evening }

    /// <summary>Evaluates the engine's rules (docs/SPEC.md §7) for one kid, one pool and one local date.</summary>
    public static EngineResult Evaluate(EngineInput input)
    {
        var tz = input.Tz;

        // Step 1: key instants. Days are found through the time zone, never by adding 24 hours.
        long nowMs = input.Now.ToUnixTimeMilliseconds();
        long dayStart = LocalMs(input.Date, new TimeOnly(0, 0), tz);
        long dayEnd = LocalMs(input.Date.AddDays(1), new TimeOnly(0, 0), tz);
        long wakeAt = LocalMs(input.Date, TimeOnly.ParseExact(input.Day.Wake, "HH:mm", CultureInfo.InvariantCulture), tz);
        long bedAt = input.Day.Bedtime == "24:00" ? dayEnd : LocalMs(input.Date, TimeOnly.ParseExact(input.Day.Bedtime, "HH:mm", CultureInfo.InvariantCulture), tz);

        // Step 2: periods. morning = [dayStart, wakeAt), allowed = [wakeAt, bedAt), evening = [bedAt, dayEnd).
        static Period PeriodOf(long t, long wakeAt, long bedAt) =>
            t < wakeAt ? Period.Morning : t < bedAt ? Period.Allowed : Period.Evening;

        // Step 3: used time. Length in seconds of the union of the segments, clipped to [from, to), the day and now.
        long Used(long from, long to)
        {
            var pieces = new List<(long, long)>();
            foreach (var seg in input.Segments)
            {
                long start = seg.Start.ToUnixTimeMilliseconds();
                long end = seg.End is { } e ? e.ToUnixTimeMilliseconds() : nowMs;
                long cs = Math.Max(Math.Max(start, from), dayStart);
                long ce = Math.Min(Math.Min(end, Math.Min(to, nowMs)), dayEnd);
                if (ce > cs) pieces.Add((cs, ce));
            }
            pieces.Sort((a, b) => a.Item1.CompareTo(b.Item1));
            long totalMs = 0;
            long curStart = 0, curEnd = 0;
            bool hasCur = false;
            foreach (var (s, e) in pieces)
            {
                if (!hasCur || s > curEnd)
                {
                    if (hasCur) totalMs += curEnd - curStart;
                    curStart = s;
                    curEnd = e;
                    hasCur = true;
                }
                else
                {
                    curEnd = Math.Max(curEnd, e);
                }
            }
            if (hasCur) totalMs += curEnd - curStart;
            return totalMs / 1000;
        }

        long usedMorning = Used(dayStart, wakeAt);
        long usedAllowed = Used(wakeAt, bedAt);
        long usedEvening = Used(bedAt, dayEnd);

        // Step 4: grants belong to the period that contains their createdAt.
        long GrantSec(Period p) => input.Grants
            .Where(g => PeriodOf(g.CreatedAt.ToUnixTimeMilliseconds(), wakeAt, bedAt) == p)
            .Sum(g => g.Minutes * 60L);

        // Step 5: allowance.
        long allowanceLeft = (long)input.Day.AllowanceMin * 60 + GrantSec(Period.Allowed) - usedAllowed;

        // Step 6: state, by the period that contains now.
        bool locked;
        LockReason? lockReason;
        long remainingSec;
        long? nextLockAtMs;

        var nowPeriod = PeriodOf(nowMs, wakeAt, bedAt);
        if (nowPeriod == Period.Allowed)
        {
            remainingSec = Math.Max(0L, allowanceLeft);
            locked = allowanceLeft <= 0;
            lockReason = locked ? LockReason.OutOfTime : null;
            nextLockAtMs = locked ? null : Math.Min(nowMs + remainingSec * 1000, bedAt);
        }
        else
        {
            bool morning = nowPeriod == Period.Morning;
            long curfewLeft = GrantSec(nowPeriod) - (morning ? usedMorning : usedEvening);
            remainingSec = Math.Max(0L, curfewLeft);
            locked = curfewLeft <= 0;
            lockReason = !locked ? null : morning ? LockReason.BeforeWake : LockReason.Bedtime;
            nextLockAtMs = null;
            if (!locked)
            {
                long t = nowMs + remainingSec * 1000;
                if (morning && t >= wakeAt)
                {
                    // The allowed period takes over at wake-up.
                    nextLockAtMs = allowanceLeft > 0 ? Math.Min(wakeAt + allowanceLeft * 1000, bedAt) : wakeAt;
                }
                else
                {
                    nextLockAtMs = t;
                }
            }
        }

        // A lock at or after the end of the day is tomorrow's business.
        if (nextLockAtMs is { } nla && nla >= dayEnd) nextLockAtMs = null;

        // Step 7: reevaluateAt = the earliest of nextLockAt, the next period boundary and dayEnd.
        long reevaluateAt = dayEnd;
        if (nextLockAtMs is { } nla2) reevaluateAt = Math.Min(reevaluateAt, nla2);
        if (nowMs < wakeAt && wakeAt < dayEnd) reevaluateAt = Math.Min(reevaluateAt, wakeAt);
        if (nowMs < bedAt && bedAt < dayEnd) reevaluateAt = Math.Min(reevaluateAt, bedAt);

        // Step 8: result.
        return new EngineResult(
            locked,
            lockReason,
            remainingSec,
            nextLockAtMs is { } nla3 ? DateTimeOffset.FromUnixTimeMilliseconds(nla3) : null,
            DateTimeOffset.FromUnixTimeMilliseconds(reevaluateAt),
            usedMorning + usedAllowed + usedEvening,
            Math.Max(0L, -allowanceLeft));
    }

    /// <summary>"date at time" in the family time zone, as epoch milliseconds. A time skipped by daylight saving moves forward; a repeated time counts the earlier one.</summary>
    public static long LocalMs(DateOnly date, TimeOnly time, TimeZoneInfo tz)
    {
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);
        TimeSpan offset;
        if (tz.IsAmbiguousTime(local))
        {
            // The clock went back, so the time happens twice; the largest offset is the earlier instant.
            offset = tz.GetAmbiguousTimeOffsets(local).Max();
        }
        else if (tz.IsInvalidTime(local))
        {
            // The clock jumped forward, so the time never happens; use the offset from before the jump.
            offset = tz.GetUtcOffset(local.AddHours(-2));
        }
        else
        {
            offset = tz.GetUtcOffset(local);
        }
        return new DateTimeOffset(local, offset).ToUnixTimeMilliseconds();
    }
}
