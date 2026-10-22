package au.screentime.core.time

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

class DurationFormatTest {
    @ParameterizedTest(name = "{0} s -> {1}")
    @CsvSource(
        "-5, less than a minute",
        "0, less than a minute",
        "59, less than a minute",
        "60, 1m",
        "2700, 45m",
        "3600, 1h",
        "4320, 1h 12m",
        "4379, 1h 12m",
        "36000, 10h",
    )
    fun formats(seconds: Long, expected: String) {
        assertEquals(expected, formatDuration(seconds))
    }
}
