# CARD-052b: Windows: the setup window, wired and tried in Windows Sandbox

| Field | Value |
|---|---|
| Card | CARD-052b |
| Title | Windows: the setup window, wired and tried in Windows Sandbox |
| Size | L (one whole feature) |
| Depends on | CARD-052 (PR #148) and the setup window's front end (PR #149, by Claude), both merged to `main` |
| Spec sections | docs/SPEC.md §12.2 (install), §11.3 (enrolment) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-052b-setup` |
| PR title | `CARD-052b: Windows: the setup window, wired and tried in Windows Sandbox` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

`AGENTS.md` rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command and every run step** and lists every workaround. Rule 10: never change Claude's front-end files, **except the one change section 6.4 gives you, exactly**.

**Use PowerShell 7 (`pwsh`) for every command in this card, never Windows PowerShell 5.1** (`powershell.exe`). Check with `$PSVersionTable.PSVersion` (7.x). On CARD-052, 5.1 broke two things: a script that redirects a program's errors (`2>&1`) stopped at the first one, and files written from 5.1 had `§` turned into `Â§`. Write every file as **UTF-8 without BOM** (the editor's file tools do; avoid `Set-Content`/`Out-File` in 5.1). 8.1 checks for `Â`.

After CARD-052 the MSI installs the service and the tray, but enrolling a kid's account still needs a command line (`ScreenTime.Service.exe enrol --server … --code … --user …`). §12.2 says: "The installer asks for the server hostname, then lists local standard accounts; for each kid account the parent enters an enrolment code." This card does that with a **setup window**:

- It lives in the tray program: `Tray\ScreenTime.Tray.exe --setup` (no second copy of the WinUI runtime in the MSI). The MSI adds a Start menu shortcut **Screen Time Setup** that runs it.
- **Claude built the window** (PR #149): `windows/src/ScreenTime.Tray/Setup/SetupWindow.xaml(.cs)`, `ISetupBackend.cs` (the seam) and `DemoSetupBackend.cs`. Step 1 is the server address and **Check**; step 2 lists the PC's accounts once the server answers: a standard account takes a 6-digit code and **Connect**, an enrolled one shows "✓ Limited as Sam", an administrator shows "A parent: never limited". **Finish** restarts the service. `ScreenTime.Tray.exe --setup --demo` shows it with a fake backend, if you want to look (it changes nothing).
- **You write the real backend** (`SetupBackend`, section 6.2), the rules behind it in Core with copied tests (6.1), the elevation, and the shortcut.

How the backend works:

- **Server check:** `GET <server>/health` must answer 200 with `"service":"screentime-server"`.
- **Accounts:** the PC's local accounts (`System.DirectoryServices.AccountManagement`), enabled ones only, without Windows' built-in ones (Administrator, Guest, DefaultAccount, WDAGUtilityAccount: their SIDs end in 500, 501, 503, 504). Members of Administrators are parents. The kid of each enrolled account comes from the service's `C:\ProgramData\ScreenTime\state.db`.
- **Enrol:** runs the installed `ScreenTime.Service.exe enrol --server <address> --code <code> --user <account>` (the same command CARD-047 made and CARD-052 tried in Sandbox) and reads what it prints. Errors become short sentences, never codes.
- **Finish:** stops and starts the `ScreenTime` service, so it reads the new server and accounts (it reads `config.json` only at start).
- **Elevation:** all of this needs an administrator. When `--setup` starts unelevated (a parent opening the Start menu shortcut), it starts itself again with Windows' "run as administrator" prompt (UAC) and exits. A kid cannot get past that prompt.

**Tried in Windows Sandbox**, like CARD-052: never install the MSI on James's PC. Two copied scripts do the whole run with no clicking: they make a kid account (`sam`) and a parent account (`parent`, administrator) in the Sandbox, install the MSI, open Screen Time Setup from its shortcut and drive the window through UI Automation (the AutomationIds Claude's window has), then uninstall. The host side prints what the server has for Sam at the end.

Claude has done all of this once with a scratch build. The rehearsal found and fixed two things that are already in this card: WiX's checks ICE38, ICE43 and ICE57 refuse a Start menu shortcut in a per-machine package unless they are suppressed (6.6), and `net user` stops to ask a question when a password is longer than 14 characters (the script's passwords are shorter).

## 2. Goal

- CI on the PR is green for **Windows / build and test** and **Windows / installer**.
- `dotnet build` (0 warnings) and `dotnet test` in `windows/` pass: **total 270** (246 before, 24 new in `SetupRulesTests`).
- The Sandbox run of `Test-Setup.ps1` (8.3) shows: the shortcut; the window opens; a wrong address gets a sentence; the server answers; the accounts (`parent` a parent, `sam` a code box, no built-in account); a wrong code gets a sentence; Sam's code enrols; Finish restarts the service and saves the server; the window opened again remembers the server and Sam; uninstall removes the shortcut; the server has Sam's PC.
- CARD-052's Sandbox run (`Test-Installer.ps1`) still passes with the new MSI.

## 3. Out of scope

- Any other change to Claude's front-end files (`windows/src/ScreenTime.Tray/Setup/SetupWindow.xaml`, `SetupWindow.xaml.cs`, `ISetupBackend.cs`, `DemoSetupBackend.cs`, and the rest of `ScreenTime.Tray`). Section 6.4 is the one allowed change to `App.xaml.cs`. If the window seems wrong, write it under "Blockers / questions".
- Any change to the service (`ScreenTime.Service`), `build-msi.ps1`, the CI workflow, CARD-052's two Sandbox scripts, or the server.
- Removing an enrolled account, renaming devices, or launching Setup at the end of the MSI: not in this card.
- **Never run the MSI, `msiexec`, `ScreenTime.Tray.exe --setup` (without `--demo`), or the installed service on James's PC.** They install a service and need an administrator: they run only inside Windows Sandbox (8.3).

## 4. Tech

- .NET 10, C# as in the rest of `windows/`. Two new packages in the tray only: `System.DirectoryServices.AccountManagement` 10.0.13 (local accounts and the Administrators group) and `System.ServiceProcess.ServiceController` 10.0.13 (restarting the service). Both are Windows-only and fine in the tray, which is self-contained and not trimmed. The service stays as it is (native AOT, no new packages).
- WiX Toolset 5 (`WixToolset.Sdk/5.0.2`), as CARD-052.
- The Sandbox scripts run in Windows PowerShell 5.1 **inside** the Sandbox (that is all a fresh Windows has); the host script checks it runs in `pwsh` 7.
- UI Automation (`UIAutomationClient`) finds the window by its title "Screen Time setup" and the controls by AutomationId: `ServerBox`, `CheckButton`, `ServerStatus`, `Code_<user>`, `Connect_<user>`, `State_<user>`, `Error_<user>`, `FinishButton`, `FinishStatus`.

## 5. Files to copy

Copy each file exactly, byte for byte. 8.1 checks the fingerprints. They are the check: never change them.

### 5.1 `windows/installer/sandbox/in-sandbox-setup.ps1`

Runs inside the Sandbox at logon.

```powershell
# CARD-052b: runs inside Windows Sandbox at logon (as its administrator, WDAGUtilityAccount). Makes a kid account (sam,
# standard) and a parent account (parent, administrator), installs the MSI from C:\in, opens "Screen Time Setup" the
# way the Start menu does and drives it through UI Automation: a wrong address, the server, the accounts, a wrong code,
# Sam's code, Finish, and the window again. Then it uninstalls and shuts the Sandbox down. Everything it sees goes to
# C:\out\results.txt.
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results $text -Encoding UTF8 }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
function Window { $A::RootElement.FindFirst("Children", (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, "Screen Time setup"))) }
function El([string]$id) {
  $w = Window
  if (-not $w) { return $null }
  $w.FindFirst("Descendants", (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, $id)))
}
function Text([string]$id) { $e = El $id; if ($e) { $e.Current.Name } else { "(none)" } }
function SetText([string]$id, [string]$value) { (El $id).GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($value); Start-Sleep -Milliseconds 500 }
function Press([string]$id) { (El $id).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
# Waits until the element's text passes the test (at most $seconds), and returns that text.
function WaitText([string]$id, [scriptblock]$done, [int]$seconds = 60) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    $t = Text $id
    if (& $done $t) { return $t }
    Start-Sleep -Milliseconds 500
  }
  "(timed out) $t"
}
function Rows {
  foreach ($e in (Window).FindAll("Descendants", [System.Windows.Automation.Condition]::TrueCondition)) {
    $id = $e.Current.AutomationId
    if ($id -like "State_*") { Say "  $($id.Substring(6)): $($e.Current.Name)" }
    if ($id -like "Code_*") { Say "  $($id.Substring(5)): a code box" }
  }
}

Set-Content $results "sandbox run at $(Get-Date -Format o) as $(whoami)" -Encoding UTF8
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop

Say "=== 1. two accounts, and the install"
foreach ($line in @(net user sam "Kid-pass-52b!" /add 2>&1) + @(net user parent "Parent-52b!" /add 2>&1) + @(net localgroup Administrators parent /add 2>&1)) { if ("$line".Trim()) { Say "  net: $line" } }
Say "  administrators: $((net localgroup Administrators | Select-Object -Skip 6 | Where-Object { $_ -and $_ -notlike 'The command*' }) -join ', ')"
$code = (Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru).ExitCode
Say "  msiexec install exit $code"
$lnk = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Screen Time Setup.lnk"
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
Say "  shortcut: $(Test-Path $lnk), $($shortcut.TargetPath) $($shortcut.Arguments)"

Say "=== 2. open Screen Time Setup"
Start-Process $shortcut.TargetPath -ArgumentList $shortcut.Arguments
for ($i = 0; $i -lt 60 -and -not (Window); $i++) { Start-Sleep 1 }
Say "  window: $(if (Window) { 'open' } else { 'never opened' })"
Say "  server box: '$((El 'ServerBox').GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value)'"
Say "  Finish enabled: $((El 'FinishButton').Current.IsEnabled)"

Say "=== 3. a wrong address, then the server"
SetText "ServerBox" "http://${gateway}:9"
Press "CheckButton"
Say "  :9 -> $(WaitText 'ServerStatus' { param($t) $t -notlike 'Checking*' -and $t -notlike 'The address*' })"
SetText "ServerBox" "http://${gateway}:8080"
Press "CheckButton"
Say "  :8080 -> $(WaitText 'ServerStatus' { param($t) $t -notlike 'Checking*' -and $t -notlike 'Press Check*' })"

Say "=== 4. the accounts"
Start-Sleep 2
Rows

Say "=== 5. a wrong code, then Sam's code"
SetText "Code_sam" "000000"
Press "Connect_sam"
Say "  000000 -> $(WaitText 'Error_sam' { param($t) $t -ne '' -and $t -ne '(none)' })"
$enrolCode = (Get-Content C:\in\code.txt).Trim()
SetText "Code_sam" $enrolCode
Press "Connect_sam"
Say "  Sam's code -> $(WaitText 'State_sam' { param($t) $t -ne '(none)' })"
Say "  Finish enabled: $((El 'FinishButton').Current.IsEnabled)"

Say "=== 6. Finish"
$before = (Get-CimInstance Win32_Service -Filter "Name = 'ScreenTime'").ProcessId
Press "FinishButton"
Say "  $(WaitText 'FinishStatus' { param($t) $t -notlike 'Starting*' -and $t -notlike 'The limits*' })"
$after = (Get-CimInstance Win32_Service -Filter "Name = 'ScreenTime'")
Say "  service: $($after.State), restarted: $($after.ProcessId -ne $before)"
Say "  config.json: $((Get-Content C:\ProgramData\ScreenTime\config.json -Raw).Trim())"
Say "  button: $((El 'FinishButton').Current.Name)"
Press "FinishButton"
for ($i = 0; $i -lt 20 -and (Window); $i++) { Start-Sleep 1 }
Say "  window closed: $(-not (Window))"

Say "=== 7. open it again"
Start-Process $shortcut.TargetPath -ArgumentList $shortcut.Arguments
for ($i = 0; $i -lt 60 -and -not (Window); $i++) { Start-Sleep 1 }
Say "  server box: '$((El 'ServerBox').GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value)'"
Say "  $(WaitText 'ServerStatus' { param($t) $t -notlike 'Checking*' -and $t -notlike 'The address*' })"
Start-Sleep 2
Rows
(Window).GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
Start-Sleep 2
Say "  window closed: $(-not (Window))"
foreach ($e in (Get-WinEvent -FilterHashtable @{ LogName = "Application"; Level = 1, 2 } -MaxEvents 5 -ErrorAction SilentlyContinue)) {
  $text = $e.Message -replace '\s+', ' '
  if ($e.ProviderName -ne "Microsoft-Windows-Security-SPP") { Say "  error event: $($e.ProviderName): $($text.Substring(0, [Math]::Min(300, $text.Length)))" }
}

Say "=== 8. uninstall"
$code = (Start-Process msiexec.exe -ArgumentList @("/x", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\uninstall.log") -Wait -PassThru).ExitCode
Say "  msiexec uninstall exit $code"
Say "  shortcut still there: $(Test-Path $lnk)"
Say "  files still there: $(Test-Path 'C:\Program Files\ScreenTime')"
Say "done"
Stop-Computer -Force
```

### 5.2 `windows/installer/sandbox/Test-Setup.ps1`

Runs on James's PC, from the repo root.

```powershell
# CARD-052b: tries the setup window in Windows Sandbox (docs/BUILD-PLAN.md: admin-level runs never happen on James's PC).
# Run from the repo root in PowerShell 7 (pwsh), with Docker Desktop running and Windows Sandbox turned on:
#   pwsh -File windows\installer\sandbox\Test-Setup.ps1 -Msi <path to ScreenTime.msi>
# It resets the local dev server, makes Sam's enrolment code for a PC, starts the Sandbox (which runs
# in-sandbox-setup.ps1 at logon), prints what the Sandbox saw, then what the server has for Sam.
param([Parameter(Mandatory)][string]$Msi)
$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -lt 7) { throw "Run this with pwsh (PowerShell 7), not Windows PowerShell 5.1." }
$here = $PSScriptRoot
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null
Copy-Item $Msi (Join-Path $in "ScreenTime.msi")
Copy-Item (Join-Path $here "in-sandbox-setup.ps1") $in

"--- the dev server"
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v 2>&1 | Out-Null
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait 2>&1 | Select-Object -Last 1
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
$code = (pnpm --silent --filter @screentime/server exec tsx scripts/dev-enrol-code.ts Sam pc | Select-String '\d{6}').Matches[0].Value
Set-Content (Join-Path $in "code.txt") $code

$wsb = Join-Path $work "run.wsb"
Set-Content $wsb @"
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox-setup.ps1</Command></LogonCommand>
</Configuration>
"@
"--- the Sandbox (a window opens and closes by itself; do not use it)"
Start-Process $wsb
$results = Join-Path $out "results.txt"
$waited = 0
while (-not ((Test-Path $results) -and (Select-String -Path $results -Pattern "^done" -Quiet)) -and $waited -lt 600) { Start-Sleep 5; $waited += 5 }
"--- what the Sandbox saw"
Get-Content $results
"--- what the server has for Sam"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U screentime -d screentime -A -t -c "select d.name || ' | ' || d.form || ' | ' || d.windows_user_name || ' | revoked: ' || (d.revoked_at is not null) from devices d join kids k on k.id = d.kid_id where k.name = 'Sam' order by d.enrolled_at"
"--- (full logs in $out)"
```

### 5.3 `windows/tests/ScreenTime.Core.Tests/SetupRulesTests.cs`

```csharp
using ScreenTime.Core.Setup;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-052b: the rules behind the setup window. Copied verbatim from the card.</summary>
public sealed class SetupRulesTests
{
    private const string Pc = "S-1-5-21-1111111111-2222222222-3333333333";

    [Fact]
    public void TheListSkipsDisabledAndBuiltInAccountsAndSortsByName()
    {
        var accounts = new[]
        {
            new LocalAccount("sam", "", $"{Pc}-1002", true, false),
            new LocalAccount("Administrator", "", $"{Pc}-500", false, true),
            new LocalAccount("Guest", "", $"{Pc}-501", false, false),
            new LocalAccount("DefaultAccount", "", $"{Pc}-503", false, false),
            new LocalAccount("WDAGUtilityAccount", "", $"{Pc}-504", true, true),
            new LocalAccount("Alex", " Alex Gallagher ", $"{Pc}-1003", true, false),
            new LocalAccount("old", "", $"{Pc}-1004", false, false),
            new LocalAccount("james", "James Gallagher", $"{Pc}-1001", true, true),
        };

        var picked = SetupRules.Accounts(accounts, new Dictionary<string, string>());

        Assert.Equal(
            [
                new PickedAccount("Alex", "Alex Gallagher", false, null),
                new PickedAccount("james", "James Gallagher", true, null),
                new PickedAccount("sam", "", false, null),
            ],
            picked);
    }

    [Fact]
    public void AnEnrolledStandardAccountShowsItsKidButAnAdministratorNever()
    {
        var accounts = new[]
        {
            new LocalAccount("sam", "", $"{Pc}-1002", true, false),
            new LocalAccount("james", "", $"{Pc}-1001", true, true),
        };
        var kids = new Dictionary<string, string> { [$"{Pc}-1002"] = "Sam", [$"{Pc}-1001"] = "Alex" };

        var picked = SetupRules.Accounts(accounts, kids);

        Assert.Equal("Sam", picked.Single(a => a.UserName == "sam").KidName);
        Assert.Null(picked.Single(a => a.UserName == "james").KidName);
    }

    [Theory]
    [InlineData("S-1-5-21-1-2-3-500", true)]
    [InlineData("S-1-5-21-1-2-3-504", true)]
    [InlineData("S-1-5-21-1-2-3-1500", false)]
    [InlineData("S-1-5-21-1-2-3-1001", false)]
    public void BuiltInAccountsAreKnownByTheLastPartOfTheirSid(string sid, bool builtIn) =>
        Assert.Equal(builtIn, SetupRules.IsBuiltIn(sid));

    [Theory]
    [InlineData("screentime.gallagherhome.au", "https://screentime.gallagherhome.au/")]
    [InlineData(" https://screentime.gallagherhome.au/v1 ", "https://screentime.gallagherhome.au/")]
    [InlineData("http://172.18.0.1:8080", "http://172.18.0.1:8080/")]
    [InlineData("ftp://example.com", null)]
    [InlineData("not an address", null)]
    public void TheAddressAsTypedBecomesTheServerUrl(string typed, string? url) =>
        Assert.Equal(url, SetupRules.ServerUrl(typed));

    [Theory]
    [InlineData("https://screentime.gallagherhome.au/", "screentime.gallagherhome.au")]
    [InlineData("http://172.18.0.1:8080/", "http://172.18.0.1:8080")]
    public void ASavedUrlShowsWithoutHttpsAndTheLastSlash(string url, string shown) =>
        Assert.Equal(shown, SetupRules.ShowServer(url));

    [Fact]
    public void OnlyAScreenTimeHealthAnswerIsAServer()
    {
        Assert.Null(SetupRules.HealthError(200, """{"status":"ok","service":"screentime-server","time":"2026-11-04T06:00:00.000Z"}"""));
        Assert.Equal(SetupRules.NoAnswer, SetupRules.HealthError(null, null));
        Assert.Equal(SetupRules.NotScreenTime, SetupRules.HealthError(200, "<html>Unraid</html>"));
        Assert.Equal(SetupRules.NotScreenTime, SetupRules.HealthError(404, null));
        Assert.Equal(SetupRules.NotScreenTime, SetupRules.HealthError(502, "Bad gateway"));
    }

    [Fact]
    public void TheEnrolCommandsSuccessLineGivesTheKid()
    {
        var output = "Enrolled sam as Sam (device 01a1a522-79d3-7961-ae3a-c21c8b68f5e1).\n";
        Assert.Equal(new EnrolOutcome("Sam", null), SetupRules.ParseEnrol("sam", 0, output));
        // A kid's name can have spaces and brackets; only the last "(device" ends it.
        var odd = "Enrolled kim lee as Kim (the Great) (device 01a1a522-79d3-7961-ae3a-c21c8b68f5e1).\r\n";
        Assert.Equal(new EnrolOutcome("Kim (the Great)", null), SetupRules.ParseEnrol("kim lee", 0, odd));
    }

    [Fact]
    public void AFailedEnrolmentGivesTheServersStatusOrNoAnswer()
    {
        Assert.Equal(new EnrolOutcome(null, 401), SetupRules.ParseEnrol("sam", 1, "Enrolment failed: 401 invalid_code The code is wrong or expired.\n"));
        Assert.Equal(new EnrolOutcome(null, 409), SetupRules.ParseEnrol("sam", 1, "Enrolment failed: 409 form_mismatch \n"));
        Assert.Equal(new EnrolOutcome(null, null), SetupRules.ParseEnrol("sam", 1, "No connection could be made because the target machine actively refused it. (172.18.0.1:8080)\n"));
        Assert.Equal(new EnrolOutcome(null, null), SetupRules.ParseEnrol("sam", 1, ""));
        // A success line for another account, or with a failing exit code, is not a success.
        Assert.Equal(new EnrolOutcome(null, null), SetupRules.ParseEnrol("sam", 0, "Enrolled alex as Alex (device x)."));
        Assert.Equal(new EnrolOutcome(null, null), SetupRules.ParseEnrol("sam", 1, "Enrolled sam as Sam (device x)."));
    }

    [Theory]
    [InlineData(null, SetupRules.Offline)]
    [InlineData(401, SetupRules.WrongCode)]
    [InlineData(404, SetupRules.WrongCode)]
    [InlineData(409, SetupRules.PhoneCode)]
    [InlineData(429, SetupRules.TooManyTries)]
    [InlineData(400, SetupRules.BadCode)]
    [InlineData(500, SetupRules.ServerProblem)]
    [InlineData(503, SetupRules.ServerProblem)]
    public void EveryFailureIsASentenceNeverACode(int? status, string sentence)
    {
        Assert.Equal(sentence, SetupRules.EnrolError(status));
        Assert.DoesNotMatch(@"\d{3}", SetupRules.EnrolError(status));
    }
}
```

## 6. What to write

Write these exactly as given (they are what Claude's rehearsal ran).

### 6.1 `windows/src/ScreenTime.Core/Setup/SetupRules.cs` (new)

```csharp
using ScreenTime.Core.Service;

namespace ScreenTime.Core.Setup;

/// <summary>One local account as Windows lists it (the setup window's raw input).</summary>
public sealed record LocalAccount(string UserName, string FullName, string Sid, bool Enabled, bool IsAdmin);

/// <summary>One account the setup window shows: <see cref="KidName"/> is the kid it is enrolled as on this PC, or null.</summary>
public sealed record PickedAccount(string UserName, string FullName, bool IsAdmin, string? KidName);

/// <summary>What <c>ScreenTime.Service.exe enrol</c> printed: the kid's name, or the server's HTTP status (null: no answer).</summary>
public sealed record EnrolOutcome(string? KidName, int? Status);

/// <summary>
/// The rules behind the setup window (docs/SPEC.md §12.2, §11.3): which accounts it lists, what the service's
/// <c>enrol</c> command printed, and the short sentences the parent sees. Errors are sentences, never codes.
/// </summary>
public static class SetupRules
{
    public const string NotAnAddress = "That doesn't look like a server address. Type it like screentime.example.com.";
    public const string NoAnswer = "Can't reach Screen Time at that address. Check it, and that this PC is online.";
    public const string NotScreenTime = "Something answered at that address, but it isn't Screen Time. Check the address.";
    public const string WrongCode = "That code is wrong or has expired. Make a new one in the parent app.";
    public const string PhoneCode = "That code is for a phone or tablet. In the parent app, choose PC.";
    public const string TooManyTries = "Too many tries. Wait 15 minutes, then try again.";
    public const string BadCode = "That code didn't work. Check the 6 digits.";
    public const string Offline = "Can't reach the server. Check this PC is online, then try again.";
    public const string ServerProblem = "The server had a problem. Try again in a minute.";
    public const string NotInstalled = "Screen Time isn't installed properly. Run the installer again.";
    public const string NoRestart = "Couldn't start the limits. Restart this PC to start them.";

    /// <summary>Windows' built-in accounts by their last SID part: Administrator, Guest, DefaultAccount, WDAGUtilityAccount.</summary>
    private static readonly HashSet<string> BuiltInRids = ["500", "501", "503", "504"];

    /// <summary>
    /// The accounts the window lists: enabled, not built in, by name (ignoring case). <paramref name="kidBySid"/> is
    /// this PC's enrolled devices (state.db); an administrator is a parent, so it never shows a kid.
    /// </summary>
    public static IReadOnlyList<PickedAccount> Accounts(IEnumerable<LocalAccount> accounts, IReadOnlyDictionary<string, string> kidBySid) =>
        accounts
            .Where(a => a.Enabled && !IsBuiltIn(a.Sid))
            .OrderBy(a => a.UserName, StringComparer.OrdinalIgnoreCase)
            .Select(a => new PickedAccount(a.UserName, a.FullName.Trim(), a.IsAdmin,
                a.IsAdmin ? null : kidBySid.GetValueOrDefault(a.Sid)))
            .ToList();

    /// <summary>Whether <paramref name="sid"/> is one of Windows' built-in accounts.</summary>
    public static bool IsBuiltIn(string sid) => BuiltInRids.Contains(sid[(sid.LastIndexOf('-') + 1)..]);

    /// <summary>
    /// The server URL for an address as typed (<see cref="ServiceFiles.NormaliseServerUrl"/>: no scheme means https),
    /// or null when it is not one.
    /// </summary>
    public static string? ServerUrl(string typed)
    {
        try
        {
            return ServiceFiles.NormaliseServerUrl(typed);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /// <summary>The address to show for a saved URL: https without its scheme, http with it, never the last slash.</summary>
    public static string ShowServer(string url)
    {
        var text = url.TrimEnd('/');
        return text.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? text["https://".Length..] : text;
    }

    /// <summary>
    /// What <c>GET /health</c> said: null when it is a Screen Time server, else a sentence. <paramref name="status"/>
    /// is null when nothing answered.
    /// </summary>
    public static string? HealthError(int? status, string? body) => status switch
    {
        null => NoAnswer,
        200 when body is not null && body.Contains("\"screentime-server\"") => null,
        _ => NotScreenTime,
    };

    /// <summary>
    /// Reads what <c>ScreenTime.Service.exe enrol --user <paramref name="user"/></c> printed (its output and errors
    /// together): "Enrolled &lt;user&gt; as &lt;kid&gt; (device &lt;id&gt;)." with exit 0, or "Enrolment failed: &lt;status&gt; …".
    /// Anything else (a network error) is no answer.
    /// </summary>
    public static EnrolOutcome ParseEnrol(string user, int exitCode, string output)
    {
        var lines = output.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        var prefix = $"Enrolled {user} as ";
        if (exitCode == 0)
        {
            foreach (var line in lines)
            {
                var at = line.LastIndexOf(" (device ", StringComparison.Ordinal);
                if (line.StartsWith(prefix, StringComparison.Ordinal) && at > prefix.Length && line.EndsWith(").", StringComparison.Ordinal))
                {
                    return new EnrolOutcome(line[prefix.Length..at], null);
                }
            }
        }
        foreach (var line in lines)
        {
            const string failed = "Enrolment failed: ";
            if (!line.StartsWith(failed, StringComparison.Ordinal)) continue;
            var number = line[failed.Length..].Split(' ')[0];
            if (int.TryParse(number, out var status)) return new EnrolOutcome(null, status);
        }
        return new EnrolOutcome(null, null);
    }

    /// <summary>The sentence for an enrolment that failed with <paramref name="status"/> (null: no answer).</summary>
    public static string EnrolError(int? status) => status switch
    {
        null => Offline,
        401 or 404 => WrongCode,
        409 => PhoneCode,
        429 => TooManyTries,
        400 => BadCode,
        _ => ServerProblem,
    };
}
```

### 6.2 `windows/src/ScreenTime.Tray/Setup/SetupBackend.cs` (new)

The real backend for Claude's window, and the elevation helper.

```csharp
using System.Diagnostics;
using System.DirectoryServices.AccountManagement;
using System.ServiceProcess;
using ScreenTime.Core.Service;
using ScreenTime.Core.Setup;
using ScreenTime.Core.Store;

namespace ScreenTime.Tray.Setup;

/// <summary>
/// The real <see cref="ISetupBackend"/> (CARD-052b). Runs elevated (App restarts <c>--setup</c> as administrator).
/// Reads the service's config.json and state.db in C:\ProgramData\ScreenTime, lists the local accounts, enrols by
/// running the installed <c>ScreenTime.Service.exe enrol</c> (one tested path, the same as the command line), and
/// restarts the service on Finish so it uses the new server and accounts.
/// </summary>
internal sealed class SetupBackend : ISetupBackend
{
    private const string ServiceName = "ScreenTime";
    private static readonly string DataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ScreenTime");
    // The tray is in Program Files\ScreenTime\Tray; the service is one folder up.
    private static readonly string ServiceExe = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "ScreenTime.Service.exe"));

    public string? SavedServer =>
        ServiceFiles.LoadConfig(Path.Combine(DataFolder, "config.json")) is { } config ? SetupRules.ShowServer(config.ServerUrl) : null;

    public async Task<string?> CheckServerAsync(string address)
    {
        if (SetupRules.ServerUrl(address) is not { } url) return SetupRules.NotAnAddress;
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        try
        {
            using var response = await http.GetAsync(new Uri(new Uri(url), "health"));
            return SetupRules.HealthError((int)response.StatusCode, await response.Content.ReadAsStringAsync());
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return SetupRules.HealthError(null, null);
        }
    }

    public Task<IReadOnlyList<SetupAccount>> AccountsAsync() => Task.Run(() =>
    {
        using var machine = new PrincipalContext(ContextType.Machine);
        using var admins = GroupPrincipal.FindByIdentity(machine, IdentityType.Sid, "S-1-5-32-544");
        var adminSids = admins?.GetMembers(false).Select(m => m.Sid?.Value).OfType<string>().ToHashSet() ?? [];
        using var search = new PrincipalSearcher(new UserPrincipal(machine));
        var local = search.FindAll().OfType<UserPrincipal>()
            .Where(u => u.Sid is not null)
            .Select(u => new LocalAccount(u.SamAccountName, u.DisplayName ?? "", u.Sid.Value, u.Enabled ?? true, adminSids.Contains(u.Sid.Value)))
            .ToList();
        var picked = SetupRules.Accounts(local, KidsBySid());
        return (IReadOnlyList<SetupAccount>)picked.Select(a => new SetupAccount(a.UserName, a.FullName, a.IsAdmin, a.KidName)).ToList();
    });

    public async Task<EnrolAnswer> EnrolAsync(string address, string userName, string code)
    {
        var start = new ProcessStartInfo(ServiceExe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var arg in new[] { "enrol", "--server", address, "--code", code, "--user", userName }) start.ArgumentList.Add(arg);
        try
        {
            using var process = Process.Start(start)!;
            var output = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            var outcome = SetupRules.ParseEnrol(userName, process.ExitCode, await output + "\n" + await errors);
            return outcome.KidName is { } kid ? EnrolAnswer.Enrolled(kid) : EnrolAnswer.Failed(SetupRules.EnrolError(outcome.Status));
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return EnrolAnswer.Failed(SetupRules.NotInstalled);
        }
    }

    public Task<string?> FinishAsync() => Task.Run<string?>(() =>
    {
        try
        {
            using var service = new ServiceController(ServiceName);
            if (service.Status != ServiceControllerStatus.Stopped)
            {
                service.Stop();
                service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
            }
            service.Start();
            service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
            return null;
        }
        catch (Exception e) when (e is InvalidOperationException or System.ServiceProcess.TimeoutException)
        {
            return SetupRules.NoRestart;
        }
    });

    /// <summary>The kid each enrolled account is (state.db's devices), or none before the first enrolment.</summary>
    private static Dictionary<string, string> KidsBySid()
    {
        var path = Path.Combine(DataFolder, "state.db");
        if (!File.Exists(path)) return [];
        using var store = LocalStore.Open(path);
        return store.Devices().ToDictionary(d => d.Sid, d => d.KidName);
    }
}

/// <summary>The setup window changes the service, so it runs as an administrator (CARD-052b).</summary>
internal static class Elevation
{
    public static bool IsAdmin() =>
        new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent())
            .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);

    /// <summary>Starts this exe again with <c>--setup</c>, as administrator: Windows asks first (UAC). A "No" just ends it.</summary>
    public static void RestartAsAdmin()
    {
        try
        {
            Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "--setup") { UseShellExecute = true, Verb = "runas" });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // The parent (or a kid) said no, or could not give an administrator's password.
        }
    }
}
```

### 6.3 `windows/src/ScreenTime.Tray/ScreenTime.Tray.csproj` (changed)

Add two lines under the Windows App SDK package, so the item group reads:

```xml
    <ItemGroup>
        <PackageReference Include="Microsoft.WindowsAppSDK" Version="2.5.1" />
        <PackageReference Include="System.DirectoryServices.AccountManagement" Version="10.0.13" />
        <PackageReference Include="System.ServiceProcess.ServiceController" Version="10.0.13" />
    </ItemGroup>
```

### 6.4 `windows/src/ScreenTime.Tray/App.xaml.cs` (changed: the one allowed change to Claude's files)

In `OnLaunched`, inside `if (Array.IndexOf(argv, "--setup") >= 0)`, replace this one line:

```csharp
            ISetupBackend backend = demoAt >= 0 ? new DemoSetupBackend() : new NotWiredSetupBackend();
```

with:

```csharp
            if (demoAt < 0 && !Elevation.IsAdmin())
            {
                // From the Start menu a parent runs it unelevated: Windows asks for an administrator, then it starts again.
                Elevation.RestartAsAdmin();
                Exit();
                return;
            }
            ISetupBackend backend = demoAt >= 0 ? new DemoSetupBackend() : new SetupBackend();
```

Nothing else in `App.xaml.cs` changes. Leave `NotWiredSetupBackend` in `ISetupBackend.cs` as it is.

### 6.5 `windows/src/ScreenTime.Installer/Package.wxs` (changed)

Three changes.

1. The end of the comment at the top. Replace these two lines:
   ```xml
       removes all of it and gives the right back. Enrolling the kids' accounts is a separate step (the setup app, or
       "ScreenTime.Service.exe enrol").
   ```
   with:
   ```xml
       removes all of it and gives the right back. Enrolling the kids' accounts is a separate step: the Start menu's
       "Screen Time Setup" (the tray's setup window, CARD-052b), or "ScreenTime.Service.exe enrol".
   ```
2. In `<Feature Id="Main">`, after `<ComponentRef Id="SafeBoot" />`, add:
   ```xml
         <ComponentRef Id="SetupShortcut" />
   ```
3. After the `Tray` component group's closing `</ComponentGroup>` and its blank line, before the comment `<!-- The service also runs in Safe Mode (minimal and with networking). -->`, add (followed by a blank line):
   ```xml
       <!-- The setup window (CARD-052b): a parent opens it from the Start menu, and it asks Windows for an administrator. -->
       <StandardDirectory Id="ProgramMenuFolder" />
       <Component Id="SetupShortcut" Directory="ProgramMenuFolder">
         <Shortcut Id="SetupShortcut" Name="Screen Time Setup" Description="Connect this PC and the kids' accounts to Screen Time"
                   Target="[TRAYFOLDER]ScreenTime.Tray.exe" Arguments="--setup" WorkingDirectory="TRAYFOLDER" />
         <RegistryValue Root="HKLM" Key="Software\ScreenTime" Name="SetupShortcut" Type="integer" Value="1" KeyPath="yes" />
       </Component>
   ```

### 6.6 `windows/src/ScreenTime.Installer/ScreenTime.Installer.wixproj` (changed)

Replace the `SuppressIces` line:

```xml
        <SuppressIces>ICE03;ICE60</SuppressIces>
```

with (keep the ICE03/ICE60 comment line above it):

```xml
        <!-- ICE38, ICE43 and ICE57: they take the Start menu shortcut (CARD-052b) for a per-user one. The package is
             per-machine, so it goes to the all-users Start menu. -->
        <SuppressIces>ICE03;ICE60;ICE38;ICE43;ICE57</SuppressIces>
```

Without it the MSI build fails with `error WIX0204: ICE38: Component SetupShortcut installs to user profile` (and ICE43, ICE57).

## 7. Steps

1. In `pwsh`: `git checkout main`, `git pull origin main`, `git checkout -b bob/card-052b-setup`. Check that `windows/src/ScreenTime.Tray/Setup/ISetupBackend.cs` exists. If not, stop: PR #149 is not merged yet.
2. Copy the three files in section 5. Run the fingerprints (8.1) **once**.
3. Write 6.1 to 6.6.
4. From `windows\`: `dotnet build ScreenTime.slnx -c Release` (0 errors, 0 warnings) and the tests (total 270).
5. Optional, to find WiX mistakes before CI: `.\installer\build-msi.ps1 -NoAot` from `windows\` builds the MSI on this PC. Never install it here. (Its `out\` folder is ignored by git.)
6. Commit, push, open the PR (section 10). Wait for CI: **both** jobs green.
7. Download the MSI from the PR's CI run and do the two Sandbox runs (8.3), pasting every output.
8. Write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: three lines, each ending in `True`.
  ```powershell
  $root = (Get-Location).Path
  function Fp($f, $want) {
    $b = [IO.File]::ReadAllBytes("$root\windows\$f") | Where-Object { $_ -ne 13 }
    $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
    "$f $h $($h -eq $want)"
  }
  Fp "installer\sandbox\in-sandbox-setup.ps1" "5731e12e1cdce45f6f8c6bfb9413d7e5a8ee531d8df1817fbf88ba12d0e9be03"
  Fp "installer\sandbox\Test-Setup.ps1" "fe6ee84c78afba247e43266071e8156aa97a710ce89931912398acc2991d1421"
  Fp "tests\ScreenTime.Core.Tests\SetupRulesTests.cs" "1d2c53c080501c290a5c33e51a3986a654ef2fb3ac1b4f2ae115b70fb24815a4"
  ```
- [ ] From the repo root: `Select-String -Path (git diff --name-only main...HEAD) -Pattern 'Â'` prints nothing (no mangled characters).
- [ ] From `windows\`: `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] From `windows\`: `dotnet test --solution ScreenTime.slnx -c Release --no-build` → **total 270**, failed 0.

### 8.2 Repo and CI

- [ ] `git status` clean. No `windows\out\`, `bin\`, `obj\` or `*.msi` in the repo.
- [ ] CI green on the PR for **Windows / build and test** and **Windows / installer**. Paste `gh pr checks <your PR>`.
- [ ] `git diff --name-only main...HEAD` lists exactly these 9 files:
  ```
  windows/installer/sandbox/Test-Setup.ps1
  windows/installer/sandbox/in-sandbox-setup.ps1
  windows/src/ScreenTime.Core/Setup/SetupRules.cs
  windows/src/ScreenTime.Installer/Package.wxs
  windows/src/ScreenTime.Installer/ScreenTime.Installer.wixproj
  windows/src/ScreenTime.Tray/App.xaml.cs
  windows/src/ScreenTime.Tray/ScreenTime.Tray.csproj
  windows/src/ScreenTime.Tray/Setup/SetupBackend.cs
  windows/tests/ScreenTime.Core.Tests/SetupRulesTests.cs
  ```

### 8.3 The runs in Windows Sandbox (with the MSI built by CI)

Paste the **real output of every line**. Docker Desktop must be running; Windows Sandbox is turned on. Each run takes about 5 minutes; a Sandbox window opens and closes by itself: **do not click in it**. Nothing is installed on James's PC. Run them one after the other, never two at once (they share the dev server and the Sandbox).

1. Download the MSI from your PR's CI run:
   ```powershell
   $run = (gh run list --branch bob/card-052b-setup --workflow Windows --limit 1 --json databaseId --jq '.[0].databaseId')
   $msiDir = "C:\Users\james\OpenCode\Testing\temp\c52b-msi-$run"
   gh run download $run --name ScreenTime-msi --dir $msiDir
   Get-Item "$msiDir\ScreenTime.msi" | ForEach-Object { "$($_.Name) $([math]::Round($_.Length / 1MB)) MB" }
   ```
   Check that run is for your PR's latest commit: `gh run view $run --json headSha --jq .headSha` equals `git rev-parse HEAD`.
2. From the repo root, the setup run:
   ```powershell
   pwsh -File windows\installer\sandbox\Test-Setup.ps1 -Msi "$msiDir\ScreenTime.msi"
   ```
   Paste all of it, from `--- the dev server` to `--- (full logs in …)`.
3. From the repo root, CARD-052's run again with the new MSI (the tray still has to work with the new packages):
   ```powershell
   pwsh -File windows\installer\sandbox\Test-Installer.ps1 -Msi "$msiDir\ScreenTime.msi"
   ```
   Paste from `--- what the Sandbox saw` to `done`. Its lines must match CARD-052's table: `msiexec install exit 0`; `AUTO_START`, `LocalSystem`, `RUNNING`, restarts after 0, 5000, 30000 ms; both Safe Mode keys; the time zone right without `*S-1-5-32-545`; `enrol exit 0`; one tray in session 1 with `pipe: connected` and a `view:` line; `lock: dry run` lines; `msiexec uninstall exit 0` with nothing left. An `error event` from `Microsoft-Windows-Security-SPP` (Windows licensing) is harmless.

What Claude saw for step 2 (with a scratch build; ids, the gateway address and times differ):

```
--- the dev server
 Container screentime-api-1 Healthy 
Seeded family 01a1a54f-5775-7b45-af5c-ca3c798e8564 with parent dad@example.com and kids Alex and Sam.
--- the Sandbox (a window opens and closes by itself; do not use it)
--- what the Sandbox saw
sandbox run at 2026-11-04T17:46:57.0560353+11:00 as 232e5024-02e9-4\wdagutilityaccount
=== 1. two accounts, and the install
  net: The command completed successfully.
  net: The command completed successfully.
  net: The command completed successfully.
  administrators: Administrator, parent, WDAGUtilityAccount
  msiexec install exit 0
  shortcut: True, C:\Program Files\ScreenTime\Tray\ScreenTime.Tray.exe --setup
=== 2. open Screen Time Setup
  window: open
  server box: ''
  Finish enabled: False
=== 3. a wrong address, then the server
  :9 -> Can't reach Screen Time at that address. Check it, and that this PC is online.
  :8080 -> ✓ Screen Time answers at http://172.18.128.1:8080.
=== 4. the accounts
  parent: A parent: never limited
  sam: a code box
=== 5. a wrong code, then Sam's code
  000000 -> That code is wrong or has expired. Make a new one in the parent app.
  Sam's code -> ✓ Limited as Sam
  Finish enabled: True
=== 6. Finish
  ✓ Done. Screen Time limits Sam on this PC.
  service: Running, restarted: True
  config.json: {
  "serverUrl": "http://172.18.128.1:8080/"
}
  button: Close
  window closed: True
=== 7. open it again
  server box: 'http://172.18.128.1:8080'
  ✓ Screen Time answers at http://172.18.128.1:8080.
  parent: A parent: never limited
  sam: ✓ Limited as Sam
  window closed: True
=== 8. uninstall
  msiexec uninstall exit 0
  shortcut still there: False
  files still there: False
done
--- what the server has for Sam
sam on Virtual Machine | pc | sam | revoked: false
--- (full logs in C:\Users\james\OpenCode\Testing\temp\sandbox-20261104-174627\out)
```

Check these lines in your output:

| Step | Expect |
|---|---|
| 1 | three `net: The command completed successfully.`; `administrators:` lists `parent`; `msiexec install exit 0`; `shortcut: True, C:\Program Files\ScreenTime\Tray\ScreenTime.Tray.exe --setup` |
| 2 | `window: open`, `server box: ''`, `Finish enabled: False` |
| 3 | `:9 -> Can't reach Screen Time at that address. …`; `:8080 -> ✓ Screen Time answers at http://<gateway>:8080.` |
| 4 | `parent: A parent: never limited`, `sam: a code box`, and **no** `WDAGUtilityAccount`, `Administrator`, `Guest` or `DefaultAccount` line |
| 5 | `000000 -> That code is wrong or has expired. …`; `Sam's code -> ✓ Limited as Sam`; `Finish enabled: True` |
| 6 | `✓ Done. Screen Time limits Sam on this PC.`; `service: Running, restarted: True`; `"serverUrl": "http://<gateway>:8080/"`; `button: Close`; `window closed: True` |
| 7 | `server box: 'http://<gateway>:8080'`; `✓ Screen Time answers …`; `parent: A parent: never limited`; `sam: ✓ Limited as Sam`; `window closed: True`; no `error event` line |
| 8 | `msiexec uninstall exit 0`, `shortcut still there: False`, `files still there: False`, `done` |
| server | `sam on Virtual Machine \| pc \| sam \| revoked: false` |

Not covered by the Sandbox (its script already runs as administrator): the UAC prompt when Setup starts unelevated. James checks that on the first real PC (CARD-055).

## 9. Tests

`SetupRulesTests.cs` (copied, section 5.3): 24 tests for `SetupRules`. Which accounts are listed and in what order, built-in accounts by SID, an administrator never showing a kid; the address as typed to a server URL and back; the `/health` answer; the `enrol` command's success and failure lines; every failure a sentence without a status code. No other new tests: the window, the accounts, the service restart and the MSI are checked by the Sandbox run.

## 10. Git and pull request

1. Start from the latest `main` (in `pwsh`):
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-052b-setup
   ```
2. Commit with the message `CARD-052b: Windows: the setup window, wired and tried in Windows Sandbox`.
3. Before pushing, run every acceptance command in 8.1 again (except the fingerprints, run once).
4. Push: `git push -u origin bob/card-052b-setup`
5. Write the PR body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` and open the PR with `gh pr create --base main --title "CARD-052b: Windows: the setup window, wired and tried in Windows Sandbox" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body:
   ```markdown
   ## Card
   docs/cards/CARD-052b-setup.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] criterion 1 — output: `...`

   ## 8.3 Sandbox runs
   (the real output of both runs)

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
   Open the PR after CI can run (push first); add the 8.3 output to the body with `gh pr edit <PR> --body-file …` once the runs are done.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Never change a copied file or one of Claude's front-end files (other than 6.4).

- **A script stops at a `docker` line, or says "Run this with pwsh"**: you are in Windows PowerShell 5.1. Open `pwsh` and run it again. Not a deviation.
- **The `installer` CI job fails with `ICE38`/`ICE43`/`ICE57`**: 6.6 is missing or different. Compare it once.
- **The build says a type in `SetupBackend.cs` is not found** (`PrincipalContext`, `ServiceController`): 6.3 is missing.
- **Step 2 says `window: never opened`**: paste everything and the files in the `out` folder it names (`install.log`), and stop.
- **Step 4 lists no accounts, or step 5 times out**: paste everything and stop. Do not change the scripts or the window.
- **Never** run the MSI, `msiexec`, `--setup` without `--demo`, or the installed service on James's PC to get past a problem.

## 12. Handback report (required)

When the PR is open and the runs are done, your **last message to James** is the handback below, in one fenced code block; also save it as `C:\Users\james\OpenCode\Testing\temp\handback-card-052b.txt`. Write only what you actually saw. Paste the **whole** report.

Rules:

- Every command line shows the **real** output you saw. If you did not run a command, write `NOT RUN` and the reason.
- Paste the real output of **every** run step. A step without its pasted output counts as `NOT RUN`.
- Every workaround (restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card. "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-052b. Please review and merge if it is good.

CARD: CARD-052b Windows: the setup window, wired and tried in Windows Sandbox
PR: <full PR URL>
Branch: bob/card-052b-setup
Head commit: <output of `git rev-parse HEAD`>
CI run with the MSI: <run id>
Shell: <output of `$PSVersionTable.PSVersion`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>

Acceptance criteria:
- [x] <criterion> (ran it, output above)

8.3 step 2, Test-Setup.ps1 (real output, every line):
<paste>

8.3 step 3, Test-Installer.ps1 (real output, from "what the Sandbox saw" to "done"):
<paste>

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
