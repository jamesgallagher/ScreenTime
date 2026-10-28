package au.screentime.kid.calls

import android.net.Uri
import android.telecom.CallRedirectionService
import android.telecom.PhoneAccountHandle
import android.util.Log
import android.widget.Toast
import au.screentime.kid.service.KidService
import au.screentime.kid.status.StatusHub

/**
 * Stops calls to numbers that are not on the kid's list while the device is blocked (docs/SPEC.md §12.1). Android
 * asks it about every outgoing call, once the app holds the "call redirection" role (given with adb when the phone
 * is set up). Android never asks about emergency calls, so they always go through. While the device may be used,
 * or before the service has worked out the first status, every call goes through. A stopped call is a tamper attempt
 * (docs/SPEC.md §14): the service tells the parents and shows the caught screen.
 */
class CallGuard : CallRedirectionService() {
    override fun onPlaceCall(handle: Uri, initialPhoneAccount: PhoneAccountHandle, allowInteractiveResponse: Boolean) {
        val status = StatusHub.status.value
        val number = handle.schemeSpecificPart.orEmpty()
        if (status == null || !status.locked || mayCall(number, status.callables, status.emergencyNumber)) {
            Log.i(TAG, "call: allowed")
            placeCallUnmodified()
        } else {
            // Never log the number itself.
            Log.i(TAG, "call: blocked")
            cancelCall()
            Toast.makeText(this, "Right now you can only call the people on your list", Toast.LENGTH_LONG).show()
            KidService.callBlocked(this)
        }
    }

    private companion object {
        const val TAG = "CallGuard"
    }
}
