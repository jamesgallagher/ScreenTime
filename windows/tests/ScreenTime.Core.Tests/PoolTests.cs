using ScreenTime.Core;
using Xunit;

namespace ScreenTime.Core.Tests;

public class PoolTests
{
    [Fact]
    public void ApiValuesMatchTheSpec()
    {
        Assert.Equal("screens", Pool.Screens.ToApiValue());
        Assert.Equal("phone", Pool.Phone.ToApiValue());
    }

    [Fact]
    public void FromApiValueRoundTrips()
    {
        foreach (var pool in Enum.GetValues<Pool>())
        {
            Assert.Equal(pool, PoolExtensions.FromApiValue(pool.ToApiValue()));
        }
    }

    [Fact]
    public void FromApiValueReturnsNullForUnknown()
    {
        Assert.Null(PoolExtensions.FromApiValue("tablet"));
    }
}
