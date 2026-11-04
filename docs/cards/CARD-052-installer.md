# CARD-052: Windows: the installer, built in CI and tried in Windows Sandbox

| Field | Value |
|---|---|
| Card | CARD-052 |
| Title | Windows: the installer, built in CI and tried in Windows Sandbox |
| Size | L (one whole feature) |
| Depends on | CARD-051 and the tray's publish fix (PR #145, by Claude), both merged to `main` |
| Spec sections | docs/SPEC.md §12.2 (install, the service, hardening) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-052-installer` |
| PR title | `CARD-052: Windows: the installer, built in CI and tried in Windows Sandbox` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

`AGENTS.md` rule 8: temp files go in `C:\Users\james\OpenCode\Testing\temp\`. Rule 9: the handback has the **real output of every command and every run step** and lists every workaround. Rule 10: never change Claude's front-end files.

This card makes the **Windows installer**, an MSI that puts Screen Time on a kid's PC:

- **Files:** the service (`ScreenTime.Service.exe`, native AOT) and the tray (`Tray\ScreenTime.Tray.exe` and its files, self-contained) in `C:\Program Files\ScreenTime`.
- **The service:** registered as `ScreenTime`, automatic start, `LocalSystem`, restart on failure after 0, 5 and 30 seconds (reset after a day), and started at install.
- **Safe Mode:** the service also runs in Safe Mode (minimal and with networking).
- **Hardening:** kids may not change the time zone. **Correction to the spec:** Windows gives that right (`SeTimeZonePrivilege`) to the whole **Users** group, so it cannot be taken from kid accounts one by one, as §12.2 said. The installer takes it from **Users**; parents keep it, because they are Administrators. A new service command, `harden`, does it; uninstalling runs `unharden`, which gives it back.
- **Uninstall** removes all of it.

Enrolling the kids' accounts stays a separate step for now (`ScreenTime.Service.exe enrol`). The setup app that asks for the server and the codes is the next card (CARD-052b).

**Built in CI, tried in Windows Sandbox.** Native AOT needs the C++ build tools, which GitHub's Windows runners have and James's PC does not, so a new CI job `installer` builds the MSI and uploads it. And installing a real service, running it as LocalSystem and changing Windows security settings never happens on James's PC: it happens in **Windows Sandbox**, a throwaway Windows that James has turned on. Two scripts (copied from section 5) do the whole Sandbox run with no clicking; you download the MSI from your PR's CI run and give it to them.

Claude has done all of this once: the MSI built in CI installed, ran and uninstalled cleanly in Sandbox (section 8.3 shows the output). That rehearsal also found a bug, already fixed on `main` by Claude (PR #145): the published tray lacked its `.pri` file and crashed on a clean Windows.

## 2. Goal

- CI on the PR is green for **both** jobs: **Windows / build and test** and **Windows / installer**, which uploads the artifact `ScreenTime-msi`.
- `dotnet build` and `dotnet test` still pass in `windows/` (**total 246**: no new tests; the Sandbox run is the check).
- The Sandbox run in 8.3 shows: the install works; the service is automatic, LocalSystem, running, with the three restart delays; both Safe Mode keys; the time zone right taken from Users; enrolment works; the service starts the tray in the user's session, the tray connects and shows its view, and a lock is asked for; the uninstall removes everything and gives the right back.

## 3. Out of scope

- The setup app (asking for the server, listing accounts, entering codes): CARD-052b. Signing the MSI or the exe files.
- Any change to Claude's front-end files (`ScreenTime.Tray\*`, `Core\Tray\TrayStatus.cs`), to `ScreenTime.Core`, or to any test.
- **Never run `harden`, `unharden`, `msiexec` or the installed service on James's PC.** They change Windows security settings and install a service: they run only inside Windows Sandbox (8.3). `harden-check` is read-only but needs administrator rights, so it also only runs in Sandbox.
- Do not install the C++ build tools on James's PC.

## 4. Tech

- **WiX Toolset 5** (`WixToolset.Sdk/5.0.2`, a NuGet SDK that `dotnet build` restores; not WiX 6, which asks for a licence fee acceptance in every build). The WiX project is **not** in `ScreenTime.slnx`: `windows/installer/build-msi.ps1` builds it after publishing the service and the tray.
- In `Package.wxs`, `<Files Include="…\**">` takes every published file (WiX 5 feature). The tray goes in its own `Tray` folder: the service and the tray both carry SQLite files, so they cannot share a folder.
- The restart delays: MSI's own `ServiceConfigFailureActions` is refused by WiX (documented not to work), and WiX's `util:ServiceConfig` has one delay only, so a deferred custom action runs `sc.exe failure` as SYSTEM.
- ICE03 and ICE60 are suppressed: some Windows App SDK files list more languages in their version than MSI allows. Harmless.
- `Hardening.cs` calls the LSA API (`LsaOpenPolicy`, `LsaRemoveAccountRights`, `LsaAddAccountRights`, `LsaEnumerateAccountRights`) with `[LibraryImport]`, as everything in the service does (AOT).

## 5. Files to copy

Copy each file exactly, byte for byte. 8.1 checks the fingerprints. They are the check: never change them.

### 5.1 `windows/installer/sandbox/in-sandbox.ps1`

Runs inside the Sandbox at logon: installs the MSI, checks what it did, enrols, watches the service and the tray, uninstalls, checks it is all gone.

```powershell
# CARD-052: runs inside Windows Sandbox at logon (as its administrator, WDAGUtilityAccount). Installs the MSI from C:\in,
# checks what it did, enrols this account as the kid, watches the real service (as LocalSystem) start the tray in this
# session and ask it to lock (a dry run: the Sandbox has no console session, see step 5),
# uninstalls, checks it is all gone, and shuts the Sandbox down. Everything it sees goes to C:\out\results.txt.
$results = "C:\out\results.txt"
function Say([string]$text) { Add-Content $results $text }
function Run([string]$exe, [string[]]$arguments) {
  $p = Start-Process $exe -ArgumentList $arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput C:\out\cmd.txt -RedirectStandardError C:\out\cmd-err.txt
  foreach ($line in (Get-Content C:\out\cmd.txt, C:\out\cmd-err.txt -ErrorAction SilentlyContinue)) { if ($line.Trim()) { Say "  $($line.Trim())" } }
  $p.ExitCode
}
function TimeZoneRight { secedit /export /cfg C:\out\secpol.inf /areas USER_RIGHTS | Out-Null; (Get-Content C:\out\secpol.inf | Select-String "SeTimeZonePrivilege").Line }
$exe = "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
$trayLog = Join-Path $env:LOCALAPPDATA "ScreenTime\tray.log"

Set-Content $results "sandbox run at $(Get-Date -Format o) as $(whoami), session $((Get-Process -Id $PID).SessionId)"
Say "before: $(TimeZoneRight)"

Say "=== 1. install"
$code = (Start-Process msiexec.exe -ArgumentList @("/i", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\install.log") -Wait -PassThru).ExitCode
Say "msiexec install exit $code"
Say "files: $(Test-Path $exe) service, $(Test-Path 'C:\Program Files\ScreenTime\Tray\ScreenTime.Tray.exe') tray"

Say "=== 2. the service"
foreach ($line in (sc.exe qc ScreenTime | Select-String "START_TYPE|SERVICE_START_NAME|BINARY_PATH_NAME")) { Say "  $($line.Line.Trim())" }
foreach ($line in (sc.exe query ScreenTime | Select-String "STATE")) { Say "  $($line.Line.Trim())" }
foreach ($line in (sc.exe qfailure ScreenTime | Select-String "RESET_PERIOD|RESTART")) { Say "  $($line.Line.Trim())" }

Say "=== 3. Safe Mode"
foreach ($mode in "Minimal", "Network") {
  $value = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\$mode\ScreenTime" -ErrorAction SilentlyContinue).'(default)'
  Say "  $mode = $value"
}

Say "=== 4. the time zone right"
Say "  $(TimeZoneRight)"
$null = Run $exe @("harden-check")

Say "=== 5. enrol this account as Sam"
$gateway = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop
$enrolCode = (Get-Content C:\in\code.txt).Trim()
$exit = Run $exe @("enrol", "--server", "http://${gateway}:8080", "--code", $enrolCode, "--user", $env:USERNAME)
Say "  enrol exit $exit"
# The Sandbox has no console session (its desktop is a remote session), and the service only enforces the console.
# For this test the installed service gets --session <this session> --dry-lock, as the console runs do.
Add-Type -Namespace W -Name Ts -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();'
$session = (Get-Process -Id $PID).SessionId
Say "  console session: $([W.Ts]::WTSGetActiveConsoleSessionId()) (4294967295 = none); this session: $session"
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\ScreenTime"
Set-ItemProperty $serviceKey ImagePath "`"$exe`" --session $session --dry-lock"
Say "  service command: $((Get-ItemProperty $serviceKey).ImagePath)"
Restart-Service ScreenTime
Start-Sleep 30

Say "=== 6. the tray, started by the service"
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'ScreenTime.Tray.exe'")) {
  $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)"
  Say "  tray pid $($p.ProcessId), session $($p.SessionId), user $($owner.User), parent $($parent.Name), args: $($p.CommandLine -replace '^.*ScreenTime\.Tray\.exe""?\s*', '')"
}
foreach ($line in (Get-Content $trayLog -ErrorAction SilentlyContinue | Select-String "pipe: connected|view:" | Select-Object -First 3)) { Say "  $($line.Line)" }
Say "  pipes: $(([IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { $_ -like '*ScreenTime*' }) -join ', ')"
# A tray that crashes at start shows up here (CARD-052 found one: its .pri file was missing from the publish).
foreach ($e in (Get-WinEvent -FilterHashtable @{ LogName = "Application"; Level = 1, 2 } -MaxEvents 3 -ErrorAction SilentlyContinue)) {
  $text = $e.Message -replace '\s+', ' '
  Say "  error event: $($e.ProviderName): $($text.Substring(0, [Math]::Min(300, $text.Length)))"
}
Set-Content C:\out\ready.txt "ready"

Say "=== 7. out of time: the service asks the tray to lock (dry run in the Sandbox)"
$waited = 0
while (-not (Test-Path C:\in\granted.txt) -and $waited -lt 180) { Start-Sleep 2; $waited += 2 }
Say "  the host ran Sam out of time (waited $waited s)"
Start-Sleep 20
foreach ($line in (Get-Content $trayLog -ErrorAction SilentlyContinue | Select-String "view:|lock:" | Select-Object -Last 3)) { Say "  $($line.Line)" }

Copy-Item $trayLog C:out	ray.log -ErrorAction SilentlyContinue
Say "=== 8. uninstall"
Stop-Service ScreenTime -ErrorAction SilentlyContinue
Stop-Process -Name ScreenTime.Tray -Force -ErrorAction SilentlyContinue
$code = (Start-Process msiexec.exe -ArgumentList @("/x", "C:\in\ScreenTime.msi", "/qn", "/l*v", "C:\out\uninstall.log") -Wait -PassThru).ExitCode
Say "msiexec uninstall exit $code"
Say "  service still there: $([bool](Get-Service ScreenTime -ErrorAction SilentlyContinue))"
Say "  Safe Mode keys still there: $(Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\Minimal\ScreenTime') $(Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\Network\ScreenTime')"
Say "  files still there: $(Test-Path 'C:\Program Files\ScreenTime')"
Say "  $(TimeZoneRight)"
Say "done"
Stop-Computer -Force
```

### 5.2 `windows/installer/sandbox/Test-Installer.ps1`

Runs on James's PC: resets the local dev server, makes the enrolment code, starts the Sandbox, runs Sam out of time when the Sandbox is ready, and prints what the Sandbox saw.

```powershell
# CARD-052: tries the MSI in Windows Sandbox (docs/BUILD-PLAN.md: admin-level runs never happen on James's PC).
# Run from the repo root, with Docker Desktop running and Windows Sandbox turned on:
#   windows\installer\sandbox\Test-Installer.ps1 -Msi <path to ScreenTime.msi>
# It resets the local dev server, makes Sam's enrolment code, starts the Sandbox (which runs in-sandbox.ps1 at
# logon), runs Sam out of time when the Sandbox says it is ready, and prints what the Sandbox saw.
param([Parameter(Mandatory)][string]$Msi)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$work = "C:\Users\james\OpenCode\Testing\temp\sandbox-$(Get-Date -Format yyyyMMdd-HHmmss)"
$in = Join-Path $work "in"
$out = Join-Path $work "out"
New-Item -ItemType Directory -Force $in, $out | Out-Null
Copy-Item $Msi (Join-Path $in "ScreenTime.msi")
Copy-Item (Join-Path $here "in-sandbox.ps1") $in

"--- the dev server"
Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v 2>&1 | Out-Null
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait 2>&1 | Select-Object -Last 1
$env:DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime"
$env:JWT_SECRET = "local-dev-only-secret-at-least-32-characters"
pnpm --filter @screentime/server exec tsx scripts/seed-dev.ts dad@example.com
# Bedtime 2 hours from now with 25 minutes to use, so the PC starts unlocked whatever the time of day.
pnpm --silent --filter @screentime/server exec tsx scripts/dev-bedtime.ts Sam 120 25
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
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\in-sandbox.ps1</Command></LogonCommand>
</Configuration>
"@
"--- the Sandbox (a window opens and closes by itself; do not use it)"
Start-Process $wsb
$results = Join-Path $out "results.txt"
$waited = 0
while (-not (Test-Path (Join-Path $out "ready.txt")) -and $waited -lt 600) { Start-Sleep 5; $waited += 5 }
if (-not (Test-Path (Join-Path $out "ready.txt"))) { "the Sandbox never got ready"; Get-Content $results -ErrorAction SilentlyContinue; exit 1 }
pnpm --silent --filter @screentime/server exec tsx scripts/dev-grant.ts Sam screens -900
Set-Content (Join-Path $in "granted.txt") "granted"
$waited = 0
while (-not ((Test-Path $results) -and (Select-String -Path $results -Pattern "^done" -Quiet)) -and $waited -lt 300) { Start-Sleep 5; $waited += 5 }
"--- what the Sandbox saw"
Get-Content $results
"--- (full logs in $out)"
```

## 6. What to write

Write these exactly as given; they are short and they are the installer.

### 6.1 `windows/src/ScreenTime.Service/Hardening.cs` (new)

```csharp
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace ScreenTime.Service;

/// <summary>
/// Hardening at install (docs/SPEC.md §12.2): kids must not change the PC's time zone. Windows gives the "Change the
/// time zone" right (<c>SeTimeZonePrivilege</c>) to the Users group, so it is taken from Users; parents keep it as
/// Administrators. Needs administrator rights (the installer runs it). Uninstalling gives it back.
/// </summary>
internal static unsafe partial class Hardening
{
    private const string TimeZoneRight = "SeTimeZonePrivilege";
    private const uint PolicyLookupNames = 0x00000800, PolicyCreateAccount = 0x00000010;
    private const uint StatusObjectNameNotFound = 0xC0000034;

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaUnicodeString
    {
        public ushort Length;
        public ushort MaximumLength;
        public nint Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaObjectAttributes
    {
        public uint Length;
        public nint RootDirectory;
        public nint ObjectName;
        public uint Attributes;
        public nint SecurityDescriptor;
        public nint SecurityQualityOfService;
    }

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaOpenPolicy(nint systemName, LsaObjectAttributes* attributes, uint access, out nint handle);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaRemoveAccountRights(nint handle, byte* sid, [MarshalAs(UnmanagedType.U1)] bool allRights, LsaUnicodeString* rights, uint count);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaAddAccountRights(nint handle, byte* sid, LsaUnicodeString* rights, uint count);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaEnumerateAccountRights(nint handle, byte* sid, out LsaUnicodeString* rights, out uint count);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaFreeMemory(void* buffer);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaClose(nint handle);

    [LibraryImport("advapi32.dll")]
    private static partial uint LsaNtStatusToWinError(uint status);

    /// <summary>Takes the time zone right from the Users group. Throws when Windows says no (for example, not elevated).</summary>
    public static void TakeTimeZoneRight() => WithUsers((policy, sid) =>
    {
        var status = Change(policy, sid, add: false);
        if (status != 0 && status != StatusObjectNameNotFound) Fail("LsaRemoveAccountRights", status);
    });

    /// <summary>Gives the time zone right back to the Users group (uninstall).</summary>
    public static void GiveTimeZoneRight() => WithUsers((policy, sid) =>
    {
        var status = Change(policy, sid, add: true);
        if (status != 0) Fail("LsaAddAccountRights", status);
    });

    /// <summary>Whether the Users group holds the time zone right now.</summary>
    public static bool UsersHaveTimeZoneRight()
    {
        var held = false;
        WithUsers((policy, sid) =>
        {
            var status = LsaEnumerateAccountRights(policy, sid, out var rights, out var count);
            if (status == StatusObjectNameNotFound) return;
            if (status != 0) Fail("LsaEnumerateAccountRights", status);
            try
            {
                for (var i = 0; i < count; i++)
                {
                    var name = new string((char*)rights[i].Buffer, 0, rights[i].Length / 2);
                    if (name == TimeZoneRight) held = true;
                }
            }
            finally
            {
                LsaFreeMemory(rights);
            }
        });
        return held;
    }

    private static uint Change(nint policy, byte* sid, bool add)
    {
        var text = Marshal.StringToHGlobalUni(TimeZoneRight);
        try
        {
            var right = new LsaUnicodeString { Length = (ushort)(TimeZoneRight.Length * 2), MaximumLength = (ushort)(TimeZoneRight.Length * 2 + 2), Buffer = text };
            return add ? LsaAddAccountRights(policy, sid, &right, 1) : LsaRemoveAccountRights(policy, sid, false, &right, 1);
        }
        finally
        {
            Marshal.FreeHGlobal(text);
        }
    }

    private delegate void PolicyAction(nint policy, byte* sid);

    private static void WithUsers(PolicyAction action)
    {
        var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
        var sid = new byte[users.BinaryLength];
        users.GetBinaryForm(sid, 0);
        var attributes = new LsaObjectAttributes { Length = (uint)sizeof(LsaObjectAttributes) };
        var status = LsaOpenPolicy(0, &attributes, PolicyLookupNames | PolicyCreateAccount, out var policy);
        if (status != 0) Fail("LsaOpenPolicy", status);
        try
        {
            fixed (byte* p = sid) action(policy, p);
        }
        finally
        {
            LsaClose(policy);
        }
    }

    private static void Fail(string call, uint status) =>
        throw new InvalidOperationException($"{call} failed: Windows error {LsaNtStatusToWinError(status)}");
}
```

### 6.2 `windows/src/ScreenTime.Service/Program.cs` (changed)

1. The tray's default path, when running as a service, is now in the `Tray` folder. Replace the two lines that pick `trayExe` (and the comment above them) with:
   ```csharp
               // --tray <path>: the tray exe. Without it, Tray\ScreenTime.Tray.exe next to the service when it runs as a service (the
               // installer's layout); none in a console run.
               var trayExe = flags.TryGetValue("tray", out var tray) ? tray
                   : WindowsServiceHelpers.IsWindowsService() ? Path.Combine(AppContext.BaseDirectory, "Tray", "ScreenTime.Tray.exe") : null;
   ```
2. Three new commands, before `case "sync-once":`:
   ```csharp
       case "harden":
       case "unharden":
       case "harden-check":
           {
               // The installer runs harden (install) and unharden (uninstall) as administrator (docs/SPEC.md §12.2).
               try
               {
                   if (command == "harden") Hardening.TakeTimeZoneRight();
                   if (command == "unharden") Hardening.GiveTimeZoneRight();
                   Console.WriteLine($"Users can change the time zone: {(Hardening.UsersHaveTimeZoneRight() ? "yes" : "no")}");
                   return 0;
               }
               catch (InvalidOperationException e)
               {
                   Console.Error.WriteLine(e.Message);
                   return 1;
               }
           }
   ```

### 6.3 `windows/src/ScreenTime.Installer/ScreenTime.Installer.wixproj` (new)

```xml
<Project Sdk="WixToolset.Sdk/5.0.2">

    <!--
      The Screen Time MSI (docs/SPEC.md §12.2). Built by windows/installer/build-msi.ps1 (CI's "installer" job), which
      publishes the service (native AOT) and the tray (self-contained) first and passes their folders in.
    -->
    <PropertyGroup>
        <OutputName>ScreenTime</OutputName>
        <InstallerPlatform>x64</InstallerPlatform>
        <Version Condition="'$(Version)' == ''">0.1.0</Version>
        <DefineConstants>ServiceDir=$(ServiceDir);TrayDir=$(TrayDir);Version=$(Version)</DefineConstants>
        <!-- ICE03 and ICE60: Windows App SDK DLLs list more languages in their version than MSI's Language column holds. Harmless. -->
        <SuppressIces>ICE03;ICE60</SuppressIces>
    </PropertyGroup>

</Project>
```

### 6.4 `windows/src/ScreenTime.Installer/Package.wxs` (new)

```xml
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <!--
    Screen Time for Windows (docs/SPEC.md §12.2). Installs the service and the tray to Program Files\ScreenTime,
    registers the service (automatic, LocalSystem, restart on failure after 0, 5 and 30 s, also in Safe Mode), and
    takes the "Change the time zone" right from the Users group ("ScreenTime.Service.exe harden"). Uninstalling
    removes all of it and gives the right back. Enrolling the kids' accounts is a separate step (the setup app, or
    "ScreenTime.Service.exe enrol").
  -->
  <Package Name="Screen Time" Manufacturer="Screen Time" Version="$(var.Version)"
           UpgradeCode="D01A007C-1681-4161-B29F-DE7197D4E3D4" Scope="perMachine">
    <MajorUpgrade DowngradeErrorMessage="A newer Screen Time is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="ScreenTime">
        <Directory Id="TRAYFOLDER" Name="Tray" />
      </Directory>
    </StandardDirectory>

    <Feature Id="Main">
      <ComponentGroupRef Id="Service" />
      <ComponentGroupRef Id="Tray" />
      <ComponentRef Id="SafeBoot" />
    </Feature>

    <ComponentGroup Id="Service" Directory="INSTALLFOLDER">
      <Component Id="ServiceExe">
        <File Id="ServiceExe" Source="$(var.ServiceDir)\ScreenTime.Service.exe" KeyPath="yes" />
        <ServiceInstall Id="ScreenTime" Name="ScreenTime" DisplayName="Screen Time"
                        Description="Keeps the family's screen time limits on this PC."
                        Type="ownProcess" Start="auto" ErrorControl="normal" Account="LocalSystem" Vital="yes" />
        <ServiceControl Id="ScreenTime" Name="ScreenTime" Start="install" Stop="both" Remove="uninstall" Wait="yes" />
      </Component>
      <Files Include="$(var.ServiceDir)\**">
        <Exclude Files="$(var.ServiceDir)\ScreenTime.Service.exe" />
        <Exclude Files="$(var.ServiceDir)\**\*.pdb" />
      </Files>
    </ComponentGroup>

    <ComponentGroup Id="Tray" Directory="TRAYFOLDER">
      <Files Include="$(var.TrayDir)\**">
        <Exclude Files="$(var.TrayDir)\**\*.pdb" />
      </Files>
    </ComponentGroup>

    <!-- The service also runs in Safe Mode (minimal and with networking). -->
    <Component Id="SafeBoot" Directory="INSTALLFOLDER">
      <RegistryKey Root="HKLM" Key="SYSTEM\CurrentControlSet\Control\SafeBoot\Minimal\ScreenTime">
        <RegistryValue Type="string" Value="Service" KeyPath="yes" />
      </RegistryKey>
      <RegistryKey Root="HKLM" Key="SYSTEM\CurrentControlSet\Control\SafeBoot\Network\ScreenTime">
        <RegistryValue Type="string" Value="Service" />
      </RegistryKey>
    </Component>

    <!--
      Restart on failure after 0, 5 and 30 s (§12.2). MSI's own ServiceConfigFailureActions is documented not to work,
      and WiX's util:ServiceConfig has one delay only, so sc.exe sets them, as SYSTEM, once the service is installed.
    -->
    <StandardDirectory Id="System64Folder" />
    <CustomAction Id="Recovery" Directory="System64Folder" Execute="deferred" Impersonate="no" Return="check"
                  ExeCommand="&quot;[System64Folder]sc.exe&quot; failure ScreenTime reset= 86400 actions= restart/0/restart/5000/restart/30000" />

    <!-- Hardening: run as SYSTEM after the files are in place; undone before they are removed. -->
    <CustomAction Id="Harden" FileRef="ServiceExe" ExeCommand="harden" Execute="deferred" Impersonate="no" Return="check" />
    <CustomAction Id="Unharden" FileRef="ServiceExe" ExeCommand="unharden" Execute="deferred" Impersonate="no" Return="ignore" />
    <InstallExecuteSequence>
      <Custom Action="Recovery" After="InstallServices" Condition="NOT REMOVE" />
      <Custom Action="Harden" After="InstallFiles" Condition="NOT REMOVE" />
      <Custom Action="Unharden" Before="RemoveFiles" Condition="REMOVE=&quot;ALL&quot;" />
    </InstallExecuteSequence>
  </Package>
</Wix>
```

Also update `windows/src/ScreenTime.Installer/README.md` to: `# ScreenTime.Installer` / (blank line) / `The WiX MSI (CARD-052). Build it with windows/installer/build-msi.ps1, or take it from CI's "installer" job (artifact ScreenTime-msi). Try it only in Windows Sandbox: windows/installer/sandbox/Test-Installer.ps1.`

### 6.5 `windows/installer/build-msi.ps1` (new)

```powershell
# Builds the Screen Time MSI (docs/SPEC.md §12.2): publishes the service as native AOT and the tray self-contained,
# then builds src\ScreenTime.Installer. Run from windows\. CI's "installer" job runs it; native AOT needs the
# "Desktop development with C++" tools, which GitHub's Windows runners have.
#   -Version 0.1.7     the MSI's version (CI passes 0.1.<run number>)
#   -NoAot             publish the service as a self-contained single file instead (only to try the MSI on a PC
#                      without the C++ tools; never for a release)
param([string]$Version = "0.1.0", [switch]$NoAot)
$ErrorActionPreference = "Stop"
$out = Join-Path (Get-Location) "out"
$serviceDir = Join-Path $out "service"
$trayDir = Join-Path $out "tray"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }

$serviceArgs = @("publish", "src\ScreenTime.Service\ScreenTime.Service.csproj", "-c", "Release", "-r", "win-x64", "-o", $serviceDir)
if ($NoAot) { $serviceArgs += @("-p:PublishAot=false", "--self-contained", "-p:PublishSingleFile=true") }
dotnet @serviceArgs
if ($LASTEXITCODE -ne 0) { throw "publishing the service failed" }

dotnet publish src\ScreenTime.Tray\ScreenTime.Tray.csproj -c Release -r win-x64 --self-contained -o $trayDir
if ($LASTEXITCODE -ne 0) { throw "publishing the tray failed" }

dotnet build src\ScreenTime.Installer\ScreenTime.Installer.wixproj -c Release -o (Join-Path $out "msi") `
  "-p:ServiceDir=$serviceDir" "-p:TrayDir=$trayDir" "-p:Version=$Version"
if ($LASTEXITCODE -ne 0) { throw "building the MSI failed" }

$msi = Join-Path $out "msi\ScreenTime.msi"
"MSI: $msi ($([math]::Round((Get-Item $msi).Length / 1MB)) MB), service $(if ($NoAot) { 'self-contained' } else { 'native AOT' })"
```

### 6.6 `.github/workflows/windows.yml` (changed)

Add this job at the end (after `build`), indented as the `build` job is:

```yaml
  installer:
    name: installer
    needs: build
    runs-on: windows-latest
    timeout-minutes: 30
    defaults:
      run:
        working-directory: windows
    steps:
      - name: Check out
        uses: actions/checkout@v5

      - name: Set up .NET
        uses: actions/setup-dotnet@v5
        with:
          global-json-file: windows/global.json

      # The service is native AOT, which needs the C++ tools that GitHub's Windows runners have (docs/SPEC.md §12.2).
      - name: Build the MSI
        shell: pwsh
        run: ./installer/build-msi.ps1 -Version 0.1.${{ github.run_number }}

      - name: Upload the MSI
        uses: actions/upload-artifact@v7
        with:
          name: ScreenTime-msi
          path: windows/out/msi/ScreenTime.msi
          retention-days: 14
          if-no-files-found: error
```

### 6.7 `.gitignore` (changed)

Add at the end:

```
# The installer build (windows/installer/build-msi.ps1)
windows/out/
```

## 7. Steps

1. `git checkout main`, `git pull origin main`, `git checkout -b bob/card-052-installer`. Check that `windows/src/ScreenTime.Tray/ScreenTime.Tray.csproj` contains `EnableMsixTooling`. If not, stop: PR #145 is not merged yet.
2. Copy the two files in section 5. Run the fingerprints (8.1) **once**.
3. Write 6.1 to 6.7.
4. From `windows\`: `dotnet build ScreenTime.slnx -c Release` (0 errors, 0 warnings) and the tests (total 246).
5. Optional, to find WiX mistakes before CI: `.\installer\build-msi.ps1 -NoAot` from `windows\` builds the MSI with a non-AOT service on this PC. Never install it here.
6. Commit, push, open the PR (section 10). Wait for CI: **both** jobs green.
7. Download the MSI from the PR's CI run and do the Sandbox run (8.3), pasting every output.
8. Write the handback (section 12).

## 8. Acceptance criteria

### 8.1 Build and tests

- [ ] From the repo root, run this **once** and paste the output: two lines, each ending in `True`.
  ```powershell
  $root = (Get-Location).Path
  function Fp($f, $want) {
    $b = [IO.File]::ReadAllBytes("$root\windows\$f") | Where-Object { $_ -ne 13 }
    $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]$b)).Replace("-","").ToLower()
    "$f $h $($h -eq $want)"
  }
  Fp "installer\sandbox\in-sandbox.ps1" "b3fec8b2b2cc0e38424679c2ae96df17b4aae6f664d5b97d98d842211f4d1f4f"
  Fp "installer\sandbox\Test-Installer.ps1" "6c4ab603b1916cf2713b034ff4281a06b563575e76389bf84fc75bca3d700bd8"
  ```
- [ ] From `windows\`: `dotnet build ScreenTime.slnx -c Release` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] From `windows\`: `dotnet test --solution ScreenTime.slnx -c Release --no-build` → **total 246**, failed 0.
- [ ] From the repo root: `Select-String -Path windows\src\ScreenTime.Service\*.cs -Pattern 'DllImport'` prints nothing.

### 8.2 Repo and CI

- [ ] `git status` clean. No `windows\out\`, `bin\`, `obj\` or `*.msi` in the repo.
- [ ] CI green on the PR for **Windows / build and test** and **Windows / installer**. Paste `gh pr checks <your PR>`.
- [ ] `git diff --name-only main...HEAD` lists exactly these 10 files:
  ```
  .github/workflows/windows.yml
  .gitignore
  windows/installer/build-msi.ps1
  windows/installer/sandbox/Test-Installer.ps1
  windows/installer/sandbox/in-sandbox.ps1
  windows/src/ScreenTime.Installer/Package.wxs
  windows/src/ScreenTime.Installer/README.md
  windows/src/ScreenTime.Installer/ScreenTime.Installer.wixproj
  windows/src/ScreenTime.Service/Hardening.cs
  windows/src/ScreenTime.Service/Program.cs
  ```

### 8.3 The run in Windows Sandbox (with the MSI built by CI)

Paste the **real output of every line**. Docker Desktop must be running, and Windows Sandbox is turned on (James did it). The run takes about 5 minutes; a Sandbox window opens and closes by itself: **do not click in it**. Nothing is installed on James's PC.

1. Download the MSI from your PR's CI run (the run that has the `installer` job):
   ```powershell
   $run = (gh run list --branch bob/card-052-installer --workflow Windows --limit 1 --json databaseId --jq '.[0].databaseId')
   $msiDir = "C:\Users\james\OpenCode\Testing\temp\c52-msi-$run"
   gh run download $run --name ScreenTime-msi --dir $msiDir
   Get-Item "$msiDir\ScreenTime.msi" | ForEach-Object { "$($_.Name) $([math]::Round($_.Length / 1MB)) MB" }
   ```
2. From the repo root, the Sandbox run:
   ```powershell
   windows\installer\sandbox\Test-Installer.ps1 -Msi "$msiDir\ScreenTime.msi"
   ```
   It prints the dev server's start, then **what the Sandbox saw**. Paste all of it.

What Claude saw (times, ids and pids differ):

```
--- what the Sandbox saw
sandbox run at 2026-11-04T15:20:21.0270894+11:00 as 232e5024-02e9-4\wdagutilityaccount, session 1
before: SeTimeZonePrivilege = *S-1-5-19,*S-1-5-32-544,*S-1-5-32-545
=== 1. install
msiexec install exit 0
files: True service, True tray
=== 2. the service
  START_TYPE         : 2   AUTO_START
  BINARY_PATH_NAME   : "C:\Program Files\ScreenTime\ScreenTime.Service.exe"
  SERVICE_START_NAME : LocalSystem
  STATE              : 4  RUNNING
  RESET_PERIOD (in seconds)    : 86400
  FAILURE_ACTIONS              : RESTART -- Delay = 0 milliseconds.
  RESTART -- Delay = 5000 milliseconds.
  RESTART -- Delay = 30000 milliseconds.
=== 3. Safe Mode
  Minimal = Service
  Network = Service
=== 4. the time zone right
  SeTimeZonePrivilege = *S-1-5-19,*S-1-5-32-544
  Users can change the time zone: no
=== 5. enrol this account as Sam
  Enrolled WDAGUtilityAccount as Sam (device 01a1a4cb-592e-74ce-91c1-90b13f3c21ac).
  enrol exit 0
  console session: 4294967295 (4294967295 = none); this session: 1
  service command: "C:\Program Files\ScreenTime\ScreenTime.Service.exe" --session 1 --dry-lock
=== 6. the tray, started by the service
  tray pid 1736, session 1, user WDAGUtilityAccount, parent ScreenTime.Service.exe, args: --pipe ScreenTime.1 --dry-lock
  15:22:36 pipe: connected
  15:22:36 view: Screens · 24m left
  pipes: \\.\pipe\ScreenTime.1
  error event: Microsoft-Windows-Security-SPP: License Activation (slui.exe) failed with the following error code: hr=0x800704CF Command-line arguments: RuleId=31e71c49-8da7-4a2f-ad92-45d98a1c79ba;Action=AutoActivate;AppId=55c92734-d682-4d71-983e-d6ec3f16059f;SkuId=8b351c9c-f398-4515-9900-09df49427262;NotificationInterval=1440;Trigger=UserLogon;
=== 7. out of time: the service asks the tray to lock (dry run in the Sandbox)
  the host ran Sam out of time (waited 6 s)
  15:23:09 lock: dry run
  15:23:20 lock: dry run
  15:23:30 lock: dry run
=== 8. uninstall
msiexec uninstall exit 0
  service still there: False
  Safe Mode keys still there: False False
  files still there: False
  SeTimeZonePrivilege = *S-1-5-19,*S-1-5-32-544,*S-1-5-32-545
done
```

Check these lines in your output:

| Step | Expect |
|---|---|
| 1 | `msiexec install exit 0`, `files: True service, True tray` |
| 2 | `AUTO_START`, `LocalSystem`, `RUNNING`, `RESET_PERIOD … 86400`, restarts after `0`, `5000`, `30000` ms |
| 3 | `Minimal = Service`, `Network = Service` |
| 4 | `SeTimeZonePrivilege = *S-1-5-19,*S-1-5-32-544` (no `*S-1-5-32-545`), `Users can change the time zone: no` |
| 5 | `Enrolled WDAGUtilityAccount as Sam …`, `enrol exit 0`, the console session `4294967295` and the service command with `--session 1 --dry-lock` (the Sandbox has no console session, so the test points the service at its own) |
| 6 | **one** tray, `session 1`, `user WDAGUtilityAccount`, `parent ScreenTime.Service.exe`; `pipe: connected`; a `view:` line; the pipe `\\.\pipe\ScreenTime.1`; **no** `error event: Application Error … ScreenTime.Tray.exe` |
| 7 | `lock: dry run` lines, one about every 10 s (the tray may also show `view: Out of Screens time`) |
| 8 | `msiexec uninstall exit 0`, `service still there: False`, `Safe Mode keys still there: False False`, `files still there: False`, and `SeTimeZonePrivilege = …,*S-1-5-32-545` again |

## 9. Tests

No new unit tests: the MSI, the LSA calls and the service registration can only be checked on a real Windows, which the Sandbox run does. The 246 existing tests must still pass.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-052-installer
   ```
2. Commit with the message `CARD-052: Windows: the installer, built in CI and tried in Windows Sandbox`.
3. Before pushing, run every acceptance command in 8.1 again.
4. Push: `git push -u origin bob/card-052-installer`
5. Write the PR body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` and open the PR with `gh pr create --base main --title "CARD-052: Windows: the installer, built in CI and tried in Windows Sandbox" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. The body:
   ```markdown
   ## Card
   docs/cards/CARD-052-installer.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] criterion 1 — output: `...`

   ## 8.3 Sandbox run
   (the real output, from "what the Sandbox saw" to "done")

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Never change a copied file or one of Claude's front-end files.

- **The `installer` CI job fails**: open its log (`gh run view <run> --log-failed`) and paste the error. A `WIX` error usually means `Package.wxs` differs from 6.4: compare it once. If still unclear, stop.
- **`Test-Installer.ps1` says "the Sandbox never got ready"**: paste everything it printed and the files in the `out` folder it names, and stop. Do not run the MSI anywhere else.
- **Step 6 shows an `error event … ScreenTime.Tray.exe`, or no `pipe: connected`**: paste the whole output and stop.
- **`dev-bedtime` says bedtime after midnight is not supported**: it is after 10 pm in Sydney. Do the run earlier in the day.
- **Never** run the MSI, `harden` or the installed service on James's PC to get past a problem.

## 12. Handback report (required)

When the PR is open and the run is done, your **last message to James** is the handback below, in one fenced code block; also save it as `C:\Users\james\OpenCode\Testing\temp\handback-card-052.txt`. Write only what you actually saw. Paste the **whole** report.

Rules:

- Every command line shows the **real** output you saw. If you did not run a command, write `NOT RUN` and the reason.
- Paste the real output of **every** run step. A step without its pasted output counts as `NOT RUN`.
- Every workaround (restart, extra script, retry) is a deviation: list it under "Deviations" with why you needed it.
- "Deviations" lists every way your files differ from the card. "Outside the repo" lists anything you changed on James's PC outside the repo folder. Write `None` if there was nothing.

````text
Claude, here is Bob's handback for CARD-052. Please review and merge if it is good.

CARD: CARD-052 Windows: the installer, built in CI and tried in Windows Sandbox
PR: <full PR URL>
Branch: bob/card-052-installer
Head commit: <output of `git rev-parse HEAD`>
CI run with the MSI: <run id>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>

Acceptance criteria:
- [x] <criterion> (ran it, output above)

8.3 Sandbox run (real output, every line):
<paste>

Deviations from the card:
<None, or each one>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
