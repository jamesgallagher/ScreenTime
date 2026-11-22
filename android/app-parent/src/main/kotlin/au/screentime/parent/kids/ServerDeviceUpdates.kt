package au.screentime.parent.kids

import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceAppUpdateState
import au.screentime.parent.auth.Session
import java.time.Instant
import kotlinx.coroutines.CancellationException

/**
 * The device row's real update source (docs/SPEC.md §12.11): what the server says about this device's update, and
 * `POST /v1/devices/{id}/app-update` for **Update now**. The kid screen refreshes the devices afterwards, so a 409
 * also makes the row show the truth.
 */
class ServerDeviceUpdates(private val session: Session) : DeviceUpdates {
    override fun of(device: Device): DeviceUpdate? = device.appUpdate?.let { update ->
        DeviceUpdate(
            versionName = update.versionName,
            requested = update.state == DeviceAppUpdateState.REQUESTED,
            requestedAt = update.requestedAt?.let { runCatching { Instant.parse(it) }.getOrNull() },
        )
    }

    override suspend fun request(deviceId: String): Boolean = try {
        session.call { postDevicesAppUpdate(deviceId) }
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        // 409 (nothing newer), 404 (gone) and no connection all leave the row to refresh and show the truth.
        false
    }
}
