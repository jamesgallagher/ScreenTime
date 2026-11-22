package au.screentime.kid.update

import au.screentime.core.model.api.AppUpdateOffer
import au.screentime.core.ui.update.UpdateSource
import au.screentime.core.ui.update.UpdateState
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * The one [UpdateSource] the kid main screen's Updates sheet listens to (docs/SPEC.md §12.11). The real source is set
 * by [KidService] when it creates its [AppUpdater]; until then the default does nothing, so the screen never crashes.
 */
object KidUpdates {
    var source: UpdateSource = object : UpdateSource {
        override val state: StateFlow<UpdateState> = MutableStateFlow(UpdateState.Unknown)
        override fun checkNow() {}
        override fun update() {}
    }

    /** Called by [UpdateResultReceiver] when Android reports the result of a parent-asked install. */
    fun installResult(status: Int) {
        (source as? KidUpdateSource)?.installed(status)
    }
}

/** What a manual update should do next. */
enum class ManualUpdateStep { NOTHING, DOWNLOAD, INSTALL }

/**
 * A parent-triggered check and update for the kid app, backed by [AppUpdater] (docs/SPEC.md §12.11).
 * Side effects are passed as lambdas so the source can be unit-tested on the JVM.
 */
class KidUpdateSource(
    private val currentCode: () -> Int,
    private val check: suspend () -> AppUpdateOffer?,
    private val downloaded: (AppUpdateOffer) -> Boolean,
    private val download: suspend (AppUpdateOffer) -> Boolean,
    private val install: suspend (AppUpdateOffer) -> Unit,
    private val noteAsked: () -> Unit,
    private val sosActive: () -> Boolean,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
) : UpdateSource {
    private val _state = MutableStateFlow<UpdateState>(UpdateState.Unknown)
    override val state: StateFlow<UpdateState> = _state

    private var lastOffer: AppUpdateOffer? = null

    /** A manual update is running (downloading or committing): a second one must not start, or it would delete the first one's download. */
    private val running = AtomicBoolean(false)

    override fun checkNow() {
        scope.launch {
            _state.value = UpdateState.Checking
            val next = try {
                val offer = check()
                lastOffer = offer
                kidCheckState(offer, currentCode(), offer?.let { downloaded(it) } ?: false, checkFailed = false)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                kidCheckState(null, currentCode(), downloaded = false, checkFailed = true)
            }
            _state.value = next
        }
    }

    override fun update() {
        val offer = lastOffer ?: return
        launchManual(offer, writeAsked = true, onActed = {})
    }

    /**
     * A parent's remote "Update now" (docs/SPEC.md §12.11): the same manual path as [update], but it calls [onActed] just
     * before the install commit instead of [noteAsked], so the app does not reopen after the restart. The caller writes the
     * remote request's requestedAt there, which is what makes a request act once.
     */
    fun updateForRequest(offer: AppUpdateOffer, onActed: () -> Unit) {
        lastOffer = offer
        launchManual(offer, writeAsked = false, onActed = onActed)
    }

    /** Runs [runManual] unless one is already running; the sync that asks again a minute later must not start a second download. */
    private fun launchManual(offer: AppUpdateOffer, writeAsked: Boolean, onActed: () -> Unit) {
        if (!running.compareAndSet(false, true)) return
        scope.launch {
            try {
                runManual(offer, writeAsked, onActed)
            } finally {
                running.set(false)
            }
        }
    }

    private suspend fun runManual(offer: AppUpdateOffer, writeAsked: Boolean, onActed: () -> Unit) {
        when (manualUpdateStep(offer, currentCode(), downloaded(offer), sosActive())) {
            ManualUpdateStep.NOTHING -> Unit
            ManualUpdateStep.DOWNLOAD -> {
                _state.value = UpdateState.Downloading(offer.versionName)
                val ok = try {
                    download(offer)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    false
                }
                if (!ok) {
                    _state.value = UpdateState.Failed(offer.versionName)
                    return
                }
                if (sosActive()) {
                    _state.value = UpdateState.Ready(offer.versionName)
                    return
                }
                _state.value = UpdateState.Installing(offer.versionName)
                if (writeAsked) noteAsked() else onActed()
                try {
                    install(offer)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _state.value = UpdateState.Failed(offer.versionName)
                }
            }
            ManualUpdateStep.INSTALL -> {
                if (sosActive()) {
                    _state.value = UpdateState.Ready(offer.versionName)
                    return
                }
                _state.value = UpdateState.Installing(offer.versionName)
                if (writeAsked) noteAsked() else onActed()
                try {
                    install(offer)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _state.value = UpdateState.Failed(offer.versionName)
                }
            }
        }
    }

    /** Called by [KidUpdates.installResult] when Android reports the result of the install commit. */
    fun installed(status: Int) {
        // PackageInstaller.STATUS_SUCCESS is 0; any non-zero status is a failure.
        _state.value = if (status == 0) {
            UpdateState.UpToDate
        } else {
            UpdateState.Failed(lastOffer?.versionName ?: "")
        }
    }
}

/**
 * Pure mapper from the server's answer to the screen state after a manual check (docs/SPEC.md §12.11).
 * [downloaded] is whether the checked file is already on disk; [checkFailed] overrides everything else.
 */
fun kidCheckState(
    offer: AppUpdateOffer?,
    currentCode: Int,
    downloaded: Boolean,
    checkFailed: Boolean,
): UpdateState = when {
    checkFailed -> UpdateState.CheckFailed
    offer == null || offer.versionCode <= currentCode -> UpdateState.UpToDate
    downloaded -> UpdateState.Ready(offer.versionName)
    else -> UpdateState.Available(offer.versionName, offer.sizeBytes.toLong())
}

/** Pure rule for what a parent-tapped **Update now** should do (docs/SPEC.md §12.11). */
fun manualUpdateStep(
    offer: AppUpdateOffer?,
    currentCode: Int,
    downloaded: Boolean,
    sosActive: Boolean,
): ManualUpdateStep = when {
    offer == null || offer.versionCode <= currentCode -> ManualUpdateStep.NOTHING
    sosActive -> ManualUpdateStep.NOTHING
    !downloaded -> ManualUpdateStep.DOWNLOAD
    else -> ManualUpdateStep.INSTALL
}
