namespace ScreenTime.Core.Sites;

/// <summary>One piece of title time: <paramref name="sec"/> of <paramref name="title"/> in <paramref name="program"/>,
/// from <paramref name="AtMs"/>.</summary>
public sealed record TitleSpan(long AtMs, int Sec, string Program, string Title);

/// <summary>
/// What title a browser window is showing, for one account (docs/SPEC.md §12.10): counted while counting is on
/// (unlocked, not in parent mode, tray connected) and a title is set. A span closes when the program or the title
/// changes, counting stops, or the tray goes away; a span under 1 s, or one whose end is not after its start (a
/// clock that stepped back), is not returned. All calls take the trusted time from the caller.
/// </summary>
public sealed class TitleClock
{
    private bool _counting;
    private string? _program;
    private string? _title;
    private long _start;

    /// <summary>The program <paramref name="program"/> with title <paramref name="title"/> is in front from
    /// <paramref name="atMs"/> (null: nothing). A repeated identical line does not close the running span.</summary>
    public IReadOnlyList<TitleSpan> Front(string? program, string? title, long atMs)
    {
        var repeat = program == _program && title == _title;
        var spans = repeat ? [] : CloseSpan(atMs, restart: false);
        if (!repeat)
        {
            _program = program;
            _title = title;
            if (_counting) _start = atMs;
        }
        return spans;
    }

    /// <summary>Counting turns <paramref name="on"/> from <paramref name="atMs"/>: the span so far closes, and
    /// turning it on starts a new one from that moment for the title in front.</summary>
    public IReadOnlyList<TitleSpan> Counting(bool on, long atMs)
    {
        var spans = CloseSpan(atMs, restart: false);
        _counting = on;
        if (on && _program is not null && _title is not null) _start = atMs;
        return spans;
    }

    /// <summary>Closes the span so far without changing what is in front; the span goes on from <paramref name="atMs"/>
    /// with the same program and title.</summary>
    public IReadOnlyList<TitleSpan> Flush(long atMs)
    {
        if (!_counting || _program is null || _title is null) return [];
        return CloseSpan(atMs, restart: true);
    }

    private IReadOnlyList<TitleSpan> CloseSpan(long atMs, bool restart)
    {
        if (!_counting || _program is null || _title is null) return [];
        if (atMs <= _start) return [];
        var sec = (int)((atMs - _start) / 1000);
        if (sec < 1) return [];
        if (sec > 86_400) sec = 86_400;
        var span = new TitleSpan(_start, sec, _program, _title);
        if (restart) _start = atMs;
        return [span];
    }
}
