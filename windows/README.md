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
