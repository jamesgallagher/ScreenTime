# Setting up the Android apps

The kid app only works as the device's **Device Owner** (docs/SPEC.md §12.1). Android lets an app become Device Owner without a factory reset only from a computer, with `adb`, while the device has no accounts. This guide does that once per device. It takes about 15 minutes.

Also here: [the parents' phones](#7-the-parents-phones), [updating the kid app](#8-updating-the-kid-app), [removing Screen Time](#9-removing-screen-time) and [what this does not stop](#10-what-this-does-not-stop).

You need a Windows PC with Android Studio (it includes `adb` in `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\`) and the Screen Time server running.

## Which build

| | Debug | Release |
|---|---|---|
| **For** | The emulator and trying things out | A kid's real device |
| **Server** | `http://10.0.2.2:8080` by default (the PC, seen from the emulator); `http` allowed | `https://screentime.gallagherhome.au`; `https` only |
| **USB debugging** | Stays on | Goes **off** when you tap **Yes** in step 5 |
| **Uninstalling** | Allowed | Blocked, until a parent uses **Remove Screen Time** |
| **Updates** | By `adb` | By itself, from the server (step 8) |
| **Signing** | Android Studio's debug key | Your release key (step 1) |

You cannot update a debug build to a release build: the keys differ. To change, undo it (step 11) and start again. On the emulator you need no release key: skip step 1.

## 1. The release key (once, for all devices)

Every update must be signed with the same key as the app already on the device. **If you lose this key, or its password, Android refuses every later update, and each device must have Screen Time removed and be set up again from a computer.** Nothing can recover it.

Make it outside the repo. `keytool` asks you for a password; type a long one and keep it in your password manager:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
New-Item -ItemType Directory -Force C:\Users\james\ScreenTimeKeys
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore C:\Users\james\ScreenTimeKeys\screentime-release.keystore -alias screentime -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Screen Time"
```

**Back it up now, before any device uses it.** Put a copy of `screentime-release.keystore` somewhere that is not this PC and not the Unraid server alone: for example a USB stick kept in a drawer, or as an attachment in your password manager. Try the copy: `keytool -list -keystore <the copy>` must accept the password.

Then make `android\keystore.properties`. Git ignores this file; never commit it or the keystore:

```properties
storeFile=C:/Users/james/ScreenTimeKeys/screentime-release.keystore
storePassword=<the password>
keyAlias=screentime
keyPassword=<the password>
```

## 2. Build the app

In PowerShell, from `C:\Users\james\OpenCode\Testing\ScreenTime\android`.

**For the emulator, a debug build:**

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat :app-kid:assembleDebug
```

The APK is `app-kid\build\outputs\apk\debug\app-kid-debug.apk`.

**For a kid's device, a release build:**

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
Test-Path app-kid\google-services.json
.\gradlew.bat :app-kid:assembleRelease
```

The APK is `app-kid\build\outputs\apk\release\app-kid-release.apk`. `Test-Path` must say `True`: without that file the build still works, but the app gets no push messages. It comes from the Firebase console, project `screentime-d307c`, and git ignores it.

## 3. Prepare the device

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

## 4. Install and make it Device Owner

**Do every command in this step before you pair in step 5.** On a release build, tapping **Yes** turns USB debugging off, and these cannot be done afterwards. If you miss one, use **Remove Screen Time** (step 9) and start again from step 3.

Install the build from step 2. Debug needs `-t`, because debug builds are test-only:

```powershell
& $adb install -t app-kid\build\outputs\apk\debug\app-kid-debug.apk
```

Or for release:

```powershell
& $adb install app-kid\build\outputs\apk\release\app-kid-release.apk
```

Then, for both:

```powershell
& $adb shell dpm set-device-owner au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb shell cmd appops set au.screentime.kid GET_USAGE_STATS allow
```

The first prints `Success: Device owner set to package ...`. The second gives the app usage access, which Device Owner cannot grant: it is how the app sees the first use of each app and adds up daily app limits.

**On a phone with a SIM** also run this. Without it, a blocked phone can call anyone, not only the people on the kid's list. Skip it on a tablet:

```powershell
& $adb shell cmd role add-role-holder android.app.role.CALL_REDIRECTION au.screentime.kid
```

Check them. The answers are `... au.screentime.kid/.admin.KidDeviceAdminReceiver,DeviceOwner`, `GET_USAGE_STATS: allow` and (phone) `au.screentime.kid`:

```powershell
& $adb shell cmd device_policy list-owners
& $adb shell cmd appops get au.screentime.kid GET_USAGE_STATS
& $adb shell cmd role get-role-holders android.app.role.CALL_REDIRECTION
```

If it says `Not allowed to set the device owner because there are already some accounts on the device`, an account is still there (step 3). If it says `already several users`, remove the other users. If it throws a long error straight after the device started, wait a minute and try again.

**Real device:** now add the Google account back (Settings › Accounts).

## 5. Pair it with the family

1. In the parent web app: Kids › the kid › **Add device** › Phone or Tablet. A QR code and a 6-digit code show for 10 minutes.
   On a development database you can skip signing in: `pnpm --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Alex phone` prints a code and an emulator link (deploy/README.md, Dev data).
2. Open **ST Kid** on the device. It shows **Connect to your family**.
3. **Scan QR code** and point the camera at the QR code. The QR code holds the server too, so the device connects straight away; go on at step 5. Or type the code, as below.

   On the emulator the camera does not see your screen. Open the emulator link from `dev-enrol-code.ts` instead; it does the same as scanning (use your code instead of `123456`; the inner single quotes keep the `&`):

   ```powershell
   & $adb shell "am start -W -a android.intent.action.VIEW -d 'screentime://enrol?host=10.0.2.2%3A8080&code=123456' au.screentime.kid"
   ```

   (A QR code made by a web app on `localhost` holds `localhost`, which the emulator cannot reach, so use the emulator link.)
4. To type the code instead: check the server under the code boxes. A release build already says `screentime.gallagherhome.au`. For the emulator with the server on the PC it is `http://10.0.2.2:8080`. For a debug build on a real device on the home Wi-Fi, tap **Change** and type the PC's address, for example `http://192.168.1.20:8080`.
   Type the code and tap **Connect**.
5. The device asks "This phone belongs to *name*. Correct?" Tap **Yes**. The policies are applied now (auto time on, no date and time changes, no safe mode, no factory reset, no new users, no airplane mode; release builds also turn off USB debugging and block uninstalling).

The new device appears in the parent web app under Devices, with its version.

If you tap **No**, the device forgets the code. Remove the device in the parent app, then pair again with a new code.

## 6. Then, on the kid's device

Turn on Android's own **Emergency SOS** (Settings › Safety & emergency) with the parents as emergency contacts.

## 7. The parents' phones

The parent app needs no Device Owner, no account removal and nothing kept off. It uses the same key as the kid app, so do step 1 first. From the `android` folder:

```powershell
Test-Path app-parent\google-services.json
.\gradlew.bat :app-parent:assembleRelease
```

Turn on USB debugging on the phone (step 3, items 3 and 4), then:

```powershell
& $adb install app-parent\build\outputs\apk\release\app-parent-release.apk
```

Turn USB debugging off again. Open **ST Parent**, type your email under **Parent sign-in**, tap **Send code**, and type the code from the email. Allow notifications: an SOS and every approval arrive that way.

To update it later, raise `versionCode` and `versionName` in `app-parent\build.gradle.kts`, build, turn on USB debugging and add `-r` to the install. The parent app does not update itself.

## 8. Updating the kid app

Release devices have no USB debugging, so they update themselves from the server. You need the release key (step 1), SSH from this PC to `root@192.168.0.148`, and the server's `releases` folder (docs/guides/deploy.md, Kid app releases).

Android only installs a **higher** version, so a version that is already out cannot be taken back: the fix for a bad one is a newer one. That is why each version goes to one device first.

1. In the main checkout, on an up-to-date `main`, raise `kidVersionCode` by one and set `kidVersionName` in `android\gradle.properties`. Commit that. The main checkout is the one with `google-services.json`.
2. Find the id of the device to try it on, on the Unraid server:

   ```sh
   cd /mnt/user/appdata/screentime
   docker compose exec db psql -U screentime -c "select d.id, k.name as kid, d.name, d.app_version from devices d join kids k on k.id = d.kid_id where d.revoked_at is null order by k.name, d.name"
   ```

3. From the repo root, publish it to that device. This builds the release and copies it to the server:

   ```powershell
   pwsh -File android\publish-kid.ps1 -DeviceId <the id>
   ```

4. Wait. The device asks after a sync, at most every 6 hours; it downloads only on a network that is not metered (Wi-Fi), and installs only when the screen is off and no SOS is running. The kid sees nothing. The parent web app's Devices panel shows **Version** with the new number once it has restarted and synced.
5. Use that device for a day. Check that it still counts time, blocks, and answers an ask.
6. Publish to every device, which rebuilds the same version:

   ```powershell
   pwsh -File android\publish-kid.ps1
   ```

Old `kid-<number>.apk` files in the server's `releases` folder can be deleted once every device has moved on. Keep the one `kid.json` names.

## 9. Removing Screen Time

From a release device, with no computer needed:

1. On the kid's device tap **I'm the parent**. Approve it from the parent app, or tap **Enter parent code instead**. Parent mode must be on.
2. On the main screen tap **Remove Screen Time**, then **Remove it** (**Keep it** changes nothing).
3. Type the 6 numbers shown in the parent app. It asks even in parent mode, because parent mode can be started remotely while the kid holds the device.
4. Android asks **Uninstall this app?** Tap **Uninstall**.

The device now has no limits and no SOS, every blocked app is free, and USB debugging can be turned on again. The server marks the device removed and tells the parents; the family's history stays. If the device was offline, remove it in the parent app as well.

If you tap **Cancel** on Android's question, the app stays, shows the setup screen and does nothing. Uninstall it in Settings › Apps. To use Screen Time on the device again, start from step 3.

## 10. What this does not stop

**Factory Reset Protection is not built.** A reset from Settings is blocked, but a kid who knows how can start the device in its recovery menu and reset it from there. That takes Screen Time off the device and wipes it. The parents would see the device stop syncing. Android's protection against this would need a parent's Google account tied to the policy, and a way to take it off again.

## 11. Undo (debug builds only)

```powershell
& $adb shell dpm remove-active-admin au.screentime.kid/.admin.KidDeviceAdminReceiver
& $adb uninstall au.screentime.kid
```

The restrictions go away with the Device Owner. Remove the device in the parent app too. These commands do not work on a release build: use step 9.
