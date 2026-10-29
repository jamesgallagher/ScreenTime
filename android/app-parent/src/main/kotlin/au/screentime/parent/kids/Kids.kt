package au.screentime.parent.kids

import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.Device
import au.screentime.core.model.api.DeviceForm
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.time.Instant

/** The form's name for people: `Phone`, `Tablet` or `PC`. */
fun formName(form: DeviceForm): String = when (form) {
    DeviceForm.PHONE -> "Phone"
    DeviceForm.TABLET -> "Tablet"
    DeviceForm.PC -> "PC"
}

/** The form's detail line: which time it counts as. */
fun formDetail(form: DeviceForm): String = when (form) {
    DeviceForm.PHONE -> "Android phone. Counts as Phone time."
    DeviceForm.TABLET -> "Android tablet. Counts as Screens time."
    DeviceForm.PC -> "Windows PC account. Counts as Screens time."
}

/** "Never connected", "Seen just now", "Seen 12 min ago", "Seen 3h ago", "Seen 2 days ago". */
fun lastSeenText(lastSeenAt: String?, now: Instant): String {
    if (lastSeenAt == null) return "Never connected"
    val minutes = (now.epochSecond - Instant.parse(lastSeenAt).epochSecond) / 60
    if (minutes < 1) return "Seen just now"
    if (minutes < 60) return "Seen $minutes min ago"
    val hours = minutes / 60
    if (hours < 24) return "Seen ${hours}h ago"
    val days = hours / 24
    return if (days == 1L) "Seen $days day ago" else "Seen $days days ago"
}

/** "9:41" until the code expires, "0:00" after. */
fun countdownText(expiresAt: String, now: Instant): String {
    val ms = Instant.parse(expiresAt).toEpochMilli() - now.toEpochMilli()
    val seconds = ((ms + 999) / 1000).coerceAtLeast(0L)
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}

/** "123 456": easier to read out and type. */
fun spacedCode(code: String): String {
    return "${code.take(3)} ${code.drop(3)}"
}

/** The trimmed name, or null when it is empty or longer than 40 characters (the server's limit). */
fun cleanDeviceName(text: String): String? {
    val trimmed = text.trim()
    if (trimmed.isEmpty() || trimmed.length > 40) return null
    return trimmed
}

/** The first device of [kidId] whose id is not in [before] (the ids the kid had when the code was made), or null. */
fun newDevice(before: Set<String>, devices: List<Device>, kidId: String): Device? {
    return devices.firstOrNull { it.kidId == kidId && it.id !in before }
}

/** "Add Alex's phone", "Add Alex's tablet" or "Add Alex's PC". */
fun addTitle(kidName: String, form: DeviceForm): String {
    val word = if (form == DeviceForm.PC) "PC" else formName(form).lowercase()
    return "Add $kidName's $word"
}

/** What to do on the device: scan the QR code or type the code. */
fun addHint(kidName: String, form: DeviceForm): String {
    return if (form == DeviceForm.PC) {
        "On the PC, a parent runs the ScreenTime installer and types this code for $kidName's Windows account."
    } else {
        "On $kidName's ${formName(form).lowercase()}, open Screen Time and tap Scan QR code, or type the code."
    }
}

/** The QR code's rows of modules, true = dark, with no quiet zone. */
fun qrModules(text: String): List<List<Boolean>> {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 0))
    val size = matrix.width
    return (0 until size).map { y -> (0 until size).map { x -> matrix.get(x, y) } }
}

/** The words for a rename, remove or new code that did not work. */
fun actionError(e: Exception): String = when {
    e is ApiException -> "Something went wrong on the server. Try again soon."
    else -> "Can't reach Screen Time. Check the internet connection and try again."
}

/** What devices a kid has, for the Kids list: "No devices", "1 phone", "1 phone · 2 PCs". */
fun devicesSummary(devices: List<Device>): String {
    if (devices.isEmpty()) return "No devices"
    return DeviceForm.entries.mapNotNull { form ->
        val n = devices.count { it.form == form }
        if (n == 0) return@mapNotNull null
        val word = when (form) {
            DeviceForm.PHONE -> "phone"
            DeviceForm.TABLET -> "tablet"
            DeviceForm.PC -> "PC"
        }
        if (n == 1) "1 $word" else "$n ${word}s"
    }.joinToString(" · ")
}
