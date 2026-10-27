package au.screentime.kid.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.VibrationEffect
import android.os.VibratorManager
import au.screentime.kid.MainActivity
import au.screentime.kid.R
import au.screentime.kid.ask.answerText
import au.screentime.kid.live.Answer
import au.screentime.kid.status.KidStatus
import au.screentime.kid.status.Warning
import au.screentime.kid.status.warningText
import au.screentime.kid.status.warningTitle

/**
 * The kid app's notifications (docs/SPEC.md §16.2): the silent status notification of the foreground service (with
 * **End now** while parent mode is on), the heads-up warnings before a lock, and a parent's answer to "Ask for more
 * time".
 */
class Notifier(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    init {
        manager.createNotificationChannel(
            NotificationChannel(STATUS_CHANNEL, "Screen Time", NotificationManager.IMPORTANCE_LOW),
        )
        manager.createNotificationChannel(
            NotificationChannel(WARNING_CHANNEL, "Time warnings", NotificationManager.IMPORTANCE_HIGH).apply {
                // Heads-up without a sound; the phone buzzes itself at the second warning.
                setSound(null, null)
                enableVibration(false)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(ANSWER_CHANNEL, "Answers from your parents", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(false)
            },
        )
    }

    /** Opens the main screen. */
    private val openApp: PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** Ends parent mode through the service. */
    private val endParentMode: PendingIntent = PendingIntent.getService(
        context,
        1,
        Intent(context, KidService::class.java).setAction(KidService.ACTION_END_PARENT_MODE),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** What the service shows before the first sync. */
    fun starting(): Notification = Notification.Builder(context, STATUS_CHANNEL)
        .setSmallIcon(R.drawable.ic_status)
        .setContentTitle("Screen Time")
        .setContentText("Screen Time is on")
        .setContentIntent(openApp)
        .setOngoing(true)
        .build()

    /**
     * "Phone · 1h 12m left", "Bedtime 8:30 pm", with the system chronometer counting down to the lock. The
     * chronometer runs on the wall clock, so the lock is moved by the gap between the trusted clock ([nowMs]) and it.
     * In parent mode: "Parent mode · ends 4:15 pm", "Time isn't counting" and **End now**.
     */
    fun showStatus(status: KidStatus, nowMs: Long) {
        val builder = Notification.Builder(context, STATUS_CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(status.title())
            .setContentText(status.subline())
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
        if (!status.online) builder.setSubText("Offline")
        if (status.parentMode) {
            builder.addAction(Notification.Action.Builder(null, "End now", endParentMode).build())
        }
        val lockAt = status.lockAtMs
        if (lockAt != null) {
            builder
                .setWhen(System.currentTimeMillis() + (lockAt - nowMs))
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
        } else {
            builder.setShowWhen(false)
        }
        manager.notify(STATUS_ID, builder.build())
    }

    /** A heads-up warning; it goes away by itself when the device locks. The second one buzzes on a phone. */
    fun showWarning(status: KidStatus, warning: Warning) {
        val notification = Notification.Builder(context, WARNING_CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(warningTitle(status, warning))
            .setContentText(warningText(status, warning))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setTimeoutAfter(maxOf(1_000L, status.leftSec * 1000))
            .build()
        manager.notify(WARNING_ID, notification)
        if (warning == Warning.SECOND && status.deviceWord == "phone") {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
                .vibrate(VibrationEffect.createWaveform(longArrayOf(0, 250, 150, 250), -1))
        }
    }

    /** "Dad said yes! +15 min 🎉" or "Dad said not this time", heads-up; it goes away by itself after a minute. */
    fun showAnswer(answer: Answer) {
        val notification = Notification.Builder(context, ANSWER_CHANNEL)
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(answerText(answer))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000L)
            .build()
        manager.notify(ANSWER_ID, notification)
    }

    fun cancelWarning() {
        manager.cancel(WARNING_ID)
    }

    companion object {
        const val STATUS_ID = 1
        private const val WARNING_ID = 2
        private const val ANSWER_ID = 3
        private const val STATUS_CHANNEL = "status"
        private const val WARNING_CHANNEL = "warnings"
        private const val ANSWER_CHANNEL = "answers"
    }
}
