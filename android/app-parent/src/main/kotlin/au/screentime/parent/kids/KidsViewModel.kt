package au.screentime.parent.kids

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.DevicePatch
import au.screentime.core.model.api.EnrolmentCode
import au.screentime.core.model.api.EnrolmentCodeCreate
import au.screentime.core.model.api.Kid
import au.screentime.core.model.api.KidContact
import au.screentime.core.model.api.Schedule
import au.screentime.core.model.api.ScheduleInput
import au.screentime.parent.ParentApp
import au.screentime.parent.auth.SignedOutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async

/** The Kids tab's state. `kids` is null until the first answer. */
data class KidsState(
    val kids: List<Kid>? = null,
    val devices: List<Device> = emptyList(),
    val refreshing: Boolean = false,
    val error: String? = null,
)

/** The Kids tab (docs/SPEC.md §16.4): the kids, their devices, and the add-device flow. */
class KidsViewModel(app: Application) : AndroidViewModel(app) {
    private val session = getApplication<ParentApp>().session

    var state by mutableStateOf(KidsState())
        private set

    /** Load the kids and the devices, or refresh them when [pulled]. */
    suspend fun load(pulled: Boolean = false) {
        if (pulled) state = state.copy(refreshing = true)
        try {
            val kids = session.call { getKids() }
            val devices = session.call { getDevices() }
            state = state.copy(kids = kids, devices = devices, refreshing = false, error = null)
        } catch (e: CancellationException) {
            state = state.copy(refreshing = false)
            throw e
        } catch (e: SignedOutException) {
            state = state.copy(refreshing = false)
        } catch (e: ApiException) {
            state = state.copy(refreshing = false, error = "Something went wrong on the server. Pull down to try again.")
        } catch (e: Exception) {
            state = state.copy(refreshing = false, error = "Can't reach Screen Time. Check the internet connection.")
        }
    }

    /** Rename a device; null when it worked, else the error's words. */
    suspend fun rename(device: Device, name: String): String? {
        val deferred = viewModelScope.async {
            val error = try {
                session.call { patchDevicesById(device.id, DevicePatch(name = name)) }
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: SignedOutException) {
                null
            } catch (e: Exception) {
                actionError(e)
            }
            load()
            error
        }
        return deferred.await()
    }

    /** Remove a device; null when it worked, else the error's words. */
    suspend fun remove(device: Device): String? {
        val deferred = viewModelScope.async {
            val error = try {
                session.call { deleteDevicesById(device.id) }
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: SignedOutException) {
                null
            } catch (e: Exception) {
                actionError(e)
            }
            load()
            error
        }
        return deferred.await()
    }

    /** Make a one-time code to add a device for a kid; a failure is a [Result.failure] with the exception. */
    suspend fun newCode(kidId: String, form: DeviceForm): Result<EnrolmentCode> {
        return try {
            Result.success(session.call { postKidsEnrolmentCodes(kidId, EnrolmentCodeCreate(form)) })
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Load a kid's current schedule; a failure is a [Result.failure] with the exception. */
    suspend fun schedule(kidId: String): Result<Schedule> {
        val deferred = viewModelScope.async {
            try {
                Result.success(session.call { getKidsSchedule(kidId) })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
        return deferred.await()
    }

    /** Load a kid's always-callable numbers; a failure is a [Result.failure] with the exception. */
    suspend fun contacts(kidId: String): Result<List<KidContact>> {
        val deferred = viewModelScope.async {
            try {
                Result.success(session.call { getKidsContacts(kidId) })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
        return deferred.await()
    }

    /** Save a new schedule; the server's answer, or a [Result.failure] with the exception. */
    suspend fun saveSchedule(kidId: String, input: ScheduleInput): Result<Schedule> {
        val deferred = viewModelScope.async {
            try {
                Result.success(session.call { putKidsSchedule(kidId, input) })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
        return deferred.await()
    }

    /** Save the always-callable numbers; the server's answer, or a [Result.failure] with the exception. */
    suspend fun saveContacts(kidId: String, rows: List<ContactRow>): Result<List<KidContact>> {
        val deferred = viewModelScope.async {
            try {
                Result.success(session.call { putKidsContacts(kidId, contactsBody(rows)) })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
        return deferred.await()
    }

    /** Refresh only the devices, for the add-device page's 3-second poll; any error is ignored (the next poll tries again). */
    suspend fun refreshDevices() {
        try {
            val devices = session.call { getDevices() }
            state = state.copy(devices = devices)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The next poll tries again.
        }
    }

    /** Back to a blank state, after a sign-out. */
    fun clear() {
        state = KidsState()
    }
}
