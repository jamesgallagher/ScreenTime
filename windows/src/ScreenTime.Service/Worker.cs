using ScreenTime.Core;

namespace ScreenTime.Service;

/// <summary>Placeholder worker: logs once at start, then waits until the service stops.</summary>
public sealed class Worker(ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "ScreenTime service started. Pools: {Screens}, {Phone}",
            Pool.Screens.ToApiValue(),
            Pool.Phone.ToApiValue());

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }

        logger.LogInformation("ScreenTime service stopping.");
    }
}
