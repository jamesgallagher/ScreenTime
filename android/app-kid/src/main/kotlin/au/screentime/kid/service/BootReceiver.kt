package au.screentime.kid.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import au.screentime.kid.MainActivity
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.update.AskedNote
import au.screentime.kid.update.shouldReopen

/** Starts [KidService] after a reboot and after an app update, once the device is enrolled and confirmed. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> {
                if (EnrolmentStore(context).load()?.confirmed == true) KidService.start(context)
            }
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                if (EnrolmentStore(context).load()?.confirmed == true) {
                    KidService.start(context)
                    val note = AskedNote(context)
                    val askedAt = note.read()
                    val now = System.currentTimeMillis()
                    if (shouldReopen(askedAt, now)) {
                        note.clear()
                        context.startActivity(
                            Intent(context, MainActivity::class.java)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    }
                }
            }
        }
    }
}
