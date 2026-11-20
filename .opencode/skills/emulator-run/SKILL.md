---
name: emulator-run
description: How to run an Android end-to-end check of the Screen Time kid or parent app on the emulator on this PC. Use when a card's checks need the Android app running.
---

# A run on the Android emulator

The emulator is on this PC: Android Studio's AVD `Medium_Phone_API_37.0`. "No emulator available" is never true; if it will not start, paste the error.

```powershell
$sdk = "$env:LOCALAPPDATA\Android\Sdk"; $adb = "$sdk\platform-tools\adb.exe"
Start-Process "$sdk\emulator\emulator.exe" -ArgumentList '-avd Medium_Phone_API_37.0 -wipe-data -no-snapshot-save -no-audio -no-boot-anim -no-window -memory 3072' -WindowStyle Hidden
# wait until `adb devices` shows emulator-5554 and `adb -e shell getprop sys.boot_completed` is 1 (about a minute)
```

Then, for the kid app (`android/app-kid/build/outputs/apk/debug/app-kid-debug.apk`, built with `.\gradlew.bat :app-kid:assembleDebug` from `android` with `JAVA_HOME` set to Android Studio's `jbr`):

1. `adb -e install -t <apk>`.
2. `adb -e shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver`. Right after boot it often says "Not allowed": wait 20 s and try again (up to 8 times).
3. `adb -e shell cmd appops set au.screentime.kid GET_USAGE_STATS allow`.
4. Enrol: `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` prints an emulator link; `adb -e shell "am start -W -a android.intent.action.VIEW -d '<link>' au.screentime.kid"`; tap **Yes** (find it with `uiautomator dump`, as `docs/cards/CARD-058-run.ps1` does in `Tap-Text`).
5. Time: `server/scripts/dev-grant.ts Alex phone 60` (needs `DATABASE_URL` and `JWT_SECRET`).
6. Logs: `adb -e logcat -d -s KidService`. Screen off makes the app sync: `adb -e shell input keyevent KEYCODE_SLEEP`.
7. At the end: `adb -s emulator-5554 emu kill`.

**Traps:** `-memory 3072`, or the PC runs out of memory and adb hangs silently. The dev database is shared: do not wipe it (`down -v`) unless the card's run says so. Paste every step's real output; a step without it counts as `NOT RUN`.
