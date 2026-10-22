namespace ScreenTime.Core;

/// <summary>A daily pool of time for one kid (docs/SPEC.md §6).</summary>
public enum Pool
{
    Screens,
    Phone,
}

public static class PoolExtensions
{
    /// <summary>The exact text used in the API and the database.</summary>
    public static string ToApiValue(this Pool pool) => pool switch
    {
        Pool.Screens => "screens",
        Pool.Phone => "phone",
        _ => throw new ArgumentOutOfRangeException(nameof(pool), pool, null),
    };

    /// <summary>Returns the pool for an API value, or null if the value is unknown.</summary>
    public static Pool? FromApiValue(string value) => value switch
    {
        "screens" => Pool.Screens,
        "phone" => Pool.Phone,
        _ => null,
    };
}
