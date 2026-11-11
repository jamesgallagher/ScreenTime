# ScreenTime.Installer

The WiX MSI (CARD-052). Build it with windows/installer/build-msi.ps1, or take it from CI's "installer" job (artifact ScreenTime-msi). Try it only in Windows Sandbox: windows/installer/sandbox/Test-Installer.ps1 (silent install, the service and the tray) and Test-InstallerUi.ps1 (the pages a parent clicks through, with pictures).

Package.wxs is what gets installed. UI.wxs and Strings.wxl are the pages (WixToolset.UI.wixext): Welcome, Ready, progress, and "Screen Time is installed" with "Open Screen Time Setup now". dialog.bmp and banner.bmp come from make-bitmaps.ps1.
