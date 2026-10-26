package au.screentime.kid.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import au.screentime.kid.enrol.EnrolmentStore

/** Starts [KidService] after a reboot and after an app update, once the device is enrolled and confirmed. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (EnrolmentStore(context).load()?.confirmed == true) KidService.start(context)
    }
}
