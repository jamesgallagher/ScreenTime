# CARD-055: Household rollout and acceptance

| Field | Value |
|---|---|
| Card | CARD-055 |
| Title | Household rollout and acceptance |
| Size | S |
| Depends on | Every earlier card |
| Spec sections | docs/SPEC.md, all; §2 for the devices |
| Done by | **James, with Claude. Not a card for Bob:** it needs the real devices, the real key and the family |
| Guides | `docs/guides/android-provisioning.md`, `docs/guides/windows-install.md`, `docs/guides/deploy.md` |

## 1. Project context

Everything so far has run on an emulator, in Windows Sandbox or in tests. This card puts Screen Time on the family's devices, one at a time, and checks what nothing else could. The guides hold the how; this card holds the order and the checks.

Write the result next to each step, and bring anything that goes wrong to Claude. A failure here is what this card is for.

## 2. Goal

Every device in §2 of the spec is set up from the guides and passes section 8. The first real update has reached one device and then all of them.

## 3. Out of scope

- Factory Reset Protection (not built: guide step 10).
- New features. Something that needs code becomes a new card.
- Nobody calls the real emergency number to test it. Check that the button opens the dialer with the number filled in, then hang up.

## 4. Before you start

- Tell the kids what is coming and when. Each Android device loses its Google account for a few minutes in the middle of setup.
- Write down each device's accounts and check the passwords are known before removing them.
- Tell both parents that the SOS test sends real texts and sets off the alarm.
- Do it on a day with time to spare, and one device at a time. **If a device fails a check, stop and sort it out before the next one.**

## 7. Steps

### Stage 1: the server

`ssh root@192.168.0.148`, or tell Claude to do it: Claude needs your go-ahead for each change to production.

- [ ] Bring the stack up to date with `docs/guides/deploy.md`, Kid app releases: the new `docker-compose.yml`, `mkdir -p releases`, pull and restart.
- [ ] `curl https://screentime.gallagherhome.au/health` says `ok`.
- [ ] The container sees the folder: `docker compose exec api ls -ld /releases`.
- [ ] Sign in to the web app. The family, its time zone and emergency number, and both kids are right. Each parent has a mobile number, or SOS texts will not reach them.
- [ ] A backup exists from last night, and one made now works: `docker compose exec backup sh /backup.sh now`.

### Stage 2: the release key

**Only you do this, so the password never passes through Claude.** Android guide step 1.

- [ ] The key is made, outside the repo.
- [ ] A copy is somewhere that is not this PC, and `keytool -list` accepts the password on the copy.
- [ ] The password is in your password manager.
- [ ] `android\keystore.properties` is written, and `git status` does not list it.
- [ ] `android\app-kid\google-services.json` and `android\app-parent\google-services.json` are there.

### Stage 3: the parents' phones

Android guide step 7. James's Pixel 10 first, then the Galaxy S23+.

- [ ] Each phone signs in with the emailed code.
- [ ] Notifications are allowed. On the Samsung, also turn off battery limits for ST Parent (Settings › Apps › ST Parent › Battery › Unrestricted), or alerts can arrive late.
- [ ] From the web app, start something that notifies a parent. **It arrives on both phones.** This is the first test of push on a release-signed build. If nothing comes, check the release key's SHA-1 against any restriction on the Firebase API key.

### Stage 4: the first kid device, the XPPen tablet

It has no SIM, so it is the simplest. Android guide steps 2 to 6 with a **release** build.

- [ ] Device Owner, usage access: the three check commands answer as the guide says. No call role on a tablet.
- [ ] Paired by QR code. It shows on the Devices panel with **Version 0.1.0**.
- [ ] USB debugging is now off: `adb devices` no longer lists it.
- [ ] Uninstalling is refused in Settings.
- [ ] Section 8.1 passes on this device.

Then leave it for a day before going on. It should count time, sync and stay Device Owner after a restart.

### Stage 5: the first real update, on the tablet

Android guide step 8. Raise `kidVersionCode` to `2` and `kidVersionName` to `0.1.1`.

- [ ] `pwsh -File android\publish-kid.ps1 -DeviceId <the tablet's id>` finishes. This is its first run over SSH.
- [ ] Leave the tablet on Wi-Fi with its screen off. Within about 6 hours the Devices panel says **Version 0.1.1**.
- [ ] Still Device Owner by behaviour: limits still apply and uninstalling is still refused. Usage access stayed, and blocked apps are still blocked.

If it passes, merge the version raise so `main` matches what is on the device.

### Stage 6: the Pixel 7

As stage 4, plus the call role (the guide's phone-only command).

- [ ] The three check commands answer as the guide says, with `au.screentime.kid` for the role.
- [ ] Section 8.1 and section 8.2 pass.
- [ ] `pwsh -File android\publish-kid.ps1` once, to every device. The Pixel, on `0.1.0`, moves to `0.1.1` by itself.

### Stage 7: the PCs

`docs/guides/windows-install.md`, the daughter's first, then the son's a day later.

- [ ] Each kid's account is **Standard**. The setup window does not say **A parent: never limited** beside it.
- [ ] Connected and showing on the Devices panel.
- [ ] The BIOS password is set and USB boot is off.
- [ ] Section 8.3 passes at the PC itself, not over Remote Desktop. **This is the first real lock:** Sandbox could only ever pretend.

### Stage 8: a week of normal use

- [ ] Devices stay online, and the Devices panel is right.
- [ ] Today's time is about what the kids really used, on each pool. The daughter's tablet and PC share Screens.
- [ ] Nothing is stuck locked or left unlocked.
- [ ] Anything odd is written down for Claude.

## 8. Acceptance checks

Do each on the device named in its stage. Set times so the test is short, and put them back afterwards.

### 8.1 Every Android device

- [ ] Time left on the device matches the parent app. It counts only with the screen on and unlocked.
- [ ] Both warnings come; at zero the block screen covers everything, and Home, Recents and the shade do nothing.
- [ ] **Ask for more time** reaches a parent, who says yes: the device unlocks within seconds.
- [ ] **Message** reaches a parent.
- [ ] **I'm the parent** with an approval, then again with **Enter parent code instead**: unlocked and not counting, and **End now** ends it.
- [ ] A new app from the real Play Store: the parents are told (the installer should be `com.android.vending`), and first use is reported.
- [ ] Block an app: it cannot open, and sound from it stops. Unblock it.
- [ ] A daily limit on one app: the warning, then the block at the limit.
- [ ] Turning usage access off in Settings tells the parents, and limited apps stay blocked. Turn it back on.
- [ ] Airplane mode, date and time, adding a user, safe mode and factory reset in Settings are refused.
- [ ] Offline for a while, then back online: the time catches up.
- [ ] After a restart the service is running and the limits still apply.

### 8.2 The phone with a SIM

- [ ] Blocked: a parent's call button rings them. A number not on the list is stopped.
- [ ] **Emergency** opens the dialer with the number filled in. **Hang up without calling.**
- [ ] SOS: hold for 2 seconds, then **Cancel** in the countdown. Nothing is sent.
- [ ] SOS again, with the family told first: both parents get the text with a location, the alarm over the lock screen and the email. **I'm on it** shows on the phone, and **I'm safe** ends it.
- [ ] Android's own Emergency SOS is on, with the parents as contacts.

### 8.3 Every PC

- [ ] The tray shows the time left when the kid signs in. It does not show on a parent's account.
- [ ] Time counts while signed in and unlocked, and stops when locked.
- [ ] Both warnings are toasts. At zero the PC **locks** and the kid is **not** signed out.
- [ ] Unlocked again while out of time: a toast, then it locks again within 10 seconds.
- [ ] **Ask** and **Message** from the tray reach a parent.
- [ ] A parent adds time or starts parent mode from the parent app: the kid can unlock.
- [ ] A standard account cannot change the time zone or stop the service.
- [ ] Ending the tray in Task Manager brings it back within seconds, and three times in 10 minutes tells the parents.
- [ ] After a restart the limits still apply.

## 11. If something is wrong

Stop at that device and leave the others as they are. To back out: Android guide step 9, or Windows guide, Removing it. Tell Claude the step, the device and what happened, with a photo if the screen matters.

## 12. Handback

There is no report from Bob. When a stage is done, tell Claude which boxes are ticked and what failed. Claude keeps the plan in step and writes a new card for anything that needs code.
