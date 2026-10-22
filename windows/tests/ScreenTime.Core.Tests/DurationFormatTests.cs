using ScreenTime.Core;
using Xunit;

namespace ScreenTime.Core.Tests;

public class DurationFormatTests
{
    [Theory]
    [InlineData(-5, "less than a minute")]
    [InlineData(0, "less than a minute")]
    [InlineData(59, "less than a minute")]
    [InlineData(60, "1m")]
    [InlineData(2700, "45m")]
    [InlineData(3600, "1h")]
    [InlineData(4320, "1h 12m")]
    [InlineData(4379, "1h 12m")]
    [InlineData(36000, "10h")]
    public void Formats(long seconds, string expected)
    {
        Assert.Equal(expected, DurationFormat.Format(seconds));
    }
}
