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

$wix = Join-Path $out "wix"
dotnet build src\ScreenTime.Installer\ScreenTime.Installer.wixproj -c Release -o $wix `
  "-p:ServiceDir=$serviceDir" "-p:TrayDir=$trayDir" "-p:Version=$Version"
if ($LASTEXITCODE -ne 0) { throw "building the MSI failed" }

# The installer's words (Strings.wxl) make WiX put the MSI in a folder per language: en-US is the only one.
$msi = Join-Path $out "msi\ScreenTime.msi"
New-Item -ItemType Directory -Force (Split-Path $msi) | Out-Null
Copy-Item (Join-Path $wix "en-US\ScreenTime.msi") $msi
"MSI: $msi ($([math]::Round((Get-Item $msi).Length / 1MB)) MB), service $(if ($NoAot) { 'self-contained' } else { 'native AOT' })"
