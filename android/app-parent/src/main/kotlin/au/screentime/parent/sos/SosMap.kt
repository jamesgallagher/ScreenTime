package au.screentime.parent.sos

import android.content.Context
import android.graphics.drawable.GradientDrawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import au.screentime.core.model.api.SosLocation
import java.io.File
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polygon

/** How close the map starts: about four streets across on a phone. */
private const val ZOOM = 16.5

private const val PIN_RED = 0xFFDC2626.toInt()
private const val ACCURACY_FILL = 0x33DC2626
private const val ACCURACY_EDGE = 0x99DC2626.toInt()

/**
 * A small OpenStreetMap of the kid's last position: a red dot, and a shaded circle for how exact it is. It does not
 * pan or zoom (it sits in a scrolling page); a tap calls [onTap], which opens the phone's maps app. OpenStreetMap
 * needs no API key; its tile policy asks for a real User-Agent, so the app's package name is sent.
 */
@Composable
fun SosMap(loc: SosLocation, onTap: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val map = remember { newMap(context) }
    DisposableEffect(map) {
        map.onResume()
        onDispose {
            map.onPause()
            map.onDetach()
        }
    }
    AndroidView(
        factory = { map },
        modifier = modifier,
        update = { m ->
            m.setOnTouchListener { view, event ->
                if (event.action == android.view.MotionEvent.ACTION_UP) {
                    view.performClick()
                    onTap()
                }
                true
            }
            show(m, loc)
        },
    )
}

private fun newMap(context: Context): MapView {
    Configuration.getInstance().apply {
        userAgentValue = context.packageName
        osmdroidBasePath = File(context.cacheDir, "osmdroid")
        osmdroidTileCache = File(osmdroidBasePath, "tiles")
    }
    return MapView(context).apply {
        setTileSource(TileSourceFactory.MAPNIK)
        isTilesScaledToDpi = true
        setMultiTouchControls(false)
        zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
        controller.setZoom(ZOOM)
    }
}

/** Puts the dot and the circle on [m] and centres it there. */
private fun show(m: MapView, loc: SosLocation) {
    val point = GeoPoint(loc.lat, loc.lng)
    m.overlays.clear()
    loc.accuracyM?.let { accuracy ->
        val circle = Polygon(m).apply {
            points = Polygon.pointsAsCircle(point, accuracy.coerceAtLeast(10.0))
            fillPaint.color = ACCURACY_FILL
            outlinePaint.color = ACCURACY_EDGE
            outlinePaint.strokeWidth = 2f * m.resources.displayMetrics.density
        }
        m.overlays.add(circle)
    }
    val density = m.resources.displayMetrics.density
    val dot = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(PIN_RED)
        setStroke((3 * density).toInt(), 0xFFFFFFFF.toInt())
        setSize((20 * density).toInt(), (20 * density).toInt())
    }
    val marker = Marker(m).apply {
        position = point
        icon = dot
        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
        setInfoWindow(null)
    }
    m.overlays.add(marker)
    m.controller.setCenter(point)
    m.invalidate()
}
