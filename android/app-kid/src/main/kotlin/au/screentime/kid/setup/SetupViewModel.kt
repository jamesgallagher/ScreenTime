package au.screentime.kid.setup

import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.EnrolRequest
import au.screentime.core.model.api.Platform
import au.screentime.kid.BuildConfig
import au.screentime.kid.admin.Policies
import au.screentime.kid.enrol.Enrolment
import au.screentime.kid.enrol.EnrolmentStore
import au.screentime.kid.enrol.cleanCode
import au.screentime.kid.enrol.deviceModel
import au.screentime.kid.enrol.enrolErrorMessage
import au.screentime.kid.enrol.parseEnrolLink
import au.screentime.kid.enrol.serverUrl
import au.screentime.kid.service.KidService
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** One screen of the first-run setup (docs/SPEC.md §16.2, "Setup screen"). */
sealed interface SetupState {
    /** The app is not Device Owner yet: a parent has to finish setup on a computer. */
    data object NotOwner : SetupState

    /** Typing the 6-digit code. [server] is the base URL; [editingServer] shows the address field. */
    data class EnterCode(
        val code: String = "",
        val server: String,
        val serverText: String = "",
        val editingServer: Boolean = false,
        val busy: Boolean = false,
        val error: String? = null,
        val note: String? = null,
    ) : SetupState

    /** The camera is looking for the enrolment QR code. Cancel goes back to [previous]. */
    data class Scanning(val previous: EnterCode) : SetupState

    /** Enrolled; the kid checks the name before the phone is locked down. */
    data class Confirm(val kidName: String) : SetupState

    /** Enrolled and confirmed. The main screen comes in a later card. */
    data class Done(val kidName: String) : SetupState
}

class SetupViewModel(app: Application) : AndroidViewModel(app) {
    private val store = EnrolmentStore(app)

    var state by mutableStateOf(initialState())
        private set

    /** Phone or tablet, for the copy ("This phone belongs to..."). */
    val deviceWord: String =
        if (app.resources.configuration.smallestScreenWidthDp >= 600) "tablet" else "phone"

    private fun initialState(): SetupState {
        val enrolment = store.load()
        return when {
            enrolment?.confirmed == true -> SetupState.Done(enrolment.kidName)
            enrolment != null -> SetupState.Confirm(enrolment.kidName)
            !Policies.isDeviceOwner(getApplication()) -> SetupState.NotOwner
            else -> enterCode()
        }
    }

    private fun enterCode(note: String? = null) =
        SetupState.EnterCode(server = store.lastServer ?: BuildConfig.DEFAULT_SERVER, note = note)

    /** Looks again, for example after a parent ran the adb command while this screen was open. */
    fun refresh() {
        if (state is SetupState.NotOwner) state = initialState()
        if (state is SetupState.Done) {
            Policies.apply(getApplication())
            KidService.start(getApplication())
        }
    }

    fun onCodeChange(text: String) {
        val s = state as? SetupState.EnterCode ?: return
        if (s.busy) return
        state = s.copy(code = cleanCode(text), error = null)
    }

    fun onEditServer() {
        val s = state as? SetupState.EnterCode ?: return
        state = s.copy(editingServer = true, serverText = s.server.removePrefix("https://"), error = null)
    }

    fun onServerTextChange(text: String) {
        val s = state as? SetupState.EnterCode ?: return
        state = s.copy(serverText = text, error = null)
    }

    fun onServerDone() {
        val s = state as? SetupState.EnterCode ?: return
        val url = serverUrl(s.serverText, allowHttp = BuildConfig.DEBUG)
        state = if (url == null) {
            s.copy(error = "That doesn't look like a server address.")
        } else {
            s.copy(server = url, editingServer = false)
        }
    }

    fun onConnect() {
        val s = state as? SetupState.EnterCode ?: return
        if (s.busy || s.code.length != 6 || s.editingServer) return
        connect(s)
    }

    /** "Scan QR code": the camera permission is granted first (the app is Device Owner on this screen). */
    fun onScan() {
        val s = state as? SetupState.EnterCode ?: return
        if (s.busy) return
        Policies.grantRuntimePermissions(getApplication())
        state = SetupState.Scanning(s.copy(editingServer = false, error = null, note = null))
    }

    fun onScanCancel() {
        val s = state as? SetupState.Scanning ?: return
        state = s.previous
    }

    /** The camera could not be used: back to typing the code. */
    fun onScanFailed() {
        val s = state as? SetupState.Scanning ?: return
        state = s.previous.copy(error = "The camera isn't working. Type the code instead.")
    }

    /**
     * A QR code was scanned, or the app was opened with a `screentime://enrol` link (for example from the
     * phone's own camera app, or `adb shell am start` on the emulator). A good link connects at once.
     */
    fun onLink(text: String) {
        val s = when (val current = state) {
            is SetupState.Scanning -> current.previous
            is SetupState.EnterCode -> if (current.busy) return else current
            else -> return
        }
        val link = parseEnrolLink(text, allowHttp = BuildConfig.DEBUG)
        if (link == null) {
            state = s.copy(editingServer = false, error = "That QR code isn't from Screen Time.")
            return
        }
        connect(s.copy(code = link.code, server = link.server, editingServer = false))
    }

    /** Sends the code to [SetupState.EnterCode.server], then asks the kid to confirm the name. */
    private fun connect(s: SetupState.EnterCode) {
        state = s.copy(busy = true, error = null, note = null)
        viewModelScope.launch {
            state = try {
                val enrolment = enrol(s.server, s.code)
                store.lastServer = s.server
                store.save(enrolment)
                SetupState.Confirm(enrolment.kidName)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                s.copy(busy = false, code = "", error = enrolErrorMessage(e.status))
            } catch (e: Exception) {
                s.copy(busy = false, error = enrolErrorMessage(null))
            }
        }
    }

    /** "Yes, that's me": lock the device down and finish. */
    fun onConfirm() {
        val enrolment = store.load() ?: return
        store.save(enrolment.copy(confirmed = true))
        Policies.apply(getApplication())
        KidService.start(getApplication())
        state = SetupState.Done(enrolment.kidName)
    }

    /** "No": forget this enrolment. A parent removes the device in the parent app (it stays listed until then). */
    fun onReject() {
        store.clear()
        state = enterCode(note = "OK. Ask Mum or Dad to remove this $deviceWord in Screen Time, then use a new code.")
    }

    private suspend fun enrol(server: String, code: String): Enrolment {
        val app = getApplication<Application>()
        // The client does not close an engine it was given, so both are closed here.
        OkHttp.create().use { engine ->
            ApiClient(server, engine, token = { null }).use { api ->
                val response = api.postEnrol(
                    EnrolRequest(
                        code = code,
                        platform = Platform.ANDROID,
                        hasCellular = app.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_SUBSCRIPTION),
                        model = deviceModel(Build.MANUFACTURER, Build.MODEL),
                        osVersion = "Android ${Build.VERSION.RELEASE}",
                        appVersion = BuildConfig.VERSION_NAME,
                    ),
                )
                return Enrolment(
                    serverUrl = server,
                    deviceId = response.deviceId,
                    deviceToken = response.deviceToken,
                    kidName = response.kid.name,
                    familyTimezone = response.family.timezone,
                    confirmed = false,
                )
            }
        }
    }
}
