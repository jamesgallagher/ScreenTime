package au.screentime.parent.kids

import au.screentime.core.model.api.Device
import java.time.Instant

/**
 * Until CARD-072 wires the server: a pretend answer per device, so the row can be seen and tried. Devices take turns:
 * up to date, a newer version offered, and one already asked for 5 minutes ago. **Update now** marks a device as just
 * asked. CARD-072 replaces this class (and the line in `ParentApp` that sets it) and deletes this file.
 */
class FakeDeviceUpdates : DeviceUpdates {
    private val asked = mutableMapOf<String, Instant>()

    override fun of(device: Device): DeviceUpdate? {
        asked[device.id]?.let { return DeviceUpdate("0.1.9", requested = true, requestedAt = it) }
        return when (kotlin.math.abs(device.id.hashCode()) % 3) {
            0 -> null
            1 -> DeviceUpdate("0.1.9", requested = false)
            else -> DeviceUpdate("0.1.9", requested = true, requestedAt = Instant.now().minusSeconds(5 * 60))
        }
    }

    override suspend fun request(deviceId: String): Boolean {
        asked[deviceId] = Instant.now()
        return true
    }
}
