package au.screentime.parent.auth

import au.screentime.core.model.api.ApiException
import java.io.IOException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SignInTest {
    @Test
    fun theEmailIsTrimmedAndLowerCase() {
        assertEquals("dad@example.com", cleanEmail("  Dad@Example.COM "))
    }

    @Test
    fun anEmailNeedsOneAtAndADotAfterIt() {
        assertTrue(looksLikeEmail("dad@example.com"))
        assertTrue(looksLikeEmail("j.g@mail.gallagherhome.au"))
        assertFalse(looksLikeEmail(""))
        assertFalse(looksLikeEmail("dad"))
        assertFalse(looksLikeEmail("@example.com"))
        assertFalse(looksLikeEmail("dad@example"))
        assertFalse(looksLikeEmail("dad@.com"))
        assertFalse(looksLikeEmail("dad@example."))
        assertFalse(looksLikeEmail("dad@@example.com"))
        assertFalse(looksLikeEmail("da d@example.com"))
    }

    @Test
    fun theCodeKeepsSixDigits() {
        assertEquals("123456", cleanCode(" 123 456 "))
        assertEquals("123456", cleanCode("1234567"))
        assertEquals("12", cleanCode("1a2"))
    }

    @Test
    fun eachProblemHasItsOwnWords() {
        assertEquals(
            "That code didn't work. Check it, or send a new code.",
            signInError(ApiException(401, null), verifying = true),
        )
        assertEquals("Too many tries. Wait a few minutes, then try again.", signInError(ApiException(429, null), verifying = true))
        assertEquals("Too many tries. Wait a few minutes, then try again.", signInError(ApiException(429, null), verifying = false))
        assertEquals("Check the email address and try again.", signInError(ApiException(422, null), verifying = false))
        assertEquals("Something went wrong on the server. Try again soon.", signInError(ApiException(500, null), verifying = false))
        assertEquals("Something went wrong on the server. Try again soon.", signInError(ApiException(401, null), verifying = false))
        assertEquals(
            "Can't reach Screen Time. Check the internet connection and try again.",
            signInError(IOException("offline"), verifying = true),
        )
    }
}
