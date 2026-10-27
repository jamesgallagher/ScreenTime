package au.screentime.kid.calls

import au.screentime.core.model.api.DeviceStateContactsItem
import au.screentime.core.model.api.DeviceStateParentsItem

/** Someone the kid can always call (docs/SPEC.md §12.1, Q33): a parent with a mobile, or an always-callable contact. */
data class Callable(val label: String, val number: String)

/** The call buttons, in order: the parents with a mobile (oldest first), then the kid's contacts in the parents' order. */
fun callablesOf(parents: List<DeviceStateParentsItem>, contacts: List<DeviceStateContactsItem>): List<Callable> =
    parents.mapNotNull { p -> p.phoneE164?.let { Callable(p.displayName, it) } } +
        contacts.map { Callable(it.label, it.phoneE164) }

/** The letters in a call button: "D" for "Dad", "GJ" for "Grandma Jo", "?" when there are none. */
fun initials(label: String): String {
    val letters = label.split(' ').filter { it.isNotBlank() }.take(2).map { it.first().uppercaseChar() }
    return if (letters.isEmpty()) "?" else letters.joinToString("")
}

/**
 * Whether the kid may call [dialled] while the device is blocked: a number on the list, or the family's emergency
 * number. Android never asks about the emergency numbers it knows itself (000, 112, 911 …), so those always work.
 */
fun mayCall(dialled: String, callables: List<Callable>, emergencyNumber: String): Boolean =
    sameNumber(dialled, emergencyNumber) || callables.any { sameNumber(dialled, it.number) }

/**
 * Whether two phone numbers are the same: equal after taking out spaces, dashes, dots and brackets, or one in
 * international form (+61 412 345 678) and the other in national form with its leading 0 (0412 345 678).
 * Anything with other characters (`*`, `#`, letters, a pause) is never the same as anything.
 */
fun sameNumber(a: String, b: String): Boolean {
    val x = plain(a) ?: return false
    val y = plain(b) ?: return false
    return x == y || national(x, y) || national(y, x)
}

/** [n] with only its digits and a leading `+`, or null when it is not a plain phone number. */
private fun plain(n: String): String? {
    val kept = n.trim().filterNot { it == ' ' || it == '-' || it == '.' || it == '(' || it == ')' }
    val ok = kept.isNotEmpty() && kept.withIndex().all { (i, c) -> c.isDigit() || (c == '+' && i == 0) }
    return if (ok && kept != "+") kept else null
}

/** [intl] is +<country code of 1 to 3 digits><[local] without its leading 0>. */
private fun national(intl: String, local: String): Boolean {
    if (!intl.startsWith("+") || !local.startsWith("0") || local.startsWith("00") || local.length < 7) return false
    val rest = local.drop(1)
    val digits = intl.drop(1)
    return digits.endsWith(rest) && digits.length - rest.length in 1..3
}
