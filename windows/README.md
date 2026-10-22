# windows

One .NET 10 solution (`ScreenTime.sln`):

- `src/ScreenTime.Core/` generated API client, local store, time engine
- `src/ScreenTime.Service/` LocalSystem Windows service (enforcer)
- `src/ScreenTime.Tray/` WinUI 3 tray app running in the kid's session
- `src/ScreenTime.Installer/` MSI installer
- `tests/ScreenTime.Core.Tests/` unit tests

Created by CARD-006. See docs/SPEC.md §12.2 and §16.3.
