using ScreenTime.Core.Service;
using Xunit;

namespace ScreenTime.Core.Tests;

public class DeviceLabelTests
{
    [Fact]
    public void AComputerNameAPersonGaveWins()
    {
        Assert.Equal("Conor-Gaming", DeviceLabel.Pick("Conor-Gaming", "To Be Filled By O.E.M."));
        Assert.Equal("Conor-Gaming", DeviceLabel.Pick(" Conor-Gaming ", "Inspiron 15"));
    }

    [Fact]
    public void ANameWindowsMadeUpGivesWayToARealModel()
    {
        Assert.Equal("Inspiron 15", DeviceLabel.Pick("DESKTOP-7GH3K2L", "Inspiron 15"));
        Assert.Equal("Surface Laptop 7", DeviceLabel.Pick("LAPTOP-AB12CD3", "Surface Laptop 7"));
    }

    [Fact]
    public void AMakersPlaceholderIsNeverTheName()
    {
        // Conor's PC on 13 Nov 2026: "conor on To Be Filled By O.E.M.".
        Assert.Equal("DESKTOP-7GH3K2L", DeviceLabel.Pick("DESKTOP-7GH3K2L", "To Be Filled By O.E.M."));
        Assert.Equal("DESKTOP-7GH3K2L", DeviceLabel.Pick("DESKTOP-7GH3K2L", "System Product Name"));
        Assert.True(DeviceLabel.IsPlaceholder("Default string"));
        Assert.False(DeviceLabel.IsPlaceholder("ThinkPad X1 Carbon"));
    }

    [Fact]
    public void NothingKnownIsAPC()
    {
        Assert.Equal("PC", DeviceLabel.Pick(null, null));
        Assert.Equal("PC", DeviceLabel.Pick("", "To Be Filled By O.E.M."));
        Assert.Equal("Inspiron 15", DeviceLabel.Pick(null, "Inspiron 15"));
    }
}
