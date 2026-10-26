package au.screentime.kid.enrol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class EnrolRulesTest {
    @Test
    fun cleanCodeKeepsAtMostSixDigits() {
        assertEquals("123456", cleanCode("123456"))
        assertEquals("123456", cleanCode(" 123-456 "))
        assertEquals("123456", cleanCode("1234567"))
        assertEquals("12", cleanCode("1a2b"))
        assertEquals("", cleanCode("abc"))
    }

    @Test
    fun serverUrlAddsHttpsAndDropsTheSlash() {
        assertEquals("https://screentime.gallagherhome.au", serverUrl("screentime.gallagherhome.au", allowHttp = false))
        assertEquals("https://screentime.gallagherhome.au", serverUrl(" https://Screentime.Gallagherhome.au/ ", allowHttp = false))
        assertEquals("https://192.168.1.20:8443", serverUrl("192.168.1.20:8443", allowHttp = false))
    }

    @Test
    fun serverUrlTakesHttpOnlyWhenAllowed() {
        assertEquals("http://10.0.2.2:8080", serverUrl("http://10.0.2.2:8080", allowHttp = true))
        assertNull(serverUrl("http://10.0.2.2:8080", allowHttp = false))
    }

    @Test
    fun serverUrlRefusesWhatIsNotAServer() {
        for (bad in listOf("", "   ", "ftp://example.com", "https://", "exa mple.com", "example.com/v1", "example.com?x=1", "https://me@example.com")) {
            assertNull(serverUrl(bad, allowHttp = true), bad)
        }
    }

    @Test
    fun serverLabelHidesHttps() {
        assertEquals("screentime.gallagherhome.au", serverLabel("https://screentime.gallagherhome.au"))
        assertEquals("http://10.0.2.2:8080", serverLabel("http://10.0.2.2:8080"))
    }

    @Test
    fun deviceModelJoinsMakerAndModelOnce() {
        assertEquals("Google Pixel 7", deviceModel("Google", "Pixel 7"))
        assertEquals("Samsung SM-S916B", deviceModel("samsung", "SM-S916B"))
        assertEquals("XPPen Magic Drawing Pad", deviceModel("XPPen", "XPPen Magic Drawing Pad"))
        assertEquals("Android device", deviceModel(" ", " "))
        assertEquals(100, deviceModel("Maker", "x".repeat(200)).length)
    }

    @Test
    fun enrolErrorMessagesAreFriendly() {
        assertEquals("That code didn't work. Check it, or ask for a new one.", enrolErrorMessage(401))
        assertEquals("That code is for a PC. Ask for a phone or tablet code.", enrolErrorMessage(409))
        assertEquals("Too many tries. Wait 15 minutes, then try again.", enrolErrorMessage(429))
        assertEquals("Can't reach Screen Time. Check the Wi-Fi and try again.", enrolErrorMessage(null))
        assertEquals("Something went wrong. Try again.", enrolErrorMessage(500))
    }
}
