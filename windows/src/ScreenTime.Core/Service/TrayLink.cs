namespace ScreenTime.Core.Service;

/// <summary>
/// One connection to a tray's pipe (CARD-073): every write is bounded, and a write that is given up
/// drops the connection, so later messages wait for the tray to connect again.
/// This mirrors docs/SPEC.md §12.2 "Stall guard".
/// </summary>
public sealed class TrayLink
{
    private sealed class Connection
    {
        public Stream Stream { get; }
        public SemaphoreSlim Gate { get; } = new(1, 1);
        public volatile bool Dropped;

        public Connection(Stream stream) => Stream = stream;
    }

    private Connection? _connection;

    /// <summary>True when a stream is connected and has not been dropped.</summary>
    public bool Connected => Volatile.Read(ref _connection) is { } c && !c.Dropped;

    /// <summary>The tray connected with a fresh pipe; the previous connection, if any, is abandoned.</summary>
    public void Connect(Stream stream)
    {
        var next = new Connection(stream);
        var previous = Interlocked.Exchange(ref _connection, next);
        if (previous is not null)
        {
            previous.Dropped = true;
            previous.Gate.Dispose();
        }
    }

    /// <summary>The pipe is gone (the tray's end closed, or it was dropped): clear the connection.</summary>
    public void Disconnect()
    {
        var current = Interlocked.Exchange(ref _connection, null);
        if (current is not null)
        {
            current.Dropped = true;
            current.Gate.Dispose();
        }
    }

    /// <summary>
    /// Sends one line to the current stream. Returns <see cref="WriteOutcome.Written"/> when the write finished.
    /// If the gate cannot be entered within <paramref name="timeoutMs"/>, or <see cref="BoundedWrite.LineAsync"/>
    /// returns <see cref="WriteOutcome.GivenUp"/> or <see cref="WriteOutcome.Failed"/>, this connection is marked
    /// dropped, <see cref="Connected"/> becomes false, and that outcome is returned (a gate timeout counts as
    /// <see cref="WriteOutcome.GivenUp"/>). After a drop, subsequent calls return <see cref="WriteOutcome.GivenUp"/>
    /// at once without touching the stream until <see cref="Connect"/> is called. This method never throws.
    /// </summary>
    public async Task<WriteOutcome> SendAsync(ReadOnlyMemory<byte> line, int timeoutMs = BoundedWrite.GiveUpMs)
    {
        var connection = Volatile.Read(ref _connection);
        if (connection is null || connection.Dropped) return WriteOutcome.GivenUp;

        bool entered = false;
        try
        {
            entered = await connection.Gate.WaitAsync(timeoutMs).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return MarkDropped(connection, WriteOutcome.Failed);
        }

        if (!entered) return MarkDropped(connection, WriteOutcome.GivenUp);

        if (!ReferenceEquals(connection, Volatile.Read(ref _connection)) || connection.Dropped)
            return WriteOutcome.GivenUp;

        try
        {
            var outcome = await BoundedWrite.LineAsync(connection.Stream, line, timeoutMs).ConfigureAwait(false);
            if (outcome != WriteOutcome.Written) return MarkDropped(connection, outcome);
            return outcome;
        }
        catch (Exception)
        {
            return MarkDropped(connection, WriteOutcome.Failed);
        }
        finally
        {
            if (entered && !connection.Dropped)
            {
                try { connection.Gate.Release(); } catch (ObjectDisposedException) { }
            }
        }
    }

    private WriteOutcome MarkDropped(Connection connection, WriteOutcome outcome)
    {
        connection.Dropped = true;
        Interlocked.CompareExchange(ref _connection, null, connection);
        return outcome;
    }
}
