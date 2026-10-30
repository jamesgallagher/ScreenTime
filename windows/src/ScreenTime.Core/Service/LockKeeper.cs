using System.Globalization;
using ScreenTime.Core.Api;
using ScreenTime.Core.Time;

namespace ScreenTime.Core.Service;

/// <summary>The steps the worker applies to one kid session (docs/SPEC.md §12.2, Q7).</summary>
public enum LockStep { StartCounting, Lock, Disconnect, Toast }

/// <summary>
/// Locking and relocking one kid session. One <see cref="LockKeeper"/> per session; the service calls it and it only
/// decides. The 10 s before a relock are not counted, and a lock the tray confirms is tried again after 10 s.
/// </summary>
public sealed class LockKeeper
{
    private bool _unlocked;
    private bool _counting;
    private long? _relockAt;
    private long? _lockSentAt;
    private bool _confirmed;
    private bool _disconnectSent;

    /// <summary>The session was unlocked or logged on.</summary>
    public IReadOnlyList<LockStep> OnUnlock(bool outOfTime, long nowMs)
    {
        _unlocked = true;
        _lockSentAt = null;
        _confirmed = false;
        _disconnectSent = false;
        if (outOfTime)
        {
            _relockAt = nowMs + 10_000;
            _counting = false;
            return [LockStep.Toast];
        }
        _relockAt = null;
        _counting = true;
        return [LockStep.StartCounting];
    }

    /// <summary>The session was locked, logged off, disconnected, or the PC sleeps: everything back to the start.</summary>
    public void OnLocked()
    {
        _unlocked = false;
        _counting = false;
        _relockAt = null;
        _lockSentAt = null;
        _confirmed = false;
        _disconnectSent = false;
    }

    /// <summary>The tray says <c>LockWorkStation</c> worked.</summary>
    public void OnLockConfirmed()
    {
        _confirmed = true;
    }

    /// <summary>Called every second.</summary>
    public IReadOnlyList<LockStep> Check(bool outOfTime, long nowMs)
    {
        if (!_unlocked) return [];
        if (!outOfTime)
        {
            _relockAt = null;
            _lockSentAt = null;
            _confirmed = false;
            _disconnectSent = false;
            if (!_counting)
            {
                _counting = true;
                return [LockStep.StartCounting];
            }
            return [];
        }
        if (_relockAt is { } relockAt && nowMs < relockAt) return [];
        if (_lockSentAt is { } lockSentAt)
        {
            if (nowMs < lockSentAt + 10_000)
            {
                if (!_confirmed && !_disconnectSent && nowMs >= lockSentAt + 2_000)
                {
                    _disconnectSent = true;
                    return [LockStep.Disconnect];
                }
                return [];
            }
        }
        _lockSentAt = nowMs;
        _relockAt = null;
        _confirmed = false;
        _disconnectSent = false;
        return [LockStep.Lock];
    }

    /// <summary>Parent mode is on now: active and not ended (an <c>EndsAt</c> that is after now).</summary>
    public static bool ParentModeOn(DeviceState state, long nowMs)
    {
        var parentMode = state.ParentMode;
        if (!parentMode.Active) return false;
        if (parentMode.EndsAt is null) return true;
        var endsAt = DateTimeOffset.Parse(parentMode.EndsAt, CultureInfo.InvariantCulture);
        return endsAt.ToUnixTimeMilliseconds() > nowMs;
    }

    /// <summary>Out of time: the engine says locked and parent mode is not on.</summary>
    public static bool OutOfTime(EngineResult result, DeviceState state, long nowMs)
    {
        return result.Locked && !ParentModeOn(state, nowMs);
    }
}
