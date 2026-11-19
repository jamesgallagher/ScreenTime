package au.screentime.kid.service

import au.screentime.core.model.api.DeviceState
import au.screentime.core.model.api.KidKind

/**
 * A shared device ends parent mode when its screen goes off, whatever the duration, so a parent can put it down
 * without leaving it open for a kid (docs/SPEC.md §12.8). A kid's device, or a snapshot without `kind`, does not.
 */
fun endsParentModeAtScreenOff(state: DeviceState?, parentModeOn: Boolean): Boolean =
    parentModeOn && state?.kid?.kind == KidKind.SHARED
