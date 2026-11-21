package au.screentime.kid.update

import au.screentime.core.ui.update.UpdateSource
import au.screentime.core.ui.update.UpdateState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * The one [UpdateSource] the kid main screen's Updates sheet listens to (docs/SPEC.md §12.11). Until CARD-071 wires the
 * real updater (set in `KidService` when it creates its `AppUpdater`), this is a fake that pretends there is a newer
 * version, so the screens can be seen and tried.
 */
object KidUpdates {
    var source: UpdateSource = FakeKidUpdateSource()
}

/** Pretends: **Check for updates** finds 0.9.1, **Update now** gets it and installs. CARD-071 replaces and deletes this. */
class FakeKidUpdateSource : UpdateSource {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _state = MutableStateFlow<UpdateState>(UpdateState.Unknown)
    override val state: StateFlow<UpdateState> = _state

    override fun checkNow() {
        scope.launch {
            _state.value = UpdateState.Checking
            delay(1_000)
            _state.value = UpdateState.Available("0.9.1", 34_000_000)
        }
    }

    override fun update() {
        scope.launch {
            _state.value = UpdateState.Downloading("0.9.1")
            delay(2_000)
            _state.value = UpdateState.Installing("0.9.1")
            delay(2_000)
            _state.value = UpdateState.UpToDate
        }
    }
}
