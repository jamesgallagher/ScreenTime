package au.screentime.kid.apps

import au.screentime.core.model.api.AppSource
import au.screentime.core.model.api.DeviceAppIn
import au.screentime.core.model.api.DeviceAppsPut
import java.time.Instant

/** What Android says about one app with a launcher icon. */
data class InstalledApp(
    val packageName: String,
    val label: String,
    val isSystem: Boolean,
    val installer: String?,
    val installedAtMs: Long,
)

/** A resumed activity from Android's usage events. */
data class Resume(val packageName: String, val atMs: Long)

const val PLAY_STORE = "com.android.vending"

/** Never blocked whatever the snapshot says (docs/SPEC.md §12.4). Android does not protect Play services itself. */
val NEVER_BLOCKED = setOf("com.google.android.gms", "com.google.android.gsf", "com.android.settings")

/** A system app stays pre-installed even after an update from the Play Store. */
fun appSource(isSystem: Boolean, installer: String?): AppSource = when {
    isSystem -> AppSource.PREINSTALLED
    installer == PLAY_STORE -> AppSource.PLAY
    else -> AppSource.OTHER
}

/** The server's limit is 80 characters, and an app with no name still needs one. */
fun appLabel(label: String, packageName: String): String = label.trim().ifEmpty { packageName }.take(80)

/**
 * [known] with the first use of every package in [resumes] that it does not have yet. The earliest resume wins. Apps
 * in [ignored] (the launcher) are never reported.
 */
fun withFirstUses(known: Map<String, Long>, resumes: List<Resume>, ignored: Set<String>): Map<String, Long> {
    val out = known.toMutableMap()
    for (r in resumes) {
        if (r.packageName in ignored || r.packageName in known) continue
        val seen = out[r.packageName]
        if (seen == null || r.atMs < seen) out[r.packageName] = r.atMs
    }
    return out
}

private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

/**
 * The body of `PUT /v1/device/apps`, in package order so the same list always looks the same: the service only sends
 * it when it changed. Null when there is nothing to send (the server wants at least one app).
 */
fun appListBody(apps: List<InstalledApp>, firstUses: Map<String, Long>, protected: Set<String>): DeviceAppsPut? {
    if (apps.isEmpty()) return null
    return DeviceAppsPut(
        apps.distinctBy { it.packageName }.sortedBy { it.packageName }.map { a ->
            DeviceAppIn(
                `package` = a.packageName,
                label = appLabel(a.label, a.packageName),
                source = appSource(a.isSystem, a.installer),
                installer = a.installer?.take(255),
                blockable = a.packageName !in protected && a.packageName !in NEVER_BLOCKED,
                installedAt = iso(a.installedAtMs),
                firstUsedAt = firstUses[a.packageName]?.let(::iso),
            )
        },
    )
}
