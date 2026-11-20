---
name: sandbox-run
description: How to run a Windows end-to-end check of the Screen Time service and tray in Windows Sandbox, never on James's desktop. Use when a card's checks need the Windows service, the tray, a desktop or the MSI.
---

# A run in Windows Sandbox

Never open, focus or close programs on James's own desktop, and never `Stop-Process` by name on his PC. Anything that needs a Windows desktop runs in Windows Sandbox (turned on; Docker Desktop must be running for the dev server).

**Copy the pair the card names** (usually `windows/installer/sandbox/Test-TrayExit.ps1` and `in-sandbox-trayexit.ps1`):

- **Host script** `Test-<Name>.ps1 -Msi <path>`: makes a work folder `C:\Users\james\OpenCode\Testing\temp\sandbox-<name>-<time>` with `in` (read-only: the MSI, the in-sandbox script, codes) and `out` (results); resets the dev server (`docker compose … down -v`, `up -d --build --wait`, `seed-dev.ts`); makes a PC enrolment code with `server/scripts/dev-enrol-code.ts Sam pc`; writes a `.wsb` with the mapped folders and a `LogonCommand`; starts it; waits for the results; prints `out\results.txt` and whatever it checks on the server (for example `server/scripts/dev-report.ts`).
- **In-sandbox script** `in-sandbox-<name>.ps1` (runs at logon as `WDAGUtilityAccount`, an administrator): `msiexec /i C:\in\ScreenTime.msi /qn`; enrol with `ScreenTime.Service.exe enrol --server http://<gateway>:8080 --code <code> --user $env:USERNAME` (the gateway is the host); point the service at its own session with `--session <id> --dry-lock` in its `ImagePath` and restart it (the Sandbox has no console session); wait for `ScreenTime.Tray`; do the steps; write every line to `C:\out\results.txt`; shut the Sandbox down at the end.

**The MSI comes from CI** (native AOT needs C++ tools this PC lacks):

```powershell
$run = (gh run list --branch <your branch> --workflow Windows --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download $run --name ScreenTime-msi --dir C:\Users\james\OpenCode\Testing\temp\msi-$run
```

**Facts about the Sandbox:** no Store apps (no Calculator, and Notepad does not start; classic programs such as `charmap.exe` and `winver.exe` work); a program a script starts may not get the front window, so check `GetForegroundWindow` before timing; the service writes only warnings and errors to the Application event log (its information lines never appear there), so check results on the server, not in the log; `MinimizeAll` does not minimise dialog windows, so close programs by the id you started instead; `Microsoft-Windows-Security-SPP` errors are harmless; there is no real lock.

Each check prints `ok: …` or `FAILED: …` and the last line is `=== done: <n> failed`. Lines start with the time, so the host matches `=== done:` anywhere in a line, never `^=== done:`. Instead of fixed waits, let the host poll the server (`dev-report.ts`) and tell the Sandbox when to stop by writing a file into the read-only `in` folder. Reuse the downloaded MSI when nothing under `windows/src` changed. Paste the whole `results.txt` and the host output into the handback.
