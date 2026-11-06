# CARD-054: Guides for Android and Windows

| Field | Value |
|---|---|
| Card | CARD-054 |
| Title | Guides for Android and Windows |
| Size | S |
| Depends on | CARD-038, CARD-052, CARD-056, CARD-059 |
| Spec sections | docs/SPEC.md §12.1, §12.2 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-054-guides` |
| PR title | `CARD-054: Guides for Android and Windows` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first (rules 8, 9 and 10 especially).

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1.** Write every file as UTF-8 without a BOM.

The rollout (CARD-055) follows these guides, so what they say must be true. Writing them found that the parent app could not be installed on a real phone: its release build had no signing and stopped on a false lint error. This card fixes that too.

Claude has already rehearsed this card with the text below, and every step of section 8 passed. Copy it exactly.

**The run must be your own.** This card has no sample of Claude's output. Claude checks your run's times against the file's date. If a step stops, hangs or fails, say so and paste what it printed.

## 2. Goal

`docs/guides/android-provisioning.md` covers the release key and its backup, both builds, the parents' phones, updating, removing and the known gap. `docs/guides/windows-install.md` exists. `docs/guides/deploy.md` covers the releases folder. The parent app's release build is signed and opens. `pnpm test`, `.\gradlew.bat assembleDebug test` and `pwsh -File docs\cards\CARD-054-run.ps1` pass, and CI is green.

## 3. Out of scope

- Never use a real phone, never connect to the Unraid server, never run `android\publish-kid.ps1`, and never make a real release key. CARD-055 does those with James.
- No change to any screen except the one sentence in 5.2. No other code. No new library.
- Never commit secrets (`deploy/.env`, keys, tokens, `google-services.json`, `local.properties`, `android/keystore.properties`).

## 4. Tech

The project's existing stack, with nothing new.

Traps Claude hit in the rehearsal, so you need not:

- The parent app's release build fails `lintVitalRelease` with `InvalidFragmentVersionForActivityResult`. It is a false alarm for a `ComponentActivity`, and Firebase brings the old library along. The diff in 5.2 turns off that one check.
- Straight after an emulator starts, `dpm set-device-owner` can throw a long error. The script tries again; the guide says so.
- On the kid app's setup screen the keyboard covers the server line. The script presses Back first.
- The script stops the adb server and the Gradle daemon at the end, because they keep a pipe open. If it has printed `--- Finished` and the window does not return, say so under Deviations.
- The run script throws at once if `android\keystore.properties` already exists, so it can never delete a real one. If it says so, stop and tell James.

## 5. Files

`docs/cards/CARD-054-run.ps1` is already on `main`. Do not change it.

### 5.1 Create or replace these, exactly

Replace the whole of the first file. Copy what is between the five-backtick lines, not those lines themselves.

#### `docs/guides/android-provisioning.md`

`````markdown
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
`````

#### `docs/guides/windows-install.md`

`````markdown
# Installing Screen Time on a Windows PC

Screen Time on a PC is a Windows service, a tray icon for the kid, and a setup window for the parent (docs/SPEC.md §12.2). This guide does it once per PC, in about 15 minutes, on Windows 11 Pro. You need the PC's administrator password and the parent app or web app, with the kids already added.

## 1. The accounts

Each kid needs their own **standard** account, and each parent an **administrator** account. Screen Time never limits an administrator, so a kid on an administrator account has no limits at all.

Signed in as a parent: Settings › Accounts › Other users. Add any account that is missing. To change one: select it › **Change account type** › **Standard User**.

Make sure a parent's administrator account has a password the kids do not know.

## 2. Get the installer

GitHub builds `ScreenTime.msi` each time the Windows code changes on `main`. On a PC with the GitHub CLI, in PowerShell:

```powershell
$run = gh run list --repo jamesgallagher/ScreenTime --workflow windows.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId'
gh run download $run --repo jamesgallagher/ScreenTime --name ScreenTime-msi --dir C:\Users\james\Downloads\ScreenTime-msi
```

GitHub keeps each one for 14 days. If the download says there is no such artifact, build a fresh one, wait about 5 minutes until it has finished, and run the two lines above again:

```powershell
gh workflow run windows.yml --repo jamesgallagher/ScreenTime --ref main
```

Copy `ScreenTime.msi` to the kid's PC, for example on a USB stick.

## 3. Install

Signed in as a parent, double-click `ScreenTime.msi`. If Windows says it protected your PC, choose **More info**, then **Run anyway**: the installer is not signed. Allow the administrator question. It shows a progress bar and asks nothing else.

That installs the service, sets it to start with Windows, to restart if it stops and to run in Safe Mode too, and takes the "Change the time zone" right from standard accounts. Nothing is limited yet.

## 4. Connect the accounts

1. Open the Start menu › **Screen Time Setup**, and allow the administrator question.
2. Under **Your Screen Time server** type `screentime.gallagherhome.au` and press **Check**. It says **Screen Time answers at** the address.
3. **The accounts on this PC** lists the accounts. Administrators say **A parent: never limited**. If a kid's account says that, go back to step 1.
4. For each kid's account: in the parent app, open the kid › **Add device** › **PC**. Type the 6 digits next to the account and press **Connect**. A code works once, for 10 minutes.
5. Press **Finish**. The limits start now.

The PC appears in the parent app under Devices, one device for each kid's account.

| It says | What to do |
|---|---|
| Can't reach Screen Time at that address | Check the address, and that this PC is online |
| That code is wrong or has expired | Make a new one in the parent app |
| That code is for a phone or tablet | In the parent app, choose **PC** |
| Too many tries | Wait 15 minutes, then try again |
| This PC has no standard accounts | Make one for each kid (step 1), then press **Check** again |

## 5. Close the gaps

Screen Time cannot do these from inside Windows:

- **Set a BIOS password and turn off USB boot.** Otherwise a kid can start the PC from a USB stick and go around Windows. Every PC's BIOS is different: restart, press its setup key (often Delete or F2), and look under Security and Boot.
- **Keep the parent's password private.** Anyone with an administrator account can uninstall Screen Time.

## 6. Check it

Sign out, and sign in as the kid. In a few seconds the Screen Time icon is in the tray, with the time left. In the parent app, take the kid's Screens time down to nothing: the PC locks, without signing the kid out. Give the time back, and the kid can unlock it.

Only the account on the PC's own screen is limited. A session over Remote Desktop is not, so try this at the PC itself.

A locked PC cannot show buttons. The kid asks in person or from their phone; a parent gives time, or starts parent mode from the parent app's device screen.

## Updating

The PC does not update itself. Get the newer `ScreenTime.msi` (step 2) and install it the same way (step 3), over the old one. It replaces the old version, the accounts stay connected and the limits carry on, so you do not need **Screen Time Setup** again.

To see what is installed, look in Settings › Apps › Installed apps › **Screen Time**. The **Version** in the parent app's Devices panel is the service's own number and does not change with each installer.

## Removing it

Signed in as a parent: Settings › Apps › Installed apps › **Screen Time** › **Uninstall**. That removes the service and the tray and gives the "Change the time zone" right back.

Then remove the PC's devices in the parent app. The family's history stays.

Uninstalling leaves this PC's connection in `C:\ProgramData\ScreenTime`. If you will not use Screen Time here again, delete it from a PowerShell opened as administrator:

```powershell
Remove-Item -Recurse -Force C:\ProgramData\ScreenTime
```
`````

### 5.2 Change these, exactly

#### `docs/guides/deploy.md`

```diff
@@ -8,6 +8,7 @@ How it fits together:
 - **The stack** lives in `/mnt/user/appdata/screentime/`: `docker-compose.yml`, `backup.sh` (both from `deploy/unraid/` in the repo) and `.env` (secrets, only on the server). Three containers: `db` (PostgreSQL 18, data in `/mnt/user/appdata/screentime/postgres`), `api`, and `backup`.
 - **The API is published on Unraid's port 8086** (bridge networking, `8086:8080`). Port 8080 on Unraid belongs to qBittorrent.
 - **The tunnel route** `screentime.gallagherhome.au` → `http://192.168.0.148:8086` is set in the Cloudflare dashboard (it already exists). Do **not** put Cloudflare Access in front of it: kid devices sign in with their own tokens on `/v1/*`.
+- **Kid app releases** go in `/mnt/user/appdata/screentime/releases`, which `api` reads (see Kid app releases below).
 - **Backups:** the `backup` container runs `pg_dump` every night at 02:30 (Sydney) into `/mnt/user/Backup/screentime/`, keeping 30 days.
 
 All commands below run on the Unraid server over SSH (`ssh root@192.168.0.148`) unless they say otherwise.
@@ -17,7 +18,7 @@ All commands below run on the Unraid server over SSH (`ssh root@192.168.0.148`)
 ### 1. The folder and the files
 
 ```sh
-mkdir -p /mnt/user/appdata/screentime/postgres /mnt/user/Backup/screentime
+mkdir -p /mnt/user/appdata/screentime/postgres /mnt/user/appdata/screentime/releases /mnt/user/Backup/screentime
 cd /mnt/user/appdata/screentime
 base=https://raw.githubusercontent.com/jamesgallagher/ScreenTime/main/deploy/unraid
 curl -fsSLO "$base/docker-compose.yml" && curl -fsSLO "$base/backup.sh" && curl -fsSL "$base/.env.example" -o .env.example
@@ -73,7 +74,7 @@ Saving it also makes the DNS record. Check from any PC: `curl https://screentime
 
 ### 5. The family
 
-Open https://screentime.gallagherhome.au, sign in with `SUPER_ADMIN_EMAIL` (the code arrives by email), and in **Admin** create the family with its time zone, emergency number and first parent. Then add the kids, and their devices (docs/guides/android-provisioning.md, and for a PC the MSI and **Screen Time Setup**).
+Open https://screentime.gallagherhome.au, sign in with `SUPER_ADMIN_EMAIL` (the code arrives by email), and in **Admin** create the family with its time zone, emergency number and first parent. Then add the kids, and their devices (docs/guides/android-provisioning.md, and for a PC docs/guides/windows-install.md).
 
 ## Updating
 
@@ -89,6 +90,20 @@ Migrations run when the new `api` starts. If `docker-compose.yml` or `backup.sh`
 
 **Going back:** set `API_TAG=<commit sha>` in `.env` (any commit that published an image), then `docker compose up -d --wait`. Set it back to `latest` afterwards. A migration that already ran is not undone: restore a backup if a release broke the data.
 
+## Kid app releases
+
+The kid app updates itself from this server (docs/guides/android-provisioning.md, Updating the kid app). `android/publish-kid.ps1` on the PC copies the APK and `kid.json` into `/mnt/user/appdata/screentime/releases` over SSH. `api` reads that folder as `/releases`, read-only, so no restart is needed. With no `kid.json` there, devices are offered nothing.
+
+A stack set up before this folder existed needs the new `docker-compose.yml` (step 1's `curl` lines), then:
+
+```sh
+cd /mnt/user/appdata/screentime
+mkdir -p releases
+docker compose pull api && docker compose up -d --wait
+```
+
+The APKs are not in the nightly backup and need not be: the repo and the release key make them again. **The release key itself is not on this server** and is backed up by hand (docs/guides/android-provisioning.md, step 1).
+
 ## Backups
 
 The `backup` container logs each one: `docker compose logs backup`. Files are `/mnt/user/Backup/screentime/screentime-YYYY-MM-DD-HHMM.dump` (pg_dump's custom format).
```

#### `android/app-parent/build.gradle.kts`

```diff
@@ -1,3 +1,5 @@
+import java.util.Properties
+
 plugins {
     alias(libs.plugins.android.application)
     alias(libs.plugins.kotlin.compose)
@@ -37,12 +39,28 @@ android {
         }
     }
 
+    // The same key file as the kid app (docs/guides/android-provisioning.md). Without it a release build stays unsigned.
+    val signing = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { f ->
+        Properties().apply { f.inputStream().use { load(it) } }
+    }
+    signingConfigs {
+        if (signing != null) {
+            create("release") {
+                storeFile = file(signing.getProperty("storeFile"))
+                storePassword = signing.getProperty("storePassword")
+                keyAlias = signing.getProperty("keyAlias")
+                keyPassword = signing.getProperty("keyPassword")
+            }
+        }
+    }
+
     buildTypes {
         debug {
             // The Android emulator reaches the developer's PC at 10.0.2.2 (`pnpm dev:server` or docker compose).
             buildConfigField("String", "SERVER", "\"http://10.0.2.2:8080\"")
         }
         release {
+            if (signing != null) signingConfig = signingConfigs.getByName("release")
             buildConfigField("String", "SERVER", "\"https://screentime.gallagherhome.au\"")
         }
     }
@@ -57,6 +75,11 @@ android {
         buildConfig = true
     }
 
+    // MainActivity is a ComponentActivity, so the old Fragment library that Firebase brings along plays no part in it.
+    lint {
+        disable += "InvalidFragmentVersionForActivityResult"
+    }
+
     testOptions {
         unitTests.all {
             it.useJUnitPlatform()
```

#### `.github/workflows/windows.yml`

```diff
@@ -1,6 +1,8 @@
 name: Windows
 
 on:
+  # A fresh MSI on request: GitHub keeps each one 14 days (docs/guides/windows-install.md).
+  workflow_dispatch:
   pull_request:
     paths:
       - "windows/**"
```

Rule 10 of `AGENTS.md`: this one sentence is the only change to Claude's front end, and it is exact.

#### `web/src/components/add-device-dialog.tsx`

```diff
@@ -79,7 +79,7 @@ function CodeStep({
       </DialogTitle>
       <DialogDescription>
         {form === 'pc'
-          ? `On the PC, a parent runs the ScreenTime installer and types this code for ${kidName}'s Windows account.`
+          ? `On the PC, a parent opens Screen Time Setup and types this code for ${kidName}'s Windows account.`
           : `On ${kidName}'s ${formWord(form)}, open Screen Time and tap Scan QR code, or type the code.`}
       </DialogDescription>
       {form !== 'pc' && (
```

## 6. Detailed spec

Nothing beyond section 5. `docs/SPEC.md` already describes this.

## 7. Steps

1. Start the branch (section 10).
2. Make the files of 5.1 and the changes of 5.2.
3. Run section 8.1 until it passes.
4. Run section 8.2 and keep all its output.
5. Push, open the PR, wait for CI, and send the handback (sections 10 and 12).

## 8. Acceptance criteria

### 8.1 Build and tests

From the repo root, in `pwsh`:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
docker exec screentime-db-1 psql -U screentime -d postgres -c "create database screentime_test"
$pw = (Select-String -Path deploy\.env -Pattern '^POSTGRES_PASSWORD=(.*)').Matches[0].Groups[1].Value
$env:TEST_DATABASE_URL = "postgres://screentime:$pw@localhost:5432/screentime_test"
pnpm test
Remove-Item Env:TEST_DATABASE_URL
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug test
.\gradlew.bat --stop
cd ..
git grep -l 'Â' -- docs/guides web/src/components/add-device-dialog.tsx
```

- [ ] `pnpm typecheck` and `pnpm build` pass. An error that `screentime_test` already exists is fine.
- [ ] `pnpm test` passes. In the rehearsal: engine 27, schemas 36, web 69, server 268.
- [ ] `.\gradlew.bat assembleDebug test` says `BUILD SUCCESSFUL`.
- [ ] The last `git grep` prints nothing. If it prints a file, you saved it in the wrong encoding.

### 8.2 The run

Close Android Studio's emulator if one is open. From the repo root, keeping all the output (about 8 minutes):

```powershell
pwsh -File docs\cards\CARD-054-run.ps1 *> ..\temp\card054-bob-out.txt
Get-Content ..\temp\card054-bob-out.txt
git status --short
```

It checks that what the guides name is in the code, builds both release apps with a throwaway key in the temp folder, then on a wiped emulator does the guide's release commands and opens both apps. It does not pair, so it needs no server.

- [ ] The last line is `--- Finished with 0 failed.` and no line starts with `FAIL`. In the rehearsal: 57 `PASS` lines.
- [ ] Both signer lines say `CN=Screen Time`.
- [ ] The kid app's line shows `Server: screentime.gallagherhome.au` and the parent app's line shows `Parent sign-in`.
- [ ] `..\temp\card054-parent.png` exists and shows the parent sign-in screen.
- [ ] `git status --short` lists only this card's files, with no keystore.
- [ ] CI is green.

## 9. Tests

No new tests: this card has no new logic. `CARD-054-run.ps1` is the check.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-054-guides
   ```
2. Commit in small logical commits. Message format: `CARD-054: <what changed>`.
3. Before pushing, run section 8.1 again and make sure it passes.
4. Push: `git push -u origin bob/card-054-guides`
5. Open a PR into `main` titled `CARD-054: Guides for Android and Windows` with this body, written to a file in `C:\Users\james\OpenCode\Testing\temp\`:
   ```markdown
   ## Card
   docs/cards/CARD-054-guides.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] criterion 1 — output: `...`

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace, and every workaround (a restart, a retry). If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-054. Please review and merge if it is good.

CARD: CARD-054 Guides for Android and Windows
PR: <full PR URL>
Branch: bob/card-054-guides
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- pnpm typecheck -> <key lines, or NOT RUN: reason>
- pnpm test -> <test counts per package, or NOT RUN: reason>
- .\gradlew.bat assembleDebug test -> <result, or NOT RUN: reason>
- git grep for mangled characters -> <output, or NOT RUN: reason>
- pwsh -File docs\cards\CARD-054-run.ps1 -> <ALL of ..\temp\card054-bob-out.txt, or NOT RUN: reason>
- The screenshot -> <what it shows, or NOT RUN: reason>
- git status --short -> <output, or NOT RUN: reason>
- CI -> <every check and its result, or NOT RUN: reason>

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
