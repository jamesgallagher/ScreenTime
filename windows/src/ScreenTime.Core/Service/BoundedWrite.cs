namespace ScreenTime.Core.Service;

/// <summary>Result of a bounded write to a stream.</summary>
public enum WriteOutcome { Written, GivenUp, Failed }

/// <summary>
/// Writes a line to a stream with a hard timeout. The caller is a service loop that must not be stopped by
/// a dead pipe, so there is no <see cref="CancellationToken"/> parameter: the write is simply abandoned
/// after <see cref="GiveUpMs"/>. This mirrors docs/SPEC.md §12.2 "Stall guard": a tray write is given up
/// after 3 s, the pipe is dropped, and the tray reconnects.
/// </summary>
public static class BoundedWrite
{
    /// <summary>Default time to wait for the write before giving up.</summary>
    public const int GiveUpMs = 3_000;

    /// <summary>
    /// Writes <paramref name="line"/> to <paramref name="stream"/> and flushes it. Returns
    /// <see cref="WriteOutcome.Written"/> when the operation finished,
    /// <see cref="WriteOutcome.GivenUp"/> when the timeout expired, or
    /// <see cref="WriteOutcome.Failed"/> when the stream threw <see cref="IOException"/> or
    /// <see cref="ObjectDisposedException"/>. This method never throws.
    /// </summary>
    public static async Task<WriteOutcome> LineAsync(Stream stream, ReadOnlyMemory<byte> line, int timeoutMs = GiveUpMs)
    {
        var writeTask = WriteAndFlushAsync(stream, line);
        var delayTask = Task.Delay(timeoutMs);

        var winner = await Task.WhenAny(writeTask, delayTask).ConfigureAwait(false);
        if (winner == delayTask)
        {
            // Abandon the write but make sure its exception (if any) is observed.
            _ = writeTask.ContinueWith(
                t => { _ = t.Exception; },
                TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
            return WriteOutcome.GivenUp;
        }

        return await writeTask.ConfigureAwait(false);
    }

    private static async Task<WriteOutcome> WriteAndFlushAsync(Stream stream, ReadOnlyMemory<byte> line)
    {
        try
        {
            await stream.WriteAsync(line).ConfigureAwait(false);
            await stream.FlushAsync().ConfigureAwait(false);
            return WriteOutcome.Written;
        }
        catch (IOException)
        {
            return WriteOutcome.Failed;
        }
        catch (ObjectDisposedException)
        {
            return WriteOutcome.Failed;
        }
        catch (Exception)
        {
            // The caller is a service loop that must never throw because of a bad pipe.
            return WriteOutcome.Failed;
        }
    }
}
