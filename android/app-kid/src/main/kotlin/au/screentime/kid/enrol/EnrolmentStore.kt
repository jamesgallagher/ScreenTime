package au.screentime.kid.enrol

import android.content.Context

/** What this device knows after enrolment (docs/SPEC.md §11.2, §11.3). */
data class Enrolment(
    val serverUrl: String,
    val deviceId: String,
    val deviceToken: String,
    val kidName: String,
    val familyTimezone: String,
    /** The kid said "Yes, this phone is mine". Until then the setup screen asks again. */
    val confirmed: Boolean,
)

/**
 * Keeps the enrolment in the app's private storage. Backup and device-to-device transfer are off for the whole
 * app (AndroidManifest.xml), so the device token never leaves this device.
 */
class EnrolmentStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("enrolment", Context.MODE_PRIVATE)

    fun load(): Enrolment? {
        val token = prefs.getString(TOKEN, null) ?: return null
        return Enrolment(
            serverUrl = prefs.getString(SERVER, null) ?: return null,
            deviceId = prefs.getString(DEVICE, null) ?: return null,
            deviceToken = token,
            kidName = prefs.getString(KID, null) ?: return null,
            familyTimezone = prefs.getString(TIMEZONE, null) ?: return null,
            confirmed = prefs.getBoolean(CONFIRMED, false),
        )
    }

    fun save(enrolment: Enrolment) {
        prefs.edit()
            .putString(SERVER, enrolment.serverUrl)
            .putString(DEVICE, enrolment.deviceId)
            .putString(TOKEN, enrolment.deviceToken)
            .putString(KID, enrolment.kidName)
            .putString(TIMEZONE, enrolment.familyTimezone)
            .putBoolean(CONFIRMED, enrolment.confirmed)
            .commit()
    }

    /** Forgets the enrolment, but keeps [lastServer]. */
    fun clear() {
        prefs.edit()
            .remove(SERVER)
            .remove(DEVICE)
            .remove(TOKEN)
            .remove(KID)
            .remove(TIMEZONE)
            .remove(CONFIRMED)
            .commit()
    }

    /** The server the kid used last, so a second try starts from it. */
    var lastServer: String?
        get() = prefs.getString(LAST_SERVER, null)
        set(value) {
            prefs.edit().putString(LAST_SERVER, value).commit()
        }

    private companion object {
        const val SERVER = "serverUrl"
        const val DEVICE = "deviceId"
        const val TOKEN = "deviceToken"
        const val KID = "kidName"
        const val TIMEZONE = "familyTimezone"
        const val CONFIRMED = "confirmed"
        const val LAST_SERVER = "lastServer"
    }
}
