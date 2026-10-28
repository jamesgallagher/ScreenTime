package au.screentime.parent.auth

import android.content.Context
import android.util.Base64
import android.util.Log
import au.screentime.core.model.api.ApiJson
import au.screentime.core.model.api.Me
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The token store (docs/SPEC.md §11.1): the refresh token encrypted with a key in the Android Keystore, and
 * the sign-in plain. SharedPreferences named `session`.
 */
class PrefsTokenStore(context: Context) : TokenStore {
    private val context = context.applicationContext
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    override fun load(): Saved? {
        val token = prefs.getString("refreshToken", null) ?: return null
        val meJson = prefs.getString("me", null) ?: return null
        return try {
            val me = ApiJson.decodeFromString(Me.serializer(), meJson)
            Saved(decrypt(token), me)
        } catch (e: GeneralSecurityException) {
            Log.w(TAG, e.javaClass.simpleName)
            null
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, e.javaClass.simpleName)
            null
        }
    }

    override fun save(saved: Saved) {
        prefs.edit()
            .putString("refreshToken", encrypt(saved.refreshToken))
            .putString("me", ApiJson.encodeToString(Me.serializer(), saved.me))
            .commit()
    }

    override fun clear() {
        prefs.edit().clear().commit()
    }

    /** The AES key in the Android Keystore, made on first use. */
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore")
        store.load(null)
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    /** Encrypt a token as `<iv>.<ciphertext>`, both Base64. */
    private fun encrypt(token: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val body = Base64.encodeToString(ciphertext, Base64.NO_WRAP)
        return "$iv.$body"
    }

    /** Decrypt a `<iv>.<ciphertext>` token. */
    private fun decrypt(stored: String): String {
        val parts = stored.split(".", limit = 2)
        require(parts.size == 2) { "not iv.ciphertext" }
        val (ivBase64, bodyBase64) = parts
        val iv = Base64.decode(ivBase64, Base64.NO_WRAP)
        val ciphertext = Base64.decode(bodyBase64, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext).decodeToString()
    }

    companion object {
        private const val TAG = "PrefsTokenStore"
        private const val KEY_ALIAS = "session"
    }
}
