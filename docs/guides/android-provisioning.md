# Setting up the Android kid app (Device Owner)

The kid app only works as the device's **Device Owner** (docs/SPEC.md §12.1). Android lets an app become Device Owner without a factory reset only from a computer, with `adb`, while the device has no accounts. This guide does that once per device. It takes about 15 minutes.

Two ways to try it:

- **Emulator** (for development): nothing to remove, and you can throw the emulator away. Start here.
- **A real phone or tablet**: the same steps, plus removing and re-adding the Google account.

You need a Windows PC with Android Studio (it includes `adb` in `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\`) and the Screen Time server running (`docker compose` from `deploy/README.md`, or the real server).

## 1. Build the app

In PowerShell, from `C:\Users\james\OpenCode\Testing\ScreenTime\android`:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat :app-kid:assembleDebug
```

The APK is `app-kid\build\outputs\apk\debug\app-kid-debug.apk`.

A **debug** build is for testing: it can always be removed again, it keeps USB debugging on, and it talks to `http://10.0.2.2:8080` by default (the PC, as seen from the emulator). A **release** build turns USB debugging off and blocks uninstalling, so only use one on a kid's real device once everything works.

## 2. Prepare the device

**Emulator:** in Android Studio, Device Manager › Create Virtual Device › Pixel 7 › a system image of **Android 14 (API 34)** or newer **with Google APIs**. Start it. Do not sign in to a Google account.

**Real device:**

1. Settings › Passwords & accounts (or Accounts): remove **every** account, Google included. Write down which ones, to add them back later.
2. Settings › System › Multiple users: remove other users and the guest. Samsung: remove Secure Folder.
3. Settings › About phone: tap **Build number** 7 times. Then Settings › System › Developer options › **USB debugging** on.
4. Plug the device into the PC and allow the PC when the device asks.

Check that the PC sees exactly one device:

```powershell
$adb = "C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe"
& $adb devices
```

## 3. Install and make it Device Owner

```powershell
& $adb install -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
& $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
```

`-t` is needed because debug builds are test-only. The second command prints `Success: Device owner set to package ...`.

If it says `Not allowed to set the device owner because there are already some accounts on the device`, an account is still there (step 2). If it says `already several users`, remove the other users.

**Real device:** now add the Google account back (Settings › Accounts).

## 4. Pair it with the family

1. In the parent web app: Kids › the kid › **Add device** › Phone or Tablet. A 6-digit code shows for 10 minutes.
   On a development database you can skip signing in: `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` prints a code (deploy/README.md, Dev data).
2. Open **Screen Time** on the device. It shows **Connect to your family**.
3. Check the server under the code boxes. For the emulator with the server on the PC it is `http://10.0.2.2:8080`. For a real device on the home Wi-Fi, tap **Change** and type the PC's address, for example `http://192.168.1.20:8080` (debug builds only). For the real server it is `screentime.gallagherhome.au`.
4. Type the code and tap **Connect**.
5. The device asks "This phone belongs to *name*. Correct?" Tap **Yes**. The policies are applied now (auto time on, no date and time changes, no safe mode, no factory reset, no new users, no airplane mode; release builds also turn off USB debugging and block uninstalling).

The new device appears in the parent web app under Devices.

If you tap **No**, the device forgets the code. Remove the device in the parent app, then pair again with a new code.

## 5. Undo (debug builds only)

```powershell
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
```

The restrictions go away with the Device Owner. Remove the device in the parent app too.

## 6. Later, on the kids' devices

Turn on Android's own **Emergency SOS** (Settings › Safety & emergency) with the parents as emergency contacts. Factory Reset Protection tied to a parent's Google account comes in a later card.
