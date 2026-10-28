package au.screentime.parent.auth

import au.screentime.core.model.api.ApiClient
import au.screentime.core.model.api.ApiException
import au.screentime.core.model.api.AuthResponse
import au.screentime.core.model.api.Me
import au.screentime.core.model.api.OtpRequest
import au.screentime.core.model.api.OtpVerifyRequest
import au.screentime.core.model.api.OtpVerifyRequestClient
import au.screentime.core.model.api.RefreshRequest
import io.ktor.client.engine.HttpClientEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** An access token is used until one minute before it runs out (docs/SPEC.md §16.1). */
const val ACCESS_MARGIN_MS = 60_000L

/** What is kept between starts: the refresh token and who is signed in. */
data class Saved(val refreshToken: String, val me: Me)

/** Where the sign-in is kept. */
interface TokenStore {
    fun load(): Saved?
    fun save(saved: Saved)
    fun clear()
}

/** Whether the app is signed in, and who (docs/SPEC.md §11.1). */
sealed interface SessionState {
    data object SignedOut : SessionState
    data class SignedIn(val me: Me) : SessionState
}

/** The sign-in has ended, so the app goes back to the sign-in screen. */
class SignedOutException : Exception("signed out")

/**
 * The sign-in and every call to the server (docs/SPEC.md §11.1). It keeps the refresh token in [store],
 * the access token in memory, and swaps the refresh token for a fresh access token when it needs one.
 */
class Session(
    baseUrl: String,
    engine: HttpClientEngine,
    private val store: TokenStore,
    private val clock: () -> Long,
) {
    @Volatile
    private var accessToken: String? = null

    @Volatile
    private var accessValidUntil: Long = 0

    private val api = ApiClient(baseUrl, engine, token = { accessToken })
    private val swapLock = Mutex()

    private val _state = MutableStateFlow<SessionState>(
        store.load()?.let { SessionState.SignedIn(it.me) } ?: SessionState.SignedOut,
    )
    val state: StateFlow<SessionState> = _state

    /** Email a sign-in code. */
    suspend fun requestCode(email: String) {
        api.postAuthOtpRequest(OtpRequest(email))
    }

    /** Sign in with an emailed code, as an Android phone. */
    suspend fun verify(email: String, code: String, label: String) {
        val response = api.postAuthOtpVerify(OtpVerifyRequest(email, code, OtpVerifyRequestClient.ANDROID, label))
        keep(response, checkNotNull(response.refreshToken))
    }

    /** Every call to the server that needs a token goes through this. */
    suspend fun <T> call(block: suspend ApiClient.() -> T): T {
        var used = accessToken
        if (used == null || clock() >= accessValidUntil) {
            swap(used)
            used = accessToken
        }
        return try {
            api.block()
        } catch (e: ApiException) {
            if (e.status == 401) {
                swap(used)
                api.block()
            } else {
                throw e
            }
        }
    }

    /** Sign out: tell the server (ignoring any error) and forget the sign-in. */
    suspend fun signOut() {
        try {
            call { postAuthLogout() }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // A parent is signed out even when the server cannot be reached.
        }
        forget()
    }

    /** Set the access token and its time, keep the refresh token, and say signed in. */
    private fun keep(response: AuthResponse, refreshToken: String) {
        accessToken = response.accessToken
        accessValidUntil = clock() + response.expiresIn * 1000L - ACCESS_MARGIN_MS
        store.save(Saved(refreshToken, response.me))
        _state.value = SessionState.SignedIn(response.me)
    }

    /** Forget the sign-in: clear the access token and the stored refresh token. */
    private fun forget() {
        accessToken = null
        accessValidUntil = 0
        store.clear()
        _state.value = SessionState.SignedOut
    }

    /**
     * Swap the refresh token for a new token pair. The server rotates the refresh token every time, so the
     * whole swap is under one lock: a swap that finds a fresh access token from another call does nothing.
     */
    private suspend fun swap(stale: String?) {
        swapLock.withLock {
            if (accessToken != null && accessToken != stale && clock() < accessValidUntil) {
                return@withLock
            }
            val saved = store.load() ?: run {
                forget()
                throw SignedOutException()
            }
            val response = try {
                api.postAuthRefresh(RefreshRequest(saved.refreshToken))
            } catch (e: ApiException) {
                if (e.status == 401) {
                    forget()
                    throw SignedOutException()
                }
                throw e
            }
            keep(response, response.refreshToken ?: saved.refreshToken)
        }
    }
}
