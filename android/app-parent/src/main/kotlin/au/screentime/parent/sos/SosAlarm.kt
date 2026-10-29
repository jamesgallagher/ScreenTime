package au.screentime.parent.sos

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import au.screentime.parent.R
import au.screentime.parent.push.CHANNEL_CRITICAL
import kotlinx.coroutines.flow.MutableStateFlow

/** The SOS page and the banner reload when this changes. */
object SosNews {
    val changed = MutableStateFlow(0)

    /** Tell the SOS page and the banner to reload. */
    fun bump() {
        changed.value += 1
    }
}

/**
 * The SOS alarm (docs/SPEC.md §15, CARD-044): a foreground service that rings the phone's alarm sound
 * on the alarm stream, and vibrates, until a parent answers.
 */
class SosAlarm : Service() {
    private var player: MediaPlayer? = null
    private var sosId: String? = null

    override fun onBind(intent: Intent?): android.os.IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_RING -> {
                val id = intent.getStringExtra(EXTRA_SOS_ID) ?: return START_NOT_STICKY
                val kidName = intent.getStringExtra(EXTRA_KID_NAME) ?: "Your kid"
                val deviceName = intent.getStringExtra(EXTRA_DEVICE_NAME)
                sosId = id
                startForeground(
                    ALARM_ID,
                    buildNotification(id, kidName, deviceName),
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
                startSound()
            }
            ACTION_STOP -> {
                stopSound()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        player?.let {
            try {
                it.release()
            } catch (e: Exception) {
                Log.w(TAG, "sos: no sound: ${e.javaClass.simpleName}")
            }
        }
        player = null
    }

    /** The alarm's notification: ongoing, on the critical channel, with the SOS page as its full-screen intent. */
    private fun buildNotification(sosId: String, kidName: String, deviceName: String?): Notification {
        val intent = Intent(this, SosActivity::class.java)
            .putExtra(EXTRA_SOS_ID, sosId)
            .putExtra(EXTRA_KID_NAME, kidName)
            .putExtra(EXTRA_DEVICE_NAME, deviceName)
        val pending = PendingIntent.getActivity(
            this,
            sosId.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, CHANNEL_CRITICAL)
            .setSmallIcon(R.drawable.ic_inbox)
            .setContentTitle(sosTitle(kidName))
            .setContentText("On ${deviceName ?: "a device"}. Tap to see where.")
            .setCategory(Notification.CATEGORY_ALARM)
            .setOngoing(true)
            .setContentIntent(pending)
            .setFullScreenIntent(pending, false)
            .build()
    }

    /** Start the alarm sound (unless it is already playing) and vibrate. */
    @Suppress("DEPRECATION")
    private fun startSound() {
        if (player != null) return
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            val p = MediaPlayer()
            p.setAudioAttributes(attributes)
            p.setDataSource(this, uri)
            p.isLooping = true
            p.prepare()
            p.start()
            player = p
            ringing.value = sosId
            Log.i(TAG, "sos: alarm on")
        } catch (e: Exception) {
            Log.w(TAG, "sos: no sound: ${e.javaClass.simpleName}")
        }
        try {
            getSystemService(Vibrator::class.java)?.vibrate(
                VibrationEffect.createWaveform(longArrayOf(0, 800, 400), 0), attributes)
        } catch (e: Exception) {
            Log.w(TAG, "sos: no sound: ${e.javaClass.simpleName}")
        }
    }

    /** Stop the alarm sound and vibrate; a stop when nothing plays logs nothing. */
    private fun stopSound() {
        val p = player
        if (p != null) {
            try {
                p.stop()
                p.release()
            } catch (e: Exception) {
                Log.w(TAG, "sos: no sound: ${e.javaClass.simpleName}")
            }
            player = null
            getSystemService(Vibrator::class.java)?.cancel()
            ringing.value = null
            Log.i(TAG, "sos: alarm off")
        }
    }

    companion object {
        const val TAG = "Sos"
        const val ACTION_RING = "au.screentime.parent.sos.ring"
        const val ACTION_STOP = "au.screentime.parent.sos.stop"
        const val ALARM_ID = 9001
        const val EXTRA_SOS_ID = "au.screentime.parent.SOS_ID"
        const val EXTRA_KID_NAME = "au.screentime.parent.SOS_KID"
        const val EXTRA_DEVICE_NAME = "au.screentime.parent.SOS_DEVICE"

        /** The SOS id while the alarm plays, or null. */
        val ringing = MutableStateFlow<String?>(null)

        /** Ring the alarm for an SOS that started. */
        fun ring(context: Context, sosId: String, kidName: String, deviceName: String?) {
            val intent = Intent(context, SosAlarm::class.java)
                .setAction(ACTION_RING)
                .putExtra(EXTRA_SOS_ID, sosId)
                .putExtra(EXTRA_KID_NAME, kidName)
                .putExtra(EXTRA_DEVICE_NAME, deviceName)
            context.startForegroundService(intent)
        }

        /** Stop the alarm; does nothing when the service is not running. */
        fun stop(context: Context) {
            try {
                context.startService(Intent(context, SosAlarm::class.java).setAction(ACTION_STOP))
            } catch (e: IllegalStateException) {
                // The service is not running.
            }
        }
    }
}
