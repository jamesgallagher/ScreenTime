# Publishes the kid app, so devices update themselves from the server (docs/SPEC.md §12.1).
# Raise kidVersionCode and kidVersionName in android/gradle.properties first, then from the repo root:
#   pwsh -File android\publish-kid.ps1                       every device, on the real server
#   pwsh -File android\publish-kid.ps1 -DeviceId <id>        one device first
#   pwsh -File android\publish-kid.ps1 -To deploy\releases   a folder, the development server's
# -Apk, -VersionCode and -VersionName publish a file that is already built (runs on the emulator use a debug build).
param(
    [string]$To,
    [string]$Ssh = 'root@192.168.0.148',
    [string]$SshDir = '/mnt/user/appdata/screentime/releases',
    [string]$DeviceId,
    [string]$Apk,
    [int]$VersionCode,
    [string]$VersionName
)
$ErrorActionPreference = 'Stop'
$android = $PSScriptRoot

if (-not $Apk) {
    $props = Get-Content "$android\gradle.properties"
    $VersionCode = [int](($props | Select-String '^kidVersionCode=(\d+)').Matches[0].Groups[1].Value)
    $VersionName = ($props | Select-String '^kidVersionName=(.+)$').Matches[0].Groups[1].Value
    if (-not (Test-Path "$android\keystore.properties")) { throw 'No android\keystore.properties: a release build would not be signed.' }
    Push-Location $android
    try { .\gradlew.bat :app-kid:assembleRelease --quiet } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'The build failed.' }
    $Apk = "$android\app-kid\build\outputs\apk\release\app-kid-release.apk"
}
if (-not (Test-Path $Apk)) { throw "No file at $Apk" }

$file = "kid-$VersionCode.apk"
$release = [ordered]@{
    versionCode = $VersionCode
    versionName = $VersionName
    sha256      = (Get-FileHash $Apk -Algorithm SHA256).Hash.ToLowerInvariant()
    sizeBytes   = (Get-Item $Apk).Length
    file        = $file
}
if ($DeviceId) { $release.deviceIds = @($DeviceId) }
$json = $release | ConvertTo-Json -Compress
$temp = "$Apk.json"
[IO.File]::WriteAllText($temp, $json)

# The file first, kid.json last: a device never sees an offer for a file that is not there yet.
if ($To) {
    New-Item -ItemType Directory -Force $To | Out-Null
    Copy-Item $Apk (Join-Path $To $file) -Force
    Move-Item $temp (Join-Path $To 'kid.json') -Force
} else {
    & ssh $Ssh "mkdir -p '$SshDir'"
    & scp -q $Apk "${Ssh}:$SshDir/$file"
    & scp -q $temp "${Ssh}:$SshDir/kid.json.new"
    & ssh $Ssh "mv '$SshDir/kid.json.new' '$SshDir/kid.json'"
    Remove-Item $temp
}
Write-Output "Published $VersionName ($VersionCode), $($release.sizeBytes) bytes$(if ($DeviceId) { " for device $DeviceId" })"
