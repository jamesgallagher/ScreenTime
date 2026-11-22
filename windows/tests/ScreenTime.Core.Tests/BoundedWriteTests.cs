using System.Diagnostics;
using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-073: bounded tray pipe writes must not stall the service (docs/SPEC.md §12.2 "Stall guard").</summary>
public class BoundedWriteTests
{
    private static ReadOnlyMemory<byte> Line => "hello\n"u8.ToArray();

    [Fact]
    public async Task AWriteThatCompletesInAHundredMillisecondsReturnsNormally()
    {
        using var stream = new FakeStream();
        stream.SetBehavior(FakeStream.Behavior.Complete, completeDelayMs: 100);

        var sw = Stopwatch.StartNew();
        var outcome = await BoundedWrite.LineAsync(stream, Line);
        sw.Stop();

        Assert.Equal(WriteOutcome.Written, outcome);
        Assert.True(sw.ElapsedMilliseconds < 1_000, $"took {sw.ElapsedMilliseconds} ms");
        Assert.Equal(Line.ToArray(), stream.WrittenBytes);
    }

    [Fact]
    public async Task AWriteThatNeverCompletesIsGivenUpWithinThreeSeconds()
    {
        // We use a real 3 s wait, not a fake clock, because the production helper uses Task.Delay.
        using var stream = new FakeStream();
        stream.SetBehavior(FakeStream.Behavior.NeverComplete);

        var sw = Stopwatch.StartNew();
        var outcome = await BoundedWrite.LineAsync(stream, Line);
        sw.Stop();

        Assert.Equal(WriteOutcome.GivenUp, outcome);
        // The card's bound is "3 s plus 200 ms": the upper check is the requirement. The lower one only says the write
        // really waited for the timeout, and it allows 100 ms of timer slack because Task.Delay can fire a millisecond
        // early (seen once: 2999 ms).
        Assert.True(sw.ElapsedMilliseconds >= 2_900, $"took {sw.ElapsedMilliseconds} ms");
        Assert.True(sw.ElapsedMilliseconds <= 3_200, $"took {sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task AWriteToAStreamThatThrowsReturnsFailed()
    {
        using var stream = new FakeStream();
        stream.SetBehavior(FakeStream.Behavior.Throw);

        var outcome = await BoundedWrite.LineAsync(stream, Line);

        Assert.Equal(WriteOutcome.Failed, outcome);
    }

    [Fact]
    public async Task AWriteToAStreamThatThrowsDropsTheLink()
    {
        var link = new TrayLink();
        using var stream = new FakeStream();
        stream.SetBehavior(FakeStream.Behavior.Throw);
        link.Connect(stream);

        var outcome = await link.SendAsync(Line);

        Assert.Equal(WriteOutcome.Failed, outcome);
        Assert.False(link.Connected);
    }

    [Fact]
    public async Task AfterAGivenUpWriteTheNextMessageGoesOutWhenTheStreamReadsAgain()
    {
        var link = new TrayLink();
        using var stuck = new FakeStream();
        stuck.SetBehavior(FakeStream.Behavior.NeverComplete);

        link.Connect(stuck);
        var givenUp = await link.SendAsync(Line);
        Assert.Equal(WriteOutcome.GivenUp, givenUp);
        Assert.False(link.Connected);

        var sw = Stopwatch.StartNew();
        var again = await link.SendAsync(Line);
        sw.Stop();
        Assert.Equal(WriteOutcome.GivenUp, again);
        Assert.True(sw.ElapsedMilliseconds < 500, $"second send took {sw.ElapsedMilliseconds} ms");

        using var fresh = new FakeStream();
        fresh.SetBehavior(FakeStream.Behavior.Complete);
        link.Connect(fresh);
        var next = await link.SendAsync(Line);
        Assert.Equal(WriteOutcome.Written, next);
        Assert.Equal(Line.ToArray(), fresh.WrittenBytes);
    }

    /// <summary>Fake stream with settable per-write behaviour. Never a production type.</summary>
    private sealed class FakeStream : Stream
    {
        private readonly MemoryStream _buffer = new();

        public enum Behavior { Complete, NeverComplete, Throw }

        private Behavior _behavior = Behavior.Complete;
        private int _completeDelayMs;

        public void SetBehavior(Behavior behavior, int completeDelayMs = 0)
        {
            _behavior = behavior;
            _completeDelayMs = completeDelayMs;
        }

        public byte[] WrittenBytes => _buffer.ToArray();

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush() { }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            switch (_behavior)
            {
                case Behavior.Complete:
                    if (_completeDelayMs > 0)
                    {
                        await Task.Delay(_completeDelayMs, cancellationToken).ConfigureAwait(false);
                    }
                    _buffer.Write(buffer.Span);
                    break;
                case Behavior.NeverComplete:
                    await Task.Delay(Timeout.Infinite, cancellationToken).ConfigureAwait(false);
                    break;
                case Behavior.Throw:
                    throw new IOException("fake write failure");
            }
        }

        public override Task FlushAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _buffer.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
