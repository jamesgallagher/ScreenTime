package au.screentime.kid.admin

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context

/**
 * The Device Owner component. A parent makes the app Device Owner once, from a computer:
 * `adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver` (docs/guides/android-provisioning.md).
 */
class KidDeviceAdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun component(context: Context) = ComponentName(context, KidDeviceAdminReceiver::class.java)
    }
}
