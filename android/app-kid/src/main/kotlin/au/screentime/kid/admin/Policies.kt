package au.screentime.kid.admin

import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import android.os.UserManager
import android.telecom.TelecomManager
import android.util.Log
import au.screentime.kid.BuildConfig
import au.screentime.kid.tamper.missingPolicies

/** The Device Owner policies of docs/SPEC.md §12.1. Applying them again changes nothing, so the app does it on every start. */
object Policies {
    private const val TAG = "Policies"

    /** Names for the policies that are not user restrictions, as [onNow] reports them. */
    private const val AUTO_TIME = "auto_time"
    private const val AUTO_TIME_ZONE = "auto_time_zone"
    private const val UNINSTALL_BLOCKED = "uninstall_blocked"

    /** Keys in the "policies" SharedPreferences: what was on after the last [apply], and what was found off since. */
    private const val APPLIED = "applied"
    private const val MISSING = "missing"

    /** Restrictions for every build. */
    private val RESTRICTIONS = listOf(
        UserManager.DISALLOW_APPS_CONTROL,
        UserManager.DISALLOW_SAFE_BOOT,
        UserManager.DISALLOW_FACTORY_RESET,
        UserManager.DISALLOW_CONFIG_DATE_TIME,
        UserManager.DISALLOW_ADD_USER,
        UserManager.DISALLOW_AIRPLANE_MODE,
    )

    fun isDeviceOwner(context: Context): Boolean =
        context.getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(context.packageName)

    /**
     * Applies every policy. Does nothing unless the app is Device Owner.
     * A debug build leaves USB debugging on and the app uninstallable, so a developer can always reinstall it
     * and take it off as Device Owner with `adb shell dpm remove-active-admin` (debug builds are test-only).
     * A policy that was on after the last time and is found off is a tamper attempt (docs/SPEC.md §14): it is turned
     * on again here, and kept for the service, which asks with [takeMissing].
     */
    @Synchronized
    fun apply(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        val before = onNow(context, dpm, admin)

        for (restriction in RESTRICTIONS) {
            dpm.addUserRestriction(admin, restriction)
        }
        if (!BuildConfig.DEBUG) {
            dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
            dpm.setUninstallBlocked(admin, context.packageName, true)
        }
        dpm.setAutoTimeEnabled(admin, true)
        dpm.setAutoTimeZoneEnabled(admin, true)
        // The block screen runs in Lock Task (docs/SPEC.md §12.1): no Home, Recents or notification shade, but the
        // power menu and the phone's own lock screen (with its emergency call button) still work. On a phone with a
        // SIM the phone app may run too, for its call screen and the emergency dialer.
        dpm.setLockTaskPackages(admin, (listOf(context.packageName) + phonePackages(context)).distinct().toTypedArray())
        dpm.setLockTaskFeatures(
            admin,
            DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD,
        )
        grantRuntimePermissions(context)
        checkAgainst(context, before, onNow(context, dpm, admin))
        if (canCall(context) && !context.getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_CALL_REDIRECTION)) {
            // Without it every call goes through while blocked. Given with adb at setup (docs/SPEC.md §12.1).
            Log.w(TAG, "calls: not the call redirection app, so calls are not checked while blocked")
        }
    }

    /**
     * The policies that were on after the last [apply] and found off before this one, since the service last asked;
     * empty when none. Asking forgets them.
     */
    @Synchronized
    fun takeMissing(context: Context): List<String> {
        val prefs = prefs(context)
        val missing = prefs.getStringSet(MISSING, null).orEmpty().sorted()
        if (missing.isNotEmpty()) prefs.edit().remove(MISSING).commit()
        return missing
    }

    /** Keeps what was on [before] this run but on [after] the last one, and remembers [after] for the next run. */
    private fun checkAgainst(context: Context, before: Set<String>, after: Set<String>) {
        val prefs = prefs(context)
        // Nothing to compare with the first time, after setup.
        val missing = prefs.getStringSet(APPLIED, null)?.let { missingPolicies(it, before) }.orEmpty()
        if (missing.isNotEmpty()) Log.w(TAG, "policies: found off and turned on again: ${missing.joinToString()}")
        prefs.edit()
            .putStringSet(APPLIED, after)
            .putStringSet(MISSING, prefs.getStringSet(MISSING, null).orEmpty() + missing)
            .commit()
    }

    /** Which of the policies [apply] turns on are on right now, by name: a restriction, auto time, uninstall blocked. */
    private fun onNow(context: Context, dpm: DevicePolicyManager, admin: ComponentName): Set<String> {
        val restrictions = dpm.getUserRestrictions(admin)
        val names = RESTRICTIONS.filter { restrictions.getBoolean(it) }.toMutableSet()
        if (!BuildConfig.DEBUG) {
            val debugging = UserManager.DISALLOW_DEBUGGING_FEATURES
            if (restrictions.getBoolean(debugging)) names += debugging
            if (dpm.isUninstallBlocked(admin, context.packageName)) names += UNINSTALL_BLOCKED
        }
        if (dpm.getAutoTimeEnabled(admin)) names += AUTO_TIME
        if (dpm.getAutoTimeZoneEnabled(admin)) names += AUTO_TIME_ZONE
        return names
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences("policies", Context.MODE_PRIVATE)

    private fun canCall(context: Context): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_CALLING)

    /**
     * The phone app (the default one and the one the phone came with; often the same) and Android's call service,
     * which shows a "Call with" choice on a phone with two SIMs. None on a tablet.
     */
    private fun phonePackages(context: Context): List<String> {
        if (!canCall(context)) return emptyList()
        val telecom = context.getSystemService(TelecomManager::class.java)
        return listOfNotNull(telecom.defaultDialerPackage, telecom.systemDialerPackage, "com.android.server.telecom")
    }

    /**
     * Grants every runtime permission the manifest asks for, so the kid never sees a permission prompt.
     * Does nothing unless the app is Device Owner. The setup screen calls it before scanning, for the camera.
     */
    fun grantRuntimePermissions(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        for (permission in runtimePermissions(context)) {
            val granted = dpm.setPermissionGrantState(
                admin,
                context.packageName,
                permission,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
            )
            if (!granted) Log.w(TAG, "could not grant $permission")
        }
    }

    /** The permissions in the manifest that a user would otherwise have to allow. */
    private fun runtimePermissions(context: Context): List<String> {
        val pm = context.packageManager
        val info = pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
        return info.requestedPermissions.orEmpty().filter { name ->
            try {
                pm.getPermissionInfo(name, 0).protection == PermissionInfo.PROTECTION_DANGEROUS
            } catch (e: PackageManager.NameNotFoundException) {
                false
            }
        }
    }
}
