package au.screentime.kid.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.ConnectivityManager
import android.os.SystemClock
import android.util.Log
import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.AppUpdateCheck
import au.screentime.core.model.api.AppUpdateOffer
import au.screentime.kid.BuildConfig
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val TAG = "KidService"

/** What the updater should do next (docs/SPEC.md §12.1). Everything else about updating is Android's. */
enum class UpdateStep { NOTHING, DOWNLOAD, INSTALL }

/**
 * [offer] is what the server last offered, [downloaded] whether its file is here and checked. A download waits for a
 * network that is not metered; an install waits for the screen to be off and no SOS, so it never interrupts the kid,
 * unless someone tapped **Update now** ([asked]). An SOS always comes first.
 */
fun nextUpdateStep(
    offer: AppUpdateOffer?,
    currentCode: Int,
    downloaded: Boolean,
    metered: Boolean,
    screenOn: Boolean,
    sosActive: Boolean,
    asked: Boolean = false,
): UpdateStep = when {
    offer == null || offer.versionCode <= currentCode -> UpdateStep.NOTHING
    !downloaded -> if (metered) UpdateStep.NOTHING else UpdateStep.DOWNLOAD
    sosActive -> UpdateStep.NOTHING
    screenOn && !asked -> UpdateStep.NOTHING
    else -> UpdateStep.INSTALL
}

/** Whether a check is due: the first since the service started, then every [everyMs]. */
fun checkDue(lastCheckElapsed: Long?, nowElapsed: Long, everyMs: Long): Boolean =
    lastCheckElapsed == null || nowElapsed - lastCheckElapsed >= everyMs

/** Whether [stream] is what the offer said: its size and SHA-256 (lower-case hex). */
fun matchesOffer(stream: InputStream, sizeBytes: Long, sha256: String): Boolean {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
        val read = stream.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
        total += read
    }
    return total == sizeBytes && digest.digest().joinToString("") { "%02x".format(it) } == sha256
}

/**
 * Keeps the kid app up to date from the family's server (docs/SPEC.md §12.1). As Device Owner the app installs without
 * asking. Android itself refuses a file not signed with the same key, or an older version.
 */
class AppUpdater(
    private val context: Context,
    private val api: ApiClient,
    private val serverUrl: String,
    private val token: () -> String?,
    /** A checked file is ready: the service shows **Update now** (docs/SPEC.md §12.1), once per version. */
    private val onReady: (versionName: String) -> Unit = {},
) {
    private var lastCheck: Long? = null
    private var lastInstall: Long? = null
    private var offer: AppUpdateOffer? = null
    private var announced: Int? = null
    private var asked = false

    private fun fileFor(o: AppUpdateOffer) = File(File(context.cacheDir, "update"), "kid-${o.versionCode}.apk")

    /** Someone tapped **Update now**: the next [tick] installs, even with the screen on. */
    fun askNow() {
        asked = true
        lastInstall = null
    }

    /** Called after each sync. Failures are logged and tried again later. */
    suspend fun tick(screenOn: Boolean, sosActive: Boolean) {
        try {
            val now = SystemClock.elapsedRealtime()
            if (checkDue(lastCheck, now, CHECK_EVERY_MS)) {
                offer = api.postDeviceAppUpdateCheck(AppUpdateCheck(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME)).offer
                lastCheck = now
                offer?.let { Log.i(TAG, "update: offered ${it.versionName} (${it.versionCode})") }
            }
            val o = offer
            val file = o?.let { fileFor(it) }
            // The emulator's only network is metered, so a debug build ignores it. Tests cover the rule itself.
            val metered = !BuildConfig.DEBUG && context.getSystemService(ConnectivityManager::class.java).isActiveNetworkMetered
            when (nextUpdateStep(o, BuildConfig.VERSION_CODE, file?.exists() == true, metered, screenOn, sosActive, asked)) {
                UpdateStep.NOTHING -> Unit
                UpdateStep.DOWNLOAD -> download(o!!, file!!)
                UpdateStep.INSTALL -> if (lastInstall == null || now - lastInstall!! >= CHECK_EVERY_MS) {
                    lastInstall = now
                    asked = false
                    install(file!!)
                }
            }
            // Ready and waiting: say so once, so a parent or the kid can tap Update now.
            if (o != null && o.versionCode > BuildConfig.VERSION_CODE && file?.exists() == true && announced != o.versionCode) {
                announced = o.versionCode
                onReady(o.versionName)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "update: failed: $e")
        }
    }

    /** Fetches the file; it only gets its real name once its size and hash are right. */
    private suspend fun download(o: AppUpdateOffer, file: File) = withContext(Dispatchers.IO) {
        file.parentFile?.deleteRecursively()
        file.parentFile?.mkdirs()
        val part = File(file.parentFile, "part")
        val connection = URL("${serverUrl.trimEnd('/')}/v1/device/app-update/apk").openConnection() as HttpURLConnection
        connection.setRequestProperty("Authorization", "Bearer ${token()}")
        connection.connectTimeout = 30_000
        connection.readTimeout = 60_000
        try {
            if (connection.responseCode != 200) {
                Log.w(TAG, "update: download said ${connection.responseCode}")
                return@withContext
            }
            connection.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
        } finally {
            connection.disconnect()
        }
        if (part.inputStream().use { matchesOffer(it, o.sizeBytes.toLong(), o.sha256) }) {
            part.renameTo(file)
            Log.i(TAG, "update: downloaded ${o.versionName}")
        } else {
            part.delete()
            Log.w(TAG, "update: the file does not match the offer")
        }
    }

    private suspend fun install(file: File) = withContext(Dispatchers.IO) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("kid.apk", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val done = PendingIntent.getBroadcast(
                context,
                id,
                Intent(context, UpdateResultReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            Log.i(TAG, "update: installing")
            session.commit(done.intentSender)
        }
    }

    private companion object {
        /** Debug builds check every minute, so a run does not wait. */
        val CHECK_EVERY_MS = if (BuildConfig.DEBUG) 60_000L else 6 * 60 * 60_000L
    }
}

/** Android's answer to an install. A good install stops the app first, so this mostly hears about failures. */
class UpdateResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        Log.i(TAG, "update: install said $status $message")
    }
}
