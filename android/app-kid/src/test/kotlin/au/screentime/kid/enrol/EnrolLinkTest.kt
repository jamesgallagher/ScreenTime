package au.screentime.kid.enrol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class EnrolLinkTest {
    @Test
    fun theRealServerUsesHttps() {
        val link = parseEnrolLink("screentime://enrol?host=screentime.gallagherhome.au&code=482913", allowHttp = false)

        assertEquals(EnrolLink("https://screentime.gallagherhome.au", "482913"), link)
    }

    @Test
    fun aHostWithAPortUsesHttpOnlyInDebugBuilds() {
        val text = "screentime://enrol?host=10.0.2.2%3A8080&code=000123"

        assertEquals(EnrolLink("http://10.0.2.2:8080", "000123"), parseEnrolLink(text, allowHttp = true))
        assertEquals(EnrolLink("https://10.0.2.2:8080", "000123"), parseEnrolLink(text, allowHttp = false))
    }

    @Test
    fun theOrderOfTheParametersDoesNotMatter() {
        val link = parseEnrolLink(" SCREENTIME://ENROL?code=482913&host=Screentime.Gallagherhome.au ", allowHttp = false)

        assertEquals(EnrolLink("https://screentime.gallagherhome.au", "482913"), link)
    }

    @Test
    fun anythingElseIsRefused() {
        val bad = listOf(
            "",
            "482913",
            "https://screentime.gallagherhome.au/?code=482913",
            "screentime://pair?host=example.com&code=482913",
            "screentime://enrol/x?host=example.com&code=482913",
            "screentime://enrol?host=example.com",
            "screentime://enrol?code=482913",
            "screentime://enrol?host=example.com&code=48291",
            "screentime://enrol?host=example.com&code=48291a",
            "screentime://enrol?host=example.com%2Fv1&code=482913",
            "screentime://enrol?host=me%40example.com&code=482913",
            "screentime://enrol?host=https%3A%2F%2Fexample.com&code=482913",
            "screentime://enrol?host=%zz&code=482913",
        )
        for (text in bad) {
            assertNull(parseEnrolLink(text, allowHttp = true), text)
        }
    }
}
