package au.screentime.kid.searches

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log

/** Keeps the kid app's accessibility capture service enabled without replacing any other service. */
class SearchCapture(private val context: Context) {
    private var loggedNoGrant = false

    fun isOn(): Boolean = component in enabledServices().orEmpty().split(':')

    fun ensureOn(): Boolean {
        if (isOn()) {
            loggedNoGrant = false
            return true
        }
        if (context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
            if (!loggedNoGrant) {
                Log.i(TAG, "searches: off, no grant")
                loggedNoGrant = true
            }
            return false
        }

        val updated = withService(enabledServices(), component)
        if (updated != null) {
            Settings.Secure.putString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, updated)
        }
        Settings.Secure.putInt(context.contentResolver, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
        val on = isOn()
        if (on) {
            loggedNoGrant = false
            Log.i(TAG, "searches: turned on")
        }
        return on
    }

    private fun enabledServices(): String? =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)

    private companion object {
        const val TAG = "Searches"
        const val component = "au.screentime.kid/au.screentime.kid.searches.SearchService"
    }
}
