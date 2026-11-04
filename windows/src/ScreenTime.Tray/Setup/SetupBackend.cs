using System.Diagnostics;
using System.DirectoryServices.AccountManagement;
using System.ServiceProcess;
using ScreenTime.Core.Service;
using ScreenTime.Core.Setup;
using ScreenTime.Core.Store;

namespace ScreenTime.Tray.Setup;

/// <summary>
/// The real <see cref="ISetupBackend"/> (CARD-052b). Runs elevated (App restarts <c>--setup</c> as administrator).
/// Reads the service's config.json and state.db in C:\ProgramData\ScreenTime, lists the local accounts, enrols by
/// running the installed <c>ScreenTime.Service.exe enrol</c> (one tested path, the same as the command line), and
/// restarts the service on Finish so it uses the new server and accounts.
/// </summary>
internal sealed class SetupBackend : ISetupBackend
{
    private const string ServiceName = "ScreenTime";
    private static readonly string DataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ScreenTime");
    // The tray is in Program Files\ScreenTime\Tray; the service is one folder up.
    private static readonly string ServiceExe = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "ScreenTime.Service.exe"));

    public string? SavedServer =>
        ServiceFiles.LoadConfig(Path.Combine(DataFolder, "config.json")) is { } config ? SetupRules.ShowServer(config.ServerUrl) : null;

    public async Task<string?> CheckServerAsync(string address)
    {
        if (SetupRules.ServerUrl(address) is not { } url) return SetupRules.NotAnAddress;
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        try
        {
            using var response = await http.GetAsync(new Uri(new Uri(url), "health"));
            return SetupRules.HealthError((int)response.StatusCode, await response.Content.ReadAsStringAsync());
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return SetupRules.HealthError(null, null);
        }
    }

    public Task<IReadOnlyList<SetupAccount>> AccountsAsync() => Task.Run(() =>
    {
        using var machine = new PrincipalContext(ContextType.Machine);
        using var admins = GroupPrincipal.FindByIdentity(machine, IdentityType.Sid, "S-1-5-32-544");
        var adminSids = admins?.GetMembers(false).Select(m => m.Sid?.Value).OfType<string>().ToHashSet() ?? [];
        using var search = new PrincipalSearcher(new UserPrincipal(machine));
        var local = search.FindAll().OfType<UserPrincipal>()
            .Where(u => u.Sid is not null)
            .Select(u => new LocalAccount(u.SamAccountName, u.DisplayName ?? "", u.Sid.Value, u.Enabled ?? true, adminSids.Contains(u.Sid.Value)))
            .ToList();
        var picked = SetupRules.Accounts(local, KidsBySid());
        return (IReadOnlyList<SetupAccount>)picked.Select(a => new SetupAccount(a.UserName, a.FullName, a.IsAdmin, a.KidName)).ToList();
    });

    public async Task<EnrolAnswer> EnrolAsync(string address, string userName, string code)
    {
        var start = new ProcessStartInfo(ServiceExe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var arg in new[] { "enrol", "--server", address, "--code", code, "--user", userName }) start.ArgumentList.Add(arg);
        try
        {
            using var process = Process.Start(start)!;
            var output = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            var outcome = SetupRules.ParseEnrol(userName, process.ExitCode, await output + "\n" + await errors);
            return outcome.KidName is { } kid ? EnrolAnswer.Enrolled(kid) : EnrolAnswer.Failed(SetupRules.EnrolError(outcome.Status));
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return EnrolAnswer.Failed(SetupRules.NotInstalled);
        }
    }

    public Task<string?> FinishAsync() => Task.Run<string?>(() =>
    {
        try
        {
            using var service = new ServiceController(ServiceName);
            if (service.Status != ServiceControllerStatus.Stopped)
            {
                service.Stop();
                service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
            }
            service.Start();
            service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
            return null;
        }
        catch (Exception e) when (e is InvalidOperationException or System.ServiceProcess.TimeoutException)
        {
            return SetupRules.NoRestart;
        }
    });

    /// <summary>The kid each enrolled account is (state.db's devices), or none before the first enrolment.</summary>
    private static Dictionary<string, string> KidsBySid()
    {
        var path = Path.Combine(DataFolder, "state.db");
        if (!File.Exists(path)) return [];
        using var store = LocalStore.Open(path);
        return store.Devices().ToDictionary(d => d.Sid, d => d.KidName);
    }
}

/// <summary>The setup window changes the service, so it runs as an administrator (CARD-052b).</summary>
internal static class Elevation
{
    public static bool IsAdmin() =>
        new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent())
            .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);

    /// <summary>Starts this exe again with <c>--setup</c>, as administrator: Windows asks first (UAC). A "No" just ends it.</summary>
    public static void RestartAsAdmin()
    {
        try
        {
            Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "--setup") { UseShellExecute = true, Verb = "runas" });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // The parent (or a kid) said no, or could not give an administrator's password.
        }
    }
}
