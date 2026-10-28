package au.screentime.parent.auth

import android.app.Application
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.screentime.parent.BuildConfig
import au.screentime.parent.ParentApp
import au.screentime.parent.lock.AppLock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The sign-in screen's state: the email and code steps, and the busy and error states. */
data class SignInState(
    val email: String = "",
    val code: String = "",
    val codeSent: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val note: String? = null,
)

/** The sign-in screen (docs/SPEC.md §11.1). */
class SignInViewModel(app: Application) : AndroidViewModel(app) {
    private val session = getApplication<ParentApp>().session

    var state by mutableStateOf(SignInState())
        private set

    /** The email as typed. */
    fun setEmail(text: String) {
        state = state.copy(email = text, error = null)
    }

    /** The code as typed, keeping only the digits. */
    fun setCode(text: String) {
        state = state.copy(code = cleanCode(text), error = null, note = null)
    }

    /** Send a sign-in code to the email. */
    fun sendCode() {
        if (state.busy) return
        val email = cleanEmail(state.email)
        if (!looksLikeEmail(email)) {
            state = state.copy(error = "Enter your email address, like name@example.com.")
            return
        }
        busy(verifying = false) {
            session.requestCode(email)
            state = state.copy(
                email = email,
                code = "",
                codeSent = true,
                note = if (state.codeSent) "We sent a new code." else null,
            )
        }
    }

    /** Sign in with the code. */
    fun verify() {
        if (state.busy) return
        if (state.code.length != 6) {
            state = state.copy(error = "The code is 6 digits.")
            return
        }
        busy(verifying = true) {
            session.verify(state.email, state.code, Build.MODEL)
            AppLock.unlock()
            state = SignInState(email = state.email)
        }
    }

    /** Use a different email. */
    fun changeEmail() {
        state = state.copy(code = "", codeSent = false, error = null, note = null)
    }

    /**
     * Run [block] while busy: do nothing if already busy, else set busy and clear the error and note, and
     * on an error set the error (rethrowing a cancellation).
     */
    private fun busy(verifying: Boolean, block: suspend () -> Unit) {
        if (state.busy) return
        state = state.copy(busy = true, error = null, note = null)
        viewModelScope.launch {
            try {
                block()
                state = state.copy(busy = false)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state = state.copy(busy = false, error = signInError(e, verifying))
            }
        }
    }
}
