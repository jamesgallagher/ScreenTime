namespace ScreenTime.Service;

/// <summary>The disk as <see cref="ScreenTime.Core.Games.GameFinder"/> sees it (docs/SPEC.md §12.6).</summary>
internal static partial class Win
{
    /// <summary>The root of every fixed drive that is ready, such as <c>C:\</c> and <c>D:\</c>. Not USB or network drives.</summary>
    internal static IReadOnlyList<string> GameRoots()
    {
        try
        {
            return DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed && d.IsReady).Select(d => d.RootDirectory.FullName).ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    /// <summary>A folder's subfolders as full paths, without links to other places; nothing when it cannot be read.</summary>
    internal static IEnumerable<string> SubFolders(string folder)
    {
        try
        {
            var options = new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint };
            return Directory.GetDirectories(folder, "*", options);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }
}
