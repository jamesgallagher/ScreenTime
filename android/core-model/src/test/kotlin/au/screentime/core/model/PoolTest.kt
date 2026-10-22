package au.screentime.core.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class PoolTest {
    @Test
    fun apiValuesMatchTheSpec() {
        assertEquals("screens", Pool.SCREENS.apiValue)
        assertEquals("phone", Pool.PHONE.apiValue)
    }

    @Test
    fun fromApiValueRoundTrips() {
        for (pool in Pool.entries) {
            assertEquals(pool, Pool.fromApiValue(pool.apiValue))
        }
    }

    @Test
    fun fromApiValueReturnsNullForUnknown() {
        assertNull(Pool.fromApiValue("tablet"))
    }
}
