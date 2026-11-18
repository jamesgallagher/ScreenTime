package au.screentime.parent.update

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * FAKE, for the front end only (CARD-064 deletes this file). It answers from memory so the screens can be tried
 * without a server: a check finds 0.1.3 after 2 s, the first **Update** "fails" (as if Play Protect's Don't install
 * was tapped), the second "installs" and goes back to up to date.
 */
class FakeUpdateSource : UpdateSource {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _state = MutableStateFlow<UpdateState>(UpdateState.Unknown)
    override val state: StateFlow<UpdateState> = _state
    private var tries = 0

    init {
        scope.launch {
            delay(3_000)
            _state.value = UpdateState.Available("0.1.3", 33_785_552)
        }
    }

    override fun checkNow() {
        scope.launch {
            _state.value = UpdateState.Checking
            delay(2_000)
            _state.value = UpdateState.Ready("0.1.3")
        }
    }

    override fun update() {
        val version = when (val s = _state.value) {
            is UpdateState.Available -> s.versionName
            is UpdateState.Ready -> s.versionName
            is UpdateState.Failed -> s.versionName
            else -> return
        }
        scope.launch {
            if (_state.value is UpdateState.Available) {
                _state.value = UpdateState.Downloading(version)
                delay(2_000)
            }
            _state.value = UpdateState.Installing(version)
            delay(2_000)
            tries++
            _state.value = if (tries == 1) UpdateState.Failed(version) else UpdateState.UpToDate
        }
    }
}
