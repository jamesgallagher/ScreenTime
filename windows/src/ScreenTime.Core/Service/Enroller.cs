using System.Text;
using ScreenTime.Core.Api;
using ScreenTime.Core.Store;

namespace ScreenTime.Core.Service;

/// <summary>The Windows facts for enrolling one account (docs/SPEC.md §11.3).</summary>
public sealed record EnrolInput(string Code, string Sid, string UserName, string Model, string OsVersion, string AppVersion, string MachineId);

/// <summary>Enrolls one Windows account as a kid device (docs/SPEC.md §11.3).</summary>
public static class Enroller
{
    public static async Task<StoredDevice> EnrolAsync(ApiClient api, LocalStore store, EnrolInput input, Func<byte[], byte[]> protect, CancellationToken cancellationToken)
    {
        var r = await api.PostEnrolAsync(new EnrolRequest(
            Code: input.Code,
            Platform: Platform.Windows,
            HasCellular: false,
            Model: input.Model,
            OsVersion: input.OsVersion,
            AppVersion: input.AppVersion,
            MachineId: input.MachineId,
            WindowsUserSid: input.Sid,
            WindowsUserName: input.UserName), cancellationToken);
        var device = new StoredDevice(input.Sid, r.DeviceId, protect(Encoding.UTF8.GetBytes(r.DeviceToken)), r.Kid.Name, r.Family.Timezone);
        store.RemoveDevice(input.Sid);
        store.PutDevice(device);
        return device;
    }
}
