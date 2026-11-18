package au.screentime.parent

import android.app.Application
import android.os.SystemClock
import au.screentime.parent.auth.PrefsTokenStore
import au.screentime.parent.auth.Session
import au.screentime.parent.push.Push
import au.screentime.parent.push.createChannels
import au.screentime.parent.update.FakeUpdateSource
import au.screentime.parent.update.ParentUpdates
import io.ktor.client.engine.okhttp.OkHttp

/**
 * The parent app (docs/SPEC.md §16.4). It makes the one [Session] every screen uses.
 */
class ParentApp : Application() {
    lateinit var session: Session
        private set

    override fun onCreate() {
        super.onCreate()
        session = Session(BuildConfig.SERVER, OkHttp.create(), PrefsTokenStore(this), SystemClock::elapsedRealtime)
        Push.start(this)
        createChannels(this)
        // The app's own updates (docs/SPEC.md §12.3). FAKE until CARD-064 puts the real updater here.
        ParentUpdates.source = FakeUpdateSource()
    }
}
