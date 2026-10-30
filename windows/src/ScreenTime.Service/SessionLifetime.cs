using ScreenTime.Core.Service;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.ServiceProcess;
using System.Threading.Channels;

namespace ScreenTime.Service;

/// <summary>A session event the worker consumes.</summary>
public sealed record SessionEvent(SessionChange Change, uint SessionId);

/// <summary>
/// The channel of session events, and the shutdown signal: the lifetime writes a Shutdown event and waits for the
/// worker to say the shutdown work is done.
/// </summary>
public sealed class SessionEvents
{
    public Channel<SessionEvent> Channel { get; } = System.Threading.Channels.Channel.CreateUnbounded<SessionEvent>();
    public TaskCompletionSource Shutdown { get; } = new();
}

/// <summary>
/// The Windows service lifetime: it turns Windows session, power and shutdown events into the channel the worker
/// consumes.
/// </summary>
public sealed class SessionLifetime : WindowsServiceLifetime
{
    private readonly SessionEvents _events;

    public SessionLifetime(IHostEnvironment env, IHostApplicationLifetime app, ILoggerFactory loggerFactory, IOptions<HostOptions> hostOptions, IOptions<WindowsServiceLifetimeOptions> options, SessionEvents events) : base(env, app, loggerFactory, hostOptions, options)
    {
        _events = events;
        CanHandleSessionChangeEvent = true;
        CanHandlePowerEvent = true;
        CanShutdown = true;
    }

    /// <summary>A Windows session change: write the matching event, and ignore the rest.</summary>
    protected override void OnSessionChange(SessionChangeDescription d)
    {
        SessionChange? change = d.Reason switch
        {
            SessionChangeReason.SessionLogon => SessionChange.Logon,
            SessionChangeReason.SessionUnlock => SessionChange.Unlock,
            SessionChangeReason.SessionLock => SessionChange.Lock,
            SessionChangeReason.SessionLogoff => SessionChange.Logoff,
            SessionChangeReason.ConsoleDisconnect => SessionChange.Disconnect,
            SessionChangeReason.RemoteDisconnect => SessionChange.Disconnect,
            _ => null,
        };
        if (change is { } c)
        {
            _events.Channel.Writer.TryWrite(new SessionEvent(c, (uint)d.SessionId));
        }
    }

    /// <summary>A Windows power event: write Suspend on a suspend, and always say it is handled.</summary>
    protected override bool OnPowerEvent(PowerBroadcastStatus status)
    {
        if (status == PowerBroadcastStatus.Suspend)
        {
            _events.Channel.Writer.TryWrite(new SessionEvent(SessionChange.Suspend, 0));
        }
        return true;
    }

    /// <summary>
    /// Shutdown: write the Shutdown event, wait up to 3 s for the worker to say the shutdown work is done, then call
    /// the base.
    /// </summary>
    protected override void OnShutdown()
    {
        _events.Channel.Writer.TryWrite(new SessionEvent(SessionChange.Shutdown, 0));
        _events.Shutdown.Task.Wait(TimeSpan.FromSeconds(3));
        base.OnShutdown();
    }
}
