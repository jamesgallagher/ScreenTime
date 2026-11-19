package au.screentime.parent.kids

import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceForm
import au.screentime.core.model.api.Kid
import au.screentime.core.model.api.KidKind
import au.screentime.core.model.api.Pool
import au.screentime.core.model.api.TodayKid
import au.screentime.core.model.api.TodayPool
import au.screentime.parent.today.poolName

/*
 * Shared devices (docs/SPEC.md §12.8): a device that belongs to no kid, such as Mum's tablet. The server keeps it as
 * a kid of kind `shared`, so every kid screen works for it; these decide how the screens show it.
 */

// ---- The seam: `kind` on Kid and TodayKid. The kind comes from the server. ----

/** True for a shared device on the Kids tab. */
fun isShared(kid: Kid): Boolean = kid.kind == KidKind.SHARED

/** True for a shared device on the Today tab. */
fun isShared(kid: TodayKid): Boolean = kid.kind == KidKind.SHARED

// ---- Pure helpers. ----

/** A shared device has one pool, Screens, which the screens call Time. */
fun poolLabel(pool: Pool, shared: Boolean): String = if (shared) "Time" else poolName(pool)

/** The pools a Today card shows: a shared device's Screens pool only. */
fun poolsShown(pools: List<TodayPool>, shared: Boolean): List<TodayPool> =
    if (shared) pools.filter { it.pool == Pool.SCREENS } else pools

/** The form of a shared device's one device, for its picture; a tablet until it has one. */
fun sharedForm(devices: List<Device>, kidId: String): DeviceForm =
    devices.firstOrNull { it.kidId == kidId }?.form ?: DeviceForm.TABLET

/** The line under a shared device on the Kids tab: its device's name, or that none is connected yet. */
fun sharedSummary(devices: List<Device>, kidId: String): String =
    devices.firstOrNull { it.kidId == kidId }?.name ?: "No device connected yet"

/** A shared device has one device at most, so Add device goes once it has one. */
fun canAddDevice(shared: Boolean, deviceCount: Int): Boolean = !shared || deviceCount == 0

/** The picture for a device form, used on device rows and in place of a shared device's initial. */
fun formBadge(form: DeviceForm): String = when (form) {
    DeviceForm.PHONE -> "📱"
    DeviceForm.TABLET -> "🎨"
    DeviceForm.PC -> "💻"
}
