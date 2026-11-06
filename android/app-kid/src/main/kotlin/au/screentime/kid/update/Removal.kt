package au.screentime.kid.update

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import au.screentime.core.model.api.ApiClient
import au.screentime.kid.admin.KidDeviceAdminReceiver
import au.screentime.kid.admin.Policies
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.service.KidService
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.cancellation.CancellationException

private const val TAG = "KidService"

/**
 * Takes Screen Time off this device, after a right parent code (docs/SPEC.md §12.1): tells the server if it can,
 * frees every blocked app, gives up Device Owner, and opens Android's own uninstall question. Offline it still works:
 * the device just stays listed until a parent removes it.
 */
suspend fun removeFromDevice(context: Context, api: ApiClient) {
    val told = withTimeoutOrNull(5_000) {
        try {
            api.postDeviceRemoved()
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "remove: could not tell the server: $e")
            false
        }
    }
    Log.i(TAG, "remove: server told: ${told == true}")
    context.stopService(Intent(context, KidService::class.java))

    val dpm = context.getSystemService(DevicePolicyManager::class.java)
    val admin = KidDeviceAdminReceiver.component(context)
    if (dpm.isDeviceOwnerApp(context.packageName)) {
        val pm = context.packageManager
        val all = pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(PackageManager.MATCH_UNINSTALLED_PACKAGES.toLong()))
            .map { it.packageName }
        dpm.setPackagesSuspended(admin, all.toTypedArray(), false)
        for (name in all) {
            if (dpm.isApplicationHidden(admin, name)) dpm.setApplicationHidden(admin, name, false)
        }
        Policies.clear(context)
        dpm.clearDeviceOwnerApp(context.packageName)
        Log.i(TAG, "remove: no longer Device Owner")
    }
    EnrolmentStore(context).clear()
    context.startActivity(
        Intent(Intent.ACTION_DELETE, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    // Nothing is left to show here. If the parent cancels Android's question, opening the app shows the setup screen.
    (context as? Activity)?.finishAffinity()
}
