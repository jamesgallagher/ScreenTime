package au.screentime.parent.update

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
import au.screentime.parent.BuildConfig
import au.screentime.parent.auth.Session
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val TAG = "ParentService"

/** What the parent updater should do next (docs/SPEC.md §12.7). */
enum class UpdateAction { NONE, DOWNLOAD, INSTALL }

/**
 * The parent app's own update (docs/SPEC.md §12.7). The app checks and downloads by itself, and installs when a
 * parent taps **Update**, because Android (the first time) and Play Protect (for a version it has not seen) may
 * ask a question, and a question should come right after a tap, never out of nowhere.
 */
class ParentUpdater(
    private val context: Context,
    private val session: Session,
) : UpdateSource {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _state = MutableStateFlow<UpdateState>(UpdateState.Unknown)
    override val state: StateFlow<UpdateState> = _state

    private var lastCheck: Long? = null
    private var offer: AppUpdateOffer? = null

    private fun fileFor(o: AppUpdateOffer?) = o?.let { File(File(context.cacheDir, "update"), "parent-${it.versionCode}.apk") }

    override fun checkNow() {
        scope.launch {
            _state.value = UpdateState.Checking
            try {
                offer = session.call { postMeAppUpdateCheck(AppUpdateCheck(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME)) }.offer
                lastCheck = SystemClock.elapsedRealtime()
                offer?.let { Log.i(TAG, "update: offered ${it.versionName} (${it.versionCode})") }
                _state.value = stateFor(offer, fileFor(offer), metered())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "update: check failed: $e")
                _state.value = stateFor(offer, fileFor(offer), metered())
            }
        }
    }

    override fun update() {
        val s = _state.value
        val version = when (s) {
            is UpdateState.Available -> s.versionName
            is UpdateState.Ready -> s.versionName
            is UpdateState.Failed -> s.versionName
            else -> return
        }
        scope.launch {
            try {
                when (s) {
                    is UpdateState.Available -> {
                        _state.value = UpdateState.Downloading(version)
                        download()
                        _state.value = stateFor(offer, fileFor(offer), metered())
                    }
                    else -> {}
                }
                _state.value = UpdateState.Installing(version)
                install()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "update: failed: $e")
                _state.value = UpdateState.Failed(version)
            }
        }
    }

    /** The state from the offer, whether its checked file is here, and the network (docs/SPEC.md §12.7). */
    private fun stateFor(o: AppUpdateOffer?, file: File?, metered: Boolean): UpdateState {
        if (o == null || o.versionCode <= BuildConfig.VERSION_CODE) return UpdateState.UpToDate
        if (file?.exists() == true) return UpdateState.Ready(o.versionName)
        return if (metered) UpdateState.Available(o.versionName, o.sizeBytes.toLong()) else UpdateState.Downloading(o.versionName)
    }

    /** Whether the phone's active network is metered; a debug build ignores it (docs/SPEC.md §12.7). */
    private fun metered(): Boolean =
        !BuildConfig.DEBUG && context.getSystemService(ConnectivityManager::class.java).isActiveNetworkMetered

    /** Fetches the file; it only gets its real name once its size and hash are right. */
    private suspend fun download() = withContext(Dispatchers.IO) {
        val o = offer ?: return@withContext
        val dir = File(context.cacheDir, "update")
        dir.deleteRecursively()
        dir.mkdirs()
        val part = File(dir, "part")
        val connection = URL("${BuildConfig.SERVER.trimEnd('/')}/v1/me/app-update/apk").openConnection() as HttpURLConnection
        connection.setRequestProperty("Authorization", "Bearer ${session.accessToken()}")
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
            part.renameTo(File(dir, "parent-${o.versionCode}.apk"))
            Log.i(TAG, "update: downloaded ${o.versionName}")
        } else {
            part.delete()
            Log.w(TAG, "update: the file does not match the offer")
        }
    }

    /** Hand the file to Android's installer; the receiver hears the result. */
    private suspend fun install() = withContext(Dispatchers.IO) {
        val o = offer ?: return@withContext
        val file = File(File(context.cacheDir, "update"), "parent-${o.versionCode}.apk")
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("parent.apk", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val done = PendingIntent.getBroadcast(
                context,
                id,
                Intent(context, ParentUpdateResultReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            Log.i(TAG, "update: installing")
            session.commit(done.intentSender)
        }
    }
}

/** Whether a check is due: the first since the app started, then every [everyMs]. */
fun checkDue(lastCheckElapsed: Long?, nowElapsed: Long, everyMs: Long): Boolean =
    lastCheckElapsed == null || nowElapsed - lastCheckElapsed >= everyMs

/** The state from the offer, whether its checked file is here, and the network (docs/SPEC.md §12.7). */
fun parentState(
    offer: AppUpdateOffer?,
    currentCode: Int,
    downloaded: Boolean,
    metered: Boolean,
): UpdateState = when {
    offer == null || offer.versionCode <= currentCode -> UpdateState.UpToDate
    downloaded -> UpdateState.Ready(offer.versionName)
    else -> if (metered) UpdateState.Available(offer.versionName, offer.sizeBytes.toLong()) else UpdateState.Downloading(offer.versionName)
}

/** The next action from the current state when a parent taps **Update** (docs/SPEC.md §12.7). */
fun nextAction(state: UpdateState): UpdateAction = when (state) {
    is UpdateState.Available -> UpdateAction.DOWNLOAD
    is UpdateState.Ready, is UpdateState.Failed -> UpdateAction.INSTALL
    else -> UpdateAction.NONE
}

/** The state after Android's install status (docs/SPEC.md §12.7). */
fun stateAfterInstall(status: Int, versionName: String): UpdateState = when (status) {
    PackageInstaller.STATUS_PENDING_USER_ACTION -> UpdateState.Installing(versionName)
    PackageInstaller.STATUS_SUCCESS -> UpdateState.UpToDate
    else -> UpdateState.Failed(versionName)
}

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

/** Android's answer to a parent app install. A good install stops the app first, so this mostly hears about failures. */
class ParentUpdateResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        Log.i(TAG, "update: install said $status $message")
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Android's screen ("Install unknown apps" or "Update this app?"). It opens only while the app is in
            // front, which it is: a parent just tapped **Update**.
            val screen = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
            if (screen != null) {
                screen.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(screen)
            }
        }
    }
}
