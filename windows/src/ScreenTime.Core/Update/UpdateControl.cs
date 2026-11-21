namespace ScreenTime.Core.Update;

/// <summary>The kind of update request a tray can send.</summary>
public enum UpdateRequestKind
{
    /// <summary>A manual "Check for updates".</summary>
    Check,
    /// <summary>A manual "Update now".</summary>
    Now,
}

/// <summary>
/// Pure guard for the tray's update requests (docs/SPEC.md §12.2). Only a session in parent mode is allowed to
/// trigger a check or an immediate install; otherwise the request is refused and <see cref="Asked"/> is unchanged.
/// </summary>
public static class UpdateControl
{
    /// <summary>
    /// Whether the request is allowed and what the new <see cref="UpdateState.Asked"/> flag should be.
    /// </summary>
    public static (bool Allowed, bool Asked) Request(UpdateRequestKind kind, bool inParentMode, bool asked)
    {
        return kind switch
        {
            UpdateRequestKind.Now when inParentMode => (true, true),
            UpdateRequestKind.Now => (false, asked),
            UpdateRequestKind.Check when inParentMode => (true, asked),
            UpdateRequestKind.Check => (false, asked),
            _ => (false, asked),
        };
    }
}
