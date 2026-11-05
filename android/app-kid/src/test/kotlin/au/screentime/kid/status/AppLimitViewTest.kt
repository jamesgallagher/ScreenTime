package au.screentime.kid.status

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** The words of the main screen's list of app limits (docs/SPEC.md §16.2). */
class AppLimitViewTest {
    @Test
    fun saysWhatIsLeft() {
        assertEquals("YouTube · 12m left", appLimitLine(AppLimitView("YouTube", 720)))
        assertEquals("YouTube · 1h 5m left", appLimitLine(AppLimitView("YouTube", 3900)))
    }

    @Test
    fun saysWhenItIsDone() {
        assertEquals("YouTube · done for today", appLimitLine(AppLimitView("YouTube", 0)))
        assertEquals("YouTube · done for today", appLimitLine(AppLimitView("YouTube", -5)))
    }
}
