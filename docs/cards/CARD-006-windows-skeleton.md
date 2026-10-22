# CARD-006: Windows .NET 10 solution skeleton

| Field | Value |
|---|---|
| Card | CARD-006 |
| Title | Windows .NET 10 solution skeleton |
| Size | S |
| Depends on | CARD-001 (merged to `main`) |
| Spec sections | docs/SPEC.md §4.1, §5, §12.2 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-006-windows-skeleton` |
| PR title | `CARD-006: Windows .NET 10 solution skeleton` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

On each kid's Windows 11 PC, two programs will run:

- **ScreenTime.Service**: a Windows service running as LocalSystem. It counts time, talks to the server and locks the PC. It has no UI.
- **ScreenTime.Tray**: a small WinUI 3 app that runs inside the kid's Windows session. Later it shows a tray icon, a flyout with time left, and toasts.

Shared C# code (time maths, models, API client) goes in the **ScreenTime.Core** library, tested by **ScreenTime.Core.Tests**.

Right now `windows/` contains only `README.md`. This card creates the .NET solution with those four projects. Every project is a small placeholder that builds; real behaviour comes in later cards. It also adds a GitHub Actions workflow that builds and tests the solution on Windows.

## 2. Goal

`windows/ScreenTime.slnx` exists with four projects. `dotnet build` and `dotnet test` pass on James's PC and in a new **Windows** GitHub Actions workflow, with 12 passing unit tests.

## 3. Out of scope

Do **not** do any of these in this card:

- No service installation, no `sc.exe`, no session tracking, no locking, no named pipes, no SQLite, no HTTP or WebSocket code.
- No tray icon, no H.NotifyIcon package, no flyout, no toasts. The tray app only opens one placeholder window.
- No installer project. `src/ScreenTime.Installer/` gets only a `README.md` (the WiX installer is CARD-052).
- No `ScreenTime.sln` file. Use the newer `.slnx` format given here; do not run `dotnet new sln`.
- No Visual Studio-only files (`.vs/`, `*.user`, `launchSettings.json`, `Package.appxmanifest`, `app.manifest`).
- No extra NuGet packages and no different versions than section 4.
- Do not change anything outside `windows/` and `.github/workflows/windows.yml`.

## 4. Tech and versions

Use **exactly** these versions.

| Item | Version |
|---|---|
| .NET SDK | 10.0 (any 10.0.1xx or newer feature band; pinned in `global.json`) |
| Target frameworks | `net10.0` (Core, Core.Tests), `net10.0-windows` (Service), `net10.0-windows10.0.26100.0` (Tray) |
| `Microsoft.Extensions.Hosting.WindowsServices` | 10.0.13 |
| `Microsoft.WindowsAppSDK` | 2.5.1 |
| `xunit.v3` | 4.0.2 (runs on Microsoft Testing Platform, set in `global.json`) |
| Solution format | `.slnx` |

### Tools James must install first

1. **.NET 10 SDK**: in PowerShell, `winget install Microsoft.DotNet.SDK.10`, then open a **new** terminal.

You do **not** need Visual Studio for this card.

### Check the tools (PowerShell)

```powershell
dotnet --list-sdks
```

At least one line must start with `10.0.`. If none does, stop and ask James to install the .NET 10 SDK.

## 5. Files

Create the files below with **exactly** these contents. C# and XML files use 4-space indentation (`.editorconfig` already says so). The final tree:

```
windows/
├── README.md                                   (replace, 5.1)
├── global.json                                 (5.2)
├── Directory.Build.props                       (5.3)
├── ScreenTime.slnx                             (5.4)
├── src/
│   ├── ScreenTime.Core/
│   │   ├── ScreenTime.Core.csproj              (5.5)
│   │   ├── DurationFormat.cs                   (5.6)
│   │   └── Pool.cs                             (5.7)
│   ├── ScreenTime.Service/
│   │   ├── ScreenTime.Service.csproj           (5.8)
│   │   ├── Program.cs                          (5.9)
│   │   └── Worker.cs                           (5.10)
│   ├── ScreenTime.Tray/
│   │   ├── ScreenTime.Tray.csproj              (5.11)
│   │   ├── App.xaml                            (5.12)
│   │   └── App.xaml.cs                         (5.13)
│   └── ScreenTime.Installer/
│       └── README.md                           (5.14)
└── tests/
    └── ScreenTime.Core.Tests/
        ├── ScreenTime.Core.Tests.csproj        (5.15)
        ├── DurationFormatTests.cs              (5.16)
        └── PoolTests.cs                        (5.17)
```

Plus one workflow file at the repo root: `.github/workflows/windows.yml` (5.18).

### 5.1 `windows/README.md`

Replace the whole file.

````markdown
# windows

One .NET 10 solution, `ScreenTime.slnx` (docs/SPEC.md §4.1, §5, §12.2):

| Project | Kind | Purpose |
|---|---|---|
| `src/ScreenTime.Core/` | class library (`net10.0`) | time engine, models, API client, local store |
| `src/ScreenTime.Service/` | Windows service (LocalSystem, Native AOT) | the enforcer: counts time, syncs, locks |
| `src/ScreenTime.Tray/` | WinUI 3 app, unpackaged | runs in the kid's session: tray icon, flyout, toasts |
| `src/ScreenTime.Installer/` | WiX MSI (CARD-052) | installer |
| `tests/ScreenTime.Core.Tests/` | xUnit v3 | unit tests for Core |

## Build

Needs the .NET 10 SDK (`winget install Microsoft.DotNet.SDK.10`). From this folder in PowerShell:

```powershell
dotnet build ScreenTime.slnx -c Release
dotnet test --solution ScreenTime.slnx -c Release --no-build
```

Tests run on Microsoft Testing Platform (set in `global.json`).
````

### 5.2 `windows/global.json`

Pins the .NET 10 SDK and makes `dotnet test` use Microsoft Testing Platform (needed by xUnit v3).

```json
{
  "sdk": {
    "version": "10.0.100",
    "rollForward": "latestFeature"
  },
  "test": {
    "runner": "Microsoft.Testing.Platform"
  }
}
```

### 5.3 `windows/Directory.Build.props`

Settings shared by every project. Warnings are errors, so the build must have 0 warnings.

```xml
<Project>
    <PropertyGroup>
        <Nullable>enable</Nullable>
        <ImplicitUsings>enable</ImplicitUsings>
        <LangVersion>latest</LangVersion>
        <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    </PropertyGroup>
</Project>
```

### 5.4 `windows/ScreenTime.slnx`

```xml
<Solution>
    <Folder Name="/src/">
        <Project Path="src/ScreenTime.Core/ScreenTime.Core.csproj" />
        <Project Path="src/ScreenTime.Service/ScreenTime.Service.csproj" />
        <Project Path="src/ScreenTime.Tray/ScreenTime.Tray.csproj" />
    </Folder>
    <Folder Name="/tests/">
        <Project Path="tests/ScreenTime.Core.Tests/ScreenTime.Core.Tests.csproj" />
    </Folder>
</Solution>
```

### 5.5 `windows/src/ScreenTime.Core/ScreenTime.Core.csproj`

Plain `net10.0` (no Windows APIs), so the code stays portable and Native AOT safe.

```xml
<Project Sdk="Microsoft.NET.Sdk">

    <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
        <IsAotCompatible>true</IsAotCompatible>
    </PropertyGroup>

</Project>
```

### 5.6 `windows/src/ScreenTime.Core/DurationFormat.cs`

```csharp
namespace ScreenTime.Core;

/// <summary>
/// Formats a duration for people, as in docs/SPEC.md §16.1:
/// "1h 12m", "45m", "2h", or "less than a minute".
/// Seconds are rounded down to whole minutes. Zero or negative gives "less than a minute".
/// </summary>
public static class DurationFormat
{
    public static string Format(long seconds)
    {
        var totalMinutes = seconds / 60;
        if (totalMinutes < 1)
        {
            return "less than a minute";
        }

        var hours = totalMinutes / 60;
        var minutes = totalMinutes % 60;
        if (hours == 0)
        {
            return $"{minutes}m";
        }

        return minutes == 0 ? $"{hours}h" : $"{hours}h {minutes}m";
    }
}
```

### 5.7 `windows/src/ScreenTime.Core/Pool.cs`

```csharp
namespace ScreenTime.Core;

/// <summary>A daily pool of time for one kid (docs/SPEC.md §6).</summary>
public enum Pool
{
    Screens,
    Phone,
}

public static class PoolExtensions
{
    /// <summary>The exact text used in the API and the database.</summary>
    public static string ToApiValue(this Pool pool) => pool switch
    {
        Pool.Screens => "screens",
        Pool.Phone => "phone",
        _ => throw new ArgumentOutOfRangeException(nameof(pool), pool, null),
    };

    /// <summary>Returns the pool for an API value, or null if the value is unknown.</summary>
    public static Pool? FromApiValue(string value) => value switch
    {
        "screens" => Pool.Screens,
        "phone" => Pool.Phone,
        _ => null,
    };
}
```

### 5.8 `windows/src/ScreenTime.Service/ScreenTime.Service.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk.Worker">

    <PropertyGroup>
        <TargetFramework>net10.0-windows</TargetFramework>
        <OutputType>Exe</OutputType>
        <RuntimeIdentifier>win-x64</RuntimeIdentifier>
        <PublishAot>true</PublishAot>
        <AssemblyName>ScreenTime.Service</AssemblyName>
    </PropertyGroup>

    <ItemGroup>
        <PackageReference Include="Microsoft.Extensions.Hosting.WindowsServices" Version="10.0.13" />
    </ItemGroup>

    <ItemGroup>
        <ProjectReference Include="..\ScreenTime.Core\ScreenTime.Core.csproj" />
    </ItemGroup>

</Project>
```

### 5.9 `windows/src/ScreenTime.Service/Program.cs`

```csharp
using ScreenTime.Service;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options => options.ServiceName = "ScreenTime");
builder.Services.AddHostedService<Worker>();
builder.Build().Run();
```

### 5.10 `windows/src/ScreenTime.Service/Worker.cs`

```csharp
using ScreenTime.Core;

namespace ScreenTime.Service;

/// <summary>Placeholder worker: logs once at start, then waits until the service stops.</summary>
public sealed class Worker(ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "ScreenTime service started. Pools: {Screens}, {Phone}",
            Pool.Screens.ToApiValue(),
            Pool.Phone.ToApiValue());

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }

        logger.LogInformation("ScreenTime service stopping.");
    }
}
```

### 5.11 `windows/src/ScreenTime.Tray/ScreenTime.Tray.csproj`

Unpackaged (`WindowsPackageType` None) and self-contained Windows App SDK, so it runs as a plain `.exe` with no MSIX and no separate runtime install.

```xml
<Project Sdk="Microsoft.NET.Sdk">

    <PropertyGroup>
        <OutputType>WinExe</OutputType>
        <TargetFramework>net10.0-windows10.0.26100.0</TargetFramework>
        <TargetPlatformMinVersion>10.0.22000.0</TargetPlatformMinVersion>
        <RuntimeIdentifier>win-x64</RuntimeIdentifier>
        <UseWinUI>true</UseWinUI>
        <WindowsPackageType>None</WindowsPackageType>
        <WindowsAppSDKSelfContained>true</WindowsAppSDKSelfContained>
        <AssemblyName>ScreenTime.Tray</AssemblyName>
        <RootNamespace>ScreenTime.Tray</RootNamespace>
    </PropertyGroup>

    <ItemGroup>
        <PackageReference Include="Microsoft.WindowsAppSDK" Version="2.5.1" />
    </ItemGroup>

    <ItemGroup>
        <ProjectReference Include="..\ScreenTime.Core\ScreenTime.Core.csproj" />
    </ItemGroup>

</Project>
```

### 5.12 `windows/src/ScreenTime.Tray/App.xaml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<Application
    x:Class="ScreenTime.Tray.App"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
    <Application.Resources>
        <ResourceDictionary>
            <ResourceDictionary.MergedDictionaries>
                <XamlControlsResources xmlns="using:Microsoft.UI.Xaml.Controls" />
            </ResourceDictionary.MergedDictionaries>
        </ResourceDictionary>
    </Application.Resources>
</Application>
```

### 5.13 `windows/src/ScreenTime.Tray/App.xaml.cs`

The window is built in code (there is no `MainWindow.xaml` on purpose).

```csharp
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using ScreenTime.Core;

namespace ScreenTime.Tray;

/// <summary>Placeholder tray app: opens one small window. The real tray icon and flyout come later.</summary>
public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new Window
        {
            Title = "Screen Time",
            SystemBackdrop = new MicaBackdrop(),
            Content = new StackPanel
            {
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                Spacing = 8,
                Children =
                {
                    new TextBlock
                    {
                        Text = "Screen Time",
                        Style = (Style)Current.Resources["SubtitleTextBlockStyle"],
                        HorizontalAlignment = HorizontalAlignment.Center,
                    },
                    new TextBlock
                    {
                        Text = $"Tray app. Real flyout comes later. ({DurationFormat.Format(4320)} test)",
                        HorizontalAlignment = HorizontalAlignment.Center,
                    },
                },
            },
        };
        _window.AppWindow.Resize(new Windows.Graphics.SizeInt32(360, 440));
        _window.Activate();
    }
}
```

### 5.14 `windows/src/ScreenTime.Installer/README.md`

This folder is **not** in the solution.

```markdown
# ScreenTime.Installer

WiX MSI installer. Created by CARD-052 (docs/BUILD-PLAN.md). Empty until then.
```

### 5.15 `windows/tests/ScreenTime.Core.Tests/ScreenTime.Core.Tests.csproj`

xUnit v3 test projects are executables (`OutputType` Exe). Do not add `Microsoft.NET.Test.Sdk` or `xunit.runner.visualstudio`.

```xml
<Project Sdk="Microsoft.NET.Sdk">

    <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
        <OutputType>Exe</OutputType>
        <IsPackable>false</IsPackable>
    </PropertyGroup>

    <ItemGroup>
        <PackageReference Include="xunit.v3" Version="4.0.2" />
    </ItemGroup>

    <ItemGroup>
        <ProjectReference Include="..\..\src\ScreenTime.Core\ScreenTime.Core.csproj" />
    </ItemGroup>

</Project>
```

### 5.16 `windows/tests/ScreenTime.Core.Tests/DurationFormatTests.cs`

```csharp
using ScreenTime.Core;
using Xunit;

namespace ScreenTime.Core.Tests;

public class DurationFormatTests
{
    [Theory]
    [InlineData(-5, "less than a minute")]
    [InlineData(0, "less than a minute")]
    [InlineData(59, "less than a minute")]
    [InlineData(60, "1m")]
    [InlineData(2700, "45m")]
    [InlineData(3600, "1h")]
    [InlineData(4320, "1h 12m")]
    [InlineData(4379, "1h 12m")]
    [InlineData(36000, "10h")]
    public void Formats(long seconds, string expected)
    {
        Assert.Equal(expected, DurationFormat.Format(seconds));
    }
}
```

### 5.17 `windows/tests/ScreenTime.Core.Tests/PoolTests.cs`

```csharp
using ScreenTime.Core;
using Xunit;

namespace ScreenTime.Core.Tests;

public class PoolTests
{
    [Fact]
    public void ApiValuesMatchTheSpec()
    {
        Assert.Equal("screens", Pool.Screens.ToApiValue());
        Assert.Equal("phone", Pool.Phone.ToApiValue());
    }

    [Fact]
    public void FromApiValueRoundTrips()
    {
        foreach (var pool in Enum.GetValues<Pool>())
        {
            Assert.Equal(pool, PoolExtensions.FromApiValue(pool.ToApiValue()));
        }
    }

    [Fact]
    public void FromApiValueReturnsNullForUnknown()
    {
        Assert.Null(PoolExtensions.FromApiValue("tablet"));
    }
}
```

### 5.18 `.github/workflows/windows.yml`

```yaml
name: Windows

on:
  pull_request:
    paths:
      - "windows/**"
      - ".github/workflows/windows.yml"
  push:
    branches: [main]
    paths:
      - "windows/**"
      - ".github/workflows/windows.yml"

concurrency:
  group: windows-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  build:
    name: build and test
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

      - name: Build
        run: dotnet build ScreenTime.slnx -c Release

      - name: Test
        run: dotnet test --solution ScreenTime.slnx -c Release --no-build
```

## 6. Detailed spec

### 6.1 What each project does in this card

| Project | Behaviour |
|---|---|
| `ScreenTime.Core` | `DurationFormat.Format(seconds)` gives "1h 12m", "45m", "2h" or "less than a minute" (seconds rounded down to minutes; zero or negative gives "less than a minute"). `Pool` is `Screens` or `Phone`, with API values `screens` and `phone`. These match the Android code exactly. |
| `ScreenTime.Service` | A .NET Worker that can run as a Windows service named `ScreenTime`. It logs `ScreenTime service started. Pools: screens, phone` once, then waits until it is stopped. If run from a terminal, it runs as a console app and stops with Ctrl+C. |
| `ScreenTime.Tray` | Opens one 360 × 440 window titled "Screen Time" with a Mica background, and two centred lines: "Screen Time" (subtitle style) and "Tray app. Real flyout comes later. (1h 12m test)". The "1h 12m" proves the Tray can call Core. |
| `ScreenTime.Core.Tests` | 12 tests (9 for `DurationFormat`, 3 for `Pool`). |

### 6.2 Build rules

- `TreatWarningsAsErrors` is on: the build must finish with `0 Warning(s)` and `0 Error(s)`.
- Service and Tray build for `win-x64` only (the kids' PCs are 64-bit Intel/AMD).
- The Service has `PublishAot` on (Native AOT, used later by the installer). A normal `dotnet build` does not compile it natively; that is expected.
- Core stays plain `net10.0` with no Windows-only APIs.

## 7. Steps

All commands in PowerShell.

1. Check the tools (section 4). If the check fails, stop and ask James.
2. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-006-windows-skeleton
   ```
3. Create the solution-level files: 5.2 to 5.4. Commit: `CARD-006: add solution, global.json and shared props`.
4. Create `ScreenTime.Core` (5.5 to 5.7) and `ScreenTime.Core.Tests` (5.15 to 5.17). Commit: `CARD-006: add Core library and tests`.
5. Create `ScreenTime.Service` (5.8 to 5.10). Commit: `CARD-006: add service placeholder`.
6. Create `ScreenTime.Tray` (5.11 to 5.13). Commit: `CARD-006: add tray placeholder`.
7. Replace `windows/README.md` (5.1), add the Installer README (5.14) and `.github/workflows/windows.yml` (5.18). Commit: `CARD-006: add Windows CI and READMEs`.
8. Build and test (the first build downloads NuGet packages and takes a few minutes):
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime\windows
   dotnet build ScreenTime.slnx -c Release
   dotnet test --solution ScreenTime.slnx -c Release --no-build
   ```
9. Run the acceptance checks in section 8.
10. Push and open the PR (section 10).

## 8. Acceptance criteria

Run from `C:\Users\james\OpenCode\Testing\ScreenTime\windows`.

- [ ] `dotnet build ScreenTime.slnx -c Release` ends with `Build succeeded.`, `0 Warning(s)` and `0 Error(s)`.
- [ ] `dotnet test --solution ScreenTime.slnx -c Release --no-build` ends with `Test run summary: Passed!` and `total: 12`, `failed: 0`, `succeeded: 12`.
- [ ] The service runs as a console app. Run this, wait for the log line `ScreenTime service started. Pools: screens, phone`, then press **Ctrl+C**. It prints `ScreenTime service stopping.` and exits:
  ```powershell
  .\src\ScreenTime.Service\bin\Release\net10.0-windows\win-x64\ScreenTime.Service.exe
  ```
- [ ] The tray opens its window. Run this; a window titled "Screen Time" opens and shows the two lines from 6.1 including "(1h 12m test)". Close it with the X:
  ```powershell
  .\src\ScreenTime.Tray\bin\Release\net10.0-windows10.0.26100.0\win-x64\ScreenTime.Tray.exe
  ```
  Paste "Tray window opened and showed (1h 12m test)" in the PR if it did.
- [ ] The GitHub Actions **Windows / build and test** check is green on the PR.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 18 files and nothing else (in any order):
  ```
  .github/workflows/windows.yml
  windows/Directory.Build.props
  windows/README.md
  windows/ScreenTime.slnx
  windows/global.json
  windows/src/ScreenTime.Core/DurationFormat.cs
  windows/src/ScreenTime.Core/Pool.cs
  windows/src/ScreenTime.Core/ScreenTime.Core.csproj
  windows/src/ScreenTime.Installer/README.md
  windows/src/ScreenTime.Service/Program.cs
  windows/src/ScreenTime.Service/ScreenTime.Service.csproj
  windows/src/ScreenTime.Service/Worker.cs
  windows/src/ScreenTime.Tray/App.xaml
  windows/src/ScreenTime.Tray/App.xaml.cs
  windows/src/ScreenTime.Tray/ScreenTime.Tray.csproj
  windows/tests/ScreenTime.Core.Tests/DurationFormatTests.cs
  windows/tests/ScreenTime.Core.Tests/PoolTests.cs
  windows/tests/ScreenTime.Core.Tests/ScreenTime.Core.Tests.csproj
  ```
  In particular: no `bin/`, `obj/`, `.vs/` or `*.user` files.

## 9. Tests

| File | What it asserts |
|---|---|
| `windows/tests/ScreenTime.Core.Tests/DurationFormatTests.cs` | 9 cases of `DurationFormat.Format`: -5, 0 and 59 s give "less than a minute"; 60 s "1m"; 2700 s "45m"; 3600 s "1h"; 4320 s and 4379 s "1h 12m" (rounded down); 36000 s "10h". |
| `windows/tests/ScreenTime.Core.Tests/PoolTests.cs` | API values are `screens` and `phone`; `FromApiValue` round-trips; an unknown value gives `null`. |

## 10. Git and pull request

1. Start from the latest `main` (step 2 above).
2. Commit in small logical commits (steps 3 to 7). Message format: `CARD-006: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-006-windows-skeleton`
5. Open a PR into `main` titled `CARD-006: Windows .NET 10 solution skeleton`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-006-windows-skeleton --title "CARD-006: Windows .NET 10 solution skeleton" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-006-windows-skeleton.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] build — output: `Build succeeded. 0 Warning(s) 0 Error(s)`
   - [x] tests — output: `total: 12, failed: 0, succeeded: 12`
   - [x] service runs — output: `ScreenTime service started. Pools: screens, phone`
   - [x] tray window — Tray window opened and showed (1h 12m test)
   - [x] only expected files changed — output: 18 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first `error` line from the output, not the whole log.

Known traps, and what to do:

- **`dotnet test` says "--solution" is unknown, or tries to use VSTest**: `windows/global.json` is missing or wrong. It must match 5.2 exactly and you must run the command from the `windows` folder.
- **"A compatible .NET SDK was not found"**: the .NET 10 SDK is not installed, or the terminal was opened before installing it. Ask James, then open a new terminal.
- **A warning fails the build** (`error CS....` that was a warning, because warnings are errors): fix your code to match the card exactly. Do not turn off `TreatWarningsAsErrors`.
- **The Tray build fails with a Windows SDK or XAML compiler error**: stop and report the first error line. Do not install Visual Studio or change versions yourself.
- **The tray exe fails to start** with a missing DLL or Windows App Runtime message: report it in the PR; the build and test checks still count.
