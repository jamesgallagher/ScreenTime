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
