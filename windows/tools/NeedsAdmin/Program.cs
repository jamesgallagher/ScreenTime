using System.Security.Principal;

// Writes ran.txt next to itself: whether it runs as an administrator, its folder and the compatibility layer it was started with.
var admin = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
var layer = Environment.GetEnvironmentVariable("__COMPAT_LAYER");
File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "ran.txt"), $"ran elevated={admin} cwd={Environment.CurrentDirectory} layer={layer}");
