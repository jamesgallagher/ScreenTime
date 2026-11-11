package au.screentime.kid.admin

import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import android.os.Build
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

    /** Restrictions for every build. A private space could hide apps from the list and from blocks (docs/SPEC.md §12.4). */
    private val RESTRICTIONS = listOfNotNull(
        UserManager.DISALLOW_APPS_CONTROL,
        UserManager.DISALLOW_SAFE_BOOT,
        UserManager.DISALLOW_FACTORY_RESET,
        UserManager.DISALLOW_CONFIG_DATE_TIME,
        UserManager.DISALLOW_ADD_USER,
        UserManager.DISALLOW_AIRPLANE_MODE,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) UserManager.DISALLOW_ADD_PRIVATE_PROFILE else null,
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
        // The second line of the dialog Android shows when a blocked app is opened (docs/SPEC.md §12.4).
        dpm.setShortSupportMessage(admin, "Ask Mum or Dad about this app.")
        dpm.setAutoTimeEnabled(admin, true)
        dpm.setAutoTimeZoneEnabled(admin, true)
        // The block screen runs in Lock Task (docs/SPEC.md §12.1): no Home, Recents or notification shade, but the
        // power menu and the phone's own lock screen (with its emergency call button) still work. On a phone with a
        // SIM the phone app may run too, for its call screen and the emergency dialer.
        dpm.setLockTaskPackages(admin, (listOf(context.packageName) + phonePackages(context)).distinct().toTypedArray())
        lockTaskApps = null
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

    /** The always-allowed apps last let into Lock Task, so an unchanged list is not set again. */
    private var lockTaskApps: Set<String>? = null

    /**
     * Lets the always-allowed apps run in Lock Task while time is up (docs/SPEC.md §12.4), or none: [apps] is empty
     * from bedtime to wake-up and while the device may be used. An app taken off the list cannot start again.
     */
    @Synchronized
    fun allowInLockTask(context: Context, apps: Set<String>) {
        if (!isDeviceOwner(context) || apps == lockTaskApps) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        val packages = (listOf(context.packageName) + phonePackages(context) + apps.sorted()).distinct()
        dpm.setLockTaskPackages(admin, packages.toTypedArray())
        lockTaskApps = apps
        Log.i(TAG, "lock task: always allowed ${apps.sorted()}")
    }

    /** Takes off everything [apply] put on, before the app gives up Device Owner (docs/SPEC.md §12.1). */
    @Synchronized
    fun clear(context: Context) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        for (restriction in RESTRICTIONS + UserManager.DISALLOW_DEBUGGING_FEATURES) {
            dpm.clearUserRestriction(admin, restriction)
        }
        dpm.setUninstallBlocked(admin, context.packageName, false)
        dpm.setLockTaskPackages(admin, emptyArray())
        dpm.setShortSupportMessage(admin, null)
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
     * Location is only for an SOS (docs/SPEC.md §15). While the app holds it, Android keeps telling the kid "ST Kid has
     * location access" (seen over and over on the Redmi pilot, 11 Nov 2026), so it holds it only during an SOS.
     */
    val LOCATION = listOf(
        android.Manifest.permission.ACCESS_FINE_LOCATION,
        android.Manifest.permission.ACCESS_COARSE_LOCATION,
        android.Manifest.permission.ACCESS_BACKGROUND_LOCATION,
    )

    /** True while the app holds any location permission. */
    fun holdsLocation(context: Context): Boolean =
        LOCATION.any { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    /** An SOS starts: the app may take positions. Fine location first: Android wants it before background location. */
    fun allowLocation(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        for (permission in LOCATION) {
            if (!dpm.setPermissionGrantState(admin, context.packageName, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)) {
                Log.w(TAG, "could not grant $permission")
            }
        }
        Log.i(TAG, "location: allowed for the SOS")
    }

    /**
     * No SOS any more: the app gives location back. **Android stops the app's process when a permission is taken away**,
     * so the service calls this only with the screen off and nothing left to send, and Android starts it again.
     */
    fun takeBackLocation(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        Log.i(TAG, "location: taken back, so Android restarts the app")
        for (permission in LOCATION.reversed()) {
            val ok = dpm.setPermissionGrantState(admin, context.packageName, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_DENIED)
            Log.i(TAG, "location: $permission denied=$ok state=${dpm.getPermissionGrantState(admin, context.packageName, permission)}")
        }
    }

    /**
     * Grants every runtime permission the manifest asks for except location, so the kid never sees a permission prompt.
     * Does nothing unless the app is Device Owner. The setup screen calls it before scanning, for the camera.
     * A permission already granted this way is left alone.
     */
    fun grantRuntimePermissions(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = KidDeviceAdminReceiver.component(context)
        for (permission in runtimePermissions(context) - LOCATION.toSet()) {
            val now = dpm.getPermissionGrantState(admin, context.packageName, permission)
            val held = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
            if (now == DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED && held) continue
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
