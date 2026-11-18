package au.screentime.parent.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.ConnectivityManager
import android.os.SystemClock
import android.util.Log
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val TAG = "ParentUpdate"

/**
 * The parent app's own update (docs/SPEC.md §12.7). It checks and downloads by itself, and installs when a parent
 * taps **Update**, because Android (the first time) and Play Protect (for a version it has not seen) may ask a
 * question, and a question should come right after a tap, never out of nowhere.
 *
 * Every decision is one of the pure functions below this class, which the tests cover; the class only does the I/O.
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
    private var work: Job? = null
    private val dir get() = File(context.cacheDir, "update")

    init {
        // A file left from an update that has now happened (or an older one) is not needed any more.
        val names = dir.list()?.toList().orEmpty()
        for (name in staleUpdateFiles(names, BuildConfig.VERSION_CODE)) File(dir, name).delete()
    }

    private fun fileFor(o: AppUpdateOffer) = File(dir, "parent-${o.versionCode}.apk")

    private fun downloaded(o: AppUpdateOffer?) = o != null && fileFor(o).exists()

    override fun onForeground() {
        if (checkDue(lastCheck, SystemClock.elapsedRealtime(), CHECK_EVERY_MS)) check(asked = false)
    }

    override fun checkNow() = check(asked = true)

    /** [asked]: a parent tapped **Check for updates**, so the screen says `Checking` meanwhile. */
    private fun check(asked: Boolean) {
        if (work?.isActive == true) return
        work = scope.launch {
            val before = _state.value
            if (asked) _state.value = UpdateState.Checking
            try {
                val answer = session.call { postMeAppUpdateCheck(AppUpdateCheck(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME)) }
                lastCheck = SystemClock.elapsedRealtime()
                offer = answer.offer
                offer?.let { Log.i(TAG, "update: offered ${it.versionName} (${it.versionCode})") }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "update: check failed: $e")
                _state.value = stateAfterFailedCheck(before)
                return@launch
            }
            val s = parentState(offer, BuildConfig.VERSION_CODE, downloaded(offer), metered())
            _state.value = s
            if (s is UpdateState.Downloading) {
                // Not metered: get it now, so **Update** installs at once.
                val o = offer ?: return@launch
                _state.value = if (download(o)) UpdateState.Ready(o.versionName) else UpdateState.Failed(o.versionName)
            }
        }
    }

    override fun update() {
        if (work?.isActive == true) return
        val o = offer ?: return
        val action = nextAction(_state.value, downloaded(o))
        if (action == UpdateAction.NONE) return
        work = scope.launch {
            try {
                if (action == UpdateAction.DOWNLOAD) {
                    _state.value = UpdateState.Downloading(o.versionName)
                    if (!download(o)) {
                        _state.value = UpdateState.Failed(o.versionName)
                        return@launch
                    }
                }
                _state.value = UpdateState.Installing(o.versionName)
                install(o)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "update: failed: $e")
                _state.value = UpdateState.Failed(o.versionName)
            }
        }
    }

    /** Android's answer to the install, from [ParentUpdateResultReceiver]. */
    fun installed(status: Int, message: String?) {
        Log.i(TAG, "update: install said $status $message")
        val o = offer ?: return
        _state.value = stateAfterInstall(status, o.versionName)
    }

    /** Whether the phone's active network is metered; a debug build ignores it (docs/SPEC.md §12.7). */
    private fun metered(): Boolean =
        !BuildConfig.DEBUG && context.getSystemService(ConnectivityManager::class.java).isActiveNetworkMetered

    /** Fetches the file; it only gets its real name once its size and hash are right. False when it failed. */
    private suspend fun download(o: AppUpdateOffer): Boolean = withContext(Dispatchers.IO) {
        try {
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
                    return@withContext false
                }
                connection.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
            } finally {
                connection.disconnect()
            }
            if (part.inputStream().use { matchesOffer(it, o.sizeBytes.toLong(), o.sha256) }) {
                part.renameTo(fileFor(o))
                Log.i(TAG, "update: downloaded ${o.versionName}")
                true
            } else {
                part.delete()
                Log.w(TAG, "update: the file does not match the offer")
                false
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "update: download failed: $e")
            false
        }
    }

    /** Hands the file to Android's installer; [ParentUpdateResultReceiver] hears the result. */
    private suspend fun install(o: AppUpdateOffer) = withContext(Dispatchers.IO) {
        val file = fileFor(o)
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { s ->
            s.openWrite("parent.apk", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                s.fsync(out)
            }
            val done = PendingIntent.getBroadcast(
                context,
                id,
                Intent(context, ParentUpdateResultReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            Log.i(TAG, "update: installing ${o.versionName}")
            s.commit(done.intentSender)
        }
    }

    private companion object {
        /** Debug builds check every minute, so a run does not wait. */
        val CHECK_EVERY_MS = if (BuildConfig.DEBUG) 60_000L else 6 * 60 * 60_000L
    }
}

/** What **Update** does next (docs/SPEC.md §12.7). */
enum class UpdateAction { NONE, DOWNLOAD, INSTALL }

/** Whether a check is due: the first since the app started, then every [everyMs]. */
fun checkDue(lastCheckElapsed: Long?, nowElapsed: Long, everyMs: Long): Boolean =
    lastCheckElapsed == null || nowElapsed - lastCheckElapsed >= everyMs

/** The state after a successful check: from the offer, whether its checked file is here, and the network. */
fun parentState(offer: AppUpdateOffer?, currentCode: Int, downloaded: Boolean, metered: Boolean): UpdateState = when {
    offer == null || offer.versionCode <= currentCode -> UpdateState.UpToDate
    downloaded -> UpdateState.Ready(offer.versionName)
    metered -> UpdateState.Available(offer.versionName, offer.sizeBytes.toLong())
    else -> UpdateState.Downloading(offer.versionName)
}

/** A failed check changes nothing that was shown; only its own `Checking` goes back to `Unknown`. */
fun stateAfterFailedCheck(before: UpdateState): UpdateState =
    if (before == UpdateState.Checking) UpdateState.Unknown else before

/** What **Update** does from [state]: download first when the checked file is not here, then install. */
fun nextAction(state: UpdateState, downloaded: Boolean): UpdateAction = when (state) {
    is UpdateState.Available, is UpdateState.Ready, is UpdateState.Failed ->
        if (downloaded) UpdateAction.INSTALL else UpdateAction.DOWNLOAD
    else -> UpdateAction.NONE
}

/** The state after Android's install status. Success normally never arrives: the process is stopped first. */
fun stateAfterInstall(status: Int, versionName: String): UpdateState = when (status) {
    PackageInstaller.STATUS_PENDING_USER_ACTION -> UpdateState.Installing(versionName)
    PackageInstaller.STATUS_SUCCESS -> UpdateState.UpToDate
    else -> UpdateState.Failed(versionName)
}

/** Files in the update folder to delete: a half download, and any version not newer than the running one. */
fun staleUpdateFiles(names: List<String>, currentCode: Int): List<String> = names.filter { name ->
    val code = Regex("""^parent-(\d+)\.apk$""").find(name)?.groupValues?.get(1)?.toIntOrNull()
    code == null || code <= currentCode
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

/**
 * Android's answer to a parent app install. A good install stops the app first, so this mostly hears that a
 * parent must answer (Android's screen opens at once: the app is in front, a parent just tapped **Update**) or
 * that it failed or was declined.
 */
class ParentUpdateResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        (ParentUpdates.source as? ParentUpdater)?.installed(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            val screen = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) ?: return
            screen.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(screen)
        }
    }
}
