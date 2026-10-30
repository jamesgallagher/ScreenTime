using Microsoft.UI.Dispatching;
using ScreenTime.Core.Time;
using ScreenTime.Core.Tray;

namespace ScreenTime.Tray;

/// <summary>
/// Fake statuses for <c>--demo [state]</c>, so the front end can be seen without the service. With a state name it
/// shows that one; without, it moves through them all every 5 s and shows the toasts on the way.
/// </summary>
internal static class DemoStatus
{
    public static readonly string[] Names = ["plenty", "low", "critical", "offline", "parent", "out", "bedtime"];

    public static TrayStatus For(string name)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        TrayStatus open(long left) => new("Alex", "Screens", null, left, 7_200 - Math.Min(left, 7_200), now + left * 1000,
            "8:30 pm", null, 15, 5, true, now - 20_000, false, null, ["Mum", "Dad"]);
        return name switch
        {
            "low" => open(14 * 60),
            "critical" => open(4 * 60 + 20),
            "offline" => open(52 * 60) with { Online = false },
            "parent" => open(52 * 60) with { ParentMode = true, LockAtMs = null, ParentModeEnds = "4:15 pm" },
            "out" => open(0) with { LockReason = LockReason.OutOfTime, LockAtMs = null, UsedSec = 7_200 },
            "bedtime" => open(0) with { LockReason = LockReason.Bedtime, LockAtMs = null, Bedtime = null, BackAt = "7:00 am" },
            _ => open(72 * 60),
        };
    }

    /// <summary>Feeds <paramref name="model"/> one state, or all of them in turn.</summary>
    public static void Run(TrayModel model, DispatcherQueue ui, string? name)
    {
        if (name is not null)
        {
            model.Update(For(name));
            return;
        }
        var i = 0;
        var timer = ui.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(5);
        void Next()
        {
            var state = Names[i++ % Names.Length];
            model.Update(For(state));
            switch (state)
            {
                case "low": model.Toast("15 minutes of Screens left"); break;
                case "critical": model.Toast("5 minutes left. Save your work."); break;
                case "out": model.Toast("Out of Screens time. Ask Mum or Dad."); break;
                case "plenty" when i > 1: model.Toast("Dad added 15 minutes"); break;
            }
        }
        timer.Tick += (_, _) => Next();
        Next();
        timer.Start();
    }
}
